import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';

import logger from './logger.js';
import AgentManager from './agent-manager.js';
import SkillHandler from './skill-handler.js';
import { startQueue, stopQueue } from '../lib/queue.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const TASKS_DIR = process.env.TASKS_DIR || '../tasks';
const MAX_WORK_AGENTS = parseInt(process.env.MAX_WORK_AGENTS || '3', 10);
const POLLING_INTERVAL = parseInt(process.env.POLLING_INTERVAL || '5000', 10);
const DASHBOARD_WS_PORT = parseInt(process.env.ROUTER_WS_PORT || '9803', 10);

// Bot tokens — mỗi key = tên agent, value = token từ .env
const BOT_TOKENS = {
  orchestrator:   process.env.BOT_ORCHESTRATOR,
  architect:      process.env.BOT_ARCHITECT,
  design:         process.env.BOT_DESIGN,
  frontend:       process.env.BOT_FRONTEND,
  backend:        process.env.BOT_BACKEND,
  smartcontract:  process.env.BOT_SMARTCONTRACT,
  researcher:     process.env.BOT_RESEARCHER,
  tester:         process.env.BOT_TESTER,
  security:       process.env.BOT_SECURITY,
  devops:         process.env.BOT_DEVOPS
};

// Agent display names (for Telegram messages & dashboard)
const AGENT_NAMES = {
  orchestrator:   'ORCHESTRATOR',
  architect:      'ARCHITECT',
  design:         'DESIGN',
  frontend:       'FRONTEND',
  backend:        'BACKEND',
  smartcontract:  'SMARTCONTRACT',
  researcher:     'RESEARCHER',
  tester:         'TESTER',
  security:       'SECURITY',
  devops:         'DEVOPS'
};

// ─── Access Control ─────────────────────────────────────────
// Build set of allowed Telegram user IDs (owner + additional admins)
const ALLOWED_IDS = new Set();
if (OWNER_TELEGRAM_ID) ALLOWED_IDS.add(OWNER_TELEGRAM_ID.toString());
if (process.env.ALLOWED_TELEGRAM_IDS) {
  process.env.ALLOWED_TELEGRAM_IDS.split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0)
    .forEach(id => ALLOWED_IDS.add(id));
}

/**
 * Check if a Telegram user is authorized to interact with bots.
 * Allowed: owner, additional admins from ALLOWED_TELEGRAM_IDS,
 *          and messages from the bots themselves (inter-agent communication).
 */
function isAuthorized(userId) {
  const uid = userId.toString();
  // Check owner + allowed list
  if (ALLOWED_IDS.has(uid)) return true;
  // Check if sender is one of our own bots (inter-agent messages)
  // Bot user IDs are the first part of the token (before the colon)
  for (const token of Object.values(BOT_TOKENS)) {
    if (token && token.split(':')[0] === uid) return true;
  }
  return false;
}

// Global state
let orchestratorBot = null;
let bots = new Map();
let tasksWatcher = null;
let dashboardClients = new Set();
let deploymentApprovals = new Map();
let skillHandler = null;
let wsServer = null;
let expressApp = null;
let httpServer = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

async function validateConfiguration() {
  const errors = [];

  if (!TELEGRAM_GROUP_ID) errors.push('TELEGRAM_GROUP_ID not set');
  if (!OWNER_TELEGRAM_ID) errors.push('OWNER_TELEGRAM_ID not set');
  if (!BOT_TOKENS.orchestrator) errors.push('BOT_ORCHESTRATOR not set');

  for (const [key, token] of Object.entries(BOT_TOKENS)) {
    if (!token) errors.push(`Bot token ${key} not set`);
  }

  if (errors.length > 0) {
    logger.error('Configuration validation failed', {
      errors: errors.join(', ')
    });
    process.exit(1);
  }

  logger.success('Configuration validated successfully');
}

function initDirectories() {
  try {
    const tasksPath = path.resolve(TASKS_DIR);
    if (!fs.existsSync(tasksPath)) {
      fs.mkdirSync(tasksPath, { recursive: true });
      logger.info('Created tasks directory', { path: tasksPath });
    }
  } catch (error) {
    logger.error('Failed to initialize directories', { error: error.message });
    process.exit(1);
  }
}

