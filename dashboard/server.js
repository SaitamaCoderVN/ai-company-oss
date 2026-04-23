const express = require('express');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');

// Load env from root .env
const dotenv = require('dotenv');
const BASE_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(BASE_DIR, '.env') });

const app = express();
const HTTP_PORT = process.env.DASHBOARD_PORT || 9800;
const WS_PORT = process.env.WEBSOCKET_PORT || 9801;

// Paths to REAL data (relative to ai-company root)
const TASKS_DIR = path.join(BASE_DIR, 'tasks');
const SKILL_STORE = path.join(BASE_DIR, 'skill-store');
const SKILL_QUEUE = path.join(BASE_DIR, 'skill-queue');
const MEMORY_DIR = path.join(BASE_DIR, 'memory');
const COSTS_FILE = path.join(BASE_DIR, 'scripts', 'costs.jsonl');
const GRAPH_FILE = path.join(BASE_DIR, 'config', 'agent-graph.json');
const HOOKS_METRICS_FILE = path.join(BASE_DIR, 'hooks', 'metrics.jsonl');

// Try to initialize memory engine (optional)
let memoryEngine = null;
try {
  const MemoryEngine = require(path.join(BASE_DIR, 'memory', 'memory-engine.js'));
  memoryEngine = new MemoryEngine();
} catch (e) {
  console.warn('Memory engine not available:', e.message);
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ==================== REST API ENDPOINTS ====================

// GET /api/status - Full state of dashboard
app.get('/api/status', (req, res) => {
  res.json(readFullState());
});

// GET /api/tasks - Task list
app.get('/api/tasks', (req, res) => {
  res.json(readTaskFiles());
});

// GET /api/memory/:agent - Agent memory info
app.get('/api/memory/:agent', (req, res) => {
  const memFile = path.join(MEMORY_DIR, req.params.agent, 'MEMORY.md');
  if (fs.existsSync(memFile)) {
    const stat = fs.statSync(memFile);
    const content = fs.readFileSync(memFile, 'utf8');
    const lines = content.split('\n').length;
    res.json({ agent: req.params.agent, lines, bytes: stat.size, lastModified: stat.mtime });
  } else {
    res.json({ agent: req.params.agent, lines: 0, bytes: 0, lastModified: null });
  }
});

// GET /api/costs - Aggregated cost data from costs.jsonl
app.get('/api/costs', (req, res) => {
  const costs = readCosts();
  const aggregated = {
    total_cost: costs.reduce((sum, c) => sum + (c.cost || 0), 0),
    total_tokens: costs.reduce((sum, c) => sum + (c.tokens || 0), 0),
    by_agent: {},
    by_model: {},
    records: costs.length,
    last_updated: costs.length > 0 ? costs[costs.length - 1].timestamp : null
  };

  for (const cost of costs) {
    if (cost.agent) {
      if (!aggregated.by_agent[cost.agent]) {
        aggregated.by_agent[cost.agent] = { cost: 0, tokens: 0, count: 0 };
      }
      aggregated.by_agent[cost.agent].cost += cost.cost || 0;
      aggregated.by_agent[cost.agent].tokens += cost.tokens || 0;
      aggregated.by_agent[cost.agent].count += 1;
    }
    if (cost.model) {
      if (!aggregated.by_model[cost.model]) {
        aggregated.by_model[cost.model] = { cost: 0, tokens: 0, count: 0 };
      }
      aggregated.by_model[cost.model].cost += cost.cost || 0;
      aggregated.by_model[cost.model].tokens += cost.tokens || 0;
      aggregated.by_model[cost.model].count += 1;
    }
  }

  res.json(aggregated);
});

// GET /api/costs/:agent - Per-agent cost breakdown
app.get('/api/costs/:agent', (req, res) => {
  const costs = readCosts().filter(c => c.agent === req.params.agent);
  const agentCosts = {
    agent: req.params.agent,
    total_cost: costs.reduce((sum, c) => sum + (c.cost || 0), 0),
    total_tokens: costs.reduce((sum, c) => sum + (c.tokens || 0), 0),
    by_model: {},
    records: costs.length,
    last_updated: costs.length > 0 ? costs[costs.length - 1].timestamp : null,
    recent: costs.slice(-10).reverse()
  };

  for (const cost of costs) {
    if (cost.model) {
      if (!agentCosts.by_model[cost.model]) {
        agentCosts.by_model[cost.model] = { cost: 0, tokens: 0, count: 0 };
      }
      agentCosts.by_model[cost.model].cost += cost.cost || 0;
      agentCosts.by_model[cost.model].tokens += cost.tokens || 0;
      agentCosts.by_model[cost.model].count += 1;
    }
  }

  res.json(agentCosts);
});

// GET /api/memory/search - Memory search endpoint
app.get('/api/memory/search', (req, res) => {
  const query = req.query.q || '';
  const agent = req.query.agent || '';
  const limit = parseInt(req.query.limit) || 10;

  if (!query || !agent || !memoryEngine) {
    return res.json({ results: [], total: 0 });
  }

  try {
    const results = memoryEngine.searchMemory(query, agent, limit);
    res.json({
      query,
      agent,
      results,
      total: results.length
    });
  } catch (e) {
    console.error('Memory search error:', e);
    res.json({ results: [], total: 0, error: e.message });
  }
});

// GET /api/graph - Agent dependency graph
app.get('/api/graph', (req, res) => {
  const graph = readAgentGraph();
  res.json(graph);
});

// GET /api/hooks/metrics - Hook execution stats
app.get('/api/hooks/metrics', (req, res) => {
  const metrics = readHooksMetrics();
  const aggregated = {
    total_executions: metrics.length,
    by_hook_type: {},
    by_status: { success: 0, error: 0, timeout: 0 },
    average_duration_ms: 0,
    last_updated: metrics.length > 0 ? metrics[metrics.length - 1].timestamp : null,
    recent: metrics.slice(-20).reverse()
  };

  let totalDuration = 0;
  for (const metric of metrics) {
    if (metric.hook_type) {
      if (!aggregated.by_hook_type[metric.hook_type]) {
        aggregated.by_hook_type[metric.hook_type] = { count: 0, total_duration: 0 };
      }
      aggregated.by_hook_type[metric.hook_type].count += 1;
      aggregated.by_hook_type[metric.hook_type].total_duration += metric.duration_ms || 0;
    }
    if (metric.status) {
      aggregated.by_status[metric.status] = (aggregated.by_status[metric.status] || 0) + 1;
    }
    totalDuration += metric.duration_ms || 0;
  }

  if (metrics.length > 0) {
    aggregated.average_duration_ms = (totalDuration / metrics.length).toFixed(2);
  }

  res.json(aggregated);
});

// ==================== DATA READING FUNCTIONS ====================

// ── Supabase agent_status polling ────────────────────────────────
// Replaces the old readAgentStatus() which read tasks/agent-status.json.
// Now queries the Supabase agent_status table via PostgREST and caches
// the result so the sync readFullState() path doesn't need to change.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

let cachedAgentStatus = null;

async function pollAgentStatus() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return; // Supabase not configured — cachedAgentStatus stays null
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/agent_status?select=agent_role,status,current_task,last_heartbeat,metadata`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) {
      console.error(`[dashboard] Supabase query failed: ${res.status}`);
      return;
    }

    const rows = await res.json();

    // Transform rows into the same shape readFullState() expects:
    // { agents: { name: { status, task, ... } }, system: { ... } }
    const agents = {};
    let activeCount = 0;

    for (const row of rows) {
      agents[row.agent_role] = {
        status: row.status || 'idle',
        task: row.current_task || null,
        started_at: row.last_heartbeat || null,
        pid: null,
      };
      if (row.status === 'working') activeCount++;
    }

    cachedAgentStatus = {
      agents,
      system: {
        max_active: 3,
        total_agents: 10,
        active_count: activeCount,
        status: activeCount > 0 ? 'working' : 'idle',
      },
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[dashboard] Failed to poll agent_status:', e.message);
  }
}

// Start polling immediately, then every 2s (matches broadcast interval)
pollAgentStatus();
setInterval(pollAgentStatus, 2000);

function readAgentStatus() {
  return cachedAgentStatus;
}

// Read all task files from tasks/ directory
function readTaskFiles() {
  const tasks = [];
  try {
    if (!fs.existsSync(TASKS_DIR)) return tasks;
    const files = fs.readdirSync(TASKS_DIR).filter(f => f.endsWith('.json') && f !== 'agent-status.json');
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, file), 'utf8'));
        if (data.id || data.task_id) {
          tasks.push({ ...data, _file: file });
        }
      } catch (e) { /* skip malformed */ }
    }
  } catch (e) {
    console.error('Failed to read tasks:', e.message);
  }
  return tasks;
}

// Read pending skill requests
function readSkillQueue() {
  const requests = [];
  try {
    if (!fs.existsSync(SKILL_QUEUE)) return requests;
    const files = fs.readdirSync(SKILL_QUEUE).filter(f => f.startsWith('req_') && f.endsWith('.json'));
    for (const file of files) {
      try {
        requests.push(JSON.parse(fs.readFileSync(path.join(SKILL_QUEUE, file), 'utf8')));
      } catch (e) { /* skip */ }
    }
  } catch (e) { /* ignore */ }
  return requests;
}

// Read costs from costs.jsonl
function readCosts() {
  const costs = [];
  try {
    if (!fs.existsSync(COSTS_FILE)) return costs;
    const content = fs.readFileSync(COSTS_FILE, 'utf8');
    const lines = content.trim().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        try {
          costs.push(JSON.parse(line));
        } catch (e) { /* skip malformed lines */ }
      }
    }
  } catch (e) {
    console.error('Failed to read costs.jsonl:', e.message);
  }
  return costs;
}

// Read agent graph configuration
function readAgentGraph() {
  try {
    if (fs.existsSync(GRAPH_FILE)) {
      return JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read agent-graph.json:', e.message);
  }
  return {
    agents: [],
    edges: [],
    metadata: { version: '1.0' }
  };
}

// Read hook execution metrics from metrics.jsonl
function readHooksMetrics() {
  const metrics = [];
  try {
    if (!fs.existsSync(HOOKS_METRICS_FILE)) return metrics;
    const content = fs.readFileSync(HOOKS_METRICS_FILE, 'utf8');
    const lines = content.trim().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        try {
          metrics.push(JSON.parse(line));
        } catch (e) { /* skip malformed lines */ }
      }
    }
  } catch (e) {
    // File may not exist yet
  }
  return metrics;
}

// Read system/process stats
// All-in-One mode: agents are processes, not containers
// Returns per-agent stats based on running claude processes
function readDockerStats() {
  const stats = {};
  const agentNames = ['orchestrator', 'architect', 'design', 'frontend', 'backend',
    'smartcontract', 'researcher', 'tester', 'security', 'devops'];

  try {
    const { execSync } = require('child_process');

    // Get total container memory usage
    const memInfo = execSync(
      'free -m 2>/dev/null | grep Mem || echo "Mem: 0 0 0"',
      { timeout: 3000, encoding: 'utf8' }
    ).trim();
    const memParts = memInfo.split(/\s+/);
    const totalMem = parseInt(memParts[1]) || 1;
    const usedMem = parseInt(memParts[2]) || 0;

    // Get running claude processes
    const psOutput = execSync(
      'ps aux 2>/dev/null | grep "[c]laude.*--print" || true',
      { timeout: 3000, encoding: 'utf8' }
    ).trim();

    const runningAgents = new Set();
    psOutput.split('\n').forEach(line => {
      if (!line.trim()) return;
      for (const name of agentNames) {
        if (line.includes(`AGENT_NAME=${name}`)) {
          runningAgents.add(name);
          const parts = line.split(/\s+/);
          stats[name] = {
            memUsage: `${parts[5] || '0'}K`,
            memPercent: parseFloat(parts[3]) || 0,
            cpuPercent: parseFloat(parts[2]) || 0
          };
        }
      }
    });

    // For non-running agents, show as available (part of the container)
    for (const name of agentNames) {
      if (!stats[name]) {
        stats[name] = {
          memUsage: '0B',
          memPercent: 0,
          cpuPercent: 0,
          ready: true // Agent is available but not currently running a task
        };
      }
    }
  } catch (e) {
    // No stats available — that's fine
  }
  return stats;
}

// Read memory statistics for all agents
function readMemoryStats() {
  const memStats = {};
  try {
    if (fs.existsSync(MEMORY_DIR)) {
      const agents = fs.readdirSync(MEMORY_DIR).filter(f => {
        const fullPath = path.join(MEMORY_DIR, f);
        return fs.statSync(fullPath).isDirectory();
      });

      for (const agent of agents) {
        const agentMemDir = path.join(MEMORY_DIR, agent);
        const memFile = path.join(agentMemDir, 'MEMORY.md');
        try {
          if (fs.existsSync(memFile)) {
            const stat = fs.statSync(memFile);
            memStats[agent] = {
              observation_count: 0, // Would need to query DB
              last_session: stat.mtime,
              memory_bytes: stat.size
            };
          }
        } catch (e) { /* skip */ }
      }
    }
  } catch (e) {
    console.error('Failed to read memory stats:', e.message);
  }
  return memStats;
}

// Compile full state from all real sources
function readFullState() {
  const agentStatus = readAgentStatus();
  const taskFiles = readTaskFiles();
  const skillQueue = readSkillQueue();
  const dockerStats = readDockerStats();
  const memoryStats = readMemoryStats();
  const graphData = readAgentGraph();
  const costs = readCosts();

  // Calculate cost summary
  const costSummary = {
    total_cost: costs.reduce((sum, c) => sum + (c.cost || 0), 0),
    total_tokens: costs.reduce((sum, c) => sum + (c.tokens || 0), 0),
    by_agent: {}
  };

  for (const cost of costs) {
    if (cost.agent) {
      if (!costSummary.by_agent[cost.agent]) {
        costSummary.by_agent[cost.agent] = { cost: 0, tokens: 0 };
      }
      costSummary.by_agent[cost.agent].cost += cost.cost || 0;
      costSummary.by_agent[cost.agent].tokens += cost.tokens || 0;
    }
  }

  // Categorize tasks by status
  const pipeline = { queue: [], working: [], review: [], done: [] };
  const taskChanges = [];
  taskFiles.forEach(task => {
    const status = task.status || task.state || 'queue';
    const mapped = status === 'in_progress' || status === 'active' ? 'working'
                 : status === 'pending' || status === 'queued' ? 'queue'
                 : status === 'review' || status === 'reviewing' ? 'review'
                 : status === 'completed' || status === 'done' ? 'done'
                 : 'queue';
    pipeline[mapped].push({
      id: task.id || task.task_id || task._file,
      name: task.name || task.description || task.task || task._file,
      agent: task.agent || task.assigned_to || null,
      status: mapped,
      progress: task.progress || 0,
      created: task.timestamp || task.created_at || null
    });
  });

  // Build per-agent latest task error info from task files
  const agentLastTask = {};
  for (const task of taskFiles) {
    const agentName = task.agent || task.assigned_to;
    if (!agentName) continue;
    const prev = agentLastTask[agentName];
    const taskTime = task.updatedAt || task.completedAt || task.timestamp || task.created_at || '';
    if (!prev || taskTime > (prev.updatedAt || prev.completedAt || prev.timestamp || prev.created_at || '')) {
      agentLastTask[agentName] = task;
    }
  }

  // Build agent source: prefer Supabase data, fall back to local process + task data
  const ALL_AGENTS = ['orchestrator', 'architect', 'design', 'frontend', 'backend',
    'smartcontract', 'researcher', 'tester', 'security', 'devops'];

  // Base agent data: from Supabase if available, otherwise from docker/process stats
  const agentSource = (agentStatus && agentStatus.agents && Object.keys(agentStatus.agents).length > 0)
    ? agentStatus.agents
    : null;

  const agents = {};
  let activeCount = 0;

  for (const name of ALL_AGENTS) {
    const supaData = agentSource ? agentSource[name] : null;
    const docker = dockerStats[name] || {};
    const memStats = memoryStats[name] || {};
    const lastTask = agentLastTask[name] || {};

    // Determine status: Supabase > running process > task file > idle
    let status = 'idle';
    let task = null;

    if (supaData) {
      status = supaData.status || 'idle';
      task = supaData.task || null;
    } else if (docker.cpuPercent > 0 || (docker.memPercent > 0 && !docker.ready)) {
      // Agent has a running Claude process
      status = 'working';
      task = lastTask.id || lastTask.task_id || null;
    } else if (lastTask.status === 'in_progress' || lastTask.status === 'active') {
      status = 'working';
      task = lastTask.id || lastTask.task_id || null;
    }

    if (status === 'working') activeCount++;

    // Include error info from the agent's most recent task
    const errorInfo = {};
    if (lastTask.status === 'error' || lastTask.error) {
      errorInfo.error = lastTask.error || null;
      errorInfo.last_error = lastTask.error || null;
      errorInfo.error_type = lastTask.error_type || null;
      errorInfo.last_task_id = lastTask.id || lastTask.task_id || null;
      errorInfo.last_task_status = lastTask.status || null;
      errorInfo.completedAt = lastTask.completedAt || null;
      if (status === 'idle' && lastTask.status === 'error') {
        status = 'error';
      }
    }
    // Include output preview for debugging
    if (lastTask.output) {
      errorInfo.last_output_preview = String(lastTask.output).substring(0, 300);
    }

    agents[name] = {
      status,
      task,
      started_at: supaData?.started_at || lastTask.updatedAt || null,
      pid: supaData?.pid || null,
      ...errorInfo,
      docker_mem: docker.memUsage || null,
      docker_mem_percent: docker.memPercent || 0,
      docker_cpu_percent: docker.cpuPercent || 0,
      is_container_running: true,
      memory_stats: memStats,
      cost_summary: costSummary.by_agent[name] || { cost: 0, tokens: 0 }
    };
  }

  const systemStatus = agentStatus?.system || {
    max_active: 3,
    total_agents: 10,
    active_count: activeCount,
    status: activeCount > 0 ? 'working' : 'idle',
  };
  // Always update active count from local data
  systemStatus.active_count = activeCount;
  if (activeCount > 0) systemStatus.status = 'working';

  return {
    type: 'full_state',
    timestamp: Date.now(),
    system: systemStatus,
    agents,
    pipeline,
    skill_requests: skillQueue,
    cost_summary: costSummary,
    graph_data: graphData,
    docker_available: Object.keys(dockerStats).length > 0
  };
}

// Track previous state to detect changes for logging
let previousState = null;

function detectChanges(newState) {
  const changes = [];
  if (!previousState || !previousState.agents) return changes;

  // Agent status changes
  for (const [name, agent] of Object.entries(newState.agents || {})) {
    const prev = previousState.agents[name];
    if (!prev) continue;
    if (prev.status !== agent.status) {
      changes.push({ type: 'agent_status', agent: name, from: prev.status, to: agent.status });
    }
    if (prev.task !== agent.task && agent.task) {
      changes.push({ type: 'task_assigned', agent: name, task: agent.task });
    }
  }

  // Task pipeline changes
  const taskStatusKey = (id) => id;
  const prevTaskMap = new Map();
  if (previousState.pipeline) {
    for (const status of Object.keys(previousState.pipeline)) {
      for (const task of previousState.pipeline[status]) {
        prevTaskMap.set(task.id, status);
      }
    }
  }

  if (newState.pipeline) {
    for (const status of Object.keys(newState.pipeline)) {
      for (const task of newState.pipeline[status]) {
        const prevStatus = prevTaskMap.get(task.id);
        if (!prevStatus) {
          changes.push({ type: 'task_created', task_id: task.id, task: task.name, status });
        } else if (prevStatus !== status) {
          changes.push({ type: 'task_status_changed', task_id: task.id, from: prevStatus, to: status });
        }
      }
    }
  }

  // Skill queue changes
  const prevSkillCount = previousState.skill_requests?.length || 0;
  const newSkillCount = newState.skill_requests?.length || 0;
  if (newSkillCount > prevSkillCount) {
    changes.push({ type: 'skill_request_added', count: newSkillCount - prevSkillCount });
  }

  // Cost threshold alerts
  const prevTotal = previousState.cost_summary?.total_cost || 0;
  const newTotal = newState.cost_summary?.total_cost || 0;
  if (newTotal > prevTotal * 1.1) { // 10% increase
    changes.push({ type: 'cost_increase', from: prevTotal.toFixed(4), to: newTotal.toFixed(4) });
  }

  return changes;
}

// Start HTTP server
const httpServer = http.createServer(app);
httpServer.listen(HTTP_PORT, () => {
  console.log(`Dashboard: http://localhost:${HTTP_PORT}`);
});

// Start WebSocket server
const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket:  ws://localhost:${WS_PORT}`);

// Send full state to new clients
wss.on('connection', (ws) => {
  console.log('Client connected');
  const state = readFullState();
  ws.send(JSON.stringify(state));

  ws.on('close', () => console.log('Client disconnected'));
  ws.on('error', (err) => console.error('WS error:', err.message));
});

// Broadcast real state every 2 seconds
setInterval(() => {
  const state = readFullState();
  const changes = detectChanges(state);

  const message = JSON.stringify({
    ...state,
    changes
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });

  // Log real changes
  changes.forEach(c => {
    if (c.type === 'agent_status') {
      console.log(`[CHANGE] ${c.agent}: ${c.from} → ${c.to}`);
    } else if (c.type === 'task_status_changed') {
      console.log(`[CHANGE] Task ${c.task_id}: ${c.from} → ${c.to}`);
    } else if (c.type === 'cost_increase') {
      console.log(`[ALERT] Cost increase: $${c.from} → $${c.to}`);
    }
  });

  previousState = state;
}, 2000);

// Graceful shutdown
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  if (memoryEngine) {
    memoryEngine.close();
  }
  wss.clients.forEach(c => c.close());
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
