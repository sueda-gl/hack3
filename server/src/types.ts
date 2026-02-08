// =============================================================================
// CONQUEST: Core Types for OpenClaw Agent MMO
// =============================================================================

// =============================================================================
// DATABASE ENTITIES
// =============================================================================

export interface Agent {
  id: string;
  display_name: string;
  food: number;
  metal: number;
  capital_q: number | null;
  capital_r: number | null;
  webhook_url: string | null;
  webhook_token: string | null;
  gateway_token: string | null;  // OpenClaw gateway API token for /v1/chat/completions
  custom_strategy: string | null;
  dashboard_chat_enabled: number;  // 0 = disabled (default), 1 = enabled
  joined_at: string;
  last_seen_at: string | null;
}

export interface AgentMemory {
  agent_id: string;
  content: string;  // Markdown blob
  updated_at: string;
}

export interface Tile {
  q: number;
  r: number;
  terrain: TerrainType;
  owner_id: string | null;
  fortification: number;
}

export type TerrainType = 'farmland' | 'mine' | 'mixed' | 'barren';

export interface Message {
  id: number;
  from_id: string;
  to_id: string;
  content: string;
  read: number;  // 0 = unread, 1 = read
  created_at: string;
}

export interface Trade {
  id: number;
  from_id: string;
  to_id: string;
  offer_food: number;
  offer_metal: number;
  request_food: number;
  request_metal: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  created_at: string;
  expires_at: string | null;
}

export interface Attack {
  id: number;
  attacker_id: string;
  target_q: number;
  target_r: number;
  commitment: number;
  status: 'pending' | 'resolved';
  created_at: string;
  resolves_at: string | null;
}

export interface GameEvent {
  id: number;
  type: EventType;
  actor_id: string | null;
  description: string;
  data: string | null;  // JSON string
  created_at: string;
}

export type EventType = 
  | 'join'
  | 'expand' 
  | 'attack_declared'
  | 'attack_success' 
  | 'attack_failed' 
  | 'fortify' 
  | 'gift' 
  | 'trade_proposed'
  | 'trade_accepted'
  | 'trade_rejected'
  | 'message'
  | 'tick'
  | 'starvation';

export interface GameState {
  id: number;
  current_tick: number;
  last_tick_at: string | null;
  tick_interval_hours: number;
}

export interface DashboardMessage {
  id: number;
  agent_id: string;
  direction: 'human_to_agent' | 'agent_to_human';
  content: string;
  status: 'pending' | 'delivered' | 'read';
  created_at: string;
}

// =============================================================================
// API REQUEST/RESPONSE TYPES
// =============================================================================

// POST /api/agent/join
export interface JoinRequest {
  agent_id: string;        // The agent's unique identifier
  display_name: string;    // Human-readable name
  webhook_url?: string;    // Optional: for real-time notifications
  webhook_token?: string;  // Optional: auth token for webhook calls
  gateway_token?: string;  // Optional: OpenClaw gateway API token for chat completions
  custom_strategy?: string; // Optional: human-provided strategy for the agent
  dashboard_chat_enabled?: boolean; // Optional: enable human-agent chat via dashboard (default false)
}

export interface JoinResponse {
  success: boolean;
  agent_id: string;
  display_name: string;
  starting_tile: {
    q: number;
    r: number;
    terrain: TerrainType;
  };
  resources: {
    food: number;
    metal: number;
  };
}

// GET /api/agent/:id/world
export interface WorldResponse {
  agent: {
    id: string;
    display_name: string;
    food: number;
    metal: number;
    capital: { q: number; r: number } | null;
    dashboard_chat_enabled: boolean;  // Whether human can chat with agent via dashboard
  };
  territories: Tile[];
  visible_tiles: VisibleTile[];
  unread_messages: Message[];
  pending_trades: Trade[];
  active_threats: Attack[];  // Attacks targeting this agent
  recent_events: GameEvent[];
  your_memory: string;  // Agent's saved game memories (Markdown)
  your_strategy: string | null;  // Human-provided strategy for this agent
  game_tick: number;
  next_tick_at: string | null;
}

export interface VisibleTile {
  q: number;
  r: number;
  terrain: TerrainType | 'unknown';  // Hidden if enemy-owned
  owner_id: string | null;
  owner_name: string | null;
  fortification: number;
  is_adjacent: boolean;
}

// POST /api/agent/:id/action
export interface ActionRequest {
  action: AgentAction;
  save_memory?: string;  // Optional: Markdown to save as agent's memory
}

export type AgentAction = 
  | { type: 'expand'; target_q: number; target_r: number }
  | { type: 'attack'; target_q: number; target_r: number; commitment: number }
  | { type: 'fortify'; target_q: number; target_r: number; metal_amount: number }
  | { type: 'gift_tile'; target_q: number; target_r: number; to_agent_id: string }
  | { type: 'gift_resources'; to_agent_id: string; food: number; metal: number }
  | { type: 'message'; to_agent_id: string; content: string }
  | { type: 'trade_propose'; to_agent_id: string; offer_food: number; offer_metal: number; request_food: number; request_metal: number }
  | { type: 'trade_accept'; trade_id: number }
  | { type: 'trade_reject'; trade_id: number }
  | { type: 'set_capital'; target_q: number; target_r: number }
  | { type: 'wait' };  // Do nothing this turn

export interface ActionResponse {
  success: boolean;
  message: string;
  data?: any;
}

// =============================================================================
// GAME CONSTANTS
// =============================================================================

export const GAME_CONSTANTS = {
  // Expansion costs
  EXPAND_FOOD_COST: 20,
  EXPAND_METAL_COST: 10,
  
  // Resource generation per tick
  FARMLAND_FOOD: 10,
  MINE_METAL: 10,
  MIXED_FOOD: 5,
  MIXED_METAL: 5,
  BARREN_FOOD: 2,
  
  // Upkeep per tile per tick
  UPKEEP_FOOD_PER_TILE: 3,
  
  // Combat
  BASE_TILE_DEFENSE: 10,
  ATTACK_RESOLUTION_HOURS: 2,  // Attacks resolve after 2 hours
  
  // Trades
  TRADE_EXPIRY_HOURS: 24,  // Trades expire after 24 hours
  
  // Memory
  MAX_MEMORY_CHARS: 10000,  // Max characters for agent memory
  
  // Webhook rate limiting
  WEBHOOK_COOLDOWN_MS: 10000,  // 10 seconds between webhook calls per event type (allows rapid conversation)
  
  // Map expansion
  MAP_EXPANSION_THRESHOLD: 20,  // Expand map when fewer than 20 unclaimed tiles remain
  MAP_EXPANSION_RINGS: 2,       // Add 2 rings of new tiles per expansion
};

// =============================================================================
// WEBHOOK TYPES
// =============================================================================

export interface WebhookPayload {
  message: string;
  name: string;
  sessionKey?: string;
  wakeMode: 'now' | 'next-heartbeat';
}

export type WebhookEventType = 
  | 'attack_incoming'
  | 'message_received'
  | 'trade_proposed'
  | 'territory_lost'
  | 'trade_accepted'
  | 'dashboard_message';
