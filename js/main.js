/**
 * CONQUEST - Main Entry Point
 * 
 * Orchestrates the game:
 * - Initializes graphics and network
 * - Manages game state
 * - Handles user interactions
 * - Updates UI panels
 */

import {
    getAgentColor,
    createHexagonTile,
    addHexToScene,
    removeHexFromScene,
    clearAllHexes,
    getHexAt,
    getHexagons,
    startAnimationLoop,
    handleResize,
    raycastClick,
    getGameContainer,
    rebuildBorders
} from './graphics.js';

import {
    connectWebSocket,
    onMessage,
    fetchMap
} from './network.js';

// =============================================================================
// GAME STATE
// =============================================================================

let currentAgent = null;

// =============================================================================
// MAP LOADING
// =============================================================================

/**
 * Load the map from the server and render it
 */
async function loadMapFromServer() {
    try {
        const tiles = await fetchMap();
        
        // Clear existing hexagons
        clearAllHexes();
        
        // Create hexagons from server data
        tiles.forEach(tile => {
            const color = getAgentColor(tile.owner_id, currentAgent);
            const isPlayerTile = tile.owner_id !== null;
            const isGlowing = currentAgent && tile.owner_id === currentAgent.id;
            
            const hex = createHexagonTile(tile.q, tile.r, color, isPlayerTile, isGlowing);
            
            // Store tile data for click handler
            // Note: Server sends 'terrain', we store as 'type' for legacy reasons
            // Using direct assignment to ensure properties are set correctly
            hex.userData.id = tile.id;
            hex.userData.type = tile.terrain;
            hex.userData.owner_id = tile.owner_id;
            hex.userData.owner_name = tile.owner_name;
            hex.userData.fortification = tile.fortification;
            
            addHexToScene(hex);
        });
        
        console.log(`Loaded ${tiles.length} tiles from server`);
        
        // Rebuild territory borders after loading all tiles
        rebuildBorders();
        
        updateInfoPanel();
        
        // Hide loading indicator
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
        
    } catch (error) {
        console.error('Error loading map:', error);
        const info = document.getElementById('info');
        info.innerHTML = `<span style="color: #e53e6b;">ERROR: Cannot connect to server</span>`;
    }
}

/**
 * Update a single tile (for WebSocket updates)
 * @param {object} tileData - The tile data from server
 */
function updateTile(tileData) {
    // Remove existing hex at this position
    removeHexFromScene(tileData.q, tileData.r);
    
    // Create new hex with updated data
    const color = getAgentColor(tileData.owner_id, currentAgent);
    const isPlayerTile = tileData.owner_id !== null;
    const isGlowing = currentAgent && tileData.owner_id === currentAgent.id;
    
    const hex = createHexagonTile(tileData.q, tileData.r, color, isPlayerTile, isGlowing);
    // Using direct assignment to ensure properties are set correctly
    hex.userData.id = tileData.id;
    hex.userData.type = tileData.terrain;
    hex.userData.owner_id = tileData.owner_id;
    hex.userData.owner_name = tileData.owner_name;
    hex.userData.fortification = tileData.fortification;
    
    addHexToScene(hex);
}

// =============================================================================
// UI UPDATES
// =============================================================================

/**
 * Update the info panel in the bottom-left
 * @param {object|null} selectedTile - Selected tile data, or null for default view
 */
function updateInfoPanel(selectedTile = null) {
    const info = document.getElementById('info');
    
    if (selectedTile) {
        const ownerText = selectedTile.owner_name || 'Unclaimed';
        const typeText = selectedTile.type === 'unknown' ? '???' : selectedTile.type;
        info.innerHTML = `
            <div style="color: #00e5cc; margin-bottom: 4px;">TILE (${selectedTile.q}, ${selectedTile.r})</div>
            <div>Owner: <span style="color: ${selectedTile.owner_id ? '#e53e6b' : '#4a5568'}">${ownerText}</span></div>
            <div>Type: ${typeText}</div>
            <div>Fort: ${selectedTile.fortification || 0}</div>
        `;
    } else {
        const hexagons = getHexagons();
        const claimedCount = hexagons.filter(h => h.userData.owner_id).length;
        info.innerHTML = `
            <div style="margin-bottom: 4px;">CONQUEST</div>
            <div>Tiles: ${hexagons.length} | Claimed: ${claimedCount}</div>
            <div style="color: #4a5568; font-size: 10px; margin-top: 8px;">Click a tile for info</div>
        `;
    }
}

