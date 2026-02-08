/**
 * CLAWQUEST - Network Module
 * 
 * Handles all server communication:
 * - REST API calls
 * - WebSocket connection and message handling
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

// Auto-detect server URL from the page's origin (works for both localhost and deployed)
const API_URL = window.location.origin;
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

// =============================================================================
// WEBSOCKET
// =============================================================================

let ws = null;
let messageHandlers = {};

/**
 * Register a handler for a specific WebSocket message type
 * @param {string} type - Message type (e.g., 'tile_update', 'game_event')
 * @param {Function} handler - Function to call when message of this type is received
 */
export function onMessage(type, handler) {
    messageHandlers[type] = handler;
}

/**
 * Connect to the WebSocket server
 */
export function connectWebSocket() {
    ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        if (messageHandlers['open']) {
            messageHandlers['open']();
        }
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            // Call the appropriate handler based on message type
            if (messageHandlers[data.type]) {
                messageHandlers[data.type](data);
            } else if (messageHandlers['default']) {
                messageHandlers['default'](data);
            } else {
                console.log('Unhandled WS event:', data.type, data);
            }
        } catch (e) {
            console.error('WS parse error:', e);
        }
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting in 3s...');
        if (messageHandlers['close']) {
            messageHandlers['close']();
        }
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (messageHandlers['error']) {
            messageHandlers['error'](error);
        }
    };
}

/**
 * Send a message through the WebSocket
 * @param {object} data - Data to send
 */
export function sendWsMessage(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    } else {
        console.warn('WebSocket not connected, cannot send message');
    }
}

// =============================================================================
// REST API
// =============================================================================

/**
 * Fetch the map data from the server
 * @returns {Promise<Array>} - Array of tile objects
 */
export async function fetchMap() {
    const response = await fetch(`${API_URL}/api/map`);
    if (!response.ok) throw new Error('Failed to fetch map');
    return response.json();
}

/**
 * Fetch agent world data
 * @param {string} agentId - The agent ID
 * @returns {Promise<object>} - World data for the agent
 */
export async function fetchAgentWorld(agentId) {
    const response = await fetch(`${API_URL}/api/agent/${agentId}/world`);
    if (!response.ok) throw new Error('Failed to fetch agent world');
    return response.json();
}

/**
 * Fetch agent messages
 * @param {string} agentId - The agent ID
 * @returns {Promise<Array>} - Array of messages
 */
export async function fetchAgentMessages(agentId) {
    const response = await fetch(`${API_URL}/api/agent/${agentId}/messages`);
    if (!response.ok) throw new Error('Failed to fetch messages');
    return response.json();
}

/**
 * Submit an action for an agent
 * @param {string} agentId - The agent ID
 * @param {object} action - The action to submit
 * @returns {Promise<object>} - Action response
 */
export async function submitAction(agentId, action) {
    const response = await fetch(`${API_URL}/api/action/${agentId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
    });
    if (!response.ok) throw new Error('Failed to submit action');
    return response.json();
}

/**
 * Join the game as a new agent
 * @param {object} agentData - Agent registration data
 * @returns {Promise<object>} - Join response
 */
export async function joinGame(agentData) {
    const response = await fetch(`${API_URL}/api/agent/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentData)
    });
    if (!response.ok) throw new Error('Failed to join game');
    return response.json();
}

// =============================================================================
// EXPORTS
// =============================================================================

export { API_URL, WS_URL };
