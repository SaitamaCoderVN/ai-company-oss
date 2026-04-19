/**
 * Hook Engine - Central hook execution engine for AI Agent Company
 * Supports PreToolUse, PostToolUse, SessionStart, SessionEnd, PreCommit, PostCommit,
 * TaskAssigned, and TaskCompleted events
 *
 * Enhancements:
 * - Hook profiles (minimal/standard/strict)
 * - Runtime hook flag support (ECC_DISABLED_HOOKS, ECC_HOOK_PROFILE env vars)
 * - Per-agent hook configuration
 * - Cost tracking integration
 * - Session lifecycle tracking
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class HookEngine extends EventEmitter {
  constructor(configPath = null, options = {}) {
    super();
    this.hooks = {};
    this.eventHandlers = {};
    this.config = {};
    this.activeHooks = {};
    this.executionHistory = [];
    this.maxHistorySize = 1000;
    this.sessionId = options.sessionId || this.generateSessionId();
    this.sessionStartTime = Date.now();
    this.agentId = options.agentId || 'default';
    this.hookProfile = this.getHookProfile();
    this.disabledHooks = this.getDisabledHooks();

    if (configPath) {
      this.loadConfig(configPath);
    }

    this.initializeEventTypes();
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get hook profile from environment (minimal/standard/strict)
   */
  getHookProfile() {
    const profile = (process.env.ECC_HOOK_PROFILE || 'standard').toLowerCase();
    return ['minimal', 'standard', 'strict'].includes(profile) ? profile : 'standard';
  }

  /**
   * Get disabled hooks from environment
   */
  getDisabledHooks() {
    const disabled = process.env.ECC_DISABLED_HOOKS || '';
    if (!disabled.trim()) return new Set();
    return new Set(disabled.split(',').map(h => h.trim().toLowerCase()).filter(Boolean));
  }

  /**
   * Check if hook is enabled based on profile and disabled list
   */
  isHookEnabled(hookId, allowedProfiles = ['standard', 'strict']) {
    const id = String(hookId || '').toLowerCase();
    if (!id) return true;

    // Check if explicitly disabled
    if (this.disabledHooks.has(id)) return false;

    // Check if profile allows this hook
    return allowedProfiles.includes(this.hookProfile);
  }

  /**
   * Initialize supported event types
   */
  initializeEventTypes() {
    this.eventTypes = {
      PRE_TOOL_USE: 'PreToolUse',
      POST_TOOL_USE: 'PostToolUse',
      SESSION_START: 'SessionStart',
      SESSION_END: 'SessionEnd',
      PRE_COMMIT: 'PreCommit',
      POST_COMMIT: 'PostCommit',
      TASK_ASSIGNED: 'TaskAssigned',
      TASK_COMPLETED: 'TaskCompleted',
    };

    // Initialize empty event handlers
    Object.values(this.eventTypes).forEach(eventType => {
      this.eventHandlers[eventType] = [];
    });
  }

  /**
   * Load hook configuration from JSON file
   */
  loadConfig(configPath) {
    try {
      const configData = fs.readFileSync(configPath, 'utf-8');
      this.config = JSON.parse(configData);
      console.log(`[HookEngine] Configuration loaded from ${configPath}`);
    } catch (error) {
      console.error(`[HookEngine] Failed to load configuration: ${error.message}`);
      this.config = { hooks: {}, globalTimeout: 5000 };
    }
  }

  /**
   * Register a hook for an event type
   * Hook function signature: (context) => Promise<result>
   * context = { agent, event, data, timestamp, hookId, sessionId, agentId }
   * result = { block?: boolean, reason?: string, modify?: boolean, data?: any }
   *
   * Options: { allowedProfiles: ['standard', 'strict'] }
   */
  registerHook(eventType, hookId, hookFn, priority = 100, timeout = 5000, options = {}) {
    if (!this.eventTypes[Object.keys(this.eventTypes).find(k => this.eventTypes[k] === eventType)] &&
        !Object.values(this.eventTypes).includes(eventType)) {
      throw new Error(`Unknown event type: ${eventType}`);
    }

    const allowed = options.allowedProfiles || ['standard', 'strict'];
    const enabled = this.isHookEnabled(hookId, allowed);

    const hookEntry = {
      id: hookId,
      fn: hookFn,
      priority,
      timeout,
      enabled,
      executionCount: 0,
      avgExecutionTime: 0,
      totalExecutionTime: 0,
      profile: this.hookProfile,
      allowedProfiles: allowed,
    };

    if (!this.eventHandlers[eventType]) {
      this.eventHandlers[eventType] = [];
    }

    this.eventHandlers[eventType].push(hookEntry);
    // Sort by priority (higher first)
    this.eventHandlers[eventType].sort((a, b) => b.priority - a.priority);

    if (!this.activeHooks[eventType]) {
      this.activeHooks[eventType] = [];
    }
    this.activeHooks[eventType].push(hookId);

    const status = enabled ? 'enabled' : 'disabled (profile/env)';
    console.log(`[HookEngine] Hook registered: ${hookId} for event ${eventType} (priority: ${priority}, ${status})`);

    return hookId;
  }

  /**
   * Execute hooks for an event
   * Returns: { blocked: boolean, blockReason: string, data: modifiedData, results: hookResults }
   */
  async executeHooks(eventType, context = {}) {
    const execution = {
      timestamp: new Date(),
      eventType,
      hookResults: [],
      blocked: false,
      blockReason: null,
      modifiedData: context.data,
      totalExecutionTime: 0,
      sessionId: this.sessionId,
      agentId: this.agentId,
    };

    const hooks = this.eventHandlers[eventType] || [];

    if (hooks.length === 0) {
      return {
        blocked: false,
        blockReason: null,
        data: context.data,
        results: [],
      };
    }

    for (const hook of hooks) {
      if (!hook.enabled) continue;

      const hookContext = {
        ...context,
        hookId: hook.id,
        timestamp: execution.timestamp,
        sessionId: this.sessionId,
        agentId: this.agentId,
      };

      let hookResult = null;
      let executionTime = 0;

      try {
        const startTime = Date.now();

        // Execute with timeout
        hookResult = await this.executeWithTimeout(
          hook.fn(hookContext),
          hook.timeout,
          hook.id
        );

        executionTime = Date.now() - startTime;

        // Update hook statistics
        hook.executionCount++;
        hook.avgExecutionTime = (hook.avgExecutionTime * (hook.executionCount - 1) + executionTime) / hook.executionCount;
        hook.totalExecutionTime += executionTime;

        // Check if hook blocks execution
        if (hookResult && hookResult.block) {
          execution.blocked = true;
          execution.blockReason = hookResult.reason || 'Hook blocked execution';
          execution.hookResults.push({
            hookId: hook.id,
            status: 'blocked',
            reason: hookResult.reason,
            executionTime,
          });
          break;
        }

        // Check if hook modifies data
        if (hookResult && hookResult.modify && hookResult.data !== undefined) {
          execution.modifiedData = hookResult.data;
        }

        execution.hookResults.push({
          hookId: hook.id,
          status: 'success',
          executionTime,
          result: hookResult,
        });
      } catch (error) {
        console.error(`[HookEngine] Error executing hook ${hook.id}: ${error.message}`);
        execution.hookResults.push({
          hookId: hook.id,
          status: 'error',
          error: error.message,
        });
      }

      execution.totalExecutionTime += executionTime;
    }

    // Store execution history
    this.recordExecution(execution);

    return {
      blocked: execution.blocked,
      blockReason: execution.blockReason,
      data: execution.modifiedData,
      results: execution.hookResults,
    };
  }

  /**
   * Execute function with timeout
   */
  executeWithTimeout(promise, timeout, hookId) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Hook timeout: ${hookId} exceeded ${timeout}ms`)), timeout)
      ),
    ]);
  }

  /**
   * Record execution in history
   */
  recordExecution(execution) {
    this.executionHistory.push(execution);
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift();
    }
  }

  /**
   * Enable/disable a hook
   */
  setHookEnabled(hookId, enabled) {
    let found = false;
    Object.values(this.eventHandlers).forEach(hooks => {
      const hook = hooks.find(h => h.id === hookId);
      if (hook) {
        hook.enabled = enabled;
        found = true;
      }
    });
    if (found) {
      console.log(`[HookEngine] Hook ${hookId} ${enabled ? 'enabled' : 'disabled'}`);
    }
    return found;
  }

  /**
   * Get hook statistics
   */
  getHookStats(hookId) {
    for (const hooks of Object.values(this.eventHandlers)) {
      const hook = hooks.find(h => h.id === hookId);
      if (hook) {
        return {
          id: hook.id,
          enabled: hook.enabled,
          executionCount: hook.executionCount,
          avgExecutionTime: hook.avgExecutionTime.toFixed(2),
        };
      }
    }
    return null;
  }

  /**
   * Get all active hooks for an event type
   */
  getActiveHooks(eventType) {
    return (this.eventHandlers[eventType] || [])
      .filter(h => h.enabled)
      .map(h => ({
        id: h.id,
        priority: h.priority,
        timeout: h.timeout,
        executionCount: h.executionCount,
      }));
  }

  /**
   * Get execution history with optional filtering
   */
  getExecutionHistory(eventType = null, limit = 100) {
    let history = this.executionHistory;
    if (eventType) {
      history = history.filter(e => e.eventType === eventType);
    }
    return history.slice(-limit);
  }

  /**
   * Clear execution history
   */
  clearExecutionHistory() {
    this.executionHistory = [];
  }

  /**
   * Remove a hook
   */
  removeHook(hookId) {
    let removed = false;
    Object.values(this.eventHandlers).forEach(hooks => {
      const index = hooks.findIndex(h => h.id === hookId);
      if (index !== -1) {
        hooks.splice(index, 1);
        removed = true;
      }
    });
    if (removed) {
      console.log(`[HookEngine] Hook ${hookId} removed`);
    }
    return removed;
  }

  /**
   * Get detailed engine status
   */
  getStatus() {
    const status = {
      sessionId: this.sessionId,
      agentId: this.agentId,
      hookProfile: this.hookProfile,
      disabledHooks: Array.from(this.disabledHooks),
      totalHooks: 0,
      totalEnabled: 0,
      eventTypeStats: {},
      historySize: this.executionHistory.length,
      sessionDuration: Date.now() - this.sessionStartTime,
    };

    Object.entries(this.eventHandlers).forEach(([eventType, hooks]) => {
      status.totalHooks += hooks.length;
      const enabledCount = hooks.filter(h => h.enabled).length;
      status.totalEnabled += enabledCount;
      status.eventTypeStats[eventType] = {
        total: hooks.length,
        enabled: enabledCount,
        hooks: hooks.map(h => ({
          id: h.id,
          enabled: h.enabled,
          executionCount: h.executionCount,
          avgExecutionTime: h.avgExecutionTime.toFixed(2),
          totalExecutionTime: h.totalExecutionTime,
        })),
      };
    });

    return status;
  }

  /**
   * Get session metadata
   */
  getSessionMetadata() {
    return {
      sessionId: this.sessionId,
      agentId: this.agentId,
      startTime: this.sessionStartTime,
      endTime: Date.now(),
      duration: Date.now() - this.sessionStartTime,
      hookProfile: this.hookProfile,
      totalHooksExecuted: this.executionHistory.reduce((sum, ex) => sum + ex.hookResults.length, 0),
      totalExecutionTime: this.executionHistory.reduce((sum, ex) => sum + ex.totalExecutionTime, 0),
    };
  }
}

module.exports = HookEngine;
