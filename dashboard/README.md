# Pixel Dashboard - AI Agent Company

A retro pixel art dashboard for monitoring AI agents in real-time.

## Features

- **Real-time Agent Monitoring**: WebSocket connection provides live updates of agent status
- **Pixel Art Rendering**: Everything drawn on HTML Canvas with a retro aesthetic
- **Two-Room System**: 
  - Work Room (left): Up to 3 active agents with desk setups
  - Wait Room (right): Idle agents waiting for task assignment
- **Role-Based Colors**: Each agent role has its own color scheme
- **HUD System**: Real-time display of system metrics (RAM, CPU, tick counter)
- **Interactive Detail Panel**: Click agents to view detailed information
- **Smooth Animations**: Walking animations for active agents, blinking effects
- **Auto-Reconnect**: Automatically reconnects to WebSocket server if connection drops
- **Scanline Effect**: Retro CRT monitor aesthetic overlay

## Installation

```bash
npm install
```

## Running the Dashboard

```bash
npm start
```

The dashboard will be available at `http://localhost:9800`

- HTTP Server runs on port **9800**
- WebSocket Server runs on port **9801**

## Data Structure

The dashboard reads agent status from `tasks/agent-status.json` every 1 second.

### agent-status.json Format

```json
{
  "tick": 0,
  "ram_usage": 45,
  "cpu_usage": 32,
  "agents": [
    {
      "id": "agent-1",
      "name": "ORACLE",
      "role": "orchestrator",
      "status": "working",
      "current_task": "Coordinating agent flow",
      "progress": 65,
      "ram_usage": 128,
      "skills": ["Planning", "Coordination", "Delegation"],
      "logs": ["Task started", "Parsing requirements"]
    }
  ]
}
```

### Agent Fields

- `id`: Unique agent identifier
- `name`: Display name (max 8 chars for optimal display)
- `role`: Agent role (determines color and icon)
- `status`: Either `working` or `idle`
- `current_task`: Description of current task
- `progress`: Progress percentage (0-100)
- `ram_usage`: RAM usage in MB
- `skills`: Array of skill strings
- `logs`: Array of recent activity logs

## Agent Roles & Colors

| Role | Color | Hex |
|------|-------|-----|
| Orchestrator | Teal | #2DD4BF |
| Architect | Purple | #A78BFA |
| Design | Pink | #F472B6 |
| Frontend | Green | #4ADE80 |
| Backend | Blue | #60A5FA |
| Smart Contract | Orange | #FB923C |
| Researcher | Yellow | #FBBF24 |
| Tester | Lime | #A3E635 |
| Security | Red/Coral | #F87171 |
| DevOps | Indigo | #818CF8 |

## Interactions

### Viewing Agent Details
1. Click on any agent character in the canvas
2. A detail panel slides in from the right
3. View detailed agent information:
   - Current task and progress
   - RAM usage
   - Active skills
   - Recent activity logs

### Closing Detail Panel
- Click the × button in the top-right corner of the panel
- Or click elsewhere on the canvas

## Architecture

### Files

- **server.js**: Express HTTP server and WebSocket server
  - Serves static files from `public/`
  - Broadcasts agent status from `tasks/agent-status.json` every 1 second
  - Handles WebSocket connections and graceful shutdown

- **public/index.html**: Single-file dashboard application
  - HTML structure
  - CSS styling with retro aesthetic
  - Canvas-based pixel art rendering
  - JavaScript game loop and WebSocket client

- **tasks/agent-status.json**: Agent status data file
  - Updated by external systems
  - Read by server.js every 1 second
  - Broadcast to all connected clients

## Customization

### Canvas Size
Modify `CONFIG.CANVAS_WIDTH` and `CONFIG.CANVAS_HEIGHT` in `index.html`

### Max Work Room Agents
Modify `CONFIG.WORK_ROOM_MAX_AGENTS` (default: 3)

### Color Scheme
Update `ROLE_COLORS` object to change agent role colors

### Animation Speed
Modify `CONFIG.ANIMATION_FRAME_INTERVAL` to change animation speed

### Update Frequency
Modify the interval in `server.js` (currently 1000ms)

## Performance Notes

- Designed to handle 10-20+ agents without performance issues
- Canvas rendering uses `image-rendering: pixelated` for authentic pixel look
- WebSocket updates are throttled to 1Hz to reduce bandwidth
- Auto-reconnection uses exponential backoff (max 5 seconds)

## Shutdown

The server handles graceful shutdown on SIGTERM and SIGINT signals:
- Closes all WebSocket connections
- Closes HTTP server
- 10-second timeout before forced shutdown

```bash
# Gracefully shutdown
Ctrl+C
```

## Browser Compatibility

- Chrome/Chromium 60+
- Firefox 55+
- Safari 11+
- Edge 79+

Requires WebSocket support and HTML5 Canvas.
