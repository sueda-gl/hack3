import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const API_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000/ws';

// Current player (null = spectator mode, set after joining)
let currentAgent = null;

// =============================================================================
// SCENE SETUP
// =============================================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);

// Get game container for sizing
const gameContainer = document.getElementById('game-container');
const getContainerSize = () => ({
    width: gameContainer.clientWidth,
    height: gameContainer.clientHeight
});

const { width: initialWidth, height: initialHeight } = getContainerSize();

const camera = new THREE.PerspectiveCamera(50, initialWidth / initialHeight, 0.1, 1000);
camera.position.set(0, 22, 16);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(initialWidth, initialHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
gameContainer.appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 8;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI / 2.2;

// =============================================================================
// COLOR PALETTE
// =============================================================================

const colors = {
    unclaimed: 0x2d3748,      // Dark slate/gray - unclaimed
    unclaimedDark: 0x1a202c,  // Darker variant
    yours: 0x00e5cc,          // Bright cyan/teal - YOUR tiles
    hostile: 0xe53e6b,        // Bright pink/red - other players
    // Tile type hints (subtle variations)
    farmland: 0x3d5a3d,       // Slight green tint
    mine: 0x5a4a3d,           // Slight brown tint
    mixed: 0x4a5a4a,          // Mixed tint
};

// Generate unique colors for different agents
const agentColors = new Map();
const colorPool = [
    0xe53e6b,  // Pink
    0xdd8844,  // Orange
    0x9b59b6,  // Purple
    0x3498db,  // Blue
    0xe74c3c,  // Red
    0xf39c12,  // Yellow
    0x1abc9c,  // Turquoise
    0xe91e63,  // Magenta
];
let colorIndex = 0;

function getAgentColor(agentId) {
    if (!agentId) return colors.unclaimed;
    if (currentAgent && agentId === currentAgent.id) return colors.yours;
    
    if (!agentColors.has(agentId)) {
        agentColors.set(agentId, colorPool[colorIndex % colorPool.length]);
        colorIndex++;
    }
    return agentColors.get(agentId);
}

// =============================================================================
// HEXAGON PARAMETERS
// =============================================================================

const hexRadius = 0.9;
const hexHeight = 0.45;
const gap = 0.06;

// Store hexagons
const hexagons = [];
const hexMap = new Map();

// =============================================================================
// CREATE HEXAGON TILE (your original visual code, preserved)
// =============================================================================

function createHexagonTile(q, r, tileColor, isPlayerTile = false, isGlowing = false) {
    const group = new THREE.Group();
    
    // Axial to world coordinates
    const x = hexRadius * (3/2 * q);
    const z = hexRadius * (Math.sqrt(3)/2 * q + Math.sqrt(3) * r);
    
    const effectiveRadius = hexRadius - gap / 2;
    const height = isPlayerTile ? hexHeight * 1.5 : hexHeight;
    
    const topColor = new THREE.Color(tileColor);
    const sideColorLight = topColor.clone().multiplyScalar(0.6);
    const sideColorDark = topColor.clone().multiplyScalar(0.35);
    
    // Small gap between triangles on top
    const triangleGap = gap * 0.8;
    const centerGap = triangleGap * 1.2;
    
    // Create 6 triangular top segments
    for (let i = 0; i < 6; i++) {
        const angle1 = (Math.PI / 3) * i;
        const angle2 = (Math.PI / 3) * (i + 1);
        const midAngle = (angle1 + angle2) / 2;
        
        // Center point pulled outward for gap
        const cx = Math.cos(midAngle) * centerGap;
        const cz = Math.sin(midAngle) * centerGap;
        
        // Outer vertices
        const outerR = effectiveRadius * 0.98;
        const x1 = Math.cos(angle1) * outerR;
        const z1 = Math.sin(angle1) * outerR;
        const x2 = Math.cos(angle2) * outerR;
        const z2 = Math.sin(angle2) * outerR;
        
        // Pull edges inward for gap between triangles
        const pull = triangleGap;
        const d1x = Math.cos(angle1 + Math.PI/2) * pull;
        const d1z = Math.sin(angle1 + Math.PI/2) * pull;
        const d2x = Math.cos(angle2 - Math.PI/2) * pull;
        const d2z = Math.sin(angle2 - Math.PI/2) * pull;
        
        const px1 = x1 + d1x;
        const pz1 = z1 + d1z;
        const px2 = x2 + d2x;
        const pz2 = z2 + d2z;
        
        // Top triangle
        const topGeom = new THREE.BufferGeometry();
        const verts = new Float32Array([
            cx, height, cz,
            px2, height, pz2,
            px1, height, pz1
        ]);
        topGeom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        topGeom.computeVertexNormals();
        
        const topMat = new THREE.MeshStandardMaterial({
            color: topColor,
            roughness: 0.5,
            metalness: 0.1,
            side: THREE.DoubleSide,
            emissive: isGlowing ? topColor : 0x000000,
            emissiveIntensity: isGlowing ? 0.4 : 0
        });
        
        const topMesh = new THREE.Mesh(topGeom, topMat);
        topMesh.castShadow = true;
        topMesh.receiveShadow = true;
        group.add(topMesh);
    }
    
    // Create side faces - 6 quads with proper lighting
    for (let i = 0; i < 6; i++) {
        const angle1 = (Math.PI / 3) * i;
        const angle2 = (Math.PI / 3) * (i + 1);
        
        const x1 = Math.cos(angle1) * effectiveRadius;
        const z1 = Math.sin(angle1) * effectiveRadius;
        const x2 = Math.cos(angle2) * effectiveRadius;
        const z2 = Math.sin(angle2) * effectiveRadius;
        
        // Determine side brightness based on face direction
        const faceAngle = (angle1 + angle2) / 2;
        // Light comes from top-right in the reference
        const lightAngle = -Math.PI / 4;
        const dotProduct = Math.cos(faceAngle - lightAngle);
        
        let sideColor;
        if (dotProduct > 0.3) {
            sideColor = sideColorLight;
        } else if (dotProduct < -0.3) {
            sideColor = sideColorDark;
        } else {
            sideColor = topColor.clone().multiplyScalar(0.5);
        }
        
        const sideGeom = new THREE.BufferGeometry();
        const sideVerts = new Float32Array([
            x1, height, z1,
            x1, 0, z1,
            x2, 0, z2,
            x1, height, z1,
            x2, 0, z2,
            x2, height, z2
        ]);
        sideGeom.setAttribute('position', new THREE.BufferAttribute(sideVerts, 3));
        sideGeom.computeVertexNormals();
        
        const sideMat = new THREE.MeshStandardMaterial({
            color: sideColor,
            roughness: 0.7,
            metalness: 0.05,
            side: THREE.DoubleSide,
            emissive: isGlowing ? sideColor : 0x000000,
            emissiveIntensity: isGlowing ? 0.2 : 0
        });
        
        const sideMesh = new THREE.Mesh(sideGeom, sideMat);
        sideMesh.castShadow = true;
        sideMesh.receiveShadow = true;
        group.add(sideMesh);
    }
    
    group.position.set(x, 0, z);
    group.userData = { q, r, color: tileColor, isPlayerTile, isGlowing };
    
    return group;
}

// =============================================================================
// LOAD MAP FROM SERVER
// =============================================================================

async function loadMapFromServer() {
    try {
        const response = await fetch(`${API_URL}/api/map`);
        if (!response.ok) throw new Error('Failed to fetch map');
        
        const tiles = await response.json();
        
        // Clear existing hexagons
        hexagons.forEach(hex => scene.remove(hex));
        hexagons.length = 0;
        hexMap.clear();
        
        // Create hexagons from server data
        tiles.forEach(tile => {
            const color = getAgentColor(tile.owner_id);
            const isPlayerTile = tile.owner_id !== null;
            const isGlowing = currentAgent && tile.owner_id === currentAgent.id;
            
            const hex = createHexagonTile(tile.q, tile.r, color, isPlayerTile, isGlowing);
            
            // Store tile data for click handler
            hex.userData = {
                ...hex.userData,
                id: tile.id,
                type: tile.type,
                owner_id: tile.owner_id,
                owner_name: tile.owner_name,
                fortification: tile.fortification,
            };
            
            scene.add(hex);
            hexagons.push(hex);
            hexMap.set(`${tile.q},${tile.r}`, hex);
        });
        
        console.log(`Loaded ${tiles.length} tiles from server`);
        updateInfoPanel();
        
        // Hide loading indicator
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
        
    } catch (error) {
        console.error('Error loading map:', error);
        // Show error in info panel
        const info = document.getElementById('info');
        info.innerHTML = `<span style="color: #e53e6b;">ERROR: Cannot connect to server</span>`;
    }
}

// =============================================================================
// UPDATE SINGLE TILE (for WebSocket updates)
// =============================================================================

function updateTile(tileData) {
    const key = `${tileData.q},${tileData.r}`;
    const existingHex = hexMap.get(key);
    
    if (existingHex) {
        scene.remove(existingHex);
        const index = hexagons.indexOf(existingHex);
        if (index > -1) hexagons.splice(index, 1);
    }
    
    const color = getAgentColor(tileData.owner_id);
    const isPlayerTile = tileData.owner_id !== null;
    const isGlowing = currentAgent && tileData.owner_id === currentAgent.id;
    
    const hex = createHexagonTile(tileData.q, tileData.r, color, isPlayerTile, isGlowing);
    hex.userData = {
        ...hex.userData,
        id: tileData.id,
        type: tileData.type,
        owner_id: tileData.owner_id,
        owner_name: tileData.owner_name,
        fortification: tileData.fortification,
    };
    
    scene.add(hex);
    hexagons.push(hex);
    hexMap.set(key, hex);
}

// =============================================================================
// WEBSOCKET CONNECTION
// =============================================================================

let ws = null;

function connectWebSocket() {
    ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'connected':
                    console.log('Server:', data.message);
                    break;
                    
                case 'tile_update':
                    console.log('Tile update:', data.tile);
                    updateTile(data.tile);
                    updateInfoPanel(); // Update claimed count
                    break;
                    
                case 'game_event':
                    console.log('Game event:', data.event.description);
                    addEventToFeed(data.event);
                    // Dispatch for panel
                    window.dispatchEvent(new CustomEvent('conquest-action', { detail: data.event }));
                    break;
                    
                case 'message_sent':
                    console.log('Message sent:', data.message);
                    // Dispatch for panel activity feed
                    window.dispatchEvent(new CustomEvent('conquest-message', { detail: data.message }));
                    break;
                    
                case 'agent_joined':
                    console.log(`Agent joined: ${data.agent.name}`);
                    addEventToFeed({ description: `${data.agent.name} joined the game`, type: 'join' });
                    break;
                    
                case 'territory_changed':
                    loadMapFromServer(); // Refresh map
                    break;
                    
                default:
                    console.log('WS event:', data);
            }
        } catch (e) {
            console.error('WS parse error:', e);
        }
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting in 3s...');
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// =============================================================================
// LIGHTING (your original code, preserved)
// =============================================================================

