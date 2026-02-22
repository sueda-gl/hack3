const API_URL = window.location.origin;
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

let ws = null;
const handlers = {};
let reconnectTimer = null;

export function onMessage(type, handler) {
    handlers[type] = handler;
}

export function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        console.log('[WS] Connected');
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        handlers.open?.();
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (handlers[data.type]) handlers[data.type](data);
            else if (handlers.default) handlers.default(data);
            else console.log('[WS] Unhandled:', data.type);
        } catch (e) {
            console.error('[WS] Parse error:', e);
        }
    };

    ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting in 3s...');
        handlers.close?.();
        reconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        handlers.error?.(error);
    };
}

export async function fetchMap() {
    const res = await fetch(`${API_URL}/api/map`);
    if (!res.ok) throw new Error(`Failed to fetch map: ${res.status}`);
    return res.json();
}

export async function fetchAgents() {
    const res = await fetch(`${API_URL}/api/map/agents`);
    if (!res.ok) throw new Error(`Failed to fetch agents: ${res.status}`);
    return res.json();
}

export async function fetchStats() {
    const res = await fetch(`${API_URL}/api/map/stats`);
    if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
    return res.json();
}

export async function fetchEvents(limit = 50) {
    const res = await fetch(`${API_URL}/api/map/events?limit=${limit}`);
    if (!res.ok) throw new Error(`Failed to fetch events: ${res.status}`);
    return res.json();
}

export { API_URL, WS_URL };
