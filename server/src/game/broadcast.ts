// Broadcast module - sends real-time updates to all connected WebSocket clients
// This is a simple event emitter pattern to avoid circular imports

type BroadcastHandler = (event: object) => void;

let broadcastHandler: BroadcastHandler | null = null;

// Called by index.ts to register the broadcast function
export function setBroadcastHandler(handler: BroadcastHandler) {
  broadcastHandler = handler;
}

// Called by game actions to broadcast events
export function broadcastEvent(event: object) {
  if (broadcastHandler) {
    broadcastHandler(event);
  }
}

// Broadcast a tile update
export function broadcastTileUpdate(tile: {
  q: number;
  r: number;
  terrain: string;
  owner_id: string | null;
  owner_name: string | null;
  fortification: number;
  is_capital?: boolean;
}) {
  broadcastEvent({
    type: 'tile_update',
    tile,
  });
}

// Broadcast a new event (for the event feed)
export function broadcastGameEvent(event: {
  type: string;
  description: string;
  actor_id?: string | null;
  data?: any;
}) {
  broadcastEvent({
    type: 'game_event',
    event,
  });
}

// Broadcast agent joined
export function broadcastAgentJoined(agent: { id: string; display_name: string }) {
  broadcastEvent({
    type: 'agent_joined',
    agent,
  });
}
