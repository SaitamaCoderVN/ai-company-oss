/**
 * queue.js — pg-boss task queue backed by Supabase PostgreSQL.
 *
 * Replaces file-based IPC (tasks/dispatch/*.json → chokidar watcher).
 * Uses the same DATABASE_URL as the platform for a shared job queue.
 *
 * Exports:
 *   startQueue()                    — connect pg-boss, create queue
 *   scheduleTask(role, payload)     — enqueue a task for an agent role
 *   onTask(role, handler)           — register a handler for a role
 *   stopQueue()                     — graceful shutdown
 */

import { PgBoss } from 'pg-boss';

let boss = null;

/**
 * Start the pg-boss queue.
 *
 * @param {string} databaseUrl — PostgreSQL connection string (DATABASE_URL)
 */
export async function startQueue(databaseUrl) {
  if (boss) return boss;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for pg-boss queue');
  }

  boss = new PgBoss({
    connectionString: databaseUrl,
    // Supabase pooler uses self-signed certs
    ssl: { rejectUnauthorized: false },
    // Respect the existing 3-concurrent-agent limit at the consumer level,
    // not the queue level. pg-boss will deliver jobs as fast as handlers
    // consume them; the agent-runner's own capacity check gates concurrency.
    noScheduling: true,
    // Retain completed/failed jobs for 7 days (useful for debugging)
    retentionDays: 7,
  });

  boss.on('error', (err) => {
    console.error('[queue] pg-boss error:', err.message);
  });

  await boss.start();
  console.log('[queue] pg-boss started');

  return boss;
}

/**
 * Schedule a task for an agent role.
 *
 * @param {string} role — agent role (e.g. "frontend", "orchestrator")
 * @param {{ taskId: string, input: string, companyId?: string, chatId?: number, messageId?: number, context?: string, dependsOn?: string[] }} payload
 */
const createdQueues = new Set();

export async function scheduleTask(role, payload) {
  if (!boss) throw new Error('Queue not started. Call startQueue() first.');

  const queueName = `agent-task/${role}`;

  if (!createdQueues.has(queueName)) {
    await boss.createQueue(queueName);
    createdQueues.add(queueName);
  }

  const jobId = await boss.send(queueName, payload, {
    retryLimit: 1,
    retryDelay: 5,
    expireInMinutes: 60,
  });

  console.log(`[queue] Scheduled job ${jobId} on ${queueName}`);
  return jobId;
}

/**
 * Register a handler for tasks targeting a specific agent role.
 *
 * @param {string} role — agent role
 * @param {(job: { id: string, data: object }) => Promise<void>} handler
 */
export async function onTask(role, handler) {
  if (!boss) throw new Error('Queue not started. Call startQueue() first.');

  const queueName = `agent-task/${role}`;

  if (!createdQueues.has(queueName)) {
    await boss.createQueue(queueName);
    createdQueues.add(queueName);
  }

  await boss.work(queueName, { newJobCheckInterval: 2000 }, handler);

  console.log(`[queue] Listening on ${queueName}`);
}

/**
 * Stop the queue gracefully.
 */
export async function stopQueue() {
  if (boss) {
    await boss.stop({ graceful: true, timeout: 10000 });
    boss = null;
    console.log('[queue] pg-boss stopped');
  }
}
