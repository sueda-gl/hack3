import { v4 as uuidv4 } from 'uuid';
import db from '../db/database.js';
import type { 
  Agent, 
  Tile, 
  ActionResponse,
  GAME_CONSTANTS as GameConstantsType
} from '../types.js';
import { GAME_CONSTANTS } from '../types.js';
import { broadcastTileUpdate, broadcastGameEvent } from './broadcast.js';
import { notifyAttackIncoming } from '../webhooks/notify.js';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Get hex neighbors (axial coordinates)
export function getNeighbors(q: number, r: number): Array<{ q: number; r: number }> {
  return [
    { q: q + 1, r: r },
    { q: q - 1, r: r },
    { q: q, r: r + 1 },
    { q: q, r: r - 1 },
    { q: q + 1, r: r - 1 },
    { q: q - 1, r: r + 1 },
  ];
}

// Check if agent owns any tile adjacent to target
function hasAdjacentTerritory(agentId: string, targetQ: number, targetR: number): boolean {
  const neighbors = getNeighbors(targetQ, targetR);
  
  for (const neighbor of neighbors) {
    const tile = db.prepare(`
      SELECT owner_id FROM tiles WHERE q = ? AND r = ?
    `).get(neighbor.q, neighbor.r) as { owner_id: string | null } | undefined;
    
    if (tile && tile.owner_id === agentId) {
      return true;
    }
  }
  return false;
}

// Get tile at coordinates
function getTile(q: number, r: number): Tile | null {
  const tile = db.prepare(`
    SELECT * FROM tiles WHERE q = ? AND r = ?
  `).get(q, r) as Tile | undefined;
  return tile || null;
}

// Get agent by ID
function getAgent(agentId: string): Agent | null {
  const agent = db.prepare(`
    SELECT * FROM agents WHERE id = ?
  `).get(agentId) as Agent | undefined;
  return agent || null;
}

// Log a public event and broadcast it
function logEvent(actorId: string | null, type: string, description: string, data?: object) {
  db.prepare(`
    INSERT INTO events (type, actor_id, description, data)
    VALUES (?, ?, ?, ?)
  `).run(type, actorId, description, data ? JSON.stringify(data) : null);
  
  // Broadcast the event to all connected clients
  broadcastGameEvent({
    type,
    description,
    actor_id: actorId,
    data,
  });
}

// Update agent resources
function updateAgentResources(agentId: string, foodDelta: number, metalDelta: number) {
  db.prepare(`
    UPDATE agents SET food = food + ?, metal = metal + ? WHERE id = ?
  `).run(foodDelta, metalDelta, agentId);
}

// Get tile with owner name and broadcast update
function getTileAndBroadcast(q: number, r: number) {
  const tile = db.prepare(`
    SELECT t.*, a.display_name as owner_name,
           CASE WHEN a.capital_q = t.q AND a.capital_r = t.r THEN 1 ELSE 0 END as is_capital
    FROM tiles t
    LEFT JOIN agents a ON t.owner_id = a.id
    WHERE t.q = ? AND t.r = ?
  `).get(q, r) as (Tile & { owner_name: string | null; is_capital: number }) | undefined;
  
  if (tile) {
    broadcastTileUpdate({
      q: tile.q,
      r: tile.r,
      terrain: tile.owner_id ? tile.terrain : 'unknown',
      owner_id: tile.owner_id,
      owner_name: tile.owner_name,
      fortification: tile.fortification,
      is_capital: tile.is_capital === 1,
    });
  }
  
  return tile;
}

// =============================================================================
// EXPAND ACTION
// =============================================================================