async function initBots() {
  try {
    // Initialize orchestrator bot (polling mode)
    orchestratorBot = new TelegramBot(BOT_TOKENS.orchestrator, {
      polling: {
        interval: POLLING_INTERVAL,
        autoStart: true
      }
    });

    logger.success('Orchestrator bot initialized with polling');

    // Initialize other bots (no polling, just for sending)
    for (const [key, token] of Object.entries(BOT_TOKENS)) {
      if (key !== 'orchestrator' && token) {
        try {
          const bot = new TelegramBot(token, { polling: false });
          bots.set(key, bot);
          logger.success(`Bot ${key} initialized`);
        } catch (error) {
          logger.warn(`Failed to initialize bot ${key}`, {
            error: error.message
          });
        }
      }
    }

    // Setup orchestrator message handlers
    setupOrchestratorHandlers();
  } catch (error) {
    logger.error('Failed to initialize bots', { error: error.message });
    process.exit(1);
  }
}

function setupOrchestratorHandlers() {
  // Handle text messages — ALL messages go to orchestrator for decomposition
  orchestratorBot.on('message', async (msg) => {
    try {
      // ─── ACCESS CONTROL: chỉ owner + allowed IDs + internal bots ───
      if (msg.from && !isAuthorized(msg.from.id)) {
        logger.warn('Unauthorized access blocked', {
          userId: msg.from.id,
          username: msg.from.username || 'unknown',
          text: (msg.text || '').substring(0, 50)
        });
        await orchestratorBot.sendMessage(
          msg.chat.id,
          '⛔ Bạn không có quyền sử dụng bot này.',
          { reply_to_message_id: msg.message_id }
        );
        return;
      }

      if (msg.text && msg.text.startsWith('/')) {
        await handleCommand(msg);
      } else if (msg.text && msg.text.trim().length > 0) {
        // ALL non-command messages go to orchestrator agent
        await handleUserMessage(msg);
      }
    } catch (error) {
      logger.error('Error processing message', {
        msgId: msg.message_id,
        error: error.message
      });
    }
  });

  // Handle callback queries (button presses)
  orchestratorBot.on('callback_query', async (callbackQuery) => {
    try {
      // ─── ACCESS CONTROL ───
      if (callbackQuery.from && !isAuthorized(callbackQuery.from.id)) {
        logger.warn('Unauthorized callback blocked', {
          userId: callbackQuery.from.id,
          data: callbackQuery.data
        });
        await orchestratorBot.answerCallbackQuery(callbackQuery.id, {
          text: '⛔ Bạn không có quyền.',
          show_alert: true
        });
        return;
      }
      await handleCallbackQuery(callbackQuery);
    } catch (error) {
      logger.error('Error processing callback query', {
        callbackId: callbackQuery.id,
        error: error.message
      });
    }
  });

  logger.info('Orchestrator handlers configured');
}

// ============================================================================
// MESSAGE ROUTING
// ============================================================================

async function handleCommand(msg) {
  const { text, from, message_id, chat } = msg;

  logger.debug('Command received', { from: from.username, command: text });

  if (text === '/status') {
    await handleStatusCommand(msg);
  } else if (text === '/help') {
    await handleHelpCommand(msg);
  } else if (text === '/deploy') {
    await handleDeployCommand(msg);
  } else if (text === '/loginall') {
    await handleLoginAllCommand(msg);
  } else if (text === '/loginhost') {
    await handleLoginHostCommand(msg);
  } else if (text === '/verify') {
    await handleVerifyCommand(msg);
  } else if (text.startsWith('/login')) {
    await handleLoginCommand(msg);
  }
}

async function handleStatusCommand(msg) {
  try {
    const status = AgentManager.getStatus();
    const message =
      `<b>Router Status</b>\n\n` +
      `<b>Active Agents:</b> ${status.activeCount}/${status.maxCapacity}\n` +
      `<b>Queued Tasks:</b> ${status.queueLength}\n` +
      `<b>Can Accept More:</b> ${status.canAcceptMore ? 'Yes' : 'No'}\n\n` +
      `<b>Active Agents:</b>\n${
        status.agents.length > 0
          ? status.agents
              .map((a) => `• ${a.name} (${a.status})`)
              .join('\n')
          : 'None'
      }`;

    await orchestratorBot.sendMessage(msg.chat.id, message, {
      parse_mode: 'HTML'
    });
  } catch (error) {
    logger.error('Error in status command', { error: error.message });
    await orchestratorBot.sendMessage(msg.chat.id, 'Error fetching status');
  }
}

