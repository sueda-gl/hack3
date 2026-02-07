import { Router, Request, Response } from 'express';
import db from '../db/database.js';
import type { Agent, ActionRequest, AgentAction, GAME_CONSTANTS as GameConstantsType } from '../types.js';
import { GAME_CONSTANTS } from '../types.js';

// Import game actions
import { expand, declareAttack, fortify, giftTile, giftResources, setCapital } from '../game/actions.js';
import { 
  sendMessage, 
  markMessagesRead,
  proposeTrade, 
  acceptTrade, 
  rejectTrade,
} from '../game/communication.js';

const router = Router();

// =============================================================================
// HELPER: Get agent by ID
// =============================================================================

function getAgentById(id: string): Agent | null {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
  return agent || null;
}

// =============================================================================
// HELPER: Save agent memory
// =============================================================================

function saveAgentMemory(agentId: string, content: string): void {
  // Truncate if too long
  const truncated = content.slice(0, GAME_CONSTANTS.MAX_MEMORY_CHARS);
  
  db.prepare(`
    UPDATE agent_memories 
    SET content = ?, updated_at = datetime('now')
    WHERE agent_id = ?
  `).run(truncated, agentId);
}

// =============================================================================
// POST /api/agent/:id/action - Unified action endpoint
// =============================================================================

router.post('/:id/action', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const body = req.body as ActionRequest;
  const { action, save_memory } = body;

  // Get agent
  const agent = getAgentById(id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  // Update last_seen_at
  db.prepare(`UPDATE agents SET last_seen_at = datetime('now') WHERE id = ?`).run(id);

  // Save memory if provided
  if (save_memory !== undefined) {
    saveAgentMemory(id, save_memory);
  }

  // Validate action
  if (!action || typeof action !== 'object' || !action.type) {
    res.status(400).json({ error: 'Invalid action format. Must include action.type' });
    return;
  }

  // Execute action based on type
  let result;

  switch (action.type) {
    case 'expand':
      if (typeof action.target_q !== 'number' || typeof action.target_r !== 'number') {
        res.status(400).json({ error: 'expand requires target_q and target_r (numbers)' });
        return;
      }
      result = expand(agent, action.target_q, action.target_r);
      break;

    case 'attack':
      if (typeof action.target_q !== 'number' || typeof action.target_r !== 'number') {
        res.status(400).json({ error: 'attack requires target_q and target_r (numbers)' });
        return;
      }
      if (typeof action.commitment !== 'number' || action.commitment <= 0) {
        res.status(400).json({ error: 'attack requires commitment (positive number)' });
        return;
      }
      result = declareAttack(agent, action.target_q, action.target_r, action.commitment);
      break;

    case 'fortify':
      if (typeof action.target_q !== 'number' || typeof action.target_r !== 'number') {
        res.status(400).json({ error: 'fortify requires target_q and target_r (numbers)' });
        return;
      }
      if (typeof action.metal_amount !== 'number' || action.metal_amount <= 0) {
        res.status(400).json({ error: 'fortify requires metal_amount (positive number)' });
        return;
      }
      result = fortify(agent, action.target_q, action.target_r, action.metal_amount);
      break;

    case 'gift_tile':
      if (typeof action.target_q !== 'number' || typeof action.target_r !== 'number') {
        res.status(400).json({ error: 'gift_tile requires target_q and target_r (numbers)' });
        return;
      }
      if (typeof action.to_agent_id !== 'string') {
        res.status(400).json({ error: 'gift_tile requires to_agent_id (string)' });
        return;
      }
      result = giftTile(agent, action.target_q, action.target_r, action.to_agent_id);
      break;

    case 'gift_resources':
      if (typeof action.to_agent_id !== 'string') {
        res.status(400).json({ error: 'gift_resources requires to_agent_id (string)' });
        return;
      }
      result = giftResources(
        agent, 
        action.to_agent_id, 
        action.food || 0, 
        action.metal || 0
      );
      break;

    case 'message':
      if (typeof action.to_agent_id !== 'string') {
        res.status(400).json({ error: 'message requires to_agent_id (string)' });
        return;
      }
      if (typeof action.content !== 'string') {
        res.status(400).json({ error: 'message requires content (string)' });
        return;
      }
      result = sendMessage(agent, action.to_agent_id, action.content);
      break;

    case 'trade_propose':
      if (typeof action.to_agent_id !== 'string') {
        res.status(400).json({ error: 'trade_propose requires to_agent_id (string)' });
        return;
      }
      result = proposeTrade(
        agent,
        action.to_agent_id,
        action.offer_food || 0,
        action.offer_metal || 0,
        action.request_food || 0,
        action.request_metal || 0
      );
      break;

    case 'trade_accept':
      if (typeof action.trade_id !== 'number') {
        res.status(400).json({ error: 'trade_accept requires trade_id (number)' });
        return;
      }
      result = acceptTrade(agent, action.trade_id);
      break;

    case 'trade_reject':
      if (typeof action.trade_id !== 'number') {
        res.status(400).json({ error: 'trade_reject requires trade_id (number)' });
        return;
      }
      result = rejectTrade(agent, action.trade_id);
      break;

    case 'wait':
      result = { success: true, message: 'Waited. No action taken.' };
      break;

    case 'set_capital':
      if (typeof action.target_q !== 'number' || typeof action.target_r !== 'number') {
        res.status(400).json({ error: 'set_capital requires target_q and target_r (numbers)' });
        return;
      }
      result = setCapital(agent, action.target_q, action.target_r);
      break;

    default:
      res.status(400).json({ error: `Unknown action type: ${(action as any).type}` });
      return;
  }

  // Return result
  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

// =============================================================================
// POST /api/agent/:id/memory - Save agent memory (standalone endpoint)
// =============================================================================

router.post('/:id/memory', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { content } = req.body;

  // Get agent
  const agent = getAgentById(id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content must be a string' });
    return;
  }

  saveAgentMemory(id, content);

  res.json({ 
    success: true, 
    message: 'Memory saved',
    chars_saved: Math.min(content.length, GAME_CONSTANTS.MAX_MEMORY_CHARS),
  });
});

// =============================================================================
// POST /api/agent/:id/strategy - Update agent's custom strategy
// =============================================================================

router.post('/:id/strategy', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { strategy } = req.body;

  // Get agent
  const agent = getAgentById(id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  if (typeof strategy !== 'string') {
    res.status(400).json({ error: 'strategy must be a string' });
    return;
  }

  // Update strategy (allow empty string to clear it)
  db.prepare(`
    UPDATE agents SET custom_strategy = ? WHERE id = ?
  `).run(strategy || null, id);

  res.json({ 
    success: true, 
    message: 'Strategy updated',
    strategy: strategy || null,
  });
});

// =============================================================================
// POST /api/agent/:id/messages/read - Mark messages as read
// =============================================================================

router.post('/:id/messages/read', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { message_ids } = req.body;

  // Get agent
  const agent = getAgentById(id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  if (!Array.isArray(message_ids)) {
    res.status(400).json({ error: 'message_ids must be an array' });
    return;
  }

  const result = markMessagesRead(agent, message_ids);
  res.json(result);
});

export default router;
