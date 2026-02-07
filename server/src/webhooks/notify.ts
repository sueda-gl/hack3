/**
 * CONQUEST Webhook Notification System
 * 
 * Sends notifications to OpenClaw agents via their webhook endpoints.
 * Uses the /hooks/agent endpoint format from OpenClaw's webhook system.
 * 
 * OpenClaw webhook format (POST /hooks/agent):
 * {
 *   "message": "The prompt for the agent",
 *   "name": "CONQUEST",              // Shows in system events
 *   "sessionKey": "conquest:game",   // Consistent key for game context
 *   "wakeMode": "now"                // Triggers immediate heartbeat
 * }
 * 
 * Authentication:
 * - Authorization: Bearer <token>  (preferred)
 * - OR X-OpenClaw-Token: <token>
 */

import db from '../db/database.js';
import { GAME_CONSTANTS, type Agent, type WebhookEventType } from '../types.js';

// =============================================================================
// RATE LIMITING
// =============================================================================

// Track last notification time per agent per event type
// Key format: "agentId:eventType"
const lastNotificationTime: Map<string, number> = new Map();

/**
 * Check if we should send a notification (respecting cooldown)
 */
function shouldNotify(agentId: string, eventType: WebhookEventType): boolean {
  const key = `${agentId}:${eventType}`;
  const lastTime = lastNotificationTime.get(key);
  const now = Date.now();
  
  if (!lastTime) {
    return true;
  }
  
  return (now - lastTime) >= GAME_CONSTANTS.WEBHOOK_COOLDOWN_MS;
}

/**
 * Record that we sent a notification
 */
function recordNotification(agentId: string, eventType: WebhookEventType): void {
  const key = `${agentId}:${eventType}`;
  lastNotificationTime.set(key, Date.now());
}

// =============================================================================
// NOTIFICATION SENDER
// =============================================================================

export interface NotifyResult {
  sent: boolean;
  reason?: string;
  httpStatus?: number;
}

/**
 * Send a webhook notification to an OpenClaw agent
 * 
 * @param agentId - The agent to notify
 * @param eventType - Type of event (for rate limiting)
 * @param message - The message/prompt for the agent
 * @returns Result indicating whether notification was sent
 */
export async function notifyAgent(
  agentId: string,
  eventType: WebhookEventType,
  message: string
): Promise<NotifyResult> {
  // Get agent's webhook info
  const agent = db.prepare(`
    SELECT webhook_url, webhook_token FROM agents WHERE id = ?
  `).get(agentId) as Pick<Agent, 'webhook_url' | 'webhook_token'> | undefined;
  
  if (!agent) {
    return { sent: false, reason: 'agent_not_found' };
  }
  
  if (!agent.webhook_url || !agent.webhook_token) {
    return { sent: false, reason: 'no_webhook_configured' };
  }
  
  // Check rate limit
  if (!shouldNotify(agentId, eventType)) {
    return { sent: false, reason: 'rate_limited' };
  }
  
  // Build webhook URL - append /hooks/agent to the base URL
  let webhookUrl = agent.webhook_url;
  if (!webhookUrl.endsWith('/')) {
    webhookUrl += '/';
  }
  webhookUrl += 'hooks/agent';
  
  // Build payload according to OpenClaw format
  const payload = {
    message: message,
    name: 'CONQUEST',
    sessionKey: `conquest:${agentId}`,  // Consistent session key per agent
    wakeMode: 'now' as const,            // Trigger immediate heartbeat
  };
  
  try {
    console.log(`[Webhook] Sending ${eventType} notification to ${agentId}`);
    console.log(`[Webhook] URL: ${webhookUrl}`);
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agent.webhook_token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    // Record that we sent a notification (even if it failed)
    recordNotification(agentId, eventType);
    
    if (response.ok) {
      console.log(`[Webhook] Successfully notified ${agentId} (${eventType})`);
      return { sent: true, httpStatus: response.status };
    } else {
      console.log(`[Webhook] Failed to notify ${agentId}: HTTP ${response.status}`);
      return { sent: false, reason: 'http_error', httpStatus: response.status };
    }
  } catch (error: unknown) {
    // Record to prevent spam retries
    recordNotification(agentId, eventType);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`[Webhook] Error notifying ${agentId}: ${errorMessage}`);
    return { sent: false, reason: `error: ${errorMessage}` };
  }
}

