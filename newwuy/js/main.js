import state from './state.js';
import { hexToPixel } from './hex.js';
import { loadAllAssets } from './assets.js';
import { setupCameraControls } from './camera.js';
import { loadWorldMap, updateSingleTile } from './map.js';
import { updateAgents, agents, getAgentColor } from './agents.js';
import { connectWebSocket, onMessage, fetchAgents, fetchStats, fetchEvents } from './network.js';
import { initAgentSprites, updateAgentSprites, drawAgentSprites, moveAgentToTile, sendSpriteToAgent } from './agent-sprites.js';
import { initTradeRoutes, updateShips, drawShips } from './ships.js';
import {
    drawStars, drawPlanet, drawUnclaimedBackground,
    drawAllTiles, drawTerritoryLabels,
    getHexAtMouse, drawSelectionCursor, drawLoadingScreen,
} from './renderer.js';

let dataReady = false;
let assetsReady = false;
const eventFeed = [];
const MAX_EVENTS = 20;

function init() {
    const canvas = document.getElementById('game-canvas');
    state.canvas = canvas;
    state.ctx = canvas.getContext('2d');

    resize();
    window.addEventListener('resize', resize);
    setupCameraControls(canvas);

    loadAllAssets(onAssetsLoaded);
    loadGameData();

    requestAnimationFrame(render);
}

function resize() {
    state.canvas.width = window.innerWidth;
    state.canvas.height = window.innerHeight;
}

async function loadGameData() {
    try {
        const agentList = await fetchAgents();
        updateAgents(agentList);

        const world = await loadWorldMap();
        state.mapData = world.mapData;
        state.mapLookup = world.mapLookup;
        state.occupiedCells = world.occupiedCells;
        state.occupiedSet = world.occupiedSet;
        state.allTilesLookup = world.allTilesLookup;

        dataReady = true;
        tryFinishInit();

        const [stats, events] = await Promise.all([fetchStats(), fetchEvents(20)]);
        state.gameStats = stats;
        events.reverse().forEach(e => addEvent(e));
        updateUI();
    } catch (err) {
        console.error('[Init] Failed to load game data:', err);
        showConnectionError();
    }
}

function onAssetsLoaded() {
    assetsReady = true;
    tryFinishInit();
}

function tryFinishInit() {
    if (!dataReady || !assetsReady) return;

    state.loaded = true;

    if (state.mapData.length > 0) {
        const avgQ = state.mapData.reduce((s, t) => s + t.q, 0) / state.mapData.length;
        const avgR = state.mapData.reduce((s, t) => s + t.r, 0) / state.mapData.length;
        const center = hexToPixel(avgQ, avgR);
        state.cameraX = center.x;
        state.cameraY = center.y;
    }

    initAgentSprites();
    initTradeRoutes();
    setupWebSocketHandlers();
    connectWebSocket();

    setInterval(refreshData, 30000);
}

async function refreshData() {
    try {
        const agentList = await fetchAgents();
        updateAgents(agentList);
        updateUI();
    } catch (e) { /* silent */ }
}

