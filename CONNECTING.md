# Connecting to PixelCompany Marketplace

AI Agent Company works fully standalone with local SKILL.md files.
Optionally, you can connect to [pixelcompany.fun](https://pixelcompany.fun)
to import pre-built agent skills from the marketplace.

## Get your API key

1. Go to [pixelcompany.fun/settings](https://pixelcompany.fun/settings)
2. Sign in or create an account
3. Copy your **API key** from the settings page

## Configure the connection

Add two lines to your `.env` file:

```
PLATFORM_URL=https://pixelcompany.fun
PLATFORM_API_KEY=your-api-key-here
```

Restart the container: `docker compose restart`

## What happens after connecting

When an agent starts, it checks the marketplace for a purchased SKILL.md.
If one is found, it replaces the local `skills/{agent}/SKILL.md` for that run.
If the marketplace is unreachable, the agent falls back to the local skill file.

Status updates are also pushed to the platform so you can monitor
your agents from the pixelcompany.fun dashboard.

## Import a purchased agent

After purchasing an agent on pixelcompany.fun, import it with the CLI:

```bash
pixelco agent import <agent-id>
```

This writes the agent's config to `marketplace-agents.json`.
On the next task, the agent runner fetches the purchased SKILL.md automatically.

## Troubleshooting

**"Invalid API key"**
Your PLATFORM_API_KEY doesn't match any account. Copy it again from
pixelcompany.fun/settings. Make sure there are no extra spaces.

**"Skill not found"**
You haven't purchased this agent, or the agent ID is wrong.
Check your purchases at pixelcompany.fun/dashboard.

**"Network error" / timeout**
The platform is unreachable. Your agents will keep running with
local SKILL.md files. The connection is retried on each task.
Check your internet connection and try again.
