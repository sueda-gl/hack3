/**
 * Dashboard Communication Routes
 * 
 * Provides human-to-agent chat functionality via the CONQUEST dashboard.
 * This is an OPT-IN feature - only works for agents with dashboard_chat_enabled = true.
 * 
 * Flow:
 * 1. Human sends message via POST /api/dashboard/:id/send
 * 2. Server stores message and notifies agent via webhook
 * 3. Agent fetches pending messages via GET /api/dashboard/:id/pending
 * 4. Agent replies via POST /api/dashboard/:id/reply
 * 5. Server broadcasts reply to dashboard via WebSocket
 */

import { Router, Request, Response } from 'express';
import db from '../db/database.js';
import type { Agent, DashboardMessage } from '../types.js';
import { notifyDashboardMessage } from '../webhooks/notify.js';
import { broadcastDashboardReply } from '../game/broadcast.js';

const router = Router();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getAgentById(id: string): Agent | null {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
  return agent || null;
}

// =============================================================================
// POST /api/dashboard/:id/send - Human sends message to agent
// =============================================================================

router.post('/:id/send', async (req: Request, res: Response) => {
  const agentId = req.params.id as string;
  const { content } = req.body as { content: string };

  // Validate content
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    res.status(400).json({ error: 'Message content is required' });
    return;
  }

  // Get agent
  const agent = getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  // Check if dashboard chat is enabled for this agent
  if (!agent.dashboard_chat_enabled) {
    res.status(403).json({ 
      error: 'Dashboard chat not enabled for this agent',
      hint: 'The agent must be registered with dashboard_chat_enabled: true'
    });
    return;
  }

  try {
    // Store the message
    const result = db.prepare(`
      INSERT INTO dashboard_messages (agent_id, direction, content, status)
      VALUES (?, 'human_to_agent', ?, 'pending')
    `).run(agentId, content.trim());

    const messageId = result.lastInsertRowid as number;

    // Notify the agent via webhook
    const notifyResult = await notifyDashboardMessage(agentId, content.trim());

    res.status(201).json({
      success: true,
      message_id: messageId,
      notification_sent: notifyResult.sent,
      notification_reason: notifyResult.reason || null,
    });

    console.log(`[Dashboard] Human sent message to ${agent.display_name}: "${content.substring(0, 50)}..."`);
  } catch (error) {
    console.error('[Dashboard] Error storing message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// =============================================================================
// GET /api/dashboard/:id/pending - Agent fetches pending messages
// =============================================================================

router.get('/:id/pending', (req: Request, res: Response) => {
  const agentId = req.params.id as string;

  // Get agent
  const agent = getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  // Check if dashboard chat is enabled
  if (!agent.dashboard_chat_enabled) {
    res.status(403).json({ 
      error: 'Dashboard chat not enabled for this agent' 
    });
    return;
  }

  // Get pending messages from human
  const messages = db.prepare(`
    SELECT * FROM dashboard_messages
    WHERE agent_id = ? AND direction = 'human_to_agent' AND status = 'pending'
    ORDER BY created_at ASC
  `).all(agentId) as DashboardMessage[];

  // Mark as delivered
  if (messages.length > 0) {
    const messageIds = messages.map(m => m.id);
    db.prepare(`
      UPDATE dashboard_messages
      SET status = 'delivered'
      WHERE id IN (${messageIds.join(',')})
    `).run();
  }

  res.json({
    agent_id: agentId,
    pending_messages: messages,
    count: messages.length,
  });
});

// =============================================================================
// POST /api/dashboard/:id/reply - Agent sends reply to human
// =============================================================================

router.post('/:id/reply', (req: Request, res: Response) => {
  const agentId = req.params.id as string;
  const { content } = req.body as { content: string };

  // Validate content
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    res.status(400).json({ error: 'Reply content is required' });
    return;
  }

  // Get agent
  const agent = getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  // Check if dashboard chat is enabled
  if (!agent.dashboard_chat_enabled) {
    res.status(403).json({ 
      error: 'Dashboard chat not enabled for this agent' 
    });
    return;
  }

  try {
    // Store the reply
    const result = db.prepare(`
      INSERT INTO dashboard_messages (agent_id, direction, content, status)
      VALUES (?, 'agent_to_human', ?, 'delivered')
    `).run(agentId, content.trim());

    const messageId = result.lastInsertRowid as number;
    const createdAt = new Date().toISOString();

    // Broadcast to dashboard via WebSocket
    broadcastDashboardReply({
      agent_id: agentId,
      agent_name: agent.display_name,
      message_id: messageId,
      content: content.trim(),
      created_at: createdAt,
    });

    res.status(201).json({
      success: true,
      message_id: messageId,
    });

    console.log(`[Dashboard] ${agent.display_name} replied: "${content.substring(0, 50)}..."`);
  } catch (error) {
    console.error('[Dashboard] Error storing reply:', error);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

// =============================================================================
// GET /api/dashboard/:id/history - Get chat history (for dashboard UI)
// =============================================================================

router.get('/:id/history', (req: Request, res: Response) => {
  const agentId = req.params.id as string;
  const limit = Number(req.query.limit) || 50;

  // Get agent
  const agent = getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  // Check if dashboard chat is enabled
  if (!agent.dashboard_chat_enabled) {
    res.status(403).json({ 
      error: 'Dashboard chat not enabled for this agent' 
    });
    return;
  }

  // Get all messages for this agent
  const messages = db.prepare(`
    SELECT * FROM dashboard_messages
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(agentId, limit) as DashboardMessage[];

  // Return in chronological order
  res.json({
    agent_id: agentId,
    agent_name: agent.display_name,
    messages: messages.reverse(),
    count: messages.length,
  });
});

// =============================================================================
// GET /api/dashboard/:id/enabled - Check if dashboard chat is enabled
// =============================================================================

router.get('/:id/enabled', (req: Request, res: Response) => {
  const agentId = req.params.id as string;

  // Get agent
  const agent = getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  res.json({
    agent_id: agentId,
    agent_name: agent.display_name,
    dashboard_chat_enabled: Boolean(agent.dashboard_chat_enabled),
  });
});

export default router;