async function handleHelpCommand(msg) {
  const helpMessage =
    `<b>AI Agent Company — Commands</b>\n\n` +
    `<b>/status</b> - Show router status and active agents\n` +
    `<b>/help</b> - Show this help message\n` +
    `<b>/deploy</b> - Initiate deployment (requires owner approval)\n` +
    `<b>/login</b> - Hướng dẫn đăng nhập Claude (SSH)\n` +
    `<b>/loginhost</b> - Hướng dẫn login từ Mac terminal\n` +
    `<b>/verify</b> - Kiểm tra auth status\n\n` +
    `<b>How it works:</b>\n` +
    `Just send any message describing what you need.\n` +
    `The 🧠 <b>Orchestrator</b> will:\n` +
    `1. Analyze your request\n` +
    `2. Break it into sub-tasks\n` +
    `3. Dispatch to specialized agents\n` +
    `4. Coordinate completion\n\n` +
    `<b>Available Agents:</b>\n` +
    `architect, design, frontend, backend, smartcontract, researcher, tester, security, devops\n\n` +
    `<b>Example:</b> "Build a login page with email auth"\n` +
    `→ Orchestrator dispatches to architect → design + backend → frontend → tester → security`;

  await orchestratorBot.sendMessage(msg.chat.id, helpMessage, {
    parse_mode: 'HTML'
  });
}

async function handleDeployCommand(msg) {
  try {
    const userId = msg.from.id;

    // Check if user is owner
    if (userId.toString() !== OWNER_TELEGRAM_ID.toString()) {
      await orchestratorBot.sendMessage(
        msg.chat.id,
        'Only the owner can initiate deployment'
      );
      return;
    }

    const deploymentId = `deploy-${Date.now()}`;
    deploymentApprovals.set(deploymentId, {
      userId,
      timestamp: new Date().toISOString(),
      status: 'pending'
    });

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: '✅ [APPROVE]',
            callback_data: `deploy_approve:${deploymentId}`
          },
          {
            text: '❌ [REJECT]',
            callback_data: `deploy_reject:${deploymentId}`
          }
        ]
      ]
    };

    const deployMessage =
      `<b>Deployment Request</b>\n\n` +
      `<b>ID:</b> <code>${deploymentId}</code>\n` +
      `<b>Initiator:</b> ${msg.from.first_name}\n` +
      `<b>Timestamp:</b> ${new Date().toISOString()}\n\n` +
      `<b>HARD BLOCK:</b> Explicit approval required before deployment`;

    await orchestratorBot.sendMessage(msg.chat.id, deployMessage, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });

    logger.info('Deployment request initiated', { deploymentId });
  } catch (error) {
    logger.error('Error in deploy command', { error: error.message });
    await orchestratorBot.sendMessage(
      msg.chat.id,
      'Error initiating deployment'
    );
  }
}

// ============================================================================
// LOGIN COMMANDS — Trigger OAuth login for agent containers via Telegram
// ============================================================================

/**
 * /login — Show login instructions
 * In All-in-One mode, user SSHs into container and runs claude → /login
 */
