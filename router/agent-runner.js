import { spawn, execSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import WorkspaceManager from './workspace-manager.js';
import SemanticSearch from '../lib/semantic-search.js';
import TelegramBot from 'node-telegram-bot-api';
import {
  fetchSkill as platformFetchSkill,
  reportStatus as platformReportStatus,
} from '../lib/platform-client.js';

// ── Inlined from @pixelcompany/agent-core (prompt-builder) ──

const SEPARATOR = '\n\n---\n\n';

function trimMemory(content, maxLines = 50) {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  const trimmed = lines.slice(-maxLines).join('\n');
  const dropped = lines.length - maxLines;
  return `[Memory trimmed: ${dropped} older lines omitted]\n\n${trimmed}`;
}

function buildSystemPrompt(parts) {
  const sections = [];
  if (parts.rules) sections.push(parts.rules);
  if (parts.communication) sections.push(parts.communication);
  if (parts.skill) sections.push(parts.skill);
  if (parts.learnedSkills && parts.learnedSkills.length > 0) {
    sections.push('# Additional Skills\n\n' + parts.learnedSkills.join(SEPARATOR));
  }
  if (parts.memory) {
    const trimmed = trimMemory(parts.memory, parts.maxMemoryLines ?? 50);
    if (trimmed.trim().length > 0) {
      sections.push('# Your Memory (from previous sessions)\n\n' + trimmed);
    }
  }
  return sections.join(SEPARATOR);
}

// memory-engine.js and compile-memory.js use CommonJS — bridge via createRequire
const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_DIR = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(BASE_DIR, 'skills');
const MEMORY_DIR = path.join(BASE_DIR, 'memory');
const KNOWLEDGE_DIR = path.join(BASE_DIR, 'knowledge');
const TASKS_DIR = path.join(BASE_DIR, 'tasks');
const COSTS_FILE = path.join(BASE_DIR, 'scripts', 'costs.jsonl');

// Max concurrent claude processes (matches dashboard MAX_WORK_AGENTS)
const MAX_CONCURRENT = parseInt(process.env.MAX_WORK_AGENTS || '3', 10);

// Docker mode — when true, spawn claude inside containers via `docker compose exec`
const DOCKER_MODE = process.env.DOCKER_MODE === 'true';

/**
 * AgentRunner — Spawns real Claude Code CLI processes for each agent task
 *
 * Flow:
 *   1. Receive task (agentName, taskId, prompt)
 *   2. Load agent's SKILL.md as system prompt
 *   3. Load agent's MEMORY.md as context
 *   4. Create git worktree (if repo available)
 *   5. Spawn `claude` CLI process with --print mode
 *   6. Stream output, update task status in real time
 *   7. On completion: commit, push, create PR, update status
 */
class AgentRunner {
  constructor() {
    this.runningProcesses = new Map(); // agentName → { process, taskId, startTime }
    this.taskQueue = []; // { agentName, taskId, prompt, resolve, reject }
    this._loginInProgress = new Map(); // agentName → Promise (prevent concurrent logins)
    this._authVerified = false; // Whether Claude auth has been verified this session
    this._memoryEngine = null;
    this._memoryCompiler = null;
  }

  /**
   * Lazy-init MemoryEngine + MemoryCompiler.
   * Returns null if better-sqlite3 is not installed (non-critical).
   * Seeds the 10 agents into the agents table on first init.
   */
  _getMemoryEngine() {
    if (this._memoryEngine !== null) return this._memoryEngine;
    try {
      const MemoryEngine = require(path.join(BASE_DIR, 'memory', 'memory-engine.js'));
      const dbPath = path.join(MEMORY_DIR, 'engine.db');
      const vectorPath = path.join(MEMORY_DIR, 'vectors.json');
      this._memoryEngine = new MemoryEngine(dbPath, vectorPath);

      // Seed agent rows (required by FK constraints in observations table)
      this._seedAgents();

      const MemoryCompiler = require(path.join(BASE_DIR, 'memory', 'compile-memory.js'));
      this._memoryCompiler = new MemoryCompiler(this._memoryEngine);
      logger.info('MemoryEngine initialized');
    } catch (error) {
      logger.debug('MemoryEngine unavailable (non-critical)', { error: error.message });
      this._memoryEngine = false; // mark as tried-and-failed
    }
    return this._memoryEngine || null;
  }

  /**
   * Ensure all 10 agents exist in the agents table.
   * Uses INSERT OR IGNORE so it's safe to call repeatedly.
   */
  _seedAgents() {
    const AGENT_ROLES = {
      orchestrator: 'coordinator',
      architect: 'designer',
      design: 'designer',
      frontend: 'developer',
      backend: 'developer',
      smartcontract: 'developer',
      researcher: 'researcher',
      tester: 'tester',
      security: 'auditor',
      devops: 'operator'
    };

    try {
      const stmt = this._memoryEngine.db.prepare(`
        INSERT OR IGNORE INTO agents (name, role, created_at)
        VALUES (?, ?, ?)
      `);
      const now = new Date().toISOString();
      for (const [name, role] of Object.entries(AGENT_ROLES)) {
        stmt.run(name, role, now);
      }
      logger.debug('Agent rows seeded');
    } catch (error) {
      logger.debug('Agent seeding failed (non-critical)', { error: error.message });
    }
  }

  // ─── TELEGRAM MESSAGING ──────────────────────────────────────
  /**
   * Send a message to the Telegram group (uses orchestrator bot token)
   */
  async _sendTelegramMessage(text, parseMode = 'HTML') {
    const botToken = process.env.BOT_ORCHESTRATOR;
    const chatId = process.env.TELEGRAM_GROUP_ID;
    if (!botToken || !chatId) {
      logger.warn('Cannot send Telegram message — BOT_ORCHESTRATOR or TELEGRAM_GROUP_ID not set');
      return;
    }
    try {
      const bot = new TelegramBot(botToken, { polling: false });
      await bot.sendMessage(chatId, text, { parse_mode: parseMode });
    } catch (err) {
      logger.error('Failed to send Telegram message', { error: err.message });
    }
  }

  // ─── AUTH CHECK ──────────────────────────────────────────────
  /**
   * Check if Claude CLI is authenticated.
   *
   * All-in-One mode: All agents share the same Claude auth (~/.claude.json)
   * so we only need to check once per session.
   *
   * Docker mode: Check per-container auth via docker exec.
   */
  async checkAuth() {
    // Already verified this session
    if (this._authVerified) return true;
    // API key mode — always authed
    if (process.env.ANTHROPIC_API_KEY) {
      this._authVerified = true;
      return true;
    }

    if (DOCKER_MODE) {
      // Legacy: Docker multi-container mode
      return this._checkDockerAuth();
    }

    // All-in-One / Native mode: check local auth files
    try {
      const home = process.env.HOME || '/root';
      const claudeJson = path.join(home, '.claude.json');

      if (!fs.existsSync(claudeJson)) {
        logger.warn('Claude auth file not found', { path: claudeJson });
        return false;
      }

      // Quick auth test — run a minimal claude command
      const result = execSync(
        'claude -p "Say OK" 2>&1 || true',
        { encoding: 'utf8', timeout: 30000 }
      );
      const lower = result.toLowerCase();

      if (lower.includes('not logged in') || lower.includes('please run /login') ||
          lower.includes('authentication required') || lower.includes('unauthorized')) {
        logger.warn('Claude CLI not authenticated', { output: result.substring(0, 200) });
        return false;
      }

      logger.info('Claude auth verified OK');
      this._authVerified = true;
      return true;
    } catch (err) {
      logger.warn('Auth check error', { error: err.message.substring(0, 200) });
      return false;
    }
  }

  /**
   * Legacy: Check auth for a specific Docker container
   */
  async _checkDockerAuth(containerName) {
    if (!containerName) return false;
    try {
      const result = execSync(
        `docker exec ${containerName} claude -p "Say OK" 2>&1 || true`,
        { encoding: 'utf8', timeout: 30000 }
      );
      const lower = result.toLowerCase();
      if (lower.includes('not logged in') || lower.includes('authentication required')) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure Claude CLI is authenticated before running a task.
   *
   * All-in-One mode: Single shared auth. If not logged in, notify via Telegram
   * with SSH instructions (user logs in once, all agents benefit).
   *
   * Docker mode (legacy): Per-container auth via expect script.
   */
  async ensureLoggedIn(agentName) {
    const isAuthed = await this.checkAuth();
    if (isAuthed) return true;

    // Prevent concurrent login notifications
    if (this._loginInProgress.has('global')) {
      logger.info('Login already in progress, waiting...');
      return this._loginInProgress.get('global');
    }

    const loginPromise = this._notifyLoginRequired(agentName);
    this._loginInProgress.set('global', loginPromise);

    try {
      return await loginPromise;
    } finally {
      this._loginInProgress.delete('global');
    }
  }

  /**
   * Notify user via Telegram that Claude login is required.
   * In All-in-One mode, user SSHs into container and runs `claude` → `/login`.
   */
  async _notifyLoginRequired(agentName) {
    logger.warn('Claude not authenticated, sending login instructions via Telegram', { agentName });

    await this._sendTelegramMessage(
      `🔐 <b>Claude chưa đăng nhập!</b>\n\n` +
      `Agent <b>${agentName.toUpperCase()}</b> cần Claude auth để chạy task.\n\n` +
      `<b>Cách đăng nhập:</b>\n` +
      `1️⃣ SSH vào container:\n` +
      `<code>ssh root@localhost -p 2222</code>\n` +
      `Password: <code>aicompany</code>\n\n` +
      `2️⃣ Chạy Claude và login:\n` +
      `<code>claude</code>\n` +
      `Rồi gõ: <code>/login</code>\n` +
      `Chọn option 1 (Subscription)\n\n` +
      `3️⃣ Sau khi login xong, gửi /verify ở đây.\n\n` +
      `💡 Chỉ cần login 1 lần — tất cả 10 agents dùng chung.`
    );

    return false; // User needs to login manually
  }

  /**
   * Strip ANSI escape codes from string (Claude CLI output is colorized)
   */
  _stripAnsi(str) {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\].*?\x07/g, '');
  }

  /**
   * Extract URL from text (handles ANSI codes, newlines, etc)
   */
  _extractUrl(text) {
    const clean = this._stripAnsi(text);
    // Match any https URL
    const patterns = [
      /https:\/\/console\.anthropic\.com[^\s"')>]*/g,
      /https:\/\/[^\s"')>]*anthropic[^\s"')>]*/g,
      /https:\/\/[^\s"')>]*claude[^\s"')>]*/g,
      /https:\/\/[^\s"')>]+oauth[^\s"')>]*/gi,
      /https:\/\/[^\s"')>]+login[^\s"')>]*/gi,
      /https:\/\/[^\s"')>]+auth[^\s"')>]*/gi,
    ];
    for (const pattern of patterns) {
      const match = clean.match(pattern);
      if (match) return match[0];
    }
    // Last resort: any https URL
    const anyUrl = clean.match(/https:\/\/[^\s"')>]+/);
    return anyUrl ? anyUrl[0] : null;
  }

  async _doLogin(containerName, agentName) {
    logger.info('Starting OAuth login flow via expect', { containerName, agentName });

    // ── Step 0: Quick diagnostics ──
    let diagInfo = '';
    try {
      diagInfo = execSync(
        `docker exec ${containerName} bash -c 'echo "USER=$(whoami) HOME=$HOME"; ls -la $HOME/.claude.json 2>&1 | tail -1; echo "expect: $(which expect 2>/dev/null || echo NOT_FOUND)"' 2>&1`,
        { encoding: 'utf8', timeout: 10000 }
      );
    } catch (e) {
      diagInfo = `diag error: ${e.message}`;
    }

    await this._sendTelegramMessage(
      `🔐 <b>${agentName.toUpperCase()}</b> đang khởi động OAuth login...\n` +
      `<code>${diagInfo.trim().substring(0, 200)}</code>`
    );

    return new Promise((resolve) => {
      let allOutput = '';
      let oauthUrl = '';
      let resolved = false;

      // ── Use expect script for PTY allocation ──
      // expect allocates a proper pseudo-terminal inside the container
      // so `claude login` outputs the OAuth URL correctly
      // (without a TTY, claude login won't display the URL)
      const proc = spawn('docker', [
        'exec',
        containerName,
        'expect', '/usr/local/bin/claude-login.exp'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      logger.info('Spawned expect login process', { containerName, pid: proc.pid });

      const handleOutput = async (data, source) => {
        const raw = data.toString();
        const chunk = this._stripAnsi(raw);
        allOutput += chunk;
        logger.info(`Login expect ${source}`, { containerName, chunk: chunk.substring(0, 500) });

        // Parse structured output from expect script
        const lines = chunk.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();

          // ── OAUTH_URL:<url> ──
          if (trimmed.startsWith('OAUTH_URL:') && !oauthUrl) {
            oauthUrl = trimmed.substring('OAUTH_URL:'.length).trim();
            oauthUrl = oauthUrl.replace(/[\x00-\x1F\x7F]/g, '').trim();
            logger.info('OAuth URL captured from expect!', { containerName, url: oauthUrl });

            await this._sendTelegramMessage(
              `🔑 <b>${agentName.toUpperCase()}</b> cần bạn đăng nhập:\n\n` +
              `👉 <a href="${oauthUrl}">Click để đăng nhập Claude</a>\n\n` +
              `📋 Copy link:\n<code>${oauthUrl}</code>\n\n` +
              `⏱ Bạn có 2 phút để hoàn tất.`
            );
          }

          // ── LOGIN_SUCCESS ──
          if (trimmed === 'LOGIN_SUCCESS' && !resolved) {
            resolved = true;
            this._loggedInContainers.add(containerName);
            logger.info('Login successful via expect', { containerName });
            await this._sendTelegramMessage(
              `✅ <b>${agentName.toUpperCase()}</b> đã đăng nhập thành công!`
            );
            resolve(true);
          }

          // ── ALREADY_LOGGED_IN ──
          if (trimmed === 'ALREADY_LOGGED_IN' && !resolved) {
            resolved = true;
            this._loggedInContainers.add(containerName);
            logger.info('Container already logged in', { containerName });
            await this._sendTelegramMessage(
              `✅ <b>${agentName.toUpperCase()}</b> đã đăng nhập sẵn rồi!`
            );
            resolve(true);
          }

          // ── LOGIN_TIMEOUT ──
          if (trimmed === 'LOGIN_TIMEOUT' && !resolved) {
            resolved = true;
            logger.warn('Expect script timed out', { containerName });
            await this._sendTelegramMessage(
              `⏰ <b>${agentName.toUpperCase()}</b> login timeout.\n\n` +
              `${oauthUrl ? '⚠️ Link đã gửi nhưng bạn chưa authorize.' : '❌ Không tìm thấy OAuth link.'}\n\n` +
              `💡 Thử: /login ${agentName}\n` +
              `Hoặc: /loginhost (đăng nhập từ Mac terminal)`
            );
            resolve(false);
          }

          // ── DEBUG messages ──
          if (trimmed.startsWith('DEBUG:')) {
            logger.info('Expect debug', { containerName, msg: trimmed });
          }
        }

        // ── Fallback URL extraction (in case expect misses it) ──
        if (!oauthUrl) {
          const url = this._extractUrl(allOutput);
          if (url) {
            oauthUrl = url;
            logger.info('OAuth URL captured via fallback!', { containerName, url });
            await this._sendTelegramMessage(
              `🔑 <b>${agentName.toUpperCase()}</b> cần bạn đăng nhập:\n\n` +
              `👉 <a href="${oauthUrl}">Click để đăng nhập Claude</a>\n\n` +
              `📋 Copy link:\n<code>${oauthUrl}</code>\n\n` +
              `⏱ Bạn có 2 phút để hoàn tất.`
            );
          }
        }
      };

      proc.stdout.on('data', (data) => handleOutput(data, 'stdout'));
      proc.stderr.on('data', (data) => handleOutput(data, 'stderr'));

      proc.on('close', async (code) => {
        logger.info('Expect login exited', {
          containerName, code,
          outputLen: allOutput.length,
          preview: allOutput.substring(0, 600)
        });

        if (!resolved) {
          resolved = true;
          if (code === 0) {
            this._loggedInContainers.add(containerName);
            await this._sendTelegramMessage(
              `✅ <b>${agentName.toUpperCase()}</b> đã đăng nhập thành công!`
            );
            resolve(true);
          } else {
            const cleanOutput = this._stripAnsi(allOutput).substring(0, 400);
            logger.error('Expect login failed', { containerName, code, output: cleanOutput });
            await this._sendTelegramMessage(
              `❌ <b>${agentName.toUpperCase()}</b> đăng nhập thất bại (code: ${code}).\n\n` +
              `<b>Output:</b>\n<code>${cleanOutput.substring(0, 300)}</code>\n\n` +
              `💡 Thử:\n` +
              `• /login ${agentName}\n` +
              `• /loginhost (đăng nhập từ Mac)\n` +
              `• <code>docker exec -it ${containerName} claude login</code>`
            );
            resolve(false);
          }
        }
      });

      proc.on('error', async (err) => {
        if (!resolved) {
          resolved = true;
          logger.error('Expect spawn error', { containerName, error: err.message });
          await this._sendTelegramMessage(
            `❌ <b>${agentName.toUpperCase()}</b> lỗi: ${err.message}\n\n` +
            `💡 Thử rebuild: <code>docker compose build --no-cache</code>`
          );
          resolve(false);
        }
      });

      // Safety timeout — 150 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          logger.warn('Login safety timeout', { containerName });
          try { proc.kill('SIGTERM'); } catch {}
          this._sendTelegramMessage(
            `⏰ <b>${agentName.toUpperCase()}</b> login timeout (2.5p).\n\n` +
            `${oauthUrl ? '⚠️ Link gửi rồi nhưng chưa authorize.' : '❌ Không tìm thấy OAuth link.'}\n\n` +
            `💡 Thử: /loginhost`
          );
          resolve(false);
        }
      }, 150000);
    });
  }

  // ─── END TELEGRAM LOGIN FLOW ──────────────────────────────────

  /**
   * Build the system prompt for an agent from SKILL.md + MEMORY.md + RULES.md
   *
   * If connected to the PixelCompany marketplace, tries to fetch a purchased
   * SKILL.md via the platform API. Falls back to local skills/{agent}/SKILL.md.
   */
  async _buildSystemPrompt(agentName) {
    const rulesFile = path.join(SKILLS_DIR, 'shared', 'RULES.md');
    const rules = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, 'utf8') : undefined;

    const commFile = path.join(SKILLS_DIR, 'shared', 'COMMUNICATION.md');
    const communication = fs.existsSync(commFile) ? fs.readFileSync(commFile, 'utf8') : undefined;

    // Skill — try marketplace first, fall back to local file
    let skill;
    const mpConfig = this._getMarketplaceAgentConfig(agentName);
    if (mpConfig) {
      try {
        skill = await platformFetchSkill(mpConfig);
        if (skill) {
          logger.info('Marketplace skill loaded via API', { agentName, bytes: skill.length });
        }
      } catch {
        // platform-client never throws, but guard anyway
      }
    }
    if (!skill) {
      const skillFile = path.join(SKILLS_DIR, agentName, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        skill = fs.readFileSync(skillFile, 'utf8');
      }
    }

    const learnedSkills = this._getActiveLearnedSkills(agentName);

    const memFile = path.join(MEMORY_DIR, agentName, 'MEMORY.md');
    const memory = fs.existsSync(memFile) ? fs.readFileSync(memFile, 'utf8') : undefined;

    return buildSystemPrompt({ rules, communication, skill, learnedSkills, memory });
  }

  /**
   * Look up marketplace config for this role from marketplace-agents.json.
   * Returns { agent_id, company_id } or null.
   */
  _getMarketplaceAgentConfig(agentName) {
    const configPath = path.join(BASE_DIR, 'marketplace-agents.json');
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const agentConf = config.agents?.[agentName];
        if (agentConf?.agent_id) {
          return {
            agent_id: agentConf.agent_id,
            company_id: agentConf.company_id || config.company_id || null,
          };
        }
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }

  /**
   * Inject task-relevant knowledge into the system prompt.
   *
   * Strategy:
   *   1. Check for graphify GRAPH_REPORT.md — if it exists, use it as a
   *      compact structured overview (70x fewer tokens than raw files)
   *   2. Try semantic search (vector similarity) — topK=3, max 2000 tokens
   *   3. If both unavailable, fall back to loading all knowledge files
   */
  async _getSemanticContext(agentName, taskPrompt) {
    const parts = [];

    // 1. Graphify report — structured knowledge graph summary
    const graphReport = path.join(KNOWLEDGE_DIR, 'shared', 'graphify-out', 'GRAPH_REPORT.md');
    if (fs.existsSync(graphReport)) {
      try {
        const report = fs.readFileSync(graphReport, 'utf8');
        if (report.trim().length > 0) {
          // Cap at 2000 chars to avoid bloating system prompt
          const trimmed = report.length > 2000 ? report.substring(0, 2000) + '\n\n[Report truncated]' : report;
          parts.push(`# Knowledge Graph Overview\n\n${trimmed}`);
          logger.info('Graphify report injected', { agentName, size: trimmed.length });
        }
      } catch {}
    }

    // 2. Semantic search for task-specific knowledge
    try {
      const context = await SemanticSearch.getRelevantContext(agentName, taskPrompt, 2000);
      if (context && context.trim().length > 0) {
        parts.push(`# Task-Relevant Knowledge\n\n${context}`);
        logger.info('Semantic context injected', {
          agentName,
          contextLength: context.length
        });
      }
    } catch (error) {
      logger.debug('Semantic search unavailable', { error: error.message });
    }

    // If we got any structured context, use it
    if (parts.length > 0) {
      return parts.join('\n\n---\n\n');
    }

    // 3. Fallback: load all knowledge files (bounded by _getActiveKnowledge)
    const knowledge = this._getActiveKnowledge(agentName);
    if (knowledge.length > 0) {
      logger.info('Knowledge fallback: loaded all active knowledge files', {
        agentName,
        count: knowledge.length
      });
      return '# Reference Knowledge\n\n' + knowledge.join('\n\n---\n\n');
    }

    return '';
  }

  /**
   * Get active learned skills for an agent, respecting skill-config.json
   *
   * Logic:
   *   - If skill-config.json exists → load only skills listed in active_skills
   *   - If skill-config.json doesn't exist → load ALL learned skills (backward compat)
   *   - Skills in disabled_skills are never loaded
   */
  _getActiveLearnedSkills(agentName) {
    const learnedDir = path.join(SKILLS_DIR, agentName, 'learned');
    if (!fs.existsSync(learnedDir)) return [];

    const configFile = path.join(SKILLS_DIR, agentName, 'skill-config.json');
    let activeList = null;
    let disabledList = [];

    if (fs.existsSync(configFile)) {
      try {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        activeList = config.active_skills || [];
        disabledList = config.disabled_skills || [];
        logger.debug('Skill config loaded', {
          agentName,
          active: activeList.length,
          disabled: disabledList.length
        });
      } catch (e) {
        logger.warn('Invalid skill-config.json, loading all skills', { agentName });
      }
    }

    const skills = [];
    const files = fs.readdirSync(learnedDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const skillName = file.replace('.md', '');

      // Skip if explicitly disabled
      if (disabledList.includes(skillName)) {
        logger.debug('Skill disabled, skipping', { agentName, skill: skillName });
        continue;
      }

      // If active list exists, only load skills on the list
      if (activeList !== null && !activeList.includes(skillName)) {
        logger.debug('Skill not in active list, skipping', { agentName, skill: skillName });
        continue;
      }

      try {
        const content = fs.readFileSync(path.join(learnedDir, file), 'utf8').trim();
        if (content.length > 0) {
          skills.push(`## Learned Skill: ${skillName}\n\n${content}`);
          logger.info('Loaded learned skill', { agentName, skill: skillName });
        }
      } catch {}
    }

    return skills;
  }

  /**
   * Get active knowledge for an agent from knowledge/shared/ and knowledge/{agent}/
   *
   * Knowledge = curated reference documents (API specs, schemas, coding standards)
   * vs Skills = how to do things, vs Memory = what was learned from past sessions
   *
   * Logic:
   *   1. Load shared knowledge (from knowledge/shared/) — respects shared config
   *   2. Load agent-specific knowledge (from knowledge/{agent}/) — respects agent config
   *   3. Disabled knowledge is never loaded
   */
  _getActiveKnowledge(agentName) {
    const items = [];

    // 1. Shared knowledge
    const sharedDir = path.join(KNOWLEDGE_DIR, 'shared');
    if (fs.existsSync(sharedDir)) {
      const sharedConfigFile = path.join(SKILLS_DIR, 'shared', 'knowledge-config.json');
      let sharedDisabled = [];

      if (fs.existsSync(sharedConfigFile)) {
        try {
          const config = JSON.parse(fs.readFileSync(sharedConfigFile, 'utf8'));
          sharedDisabled = config.disabled_knowledge || [];
        } catch {}
      }

      const files = fs.readdirSync(sharedDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const name = file.replace('.md', '');
        if (sharedDisabled.includes(name)) {
          logger.debug('Shared knowledge disabled, skipping', { name });
          continue;
        }
        try {
          const content = fs.readFileSync(path.join(sharedDir, file), 'utf8').trim();
          if (content.length > 0) {
            items.push(`## [Shared] ${name}\n\n${content}`);
            logger.info('Loaded shared knowledge', { agentName, knowledge: name });
          }
        } catch {}
      }
    }

    // 2. Agent-specific knowledge
    const agentKbDir = path.join(KNOWLEDGE_DIR, agentName);
    if (fs.existsSync(agentKbDir)) {
      const configFile = path.join(SKILLS_DIR, agentName, 'skill-config.json');
      let disabledList = [];

      if (fs.existsSync(configFile)) {
        try {
          const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
          disabledList = config.disabled_knowledge || [];
        } catch {}
      }

      const files = fs.readdirSync(agentKbDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const name = file.replace('.md', '');
        if (disabledList.includes(name)) {
          logger.debug('Agent knowledge disabled, skipping', { agentName, knowledge: name });
          continue;
        }
        try {
          const content = fs.readFileSync(path.join(agentKbDir, file), 'utf8').trim();
          if (content.length > 0) {
            items.push(`## [${agentName}] ${name}\n\n${content}`);
            logger.info('Loaded agent knowledge', { agentName, knowledge: name });
          }
        } catch {}
      }
    }

    return items;
  }

  /**
   * Build the task prompt including context from the task file.
   *
   * Includes a "Post-Task Learning" section that instructs the agent to
   * extract reusable patterns and save them as learned skills.
   * Inspired by everything-claude-code/skills/continuous-learning.
   */
  _buildTaskPrompt(agentName, taskId, userPrompt) {
    const learnedDir = path.join(SKILLS_DIR, agentName, 'learned');
    const lines = [];

    lines.push(`You are the ${agentName} agent in an AI company.`);
    lines.push(`Task ID: ${taskId}`);
    lines.push('');
    lines.push('## Your Task');
    lines.push(userPrompt);
    lines.push('');
    lines.push('## Output Requirements');
    lines.push(`- Write results to the working directory`);
    lines.push(`- Commit your changes with clear messages`);
    lines.push(`- Update the task status file when done`);
    lines.push('');
    lines.push('## Post-Task Learning');
    lines.push(`After completing your task, evaluate whether you discovered a reusable pattern.`);
    lines.push(`If yes, save a short skill file (<100 words) to: ${learnedDir}/{pattern-name}.md`);
    lines.push(`Pattern types to look for:`);
    lines.push(`- error_resolution: how a specific error class was fixed`);
    lines.push(`- workaround: solution to a framework/library quirk`);
    lines.push(`- project_convention: project-specific coding convention`);
    lines.push(`- debugging_technique: effective debugging approach`);
    lines.push(`If nothing reusable was learned, skip this step — do not create empty files.`);

    return lines.join('\n');
  }

  /**
   * Legacy status file writer — replaced by _reportStatusToApi() which
   * pushes to Supabase agent_status table via the platform webhook.
   * Kept as no-op so existing call sites don't break.
   */
  _updateStatusFile() {
    // No-op: status is now reported to Supabase via _reportStatusToApi()
  }

  /**
   * Push status to the PixelCompany platform (fire-and-forget).
   * No-op if PLATFORM_API_KEY is not set.
   */
  _reportStatusToApi(agentName, status, currentTask = null) {
    try {
      platformReportStatus({ agent_role: agentName, status, current_task: currentTask });
    } catch {
      // Never crash agent execution
    }
  }

  /**
   * Update a task file with new status
   */
  _updateTaskFile(taskId, updates) {
    const taskFile = path.join(TASKS_DIR, `${taskId}.json`);
    try {
      let task = {};
      if (fs.existsSync(taskFile)) {
        task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
      }
      Object.assign(task, updates, { updatedAt: new Date().toISOString() });
      fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));
    } catch (error) {
      logger.error('Failed to update task file', { taskId, error: error.message });
    }
  }

  /**
   * Log cost for a claude invocation
   */
  _logCost(agentName, taskId, output) {
    try {
      // Parse cost info from claude output if available
      const costMatch = output.match(/Total cost: \$?([\d.]+)/i);
      const tokenMatch = output.match(/Total tokens: ([\d,]+)/i);

      const entry = {
        timestamp: new Date().toISOString(),
        agent: agentName,
        task_id: taskId,
        cost: costMatch ? parseFloat(costMatch[1]) : 0,
        tokens: tokenMatch ? parseInt(tokenMatch[1].replace(/,/g, '')) : 0,
        model: 'claude-sonnet-4-20250514'
      };

      fs.appendFileSync(COSTS_FILE, JSON.stringify(entry) + '\n');
    } catch (error) {
      // Non-critical, don't crash
    }
  }

  /**
   * Run a task with a specific agent using Claude Code CLI
   *
   * @param {string} agentName - Agent name (e.g. "frontend")
   * @param {string} taskId - Unique task ID
   * @param {string} prompt - User's task description
   * @returns {Promise<{ success: boolean, output: string, pr?: string }>}
   */
  async runTask(agentName, taskId, prompt) {
    // Check capacity
    if (this.runningProcesses.size >= MAX_CONCURRENT) {
      logger.info('At capacity, queueing task', { agentName, taskId });
      return new Promise((resolve, reject) => {
        this.taskQueue.push({ agentName, taskId, prompt, resolve, reject });
      });
    }

    return this._executeTask(agentName, taskId, prompt);
  }

  async _executeTask(agentName, taskId, prompt) {
    logger.info('Starting agent task', { agentName, taskId });

    // Update task status
    this._updateTaskFile(taskId, { status: 'in_progress', agent: agentName });

    // Create worktree for isolation (if repo exists)
    const worktree = WorkspaceManager.createWorktree(agentName, taskId);
    const workDir = worktree?.worktreePath || WorkspaceManager.getAgentWorkdir(agentName);

    // Ensure learned skills directory exists for continuous learning
    const learnedDir = path.join(SKILLS_DIR, agentName, 'learned');
    try {
      if (!fs.existsSync(learnedDir)) {
        fs.mkdirSync(learnedDir, { recursive: true });
      }
    } catch (e) {
      logger.debug('Could not create learned dir (non-critical)', { agentName, error: e.message });
    }

    // Build prompts (async — marketplace agents fetch skill via API)
    let systemPrompt = await this._buildSystemPrompt(agentName);

    // Enrich with semantically relevant context from knowledge base
    const semanticContext = await this._getSemanticContext(agentName, prompt);
    if (semanticContext) {
      systemPrompt += '\n\n---\n\n' + semanticContext;
    }

    const taskPrompt = this._buildTaskPrompt(agentName, taskId, prompt);

    // Claude CLI only accepts standard tool names for --allowedTools
    // Custom agent-specific tools from permissions.json are for internal use only
    const allowedTools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];

    // ─── AUTH CHECK: ensure Claude is logged in before spawning ───
    const isLoggedIn = await this.ensureLoggedIn(agentName);
    if (!isLoggedIn) {
      logger.error('Claude not logged in, cannot execute task', { agentName, taskId });
      this._updateTaskFile(taskId, {
        status: 'error',
        error: 'Claude not logged in. SSH vào container và chạy `claude` → `/login`.',
        completedAt: new Date().toISOString()
      });
      this._updateStatusFile();
      this._reportStatusToApi(agentName, 'error', taskId);
      return {
        success: false,
        output: '',
        error: 'Claude not logged in. SSH into container and run claude → /login.'
      };
    }

    return new Promise((resolve) => {
      let output = '';
      let errorOutput = '';

      // Claude CLI arguments — prompt will be piped via stdin (most reliable)
      const claudeArgs = [
        '--print',                        // Non-interactive mode
        '--output-format', 'text',        // Plain text output
        '--max-turns', '50',              // Safety limit
        '--system-prompt', systemPrompt,  // Agent's role + rules
        '--allowedTools', allowedTools.join(','),
        '-p', taskPrompt                  // Explicit prompt flag
      ];

      let spawnCmd, spawnArgs, spawnOpts;

      if (DOCKER_MODE) {
        // Docker mode — exec claude inside agent's running container
        // Container names follow pattern: ai-agent-{agentName} (from docker-compose.yml)
        const containerName = `ai-agent-${agentName}`;
        spawnCmd = 'docker';
        spawnArgs = [
          'exec',
          '-e', `AGENT_NAME=${agentName}`,
          '-e', `TASK_ID=${taskId}`,
          '-e', `AI_COMPANY_DIR=/agent`,
        ];
        // Pass ANTHROPIC_API_KEY if available (most reliable auth for containers)
        if (process.env.ANTHROPIC_API_KEY) {
          spawnArgs.push('-e', `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
        }
        spawnArgs.push(
          '-w', '/workspace',
          containerName,
          'claude',
          ...claudeArgs
        );
        spawnOpts = {
          cwd: '/app',
          env: { ...process.env, DOCKER_HOST: 'unix:///var/run/docker.sock' },
          stdio: ['pipe', 'pipe', 'pipe']
        };
      } else {
        // Native mode — spawn claude directly
        spawnCmd = 'claude';
        spawnArgs = claudeArgs;
        spawnOpts = {
          cwd: workDir,
          env: {
            ...process.env,
            AGENT_NAME: agentName,
            TASK_ID: taskId,
            AI_COMPANY_DIR: BASE_DIR,
          },
          stdio: ['pipe', 'pipe', 'pipe']
        };
      }

      logger.info(`Spawning claude process (${DOCKER_MODE ? 'Docker' : 'native'})`, {
        agentName, taskId, cwd: DOCKER_MODE ? 'container' : workDir,
        tools: allowedTools.join(',')
      });

      // Log the actual command for debugging (truncate long args)
      const debugArgs = spawnArgs.map(a => a.length > 200 ? a.substring(0, 200) + '...[truncated]' : a);
      logger.info('Spawn command', { cmd: spawnCmd, argsCount: spawnArgs.length, firstArgs: debugArgs.slice(0, 8).join(' ') });

      const proc = spawn(spawnCmd, spawnArgs, spawnOpts);

      // Close stdin immediately so Claude CLI doesn't wait for stdin input
      proc.stdin.end();

      // Track the running process
      this.runningProcesses.set(agentName, {
        process: proc,
        taskId,
        startTime: new Date().toISOString()
      });
      this._updateStatusFile();
      this._reportStatusToApi(agentName, 'working', taskId);

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      proc.on('close', async (code) => {
        logger.info('Claude process exited', {
          agentName, taskId, code,
          stdoutLen: output.length,
          stderrLen: errorOutput.length,
          stderrPreview: errorOutput.substring(0, 500),
          stdoutPreview: output.substring(0, 500)
        });

        // Remove from running
        this.runningProcesses.delete(agentName);

        // ─── ERROR CLASSIFICATION ───
        const allOutput = (output + errorOutput).toLowerCase();
        let errorType = null;

        if (code !== 0) {
          if (allOutput.includes('not logged in') ||
              allOutput.includes('please run /login') ||
              allOutput.includes('authentication required')) {
            errorType = 'auth';
            this._authVerified = false;
            logger.warn('Auth error detected', { agentName, taskId });
            await this._sendTelegramMessage(
              `🔐 <b>${agentName.toUpperCase()}</b> mất xác thực.\n` +
              `SSH vào container để login lại:\n` +
              `<code>ssh root@localhost -p 2222</code>\n` +
              `<code>claude</code> → <code>/login</code>`
            );
          } else if (allOutput.includes('rate limit') || allOutput.includes('rate_limit') ||
                     allOutput.includes('too many requests') || allOutput.includes('429') ||
                     allOutput.includes('quota') || allOutput.includes('exceeded') ||
                     allOutput.includes('overloaded') || allOutput.includes('capacity')) {
            errorType = 'rate_limit';
            logger.warn('Rate limit / quota exceeded', { agentName, taskId });
            await this._sendTelegramMessage(
              `⚠️ <b>${agentName.toUpperCase()}</b> bị giới hạn (rate limit / quota).\n` +
              `Hãy đợi vài phút rồi thử lại.`
            );
          } else if (allOutput.includes('billing') || allOutput.includes('payment') ||
                     allOutput.includes('subscription') || allOutput.includes('plan limit')) {
            errorType = 'billing';
            logger.warn('Billing/subscription error', { agentName, taskId });
            await this._sendTelegramMessage(
              `💳 <b>${agentName.toUpperCase()}</b> lỗi billing/subscription.\n` +
              `Kiểm tra tài khoản Claude của bạn.`
            );
          }
        }

        // Log costs
        this._logCost(agentName, taskId, output + errorOutput);

        // ─── AUTO-SAVE OBSERVATION to MemoryEngine ───
        this._saveObservation(agentName, taskId, prompt, output, code === 0);

        let prUrl = null;

        if (code === 0) {
          // Success — try to push and create PR
          if (worktree) {
            try {
              // Auto-commit if there are changes
              try {
                const status = require('child_process').execSync(
                  'git status --porcelain', { cwd: workDir, encoding: 'utf8' }
                ).trim();

                if (status) {
                  require('child_process').execSync(
                    `git add -A && git commit -m "[${agentName}] Complete task ${taskId}\n\n${prompt.substring(0, 200)}"`,
                    { cwd: workDir, stdio: 'pipe' }
                  );
                }
              } catch {}

              prUrl = await WorkspaceManager.pushAndCreatePR(agentName, prompt.substring(0, 60));
            } catch (e) {
              logger.warn('PR creation failed (non-critical)', { error: e.message });
            }
          }

          this._updateTaskFile(taskId, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            output: output.substring(0, 5000), // Truncate for storage
            pr_url: prUrl
          });
        } else {
          this._updateTaskFile(taskId, {
            status: 'error',
            completedAt: new Date().toISOString(),
            error: errorOutput.substring(0, 2000) || `Process exited with code ${code}`,
            error_type: errorType,
            output: output.substring(0, 5000)
          });
        }

        // Update status file
        this._updateStatusFile();
        this._reportStatusToApi(agentName, code === 0 ? 'idle' : 'error', taskId);

        // Recompile MEMORY.md from accumulated observations
        this._recompileMemory(agentName);

        // Clean up worktree
        if (worktree) {
          WorkspaceManager.removeWorktree(agentName);
        }

        // Process queue
        this._processQueue();

        resolve({
          success: code === 0,
          output: output.substring(0, 5000),
          error: errorOutput.substring(0, 2000),
          pr: prUrl
        });
      });

      proc.on('error', (error) => {
        logger.error('Failed to spawn claude process', {
          agentName, taskId, error: error.message
        });

        this.runningProcesses.delete(agentName);
        this._updateStatusFile();
        this._reportStatusToApi(agentName, 'error', taskId);

        this._updateTaskFile(taskId, {
          status: 'error',
          error: `Failed to spawn claude: ${error.message}`,
          completedAt: new Date().toISOString()
        });

        this._processQueue();

        resolve({
          success: false,
          output: '',
          error: error.message
        });
      });
    });
  }

  // ─── POST-TASK: Memory Observation + Recompile ───────────────
  /**
   * Save an observation to MemoryEngine after a task completes.
   * Captures what the agent did, infers observation type, and updates
   * the vector index so future semantic searches can find it.
   */
  _saveObservation(agentName, taskId, prompt, output, success) {
    const engine = this._getMemoryEngine();
    if (!engine) return;

    try {
      const truncatedOutput = (output || '').substring(0, 1000);
      engine.captureObservation(agentName, 'task', prompt, truncatedOutput, {
        type: engine.inferObservationType(prompt, truncatedOutput),
        concepts: this._inferConcepts(prompt, truncatedOutput),
        discovery_tokens: Math.ceil((prompt.length + truncatedOutput.length) / 4),
        success,
        category: 'task-completion'
      });
      engine.flushWrites(agentName);
      engine.saveVectorIndex();
      logger.info('Observation saved to MemoryEngine', { agentName, taskId });
    } catch (error) {
      logger.debug('Observation save failed (non-critical)', { error: error.message });
    }
  }

  /**
   * Infer observation concepts from task content.
   * Maps keywords to claude-mem concept types.
   */
  _inferConcepts(prompt, output) {
    const text = `${prompt} ${output}`.toLowerCase();
    const concepts = [];
    if (text.includes('fix') || text.includes('bug') || text.includes('error'))
      concepts.push('problem-solution');
    if (text.includes('decide') || text.includes('chose') || text.includes('architecture') || text.includes('design'))
      concepts.push('trade-off');
    if (text.includes('pattern') || text.includes('refactor') || text.includes('convention'))
      concepts.push('pattern');
    if (text.includes('gotcha') || text.includes('edge case') || text.includes('caveat'))
      concepts.push('gotcha');
    if (concepts.length === 0)
      concepts.push('what-changed');
    return concepts;
  }

  /**
   * Recompile MEMORY.md from MemoryEngine observations.
   * Called after saving observations to keep the flat file in sync.
   * Also compresses old observations (>24h) to bound storage growth.
   */
  _recompileMemory(agentName) {
    const engine = this._getMemoryEngine();
    if (!engine || !this._memoryCompiler) return;

    try {
      // Compress old observations before recompiling
      engine.compressOldObservations(agentName);

      const compiled = this._memoryCompiler.compileMemory(agentName);
      if (compiled && compiled.length > 50) {
        this._memoryCompiler.saveMemory(agentName, compiled);
        logger.info('MEMORY.md recompiled', { agentName, size: compiled.length });
      }
    } catch (error) {
      logger.debug('Memory recompilation failed (non-critical)', { error: error.message });
    }
  }

  /**
   * Process the next item in the queue when a slot opens up
   */
  _processQueue() {
    while (this.taskQueue.length > 0 && this.runningProcesses.size < MAX_CONCURRENT) {
      const { agentName, taskId, prompt, resolve } = this.taskQueue.shift();
      logger.info('Processing queued task', { agentName, taskId });
      this._executeTask(agentName, taskId, prompt).then(resolve);
    }
  }

  /**
   * Stop a running agent process
   */
  stopAgent(agentName) {
    const running = this.runningProcesses.get(agentName);
    if (!running) return false;

    try {
      running.process.kill('SIGTERM');
      // Give it 5 seconds, then force kill
      setTimeout(() => {
        try { running.process.kill('SIGKILL'); } catch {}
      }, 5000);

      this.runningProcesses.delete(agentName);
      this._updateStatusFile();
      this._reportStatusToApi(agentName, 'idle');
      logger.info('Agent stopped', { agentName });
      return true;
    } catch (error) {
      logger.error('Failed to stop agent', { agentName, error: error.message });
      return false;
    }
  }

  /**
   * Stop all running agents
   */
  stopAll() {
    for (const [agentName] of this.runningProcesses) {
      this.stopAgent(agentName);
    }
    this.taskQueue = [];
  }

  /**
   * Get current status of all agents
   */
  getStatus() {
    return {
      running: Object.fromEntries(
        Array.from(this.runningProcesses.entries()).map(([name, info]) => [
          name, { taskId: info.taskId, startTime: info.startTime, pid: info.process?.pid }
        ])
      ),
      queueLength: this.taskQueue.length,
      maxConcurrent: MAX_CONCURRENT,
      canAcceptMore: this.runningProcesses.size < MAX_CONCURRENT
    };
  }
}

export default new AgentRunner();
