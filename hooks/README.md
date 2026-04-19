# Hook System - AI Agent Company

A comprehensive event-driven hook system that enables agents to execute custom logic before/after tool use, at session boundaries, and during code commits. The system provides security enforcement, quality checks, and memory management capabilities.

## Architecture

### Core Components

#### 1. **Hook Engine** (`hook-engine.js`)
Central orchestration system for hook registration and execution.

**Features:**
- Event-type registration (8 supported event types)
- Hook priority-based execution (higher priority first)
- Timeout enforcement per hook
- Execution history tracking
- Hook enable/disable at runtime
- Detailed performance statistics

**Event Types:**
- `PreToolUse` - Before any tool executes (can block/modify)
- `PostToolUse` - After tool execution (can modify/observe)
- `SessionStart` - Agent session begins
- `SessionEnd` - Agent session ends
- `PreCommit` - Before code commit (can block)
- `PostCommit` - After code commit
- `TaskAssigned` - When orchestrator assigns a task
- `TaskCompleted` - When agent finishes a task

**Hook Signature:**
```javascript
async (context) => {
  // context = { agent, event, data, timestamp, hookId }
  // Return: null (pass-through), { block: true, reason } or { modify: true, data }
}
```

#### 2. **Security Hooks** (`security-hooks.js`)
Enforce security policies and detect vulnerabilities.

**Hooks:**
- `security-dangerous-command` - Block rm -rf, DROP TABLE, fork bombs, etc.
- `security-sensitive-path` - Prevent writes to .env, .git/, /etc/, node_modules/
- `security-secret-detection` - Scan output for API keys, tokens, passwords
- `security-pre-commit-secrets` - Pre-commit secret scanning with regex patterns
- `security-large-files` - Block commits with files >10MB
- `security-suspicious-ops` - Detect recursive deletes, mass operations
- `security-rate-limit` - Rate limit dangerous operations per agent

**Secret Patterns Detected:**
- API keys (sk_*, pk_*)
- AWS credentials (AKIA*)
- JWT tokens
- MongoDB connection strings
- Database passwords
- Docker tokens (ghp_*)
- GitHub tokens
- Private keys (RSA, etc.)

#### 3. **Quality Hooks** (`quality-hooks.js`)
Enforce code quality and testing standards.

**Hooks:**
- `quality-auto-format` - Auto-format JS/TS/JSON files
- `quality-lint-check` - Check for debug statements, TODOs, long lines/functions
- `quality-test-coverage` - Validate minimum coverage (80%)
- `quality-schema-validation` - Validate task output against expected schema
- `quality-type-check` - Check for excessive 'any' types in TypeScript

**Quality Thresholds:**
- Minimum test coverage: 80%
- Max cyclomatic complexity: 10
- Max line length: 120 chars
- Max function length: 100 lines

#### 4. **Memory Hooks** (`memory-hooks.js`)
Capture observations, manage agent memory, and record decisions.

**Hooks:**
- `memory-observation-capture` - Async capture of tool execution observations
- `memory-context-injection` - Load relevant memory at session start
- `memory-flush` - Compile and save memory at session end
- `memory-task-recording` - Record task outcomes and decisions
- `memory-change-recording` - Log code changes for later analysis

**Memory Artifacts:**
- `observations.json` - All captured observations
- `task-records.json` - Task execution records
- `success-patterns.json` - Patterns associated with successful outcomes
- `sessions.json` - Session summary records
- `code-changes.json` - Code change history

## Configuration

### config.json Structure

```json
{
  "version": "1.0",
  "globalTimeout": 5000,
  "agents": {
    "agent-name": {
      "enabled": true,
      "activeHooks": ["hook-id-1", "hook-id-2"],
      "hooks": {
        "hook-id": {
          "enabled": true,
          "priority": 150,
          "timeout": 2000,
          "config": { "maxSizeMB": 10 }
        }
      }
    }
  },
  "eventTypes": { /* event type definitions */ }
}
```

