import db from '../db/database.js';
import type { 
  Agent, 
  ActionResponse,
  Trade,
  GAME_CONSTANTS as GameConstantsType,
} from '../types.js';
import { GAME_CONSTANTS } from '../types.js';
import { 
  notifyMessageReceived, 
  notifyTradeProposed, 
  notifyTradeAccepted 
} from '../webhooks/notify.js';
import { broadcastGameEvent } from './broadcast.js';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Get agent by ID
function getAgent(agentId: string): Agent | null {
  const agent = db.prepare(`
    SELECT * FROM agents WHERE id = ?
  `).get(agentId) as Agent | undefined;
  return agent || null;
}

// Log a public event and broadcast it to all connected clients
function logEvent(actorId: string | null, type: string, description: string, data?: object) {
  db.prepare(`
    INSERT INTO events (type, actor_id, description, data)
    VALUES (?, ?, ?, ?)
  `).run(type, actorId, description, data ? JSON.stringify(data) : null);
  
  // Broadcast to WebSocket clients (was previously missing!)
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

// =============================================================================
// MESSAGE ACTION
// =============================================================================

export function sendMessage(agent: Agent, toAgentId: string, content: string): ActionResponse {
  // Validate content
  if (!content || content.trim().length === 0) {
    return { success: false, message: 'Message content cannot be empty' };
  }
  if (content.length > 2000) {
    return { success: false, message: 'Message too long (max 2000 characters)' };
  }
  
  // Get recipient
  const recipient = getAgent(toAgentId);
  if (!recipient) {
    return { success: false, message: 'Recipient agent not found' };
  }
  if (recipient.id === agent.id) {
    return { success: false, message: 'Cannot send message to yourself' };
  }
  
  // Store message
  db.prepare(`
    INSERT INTO messages (from_id, to_id, content, read)
    VALUES (?, ?, ?, 0)
  `).run(agent.id, recipient.id, content.trim());
  
  // Messages are PRIVATE - no public event logged
  
  // Send webhook notification to recipient (async, don't wait)
  notifyMessageReceived(
    recipient.id,
    agent.display_name,
    content.trim()
  ).catch(err => {
    console.error('[Webhook] Failed to notify message recipient:', err);
  });
  
  return {
    success: true,
    message: `Message sent to ${recipient.display_name}`,
    data: {
      to: recipient.display_name,
    }
  };
}

// Mark messages as read
export function markMessagesRead(agent: Agent, messageIds: number[]): ActionResponse {
  if (messageIds.length === 0) {
    return { success: false, message: 'No message IDs provided' };
  }
  
  const placeholders = messageIds.map(() => '?').join(',');
  const result = db.prepare(`
    UPDATE messages 
    SET read = 1 
    WHERE id IN (${placeholders}) AND to_id = ?
  `).run(...messageIds, agent.id);
  
  return {
    success: true,
    message: `Marked ${result.changes} messages as read`,
  };
}

// =============================================================================
// TRADE SYSTEM
// =============================================================================

// Propose a trade
export function proposeTrade(
  agent: Agent, 
  toAgentId: string,
  offerFood: number,
  offerMetal: number,
  requestFood: number,
  requestMetal: number
): ActionResponse {
  // Validate amounts
  if (offerFood < 0 || offerMetal < 0 || requestFood < 0 || requestMetal < 0) {
    return { success: false, message: 'Trade amounts cannot be negative' };
  }
  if (offerFood === 0 && offerMetal === 0 && requestFood === 0 && requestMetal === 0) {
    return { success: false, message: 'Trade must involve at least some resources' };
  }
  
  // Check agent has resources to offer
  if (offerFood > agent.food) {
    return { success: false, message: `Cannot offer ${offerFood} food, you only have ${agent.food}` };
  }
  if (offerMetal > agent.metal) {
    return { success: false, message: `Cannot offer ${offerMetal} metal, you only have ${agent.metal}` };
  }
  
  // Get recipient
  const recipient = getAgent(toAgentId);
  if (!recipient) {
    return { success: false, message: 'Recipient agent not found' };
  }
  if (recipient.id === agent.id) {
    return { success: false, message: 'Cannot trade with yourself' };
  }
  
  // Calculate expiry
  // Use SQLite-compatible datetime format (space separator, no Z) so that
  // the expires_at <= datetime('now') comparison in tick processor works correctly.
  const expiresAt = new Date(Date.now() + GAME_CONSTANTS.TRADE_EXPIRY_HOURS * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  
  // Create trade proposal
  const result = db.prepare(`
    INSERT INTO trades (from_id, to_id, offer_food, offer_metal, request_food, request_metal, status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(agent.id, recipient.id, offerFood, offerMetal, requestFood, requestMetal, expiresAt);
  
  // Log event
  logEvent(agent.id, 'trade_proposed', `${agent.display_name} proposed a trade to ${recipient.display_name}`, {
    from: agent.display_name,
    from_id: agent.id,
    to: recipient.display_name,
    to_id: recipient.id,
  });
  
  // Send webhook notification to recipient (async, don't wait)
  notifyTradeProposed(
    recipient.id,
    agent.display_name,
    offerFood,
    offerMetal,
    requestFood,
    requestMetal
  ).catch(err => {
    console.error('[Webhook] Failed to notify trade recipient:', err);
  });
  
  return {
    success: true,
    message: `Trade proposal sent to ${recipient.display_name}`,
    data: {
      trade_id: result.lastInsertRowid,
      to: recipient.display_name,
      offer: { food: offerFood, metal: offerMetal },
      request: { food: requestFood, metal: requestMetal },
      expires_at: expiresAt,
    }
  };
}

// Accept a trade
export function acceptTrade(agent: Agent, tradeId: number): ActionResponse {
  // Get trade proposal
  const trade = db.prepare(`
    SELECT * FROM trades WHERE id = ? AND status = 'pending'
  `).get(tradeId) as Trade | undefined;
  
  if (!trade) {
    return { success: false, message: 'Trade proposal not found or no longer pending' };
  }
  
  // Check if expired
  if (trade.expires_at && new Date(trade.expires_at) < new Date()) {
    db.prepare(`UPDATE trades SET status = 'expired' WHERE id = ?`).run(tradeId);
    return { success: false, message: 'Trade proposal has expired' };
  }
  
  // Verify agent is the recipient
  if (trade.to_id !== agent.id) {
    return { success: false, message: 'This trade proposal is not for you' };
  }
  
  // Get proposer
  const proposer = getAgent(trade.from_id);
  if (!proposer) {
    return { success: false, message: 'Trade proposer no longer exists' };
  }
  
  // Check both parties have required resources
  if (proposer.food < trade.offer_food || proposer.metal < trade.offer_metal) {
    db.prepare(`UPDATE trades SET status = 'expired' WHERE id = ?`).run(tradeId);
    return { success: false, message: `${proposer.display_name} no longer has the offered resources` };
  }
  
  if (agent.food < trade.request_food || agent.metal < trade.request_metal) {
    return { success: false, message: `You don't have enough resources. Need ${trade.request_food} food and ${trade.request_metal} metal` };
  }
  
  // Execute trade atomically
  const executeTrade = db.transaction(() => {
    // Proposer gives offer, receives request
    updateAgentResources(proposer.id, -trade.offer_food + trade.request_food, -trade.offer_metal + trade.request_metal);
    
    // Accepter gives request, receives offer
    updateAgentResources(agent.id, trade.offer_food - trade.request_food, trade.offer_metal - trade.request_metal);
    
    // Mark trade as accepted
    db.prepare(`UPDATE trades SET status = 'accepted' WHERE id = ?`).run(tradeId);
    
    // Log public event
    logEvent(null, 'trade_accepted', `${proposer.display_name} and ${agent.display_name} completed a trade`, {
      parties: [proposer.display_name, agent.display_name],
      from: proposer.display_name,
      from_id: proposer.id,
      to: agent.display_name,
      to_id: agent.id,
    });
  });
  
  executeTrade();
  
  // Send webhook notification to proposer that trade was accepted (async, don't wait)
  notifyTradeAccepted(
    proposer.id,
    agent.display_name
  ).catch(err => {
    console.error('[Webhook] Failed to notify trade proposer:', err);
  });
  
  return {
    success: true,
    message: `Trade completed with ${proposer.display_name}`,
    data: {
      received: { food: trade.offer_food, metal: trade.offer_metal },
      gave: { food: trade.request_food, metal: trade.request_metal },
    }
  };
}

// Reject a trade
export function rejectTrade(agent: Agent, tradeId: number): ActionResponse {
  // Get trade proposal
  const trade = db.prepare(`
    SELECT * FROM trades WHERE id = ? AND status = 'pending'
  `).get(tradeId) as Trade | undefined;
  
  if (!trade) {
    return { success: false, message: 'Trade proposal not found or no longer pending' };
  }
  
  // Verify agent is the recipient
  if (trade.to_id !== agent.id) {
    return { success: false, message: 'This trade proposal is not for you' };
  }
  
  // Get proposer for logging
  const proposer = getAgent(trade.from_id);
  
  // Mark as rejected
  db.prepare(`UPDATE trades SET status = 'rejected' WHERE id = ?`).run(tradeId);
  
  // Log event
  if (proposer) {
    logEvent(agent.id, 'trade_rejected', `${agent.display_name} rejected a trade from ${proposer.display_name}`, {
      from: proposer.display_name,
      to: agent.display_name,
    });
  }
  
  return {
    success: true,
    message: 'Trade proposal rejected',
  };
}

// Get pending trade proposals for an agent
export function getPendingTrades(agentId: string): Trade[] {
  const trades = db.prepare(`
    SELECT * FROM trades 
    WHERE (to_id = ? OR from_id = ?) AND status = 'pending'
    ORDER BY created_at DESC
  `).all(agentId, agentId) as Trade[];
  
  return trades;
}
