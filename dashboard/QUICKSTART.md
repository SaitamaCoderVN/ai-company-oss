# Quick Start Guide - Pixel Dashboard

## Setup

1. Install dependencies:
```bash
cd /sessions/gifted-jolly-planck/mnt/Agent_Company/ai-company/dashboard
npm install
```

2. Start the server:
```bash
npm start
```

You should see:
```
Dashboard running at http://localhost:9800
WebSocket server running on ws://localhost:9801
```

3. Open your browser and navigate to:
```
http://localhost:9800
```

## What You'll See

When the dashboard loads:

1. **HUD Bar (Top)**: 
   - System time
   - Tick counter
   - Active agent count
   - RAM and CPU usage graphs

2. **Canvas (Main Area)**:
   - Two pixel art rooms with retro aesthetic
   - Left: Work Room (3 active agents working at desks)
   - Right: Wait Room (idle agents waiting)
   - Each agent is a 16x16 pixel character
   - Walking animations for working agents
   - Progress bars above active agents

3. **Detail Panel (Right Side)**:
   - Click any agent to see detailed information
   - Shows task, progress, RAM usage, skills, and logs
   - Slides in smoothly from the right

4. **Connection Status (Top-Right)**:
   - Green dot = connected to WebSocket
   - Red dot = disconnected (auto-reconnecting)

## Updating Agent Status

The dashboard reads from `tasks/agent-status.json` every 1 second.

To update agent status, modify the JSON file:

```bash
# Edit the agent status file
vi tasks/agent-status.json
```

Example: Change agent progress
```json
{
  "id": "agent-1",
  "name": "ORACLE",
  "role": "orchestrator",
  "status": "working",
  "current_task": "Processing request #42",
  "progress": 85,  // Change this to update progress bar
  "ram_usage": 128,
  "skills": ["Planning", "Coordination"],
  "logs": ["New task started"]
}
```

The dashboard will automatically update in real-time as the JSON file changes.

## Adding More Agents

Add to the `agents` array in `tasks/agent-status.json`:

```json
{
  "id": "agent-9",
  "name": "NEXUS",
  "role": "frontend",
  "status": "working",
  "current_task": "Building UI components",
  "progress": 45,
  "ram_usage": 95,
  "skills": ["React", "TypeScript", "CSS"],
  "logs": ["Component rendering", "State management"]
}
```

Available roles: `orchestrator`, `architect`, `design`, `frontend`, `backend`, `smart-contract`, `researcher`, `tester`, `security`, `devops`

## Testing Features

### Test Agent Animation
1. Keep an agent with `"status": "working"`
2. You'll see it walking at the desk

### Test Progress Bars
1. Change an agent's `progress` value to 0-100
2. Progress bar appears above the agent's head

### Test Detail Panel
1. Click on any agent character
2. Panel slides in from the right with details
3. Click × to close

### Test Real-Time Updates
1. Open two terminal windows
2. In window 1: Run the dashboard
3. In window 2: Edit `tasks/agent-status.json`
4. Save changes and watch dashboard update instantly

### Test Auto-Reconnect
1. Dashboard is running
2. Stop the server (Ctrl+C)
3. Connection status changes to red
4. Restart the server (npm start)
5. Connection status returns to green automatically

## System Metrics

Update system metrics in `tasks/agent-status.json`:

```json
{
  "tick": 42,           // Tick counter in HUD
  "ram_usage": 65,      // 0-100 percentage
  "cpu_usage": 48,      // 0-100 percentage
  "agents": [...]
}
```

## Pixel Art Styling

The dashboard features:
- 16x16 pixel agent characters
- Grid-based floor pattern
- Pixel desks and chairs
- Retro scanline overlay
- Smooth pixel animations
- Dark theme with neon accents

## Troubleshooting

**Dashboard shows red connection dot**
- Make sure WebSocket server is running on port 9801
- Check browser console for errors (F12)
- Dashboard will auto-reconnect

**Canvas not rendering**
- Check browser supports HTML5 Canvas (all modern browsers do)
- Verify page loads without JavaScript errors
- Try a different browser

**Agents not updating**
- Check that `tasks/agent-status.json` is valid JSON
- Use `cat tasks/agent-status.json` to verify file
- Server reads file every 1 second, wait a moment for update

**Port already in use**
- Change PORT in server.js (default 9800)
- Change WS_PORT in server.js (default 9801)
- Or kill existing process: `lsof -i :9800`

## Performance Tips

- Dashboard handles 10-20+ agents smoothly
- Don't update JSON more than once per second
- Browser DevTools shows 60 FPS for smooth rendering
- WebSocket updates throttled to 1Hz to reduce bandwidth

## Next Steps

1. Integrate with your agent system to auto-update `tasks/agent-status.json`
2. Customize colors and roles for your agents
3. Add more rooms or modify layout
4. Extend with additional features (agent communication logs, resource graphs, etc.)

Enjoy your retro AI agent dashboard!