### Agent-Specific Configuration

Each agent has a customized hook set:
- **orchestrator**: Full security + quality + memory
- **architect**: Security + quality (design focus)
- **frontend**: Security + quality + type-checking
- **backend**: Full hooks + schema validation
- **security**: Security scanning + suspicious ops
- **tester**: Memory + test coverage checking
- **devops**: Security + large file checks + change recording

## Usage

### Initialization

```javascript
const HooksInitializer = require('./hooks');
const initializer = new HooksInitializer('./hooks/config.json', './memory');

// Initialize all hooks
initializer.initializeHooks();

// Get hook engine
const hookEngine = initializer.getHookEngine();

// Shutdown with memory flush
await initializer.shutdown();
```

### Executing Hooks

```javascript
// Before a tool is used
const preResult = await hookEngine.executeHooks('PreToolUse', {
  agent: 'frontend',
  data: { command: 'rm -rf /', filePath: '.env' },
  timestamp: new Date()
});

if (preResult.blocked) {
  console.log(`Blocked: ${preResult.blockReason}`);
}

// After tool completes
const postResult = await hookEngine.executeHooks('PostToolUse', {
  agent: 'backend',
  data: { output: 'AKIA3KFXXXXXXXXXXX', success: true },
});

if (postResult.data.secretDetected) {
  // Handle secret leak
}
```

### Registering Custom Hooks

```javascript
hookEngine.registerHook(
  'PreToolUse',                // event type
  'my-custom-hook',            // hook ID
  async (context) => {          // hook function
    if (context.data.dangerous) {
      return { block: true, reason: 'Too dangerous' };
    }
    return null; // pass-through
  },
  100,                          // priority (higher executes first)
  5000                          // timeout in ms
);
```

### Hook Management

```javascript
// Check hook status
const status = hookEngine.getStatus();
console.log(`${status.totalHooks} hooks registered`);

// Get specific hook stats
const stats = hookEngine.getHookStats('security-dangerous-command');
console.log(`Executed ${stats.executionCount} times`);

// Enable/disable hooks
hookEngine.setHookEnabled('memory-observation-capture', false);

// View execution history
const history = hookEngine.getExecutionHistory('PreToolUse', 10);
history.forEach(exec => {
  console.log(`${exec.eventType}: ${exec.hookResults.length} hooks executed`);
});

// Get active hooks for event
const active = hookEngine.getActiveHooks('PreCommit');
```

## Hook Execution Flow

```
Event Triggered
    ↓
Get all hooks for event type (sorted by priority)
    ↓
For each hook:
  ├─ Execute with timeout
  ├─ Track execution time/stats
  ├─ Check for block/modify
  └─ If blocked, stop execution
    ↓
Return results: { blocked, blockReason, data, results }
    ↓
Record execution in history
```

## Security Best Practices

1. **Always use PreToolUse hooks to block dangerous commands**
   - Blocks execute before tool runs (prevents damage)
   - Includes pattern matching for SQL injection, shell commands, etc.

2. **Use PostToolUse hooks to detect secrets in output**
   - Scans for API keys, tokens, credentials
   - Prevents accidental leaks in logs/output

3. **Use PreCommit hooks for secret scanning**
   - Scans files before they're committed
   - Checks for large files that shouldn't be in repo

4. **Rate limiting prevents abuse**
   - Limits dangerous operations per agent per minute
   - Prevents runaway tasks

5. **Memory isolation**
   - Each agent has separate memory directory
   - Observations are grouped by agent

## Performance Considerations

- **Hook Priority**: Higher priority hooks execute first (150 is highest)
- **Timeouts**: Each hook has individual timeout (default 5s, configurable)
- **History**: Keeps last 1000 executions (circular buffer)
- **Async Observation Capture**: Doesn't block tool execution
- **Memory Flushing**: Batched writes to disk, max 1000 before flush

## Monitoring & Debugging

### View Detailed Status

