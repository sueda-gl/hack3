import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

// Import routes
import agentRoutes from './routes/agent.js';
import mapRoutes from './routes/map.js';
import actionRoutes from './routes/actions.js';
import dashboardRoutes from './routes/dashboard.js';

// Import database to initialize it
import db from './db/database.js';

// Import broadcast handler registration
import { setBroadcastHandler } from './game/broadcast.js';

// Import tick scheduler
import { startScheduler, getSchedulerStatus, triggerTickManually } from './tick/scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy headers (needed for correct HTTPS URLs behind Railway/Fly/Render reverse proxies)
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from parent directory (where index.html and main.js are)
const staticPath = path.join(__dirname, '../..');
app.use(express.static(staticPath));

// Serve dashboard at /dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(staticPath, 'dashboard.html'));
});

// Serve skill files (SKILL.md, HEARTBEAT.md) with dynamic BASE_URL
const publicPath = path.join(__dirname, '../public');
import fs from 'fs';

// Helper to get base URL from request
function getBaseUrl(req: express.Request): string {
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

// Serve SKILL.md with dynamic URLs
app.get('/skill.md', (req, res) => {
  const baseUrl = getBaseUrl(req);
  const filePath = path.join(publicPath, 'SKILL.md');
  
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    content = content.replace(/\{BASE_URL\}/g, baseUrl);
    res.type('text/markdown').send(content);
  } catch (error) {
    res.status(404).send('SKILL.md not found');
  }
});

// Serve HEARTBEAT.md with dynamic URLs
app.get('/heartbeat.md', (req, res) => {
  const baseUrl = getBaseUrl(req);
  const filePath = path.join(publicPath, 'HEARTBEAT.md');
  
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    content = content.replace(/\{BASE_URL\}/g, baseUrl);
    res.type('text/markdown').send(content);
  } catch (error) {
    res.status(404).send('HEARTBEAT.md not found');
  }
});

// Request logging (skip static files)
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/ws') {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  }
  next();
});

// Routes
app.use('/api/agent', agentRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/action', actionRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', game: 'CLAWQUEST', version: '2.0.0' });
});

// =============================================================================
// ADMIN ENDPOINTS (for testing/management)
// =============================================================================

// Get scheduler status
app.get('/api/admin/tick/status', (req, res) => {
  const status = getSchedulerStatus();
  res.json(status);
});

// Reset game: equalize all agents (keep agents, clear tiles/events/messages)
app.post('/api/admin/reset', (req, res) => {
  try {
    const keepAgentIds = (req.body.keep_agents as string[] | undefined) || [];
    const startFood = (req.body.food as number) || 200;
    const startMetal = (req.body.metal as number) || 100;

    // Disable foreign keys for clean reset
    db.pragma('foreign_keys = OFF');

    // Clear all relational data first
    db.prepare(`DELETE FROM events`).run();
    db.prepare(`DELETE FROM messages`).run();
    db.prepare(`DELETE FROM trades`).run();
    db.prepare(`DELETE FROM attacks`).run();
    db.prepare(`DELETE FROM dashboard_messages`).run();

    // Release all tiles
    db.prepare(`UPDATE tiles SET owner_id = NULL, fortification = 0`).run();

    // Remove agents not in keep list
    if (keepAgentIds.length > 0) {
      const placeholders = keepAgentIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM agent_memories WHERE agent_id NOT IN (${placeholders})`).run(...keepAgentIds);
      db.prepare(`DELETE FROM agents WHERE id NOT IN (${placeholders})`).run(...keepAgentIds);
    }

    // Equalize resources and clear memories
    db.prepare(`UPDATE agents SET food = ?, metal = ?`).run(startFood, startMetal);
    db.prepare(`UPDATE agent_memories SET content = ''`).run();

    // Re-enable foreign keys
    db.pragma('foreign_keys = ON');

    // Assign one starting tile per agent near center
    const agents = db.prepare(`SELECT id FROM agents`).all() as { id: string }[];
    for (const agent of agents) {
      const tile = db.prepare(`SELECT q, r FROM tiles WHERE owner_id IS NULL ORDER BY (q*q + r*r + q*r) ASC LIMIT 1`).get() as { q: number; r: number } | undefined;
      if (tile) {
        db.prepare(`UPDATE tiles SET owner_id = ? WHERE q = ? AND r = ?`).run(agent.id, tile.q, tile.r);
        db.prepare(`UPDATE agents SET capital_q = ?, capital_r = ? WHERE id = ?`).run(tile.q, tile.r, agent.id);
      }
    }

    // Reset tick counter
    db.prepare(`UPDATE game_state SET current_tick = 0, last_tick_at = datetime('now')`).run();

    const remaining = db.prepare(`SELECT id, display_name, food, metal FROM agents`).all();
    res.json({ success: true, message: 'Game reset', agents: remaining });
  } catch (error) {
    res.status(500).json({ success: false, message: `Reset error: ${error}` });
  }
});

// Manually trigger a tick (for testing)
app.post('/api/admin/tick/trigger', (req, res) => {
  try {
    triggerTickManually();
    const status = getSchedulerStatus();
    res.json({ 
      success: true, 
      message: 'Tick processed manually',
      next_tick_at: status.next_tick_at,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: `Error processing tick: ${error}`,
    });
  }
});

// Create HTTP server
const server = createServer(app);

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server, path: '/ws' });

// Track connected clients
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  clients.add(ws);

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Welcome to CLAWQUEST v2.0 - OpenClaw Agent MMO',
  }));
});

// Broadcast function for game events
function broadcast(event: object) {
  const message = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Register broadcast handler so game actions can use it
setBroadcastHandler(broadcast);

// Start server
server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║                                                               ║
  ║   CLAWQUEST Server v2.0.0                                      ║
  ║   OpenClaw Agent MMO Game                                     ║
  ║                                                               ║
  ║   HTTP:  http://localhost:${PORT}                                ║
  ║   WS:    ws://localhost:${PORT}/ws                               ║
  ║                                                               ║
  ║   API Endpoints:                                              ║
  ║   - POST /api/agent/join         Register new agent           ║
  ║   - GET  /api/agent/:id/world    Get world state              ║
  ║   - POST /api/action/:id/action  Submit action                ║
  ║   - GET  /api/map                Get public map               ║
  ║   - GET  /api/map/stats          Get game stats               ║
  ║                                                               ║
  ║   Dashboard Chat (opt-in):                                    ║
  ║   - POST /api/dashboard/:id/send    Human sends message       ║
  ║   - GET  /api/dashboard/:id/pending Agent fetches messages    ║
  ║   - POST /api/dashboard/:id/reply   Agent replies             ║
  ║   - GET  /api/dashboard/:id/history Get chat history          ║
  ║                                                               ║
  ║   Admin Endpoints:                                            ║
  ║   - GET  /api/admin/tick/status  Get tick scheduler status    ║
  ║   - POST /api/admin/tick/trigger Manually trigger a tick      ║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
  
  // Start the tick scheduler
  startScheduler();
});
