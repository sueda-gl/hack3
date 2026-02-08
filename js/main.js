/**
 * CLAWQUEST - Main Entry Point
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
    setOrbitTarget,
    setControlsEnabled,
    triggerClaimEffect,
    triggerTradeRoute,
    triggerAttackEffect
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
            
            // Wait for tile spawn animation to complete before flying
            setTimeout(() => {
                triggerIntroFlyover();
            }, 1400);
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
    
    // Fly with orbit, lookAt smoothly transitions: map center → capital → map center
    // No jarring re-center needed — the orbit target naturally arrives at (0,0,0)
    const endLookAt = new THREE.Vector3(0, 0, 0);
    flyCamera(targetPosition, targetLookAt, 5000, () => {
        // Keep controls disabled — welcome screen takes over
        setControlsEnabled(false);
        showWelcomeOverlay();
        console.log('Intro flyover complete - showing welcome screen');
    }, Math.PI, endLookAt);
}

/**
 * Show the welcome overlay with staggered animations.
 * Click anywhere to dismiss and enable game controls.
 */
function showWelcomeOverlay() {
    const overlay = document.getElementById('welcome-overlay');
    if (!overlay) return;
    
    // Show the overlay (display: flex so it's centered)
    overlay.style.display = 'flex';
    
    // Trigger the fade-in + staggered child animations on next frame
    requestAnimationFrame(() => {
        overlay.classList.add('welcome-visible');
    });
    
    // Click anywhere to dismiss
    overlay.addEventListener('click', function dismiss() {
        overlay.removeEventListener('click', dismiss);
        
        // Fade out
        overlay.classList.add('welcome-fadeout');
        
        // After fade completes, remove and enable controls
        setTimeout(() => {
            overlay.style.display = 'none';
            overlay.classList.remove('welcome-visible', 'welcome-fadeout');
            setControlsEnabled(true);
            console.log('Welcome dismissed - controls enabled');
        }, 600);
    });
}

/**
 * Update a single tile (for WebSocket updates)
 * @param {object} tileData - The tile data from server
 */
