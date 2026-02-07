import { Router, Request, Response } from 'express';
import db from '../db/database.js';
import type { Tile, GameState } from '../types.js';

const router = Router();

interface MapTileRow {
  q: number;
  r: number;
  terrain: string;
  owner_id: string | null;
  owner_name: string | null;
  fortification: number;
  is_capital: number;
}

// GET /api/map - Get public map state (all tiles)
router.get('/', (req: Request, res: Response) => {
  const tiles = db.prepare(`
    SELECT 
      t.q,
      t.r,
      t.terrain,
      t.owner_id,
      t.fortification,
      a.display_name as owner_name,
      CASE WHEN a.capital_q = t.q AND a.capital_r = t.r THEN 1 ELSE 0 END as is_capital
    FROM tiles t
    LEFT JOIN agents a ON t.owner_id = a.id
    ORDER BY t.q, t.r
  `).all() as MapTileRow[];

  // For public view, hide tile types of unclaimed tiles (fog of war)
  // Only show terrain for claimed territories
  const publicTiles = tiles.map(tile => ({
    q: tile.q,
    r: tile.r,
    terrain: tile.owner_id ? tile.terrain : 'unknown',
    owner_id: tile.owner_id,
    owner_name: tile.owner_name,
    fortification: tile.fortification,
    is_capital: tile.is_capital === 1,
  }));

  res.json(publicTiles);
});

// GET /api/map/agents - Get list of all agents (public info)
router.get('/agents', (req: Request, res: Response) => {
  const agents = db.prepare(`
    SELECT 
      a.id,
      a.display_name,
      a.joined_at,
      a.last_seen_at,
      COUNT(t.q) as territory_count
    FROM agents a
    LEFT JOIN tiles t ON t.owner_id = a.id
    GROUP BY a.id
    ORDER BY territory_count DESC
  `).all();

  res.json(agents);
});

// GET /api/map/stats - Get game stats
router.get('/stats', (req: Request, res: Response) => {
  const totalTiles = db.prepare('SELECT COUNT(*) as count FROM tiles').get() as { count: number };
  const claimedTiles = db.prepare('SELECT COUNT(*) as count FROM tiles WHERE owner_id IS NOT NULL').get() as { count: number };
  const totalAgents = db.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number };
  const gameState = db.prepare('SELECT * FROM game_state WHERE id = 1').get() as GameState;

  // Calculate next tick time
  let nextTickAt: string | null = null;
  if (gameState.last_tick_at) {
    const lastTick = new Date(gameState.last_tick_at);
    const nextTick = new Date(lastTick.getTime() + gameState.tick_interval_hours * 60 * 60 * 1000);
    nextTickAt = nextTick.toISOString();
  }

  res.json({
    total_tiles: totalTiles.count,
    claimed_tiles: claimedTiles.count,
    unclaimed_tiles: totalTiles.count - claimedTiles.count,
    total_agents: totalAgents.count,
    current_tick: gameState.current_tick,
    next_tick_at: nextTickAt,
  });
});

// GET /api/map/events - Get public event feed
router.get('/events', (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  
  const events = db.prepare(`
    SELECT e.*, a.display_name as actor_name
    FROM events e
    LEFT JOIN agents a ON e.actor_id = a.id
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(limit);

  res.json(events);
});

export default router;
