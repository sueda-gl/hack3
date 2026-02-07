/**
 * CONQUEST Tick Processor
 * 
 * Handles periodic game updates:
 * 1. Resource production - Tiles generate food/metal based on terrain
 * 2. Upkeep deduction - 3 food per tile per tick
 * 3. Attack resolution - Pending attacks resolve
 * 4. Starvation handling - Agents who can't pay upkeep lose tiles
 * 5. Trade expiration - Expire old trade proposals
 */

import db from '../db/database.js';
import type { Agent, Tile, Attack, GameState, TerrainType } from '../types.js';
import { GAME_CONSTANTS } from '../types.js';
import { broadcastGameEvent, broadcastTileUpdate } from '../game/broadcast.js';
import { notifyTerritoryLost } from '../webhooks/notify.js';
import { clearCapitalIfLost } from '../game/actions.js';

// =============================================================================
// TYPES
// =============================================================================

interface TickResult {
  tick_number: number;
  resources_produced: {
    agent_id: string;
    food: number;
    metal: number;
  }[];
  upkeep_paid: {
    agent_id: string;
    food: number;
  }[];
  attacks_resolved: {
    attack_id: number;
    attacker_id: string;
    defender_id: string;
    target_q: number;
    target_r: number;
    success: boolean;
  }[];
  tiles_lost_to_starvation: {
    agent_id: string;
    q: number;
    r: number;
  }[];
  trades_expired: number;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getGameState(): GameState {
  return db.prepare('SELECT * FROM game_state WHERE id = 1').get() as GameState;
}

function getAllAgents(): Agent[] {
  return db.prepare('SELECT * FROM agents').all() as Agent[];
}

function getAgentTiles(agentId: string): Tile[] {
  return db.prepare('SELECT * FROM tiles WHERE owner_id = ?').all(agentId) as Tile[];
}

function getPendingAttacksToResolve(): (Attack & { defender_id: string | null })[] {
  // Get pending attacks where resolves_at has passed
  return db.prepare(`
    SELECT a.*, t.owner_id as defender_id
    FROM attacks a
    JOIN tiles t ON a.target_q = t.q AND a.target_r = t.r
    WHERE a.status = 'pending' AND a.resolves_at <= datetime('now')
  `).all() as (Attack & { defender_id: string | null })[];
}

function getTile(q: number, r: number): Tile | null {
  return db.prepare('SELECT * FROM tiles WHERE q = ? AND r = ?').get(q, r) as Tile | undefined || null;
}

function getAgent(agentId: string): Agent | null {
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as Agent | undefined || null;
}

function logEvent(actorId: string | null, type: string, description: string, data?: object) {
  db.prepare(`
    INSERT INTO events (type, actor_id, description, data)
    VALUES (?, ?, ?, ?)
  `).run(type, actorId, description, data ? JSON.stringify(data) : null);
  
  broadcastGameEvent({
    type,
    description,
    actor_id: actorId,
    data,
  });
}

function calculateResourceProduction(terrain: TerrainType): { food: number; metal: number } {
  switch (terrain) {
    case 'farmland':
      return { food: GAME_CONSTANTS.FARMLAND_FOOD, metal: 0 };
    case 'mine':
      return { food: 0, metal: GAME_CONSTANTS.MINE_METAL };
    case 'mixed':
      return { food: GAME_CONSTANTS.MIXED_FOOD, metal: GAME_CONSTANTS.MIXED_METAL };
    case 'barren':
    default:
      return { food: GAME_CONSTANTS.BARREN_FOOD, metal: 0 };
  }
}

// =============================================================================
// TICK PROCESSING
// =============================================================================

/**
 * Process a single game tick
 */
export function processTick(): TickResult {
  const gameState = getGameState();
  const newTickNumber = gameState.current_tick + 1;
  
  console.log(`[Tick] Processing tick ${newTickNumber}...`);
  
  const result: TickResult = {
    tick_number: newTickNumber,
    resources_produced: [],
    upkeep_paid: [],
    attacks_resolved: [],
    tiles_lost_to_starvation: [],
    trades_expired: 0,
  };
  
  // Use a transaction for atomicity
  const processTickTransaction = db.transaction(() => {
    // ==========================================================================
    // STEP 1: Resolve pending attacks
    // ==========================================================================
    const attacksToResolve = getPendingAttacksToResolve();
    
    for (const attack of attacksToResolve) {
      const tile = getTile(attack.target_q, attack.target_r);
      if (!tile) {
        // Tile doesn't exist (shouldn't happen)
        db.prepare('UPDATE attacks SET status = ? WHERE id = ?').run('resolved', attack.id);
        continue;
      }
      
      const attacker = getAgent(attack.attacker_id);
      const attackerName = attacker?.display_name || 'Unknown';
      
      // Calculate defense
      const defense = GAME_CONSTANTS.BASE_TILE_DEFENSE + tile.fortification;
      const attackSuccess = attack.commitment > defense;
      
      if (attackSuccess) {
        // Attacker wins - transfer tile ownership
        const previousOwner = tile.owner_id;
        const defenderName = previousOwner ? (getAgent(previousOwner)?.display_name || 'Unknown') : 'Nobody';
        
        db.prepare(`
          UPDATE tiles SET owner_id = ?, fortification = 0 WHERE q = ? AND r = ?
        `).run(attack.attacker_id, attack.target_q, attack.target_r);
        
        // Log event
        logEvent(attack.attacker_id, 'attack_success', 
          `${attackerName} captured (${attack.target_q}, ${attack.target_r}) from ${defenderName}`, {
            attacker: attackerName,
            defender: defenderName,
            tile: { q: attack.target_q, r: attack.target_r },
            commitment: attack.commitment,
            defense,
          });
        
        // Broadcast tile update
        broadcastTileUpdate({
          q: attack.target_q,
          r: attack.target_r,
          terrain: tile.terrain,
          owner_id: attack.attacker_id,
          owner_name: attackerName,
          fortification: 0,
        });
        
        // Notify defender they lost territory (async)
        if (previousOwner) {
          clearCapitalIfLost(previousOwner, attack.target_q, attack.target_r);
          notifyTerritoryLost(previousOwner, attackerName, attack.target_q, attack.target_r)
            .catch(err => console.error('[Webhook] Failed to notify territory loss:', err));
        }
        
        result.attacks_resolved.push({
          attack_id: attack.id,
          attacker_id: attack.attacker_id,
          defender_id: previousOwner || '',
          target_q: attack.target_q,
          target_r: attack.target_r,
          success: true,
        });
      } else {
        // Defender wins - attack fails
        const defenderName = attack.defender_id ? (getAgent(attack.defender_id)?.display_name || 'Unknown') : 'Nobody';
        
        logEvent(attack.attacker_id, 'attack_failed', 
          `${attackerName}'s attack on (${attack.target_q}, ${attack.target_r}) failed. ${defenderName} defended successfully.`, {
            attacker: attackerName,
            defender: defenderName,
            tile: { q: attack.target_q, r: attack.target_r },
            commitment: attack.commitment,
            defense,
          });
        
        result.attacks_resolved.push({
          attack_id: attack.id,
          attacker_id: attack.attacker_id,
          defender_id: attack.defender_id || '',
          target_q: attack.target_q,
          target_r: attack.target_r,
          success: false,
        });
      }
      
      // Mark attack as resolved
      db.prepare('UPDATE attacks SET status = ? WHERE id = ?').run('resolved', attack.id);
    }
    
    // ==========================================================================
    // STEP 2: Resource production
    // ==========================================================================
    const agents = getAllAgents();
    
    for (const agent of agents) {
      const tiles = getAgentTiles(agent.id);
      let totalFood = 0;
      let totalMetal = 0;
      
      for (const tile of tiles) {
        const production = calculateResourceProduction(tile.terrain as TerrainType);
        totalFood += production.food;
        totalMetal += production.metal;
      }
      
      if (totalFood > 0 || totalMetal > 0) {
        db.prepare('UPDATE agents SET food = food + ?, metal = metal + ? WHERE id = ?')
          .run(totalFood, totalMetal, agent.id);
        
        result.resources_produced.push({
          agent_id: agent.id,
          food: totalFood,
          metal: totalMetal,
        });
      }
    }
    
    // ==========================================================================
    // STEP 3: Upkeep deduction
    // ==========================================================================
    for (const agent of agents) {
      const tiles = getAgentTiles(agent.id);
      const upkeepCost = tiles.length * GAME_CONSTANTS.UPKEEP_FOOD_PER_TILE;
      
      if (upkeepCost > 0) {
        // Get current food (after production)
        const currentAgent = getAgent(agent.id);
        if (!currentAgent) continue;
        
        if (currentAgent.food >= upkeepCost) {
          // Can pay upkeep
          db.prepare('UPDATE agents SET food = food - ? WHERE id = ?')
            .run(upkeepCost, agent.id);
          
          result.upkeep_paid.push({
            agent_id: agent.id,
            food: upkeepCost,
          });
        } else {
          // Cannot pay upkeep - starvation!
          // Pay what they can
          const paidAmount = currentAgent.food;
          db.prepare('UPDATE agents SET food = 0 WHERE id = ?').run(agent.id);
          
          result.upkeep_paid.push({
            agent_id: agent.id,
            food: paidAmount,
          });
          
          // Calculate how many tiles to lose
          const shortfall = upkeepCost - paidAmount;
          const tilesToLose = Math.ceil(shortfall / GAME_CONSTANTS.UPKEEP_FOOD_PER_TILE);
          
          // Lose tiles (starting with least valuable - barren first)
          const tilesOrdered = [...tiles].sort((a, b) => {
            const valueOrder: Record<string, number> = { barren: 0, mixed: 1, mine: 2, farmland: 3 };
            return (valueOrder[a.terrain] || 0) - (valueOrder[b.terrain] || 0);
          });
          
          for (let i = 0; i < Math.min(tilesToLose, tilesOrdered.length); i++) {
            const tileToLose = tilesOrdered[i];
            
            // Remove ownership
            db.prepare('UPDATE tiles SET owner_id = NULL, fortification = 0 WHERE q = ? AND r = ?')
              .run(tileToLose.q, tileToLose.r);

            // Clear capital if this was the capital tile
            clearCapitalIfLost(agent.id, tileToLose.q, tileToLose.r);
            
            // Log event
            logEvent(agent.id, 'starvation', 
              `${agent.display_name} lost (${tileToLose.q}, ${tileToLose.r}) due to starvation`, {
                tile: { q: tileToLose.q, r: tileToLose.r },
                terrain: tileToLose.terrain,
              });
            
            // Broadcast tile update
            broadcastTileUpdate({
              q: tileToLose.q,
              r: tileToLose.r,
              terrain: tileToLose.terrain as TerrainType,
              owner_id: null,
              owner_name: null,
              fortification: 0,
            });
            
            result.tiles_lost_to_starvation.push({
              agent_id: agent.id,
              q: tileToLose.q,
              r: tileToLose.r,
            });
          }
        }
      }
    }
    
    // ==========================================================================
    // STEP 4: Expire old trades
    // ==========================================================================
    const expireResult = db.prepare(`
      UPDATE trades SET status = 'expired' 
      WHERE status = 'pending' AND expires_at <= datetime('now')
    `).run();
    
    result.trades_expired = expireResult.changes;
    
    // ==========================================================================
    // STEP 5: Update game state
    // ==========================================================================
    db.prepare(`
      UPDATE game_state 
      SET current_tick = ?, last_tick_at = datetime('now')
      WHERE id = 1
    `).run(newTickNumber);
    
    // Log tick event
    logEvent(null, 'tick', `Game tick ${newTickNumber} processed`, {
      tick: newTickNumber,
      attacks_resolved: result.attacks_resolved.length,
      tiles_lost_to_starvation: result.tiles_lost_to_starvation.length,
    });
  });
  
  // Execute the transaction
  processTickTransaction();
  
  console.log(`[Tick] Tick ${newTickNumber} complete:`);
  console.log(`  - Resources produced for ${result.resources_produced.length} agents`);
  console.log(`  - Upkeep paid by ${result.upkeep_paid.length} agents`);
  console.log(`  - ${result.attacks_resolved.length} attacks resolved`);
  console.log(`  - ${result.tiles_lost_to_starvation.length} tiles lost to starvation`);
  console.log(`  - ${result.trades_expired} trades expired`);
  
  return result;
}

/**
 * Check if a tick should be processed based on time elapsed
 */
export function shouldProcessTick(): boolean {
  const gameState = getGameState();
  
  if (!gameState.last_tick_at) {
    return true;
  }
  
  const lastTickTime = new Date(gameState.last_tick_at).getTime();
  const now = Date.now();
  const hoursSinceLastTick = (now - lastTickTime) / (1000 * 60 * 60);
  
  return hoursSinceLastTick >= gameState.tick_interval_hours;
}

/**
 * Get time until next tick (in milliseconds)
 */
export function getTimeUntilNextTick(): number {
  const gameState = getGameState();
  
  if (!gameState.last_tick_at) {
    return 0;
  }
  
  const lastTickTime = new Date(gameState.last_tick_at).getTime();
  const tickIntervalMs = gameState.tick_interval_hours * 60 * 60 * 1000;
  const nextTickTime = lastTickTime + tickIntervalMs;
  
  return Math.max(0, nextTickTime - Date.now());
}

/**
 * Get next tick timestamp as ISO string
 */
export function getNextTickAt(): string | null {
  const gameState = getGameState();
  
  if (!gameState.last_tick_at) {
    return null;
  }
  
  const lastTickTime = new Date(gameState.last_tick_at).getTime();
  const tickIntervalMs = gameState.tick_interval_hours * 60 * 60 * 1000;
  const nextTickTime = new Date(lastTickTime + tickIntervalMs);
  
  return nextTickTime.toISOString();
}