function updateTile(tileData) {
    // Check if this is a claim (unclaimed → owned)
    const existingHex = getHexAt(tileData.q, tileData.r);
    const wasClaimed = existingHex?.userData?.owner_id || null;
    const isClaim = !wasClaimed && tileData.owner_id;
    
    // Remove existing hex at this position
    removeHexFromScene(tileData.q, tileData.r);
    
    // Create new hex with updated data
    const color = getAgentColor(tileData.owner_id, currentAgent);
    const isPlayerTile = tileData.owner_id !== null;
    const isGlowing = currentAgent && tileData.owner_id === currentAgent.id;
    
    const hex = createHexagonTile(tileData.q, tileData.r, color, isPlayerTile, isGlowing);
    hex.userData.id = tileData.id;
    hex.userData.type = tileData.terrain;
    hex.userData.owner_id = tileData.owner_id;
    hex.userData.owner_name = tileData.owner_name;
    hex.userData.fortification = tileData.fortification;
    hex.userData.is_capital = tileData.is_capital || false;
    
    if (isClaim) {
        // Claim animation: beacon pillar + tile rises from unclaimed height
        // triggerClaimEffect sets scale and rise animation internally
        addHexToScene(hex);
        triggerClaimEffect(hex, color);
    } else {
        // Normal update: standard spawn animation
        hex.scale.set(0.01, 0.01, 0.01);
        hex.userData.spawnTime = Date.now();
        addHexToScene(hex);
    }
    
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
            <div style="margin-bottom: 4px;">CLAWQUEST</div>
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
// HELPER: Find tiles for animation source/target
// =============================================================================

/**
 * Get hex neighbors (axial coordinates) — mirrors server-side getNeighbors.
 */
function getHexNeighborCoords(q, r) {
    return [
        { q: q + 1, r: r },
        { q: q - 1, r: r },
        { q: q, r: r + 1 },
        { q: q, r: r - 1 },
        { q: q + 1, r: r - 1 },
        { q: q - 1, r: r + 1 },
    ];
}

/**
 * Find an adjacent hex tile owned by a specific agent ID.
 * Used to find the "from" tile for attack animations.
 * @param {number} targetQ - Target tile q
 * @param {number} targetR - Target tile r
 * @param {string} ownerId - Agent ID to match
 * @returns {THREE.Group|null}
 */
function findAdjacentOwnedBy(targetQ, targetR, ownerId) {
    if (!ownerId) return null;
    const neighbors = getHexNeighborCoords(targetQ, targetR);
    for (const n of neighbors) {
        const hex = getHexAt(n.q, n.r);
        if (hex && hex.userData.owner_id === ownerId) {
            return hex;
        }
    }
    return null;
}

/**
 * Find any tile owned by an agent matching a display name.
 * Prefers capital tiles. Used for trade/gift route endpoints.
 * @param {string} displayName - Agent display name
 * @returns {THREE.Group|null}
 */
function findTileOwnedByName(displayName) {
    if (!displayName) return null;
    const allHexes = getHexagons();
    let fallback = null;
    for (const hex of allHexes) {
        if (hex.userData.owner_name === displayName) {
            // Prefer capital
            if (hex.userData.is_capital) return hex;
            if (!fallback) fallback = hex;
        }
    }
    return fallback;
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
        window.dispatchEvent(new CustomEvent('clawquest-action', { detail: data.event }));

        // --- Trigger visual effects based on event type ---
        const event = data.event;
        const eventData = event.data || {};

        if (event.type === 'attack_declared' || event.type === 'attack_success' || event.type === 'attack_failed') {
            // Attack animation: find attacker's adjacent tile as "from", target tile as "to"
            const targetTile = eventData.tile;
            if (targetTile) {
                const toHex = getHexAt(targetTile.q, targetTile.r);
                if (toHex) {
                    // actor_id is the attacker's agent ID (set by logEvent on server)
                    // eventData.attacker_id exists on attack_declared, actor_id on all
                    const attackerId = eventData.attacker_id || event.actor_id;
                    const fromHex = findAdjacentOwnedBy(targetTile.q, targetTile.r, attackerId);
                    const isSuccess = event.type === 'attack_success';
                    
                    if (fromHex) {
                        triggerAttackEffect(fromHex, toHex, 0xe53e6b, isSuccess);
                    } else {
                        // Fallback: play impact centered on the target tile
                        triggerAttackEffect(toHex, toHex, 0xe53e6b, isSuccess);
                    }
                    console.log(`[FX] Attack animation: ${event.type} at (${targetTile.q}, ${targetTile.r})`);
                }
            }
        }

        if (event.type === 'gift') {
            // Gift animation: draw route between involved tiles or agent capitals
            const tileLoc = eventData.tile;
            if (tileLoc) {
                // Tile gift: animate from any tile owned by sender to the gifted tile
                const giftedHex = getHexAt(tileLoc.q, tileLoc.r);
                if (giftedHex) {
                    const fromHex = findTileOwnedByName(eventData.from);
                    if (fromHex && fromHex !== giftedHex) {
                        triggerTradeRoute(fromHex, giftedHex, 0x9b59b6); // purple for gifts
                        console.log(`[FX] Gift route animation to (${tileLoc.q}, ${tileLoc.r})`);
                    }
                }
            } else if (eventData.food !== undefined || eventData.metal !== undefined) {
                // Resource gift: animate between representative tiles of the two agents
                const fromHex = findTileOwnedByName(eventData.from);
                const toHex = findTileOwnedByName(eventData.to);
                if (fromHex && toHex && fromHex !== toHex) {
                    triggerTradeRoute(fromHex, toHex, 0xdd8844); // amber for resource trade
                    console.log(`[FX] Trade route animation: ${eventData.from} → ${eventData.to}`);
                }
            }
        }

        if (event.type === 'trade_accepted') {
            // Trade completed: animate route between the two agents' territories
            const fromHex = findTileOwnedByName(eventData.from);
            const toHex = findTileOwnedByName(eventData.to);
            if (fromHex && toHex && fromHex !== toHex) {
                triggerTradeRoute(fromHex, toHex, 0x00e5cc); // teal for trade
                console.log(`[FX] Trade route: ${eventData.from} ↔ ${eventData.to}`);
            }
        }

        if (event.type === 'trade_proposed') {
            // Trade proposed: subtle route preview between the two agents
            const fromHex = findTileOwnedByName(eventData.from);
            const toHex = findTileOwnedByName(eventData.to);
            if (fromHex && toHex && fromHex !== toHex) {
                triggerTradeRoute(fromHex, toHex, 0x00e5cc); // teal for trade
                console.log(`[FX] Trade proposal route: ${eventData.from} → ${eventData.to}`);
            }
        }
    });
    
    onMessage('message_sent', (data) => {
        console.log('Message sent:', data.message);
        // Dispatch for panel activity feed
        window.dispatchEvent(new CustomEvent('clawquest-message', { detail: data.message }));
    });
    
    onMessage('agent_joined', (data) => {
        console.log(`Agent joined: ${data.agent.name}`);
        addEventToFeed({ description: `${data.agent.name} joined the game`, type: 'join' });
    });
    
    onMessage('territory_changed', () => {
        loadMapFromServer();
        updateLeaderboard();
    });
    
    onMessage('map_expanded', () => {
        console.log('Map expanded - reloading tiles...');
        loadMapFromServer();
        updateLeaderboard();
    });
    
    onMessage('dashboard_reply', (data) => {
        console.log('Dashboard reply from agent:', data);
        // Dispatch for panel chat
        window.dispatchEvent(new CustomEvent('clawquest-dashboard-reply', { detail: data }));
    });
    
    onMessage('default', (data) => {
        console.log('WS event:', data);
    });
}

