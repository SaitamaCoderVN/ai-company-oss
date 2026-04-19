# ai-company

An open-source multi-agent AI company engine powered by Claude CLI.
Run a team of specialized AI agents locally or on any server.

## What this is

10 Claude agents (orchestrator, frontend, backend, smartcontract, security,
devops, qa, docs, design, data) that collaborate on software projects.
Each agent has a specialized SKILL.md system prompt and communicates via
a shared task queue.

## Quick start

Requires: Docker, an Anthropic API key, a free Supabase project.

1. Clone: `git clone https://github.com/SaitamaCoderVN/ai-company-oss`
2. See [SETUP.md](./SETUP.md) for the 5-step setup guide.

## Connect to PixelCompany marketplace

Buy and import specialized agent skills from the marketplace.
See [CONNECTING.md](./CONNECTING.md).

## Architecture

- **Router** — Telegram bot interface + pg-boss task dispatch
- **Agent runner** — spawns `claude --print` processes per agent role
- **Dashboard** — pixel office UI at localhost:9800
- **platform-client.js** — optional connector to PixelCompany marketplace

## Self-hosting

Works fully offline. Set `ANTHROPIC_API_KEY` and `SUPABASE_URL` in `.env`,
then `docker compose up`. No account required.

## License

MIT — see [LICENSE](./LICENSE)
