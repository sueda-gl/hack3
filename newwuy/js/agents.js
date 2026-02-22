const AGENT_COLORS = [
    '#ff6b6b', '#4dabf7', '#51cf66', '#f06595', '#ffa94d',
    '#e599f7', '#66d9e8', '#ffd43b', '#ff8787', '#69db7c',
];

const BORDER_TILES = [
    'hex_border_cyan', 'hex_border_pink', 'hex_border_green',
    'hex_border_orange', 'hex_border_cyan', 'hex_border_pink',
    'hex_border_green', 'hex_border_orange', 'hex_border_cyan', 'hex_border_pink',
];

const colorMap = new Map();
let colorIdx = 0;

export let agents = [];

export function getAgentColor(ownerId) {
    if (!ownerId) return '#4a5568';
    if (!colorMap.has(ownerId)) {
        colorMap.set(ownerId, AGENT_COLORS[colorIdx % AGENT_COLORS.length]);
        colorIdx++;
    }
    return colorMap.get(ownerId);
}

export function getAgentBorderTile(ownerId) {
    if (!ownerId) return null;
    const keys = [...colorMap.keys()];
    const idx = keys.indexOf(ownerId);
    return BORDER_TILES[Math.max(0, idx) % BORDER_TILES.length];
}

export function getAgentIndex(ownerId) {
    const keys = [...colorMap.keys()];
    return keys.indexOf(ownerId);
}

export function updateAgents(agentList) {
    agents = agentList;
    agentList.forEach(a => getAgentColor(a.id));
}