export function expand(agent: Agent, targetQ: number, targetR: number): ActionResponse {
  // Get target tile
  const targetTile = getTile(targetQ, targetR);
  if (!targetTile) {
    return { success: false, message: 'Target tile does not exist' };
  }
  
  // Check if tile is unclaimed
  if (targetTile.owner_id !== null) {
    return { success: false, message: 'Target tile is already claimed. Use ATTACK to take enemy tiles.' };
  }
  
  // Check if agent has adjacent territory
  if (!hasAdjacentTerritory(agent.id, targetQ, targetR)) {
    return { success: false, message: 'You must expand from an adjacent tile you own' };
  }
  
  // Check resources
  const foodCost = GAME_CONSTANTS.EXPAND_FOOD_COST;
  const metalCost = GAME_CONSTANTS.EXPAND_METAL_COST;
  
  if (agent.food < foodCost) {
    return { success: false, message: `Not enough food. Need ${foodCost}, have ${agent.food}` };
  }
  if (agent.metal < metalCost) {
    return { success: false, message: `Not enough metal. Need ${metalCost}, have ${agent.metal}` };
  }
  
  // Execute expansion
  const executeExpand = db.transaction(() => {
    // Deduct resources
    updateAgentResources(agent.id, -foodCost, -metalCost);
    
    // Claim tile
    db.prepare(`
      UPDATE tiles SET owner_id = ? WHERE q = ? AND r = ?
    `).run(agent.id, targetQ, targetR);
    
    // Log public event
    logEvent(agent.id, 'expand', `${agent.display_name} expanded to (${targetQ}, ${targetR})`, {
      tile: { q: targetQ, r: targetR },
      terrain: targetTile.terrain,
    });
  });
  
  executeExpand();
  
  // Broadcast tile update to all clients
  getTileAndBroadcast(targetQ, targetR);
  
  return { 
    success: true, 
    message: `Successfully expanded to (${targetQ}, ${targetR}). Terrain: ${targetTile.terrain}`,
    data: {
      tile: { q: targetQ, r: targetR, terrain: targetTile.terrain },
      resources_spent: { food: foodCost, metal: metalCost }
    }
  };
}

// =============================================================================
// ATTACK ACTION (declares attack, resolves at next tick)
// =============================================================================

