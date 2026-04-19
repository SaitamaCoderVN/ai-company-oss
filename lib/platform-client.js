/**
 * platform-client.js — Optional connection to PixelCompany marketplace.
 *
 * Both functions are no-ops when PLATFORM_API_KEY is not set.
 * Neither function throws or blocks agent execution.
 */

const PLATFORM_URL = process.env.PLATFORM_URL || 'https://pixelcompany.fun';
const PLATFORM_API_KEY = process.env.PLATFORM_API_KEY || '';

/**
 * Fetch a purchased agent's SKILL.md from the marketplace.
 *
 * @param {string} agentId — marketplace agent UUID
 * @returns {Promise<string|null>} skill_content or null
 */
export async function fetchSkill(agentId) {
  if (!PLATFORM_API_KEY) return null;

  try {
    const res = await fetch(`${PLATFORM_URL}/api/skills/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': PLATFORM_API_KEY,
      },
      body: JSON.stringify({ agent_id: agentId }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.skill_content || null;
  } catch {
    return null;
  }
}

/**
 * Report agent status to the PixelCompany platform (fire-and-forget).
 *
 * @param {{ agent_role: string, status: string, current_task?: string }} status
 */
export function reportStatus(status) {
  if (!PLATFORM_API_KEY) return;

  try {
    void fetch(`${PLATFORM_URL}/api/webhook/inject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': PLATFORM_API_KEY,
      },
      body: JSON.stringify(status),
    }).catch(() => {});
  } catch {
    // Never throw
  }
}
