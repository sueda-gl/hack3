import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database file location (configurable via DATA_DIR env var for deployed environments)
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'clawquest.db');

// Ensure data directory exists before opening database
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
const db: DatabaseType = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Create tables
function initializeDatabase() {
  // =============================================================================
  // AGENTS TABLE
  // Registered players (OpenClaw agents)
  // =============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      display_name TEXT UNIQUE NOT NULL,
      
      -- Resources
      food INTEGER DEFAULT 100,
      metal INTEGER DEFAULT 50,
      
      -- Capital tile coordinates (one per agent)
      capital_q INTEGER,
      capital_r INTEGER,
      
      -- Optional webhook for real-time notifications
      webhook_url TEXT,
      webhook_token TEXT,
      
      -- OpenClaw gateway API token (for /v1/chat/completions - dashboard chat)
      gateway_token TEXT,
      
      -- Human-provided strategy for the agent
      custom_strategy TEXT,
      
      -- Dashboard chat feature (opt-in, requires human to enable)
      dashboard_chat_enabled INTEGER DEFAULT 0,
      
      -- Timestamps
      joined_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT
    )
  `);

  // =============================================================================
  // AGENT MEMORIES TABLE
  // Simple Markdown blob per agent (mirrors OpenClaw's memory approach)
  // =============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id),
      content TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // =============================================================================
  // TILES TABLE (hex map)
  // =============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS tiles (
      q INTEGER NOT NULL,
      r INTEGER NOT NULL,
      terrain TEXT DEFAULT 'barren',
      owner_id TEXT REFERENCES agents(id),
      fortification INTEGER DEFAULT 0,
      PRIMARY KEY (q, r)
    )
  `);

  // =============================================================================
  // MESSAGES TABLE (private agent-to-agent)
  // =============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id TEXT REFERENCES agents(id),
      to_id TEXT REFERENCES agents(id),
      content TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // =============================================================================
  // TRADES TABLE (pending trade proposals)
  // =============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id TEXT REFERENCES agents(id),
      to_id TEXT REFERENCES agents(id),
      offer_food INTEGER DEFAULT 0,
      offer_metal INTEGER DEFAULT 0,
      request_food INTEGER DEFAULT 0,
      request_metal INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    )
  `);

  // =============================================================================
  // ATTACKS TABLE (pending attacks awaiting resolution)
  // =============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS attacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attacker_id TEXT REFERENCES agents(id),
      target_q INTEGER NOT NULL,
      target_r INTEGER NOT NULL,
      commitment INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      resolves_at TEXT,
      FOREIGN KEY (target_q, target_r) REFERENCES tiles(q, r)
    )
  `);

  // =============================================================================
  // EVENTS TABLE (public game log)
  // =============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      actor_id TEXT REFERENCES agents(id),
      description TEXT NOT NULL,
      data TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // =============================================================================
  // GAME STATE TABLE (singleton for tick tracking)
  // =============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_tick INTEGER DEFAULT 0,
      last_tick_at TEXT,
      tick_interval_hours INTEGER DEFAULT 2
    )
  `);

  // =============================================================================
  // DASHBOARD MESSAGES TABLE
  // Human-to-agent communication via the game dashboard (opt-in feature)
  // =============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      direction TEXT NOT NULL CHECK (direction IN ('human_to_agent', 'agent_to_human')),
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'read')),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Index for efficient queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_dashboard_messages_agent_status 
    ON dashboard_messages(agent_id, status)
  `);

  // Initialize game state if not exists
  const gameState = db.prepare('SELECT * FROM game_state WHERE id = 1').get();
  if (!gameState) {
    db.prepare(`
      INSERT INTO game_state (id, current_tick, last_tick_at, tick_interval_hours)
      VALUES (1, 0, datetime('now'), 2)
    `).run();
  }

  // Generate initial hex grid if empty
  const tileCount = db.prepare('SELECT COUNT(*) as count FROM tiles').get() as { count: number };
  if (tileCount.count === 0) {
    generateInitialGrid();
  }

  console.log('Database initialized with new schema');

  // Migration: Add capital columns if they don't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE agents ADD COLUMN capital_q INTEGER`);
    db.exec(`ALTER TABLE agents ADD COLUMN capital_r INTEGER`);
    console.log('Migration: Added capital_q and capital_r columns to agents');
  } catch (e) {
    // Columns already exist, ignore
  }

  // Migration: Add dashboard_chat_enabled column if it doesn't exist
  try {
    db.exec(`ALTER TABLE agents ADD COLUMN dashboard_chat_enabled INTEGER DEFAULT 0`);
    console.log('Migration: Added dashboard_chat_enabled column to agents');
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: Add gateway_token column if it doesn't exist
  try {
    db.exec(`ALTER TABLE agents ADD COLUMN gateway_token TEXT`);
    console.log('Migration: Added gateway_token column to agents');
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: Add grid_radius to game_state if it doesn't exist
  try {
    db.exec(`ALTER TABLE game_state ADD COLUMN grid_radius INTEGER DEFAULT 8`);
    console.log('Migration: Added grid_radius column to game_state');
  } catch (e) {
    // Column already exists, ignore
  }
}

// Generate hexagonal grid
function generateInitialGrid() {
  const gridRadius = 8;
  const insert = db.prepare(`
    INSERT INTO tiles (q, r, terrain, owner_id, fortification)
    VALUES (?, ?, ?, NULL, 0)
  `);

  const insertMany = db.transaction(() => {
    for (let q = -gridRadius; q <= gridRadius; q++) {
      const r1 = Math.max(-gridRadius, -q - gridRadius);
      const r2 = Math.min(gridRadius, -q + gridRadius);

      for (let r = r1; r <= r2; r++) {
        const terrain = randomTerrain();
        insert.run(q, r, terrain);
      }
    }
  });

  insertMany();
  console.log('Generated initial hex grid');
}

// Random terrain distribution
function randomTerrain(): string {
  const rand = Math.random();
  if (rand < 0.25) return 'farmland';  // 25% - food production
  if (rand < 0.45) return 'mine';      // 20% - metal production
  if (rand < 0.55) return 'mixed';     // 10% - both resources
  return 'barren';                      // 45% - minimal resources
}

// =============================================================================
// MAP EXPANSION
// =============================================================================

/**
 * Get coordinates for all tiles at exactly hex distance `d` from origin.
 * Uses the standard hex ring walk algorithm:
 *   Start at axial(-d, d), walk 6 edges of `d` steps each.
 */
function getHexRingCoords(d: number): Array<{ q: number; r: number }> {
  if (d === 0) return [{ q: 0, r: 0 }];

  // Direction vectors for walking around the ring (clockwise)
  const directions = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];

  const coords: Array<{ q: number; r: number }> = [];
  let q = -d;
  let r = d;

  for (const dir of directions) {
    for (let step = 0; step < d; step++) {
      coords.push({ q, r });
      q += dir.q;
      r += dir.r;
    }
  }

  return coords;
}

