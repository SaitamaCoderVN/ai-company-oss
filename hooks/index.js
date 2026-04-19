/**
 * Hooks Initialization - Initialize and manage all hooks for the agent system
 */

const HookEngine = require('./hook-engine');
const SecurityHooks = require('./security-hooks');
const QualityHooks = require('./quality-hooks');
const MemoryHooks = require('./memory-hooks');
const path = require('path');

class HooksInitializer {
  constructor(configPath = null, memoryPath = null) {
    this.configPath = configPath || path.join(__dirname, 'config.json');
    this.memoryPath = memoryPath || path.join(process.cwd(), 'memory');

    this.hookEngine = new HookEngine(this.configPath);
    this.securityHooks = new SecurityHooks();
    this.qualityHooks = new QualityHooks();
    this.memoryHooks = new MemoryHooks(this.memoryPath);
  }

  /**
   * Initialize all hooks
   */
  initializeHooks() {
    console.log('[HooksInitializer] Starting initialization...');

    // Register security hooks
    console.log('[HooksInitializer] Registering security hooks...');
    this.securityHooks.createAllHooks(this.hookEngine);

    // Register quality hooks
    console.log('[HooksInitializer] Registering quality hooks...');
    this.qualityHooks.createAllHooks(this.hookEngine);

    // Register memory hooks
    console.log('[HooksInitializer] Registering memory hooks...');
    this.memoryHooks.createAllHooks(this.hookEngine);

    console.log('[HooksInitializer] Initialization complete');
    this.logStatus();
  }

  /**
   * Initialize hooks for a specific agent
   */
  initializeAgentHooks(agentName) {
    const config = this.hookEngine.config;
    if (!config.agents || !config.agents[agentName]) {
      console.warn(`[HooksInitializer] No configuration found for agent: ${agentName}`);
      return;
    }

    const agentConfig = config.agents[agentName];
    if (!agentConfig.enabled) {
      console.log(`[HooksInitializer] Agent ${agentName} has hooks disabled`);
      return;
    }

    console.log(`[HooksInitializer] Initializing hooks for agent: ${agentName}`);
    const activeHooks = agentConfig.activeHooks || [];
    console.log(`[HooksInitializer] Active hooks for ${agentName}: ${activeHooks.join(', ')}`);
  }

  /**
   * Get hook engine instance
   */
  getHookEngine() {
    return this.hookEngine;
  }

  /**
   * Log initialization status
   */
  logStatus() {
    const status = this.hookEngine.getStatus();
    console.log(`\n[HooksInitializer] Status:`);
    console.log(`  Total hooks: ${status.totalHooks}`);
    console.log(`  Total enabled: ${status.totalEnabled}`);
    console.log(`  Event types configured: ${Object.keys(status.eventTypeStats).length}`);

    for (const [eventType, stats] of Object.entries(status.eventTypeStats)) {
      if (stats.total > 0) {
        console.log(`    ${eventType}: ${stats.enabled}/${stats.total} enabled`);
      }
    }
    console.log('');
  }

  /**
   * Async flush on shutdown
   */
  async shutdown() {
    console.log('[HooksInitializer] Shutting down hooks system...');
    await this.memoryHooks.flushObservations();
    console.log('[HooksInitializer] Shutdown complete');
  }
}

module.exports = HooksInitializer;