// =============================================================================
// LEADERBOARD
// =============================================================================

const LB_COLORS = [
    '#ff3366', '#ff9933', '#cc66ff', '#33ccff',
    '#ff3333', '#ffcc00', '#00ffaa', '#ff00cc',
];
const lbColorMap = new Map();
let lbColorIdx = 0;

function getLbColor(agentId) {
    if (!lbColorMap.has(agentId)) {
        lbColorMap.set(agentId, LB_COLORS[lbColorIdx % LB_COLORS.length]);
        lbColorIdx++;
    }
    return lbColorMap.get(agentId);
}

async function updateLeaderboard() {
    try {
        const res = await fetch(`${window.location.origin}/api/map/agents`);
        if (!res.ok) return;
        const agents = await res.json();

        const container = document.getElementById('lb-entries');
        if (!container) return;

        container.innerHTML = agents.map((agent, i) => {
            const isYou = currentAgent && agent.id === currentAgent.id;
            const color = isYou ? '#00e5cc' : getLbColor(agent.id);
            return `<div class="lb-entry${isYou ? ' lb-you' : ''}">
                <span class="lb-rank">${i + 1}</span>
                <span class="lb-dot" style="background:${color};color:${color}"></span>
                <span class="lb-name">${agent.display_name}</span>
                <span class="lb-tiles">${agent.territory_count}</span>
            </div>`;
        }).join('');
    } catch (e) {
        // silent
    }
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
            
            // Broadcast tile selection to panel
            window.dispatchEvent(new CustomEvent('clawquest-tile-selected', { 
                detail: {
                    q: clickedTile.q,
                    r: clickedTile.r,
                    id: clickedTile.id,
                    type: clickedTile.type,
                    owner_id: clickedTile.owner_id,
                    owner_name: clickedTile.owner_name,
                    fortification: clickedTile.fortification,
                    is_capital: clickedTile.is_capital
                }
            }));
        } else {
            // Deselect
            selectedHex = null;
            updateInfoPanel(null);
            updateSelectionMarker(null);
            
            // Broadcast deselection to panel
            window.dispatchEvent(new CustomEvent('clawquest-tile-selected', { detail: null }));
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
    console.log('CLAWQUEST - Initializing...');
    
    // Setup WebSocket handlers
    setupWebSocketHandlers();
    
    // Setup DOM event handlers
    setupEventHandlers();
    
    // Load map from server
    await loadMapFromServer();
    
    // Load leaderboard
    await updateLeaderboard();
    
    // Connect WebSocket for real-time updates
    connectWebSocket();
    
    // Start animation loop
    startAnimationLoop();
    
    // Refresh leaderboard periodically
    setInterval(updateLeaderboard, 15000);
    
    console.log('CLAWQUEST - Ready');
}