```javascript
const status = hookEngine.getStatus();
console.log(JSON.stringify(status, null, 2));
```

### Get Execution History with Timing

```javascript
const history = hookEngine.getExecutionHistory('PostToolUse', 50);
history.forEach(exec => {
  console.log(`Total execution time: ${exec.totalExecutionTime}ms`);
  exec.hookResults.forEach(result => {
    console.log(`  ${result.hookId}: ${result.executionTime}ms`);
  });
});
```

### Check Agent Memory

```javascript
const fs = require('fs');
const path = require('path');

const obsFile = path.join('memory/frontend/observations.json');
const observations = JSON.parse(fs.readFileSync(obsFile, 'utf-8'));
console.log(`Frontend has ${observations.length} observations`);
```

## Extending the System

### Create Custom Hook Class

```javascript
class CustomHooks {
  getMyHook() {
    return async (context) => {
      // Your logic here
      if (someCondition) {
        return { block: true, reason: 'My reason' };
      }
      return { modify: true, data: { ...context.data, custom: 'value' } };
    };
  }

  createAllHooks(hookEngine) {
    hookEngine.registerHook('PreToolUse', 'custom-hook', this.getMyHook(), 100, 2000);
  }
}
```

### Register in Initializer

```javascript
const CustomHooks = require('./custom-hooks');
const customHooks = new CustomHooks();
customHooks.createAllHooks(hookEngine);
```

## File Structure

```
hooks/
├── hook-engine.js          # Core engine (600 lines)
├── security-hooks.js       # Security enforcement (450 lines)
├── quality-hooks.js        # Quality standards (400 lines)
├── memory-hooks.js         # Memory management (400 lines)
├── index.js                # Initializer (150 lines)
├── config.json             # Configuration
└── README.md               # This file

Memory Storage:
memory/
├── orchestrator/
│   ├── observations.json
│   ├── task-records.json
│   ├── success-patterns.json
│   ├── sessions.json
│   └── code-changes.json
├── frontend/
├── backend/
└── ...
```

## Examples

### Example 1: Block Dangerous SQL

```javascript
const preResult = await hookEngine.executeHooks('PreToolUse', {
  agent: 'backend',
  data: { command: 'DROP TABLE users;' }
});

// Result: blocked=true, blockReason="Dangerous command pattern detected"
```

### Example 2: Detect Secret in Output

```javascript
const postResult = await hookEngine.executeHooks('PostToolUse', {
  agent: 'backend',
  data: { output: 'AKIA2JKFXXXXXXXXXX' }
});

// Result: blocked=true, blockReason="Secrets detected in output: awsKey"
```

### Example 3: Record Task Success

```javascript
const taskResult = await hookEngine.executeHooks('TaskCompleted', {
  agent: 'backend',
  data: {
    taskId: 'task-123',
    status: 'success',
    decisions: ['use-cache', 'optimize-query']
  }
});

// Saved to memory/backend/task-records.json
// Updated success-patterns.json with decisions
```

## Performance Metrics

Typical hook execution times:
- `security-dangerous-command`: 2-5ms
- `quality-auto-format`: 10-50ms
- `memory-observation-capture`: 1-2ms
- `security-pre-commit-secrets`: 20-100ms
- `quality-test-coverage`: 5-15ms

Total overhead per event: 50-200ms (depending on active hooks)

## Troubleshooting

### Hooks not executing
- Check `config.json` has agent entry
- Verify hook is in `activeHooks` list
- Check `enabled: true` for both agent and hook

### Timeout errors
- Increase timeout value in config
- Check if file I/O is blocking
- Monitor system resources

### Memory growing
- Check observation queue is flushing
- Review memory directory file sizes
- Increase flush frequency if needed

### Secrets leaking past security hooks
- Update secret patterns in `security-hooks.js`
- Add custom regex pattern for your secret format
- Test pattern before deploying

---

**Version:** 1.0  
**Last Updated:** April 2026  
**Maintainer:** AI Agent Company Infrastructure Team