async function handleLoginCommand(msg) {
  try {
    // Check if already logged in
    const { default: AgentRunner } = await import('./agent-runner.js');
    const isAuthed = await AgentRunner.checkAuth();

    if (isAuthed) {
      await orchestratorBot.sendMessage(msg.chat.id,
        `✅ Claude đã đăng nhập! Tất cả 10 agents sẵn sàng.\n\n` +
        `Gửi /verify để kiểm tra chi tiết.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    await orchestratorBot.sendMessage(msg.chat.id,
      `🔐 <b>Claude chưa đăng nhập</b>\n\n` +
      `<b>Bước 1:</b> SSH vào container:\n` +
      `<code>ssh root@localhost -p 2222</code>\n` +
      `Password: <code>aicompany</code>\n\n` +
      `<b>Bước 2:</b> Chạy Claude:\n` +
      `<code>claude</code>\n\n` +
      `<b>Bước 3:</b> Trong REPL, gõ:\n` +
      `<code>/login</code>\n` +
      `→ Chọn 1 (Claude account with subscription)\n` +
      `→ Click link OAuth → đăng nhập\n\n` +
      `<b>Bước 4:</b> Gửi /verify ở đây để kiểm tra.\n\n` +
      `💡 Login 1 lần — tất cả 10 agents dùng chung auth.`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    logger.error('Error in login command', { error: error.message });
    await orchestratorBot.sendMessage(msg.chat.id,
      `❌ Lỗi: ${error.message}`
    );
  }
}

/**
 * /loginall — In All-in-One mode, login once = all agents
 * Redirect to /login instructions
 */
async function handleLoginAllCommand(msg) {
  await orchestratorBot.sendMessage(msg.chat.id,
    `💡 <b>All-in-One mode:</b> Login 1 lần = tất cả 10 agents!\n\n` +
    `Dùng /login để xem hướng dẫn.`,
    { parse_mode: 'HTML' }
  );
}

/**
 * /loginhost — Hướng dẫn login từ Mac terminal (alternative)
 */
async function handleLoginHostCommand(msg) {
  try {
    await orchestratorBot.sendMessage(msg.chat.id,
      `🖥 <b>Login từ Mac Terminal</b>\n\n` +
      `Ngoài SSH, bạn cũng có thể login trên Mac:\n\n` +
      `<b>Bước 1:</b> Mở Terminal trên Mac\n` +
      `<b>Bước 2:</b> Chạy: <code>claude</code>\n` +
      `<b>Bước 3:</b> Gõ: <code>/login</code> → Chọn 1\n` +
      `<b>Bước 4:</b> Gửi /verify ở đây\n\n` +
      `💡 Auth tự động chia sẻ vào container qua volume mount.`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    logger.error('Error in loginhost command', { error: error.message });
    await orchestratorBot.sendMessage(msg.chat.id, `❌ Lỗi: ${error.message}`);
  }
}

/**
 * /verify — Verify Claude auth status
 * In All-in-One mode, just test the shared Claude auth once
 */
async function handleVerifyCommand(msg) {
  try {
    await orchestratorBot.sendMessage(msg.chat.id,
      `🔍 Đang kiểm tra Claude auth...`,
      { parse_mode: 'HTML' }
    );

    const { default: AgentRunner } = await import('./agent-runner.js');
    // Reset cache so we actually test
    AgentRunner._authVerified = false;
    const isAuthed = await AgentRunner.checkAuth();

    const validNames = ['orchestrator', 'architect', 'design', 'frontend', 'backend',
      'smartcontract', 'researcher', 'tester', 'security', 'devops'];

    if (isAuthed) {
      const agentList = validNames.map(n => `✅ ${n.toUpperCase()}`).join('\n');
      await orchestratorBot.sendMessage(msg.chat.id,
        `🔐 <b>Auth Status: 10/10</b>\n\n` +
        `${agentList}\n\n` +
        `🎉 Tất cả agents đã sẵn sàng! (shared auth)`,
        { parse_mode: 'HTML' }
      );
    } else {
      const agentList = validNames.map(n => `❌ ${n.toUpperCase()}`).join('\n');
      await orchestratorBot.sendMessage(msg.chat.id,
        `🔐 <b>Auth Status: 0/10</b>\n\n` +
        `${agentList}\n\n` +
        `💡 Dùng /login để xem hướng dẫn đăng nhập.`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (error) {
    logger.error('Error in verify command', { error: error.message });
    await orchestratorBot.sendMessage(msg.chat.id, `❌ Lỗi verify: ${error.message}`);
  }
}

/**
 * ALL user messages go to orchestrator first.
 * The orchestrator agent will:
 *   1. Analyze the request
 *   2. Decompose into sub-tasks
 *   3. POST to /dispatch endpoint for each sub-agent
 *   4. pg-boss picks them up and spawns sub-agents
 */
async function handleUserMessage(msg) {
  try {
    const { text, from, message_id, chat } = msg;
    const userPrompt = text.replace(/@\w+/g, '').trim();

    if (!userPrompt) return;

    logger.info('User message received → routing to orchestrator', {
      user: from.username,
      prompt: userPrompt.substring(0, 100)
    });

    // Create task for orchestrator
    const taskId = `task-${Date.now()}-orchestrator`;
    const taskFile = path.join(path.resolve(TASKS_DIR), `${taskId}.json`);

    const taskData = {
      id: taskId,
      agent: 'orchestrator',
      message: userPrompt,
      originalMessage: text,
      userId: from.id,
      username: from.username || 'unknown',
      chatId: chat.id,
      messageId: message_id,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    fs.writeFileSync(taskFile, JSON.stringify(taskData, null, 2));

    // Build enriched prompt for orchestrator with current system state
    const statusInfo = AgentManager.getStatus();
    const orchestratorPrompt = [
      `## User Request`,
      `From: @${from.username || from.first_name}`,
      `Message: ${userPrompt}`,
      `Chat ID: ${chat.id}`,
      ``,
      `## Current System State`,
      `Active agents: ${statusInfo.activeCount}/${statusInfo.maxCapacity}`,
      `Queued tasks: ${statusInfo.queueLength}`,
      `Available slots: ${statusInfo.maxCapacity - statusInfo.activeCount}`,
      ``,
      `## Instructions`,
      `Analyze this request and decompose it into sub-tasks.`,
      `For each sub-task, dispatch it by calling the local queue API:`,
      ``,
      `curl -s -X POST http://localhost:${DASHBOARD_WS_PORT}/dispatch \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"agent":"<role>","task_id":"task-<timestamp>-<role>","prompt":"<detailed instructions>","context":"<optional context>","depends_on":[],"chatId":${chat.id}}'`,
      ``,
      `Available roles: orchestrator, architect, design, frontend, backend, smartcontract, researcher, tester, security, devops`,
      ``,
      `IMPORTANT: Include "chatId": ${chat.id} in every dispatch call so completion notifications reach Telegram.`,
      ``,
      `Respect dependency rules: architect first for new features, security last.`,
      `Max ${statusInfo.maxCapacity - statusInfo.activeCount} agents can start now (${statusInfo.activeCount} already active).`,
    ].join('\n');

    // Enqueue orchestrator task — use pg-boss if ready, otherwise direct dispatch
    let started = false;
    if (queueReady) {
      try {
        const { scheduleTask } = await import('../lib/queue.js');
        await scheduleTask('orchestrator', {
          taskId,
          input: orchestratorPrompt,
          chatId: chat.id,
          messageId: message_id,
        });
        started = true;
        logger.info('Task enqueued via pg-boss', { taskId });
      } catch (err) {
        logger.warn('pg-boss enqueue failed, falling back to direct dispatch', { error: err.message });
        started = await AgentManager.startAgent('orchestrator', taskId, orchestratorPrompt);
      }
    } else {
      // Queue not ready — dispatch directly
      logger.info('Queue not ready, using direct agent dispatch', { taskId });
      started = await AgentManager.startAgent('orchestrator', taskId, orchestratorPrompt);
    }

    const response = started
      ? `🧠 Orchestrator received your task and is analyzing it...`
      : `⏳ Orchestrator is busy. Your task has been queued.`;

    await orchestratorBot.sendMessage(chat.id, response, {
      reply_to_message_id: message_id
    });

    broadcastDashboardUpdate({
      type: 'task_created',
      taskId,
      agent: 'orchestrator',
      status: 'pending'
    });
  } catch (error) {
    logger.error('Error routing message to orchestrator', { error: error.message });
    try {
      await orchestratorBot.sendMessage(
        msg.chat.id,
        '❌ Error processing your request. Please try again.'
      );
    } catch {}
  }
}

async function handleCallbackQuery(callbackQuery) {
  const { id, data, from, message } = callbackQuery;

  try {
    await orchestratorBot.answerCallbackQuery(id);

    if (data.startsWith('deploy_')) {
      await handleDeploymentCallback(data, from, message);
    } else if (data.startsWith('skill_')) {
      await handleSkillCallback(data, from, message);
    } else {
      logger.warn('Unknown callback data', { data });
    }
  } catch (error) {
    logger.error('Error handling callback', { error: error.message });
  }
}

async function handleDeploymentCallback(callbackData, user, message) {
  try {
    const [action, deploymentId] = callbackData.split(':');
    const userId = user.id;

    // Verify owner
    if (userId.toString() !== OWNER_TELEGRAM_ID.toString()) {
      await orchestratorBot.answerCallbackQuery(
        message.message_id,
        'Only owner can approve deployment'
      );
      return;
    }

    const deployment = deploymentApprovals.get(deploymentId);
    if (!deployment) {
      logger.warn('Deployment not found', { deploymentId });
      return;
    }

    if (action === 'deploy_approve') {
      deployment.status = 'approved';
      deployment.approvedAt = new Date().toISOString();
      deployment.approvedBy = user.id;

      await orchestratorBot.editMessageText(
        `<b>Deployment Approved</b>\n` +
          `Status: APPROVED\n` +
          `Approved by: ${user.first_name}\n` +
          `Timestamp: ${new Date().toISOString()}`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id,
          parse_mode: 'HTML'
        }
      );

      logger.success('Deployment approved', { deploymentId });

      broadcastDashboardUpdate({
        type: 'deployment_approved',
        deploymentId
      });
    } else if (action === 'deploy_reject') {
      deployment.status = 'rejected';
      deployment.rejectedAt = new Date().toISOString();
      deployment.rejectedBy = user.id;

      await orchestratorBot.editMessageText(
        `<b>Deployment Rejected</b>\n` +
          `Status: REJECTED\n` +
          `Rejected by: ${user.first_name}\n` +
          `Timestamp: ${new Date().toISOString()}`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id,
          parse_mode: 'HTML'
        }
      );

      logger.warn('Deployment rejected', { deploymentId });
    }
  } catch (error) {
    logger.error('Error handling deployment callback', { error: error.message });
  }
}