// Start the game
init();

// =============================================================================
// EXPOSE FUNCTIONS FOR DEBUGGING
// =============================================================================

window.clawquest = {
    loadMap: loadMapFromServer,
    setAgent: (agent) => {
        currentAgent = agent;
        loadMapFromServer();
    },
    getHexAt: getHexAt,

    // =========================================================================
    // DEMO: Expansion (claim effect)
    // Usage: clawquest.demoExpansion(0, 0)
    // =========================================================================
    demoExpansion: (q, r) => {
        const existing = getHexAt(q, r);
        if (!existing) {
            console.log(`No tile at (${q}, ${r}). Try other coordinates.`);
            return;
        }
        
        const claimColor = 0x00e5cc;
        removeHexFromScene(q, r);
        
        const hex = createHexagonTile(q, r, claimColor, true, true);
        hex.userData.id = existing.userData.id;
        hex.userData.type = existing.userData.type;
        hex.userData.owner_id = 'test';
        hex.userData.owner_name = 'TEST';
        hex.userData.fortification = 0;
        hex.userData.is_capital = false;
        
        addHexToScene(hex);
        triggerClaimEffect(hex, claimColor);
        rebuildBorders();
        
        console.log(`[DEMO] Expansion at (${q}, ${r})`);
    },

    // =========================================================================
    // DEMO: Trade Route
    // Usage: clawquest.demoTradeRoute(fromQ, fromR, toQ, toR)
    // Example: clawquest.demoTradeRoute(0, 0, 3, -2)
    // =========================================================================
    demoTradeRoute: (fromQ, fromR, toQ, toR, color) => {
        const fromHex = getHexAt(fromQ, fromR);
        const toHex = getHexAt(toQ, toR);
        if (!fromHex) {
            console.log(`No tile at source (${fromQ}, ${fromR}).`);
            return;
        }
        if (!toHex) {
            console.log(`No tile at destination (${toQ}, ${toR}).`);
            return;
        }
        
        triggerTradeRoute(fromHex, toHex, color || 0x00e5cc);
        console.log(`[DEMO] Trade route from (${fromQ},${fromR}) → (${toQ},${toR})`);
    },

    // =========================================================================
    // DEMO: Attack
    // Usage: clawquest.demoAttack(fromQ, fromR, toQ, toR, success?)
    // Example: clawquest.demoAttack(0, 0, 2, -1, true)
    // =========================================================================
    demoAttack: (fromQ, fromR, toQ, toR, success) => {
        const fromHex = getHexAt(fromQ, fromR);
        const toHex = getHexAt(toQ, toR);
        if (!fromHex) {
            console.log(`No tile at attacker (${fromQ}, ${fromR}).`);
            return;
        }
        if (!toHex) {
            console.log(`No tile at target (${toQ}, ${toR}).`);
            return;
        }
        
        triggerAttackEffect(fromHex, toHex, 0xe53e6b, success !== false);
        console.log(`[DEMO] Attack from (${fromQ},${fromR}) → (${toQ},${toR}) [${success !== false ? 'SUCCESS' : 'FAILED'}]`);
    },

    // Keep old alias for backwards compat
    testEffect: (q, r) => {
        window.clawquest.demoExpansion(q, r);
    },
};
