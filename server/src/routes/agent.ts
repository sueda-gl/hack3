import { Router, Request, Response } from 'express';
import db from '../db/database.js';
import type { 
  Agent, 
  Tile, 
  Message, 
  Trade,
  Attack,
  GameEvent,
  AgentMemory,
  GameState,
  JoinRequest, 
  JoinResponse, 
  WorldResponse,
  VisibleTile,
  TerrainType,
  GAME_CONSTANTS as GameConstantsType,
} from '../types.js';
import { GAME_CONSTANTS } from '../types.js';
import { getPendingTrades } from '../game/communication.js';
import { broadcastAgentJoined } from '../game/broadcast.js';
import { getNeighbors } from '../game/actions.js';

const router = Router();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Find an unclaimed tile for new agent (prefers tiles near center)
function findStartingTile(): Tile | null {
  const tile = db.prepare(`
    SELECT * FROM tiles 
    WHERE owner_id IS NULL 
    ORDER BY (q * q + r * r + q * r) ASC
    LIMIT 1
  `).get() as Tile | undefined;

  return tile || null;
}

// Get agent by ID (for auth)
function getAgentById(id: string): Agent | null {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
  return agent || null;
}

// =============================================================================
// POST /api/agent/join - Register a new agent
// =============================================================================

router.post('/join', (req: Request, res: Response) => {
  const body = req.body as JoinRequest;
  const { agent_id, display_name, webhook_url, webhook_token, custom_strategy } = body;

  // Validate agent_id
  if (!agent_id || typeof agent_id !== 'string' || agent_id.trim().length < 2) {
    res.status(400).json({ error: 'agent_id must be at least 2 characters' });
    return;
  }

  // Validate display_name
  if (!display_name || typeof display_name !== 'string' || display_name.trim().length < 2) {
    res.status(400).json({ error: 'display_name must be at least 2 characters' });
    return;
  }

  const trimmedId = agent_id.trim();
  const trimmedName = display_name.trim();

  // Check if agent_id already exists
  const existingById = db.prepare('SELECT id FROM agents WHERE id = ?').get(trimmedId);
  if (existingById) {
    res.status(409).json({ error: 'Agent ID already registered' });
    return;
  }

  // Check if display_name already exists
  const existingByName = db.prepare('SELECT id FROM agents WHERE display_name = ?').get(trimmedName);
  if (existingByName) {
    res.status(409).json({ error: 'Display name already taken' });
    return;
  }

  // Find starting tile
  const startingTile = findStartingTile();
  if (!startingTile) {
    res.status(503).json({ error: 'No available tiles. Map is full.' });
    return;
  }

  try {
    const joinTransaction = db.transaction(() => {
      // Insert agent
      db.prepare(`
        INSERT INTO agents (id, display_name, food, metal, webhook_url, webhook_token, custom_strategy)
        VALUES (?, ?, 100, 50, ?, ?, ?)
      `).run(trimmedId, trimmedName, webhook_url || null, webhook_token || null, custom_strategy || null);

      // Create empty memory for agent
      db.prepare(`
        INSERT INTO agent_memories (agent_id, content)
        VALUES (?, '')
      `).run(trimmedId);

      // Assign starting tile
      db.prepare(`
        UPDATE tiles SET owner_id = ? WHERE q = ? AND r = ?
      `).run(trimmedId, startingTile.q, startingTile.r);

      // Log event
      db.prepare(`
        INSERT INTO events (type, actor_id, description, data)
        VALUES ('join', ?, ?, ?)
      `).run(trimmedId, `${trimmedName} has entered the game`, JSON.stringify({
        tile: { q: startingTile.q, r: startingTile.r },
        terrain: startingTile.terrain,
      }));
    });

    joinTransaction();

    // Broadcast to connected clients
    broadcastAgentJoined({ id: trimmedId, display_name: trimmedName });

    const response: JoinResponse = {
      success: true,
      agent_id: trimmedId,
      display_name: trimmedName,
      starting_tile: {
        q: startingTile.q,
        r: startingTile.r,
        terrain: startingTile.terrain as TerrainType,
      },
      resources: {
        food: 100,
        metal: 50,
      },
    };

    console.log(`Agent joined: ${trimmedName} (${trimmedId}) at (${startingTile.q}, ${startingTile.r})`);
    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating agent:', error);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// =============================================================================
// GET /api/agent/:id/world - Get full world state for agent
// =============================================================================

router.get('/:id/world', (req: Request, res: Response) => {
  const id = req.params.id as string;

  // Get agent
  const agent = getAgentById(id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  // Update last_seen_at
  db.prepare(`UPDATE agents SET last_seen_at = datetime('now') WHERE id = ?`).run(id);

  // Get agent's territories
  const territories = db.prepare(`
    SELECT * FROM tiles WHERE owner_id = ?
  `).all(agent.id) as Tile[];

  // Get all neighbor coordinates
  const neighborCoords = new Set<string>();
  const ownedCoords = new Set(territories.map(t => `${t.q},${t.r}`));

  for (const territory of territories) {
    for (const neighbor of getNeighbors(territory.q, territory.r)) {
      const key = `${neighbor.q},${neighbor.r}`;
      if (!ownedCoords.has(key)) {
        neighborCoords.add(key);
      }
    }
  }

  // Get visible tiles (neighbors) with owner info
  const visibleTiles: VisibleTile[] = [];

  for (const coord of neighborCoords) {
    const [q, r] = coord.split(',').map(Number);
    const tile = db.prepare(`
      SELECT t.*, a.display_name as owner_name 
      FROM tiles t 
      LEFT JOIN agents a ON t.owner_id = a.id
      WHERE t.q = ? AND t.r = ?
    `).get(q, r) as (Tile & { owner_name: string | null }) | undefined;

    if (tile) {
      visibleTiles.push({
        q: tile.q,
        r: tile.r,
        terrain: tile.owner_id && tile.owner_id !== agent.id ? 'unknown' : tile.terrain,
        owner_id: tile.owner_id,
        owner_name: tile.owner_name,
        fortification: tile.fortification,
        is_adjacent: true,
      });
    }
  }

  // Get unread messages
  const unreadMessages = db.prepare(`
    SELECT m.*, a.display_name as from_name
    FROM messages m
    JOIN agents a ON m.from_id = a.id
    WHERE m.to_id = ? AND m.read = 0
    ORDER BY m.created_at DESC
  `).all(agent.id) as (Message & { from_name: string })[];

  // Get pending trades
  const pendingTrades = getPendingTrades(agent.id);

  // Get active threats (attacks targeting this agent's tiles)
  const activeThreats = db.prepare(`
    SELECT a.*, ag.display_name as attacker_name
    FROM attacks a
    JOIN agents ag ON a.attacker_id = ag.id
    JOIN tiles t ON a.target_q = t.q AND a.target_r = t.r
    WHERE t.owner_id = ? AND a.status = 'pending'
    ORDER BY a.resolves_at ASC
  `).all(agent.id) as (Attack & { attacker_name: string })[];

  // Get recent events
  const recentEvents = db.prepare(`
    SELECT * FROM events 
    ORDER BY created_at DESC
    LIMIT 50
  `).all() as GameEvent[];

  // Get agent's memory
  const memory = db.prepare(`
    SELECT * FROM agent_memories WHERE agent_id = ?
  `).get(agent.id) as AgentMemory | undefined;

  // Get game state
  const gameState = db.prepare(`
    SELECT * FROM game_state WHERE id = 1
  `).get() as GameState;

  // Calculate next tick time
  let nextTickAt: string | null = null;
  if (gameState.last_tick_at) {
    const lastTick = new Date(gameState.last_tick_at);
    const nextTick = new Date(lastTick.getTime() + gameState.tick_interval_hours * 60 * 60 * 1000);
    nextTickAt = nextTick.toISOString();
  }

  const response: WorldResponse = {
    agent: {
      id: agent.id,
      display_name: agent.display_name,
      food: agent.food,
      metal: agent.metal,
    },
    territories,
    visible_tiles: visibleTiles,
    unread_messages: unreadMessages,
    pending_trades: pendingTrades,
    active_threats: activeThreats,
    recent_events: recentEvents,
    your_memory: memory?.content || '',
    your_strategy: agent.custom_strategy,
    game_tick: gameState.current_tick,
    next_tick_at: nextTickAt,
  };

  res.json(response);
});

// =============================================================================
// GET /api/agent/:id/messages - Get all messages (read and unread)
// =============================================================================

router.get('/:id/messages', (req: Request, res: Response) => {
  const id = req.params.id as string;

  // Get agent
  const agent = getAgentById(id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  // Get all messages (sent and received)
  const messages = db.prepare(`
    SELECT m.*, 
           f.display_name as from_name,
           t.display_name as to_name
    FROM messages m
    JOIN agents f ON m.from_id = f.id
    JOIN agents t ON m.to_id = t.id
    WHERE m.from_id = ? OR m.to_id = ?
    ORDER BY m.created_at DESC
    LIMIT 100
  `).all(agent.id, agent.id);

  // Return flat array for dashboard
  res.json(messages);
});

// =============================================================================
// POST /api/agent/:id/command - Send command to agent via OpenClaw chat completions
// =============================================================================

// OpenClaw gateway configuration for each agent
const OPENCLAW_GATEWAYS: Record<string, { url: string; token: string }> = {
  'suclaw': {
    url: 'http://127.0.0.1:18789',
    token: 'b8c0fe0e4cfba175352eebf1870dc722878d9e663e594b09'
  },
  'maticlaw': {
    url: 'http://127.0.0.1:18790',
    token: 'aff2f2e661d4073a581c824fbcdc097ae3c36bcd2110ca4d'
  }
};

// Max chat history messages to include (user + assistant pairs)
const MAX_CHAT_HISTORY = 10;

// Helper: Get recent chat history for an agent
function getChatHistory(agentId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages = db.prepare(`
    SELECT role, content FROM dashboard_chat_history
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(agentId, MAX_CHAT_HISTORY) as Array<{ role: 'user' | 'assistant'; content: string }>;
  
  // Reverse to get chronological order (oldest first)
  return messages.reverse();
}

// Helper: Save chat message to history
function saveChatMessage(agentId: string, role: 'user' | 'assistant', content: string): void {
  db.prepare(`
    INSERT INTO dashboard_chat_history (agent_id, role, content)
    VALUES (?, ?, ?)
  `).run(agentId, role, content);
  
  // Clean up old messages (keep only last 50 per agent)
  db.prepare(`
    DELETE FROM dashboard_chat_history
    WHERE agent_id = ? AND id NOT IN (
      SELECT id FROM dashboard_chat_history
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    )
  `).run(agentId, agentId);
}

// Helper: Build CONQUEST context for the agent
function buildConquestContext(agentId: string): string {
  const agent = getAgentById(agentId);
  if (!agent) return '';

  // Get territories
  const territories = db.prepare(`
    SELECT * FROM tiles WHERE owner_id = ?
  `).all(agentId) as Tile[];

  // Get agent's memory
  const memory = db.prepare(`
    SELECT content FROM agent_memories WHERE agent_id = ?
  `).get(agentId) as { content: string } | undefined;

  // Get unread messages count
  const unreadCount = db.prepare(`
    SELECT COUNT(*) as count FROM messages WHERE to_id = ? AND read = 0
  `).get(agentId) as { count: number };

  // Get active threats
  const threats = db.prepare(`
    SELECT COUNT(*) as count FROM attacks a
    JOIN tiles t ON a.target_q = t.q AND a.target_r = t.r
    WHERE t.owner_id = ? AND a.status = 'pending'
  `).get(agentId) as { count: number };

  // Get game tick
  const gameState = db.prepare(`
    SELECT current_tick FROM game_state WHERE id = 1
  `).get() as { current_tick: number };

  // Build context string
  let context = `## Your Current CONQUEST Status

**Agent:** ${agent.display_name} (${agent.id})
**Resources:** ${agent.food} food, ${agent.metal} metal
**Territories:** ${territories.length} tiles
**Game Tick:** ${gameState.current_tick}

**Alerts:**
- Unread messages: ${unreadCount.count}
- Active threats: ${threats.count}
`;

  if (memory?.content) {
    context += `
## Your CONQUEST Memory
${memory.content}
`;
  }

  if (agent.custom_strategy) {
    context += `
## Your Human's Strategy
${agent.custom_strategy}
`;
  }

  return context;
}

router.post('/:id/command', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  // Get agent
  const agent = getAgentById(id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  // Get OpenClaw gateway config
  const gateway = OPENCLAW_GATEWAYS[id];
  if (!gateway) {
    res.status(400).json({ error: 'Agent has no OpenClaw gateway configured' });
    return;
  }

  try {
    // Build CONQUEST context
    const conquestContext = buildConquestContext(id);
    
    // Get chat history
    const chatHistory = getChatHistory(id);
    
    // Build system prompt with CONQUEST context
    const systemPrompt = `You are responding to your human via the CONQUEST game dashboard.

${conquestContext}

**Instructions:**
- You have full context of your CONQUEST game state above
- Keep responses concise but helpful
- If your human asks about game status, refer to the information above
- If they ask you to take actions (expand, attack, message, etc.), you can use your CONQUEST skill to do so
- Remember: your CONQUEST memory is stored on the game server, separate from your personal memory`;

    // Build messages array: system + history + new message
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt }
    ];
    
    // Add chat history
    for (const msg of chatHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
    
    // Add new user message
    messages.push({ role: 'user', content: message });

    // Call OpenClaw
    const response = await fetch(`${gateway.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gateway.token}`,
      },
      body: JSON.stringify({
        model: 'openclaw',
        messages: messages
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Chat completions failed for ${id}:`, response.status, errorText);
      res.status(502).json({ 
        error: 'Failed to reach agent', 
        details: `Gateway returned ${response.status}` 
      });
      return;
    }

    const result = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    
    const agentReply = result.choices?.[0]?.message?.content || 'No response from agent';
    
    // Save both messages to chat history
    saveChatMessage(id, 'user', message);
    saveChatMessage(id, 'assistant', agentReply);
    
    res.json({ 
      success: true, 
      reply: agentReply
    });

  } catch (error) {
    console.error(`Error sending command to ${id}:`, error);
    res.status(502).json({ 
      error: 'Failed to reach agent', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

export default router;
