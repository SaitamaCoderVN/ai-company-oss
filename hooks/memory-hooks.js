/**
 * Memory Hooks - Capture and manage agent memory and observations
 */

const fs = require('fs');
const path = require('path');

class MemoryHooks {
  constructor(memoryPath = null) {
    this.memoryPath = memoryPath || path.join(process.cwd(), 'memory');
    this.observationQueue = [];
    this.sessionMemory = {};
    this.maxObservationSize = 1000; // Max observations before flushing
  }

  /**
   * PostToolUse hook - Capture observation asynchronously
   */
  getPostToolUseObservationCaptureHook() {
    return async (context) => {
      const { agent, data, event } = context;

      try {
        // Queue observation for async processing
        const observation = {
          timestamp: new Date().toISOString(),
          agent,
          event,
          toolName: data.toolName || 'unknown',
          result: {
            success: data.success !== false,
            summary: this.summarizeData(data),
          },
        };

        this.observationQueue.push(observation);

        // Asynchronously flush if queue is getting large
        if (this.observationQueue.length >= this.maxObservationSize) {
          setImmediate(() => this.flushObservations());
        }

        return {
          modify: true,
          data: {
            ...data,
            observationCaptured: true,
            observationId: this.generateObservationId(),
          },
        };
      } catch (error) {
        console.error(`[MemoryHook] Error capturing observation: ${error.message}`);
        return null;
      }
    };
  }

  /**
   * SessionStart hook - Inject relevant memory context
   */
  getSessionStartMemoryInjectionHook() {
    return async (context) => {
      const { agent, data } = context;

      try {
        const agentMemoryPath = path.join(this.memoryPath, agent);
        let contextData = {
          recentObservations: [],
          agentProfile: {},
          successPatterns: [],
        };

        // Load recent observations
        if (fs.existsSync(agentMemoryPath)) {
          const observationsFile = path.join(agentMemoryPath, 'observations.json');
          if (fs.existsSync(observationsFile)) {
            const content = fs.readFileSync(observationsFile, 'utf-8');
            const observations = JSON.parse(content);
            contextData.recentObservations = observations.slice(-10); // Last 10
          }

          // Load agent profile
          const profileFile = path.join(agentMemoryPath, 'profile.json');
          if (fs.existsSync(profileFile)) {
            const profile = JSON.parse(fs.readFileSync(profileFile, 'utf-8'));
            contextData.agentProfile = profile;
          }

          // Load success patterns
          const patternsFile = path.join(agentMemoryPath, 'success-patterns.json');
          if (fs.existsSync(patternsFile)) {
            const patterns = JSON.parse(fs.readFileSync(patternsFile, 'utf-8'));
            contextData.successPatterns = patterns;
          }
        }

        return {
          modify: true,
          data: {
            ...data,
            memoryContext: contextData,
          },
        };
      } catch (error) {
        console.error(`[MemoryHook] Error injecting memory context: ${error.message}`);
        return null;
      }
    };
  }

  /**
   * SessionEnd hook - Compile and flush memory
   */
  getSessionEndMemoryFlushHook() {
    return async (context) => {
      const { agent, data } = context;

      try {
        // Flush any pending observations
        await this.flushObservations();

        // Compile session summary
        const sessionSummary = {
          timestamp: new Date().toISOString(),
          agent,
          duration: data.duration || 0,
          tasksCompleted: data.tasksCompleted || 0,
          observationsCount: this.observationQueue.length,
          successRate: data.successRate || 0,
        };

        // Store session summary
        const agentMemoryPath = path.join(this.memoryPath, agent);
        const sessionsFile = path.join(agentMemoryPath, 'sessions.json');
        this.appendToJsonFile(sessionsFile, sessionSummary);

        return {
          modify: true,
          data: {
            ...data,
            memorySummaryFlushed: true,
          },
        };
      } catch (error) {
        console.error(`[MemoryHook] Error flushing memory: ${error.message}`);
        return null;
      }
    };
  }

  /**
   * TaskCompleted hook - Record decision and outcome
   */
  getTaskCompletedRecordingHook() {
    return async (context) => {
      const { agent, data, event } = context;

      try {
        const taskRecord = {
          timestamp: new Date().toISOString(),
          agent,
          taskId: data.taskId,
          taskType: data.taskType,
          status: data.status || 'unknown',
          duration: data.duration || 0,
          outcome: {
            success: data.success !== false,
            summary: data.summary || '',
          },
          decisions: data.decisions || [],
        };

        // Store task record
        const agentMemoryPath = path.join(this.memoryPath, agent);
        const tasksFile = path.join(agentMemoryPath, 'task-records.json');
        this.appendToJsonFile(tasksFile, taskRecord);

        // Update success patterns if successful
        if (data.success !== false && data.decisions) {
          await this.updateSuccessPatterns(agent, data.decisions);
        }

        return {
          modify: true,
          data: {
            ...data,
            taskRecorded: true,
          },
        };
      } catch (error) {
        console.error(`[MemoryHook] Error recording task: ${error.message}`);
        return null;
      }
    };
  }