async function handleSkillCallback(callbackData, user, message) {
  try {
    const [action, ...parts] = callbackData.split(':');
    const requestId = parts.join(':');

    const result = await skillHandler.handleApprovalCallback(
      message.message_id,
      requestId,
      action.replace('skill_', ''),
      user.id
    );

    if (!result.success) {
      await orchestratorBot.answerCallbackQuery(
        message.id,
        result.message || 'Error processing request',
        true
      );
      return;
    }

    // Edit message to show result
    const resultMessage =
      `<b>Skill Request: ${result.skillName || 'Unknown'}</b>\n\n` +
      `<b>Status:</b> ${action.replace('skill_', '').toUpperCase()}\n` +
      `<b>Message:</b> ${result.message}\n` +
      `<b>Processed by:</b> ${user.first_name}\n` +
      `<b>Timestamp:</b> ${new Date().toISOString()}`;

    await orchestratorBot.editMessageText(resultMessage, {
      chat_id: message.chat.id,
      message_id: message.message_id,
      parse_mode: 'HTML'
    });

    logger.info('Skill callback processed', {
      requestId,
      action,
      user: user.username
    });
  } catch (error) {
    logger.error('Error handling skill callback', { error: error.message });
  }
}

// ============================================================================
// TASK WATCHING
// ============================================================================