/**
 * Get the current grid radius from game_state.
 */
export function getGridRadius(): number {
  const row = db.prepare('SELECT grid_radius FROM game_state WHERE id = 1').get() as { grid_radius: number } | undefined;
  return row?.grid_radius ?? 8;
}

/**
 * Get the number of unclaimed tiles on the map.
 */
export function getUnclaimedCount(): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM tiles WHERE owner_id IS NULL').get() as { count: number };
  return row.count;
}

/**
 * Expand the hex grid by adding new rings of tiles around the current border.
 * @param rings - Number of new rings to add (default: 2)
 * @returns Object with the new radius and count of tiles added
 */
export function expandGrid(rings: number = 2): { newRadius: number; tilesAdded: number } {
  const currentRadius = getGridRadius();
  const newRadius = currentRadius + rings;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO tiles (q, r, terrain, owner_id, fortification)
    VALUES (?, ?, ?, NULL, 0)
  `);

  let tilesAdded = 0;

  const expandTransaction = db.transaction(() => {
    // Generate tiles for each new ring
    for (let d = currentRadius + 1; d <= newRadius; d++) {
      const ringCoords = getHexRingCoords(d);
      for (const { q, r } of ringCoords) {
        const result = insert.run(q, r, randomTerrain());
        if (result.changes > 0) tilesAdded++;
      }
    }

    // Update the stored grid radius
    db.prepare('UPDATE game_state SET grid_radius = ? WHERE id = 1').run(newRadius);
  });

  expandTransaction();

  console.log(`[Map] Expanded grid: radius ${currentRadius} → ${newRadius} (+${tilesAdded} tiles)`);
  return { newRadius, tilesAdded };
}

// Initialize on import
initializeDatabase();

export default db;