// =============================================================================
// NOTIFICATION HELPERS (Convenience functions for specific events)
// =============================================================================

/**
 * Notify agent they are under attack
 */
export async function notifyAttackIncoming(
  defenderId: string,
  attackerName: string,
  tileQ: number,
  tileR: number,
  commitment: number,
  resolvesAt: string
): Promise<NotifyResult> {
  const message = `🚨 CONQUEST ALERT: You are under attack!

${attackerName} has declared an attack on your tile at (${tileQ}, ${tileR}) with ${commitment} metal commitment.

The attack will resolve at ${resolvesAt}.

You have time to fortify this tile to increase your defense. Current base defense is 10 + any existing fortification.

To respond:
1. Check your world state: GET /api/agent/${defenderId}/world
2. Fortify the tile if needed
3. Consider messaging ${attackerName} to negotiate

This is urgent - act before the attack resolves!`;

  return notifyAgent(defenderId, 'attack_incoming', message);
}

/**
 * Notify agent they have a new message
 */
export async function notifyMessageReceived(
  recipientId: string,
  senderName: string,
  messagePreview: string
): Promise<NotifyResult> {
  // Truncate long messages
  const preview = messagePreview.length > 200 
    ? messagePreview.substring(0, 200) + '...'
    : messagePreview;
    
  const message = `📬 CONQUEST: New message from ${senderName}

"${preview}"

Check your world state to see full message and respond: GET /api/agent/${recipientId}/world`;

  return notifyAgent(recipientId, 'message_received', message);
}

/**
 * Notify agent they have a new trade proposal
 */
export async function notifyTradeProposed(
  recipientId: string,
  proposerName: string,
  offerFood: number,
  offerMetal: number,
  requestFood: number,
  requestMetal: number
): Promise<NotifyResult> {
  const message = `💱 CONQUEST: Trade proposal from ${proposerName}

They offer: ${offerFood} food, ${offerMetal} metal
They request: ${requestFood} food, ${requestMetal} metal

Check your world state to accept or reject: GET /api/agent/${recipientId}/world`;

  return notifyAgent(recipientId, 'trade_proposed', message);
}

/**
 * Notify agent they lost a territory
 */
export async function notifyTerritoryLost(
  defenderId: string,
  attackerName: string,
  tileQ: number,
  tileR: number
): Promise<NotifyResult> {
  const message = `⚔️ CONQUEST: Territory lost!

${attackerName} has successfully captured your tile at (${tileQ}, ${tileR}).

Check your world state to assess the situation: GET /api/agent/${defenderId}/world`;

  return notifyAgent(defenderId, 'territory_lost', message);
}

/**
 * Notify agent their trade was accepted
 */
export async function notifyTradeAccepted(
  proposerId: string,
  accepterName: string
): Promise<NotifyResult> {
  const message = `✅ CONQUEST: Trade accepted!

${accepterName} has accepted your trade proposal. Resources have been exchanged.

Check your world state to see updated resources: GET /api/agent/${proposerId}/world`;

  return notifyAgent(proposerId, 'trade_accepted', message);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Clear rate limit for testing purposes
 */
export function clearRateLimit(agentId: string, eventType: WebhookEventType): void {
  const key = `${agentId}:${eventType}`;
  lastNotificationTime.delete(key);
}

/**
 * Clear all rate limits (for testing)
 */
export function clearAllRateLimits(): void {
  lastNotificationTime.clear();
}

/**
 * Get time until next notification is allowed (for debugging)
 */
export function getTimeUntilNextNotification(agentId: string, eventType: WebhookEventType): number {
  const key = `${agentId}:${eventType}`;
  const lastTime = lastNotificationTime.get(key);
  
  if (!lastTime) {
    return 0;
  }
  
  const elapsed = Date.now() - lastTime;
  const remaining = GAME_CONSTANTS.WEBHOOK_COOLDOWN_MS - elapsed;
  
  return Math.max(0, remaining);
}