// =============================================================================
// EVENT FEED
// =============================================================================

const eventFeed = [];
const MAX_EVENTS = 8;

/**
 * Add an event to the feed
 * @param {object} event - Event object with type and description
 */
function addEventToFeed(event) {
    eventFeed.unshift(event);
    if (eventFeed.length > MAX_EVENTS) {
        eventFeed.pop();
    }
    renderEventFeed();
}

/**
 * Render the event feed UI
 */
function renderEventFeed() {
    const feedEl = document.getElementById('event-feed');
    if (!feedEl) return;
    
    feedEl.innerHTML = eventFeed.map(e => {
        const color = getEventColor(e.type);
        return `<div style="color: ${color}; margin-bottom: 4px; opacity: 0.9;">${e.description}</div>`;
    }).join('');
}

/**
 * Get the color for an event type
 * @param {string} type - Event type
 * @returns {string} - CSS color
 */
function getEventColor(type) {
    switch (type) {
        case 'attack_success':
        case 'attack_failed':
            return '#e53e6b';
        case 'expand':
        case 'join':
            return '#00e5cc';
        case 'trade':
            return '#dd8844';
        case 'gift':
            return '#9b59b6';
        case 'fortify':
            return '#3498db';
        default:
            return '#718096';
    }
}

// =============================================================================
// WEBSOCKET MESSAGE HANDLERS
// =============================================================================

function setupWebSocketHandlers() {
    onMessage('connected', (data) => {
        console.log('Server:', data.message);
    });
    
    onMessage('tile_update', (data) => {
        console.log('Tile update:', data.tile);
        updateTile(data.tile);
        // Rebuild borders since ownership may have changed
        rebuildBorders();
        updateInfoPanel();
    });
    
    onMessage('game_event', (data) => {
        console.log('Game event:', data.event.description);
        addEventToFeed(data.event);
        // Dispatch for panel
        window.dispatchEvent(new CustomEvent('conquest-action', { detail: data.event }));
    });
    
    onMessage('message_sent', (data) => {
        console.log('Message sent:', data.message);
        // Dispatch for panel activity feed
        window.dispatchEvent(new CustomEvent('conquest-message', { detail: data.message }));
    });
    
    onMessage('agent_joined', (data) => {
        console.log(`Agent joined: ${data.agent.name}`);
        addEventToFeed({ description: `${data.agent.name} joined the game`, type: 'join' });
    });
    
    onMessage('territory_changed', () => {
        loadMapFromServer();
    });
    
    onMessage('dashboard_reply', (data) => {
        console.log('Dashboard reply from agent:', data);
        // Dispatch for panel chat
        window.dispatchEvent(new CustomEvent('conquest-dashboard-reply', { detail: data }));
    });
    
    onMessage('default', (data) => {
        console.log('WS event:', data);
    });
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

function setupEventHandlers() {
    const gameContainer = getGameContainer();
    
    // Resize handler
    window.addEventListener('resize', handleResize);
    
    // Click handler
    let selectedHex = null;
    
    gameContainer.addEventListener('click', (event) => {
        const clickedTile = raycastClick(event);
        
        if (clickedTile) {
            console.log(`Clicked hex: q=${clickedTile.q}, r=${clickedTile.r}`, clickedTile);
            selectedHex = clickedTile;
            updateInfoPanel(clickedTile);
        }
    });
}

// =============================================================================
// INITIALIZE
// =============================================================================

async function init() {
    console.log('CONQUEST - Initializing...');
    
    // Setup WebSocket handlers
    setupWebSocketHandlers();
    
    // Setup DOM event handlers
    setupEventHandlers();
    
    // Load map from server
    await loadMapFromServer();
    
    // Connect WebSocket for real-time updates
    connectWebSocket();
    
    // Start animation loop
    startAnimationLoop();
    
    console.log('CONQUEST - Ready');
}

// Start the game
init();

// =============================================================================
// EXPOSE FUNCTIONS FOR DEBUGGING
// =============================================================================

window.conquest = {
    loadMap: loadMapFromServer,
    setAgent: (agent) => {
        currentAgent = agent;
        loadMapFromServer();
    },
    getHexAt: getHexAt,
};