const ambientLight = new THREE.AmbientLight(0x404050, 0.5);
scene.add(ambientLight);

// Main directional light from top-right
const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
mainLight.position.set(15, 30, 10);
mainLight.castShadow = true;
mainLight.shadow.mapSize.width = 2048;
mainLight.shadow.mapSize.height = 2048;
mainLight.shadow.camera.near = 1;
mainLight.shadow.camera.far = 60;
mainLight.shadow.camera.left = -25;
mainLight.shadow.camera.right = 25;
mainLight.shadow.camera.top = 25;
mainLight.shadow.camera.bottom = -25;
scene.add(mainLight);

// Subtle blue fill light
const fillLight = new THREE.DirectionalLight(0x3366aa, 0.3);
fillLight.position.set(-10, 10, -10);
scene.add(fillLight);

// Point light for the glowing center (will move to player's territory)
const centerGlow = new THREE.PointLight(0x00e5cc, 1.5, 8);
centerGlow.position.set(0, 2, 0);
scene.add(centerGlow);

// =============================================================================
// INFO PANEL
// =============================================================================

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

function addEventToFeed(event) {
    eventFeed.unshift(event);
    if (eventFeed.length > MAX_EVENTS) {
        eventFeed.pop();
    }
    renderEventFeed();
}

function renderEventFeed() {
    const feedEl = document.getElementById('event-feed');
    if (!feedEl) return;
    
    feedEl.innerHTML = eventFeed.map(e => {
        const color = getEventColor(e.type);
        return `<div style="color: ${color}; margin-bottom: 4px; opacity: 0.9;">${e.description}</div>`;
    }).join('');
}

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
// ANIMATION (your original code, preserved)
// =============================================================================