async function startTaskWatching() {
  try {
    const tasksPath = path.resolve(TASKS_DIR);

    tasksWatcher = chokidar.watch(path.join(tasksPath, '*.json'), {
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100
      }
    });

    tasksWatcher
      .on('change', (filePath) => {
        handleTaskUpdate(filePath);
      })
      .on('error', (error) => {
        logger.error('Tasks watcher error', { error: error.message });
      });

    logger.success('Tasks watcher started', { path: tasksPath });
  } catch (error) {
    logger.error('Failed to start task watcher', { error: error.message });
  }
}

async function handleTaskUpdate(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const task = JSON.parse(content);

    logger.debug('Task update detected', { taskId: task.id, status: task.status });

    // Update dashboard
    broadcastDashboardUpdate({
      type: 'task_updated',
      taskId: task.id,
      status: task.status,
      results: task.results || null
    });

    // Send Telegram notification if completed
    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'error'
    ) {
      await notifyTaskCompletion(task);

      // Stop agent
      if (task.agentId) {
        await AgentManager.stopAgent(task.agentId);
      }
    }
  } catch (error) {
    logger.error('Error handling task update', {
      file: filePath,
      error: error.message
    });
  }
}

async function notifyTaskCompletion(task) {
  try {
    const statusEmoji = {
      completed: '✅',
      failed: '❌',
      error: '⚠️'
    };

    const emoji = statusEmoji[task.status] || '❓';
    let message =
      `${emoji} <b>Task ${task.status.toUpperCase()}</b>\n\n` +
      `<b>Task ID:</b> <code>${task.id}</code>\n` +
      `<b>Agent:</b> ${task.agent}\n` +
      `<b>Status:</b> ${task.status}\n`;

    if (task.results) {
      const resultPreview =
        typeof task.results === 'string'
          ? task.results.substring(0, 200)
          : JSON.stringify(task.results).substring(0, 200);
      message += `<b>Results:</b> <code>${resultPreview}...</code>\n`;
    }

    message += `<b>Completed:</b> ${new Date(task.completedAt || Date.now()).toISOString()}`;

    await orchestratorBot.sendMessage(task.chatId, message, {
      parse_mode: 'HTML',
      reply_to_message_id: task.messageId
    });

    logger.info('Task completion notification sent', {
      taskId: task.id,
      status: task.status
    });
  } catch (error) {
    logger.error('Error sending task completion notification', {
      taskId: task.id,
      error: error.message
    });
  }
}

