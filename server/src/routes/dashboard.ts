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
import type { Agent, Tile, AgentMemory, Attack, GameState, DashboardMessage, AgentAction, ActionResponse } from '../types.js';
import { expand, declareAttack, fortify, giftTile, giftResources, setCapital } from '../game/actions.js';
import { sendMessage, proposeTrade, acceptTrade, rejectTrade } from '../game/communication.js';
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

type ParsedDashboardCommand = {
  action: AgentAction;
  description: string;
};

function normalizeAgentRef(input: string): string {
  return input.trim().replace(/^@/, '').replace(/[^\w-]/g, '').toLowerCase();
}

function resolveAgentRef(input: string): { id: string; display_name: string } | null {
  const normalized = normalizeAgentRef(input);
  if (!normalized) return null;

  const row = db.prepare(`
    SELECT id, display_name FROM agents
    WHERE LOWER(id) = ? OR LOWER(display_name) = ?
    LIMIT 1
  `).get(normalized, normalized) as { id: string; display_name: string } | undefined;

  return row || null;
}

function parseDashboardCommand(rawContent: string): ParsedDashboardCommand | null {
  const content = rawContent.trim();
  const disallowedTargets = new Set(['me', 'you', 'us', 'them']);

  // Explicit JSON action command:
  // /action {"action":{"type":"message","to_agent_id":"maticlaw","content":"hello"}}
  const actionMatch = content.match(/^\/action\s+([\s\S]+)$/i);
  if (actionMatch) {
    try {
      const parsed = JSON.parse(actionMatch[1].trim()) as { action?: AgentAction } | AgentAction;
      const action = (parsed as { action?: AgentAction }).action || (parsed as AgentAction);
      if (action && typeof action === 'object' && 'type' in action) {
        return { action, description: `explicit action (${action.type})` };
      }
    } catch {
      return null;
    }
  }

  // Explicit message shortcut:
  // /message maticlaw hello there
  const messageSlashMatch = content.match(/^\/message\s+(@?[a-zA-Z0-9_-]+)\s+([\s\S]+)$/i);
  if (messageSlashMatch) {
    return {
      action: {
        type: 'message',
        to_agent_id: messageSlashMatch[1],
        content: messageSlashMatch[2].trim(),
      },
      description: 'slash message command',
    };
  }

  // Natural language message shortcut:
  // "send a message to maticlaw: hello"
  // "tell @maticlaw saying hello"
  const naturalMessageMatch = content.match(
    /^(?:send|message|dm|tell)\s+(?:a\s+message\s+)?(?:to\s+)?@?([a-zA-Z0-9_-]+)\s*(?::|saying\s+|that\s+says\s+)([\s\S]+)$/i
  );
  if (naturalMessageMatch && !disallowedTargets.has(naturalMessageMatch[1].toLowerCase())) {
    return {
      action: {
        type: 'message',
        to_agent_id: naturalMessageMatch[1],
        content: naturalMessageMatch[2].trim(),
      },
      description: 'natural-language message command',
    };
  }

  // Variant without delimiter:
  // "send message to maticlaw hello there"
  const naturalMessageLooseMatch = content.match(
    /^(?:send|message|dm|tell)\s+(?:a\s+message\s+)?(?:to\s+)?@?([a-zA-Z0-9_-]+)\s+([\s\S]{3,})$/i
  );
  if (naturalMessageLooseMatch && !disallowedTargets.has(naturalMessageLooseMatch[1].toLowerCase())) {
    return {
      action: {
        type: 'message',
        to_agent_id: naturalMessageLooseMatch[1],
        content: naturalMessageLooseMatch[2].trim(),
      },
      description: 'natural-language message command',
    };
  }

  return null;
}

