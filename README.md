# AI Agent Company

An open-source multi-agent orchestration engine powered by Claude Code CLI. Run a fully customizable team of AI agents in a single Docker container.

Each agent is a Claude Code process with its own system prompt (SKILL.md), role, and permissions. Agents collaborate via a shared task queue and communicate through Telegram bots.

```
User (Telegram) → Orchestrator → Dispatch tasks → Specialized Agents → Results
                                                          ↓
                                              Dashboard (localhost:9800)
```

## Features

- **Fully customizable agents** — define any number of agents with any roles
- **Telegram integration** — control agents via Telegram bots
- **Pixel Office dashboard** — real-time monitoring at `localhost:9800`
- **pg-boss task queue** — reliable PostgreSQL-backed dispatch (via Supabase)
- **Marketplace integration** — optionally import skills from [pixelcompany.fun](https://pixelcompany.fun)
- **Memory system** — agents learn and remember across sessions
- **Security scanning** — built-in AgentShield audit pipeline
- **Single container** — everything runs in one Docker container

## Quick Start

```bash
git clone https://github.com/SaitamaCoderVN/ai-company-oss.git
cd ai-company-oss
cp .env.example .env
# Edit .env with your values (see Configuration below)
docker compose up -d
```

Then open [http://localhost:9800](http://localhost:9800) for the dashboard.

---

## Prerequisites

- **Docker** (Docker Desktop, OrbStack, or Docker Engine)
- **Supabase project** (free tier works) — [supabase.com](https://supabase.com)
- **Claude access** — either a Claude subscription OR an Anthropic API key
- **Telegram bots** — one bot per agent (created via [@BotFather](https://t.me/BotFather))

---

## Setup Guide

### Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. In the SQL Editor, paste and run the contents of `supabase/migrations/001_core.sql`
3. Note your **Project URL**, **anon key**, and **Database URI** from Settings > API / Database

### Step 2: Create Telegram Bots

Create one Telegram bot per agent via [@BotFather](https://t.me/BotFather):

1. Send `/newbot` to @BotFather for each agent
2. Name them however you like (e.g., `MyCompany Orchestrator`, `MyCompany Frontend`)
3. Save each bot token
4. Create a Telegram group and add all bots to it
5. Get the group chat ID (send a message, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)

### Step 3: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# ── Required ──
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
DATABASE_URL=postgresql://postgres.xxx:password@pooler.supabase.com:6543/postgres

# ── Telegram ──
TELEGRAM_GROUP_ID="-100xxxxxxxxxx"
OWNER_TELEGRAM_ID="your-telegram-user-id"

BOT_ORCHESTRATOR="token-from-botfather"
BOT_ARCHITECT="token-from-botfather"
BOT_DESIGN="token-from-botfather"
BOT_FRONTEND="token-from-botfather"
BOT_BACKEND="token-from-botfather"
BOT_SMARTCONTRACT="token-from-botfather"
BOT_RESEARCHER="token-from-botfather"
BOT_TESTER="token-from-botfather"
BOT_SECURITY="token-from-botfather"
BOT_DEVOPS="token-from-botfather"

# ── Agents ──
MAX_WORK_AGENTS=3
AGENT_TIMEOUT_SECONDS=3600
```

### Step 4: Start the Container

```bash
docker compose up -d
```

First build takes ~3 minutes. Check progress with `docker compose logs -f`.

### Step 5: Login to Claude

If using a Claude subscription (not API key), SSH into the container:

```bash
ssh root@localhost -p 2222
# Password: aicompany

claude
# Type /login and follow the OAuth link
# Once logged in, exit with Ctrl+C
```

### Step 6: Verify

Open the dashboard at [http://localhost:9800](http://localhost:9800).
Send a message in your Telegram group — the orchestrator will respond.

---

## Agent Configuration

### Default Agents

The system comes with 10 agent roles. You can modify, remove, or add agents.

| Agent | Role | Description |
|-------|------|-------------|
| `orchestrator` | Coordinator | Receives user requests, decomposes into tasks, dispatches to other agents |
| `architect` | System Design | Architecture diagrams, tech decisions, C4 models |
| `design` | UI/UX | Design specs, tokens, mockups, WCAG compliance |
| `frontend` | Frontend Dev | React, Next.js, Tailwind, TypeScript implementation |
| `backend` | Backend Dev | APIs, databases, server logic |
| `smartcontract` | Blockchain | Solidity, Hardhat (requires human approval for every action) |
| `researcher` | Research | Web search, analysis, documentation (only agent with internet) |
| `tester` | QA | Test suites, coverage validation, feedback loops |
| `security` | Security | OWASP audit, vulnerability scanning (must run last) |
| `devops` | DevOps | Docker, CI/CD, deployment configs |

### Customizing Agents

Each agent is defined by files in the `skills/` directory:

```
skills/
├── shared/              # Loaded by ALL agents
│   ├── RULES.md         # Company-wide rules (safety, approval gates, etc.)
│   ├── COMMUNICATION.md # Inter-agent communication protocol
│   └── MEMORY_PROTOCOL.md
│
├── orchestrator/        # Per-agent skill
│   ├── SKILL.md         # System prompt — defines the agent's role & capabilities
│   └── permissions.json # Access controls, tools, resource limits
│
├── frontend/
│   ├── SKILL.md
│   ├── permissions.json
│   └── learned/         # Skills learned at runtime (auto-generated)
│       └── tailwind-v4.md
│
└── your-custom-agent/   # Add your own!
    ├── SKILL.md
    └── permissions.json
```

### Adding a New Agent

**1. Create the skill directory:**

```bash
mkdir -p skills/my-agent
```

**2. Create `skills/my-agent/SKILL.md`:**

```markdown
---
name: My Custom Agent
description: What this agent does
model: claude-sonnet-4-20250514
---

# My Custom Agent

## Role
Describe the agent's primary function.

## Capabilities
- What it can do
- What tools it uses
- What output it produces

## Rules
- Specific rules for this agent
- See skills/shared/RULES.md for company-wide rules

## Output Format
Describe expected output format.
```

**3. Create `skills/my-agent/permissions.json`:**

```json
{
  "agent_name": "My Agent",
  "memory_mb": 512,
  "allowed_paths": ["tasks/*", "memory/my-agent/*"],
  "denied_paths": ["*.env", ".git/*"],
  "network_access": false,
  "internet_access": false,
  "human_approval_required": false,
  "max_concurrent_tasks": 1,
  "allowed_tools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
}
```

**4. Add a Telegram bot for the agent in `.env`:**

```env
BOT_MY_AGENT="your-bot-token-from-botfather"
```

**5. Register the agent in the router.**

The router automatically discovers agents from `BOT_*` environment variables. The agent name is derived from the variable name: `BOT_MY_AGENT` → agent role `my-agent` (lowercased, underscores become hyphens).

**6. Restart the container:**

```bash
docker compose restart
```

### Removing an Agent

Simply remove or comment out the `BOT_*` line from `.env` and restart:

```env
# BOT_SMARTCONTRACT="..."   ← commented out, agent won't start
```

### Changing the Number of Concurrent Agents

Edit `MAX_WORK_AGENTS` in `.env`:

```env
# How many agents can run tasks simultaneously
# Higher = faster but more RAM/CPU. Each agent uses ~1-2GB RAM.
MAX_WORK_AGENTS=3    # Default: 3 concurrent agents
```

Guidelines:
| RAM Available | Recommended `MAX_WORK_AGENTS` |
|---------------|-------------------------------|
| 4 GB | 1 |
| 8 GB | 2-3 |
| 16 GB | 3-5 |
| 32 GB+ | 5-8 |

---

## Writing Effective SKILL.md Files

The SKILL.md is the system prompt injected into the Claude Code process. It defines everything the agent knows and does.

### Structure

```markdown
---
name: Agent Name
description: One-line description
model: claude-sonnet-4-20250514
---

# Agent Name

## Role
Primary responsibility in 2-3 sentences.

## Capabilities
### Category 1
- Specific capability
- Another capability

### Category 2
- More capabilities

## Rules
- Must-follow rules specific to this agent
- Reference shared rules: "See skills/shared/RULES.md"

## Tools
List of tools the agent can use:
- Read, Write, Edit — file operations
- Bash — shell commands
- Glob, Grep — search
- WebSearch, WebFetch — internet (researcher only)

## Output Format
How the agent should format its deliverables.

## Examples
Show the agent what good output looks like.
```

### Tips

- Be specific about output format and file paths
- Include examples of good output
- Reference `skills/shared/RULES.md` for company-wide rules
- Use `model: claude-sonnet-4-20250514` for fast agents (orchestrator)
- Use `model: claude-opus-4.6-20250514` for complex agents (architect, security)
- Keep SKILL.md under 2000 lines — Claude has context limits

---

## Shared Rules

Create `skills/shared/RULES.md` to define company-wide policies that all agents follow. Example topics:

- Safety and approval gates
- Code quality standards
- Communication protocol (how agents pass work to each other)
- Dependency chain (which agent runs before which)
- Memory protocol (how agents record learnings)
- Human approval requirements per agent

See the [example RULES.md](https://github.com/SaitamaCoderVN/ai-company-oss/wiki/Example-RULES) for a full template.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│            Docker Container                   │
│                                               │
│  ┌─────────────┐    ┌──────────────────────┐ │
│  │   SSH :22    │    │  Dashboard :9800     │ │
│  │  (login      │    │  WebSocket :9803     │ │
│  │   Claude)    │    │  (Pixel Office UI)   │ │
│  └─────────────┘    └──────────────────────┘ │
│                                               │
│  ┌──────────────────────────────────────────┐ │
│  │           Router (Node.js)                │ │
│  │                                           │ │
│  │  Telegram Bots ←→ Task Queue (pg-boss)   │ │
│  │       ↓                                   │ │
│  │  Agent Runner                             │ │
│  │    → claude --print --system-prompt ...   │ │
│  │    → claude --print --system-prompt ...   │ │
│  │    → claude --print --system-prompt ...   │ │
│  │    (up to MAX_WORK_AGENTS concurrent)     │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ skills/  │  │ memory/  │  │ tasks/     │ │
│  │ (SKILL.md│  │(MEMORY.md│  │(dispatch,  │ │
│  │  per     │  │ per      │  │ status,    │ │
│  │  agent)  │  │ agent)   │  │ feedback)  │ │
│  └──────────┘  └──────────┘  └────────────┘ │
└──────────────────────────────────────────────┘
          ↕                    ↕
    Supabase (DB)        Telegram API
```

### How a Task Flows

1. **User** sends a message in the Telegram group
2. **Router** routes it to the **Orchestrator** agent
3. **Orchestrator** analyzes the request and creates a task pipeline
4. Tasks are dispatched to the **pg-boss queue** (PostgreSQL)
5. **Agent Runner** picks up tasks, checks dependencies, spawns Claude processes
6. Each agent runs as: `claude --print --system-prompt "SKILL.md" "task prompt"`
7. Results are stored, dependent agents are unblocked
8. **Dashboard** shows real-time status via WebSocket
9. Final results are posted back to the **Telegram group**

---

## Dashboard (Pixel Office)

The dashboard runs at [http://localhost:9800](http://localhost:9800) and shows:

- Real-time agent status (idle, working, error)
- Current task assignments
- Task pipeline visualization
- Agent memory and output previews
- Cost tracking (if using API key)

The dashboard connects via WebSocket on port 9803 for live updates.

---

## Marketplace Integration (Optional)

Connect to [pixelcompany.fun](https://pixelcompany.fun) to import pre-built agent skills:

```env
PLATFORM_URL=https://pixelcompany.fun
PLATFORM_API_KEY=your-api-key
```

When connected:
- Agents can fetch purchased SKILL.md files from the marketplace
- Agent status is pushed to the platform dashboard
- Falls back to local skills if marketplace is unreachable

See [CONNECTING.md](./CONNECTING.md) for details.

---

## Ports

| Port | Service | Access |
|------|---------|--------|
| 2222 | SSH | `ssh root@localhost -p 2222` (password: `aicompany`) |
| 9800 | Dashboard HTTP | [http://localhost:9800](http://localhost:9800) |
| 9803 | Dashboard WebSocket | Used by dashboard frontend |

---

## Useful Commands

```bash
# Start
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs -f

# Restart after config changes
docker compose restart

# Rebuild after code changes
docker compose up -d --build

# SSH into container
ssh root@localhost -p 2222

# Check agent status
docker exec ai-company cat /data/tasks/agent-status.json | jq .

# View running processes
docker exec ai-company ps aux
```

---

## Troubleshooting

### "Claude auth not found"
SSH into the container and login:
```bash
ssh root@localhost -p 2222
claude
# Type /login and follow the link
```

### Dashboard keeps restarting
Check logs for errors: `docker compose logs -f`. Common cause: missing or malformed task files in `/data/tasks/`.

### Agent stuck in "working" status
The agent process may have died. Restart the container:
```bash
docker compose restart
```

### Telegram bots not responding
- Verify bot tokens in `.env` are correct
- Make sure all bots are added to the Telegram group
- Check that `TELEGRAM_GROUP_ID` is correct (must start with `-100`)

### "DATABASE_URL is required"
The pg-boss queue needs a PostgreSQL connection. Make sure `DATABASE_URL` is set in `.env` with your Supabase connection string.

### Out of memory
Reduce `MAX_WORK_AGENTS` in `.env`. Each agent needs ~1-2GB RAM.

---

## Project Structure

```
ai-company-oss/
├── router/                 # Telegram bots + task dispatch
│   ├── index.js           # Bot routing, commands, message handling
│   ├── agent-runner.js    # Spawns Claude CLI processes
│   ├── agent-manager.js   # Agent lifecycle management
│   ├── skill-handler.js   # Skill loading and approval
│   ├── workspace-manager.js # Git worktree isolation
│   └── logger.js          # Structured logging
│
├── dashboard/              # Pixel Office web UI
│   ├── server.js          # Express :9800 + WebSocket :9803
│   └── public/            # Static HTML/CSS/JS
│
├── lib/                    # Shared libraries
│   ├── platform-client.js # PixelCompany marketplace connector
│   ├── queue.js           # pg-boss task queue
│   ├── browser-server.js  # Puppeteer server (researcher)
│   ├── browser-tool.js    # Browser automation tools
│   ├── embeddings.js      # Vector embeddings
│   └── semantic-search.js # Semantic memory search
│
├── hooks/                  # Agent lifecycle hooks
├── security/               # AgentShield security scanning
├── skills/                 # Agent skills (SKILL.md per agent)
├── memory/                 # Agent memory (auto-generated)
│
├── supabase/
│   └── migrations/
│       └── 001_core.sql   # Database schema
│
├── Dockerfile              # Container build
├── docker-compose.yml      # Production deployment
├── entrypoint.sh           # Container startup script
├── .env.example            # Environment template
├── SETUP.md                # 5-step setup guide
└── CONNECTING.md           # Marketplace connection guide
```

---

## License

MIT — see [LICENSE](./LICENSE)