// ============================================================================
// WEBSOCKET DASHBOARD
// ============================================================================

function initWebSocketServer() {
  try {
    expressApp = express();

    // Health check endpoint
    expressApp.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        agents: AgentManager.getStatus()
      });
    });

    expressApp.get('/status', (req, res) => {
      res.json({
        router: {
          started: true,
          timestamp: new Date().toISOString()
        },
        agents: AgentManager.getStatus(),
        deployments: Array.from(deploymentApprovals.entries()).map(
          ([id, data]) => ({
            id,
            ...data
          })
        )
      });
    });

    // POST /dispatch — local endpoint for orchestrator to enqueue sub-tasks
    // Replaces the old file-based dispatch (tasks/dispatch/*.json → chokidar)
    expressApp.use(express.json());
    expressApp.post('/dispatch', async (req, res) => {
      try {
        const { agent, task_id, prompt, context, depends_on, chatId } = req.body;

        if (!agent || !task_id || !prompt) {
          return res.status(400).json({ error: 'agent, task_id, prompt required' });
        }

        let fullPrompt = prompt;
        if (context && context.length < 500) {
          fullPrompt = `## Context\n${context}\n\n## Task\n${prompt}`;
        }

        // Try pg-boss first, fall back to direct dispatch
        let dispatched = false;
        if (queueReady) {
          try {
            const { scheduleTask } = await import('../lib/queue.js');
            await scheduleTask(agent, {
              taskId: task_id,
              input: prompt,
              context: context || null,
              chatId: chatId || null,
              dependsOn: depends_on || [],
            });
            dispatched = true;
            logger.info('Sub-task dispatched via pg-boss', { agent, task_id });
          } catch (err) {
            logger.warn('pg-boss dispatch failed, falling back to direct', { agent, error: err.message });
          }
        }

        if (!dispatched) {
          await AgentManager.startAgent(agent, task_id, fullPrompt);
          logger.info('Sub-task dispatched directly', { agent, task_id });
        }

        res.json({ ok: true, task_id });
      } catch (err) {
        logger.error('Dispatch endpoint error', { error: err.message });
        res.status(500).json({ error: err.message });
      }
    });

    httpServer = createServer(expressApp);

    wsServer = new WebSocketServer({ server: httpServer });

    wsServer.on('connection', (ws) => {
      logger.info('Dashboard client connected');
      dashboardClients.add(ws);

      // Send initial status
      ws.send(
        JSON.stringify({
          type: 'connected',
          status: AgentManager.getStatus(),
          timestamp: new Date().toISOString()
        })
      );

      ws.on('close', () => {
        dashboardClients.delete(ws);
        logger.info('Dashboard client disconnected');
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error', { error: error.message });
      });
    });

    httpServer.listen(DASHBOARD_WS_PORT, () => {
      logger.success(`WebSocket server listening on port ${DASHBOARD_WS_PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize WebSocket server', {
      error: error.message
    });
  }
}

function broadcastDashboardUpdate(data) {
  const message = JSON.stringify({
    type: 'update',
    data,
    timestamp: new Date().toISOString()
  });

  dashboardClients.forEach((client) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      client.send(message);
    }
  });
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

async function gracefulShutdown() {
  logger.info('Graceful shutdown initiated');

  // Stop watchers
  if (tasksWatcher) {
    await tasksWatcher.close();
    logger.info('Tasks watcher stopped');
  }

  if (skillHandler) {
    skillHandler.stopWatching();
  }

  // Stop pg-boss queue
  await stopQueue();

  // Stop polling
  if (orchestratorBot) {
    orchestratorBot.stopPolling();
    logger.info('Orchestrator polling stopped');
  }

  // Close WebSocket server
  if (wsServer) {
    wsServer.close();
    logger.info('WebSocket server closed');
  }

  if (httpServer) {
    httpServer.close();
    logger.info('HTTP server closed');
  }

  // Stop all agents
  const agents = AgentManager.getActiveAgents();
  for (const agent of agents) {
    await AgentManager.stopAgent(agent.id);
  }

  logger.success('Graceful shutdown completed');
  process.exit(0);
}

// ============================================================================
// PG-BOSS QUEUE HANDLERS
// ============================================================================

const AGENT_ROLES = [
  'orchestrator', 'architect', 'design', 'frontend', 'backend',
  'smartcontract', 'researcher', 'tester', 'security', 'devops'
];

async function registerQueueHandlers() {
  const { onTask } = await import('../lib/queue.js');

  for (const role of AGENT_ROLES) {
    await onTask(role, async (job) => {
      const { taskId, input, chatId, messageId, context, dependsOn } = job.data;
      logger.info('pg-boss job received', { role, taskId, jobId: job.id });

      let fullPrompt = input || '';
      if (context && context.length < 500) {
        fullPrompt = `## Context\n${context}\n\n## Task\n${input}`;
      }

      // Start the agent via AgentManager
      await AgentManager.startAgent(role, taskId, fullPrompt);
    });
  }
}

