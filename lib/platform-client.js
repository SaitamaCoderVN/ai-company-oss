/**
 * platform-client.js — Optional connection to PixelCompany marketplace.
 *
 * Both functions are no-ops when PLATFORM_API_KEY is not set.
 * Neither function throws or blocks agent execution.
 */

const PLATFORM_URL = process.env.PLATFORM_URL || 'https://pixelcompany-platform.vercel.app';
const PLATFORM_API_KEY = process.env.PLATFORM_API_KEY || '';
const COMPANY_ID = process.env.COMPANY_ID || '';

/**
 * Fetch a purchased agent's SKILL.md from the marketplace.
 *
 * @param {{ agent_id: string, company_id?: string }} opts
 * @returns {Promise<string|null>} skill_content or null
 */
export async function fetchSkill(opts) {
  if (!PLATFORM_API_KEY) return null;

  const agent_id = typeof opts === 'string' ? opts : opts.agent_id;
  const company_id = (typeof opts === 'object' ? opts.company_id : null) || COMPANY_ID;

  if (!agent_id || !company_id) return null;

  try {
    const res = await fetch(`${PLATFORM_URL}/api/skills/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': PLATFORM_API_KEY,
      },
      body: JSON.stringify({ agent_id, company_id }),
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

  const company_id = COMPANY_ID;
  if (!company_id) return;

  try {
    void fetch(`${PLATFORM_URL}/api/webhook/inject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': PLATFORM_API_KEY,
      },
      body: JSON.stringify({ ...status, company_id }),
    }).catch(() => {});
  } catch {
    // Never throw
  }
}