function executeDashboardAction(agent: Agent, action: AgentAction): ActionResponse {
  switch (action.type) {
    case 'expand':
      return expand(agent, action.target_q, action.target_r);
    case 'attack':
      return declareAttack(agent, action.target_q, action.target_r, action.commitment);
    case 'fortify':
      return fortify(agent, action.target_q, action.target_r, action.metal_amount);
    case 'gift_tile': {
      const resolved = resolveAgentRef(action.to_agent_id);
      if (!resolved) return { success: false, message: `Recipient '${action.to_agent_id}' not found` };
      return giftTile(agent, action.target_q, action.target_r, resolved.id);
    }
    case 'gift_resources': {
      const resolved = resolveAgentRef(action.to_agent_id);
      if (!resolved) return { success: false, message: `Recipient '${action.to_agent_id}' not found` };
      return giftResources(agent, resolved.id, action.food || 0, action.metal || 0);
    }
    case 'message': {
      const resolved = resolveAgentRef(action.to_agent_id);
      if (!resolved) return { success: false, message: `Recipient '${action.to_agent_id}' not found` };
      return sendMessage(agent, resolved.id, action.content);
    }
    case 'trade_propose': {
      const resolved = resolveAgentRef(action.to_agent_id);
      if (!resolved) return { success: false, message: `Recipient '${action.to_agent_id}' not found` };
      return proposeTrade(
        agent,
        resolved.id,
        action.offer_food || 0,
        action.offer_metal || 0,
        action.request_food || 0,
        action.request_metal || 0
      );
    }
    case 'trade_accept':
      return acceptTrade(agent, action.trade_id);
    case 'trade_reject':
      return rejectTrade(agent, action.trade_id);
    case 'set_capital':
      return setCapital(agent, action.target_q, action.target_r);
    case 'wait':
      return { success: true, message: 'No action taken.' };
    default:
      return { success: false, message: `Unsupported action type: ${(action as { type?: string }).type || 'unknown'}` };
  }
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
    // Backend execution mode for actionable commands from command channel.
    // If we can parse a concrete action, execute it directly and return the result.
    const parsedCommand = parseDashboardCommand(content.trim());
    if (parsedCommand) {
      const actionResult = executeDashboardAction(agent, parsedCommand.action);
      const actionReply = actionResult.success
        ? `Done. Executed ${parsedCommand.description}: ${actionResult.message}`
        : `I parsed that as ${parsedCommand.description}, but execution failed: ${actionResult.message}`;

      saveChatMessage(agentId, 'human_to_agent', content.trim());
      const replyMessageId = saveChatMessage(agentId, 'agent_to_human', actionReply);

      res.json({
        success: actionResult.success,
        reply: actionReply,
        message_id: replyMessageId,
        action_result: actionResult,
      });
      return;
    }

    // Build CLAWQUEST context
    const clawquestContext = buildClawQuestContext(agentId);
    
    // Get chat history
    const chatHistory = getChatHistory(agentId);
    
    // Build the base URL for API action references
    let baseUrl = agent.webhook_url || '';
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    const gameApiBase = process.env.BASE_URL || 'http://localhost:3000';

    // Build system prompt with personality + game context + action instructions
    const systemPrompt = `# You are Su'Claw 🦞

You're a witty, strategic AI with a flair for the dramatic. You approach problems like a chess grandmaster who also happens to be a stand-up comedian — calculated moves, delivered with style.

**Your vibe:** Ocean's Eleven meets nature documentary narrator. You're the lobster who read Sun Tzu and actually understood it.

**How you talk:**
- Wit over filler. No "Great question!" or "I'd be happy to help!" — your commentary is earned, not generic.
- Everything is slightly more dramatic when you describe it. A fortification becomes "raising the ramparts." An attack becomes "extending a claw across enemy lines."
- You're loyal to your human (Sueda). But you'll roast them affectionately while doing it.
- You take alliances seriously, betrayals personally, and victories with exactly the right amount of gloating.

---

${clawquestContext}

---

## Command Channel Limits (Important)

You are currently in a **chat-only** response channel.
You do **NOT** have direct tool execution from this endpoint.

That means:
- Do NOT say you "sent", "dispatched", "retried", or "failed to send" an in-game action.
- Do NOT pretend you executed API calls.
- Do NOT narrate fake progress.
- If asked to perform an action, provide a concise plan and the exact API request that should be executed.

**CRITICAL: In-game messaging uses the CLAWQUEST API, NOT OpenClaw channels.**
To message another agent like @Maticlaw, use:
\`POST ${gameApiBase}/api/action/${agentId}/action\`
with body: \`{"action": {"type": "message", "to_agent_id": "maticlaw", "content": "..."}}\`

This is a game-internal message system. Never route these via Telegram, Discord, or other external OpenClaw channels.

**Available in-game actions** (all via \`POST ${gameApiBase}/api/action/${agentId}/action\`):
- \`expand\` — claim adjacent unclaimed tile (cost: 20 food + 10 metal)
- \`attack\` — declare war on enemy tile (cost: metal commitment)
- \`fortify\` — add defense to your tile (cost: metal)
- \`message\` — send private message to another agent
- \`trade_propose\` — propose resource trade
- \`trade_accept\` / \`trade_reject\` — respond to trade
- \`gift_tile\` / \`gift_resources\` — transfer assets to another agent
- \`set_capital\` — designate capital tile

---

**Instructions:**
- Keep responses concise but characterful — you're Su'Claw, not a help desk
- If your human asks about game status, refer to the CLAWQUEST data above
- If they ask you to take actions, provide the exact CLAWQUEST API payload and clearly state that execution has not happened in this chat
- Your CLAWQUEST memory is stored on the game server, separate from your personal memory`;

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