function setupWebSocketHandlers() {
    onMessage('connected', (data) => {
        console.log('[WS] Server:', data.message);
    });

    onMessage('tile_update', (data) => {
        updateSingleTile(data.tile);
    });

    onMessage('game_event', (data) => {
        const event = data.event;
        addEvent(event);
        const eventData = event.data || {};

        if (event.type === 'expand' && eventData.tile) {
            moveAgentToTile(event.actor_id, eventData.tile.q, eventData.tile.r);
        }

        if (event.type === 'fortify' && eventData.tile) {
            moveAgentToTile(event.actor_id, eventData.tile.q, eventData.tile.r);
        }

        if (event.type === 'attack_declared' && eventData.tile) {
            moveAgentToTile(event.actor_id, eventData.tile.q, eventData.tile.r);
        }

        if (event.type === 'message' && eventData.to_id) {
            sendSpriteToAgent(event.actor_id, eventData.to_id);
        }

        if (event.type === 'trade_proposed' && eventData.to_id) {
            sendSpriteToAgent(event.actor_id, eventData.to_id);
        }

        if (event.type === 'trade_accepted' && eventData) {
            const from = eventData.from_id || event.actor_id;
            const to = eventData.to_id;
            if (from && to) {
                sendSpriteToAgent(from, to);
            }
        }

        if (event.type === 'gift' && eventData.to) {
            const toAgent = state.mapData.find(t => t.owner_name === eventData.to);
            if (toAgent) sendSpriteToAgent(event.actor_id, toAgent.owner_id);
        }
    });

    onMessage('agent_joined', async () => {
        const agentList = await fetchAgents();
        updateAgents(agentList);
        const world = await loadWorldMap();
        state.mapData = world.mapData;
        state.mapLookup = world.mapLookup;
        state.occupiedCells = world.occupiedCells;
        state.occupiedSet = world.occupiedSet;
        state.allTilesLookup = world.allTilesLookup;
        initAgentSprites();
        updateUI();
    });

    onMessage('map_expanded', async () => {
        console.log('[WS] Map expanded — reloading...');
        const world = await loadWorldMap();
        state.mapData = world.mapData;
        state.mapLookup = world.mapLookup;
        state.occupiedCells = world.occupiedCells;
        state.occupiedSet = world.occupiedSet;
        state.allTilesLookup = world.allTilesLookup;
        initAgentSprites();
        initTradeRoutes();
    });
}

function addEvent(event) {
    eventFeed.unshift(event);
    if (eventFeed.length > MAX_EVENTS) eventFeed.pop();
    renderEventFeed();
}

function renderEventFeed() {
    const el = document.getElementById('event-feed');
    if (!el) return;
    el.innerHTML = eventFeed.slice(0, 8).map(e => {
        const color = getEventColor(e.type);
        const desc = e.description || `${e.type}`;
        return `<div style="color:${color};margin-bottom:3px;font-size:10px;opacity:0.9">${desc}</div>`;
    }).join('');
}

function getEventColor(type) {
    switch (type) {
        case 'attack_success': case 'attack_failed': case 'attack_declared': return '#e53e6b';
        case 'expand': case 'join': return '#00e5cc';
        case 'trade_proposed': case 'trade_accepted': return '#dd8844';
        case 'gift': return '#9b59b6';
        case 'fortify': return '#3498db';
        case 'starvation': return '#ff6b6b';
        default: return '#718096';
    }
}

function updateUI() {
    const lbEl = document.getElementById('lb-entries');
    if (lbEl && agents.length > 0) {
        lbEl.innerHTML = agents.slice(0, 8).map((a, i) => {
            const color = getAgentColor(a.id);
            return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;font-size:11px">
                <span style="color:#555;width:14px">${i + 1}</span>
                <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block"></span>
                <span style="color:#ccc;flex:1">${a.display_name}</span>
                <span style="color:${color}">${a.territory_count}</span>
            </div>`;
        }).join('');
    }

    const statsEl = document.getElementById('game-stats');
    if (statsEl && state.gameStats) {
        const s = state.gameStats;
        statsEl.innerHTML = `Tick: ${s.current_tick} | Tiles: ${s.claimed_tiles}/${s.total_tiles} | Agents: ${s.total_agents}`;
    }
}

function showConnectionError() {
    const el = document.getElementById('connection-status');
    if (el) {
        el.textContent = 'Cannot connect to server';
        el.style.color = '#e53e6b';
    }
}

function render(ts = 0) {
    if (!state.lastRenderTs) state.lastRenderTs = ts;
    const dt = Math.min(0.05, (ts - state.lastRenderTs) / 1000 || 0.016);
    state.lastRenderTs = ts;
    state.time += dt * 60;

    drawStars();
    drawPlanet(dt);

    if (!state.loaded) {
        drawLoadingScreen();
        requestAnimationFrame(render);
        return;
    }

    drawUnclaimedBackground();
    drawAllTiles();

    updateAgentSprites(dt);
    updateShips(dt);

    state.hoveredHex = getHexAtMouse();
    drawSelectionCursor();

    drawAgentSprites();
    drawShips();
    drawTerritoryLabels();

    requestAnimationFrame(render);
}

init();
