/**
 * Dashboard Communication Routes
 * 
 * Provides human-to-agent chat functionality via the CLAWQUEST dashboard.
 * Uses OpenClaw's /v1/chat/completions endpoint (synchronous) — the same
 * approach that worked in the first commit.
 * 
 * This is an OPT-IN feature — only works for agents with dashboard_chat_enabled = true
 * AND a valid gateway_token configured.
 * 
 * Flow:
 * 1. Human sends message via POST /api/dashboard/:id/send
 * 2. Server builds game context + chat history
 * 3. Server calls OpenClaw /v1/chat/completions synchronously
 * 4. Server gets reply, stores both messages, returns reply to dashboard
 */

import { Router, Request, Response } from 'express';
import db from '../db/database.js';
import type { Agent, Tile, AgentMemory, Attack, GameState, DashboardMessage } from '../types.js';
import { broadcastDashboardReply } from '../game/broadcast.js';

const router = Router();

// Max chat history messages to include in context
const MAX_CHAT_HISTORY = 10;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getAgentById(id: string): Agent | null {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
  return agent || null;
}

/**
 * Get recent chat history for an agent from dashboard_messages table.
 * Returns messages in chronological order (oldest first).
 */
function getChatHistory(agentId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages = db.prepare(`
    SELECT direction, content FROM dashboard_messages
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(agentId, MAX_CHAT_HISTORY) as Array<{ direction: string; content: string }>;
  
  // Reverse to get chronological order (oldest first)
  // Map direction to role for OpenAI format
  return messages.reverse().map(msg => ({
    role: msg.direction === 'human_to_agent' ? 'user' as const : 'assistant' as const,
    content: msg.content,
  }));
}

/**
 * Store a chat message in dashboard_messages table.
 */
function saveChatMessage(agentId: string, direction: 'human_to_agent' | 'agent_to_human', content: string): number {
  const result = db.prepare(`
    INSERT INTO dashboard_messages (agent_id, direction, content, status)
    VALUES (?, ?, ?, 'delivered')
  `).run(agentId, direction, content);
  
  // Clean up old messages (keep only last 50 per agent)
  db.prepare(`
    DELETE FROM dashboard_messages
    WHERE agent_id = ? AND id NOT IN (
      SELECT id FROM dashboard_messages
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    )
  `).run(agentId, agentId);
  
  return result.lastInsertRowid as number;
}

/**
 * Build CLAWQUEST game context for the system prompt.
 * Gives the agent awareness of its current game state.
 */
function buildClawQuestContext(agentId: string): string {
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
  let context = `## Your Current CLAWQUEST Status

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
## Your CLAWQUEST Memory
${memory.content}
`;
  }

  if (agent.custom_strategy) {
    context += `
## Your Human's Directives
${agent.custom_strategy}
`;
  }

  return context;
}

// =============================================================================
// POST /api/dashboard/:id/send - Human sends message, gets synchronous reply
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

  // Check if gateway token is configured
  if (!agent.webhook_url || !agent.gateway_token) {
    res.status(400).json({ 
      error: 'Agent has no OpenClaw gateway configured',
      hint: 'The agent needs webhook_url and gateway_token to enable chat completions'
    });
    return;
  }

  try {
    // Build CLAWQUEST context
    const clawquestContext = buildClawQuestContext(agentId);
    
    // Get chat history
    const chatHistory = getChatHistory(agentId);
    
    // Build system prompt with CLAWQUEST context
    const systemPrompt = `You are responding to your human via the CLAWQUEST game dashboard.

${clawquestContext}

**Instructions:**
- You have full context of your CLAWQUEST game state above
- Keep responses concise but helpful
- If your human asks about game status, refer to the information above
- If they ask you to take actions (expand, attack, message, etc.), you can use your CLAWQUEST skill to do so on your next heartbeat
- Remember: your CLAWQUEST memory is stored on the game server, separate from your personal memory`;

    // Build messages array: system + history + new message
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt }
    ];
    
    // Add chat history
    for (const msg of chatHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
    
    // Add new user message
    messages.push({ role: 'user', content: content.trim() });

    // Build chat completions URL from webhook_url
    let gatewayUrl = agent.webhook_url;
    if (gatewayUrl.endsWith('/')) {
      gatewayUrl = gatewayUrl.slice(0, -1);
    }
    const chatCompletionsUrl = `${gatewayUrl}/v1/chat/completions`;

    console.log(`[Dashboard] Calling chat completions for ${agent.display_name}: ${chatCompletionsUrl}`);

    // Create abort controller for timeout (90 seconds for LLM response)
    // The system prompt includes full CLAWQUEST context (territories, memory, strategy)
    // which can take a while for the LLM to process
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    // Call OpenClaw /v1/chat/completions
    const response = await fetch(chatCompletionsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agent.gateway_token}`,
      },
      body: JSON.stringify({
        model: 'openclaw',
        messages: messages,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Dashboard] Chat completions failed for ${agentId}: HTTP ${response.status}`, errorText);
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
    saveChatMessage(agentId, 'human_to_agent', content.trim());
    const replyMessageId = saveChatMessage(agentId, 'agent_to_human', agentReply);

    console.log(`[Dashboard] ${agent.display_name} replied: "${agentReply.substring(0, 80)}..."`);
    
    // Reply goes directly in the HTTP response (synchronous flow).
    // No WebSocket broadcast needed here — the requesting client gets the reply
    // from this response. Other tabs/clients will pick it up on their next
    // loadChatHistory() refresh.
    res.json({ 
      success: true, 
      reply: agentReply,
      message_id: replyMessageId,
    });

  } catch (error) {
    console.error(`[Dashboard] Error sending command to ${agentId}:`, error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Handle timeout specifically
    if (errorMessage.includes('aborted')) {
      res.status(504).json({ 
        error: 'Agent took too long to respond',
        details: 'Request timed out after 90 seconds'
      });
      return;
    }
    
    res.status(502).json({ 
      error: 'Failed to reach agent', 
      details: errorMessage
    });
  }
});

// =============================================================================
// GET /api/dashboard/:id/pending - Agent fetches pending messages
// (Kept for backward compatibility but no longer the primary flow)
// =============================================================================

router.get('/:id/pending', (req: Request, res: Response) => {
  const agentId = req.params.id as string;

  const agent = getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  if (!agent.dashboard_chat_enabled) {
    res.status(403).json({ error: 'Dashboard chat not enabled for this agent' });
    return;
  }

  const messages = db.prepare(`
    SELECT * FROM dashboard_messages
    WHERE agent_id = ? AND direction = 'human_to_agent' AND status = 'pending'
    ORDER BY created_at ASC
  `).all(agentId) as DashboardMessage[];

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
// (Kept for backward compatibility but no longer the primary flow)
// =============================================================================

router.post('/:id/reply', (req: Request, res: Response) => {
  const agentId = req.params.id as string;
  const { content } = req.body as { content: string };

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    res.status(400).json({ error: 'Reply content is required' });
    return;
  }

  const agent = getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  if (!agent.dashboard_chat_enabled) {
    res.status(403).json({ error: 'Dashboard chat not enabled for this agent' });
    return;
  }

  try {
    const result = db.prepare(`
      INSERT INTO dashboard_messages (agent_id, direction, content, status)
      VALUES (?, 'agent_to_human', ?, 'delivered')
    `).run(agentId, content.trim());

    const messageId = result.lastInsertRowid as number;
    const createdAt = new Date().toISOString();

    broadcastDashboardReply({
      agent_id: agentId,
      agent_name: agent.display_name,
      message_id: messageId,
      content: content.trim(),
      created_at: createdAt,
    });

    res.status(201).json({ success: true, message_id: messageId });
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

  const agent = getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  if (!agent.dashboard_chat_enabled) {
    res.status(403).json({ error: 'Dashboard chat not enabled for this agent' });
    return;
  }

  const messages = db.prepare(`
    SELECT * FROM dashboard_messages
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(agentId, limit) as DashboardMessage[];

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