  /**
   * PreCommit hook - Record code changes in memory
   */
  getPreCommitChangeRecordingHook() {
    return async (context) => {
      const { agent, data } = context;

      try {
        if (!data.files) return null;

        const changeRecord = {
          timestamp: new Date().toISOString(),
          agent,
          commitMessage: data.commitMessage || '',
          filesChanged: data.files.length,
          files: data.files.map(f => ({
            path: f.path || f,
            type: this.getFileType(f.path || f),
          })),
        };

        // Store change record
        const agentMemoryPath = path.join(this.memoryPath, agent);
        const changesFile = path.join(agentMemoryPath, 'code-changes.json');
        this.appendToJsonFile(changesFile, changeRecord);

        return {
          modify: true,
          data: {
            ...data,
            changeRecorded: true,
          },
        };
      } catch (error) {
        console.error(`[MemoryHook] Error recording changes: ${error.message}`);
        return null;
      }
    };
  }

  /**
   * Update success patterns based on decisions
   */
  async updateSuccessPatterns(agent, decisions) {
    try {
      const agentMemoryPath = path.join(this.memoryPath, agent);
      const patternsFile = path.join(agentMemoryPath, 'success-patterns.json');

      let patterns = [];
      if (fs.existsSync(patternsFile)) {
        patterns = JSON.parse(fs.readFileSync(patternsFile, 'utf-8'));
      }

      for (const decision of decisions) {
        const patternIndex = patterns.findIndex(p => p.decision === decision);
        if (patternIndex !== -1) {
          patterns[patternIndex].successCount++;
          patterns[patternIndex].lastUsed = new Date().toISOString();
        } else {
          patterns.push({
            decision,
            successCount: 1,
            firstUsed: new Date().toISOString(),
            lastUsed: new Date().toISOString(),
          });
        }
      }

      // Keep top patterns only
      patterns.sort((a, b) => b.successCount - a.successCount);
      patterns = patterns.slice(0, 50);

      fs.writeFileSync(patternsFile, JSON.stringify(patterns, null, 2));
    } catch (error) {
      console.error(`[MemoryHook] Error updating patterns: ${error.message}`);
    }
  }

  /**
   * Flush observations to disk
   */
  async flushObservations() {
    try {
      if (this.observationQueue.length === 0) return;

      // Group by agent
      const byAgent = {};
      for (const obs of this.observationQueue) {
        if (!byAgent[obs.agent]) {
          byAgent[obs.agent] = [];
        }
        byAgent[obs.agent].push(obs);
      }

      // Write to files
      for (const [agent, observations] of Object.entries(byAgent)) {
        const agentMemoryPath = path.join(this.memoryPath, agent);
        const obsFile = path.join(agentMemoryPath, 'observations.json');
        this.appendToJsonFile(obsFile, ...observations);
      }

      this.observationQueue = [];
      console.log(`[MemoryHook] Flushed ${Object.values(byAgent).flat().length} observations`);
    } catch (error) {
      console.error(`[MemoryHook] Error flushing observations: ${error.message}`);
    }
  }

  /**
   * Append data to JSON array file
   */
  appendToJsonFile(filePath, ...items) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      let data = [];
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        data = JSON.parse(content);
      }

      data.push(...items);

      // Keep reasonable size (last 1000 entries)
      if (data.length > 1000) {
        data = data.slice(-1000);
      }

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`[MemoryHook] Error writing to ${filePath}: ${error.message}`);
    }
  }

  /**
   * Generate unique observation ID
   */
  generateObservationId() {
    return `obs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Summarize data to reduce size
   */
  summarizeData(data) {
    if (typeof data === 'string') {
      return data.substring(0, 200);
    }
    if (typeof data === 'object') {
      return JSON.stringify(data).substring(0, 200);
    }
    return String(data).substring(0, 200);
  }

  /**
   * Get file type from extension
   */
  getFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.jsx': 'jsx',
      '.tsx': 'tsx',
      '.json': 'json',
      '.css': 'css',
      '.html': 'html',
      '.py': 'python',
      '.sol': 'solidity',
      '.md': 'markdown',
    };
    return typeMap[ext] || 'other';
  }

  /**
   * Create all memory hooks
   */
  createAllHooks(hookEngine) {
    const hookIds = [];

    hookIds.push(
      hookEngine.registerHook(
        'PostToolUse',
        'memory-observation-capture',
        this.getPostToolUseObservationCaptureHook(),
        80,
        2000
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'SessionStart',
        'memory-context-injection',
        this.getSessionStartMemoryInjectionHook(),
        100,
        3000
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'SessionEnd',
        'memory-flush',
        this.getSessionEndMemoryFlushHook(),
        100,
        5000
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'TaskCompleted',
        'memory-task-recording',
        this.getTaskCompletedRecordingHook(),
        90,
        2000
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'PreCommit',
        'memory-change-recording',
        this.getPreCommitChangeRecordingHook(),
        85,
        2000
      )
    );

    return hookIds;
  }
}

module.exports = MemoryHooks;
