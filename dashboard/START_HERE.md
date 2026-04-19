# Pixel Dashboard - START HERE

Welcome to the Pixel Dashboard for the AI Agent Company!

This is a complete, production-ready retro pixel art dashboard for monitoring AI agents in real-time.

## Quick Links

### Getting Started (5 minutes)
1. **[QUICKSTART.md](QUICKSTART.md)** - Setup and usage guide
2. Run: `npm install && npm start`
3. Open: `http://localhost:9800`

### Documentation
- **[README.md](README.md)** - Overview and features
- **[FEATURES.md](FEATURES.md)** - Complete feature reference
- **[INSTALLATION.md](INSTALLATION.md)** - Deployment and production setup
- **[FILE_MANIFEST.md](FILE_MANIFEST.md)** - All files and structure
- **[PROJECT_SUMMARY.txt](PROJECT_SUMMARY.txt)** - High-level summary

### Tools & Utilities
- **[update-status.py](update-status.py)** - Update agent status
  - `./update-status.py --init` - Initialize sample data
  - `./update-status.py --loop` - Continuous updates for testing
- **[test-scenarios.sh](test-scenarios.sh)** - Interactive test menu

## What's Included

**Core Files:**
- `server.js` - Express + WebSocket server
- `public/index.html` - Complete dashboard (HTML + CSS + JS, single file)
- `package.json` - Node.js dependencies

**Data:**
- `tasks/agent-status.json` - Agent status data (updates in real-time)

**Documentation:**
- 5 comprehensive markdown guides
- Inline code comments
- Usage examples

## System Requirements

- Node.js 14+ (with npm)
- Modern web browser
- Ports 9800 and 9801 available
- Python 3.6+ (optional, for utilities)

## Installation (3 steps)

```bash
# 1. Install dependencies
npm install

# 2. Start server
npm start

# 3. Open browser
# Navigate to: http://localhost:9800
```

## Features at a Glance

✓ Real-time WebSocket updates (1Hz)  
✓ 16x16 pixel agent characters  
✓ Two rooms: Work Room (3 active) + Wait Room (idle)  
✓ Walking animations for active agents  
✓ 10 agent roles with unique colors  
✓ Progress bars with glow effects  
✓ Interactive detail panel (click agent for info)  
✓ HUD with system metrics (RAM, CPU, tick count)  
✓ Retro pixel art with scanline effect  
✓ 60 FPS smooth rendering  
✓ Auto-reconnect on disconnect  

## Common Tasks

### Running the Dashboard
```bash
npm start
# Then open http://localhost:9800
```

### Testing with Sample Data
```bash
./test-scenarios.sh
# Interactive menu with 9 test options
```

### Continuous Updates for Development
```bash
./update-status.py --loop
# Updates agent-status.json every second
```

### Initializing Sample Agents
```bash
./update-status.py --init
# Creates 8 sample agents with realistic data
```

### Production Deployment
```bash
# See INSTALLATION.md for:
# - PM2 setup
# - Docker container
# - Systemd service
# - Nginx reverse proxy
```

## Directory Structure

```
dashboard/
├── package.json              # Dependencies
├── server.js                # Server (Express + WebSocket)
├── public/index.html        # Dashboard (single file)
├── tasks/
│   └── agent-status.json   # Agent data
├── update-status.py        # Data utility
├── test-scenarios.sh       # Test menu
└── [Documentation files]   # Guides
```

## Data Format

Update `tasks/agent-status.json` to see live changes:

```json
{
  "tick": 42,
  "ram_usage": 65,
  "cpu_usage": 48,
  "agents": [
    {
      "id": "agent-1",
      "name": "ORACLE",
      "role": "orchestrator",
      "status": "working",
      "current_task": "Coordinating flow",
      "progress": 75,
      "ram_usage": 128,
      "skills": ["Planning", "Coordination"],
      "logs": ["Task started", "Processing..."]
    }
  ]
}
```

## Agent Roles & Colors

| Role | Color |
|------|-------|
| Orchestrator | Teal |
| Architect | Purple |
| Design | Pink |
| Frontend | Green |
| Backend | Blue |
| Smart Contract | Orange |
| Researcher | Yellow |
| Tester | Lime |
| Security | Red |
| DevOps | Indigo |

## Performance

- Canvas rendering: 60 FPS
- WebSocket updates: 1 Hz (every 1 second)
- Agents supported: 20+ without lag
- Memory usage: <100 MB
- Browser support: Chrome 60+, Firefox 55+, Safari 11+, Edge 79+

## Troubleshooting

**Dashboard not loading?**
1. Check server is running: `npm start`
2. Open browser console: F12
3. Verify ports 9800/9801 are available

**Agents not updating?**
1. Check `tasks/agent-status.json` exists
2. Verify JSON syntax
3. Restart server

**WebSocket connection failing?**
1. Ensure port 9801 is open
2. Check firewall settings
3. See INSTALLATION.md for details

## Next Steps

1. **Read** [QUICKSTART.md](QUICKSTART.md) (5 minutes)
2. **Run** `npm install && npm start`
3. **Test** `./test-scenarios.sh`
4. **Customize** colors, roles, agents
5. **Deploy** to production (see INSTALLATION.md)

## Project Status

✓ Complete and ready for production  
✓ All features implemented  
✓ Comprehensive documentation  
✓ Test utilities included  
✓ Multiple deployment options  

---

**Questions?** Check the relevant documentation file above, or see [INSTALLATION.md](INSTALLATION.md) for troubleshooting.

**Ready?** Start with: `npm install && npm start`