export function declareAttack(agent: Agent, targetQ: number, targetR: number, commitment: number): ActionResponse {
  // Validate commitment
  if (commitment <= 0) {
    return { success: false, message: 'Metal commitment must be positive' };
  }
  if (commitment > agent.metal) {
    return { success: false, message: `Not enough metal. Committing ${commitment}, have ${agent.metal}` };
  }
  
  // Get target tile
  const targetTile = getTile(targetQ, targetR);
  if (!targetTile) {
    return { success: false, message: 'Target tile does not exist' };
  }
  
  // Check if tile is owned by someone else
  if (targetTile.owner_id === null) {
    return { success: false, message: 'Target tile is unclaimed. Use EXPAND instead.' };
  }
  if (targetTile.owner_id === agent.id) {
    return { success: false, message: 'Cannot attack your own tile' };
  }
  
  // Check if agent has adjacent territory
  if (!hasAdjacentTerritory(agent.id, targetQ, targetR)) {
    return { success: false, message: 'You must attack from an adjacent tile you own' };
  }
  
  // Get defender
  const defender = getAgent(targetTile.owner_id);
  if (!defender) {
    return { success: false, message: 'Defender not found' };
  }
  
  // Calculate when attack resolves (next tick or 2 hours from now)
  // IMPORTANT: Use SQLite-compatible format (space separator, no Z) so that
  // the string comparison in getPendingAttacksToResolve() works correctly.
  // SQLite's datetime('now') returns 'YYYY-MM-DD HH:MM:SS' format, and
  // JavaScript's toISOString() returns 'YYYY-MM-DDTHH:MM:SS.sssZ' which
  // breaks lexicographic <= comparison (T > space in ASCII).
  const resolvesAt = new Date(Date.now() + GAME_CONSTANTS.ATTACK_RESOLUTION_HOURS * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  
  // Execute attack declaration
  const executeAttackDeclaration = db.transaction(() => {
    // Deduct metal immediately (committed to attack)
    updateAgentResources(agent.id, 0, -commitment);
    
    // Create pending attack
    db.prepare(`
      INSERT INTO attacks (attacker_id, target_q, target_r, commitment, status, resolves_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(agent.id, targetQ, targetR, commitment, resolvesAt);
    
    // Log public event
    logEvent(agent.id, 'attack_declared', 
      `${agent.display_name} declared attack on (${targetQ}, ${targetR}) owned by ${defender.display_name}`, {
        attacker: agent.display_name,
        attacker_id: agent.id,
        defender: defender.display_name,
        defender_id: defender.id,
        tile: { q: targetQ, r: targetR },
        resolves_at: resolvesAt,
      });
  });
  
  executeAttackDeclaration();
  
  // Send webhook notification to defender (async, don't wait)
  notifyAttackIncoming(
    defender.id,
    agent.display_name,
    targetQ,
    targetR,
    commitment,
    resolvesAt
  ).catch(err => {
    console.error('[Webhook] Failed to notify defender:', err);
  });
  
  return {
    success: true,
    message: `Attack declared on (${targetQ}, ${targetR}). Will resolve at ${resolvesAt}. ${defender.display_name} has time to fortify.`,
    data: {
      target: { q: targetQ, r: targetR },
      defender: defender.display_name,
      commitment,
      resolves_at: resolvesAt,
    }
  };
}

// =============================================================================
// FORTIFY ACTION
// =============================================================================

export function fortify(agent: Agent, targetQ: number, targetR: number, metalAmount: number): ActionResponse {
  // Validate metal amount
  if (metalAmount <= 0) {
    return { success: false, message: 'Metal amount must be positive' };
  }
  if (metalAmount > agent.metal) {
    return { success: false, message: `Not enough metal. Want ${metalAmount}, have ${agent.metal}` };
  }
  
  // Get target tile
  const targetTile = getTile(targetQ, targetR);
  if (!targetTile) {
    return { success: false, message: 'Target tile does not exist' };
  }
  
  // Check ownership
  if (targetTile.owner_id !== agent.id) {
    return { success: false, message: 'You can only fortify your own tiles' };
  }
  
  // Execute fortification
  const executeFortify = db.transaction(() => {
    // Deduct metal
    updateAgentResources(agent.id, 0, -metalAmount);
    
    // Add fortification (1 metal = 1 defense point)
    db.prepare(`
      UPDATE tiles SET fortification = fortification + ? WHERE q = ? AND r = ?
    `).run(metalAmount, targetQ, targetR);
    
    // Log event
    logEvent(agent.id, 'fortify', `${agent.display_name} fortified (${targetQ}, ${targetR})`, {
      tile: { q: targetQ, r: targetR },
    });
  });
  
  executeFortify();
  
  // Broadcast tile update
  getTileAndBroadcast(targetQ, targetR);
  
  const newFortification = targetTile.fortification + metalAmount;
  
  return {
    success: true,
    message: `Fortified (${targetQ}, ${targetR}). Defense is now ${GAME_CONSTANTS.BASE_TILE_DEFENSE + newFortification}`,
    data: {
      tile: { q: targetQ, r: targetR },
      new_fortification: newFortification,
      total_defense: GAME_CONSTANTS.BASE_TILE_DEFENSE + newFortification,
      metal_spent: metalAmount,
    }
  };
}

// =============================================================================
// GIFT TILE ACTION
// =============================================================================

export function giftTile(agent: Agent, targetQ: number, targetR: number, toAgentId: string): ActionResponse {
  // Get target tile
  const targetTile = getTile(targetQ, targetR);
  if (!targetTile) {
    return { success: false, message: 'Target tile does not exist' };
  }
  
  // Check ownership
  if (targetTile.owner_id !== agent.id) {
    return { success: false, message: 'You can only gift your own tiles' };
  }
  
  // Get recipient
  const recipient = getAgent(toAgentId);
  if (!recipient) {
    return { success: false, message: 'Recipient agent not found' };
  }
  if (recipient.id === agent.id) {
    return { success: false, message: 'Cannot gift tile to yourself' };
  }
  
  // Execute gift
  const executeGift = db.transaction(() => {
    // Transfer ownership (keep fortifications)
    db.prepare(`
      UPDATE tiles SET owner_id = ? WHERE q = ? AND r = ?
    `).run(recipient.id, targetQ, targetR);

    // Clear capital if the gifted tile was the sender's capital
    clearCapitalIfLost(agent.id, targetQ, targetR);
    
    // Log public event
    logEvent(agent.id, 'gift', 
      `${agent.display_name} gifted (${targetQ}, ${targetR}) to ${recipient.display_name}`, {
        from: agent.display_name,
        to: recipient.display_name,
        tile: { q: targetQ, r: targetR },
      });
  });
  
  executeGift();
  
  // Broadcast tile update
  getTileAndBroadcast(targetQ, targetR);
  
  return {
    success: true,
    message: `Successfully gifted (${targetQ}, ${targetR}) to ${recipient.display_name}`,
    data: {
      tile: { q: targetQ, r: targetR },
      recipient: recipient.display_name,
    }
  };
}

// =============================================================================
// SET CAPITAL ACTION
// =============================================================================

export function setCapital(agent: Agent, targetQ: number, targetR: number): ActionResponse {
  // Get target tile
  const targetTile = getTile(targetQ, targetR);
  if (!targetTile) {
    return { success: false, message: 'Target tile does not exist' };
  }

  // Check ownership
  if (targetTile.owner_id !== agent.id) {
    return { success: false, message: 'You can only set capital on your own tiles' };
  }

  // Update capital coordinates on the agent
  db.prepare(`
    UPDATE agents SET capital_q = ?, capital_r = ? WHERE id = ?
  `).run(targetQ, targetR, agent.id);

  // Log event
  logEvent(agent.id, 'expand', `${agent.display_name} designated (${targetQ}, ${targetR}) as their capital`, {
    tile: { q: targetQ, r: targetR },
  });

  return {
    success: true,
    message: `Successfully set (${targetQ}, ${targetR}) as your capital`,
    data: {
      capital: { q: targetQ, r: targetR },
    }
  };
}

// =============================================================================
// CLEAR CAPITAL (when tile is lost)
// =============================================================================

export function clearCapitalIfLost(agentId: string, lostQ: number, lostR: number): void {
  const agent = getAgent(agentId);
  if (!agent) return;

  if (agent.capital_q === lostQ && agent.capital_r === lostR) {
    db.prepare(`
      UPDATE agents SET capital_q = NULL, capital_r = NULL WHERE id = ?
    `).run(agentId);
  }
}

// =============================================================================
// GIFT RESOURCES ACTION
// =============================================================================

export function giftResources(agent: Agent, toAgentId: string, food: number, metal: number): ActionResponse {
  // Validate amounts
  if (food < 0 || metal < 0) {
    return { success: false, message: 'Resource amounts cannot be negative' };
  }
  if (food === 0 && metal === 0) {
    return { success: false, message: 'Must gift at least some resources' };
  }
  if (food > agent.food) {
    return { success: false, message: `Not enough food. Want to gift ${food}, have ${agent.food}` };
  }
  if (metal > agent.metal) {
    return { success: false, message: `Not enough metal. Want to gift ${metal}, have ${agent.metal}` };
  }
  
  // Get recipient
  const recipient = getAgent(toAgentId);
  if (!recipient) {
    return { success: false, message: 'Recipient agent not found' };
  }
  if (recipient.id === agent.id) {
    return { success: false, message: 'Cannot gift resources to yourself' };
  }
  
  // Execute gift
  const executeGift = db.transaction(() => {
    // Deduct from sender
    updateAgentResources(agent.id, -food, -metal);
    
    // Add to recipient
    updateAgentResources(recipient.id, food, metal);
    
    // Log public event
    logEvent(agent.id, 'gift', 
      `${agent.display_name} gifted resources to ${recipient.display_name}`, {
        from: agent.display_name,
        to: recipient.display_name,
        food,
        metal,
      });
  });
  
  executeGift();
  
  return {
    success: true,
    message: `Successfully gifted ${food} food and ${metal} metal to ${recipient.display_name}`,
    data: {
      recipient: recipient.display_name,
      food,
      metal,
    }
  };
}