let time = 0;
function animate() {
    requestAnimationFrame(animate);
    time += 0.02;
    
    // Pulse the center glow
    centerGlow.intensity = 1.2 + Math.sin(time * 2) * 0.4;
    
    // Subtle animation for glowing tiles
    hexagons.forEach(hex => {
        if (hex.userData.isGlowing) {
            const pulse = 0.3 + Math.sin(time * 3 + hex.position.x) * 0.15;
            hex.children.forEach(child => {
                if (child.material && child.material.emissiveIntensity !== undefined) {
                    child.material.emissiveIntensity = pulse;
                }
            });
        }
    });
    
    controls.update();
    renderer.render(scene, camera);
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

// Resize handler
window.addEventListener('resize', () => {
    const { width, height } = getContainerSize();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
});

// Click handler
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedHex = null;

gameContainer.addEventListener('click', (event) => {
    const rect = gameContainer.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj.parent && obj.userData.q === undefined) {
            obj = obj.parent;
        }
        if (obj.userData.q !== undefined) {
            console.log(`Clicked hex: q=${obj.userData.q}, r=${obj.userData.r}`, obj.userData);
            selectedHex = obj;
            updateInfoPanel(obj.userData);
        }
    }
});

// =============================================================================
// INITIALIZE
// =============================================================================

async function init() {
    console.log('CONQUEST - Initializing...');
    
    // Load map from server
    await loadMapFromServer();
    
    // Connect WebSocket for real-time updates
    connectWebSocket();
    
    // Start animation loop
    animate();
    
    console.log('CONQUEST - Ready');
}

// Start the game
init();

// =============================================================================
// EXPOSE FUNCTIONS FOR DEBUGGING (optional)
// =============================================================================

window.conquest = {
    loadMap: loadMapFromServer,
    setAgent: (agent) => {
        currentAgent = agent;
        loadMapFromServer();
    },
    getHexAt: (q, r) => hexMap.get(`${q},${r}`),
};