// ============================================================================
// MAIN
// ============================================================================

// Flag: true once pg-boss queue + handlers are fully ready
let queueReady = false;

async function main() {
  try {
    logger.success('========================================');
    logger.success('Telegram Message Router Starting');
    logger.success('========================================');

    // Validate configuration
    await validateConfiguration();

    // Initialize directories
    initDirectories();

    // Start pg-boss queue BEFORE bots (prevents race condition where
    // a Telegram message arrives before workers are listening)
    if (process.env.DATABASE_URL) {
      try {
        await startQueue(process.env.DATABASE_URL);
        await registerQueueHandlers();
        queueReady = true;
        logger.success('pg-boss queue started and handlers registered');
      } catch (err) {
        logger.error('pg-boss queue failed to start — will use direct dispatch', { error: err.message });
      }
    } else {
      logger.warn('DATABASE_URL not set — using direct agent dispatch');
    }

    // Initialize bots (starts Telegram polling — must happen AFTER queue is ready)
    await initBots();

    // Initialize skill handler
    skillHandler = new SkillHandler(orchestratorBot);
    await skillHandler.startWatching();

    // Start task watching
    await startTaskWatching();

    // Initialize WebSocket server
    initWebSocketServer();

    // Setup signal handlers
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);

    logger.success('========================================');
    logger.success('Router fully initialized and ready');
    logger.success(`Max concurrent agents: ${MAX_WORK_AGENTS}`);
    logger.success(`Telegram group: ${TELEGRAM_GROUP_ID}`);
    logger.success(`Queue: ${queueReady ? 'pg-boss' : 'direct dispatch'}`);
    logger.success(`Dashboard port: ${DASHBOARD_WS_PORT}`);
    logger.success('========================================');
  } catch (error) {
    logger.error('Fatal error during initialization', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

main();
