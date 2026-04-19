# ═══════════════════════════════════════════════════════════════
# AI Agent Company — All-in-One Container
# ═══════════════════════════════════════════════════════════════
# Single container running:
#   - Router + Orchestrator (Node.js)
#   - Dashboard (Express + WebSocket)
#   - Claude Code CLI (shared auth for all agents)
#   - SSH server (for manual login & debugging)
#   - Chromium + Puppeteer (for researcher agent)
#
# Agents are NOT separate containers — they are Claude CLI
# processes spawned with different system prompts.
# ═══════════════════════════════════════════════════════════════

FROM node:20-slim

LABEL description="AI Agent Company — All-in-One"

# ─── System packages ────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    openssh-server \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-khmeros \
    fonts-freefont-ttf \
    procps \
    jq \
    vim-tiny \
    && rm -rf /var/lib/apt/lists/*

# ─── SSH setup ──────────────────────────────────────────────────
RUN mkdir -p /var/run/sshd \
    && echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config \
    && echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config \
    && echo 'root:aicompany' | chpasswd

# ─── Install Claude Code CLI ───────────────────────────────────
RUN npm install -g @anthropic-ai/claude-code

# ─── Install gh CLI (for PR creation) ──────────────────────────
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# ─── Puppeteer config ──────────────────────────────────────────
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# ─── Project structure ──────────────────────────────────────────
RUN mkdir -p /app /workspace /data/tasks /data/memory /data/knowledge \
    /data/skill-queue /data/skill-store /data/reports /data/logs

WORKDIR /app

# ─── Install dependencies ──────────────────────────────────────
COPY package.json /app/package.json
RUN npm install --production --ignore-scripts 2>/dev/null || true

# ─── Copy application code ─────────────────────────────────────
COPY . /app/

# ─── Entrypoint ────────────────────────────────────────────────
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

# ─── Chromium flags for container ──────────────────────────────
ENV CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage"

# ─── Expose ports ──────────────────────────────────────────────
# 22   — SSH
# 9800 — Dashboard HTTP
# 9803 — Dashboard WebSocket
EXPOSE 22 9800 9803

# ─── Health check ──────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -sf http://localhost:9800/api/status || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
