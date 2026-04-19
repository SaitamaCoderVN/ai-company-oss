#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# AI Agent Company — All-in-One Entrypoint
# ═══════════════════════════════════════════════════════════════
# Starts all services inside a single container:
#   1. SSH server (for manual login & debugging)
#   2. Dashboard (Express + WebSocket on :9800/:9803)
#   3. Router (Telegram bots + agent orchestration)
# ═══════════════════════════════════════════════════════════════

set -e

echo "╔══════════════════════════════════════════════╗"
echo "║   AI Agent Company — All-in-One Container    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ─── 1. Setup Claude auth ──────────────────────────────────────
CLAUDE_DIR="$HOME/.claude"
CLAUDE_JSON="$HOME/.claude.json"

echo "[startup] Checking Claude auth..."
if [ -f "$CLAUDE_JSON" ]; then
    echo "[startup] ✅ .claude.json found ($(wc -c < "$CLAUDE_JSON") bytes)"
else
    echo "[startup] ⚠️  No .claude.json — login via SSH:"
    echo "[startup]    ssh root@localhost -p 2222"
    echo "[startup]    Then run: claude  →  /login"
fi

if [ -d "$CLAUDE_DIR" ]; then
    echo "[startup] ✅ .claude/ dir found ($(ls "$CLAUDE_DIR" 2>/dev/null | wc -w) items)"
else
    echo "[startup] ⚠️  No .claude/ directory — will be created on first login"
    mkdir -p "$CLAUDE_DIR"
fi

# Pre-trust workspace directories
PROJECTS_DIR="$CLAUDE_DIR/projects"
mkdir -p "$PROJECTS_DIR" 2>/dev/null || true

for dir in workspace app data; do
    SETTINGS_DIR="$PROJECTS_DIR/-${dir}"
    mkdir -p "$SETTINGS_DIR" 2>/dev/null || true
    echo '{"trusted":true,"allowedTools":["*"]}' > "$SETTINGS_DIR/settings.json" 2>/dev/null || true
done
echo "[startup] ✅ Pre-trusted /workspace, /app, /data directories"

# ─── 2. Symlink data directories ───────────────────────────────
# Ensure router & dashboard find data in expected locations
# /data is the persistent volume, /app is the code
# Skip directories mounted read-only from host (skills, knowledge, config)
for dir in tasks memory skill-queue skill-store reports; do
    if [ ! -L "/app/$dir" ] && [ -d "/data/$dir" ]; then
        # Remove existing dir if it's not a symlink, backup contents
        if [ -d "/app/$dir" ]; then
            cp -rn "/app/$dir/"* "/data/$dir/" 2>/dev/null || true
            rm -rf "/app/$dir"
        fi
        ln -sf "/data/$dir" "/app/$dir"
    fi
done

# Knowledge: sync host mount (read-only) into writable /data volume
if [ -d "/app/knowledge-host" ]; then
    cp -rn /app/knowledge-host/* /data/knowledge/ 2>/dev/null || true
    echo "[startup] ✅ Knowledge synced from host"
fi
if [ ! -L "/app/knowledge" ]; then
    rm -rf /app/knowledge 2>/dev/null || true
    ln -sf /data/knowledge /app/knowledge
fi

# Skills: sync host mount into writable /data volume
# Agents need write access for learned skills (continuous learning)
if [ -d "/app/skills-host" ]; then
    cp -rn /app/skills-host/* /data/skills/ 2>/dev/null || true
    echo "[startup] ✅ Skills synced from host"
fi
if [ ! -L "/app/skills" ]; then
    rm -rf /app/skills 2>/dev/null || true
    ln -sf /data/skills /app/skills
fi
echo "[startup] ✅ Data directories linked"

# ─── 3. Start SSH server ───────────────────────────────────────
echo "[startup] Starting SSH server on port 22..."
/usr/sbin/sshd -D &
SSH_PID=$!
echo "[startup] ✅ SSH server started (PID: $SSH_PID)"
echo "[startup]    Connect: ssh root@localhost -p 2222"
echo "[startup]    Password: aicompany"
echo ""

# ─── 4. Start Dashboard ────────────────────────────────────────
echo "[startup] Starting Dashboard on :9800..."
cd /app/dashboard
node server.js &
DASHBOARD_PID=$!
echo "[startup] ✅ Dashboard started (PID: $DASHBOARD_PID)"
echo ""

# ─── 5. Start Router ───────────────────────────────────────────
echo "[startup] Starting Router (Telegram bots)..."
cd /app/router

# CRITICAL: Set DOCKER_MODE=false — agents run as local processes
export DOCKER_MODE=false
export AI_COMPANY_DIR=/app

node index.js &
ROUTER_PID=$!
echo "[startup] ✅ Router started (PID: $ROUTER_PID)"
echo ""

# ─── 6. Summary ────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════╗"
echo "║  All services running!                       ║"
echo "║                                              ║"
echo "║  SSH:       port 2222 (root/aicompany)       ║"
echo "║  Dashboard: http://localhost:9800             ║"
echo "║  WebSocket: ws://localhost:9803               ║"
echo "║                                              ║"
echo "║  Login Claude:                               ║"
echo "║    ssh root@localhost -p 2222                 ║"
echo "║    claude  →  /login                          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ─── 7. Keep container alive & handle signals ──────────────────
cleanup() {
    echo "[shutdown] Stopping services..."
    kill $ROUTER_PID 2>/dev/null
    kill $DASHBOARD_PID 2>/dev/null
    kill $SSH_PID 2>/dev/null
    echo "[shutdown] Done."
    exit 0
}

trap cleanup SIGTERM SIGINT

# Wait for any process to exit — if one dies, log it
while true; do
    # Check if router is still running (most critical)
    if ! kill -0 $ROUTER_PID 2>/dev/null; then
        echo "[watchdog] ⚠️  Router died! Restarting..."
        cd /app/router
        node index.js &
        ROUTER_PID=$!
    fi

    # Check dashboard
    if ! kill -0 $DASHBOARD_PID 2>/dev/null; then
        echo "[watchdog] ⚠️  Dashboard died! Restarting..."
        cd /app/dashboard
        node server.js &
        DASHBOARD_PID=$!
    fi

    sleep 10
done
