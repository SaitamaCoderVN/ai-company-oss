import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import AgentRunner from './agent-runner.js';
import WorkspaceManager from './workspace-manager.js';

const STATUS_FILE = path.resolve('../tasks/agent-status.json');
const MAX_WORK_AGENTS = parseInt(process.env.MAX_WORK_AGENTS || '3', 10);

/**
 * AgentManager — High-level agent lifecycle management
 *
 * Delegates to AgentRunner for Claude Code process spawning
 * and WorkspaceManager for git worktree isolation.
 */
class AgentManager {
  constructor() {
    this.initStatusFile();
  }

  initStatusFile() {
    try {
      if (!fs.existsSync(STATUS_FILE)) {
        const dir = path.dirname(STATUS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const initialStatus = {
          timestamp: new Date().toISOString(),
          system: { max_active: MAX_WORK_AGENTS, total_agents: 10, status: 'initialized' },
          agents: {}
        };

        const agentNames = ['orchestrator', 'architect', 'design', 'frontend', 'backend',
          'smartcontract', 'researcher', 'tester', 'security', 'devops'];

        for (const name of agentNames) {
          initialStatus.agents[name] = { status: 'idle', task: null };
        }

        fs.writeFileSync(STATUS_FILE, JSON.stringify(initialStatus, null, 2));
        logger.info('Initialized agent-status.json');
      }
    } catch (error) {
      logger.error('Failed to initialize status file', { error: error.message });
    }
  }

  /**
   * Start an agent to work on a task
   *
   * @param {string} agentName - Agent name (e.g. "frontend", "backend")
   * @param {string} taskId - Unique task identifier
   * @param {string} prompt - The task description / user message
   * @returns {Promise<boolean>} - Whether the agent was started (vs queued)
   */
  async startAgent(agentName, taskId, prompt) {
    // Normalize agent name (ARCHITECT → architect)
    const normalized = agentName.toLowerCase().replace(/^agent_/, '');
    const validNames = ['orchestrator', 'architect', 'design', 'frontend', 'backend',
      'smartcontract', 'researcher', 'tester', 'security', 'devops'];

    const resolvedName = validNames.find(n => n === normalized) || normalized;

    logger.info('Starting agent', { agent: resolvedName, taskId });

    // Fire and forget — AgentRunner handles capacity/queueing internally
    AgentRunner.runTask(resolvedName, taskId, prompt || `Execute task ${taskId}`)
      .then(result => {
        if (result.success) {
          logger.success('Agent completed task', {
            agent: resolvedName, taskId,
            pr: result.pr || 'none'
          });
        } else {
          logger.error('Agent task failed', {
            agent: resolvedName, taskId,
            error: result.error?.substring(0, 200)
          });
        }
      })
      .catch(error => {
        logger.error('Agent runner error', { agent: resolvedName, error: error.message });
      });

    return !AgentRunner.getStatus().canAcceptMore ? false : true;
  }

  /**
   * Stop a specific agent
   */
  async stopAgent(agentName) {
    const normalized = agentName.toLowerCase();
    return AgentRunner.stopAgent(normalized);
  }

  /**
   * Get comprehensive status
   */
  getStatus() {
    const runnerStatus = AgentRunner.getStatus();
    return {
      activeCount: Object.keys(runnerStatus.running).length,
      maxCapacity: MAX_WORK_AGENTS,
      agents: Object.entries(runnerStatus.running).map(([name, info]) => ({
        id: name,
        name,
        status: 'running',
        taskId: info.taskId,
        startTime: info.startTime,
        pid: info.pid
      })),
      queueLength: runnerStatus.queueLength,
      canAcceptMore: runnerStatus.canAcceptMore,
      workspace: WorkspaceManager.getStatus()
    };
  }

  getActiveAgents() {
    return AgentRunner.getStatus().running;
  }

  isAtCapacity() {
    return !AgentRunner.getStatus().canAcceptMore;
  }

  getQueueLength() {
    return AgentRunner.getStatus().queueLength;
  }
}

export default new AgentManager();
