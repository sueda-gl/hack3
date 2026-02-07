/**
 * CONQUEST - Main Entry Point
 * 
 * Orchestrates the game:
 * - Initializes graphics and network
 * - Manages game state
 * - Handles user interactions
 * - Updates UI panels
 */

import * as THREE from 'three';

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
    rebuildBorders,
    updateHoverCursor,
    updateSelectionMarker,
    flyCamera,
    addStructureToHex,
    removeStructureFromHex,
    setOrbitTarget
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
let introFlightDone = false;

// Get agent ID from URL (same as panel script)
const urlParams = new URLSearchParams(window.location.search);
const AGENT_ID = urlParams.get('agent') || 'suclaw';

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
            hex.userData.is_capital = tile.is_capital || false;
            
            // Randomize spawn time slightly for cascading effect
            hex.scale.set(0.01, 0.01, 0.01);
            hex.userData.spawnDelay = Math.random() * 500;
            hex.userData.spawnTime = Date.now();
            
            addHexToScene(hex);
            
            // Place cyber structure on capital tiles
            if (tile.is_capital) {
                addStructureToHex(hex);
            }
        });
        
        console.log(`Loaded ${tiles.length} tiles from server`);
        
        // Rebuild territory borders after loading all tiles
        rebuildBorders();
        
        updateInfoPanel();
        
        // Hide loading indicator
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
        
        // Trigger intro camera flyover on first load
        if (!introFlightDone) {
            introFlightDone = true;
            
            // Wait for tiles to start spawning in before flying
            setTimeout(() => {
                triggerIntroFlyover();
            }, 800);
        }
        
    } catch (error) {
        console.error('Error loading map:', error);
        const info = document.getElementById('info');
        info.innerHTML = `<span style="color: #e53e6b;">ERROR: Cannot connect to server</span>`;
    }
}

/**
 * Trigger the intro camera flyover to the player's territory.
 * Finds the player's tiles by matching the AGENT_ID from the URL,
 * computes their center, and flies the camera there.
 */
function triggerIntroFlyover() {
    const hexagons = getHexagons();
    
    // Find tiles owned by this agent (match by owner_name case-insensitive or owner_id)
    const playerTiles = hexagons.filter(hex => {
        const ownerId = hex.userData.owner_id;
        const ownerName = hex.userData.owner_name;
        if (!ownerId) return false;
        return ownerId === AGENT_ID || 
               (ownerName && ownerName.toLowerCase() === AGENT_ID.toLowerCase());
    });
    
    // Try to find the player's capital tile first
    let targetLookAt;
    const capitalTile = playerTiles.find(hex => hex.userData.is_capital);
    
    if (capitalTile) {
        // Fly to capital tile
        targetLookAt = capitalTile.position.clone();
    } else if (playerTiles.length > 0) {
        // No capital - fall back to center of territory
        const center = new THREE.Vector3(0, 0, 0);
        playerTiles.forEach(hex => center.add(hex.position));
        center.divideScalar(playerTiles.length);
        targetLookAt = center;
    } else {
        // No player tiles found - fly to map center
        targetLookAt = new THREE.Vector3(0, 0, 0);
    }
    
    // Compute direction from territory center to capital, so camera lands
    // on the far side of the capital looking back toward the rest of the city
    let camDir;
    if (playerTiles.length > 1 && capitalTile) {
        const territoryCenter = new THREE.Vector3(0, 0, 0);
        playerTiles.forEach(hex => territoryCenter.add(hex.position));
        territoryCenter.divideScalar(playerTiles.length);
        
        // Direction FROM territory center THROUGH capital (outward)
        camDir = new THREE.Vector3().subVectors(targetLookAt, territoryCenter);
        camDir.y = 0; // Keep horizontal
        camDir.normalize();
    } else {
        // Fallback direction
        camDir = new THREE.Vector3(-0.3, 0, 1).normalize();
    }
    
    // Place camera beyond the capital along that direction, low and close
    const targetPosition = new THREE.Vector3(
        targetLookAt.x + camDir.x * 7,
        targetLookAt.y + 2.5,
        targetLookAt.z + camDir.z * 7
    );
    
    // Fly with 180-degree (Math.PI) orbit around the capital
    flyCamera(targetPosition, targetLookAt, 4000, () => {
        // Reset orbit pivot to map center so zooming out shows the full map normally
        setOrbitTarget(0, 0, 0);
        console.log('Intro flyover complete - controls enabled');
    }, Math.PI);
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
    hex.userData.is_capital = tileData.is_capital || false;
    
    // Reset scale for spawn animation
    hex.scale.set(0.01, 0.01, 0.01);
    hex.userData.spawnTime = Date.now();
    
    addHexToScene(hex);
    
    // Place cyber structure on capital tiles
    if (tileData.is_capital) {
        addStructureToHex(hex);
    }
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
            
            // Show selection marker
            const hexGroup = getHexAt(clickedTile.q, clickedTile.r);
            if (hexGroup) {
                updateSelectionMarker(hexGroup);
            }
        } else {
            // Deselect
            selectedHex = null;
            updateInfoPanel(null);
            updateSelectionMarker(null);
        }
    });

    // Hover handler
    gameContainer.addEventListener('mousemove', (event) => {
        const hoveredTile = raycastClick(event); // Reusing raycast logic for hover
        
        if (hoveredTile) {
            const hexGroup = getHexAt(hoveredTile.q, hoveredTile.r);
            if (hexGroup) {
                updateHoverCursor(hexGroup);
                gameContainer.style.cursor = 'pointer';
            }
        } else {
            updateHoverCursor(null);
            gameContainer.style.cursor = 'default';
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
