/**
 * browser-server.js — HTTP API for browser automation
 *
 * Agents call this server via curl/fetch to control browser sessions.
 * Each task gets its own browser session, isolated and time-limited.
 *
 * Start: node lib/browser-server.js
 * Port: 9802 (configurable via BROWSER_PORT env var)
 *
 * API:
 *   POST /api/browser/:taskId  { command, args }
 *   GET  /api/browser/sessions  (list active sessions)
 *   DELETE /api/browser/:taskId (close session)
 */

import express from 'express';
import { BrowserSession } from './browser-tool.js';

const PORT = parseInt(process.env.BROWSER_PORT || '9802', 10);
const MAX_SESSIONS = parseInt(process.env.MAX_BROWSER_SESSIONS || '3', 10);

const sessions = new Map(); // taskId → BrowserSession

const app = express();
app.use(express.json());

/**
 * Get or create a browser session for a task
 */
async function getSession(taskId) {
  if (sessions.has(taskId)) return sessions.get(taskId);

  if (sessions.size >= MAX_SESSIONS) {
    // Close oldest session
    const oldest = sessions.keys().next().value;
    console.log(`[browser] Closing oldest session: ${oldest}`);
    await sessions.get(oldest).close();
    sessions.delete(oldest);
  }

  const session = new BrowserSession(taskId);
  await session.launch();
  sessions.set(taskId, session);
  console.log(`[browser] New session created: ${taskId}`);
  return session;
}

/**
 * Execute a browser command
 */
app.post('/api/browser/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const { command, args = [] } = req.body;

  try {
    const session = await getSession(taskId);

    let result;
    switch (command) {
      case 'goto':
        result = await session.goto(args[0]);
        break;
      case 'screenshot':
        result = await session.screenshot(args[0]);
        break;
      case 'screenshot-full':
        result = await session.screenshotFull(args[0]);
        break;
      case 'text':
        result = { text: await session.getText(args[0]) };
        break;
      case 'html':
        result = { html: (await session.getHTML(args[0])).substring(0, 10000) };
        break;
      case 'click':
        await session.click(args[0]);
        result = { clicked: args[0] };
        break;
      case 'type':
        await session.type(args[0], args[1]);
        result = { typed: args[1], into: args[0] };
        break;
      case 'links':
        result = { links: await session.getLinks() };
        break;
      case 'accessibility':
        result = { tree: await session.getAccessibilityTree() };
        break;
      case 'exists':
        result = { exists: await session.exists(args[0]) };
        break;
      default:
        return res.status(400).json({ error: `Unknown command: ${command}` });
    }

    res.json({ success: true, taskId, command, result });
  } catch (error) {
    console.error(`[browser] Error in ${command}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * List active sessions
 */
app.get('/api/browser/sessions', (req, res) => {
  const list = [];
  for (const [taskId, session] of sessions) {
    list.push({
      taskId,
      screenshots: session.screenshotCount,
      duration: Date.now() - (session.startTime || 0),
    });
  }
  res.json({ sessions: list, maxSessions: MAX_SESSIONS });
});

/**
 * Close a session
 */
app.delete('/api/browser/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const session = sessions.get(taskId);
  if (session) {
    await session.close();
    sessions.delete(taskId);
    res.json({ closed: taskId });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', activeSessions: sessions.size });
});

// Cleanup on exit
process.on('SIGINT', async () => {
  for (const [taskId, session] of sessions) {
    await session.close();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`[browser-server] Listening on port ${PORT}`);
  console.log(`[browser-server] Max concurrent sessions: ${MAX_SESSIONS}`);
});

export default app;
