/**
 * CONQUEST - Graphics Module
 * 
 * Handles all Three.js rendering:
 * - Scene, camera, renderer, controls
 * - Lighting
 * - Hex tile creation and materials
 * - Animation loop
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// =============================================================================
// CYBER STRUCTURE GENERATION
// =============================================================================

/**
 * Create a futuristic "Cyber Outpost" structure to place on a tile.
 * @returns {THREE.Group} The structure group
 */
function createCyberStructure() {
    const structure = new THREE.Group();
    
    // 1. Base Platform (Hexagonal foundation)
    // Slightly smaller than the tile top to fit cleanly
    const baseGeo = new THREE.CylinderGeometry(0.5, 0.6, 0.15, 6);
    const baseMat = new THREE.MeshStandardMaterial({
        color: 0x2d3748,
        roughness: 0.2,
        metalness: 0.8
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.075; // Sit on top of tile
    structure.add(base);
    
    // 2. Main Tower (Central skyscraper)
    // Tapered cyberpunk shape
    const towerGeo = new THREE.BoxGeometry(0.25, 1.2, 0.25);
    const towerMat = new THREE.MeshStandardMaterial({
        color: 0x1a202c,
        roughness: 0.1,
        metalness: 0.9,
        emissive: 0x000000
    });
    const tower = new THREE.Mesh(towerGeo, towerMat);
    tower.position.y = 0.6; // (1.2 / 2)
    structure.add(tower);
    
    // 3. Glowing Data Strips (Vertical neon lines on tower)
    const stripGeo = new THREE.BoxGeometry(0.26, 1.0, 0.05); // Slightly wider/thinner than tower
    const stripMat = new THREE.MeshBasicMaterial({
        color: 0x00e5cc, // Cyan glow
        transparent: true,
        opacity: 0.8
    });
    const strip1 = new THREE.Mesh(stripGeo, stripMat);
    strip1.position.y = 0.6;
    structure.add(strip1);
    
    const strip2 = strip1.clone();
    strip2.rotation.y = Math.PI / 2;
    structure.add(strip2);
    
    // 4. Holo-Ring (Floating energy ring around top)
    const ringGeo = new THREE.TorusGeometry(0.35, 0.02, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xff3366, // Pink secondary glow
        transparent: true,
        opacity: 0.9
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.0;
    
    // Animate the ring (custom update function attached to user data)
    ring.userData.animate = (time) => {
        ring.rotation.z = time * 0.5; // Spin
        ring.position.y = 1.0 + Math.sin(time * 3) * 0.05; // Float
    };
    ring.userData.isAnimated = true;
    
    structure.add(ring);
    
    // 5. Antenna / Spire on top
    const antGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8);
    const antMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const antenna = new THREE.Mesh(antGeo, antMat);
    antenna.position.y = 1.2 + 0.3;
    structure.add(antenna);
    
    // Light at the top of the antenna
    const beaconGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x00e5cc });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.y = 1.2 + 0.6;
    structure.add(beacon);
    
    return structure;
}

/**
 * Add a structure to a specific hex tile.
 * @param {THREE.Group} hex - The target hex tile group
 */
function addStructureToHex(hex) {
    if (!hex) return;
    
    const structure = createCyberStructure();
    structure.userData.isCyberStructure = true;
    
    // Position on top of the tile surface
    // Owned tiles are taller (HEIGHT_CLAIMED = 0.95)
    // We add to the hex group, so y is relative to hex origin (0,0,0)
    // The hex visual mesh starts at y=0 and goes up to HEIGHT_CLAIMED.
    // However, the hex group itself is positioned at planet surface level.
    // The tile geometry is built upwards from 0 to height.
    // So we just place structure at y = height.
    
    const height = hex.userData.owner_id ? HEIGHT_CLAIMED : HEIGHT_UNCLAIMED;
    structure.position.y = height;
    
    // Scale down the structure (30% smaller)
    structure.scale.set(0.7, 0.7, 0.7);
    
    // Add to hex group so it moves/scales with the tile
    hex.add(structure);
    hex.userData.hasStructure = true;
}

function removeStructureFromHex(hex) {
    if (!hex || !hex.userData.hasStructure) return;
    
    // Find and remove any cyber structure children
    const toRemove = [];
    hex.children.forEach(child => {
        if (child.userData && child.userData.isCyberStructure) {
            toRemove.push(child);
        }
    });
    toRemove.forEach(child => hex.remove(child));
    hex.userData.hasStructure = false;
}

// =============================================================================
// COLOR PALETTE
// =============================================================================

const colors = {
    unclaimed: 0x8a9ba8,      // Metallic Silver/Grey
    unclaimedDark: 0x5a6b78,  // Darker Silver variant
    yours: 0x00ffcc,          // Electric Cyan (Brighter)
    hostile: 0xff3366,        // Neon Pink/Red (Brighter)
    farmland: 0x4d7a4d,       // Vivid Green
    mine: 0x7a5c4d,           // Richer Bronze
    mixed: 0x5a6a5a,          // Lighter Mix
};

// Generate unique colors for different agents
const agentColors = new Map();
const colorPool = [
    0xff3366,  // Neon Pink
    0xff9933,  // Neon Orange
    0xcc66ff,  // Electric Purple
    0x33ccff,  // Sky Blue
    0xff3333,  // Laser Red
    0xffcc00,  // Cyber Yellow
    0x00ffaa,  // Toxic Green
    0xff00cc,  // Hot Magenta
];
let colorIndex = 0;

// =============================================================================
// HEXAGON PARAMETERS
// =============================================================================

const hexRadius = 0.9;
// Height constants for the "Plateau" effect
const HEIGHT_UNCLAIMED = 0.25; // Low, flat ground
const HEIGHT_CLAIMED = 0.95;   // Tall, distinct territory block
const gap = 0.06;
const PLANET_RADIUS = 60.0; // Radius of the world curvature
const PLANET_CENTER = new THREE.Vector3(0, -PLANET_RADIUS, 0);

// Helper: Project flat coordinates to spherical surface
function projectToPlanet(x, z) {
    // Treat x, z as arc distances on the sphere
    // We map the flat plane onto the sphere cap at (0,0,0)
    
    // Calculate distance from center
    const r = Math.sqrt(x*x + z*z);
    
    // Angle from the "North Pole" (0,0,0 surface point)
    const theta = r / PLANET_RADIUS;
    
    // Bearing angle
    const phi = Math.atan2(z, x);
    
    // Spherical coordinates relative to planet center
    // We start at North Pole (0, 1, 0) * R
    // Rotate 'theta' radians "down"
    
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    
    // Position relative to (0,0,0) center of sphere
    const sphereX = PLANET_RADIUS * sinTheta * Math.cos(phi);
    const sphereZ = PLANET_RADIUS * sinTheta * Math.sin(phi);
    const sphereY = PLANET_RADIUS * cosTheta;
    
    // Offset so the surface center is at (0,0,0) instead of (0, R, 0)
    // This keeps the camera logic working
    return new THREE.Vector3(sphereX, sphereY - PLANET_RADIUS, sphereZ);
}

// Helper: Get surface normal at a position
function getPlanetNormal(position) {
    // Normal is direction from Center to Position
    return new THREE.Vector3().subVectors(position, PLANET_CENTER).normalize();
}

// =============================================================================
// SCENE SETUP
// =============================================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090c15); // Deep Void Blue (slightly lighter)
scene.fog = new THREE.FogExp2(0x090c15, 0.015); // Reduced fog density from 0.025 for better visibility

// Add a Snow System
function createSnowSystem() {
    const geometry = new THREE.BufferGeometry();
    const count = 1500; // Light snowfall
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const velocities = new Float32Array(count); // Fall speed
    
    for (let i = 0; i < count; i++) {
        // Position in a box around the play area
        const x = (Math.random() - 0.5) * 120;
        const y = Math.random() * 80 - 10; // Height range
        const z = (Math.random() - 0.5) * 120;
        
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        
        // Snow colors (White to icy cyan)
        const c = new THREE.Color();
        if (Math.random() > 0.8) c.setHex(0xccffff); // Icy Cyan
        else c.setHex(0xffffff); // Pure White
        
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
        
        sizes[i] = Math.random() * 0.4 + 0.1;
        velocities[i] = 0.05 + Math.random() * 0.1; // Random fall speeds
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 1));
    
    const material = new THREE.PointsMaterial({
        size: 0.15,
        vertexColors: true,
        transparent: true,
        opacity: 0.6, // Keep the reduced opacity from your feedback
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending
    });
    
    const snow = new THREE.Points(geometry, material);
    snow.userData.isSnow = true;
    scene.add(snow);
}

createSnowSystem();

// Get game container for sizing
const gameContainer = document.getElementById('game-container');
const getContainerSize = () => ({
    width: gameContainer.clientWidth,
    height: gameContainer.clientHeight
});

const { width: initialWidth, height: initialHeight } = getContainerSize();

const camera = new THREE.PerspectiveCamera(50, initialWidth / initialHeight, 0.1, 1000);
camera.position.set(0, 22, 16); // Original starting position
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
controls.minDistance = 1;    // Can get extremely close
controls.maxDistance = 120;  // Can see the whole planet
controls.enableZoom = true;  // Use built-in zoom
controls.zoomSpeed = 20.0;   // Even more aggressive zoom
controls.maxPolarAngle = Math.PI / 2.2;
controls.panSpeed = 2.0;     // Faster panning
controls.rotateSpeed = 1.0;  // Normal rotation
controls.enabled = false; // Disabled until intro flyover completes

// =============================================================================
// CAMERA FLYOVER SYSTEM
// =============================================================================

let cameraFlight = null; // Active flight animation
let orbitRetarget = null; // Smooth post-flight orbit target transition

/**
 * Smoothly fly the camera to a target, orbiting around the lookAt point.
 * @param {THREE.Vector3} targetPosition - Where the camera should end up
 * @param {THREE.Vector3} targetLookAt - Where the camera should look at
 * @param {number} duration - Duration in milliseconds
 * @param {Function} onComplete - Callback when flight completes
 * @param {number} orbitAngle - Minimum radians to orbit (0 = straight line, Math.PI = at least 180°)
 */
export function flyCamera(targetPosition, targetLookAt, duration = 3000, onComplete = null, orbitAngle = 0, endLookAt = null) {
    const startPos = camera.position.clone();
    const lookAt = targetLookAt.clone();
    const finalLookAt = endLookAt ? endLookAt.clone() : null;
    
    // When endLookAt is provided, orbital offsets are relative to start/end lookAt anchors
    // so the orbit center can move smoothly. When not provided, both offsets are relative
    // to targetLookAt (original behavior with fixed orbit center).
    const startAnchor = finalLookAt ? controls.target.clone() : lookAt;
    const endAnchor = finalLookAt || lookAt;
    
    // Calculate start orbital parameters
    const startOffset = new THREE.Vector3().subVectors(startPos, startAnchor);
    const startDistance = Math.sqrt(startOffset.x * startOffset.x + startOffset.z * startOffset.z);
    const startHeight = startOffset.y;
    const startAngle = Math.atan2(startOffset.x, startOffset.z);
    
    // Calculate end orbital parameters
    const endOffset = new THREE.Vector3().subVectors(targetPosition, endAnchor);
    const endDistance = Math.sqrt(endOffset.x * endOffset.x + endOffset.z * endOffset.z);
    const endHeight = endOffset.y;
    const endAngle = Math.atan2(endOffset.x, endOffset.z);
    
    // Compute total rotation from startAngle to endAngle
    // For orbital flights, ensure we rotate at least orbitAngle radians
    let totalRotation = endAngle - startAngle;
    
    if (orbitAngle !== 0) {
        // Normalize to [-PI, PI]
        while (totalRotation > Math.PI) totalRotation -= 2 * Math.PI;
        while (totalRotation < -Math.PI) totalRotation += 2 * Math.PI;
        
        // Add full loops until we cover at least orbitAngle radians
        const dir = Math.sign(orbitAngle);
        while (Math.abs(totalRotation) < Math.abs(orbitAngle)) {
            totalRotation += dir * 2 * Math.PI;
        }
    }
    
    cameraFlight = {
        startPosition: startPos,
        startLookAt: controls.target.clone(),
        targetPosition: targetPosition.clone(),
        targetLookAt: lookAt,
        finalLookAt: finalLookAt,
        startTime: Date.now(),
        duration,
        onComplete,
        // Orbital params
        totalRotation,
        startAngle,
        startDistance,
        startHeight,
        endDistance,
        endHeight
    };
}

/**
 * Update camera flight animation (called from animation loop)
 * Returns true if flight is active.
 */
function updateCameraFlight() {
    if (!cameraFlight) return false;
    
    const elapsed = Date.now() - cameraFlight.startTime;
    let t = Math.min(elapsed / cameraFlight.duration, 1.0);
    
    // Ease-in-out (smooth cubic)
    t = t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
    
    if (cameraFlight.finalLookAt && cameraFlight.totalRotation !== 0) {
        // Moving lookAt orbital flight:
        // LookAt transitions smoothly: startLookAt → targetLookAt (midpoint) → finalLookAt
        // Camera orbits with offset relative to the moving lookAt center
        const currentLookAt = new THREE.Vector3();
        if (t <= 0.5) {
            const phase = t / 0.5;
            currentLookAt.lerpVectors(cameraFlight.startLookAt, cameraFlight.targetLookAt, phase);
        } else {
            const phase = (t - 0.5) / 0.5;
            currentLookAt.lerpVectors(cameraFlight.targetLookAt, cameraFlight.finalLookAt, phase);
        }
        controls.target.copy(currentLookAt);
        
        // Camera position: orbital offset from the current (moving) lookAt
        const angle = cameraFlight.startAngle + t * cameraFlight.totalRotation;
        const distance = cameraFlight.startDistance + t * (cameraFlight.endDistance - cameraFlight.startDistance);
        const height = cameraFlight.startHeight + t * (cameraFlight.endHeight - cameraFlight.startHeight);
        
        camera.position.set(
            currentLookAt.x + distance * Math.sin(angle),
            currentLookAt.y + height,
            currentLookAt.z + distance * Math.cos(angle)
        );
    } else if (cameraFlight.totalRotation !== 0) {
        // Fixed lookAt orbital flight (original behavior)
        const angle = cameraFlight.startAngle + t * cameraFlight.totalRotation;
        const distance = cameraFlight.startDistance + t * (cameraFlight.endDistance - cameraFlight.startDistance);
        const height = cameraFlight.startHeight + t * (cameraFlight.endHeight - cameraFlight.startHeight);
        
        const lookAt = cameraFlight.targetLookAt;
        camera.position.set(
            lookAt.x + distance * Math.sin(angle),
            lookAt.y + height,
            lookAt.z + distance * Math.cos(angle)
        );
        
        // Smoothly move lookAt target
        controls.target.lerpVectors(cameraFlight.startLookAt, cameraFlight.targetLookAt, t);
    } else {
        // Straight-line flight (original behavior)
        camera.position.lerpVectors(cameraFlight.startPosition, cameraFlight.targetPosition, t);
        controls.target.lerpVectors(cameraFlight.startLookAt, cameraFlight.targetLookAt, t);
    }
    
    if (elapsed >= cameraFlight.duration) {
        // Flight complete - snap to exact target
        camera.position.copy(cameraFlight.targetPosition);
        controls.target.copy(cameraFlight.finalLookAt || cameraFlight.targetLookAt);
        
        const cb = cameraFlight.onComplete;
        cameraFlight = null;
        
        // Re-enable controls after flight
        controls.enabled = true;
        
        if (cb) cb();
    }
    
    return true;
}

// =============================================================================
// POST-PROCESSING (BLOOM)
// =============================================================================

const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.6,  // strength - Reduced from 1.5 for clarity
    0.3,  // radius - Reduced from 0.4 for tighter glow
    0.2   // threshold - Increased from 0 so background doesn't glow
);
bloomPass.threshold = 0.2;
bloomPass.strength = 0.6;
bloomPass.radius = 0.3;

const outputPass = new OutputPass();

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);
composer.addPass(outputPass);

// =============================================================================
// LIGHTING
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

// Point light for the glowing center
const centerGlow = new THREE.PointLight(0x00e5cc, 0.5, 8);
centerGlow.position.set(0, 2, 0);
scene.add(centerGlow);

// =============================================================================
// RAYCASTER FOR CLICK DETECTION
// =============================================================================

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// =============================================================================
// HEX TILE STORAGE
// =============================================================================

const hexagons = [];
const hexMap = new Map();

// =============================================================================
// TERRITORY BORDER SYSTEM
// =============================================================================

// Group to hold all border meshes (for easy clearing/rebuilding)
const borderGroup = new THREE.Group();
scene.add(borderGroup);

// Border visual settings
const BORDER_HEIGHT_OFFSET = 0.0;     // Start from base level
const BORDER_WALL_HEIGHT = HEIGHT_CLAIMED - HEIGHT_UNCLAIMED + 0.02; // Exact height difference + tiny lip
const BORDER_GLOW_INTENSITY = 0.8;    // Emissive intensity

/**
 * Get the 6 neighboring hex coordinates (axial coordinates)
 * IMPORTANT: Ordered so that neighbors[i] faces geometric Edge i.
 * Edge i has its midpoint at angle (i * 60 + 30) degrees.
 *
 * @param {number} q - Axial coordinate q
 * @param {number} r - Axial coordinate r
 * @returns {Array<{q: number, r: number}>} - Array of 6 neighbor coordinates
 */
function getNeighbors(q, r) {
    return [
        { q: q + 1, r: r },      // Edge 0 → faces  30° (+q direction)
        { q: q, r: r + 1 },      // Edge 1 → faces  90° (+r direction)
        { q: q - 1, r: r + 1 },  // Edge 2 → faces 150° (-q, +r direction)
        { q: q - 1, r: r },      // Edge 3 → faces 210° (-q direction)
        { q: q, r: r - 1 },      // Edge 4 → faces 270° (-r direction)
        { q: q + 1, r: r - 1 },  // Edge 5 → faces 330° (+q, -r direction)
    ];
}

/**
 * Convert axial coordinates to world position
 * @param {number} q - Axial coordinate q
 * @param {number} r - Axial coordinate r
 * @returns {{x: number, z: number}} - World coordinates
 */
function axialToWorld(q, r) {
    const x = hexRadius * (3/2 * q);
    const z = hexRadius * (Math.sqrt(3)/2 * q + Math.sqrt(3) * r);
    return { x, z };
}

/**
 * Get the two vertices (world coordinates) for a specific edge of a hex
 * @param {number} q - Axial coordinate q
 * @param {number} r - Axial coordinate r
 * @param {number} edgeIndex - Edge index (0-5)
 * @param {number} tileHeight - Height of the tile
 * @returns {{v1: {x,y,z}, v2: {x,y,z}}} - The two vertices of the edge
 */
function getEdgeVertices(q, r, edgeIndex, tileHeight) {
    const { x: centerX, z: centerZ } = axialToWorld(q, r);
    const effectiveRadius = hexRadius - gap / 2;
    
    // Hex vertices start at angle 0 (right) and go counter-clockwise
    // Edge N connects vertex N to vertex N+1
    const angle1 = (Math.PI / 3) * edgeIndex;
    const angle2 = (Math.PI / 3) * (edgeIndex + 1);
    
    // Calculate Flat offsets
    const x1_flat = centerX + Math.cos(angle1) * effectiveRadius;
    const z1_flat = centerZ + Math.sin(angle1) * effectiveRadius;
    const x2_flat = centerX + Math.cos(angle2) * effectiveRadius;
    const z2_flat = centerZ + Math.sin(angle2) * effectiveRadius;
    
    // Project to Planet Surface
    const v1_surf = projectToPlanet(x1_flat, z1_flat);
    const v2_surf = projectToPlanet(x2_flat, z2_flat);
    
    // Extrude "Up" from the UNCLAIMED height (the base of the cliff)
    // We want the border to start at the bottom of the plateau
    const n1 = getPlanetNormal(v1_surf);
    const n2 = getPlanetNormal(v2_surf);
    
    const h = HEIGHT_UNCLAIMED + 0.05; // Start just above ground level
    
    const v1 = v1_surf.add(n1.multiplyScalar(h));
    const v2 = v2_surf.add(n2.multiplyScalar(h));
    
    return { v1, v2 };
}

/**
 * Calculate all border edges that need to be drawn
 * @returns {Array<{q, r, edgeIndex, color, tileHeight}>} - Array of border edge data
 */
function calculateBorders() {
    const borders = [];
    
    for (const [key, hex] of hexMap) {
        const { q, r, owner_id } = hex.userData;
        
        // Only owned tiles have borders
        if (!owner_id) continue;
        
        // Get tile height (owned tiles are taller plateaus)
        const tileHeight = HEIGHT_CLAIMED;
        
        // Get the color for this owner
        const color = hex.userData.color;
        
        // Check each of the 6 neighbors
        // neighbors[i] faces geometric Edge i
        const neighbors = getNeighbors(q, r);
        
        neighbors.forEach((neighbor, edgeIndex) => {
            const neighborKey = `${neighbor.q},${neighbor.r}`;
            const neighborHex = hexMap.get(neighborKey);
            const neighborOwner = neighborHex?.userData?.owner_id || null;
            
            // Border exists if neighbor has different owner (including unclaimed)
            if (neighborOwner !== owner_id) {
                borders.push({
                    q,
                    r,
                    edgeIndex,
                    color,
                    tileHeight
                });
            }
        });
    }
    
    return borders;
}

/**
 * Create border meshes batched by color for performance
 * Creates a 3D Vertical Energy Wall ("Force Field") effect.
 * @param {Array} borders - Array of border edge data
 */
function createBorderMeshes(borders) {
    // Group borders by color
    const bordersByColor = new Map();
    
    borders.forEach(border => {
        const colorKey = border.color;
        if (!bordersByColor.has(colorKey)) {
            bordersByColor.set(colorKey, []);
        }
        bordersByColor.get(colorKey).push(border);
    });
    
    // Create meshes per color
    for (const [colorValue, colorBorders] of bordersByColor) {
        const positionsWall = [];
        const positionsRail = []; // Top rail (line)
        const indicesWall = [];
        
        let vertexIndexWall = 0;
        
        colorBorders.forEach(border => {
            const { v1, v2 } = getEdgeVertices(border.q, border.r, border.edgeIndex, border.tileHeight);
            
            // Normals for extrusion
            const n1 = getPlanetNormal(v1);
            const n2 = getPlanetNormal(v2);
            
            // --- 1. VERTICAL WALL (Quad) ---
            // v1 (bottom), v2 (bottom), v2_up (top), v1_up (top)
            
            // Top points: Extrude along normal
            // Wall height must cover the plateau difference (0.95 - 0.25 = 0.7) plus rail
            const v1_top = v1.clone().add(n1.clone().multiplyScalar(BORDER_WALL_HEIGHT));
            const v2_top = v2.clone().add(n2.clone().multiplyScalar(BORDER_WALL_HEIGHT));
            
            // Push vertices for the wall face
            positionsWall.push(
                v1.x, v1.y, v1.z,        // 0: Bottom Left
                v2.x, v2.y, v2.z,        // 1: Bottom Right
                v2_top.x, v2_top.y, v2_top.z, // 2: Top Right
                v1_top.x, v1_top.y, v1_top.z  // 3: Top Left
            );
            
            // Two triangles for the wall quad (Double sided via material)
            indicesWall.push(
                vertexIndexWall, vertexIndexWall + 1, vertexIndexWall + 2,
                vertexIndexWall, vertexIndexWall + 2, vertexIndexWall + 3
            );
            
            vertexIndexWall += 4;
            
            // --- 2. TOP RAIL (Thick Line at top) ---
            // Construct ribbon at top height
            
            // Calculate side vector (Cross product of direction and normal)
            const edgeDir = new THREE.Vector3().subVectors(v2_top, v1_top).normalize();
            // Average normal for the edge
            const avgNormal = new THREE.Vector3().addVectors(n1, n2).normalize();
            const side = new THREE.Vector3().crossVectors(edgeDir, avgNormal).normalize();
            
            const railWidth = 0.06;
            const offset = side.multiplyScalar(railWidth / 2);
            
            positionsRail.push(
                v1_top.x - offset.x, v1_top.y - offset.y, v1_top.z - offset.z,
                v1_top.x + offset.x, v1_top.y + offset.y, v1_top.z + offset.z,
                v2_top.x + offset.x, v2_top.y + offset.y, v2_top.z + offset.z,
                v2_top.x - offset.x, v2_top.y - offset.y, v2_top.z - offset.z
            );
        });
        
        const color = new THREE.Color(colorValue);
        
        // --- WALL MESH (Semi-transparent energy field) ---
        const geometryWall = new THREE.BufferGeometry();
        geometryWall.setAttribute('position', new THREE.Float32BufferAttribute(positionsWall, 3));
        geometryWall.setIndex(indicesWall);
        geometryWall.computeVertexNormals();
        
        const materialWall = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.3, // Semi-transparent field
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        
        const meshWall = new THREE.Mesh(geometryWall, materialWall);
        meshWall.userData.isBorderWall = true; // Tag for animation
        borderGroup.add(meshWall);
        
        // --- RAIL MESH (Bright top edge) ---
        // Reuse indices scheme (it's just quads)
        // Need to regenerate indices for rail since it has same count structure
        const indicesRail = [];
        for(let i=0; i < positionsRail.length/12; i++) {
             const base = i*4;
             indicesRail.push(base, base+1, base+2, base, base+2, base+3);
        }
        
        const geometryRail = new THREE.BufferGeometry();
        geometryRail.setAttribute('position', new THREE.Float32BufferAttribute(positionsRail, 3));
        geometryRail.setIndex(indicesRail);
        
        const materialRail = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 1.0, // Solid bright line
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        
        const meshRail = new THREE.Mesh(geometryRail, materialRail);
        meshRail.userData.isBorderRail = true; // Tag for animation
        borderGroup.add(meshRail);
    }
}

/**
 * Clear all existing border meshes
 */
function clearBorders() {
    while (borderGroup.children.length > 0) {
        const child = borderGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
        borderGroup.remove(child);
    }
}

/**
 * Rebuild all territory borders
 * Call this after map load or tile ownership changes
 */
export function rebuildBorders() {
    clearBorders();
    
    const borders = calculateBorders();
    
    if (borders.length > 0) {
        createBorderMeshes(borders);
    }
}

// =============================================================================
// GET AGENT COLOR
// =============================================================================

/**
 * Get the color for an agent's tiles
 * @param {string|null} agentId - The agent ID
 * @param {object|null} currentAgent - The current player agent (for "yours" color)
 * @returns {number} - Hex color value
 */
export function getAgentColor(agentId, currentAgent = null) {
    if (!agentId) return colors.unclaimed;
    if (currentAgent && agentId === currentAgent.id) return colors.yours;
    
    if (!agentColors.has(agentId)) {
        agentColors.set(agentId, colorPool[colorIndex % colorPool.length]);
        colorIndex++;
    }
    return agentColors.get(agentId);
}

// =============================================================================
// CREATE HEXAGON TILE
// =============================================================================

/**
 * Create a 3D hexagonal tile
 * @param {number} q - Axial coordinate q
 * @param {number} r - Axial coordinate r
 * @param {number} tileColor - Hex color value
 * @param {boolean} isPlayerTile - Whether this tile is owned by a player
 * @param {boolean} isGlowing - Whether this tile should glow
 * @returns {THREE.Group} - The hex tile group
 */
export function createHexagonTile(q, r, tileColor, isPlayerTile = false, isGlowing = false) {
    const group = new THREE.Group();
    
    // 1. Calculate Flat Coordinates first
    const x_flat = hexRadius * (3/2 * q);
    const z_flat = hexRadius * (Math.sqrt(3)/2 * q + Math.sqrt(3) * r);
    
    // 2. Project to Sphere
    const planetPos = projectToPlanet(x_flat, z_flat);
    group.position.copy(planetPos);
    
    // 3. Orient to Planet Surface
    // The "Up" vector of the tile should align with the surface normal
    const normal = getPlanetNormal(planetPos);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    
    const effectiveRadius = hexRadius - gap / 2;
    // Use distinct heights for plateau effect
    const height = isPlayerTile ? HEIGHT_CLAIMED : HEIGHT_UNCLAIMED;
    
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
            roughness: 0.15, // Glassier
            metalness: 0.8, // More metallic/reflective
            side: THREE.DoubleSide,
            emissive: isGlowing ? topColor : 0x000000,
            emissiveIntensity: isGlowing ? 0.4 : 0
        });
        
        const topMesh = new THREE.Mesh(topGeom, topMat);
        topMesh.castShadow = true;
        topMesh.receiveShadow = true;
        group.add(topMesh);
    }

    // --- GRID LINES (Holographic Wireframe) ---
    // Create a hexagonal line loop at the top of the tile
    const lineGeom = new THREE.BufferGeometry();
    const lineVerts = [];
    const lineRadius = effectiveRadius * 0.99; // Slightly smaller to prevent z-fighting
    
    for (let i = 0; i <= 6; i++) {
        const angle = (Math.PI / 3) * i;
        lineVerts.push(
            Math.cos(angle) * lineRadius, 
            height + 0.02, // Just above the surface
            Math.sin(angle) * lineRadius
        );
    }
    
    lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
    
    // Different line colors for different states
    let lineColor = 0x2d3748; // Dark slate for unclaimed
    let lineOpacity = 0.3;
    
    if (isPlayerTile) {
        lineColor = tileColor; // Match owner color
        lineOpacity = 0.8;
    }
    
    const lineMat = new THREE.LineBasicMaterial({ 
        color: lineColor, 
        transparent: true, 
        opacity: lineOpacity,
        blending: THREE.AdditiveBlending
    });
    
    const lines = new THREE.Line(lineGeom, lineMat);
    lines.userData.isGridLine = true; // Tag for animation if needed
    group.add(lines);
    
    // Create side faces - 6 quads with proper lighting
    for (let i = 0; i < 6; i++) {
        const angle1 = (Math.PI / 3) * i;
        const angle2 = (Math.PI / 3) * (i + 1);
        
        const x1 = Math.cos(angle1) * effectiveRadius;
        const z1 = Math.sin(angle1) * effectiveRadius;
        const x2 = Math.cos(angle2) * effectiveRadius;
        const z2 = Math.sin(angle2) * effectiveRadius;
        
        // Determine side brightness based on face direction
        // For planet mode, we just use the material properties to handle lighting
        const sideColor = topColor.clone().multiplyScalar(0.5);
        
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
            roughness: 0.3, // Smoother
            metalness: 0.4, // More metallic
            side: THREE.DoubleSide,
            emissive: isGlowing ? sideColor : 0x000000,
            emissiveIntensity: isGlowing ? 0.2 : 0
        });
        
        const sideMesh = new THREE.Mesh(sideGeom, sideMat);
        sideMesh.castShadow = true;
        sideMesh.receiveShadow = true;
        sideMesh.userData.isSide = true; // Tag as side face for raycasting ignore
        group.add(sideMesh);
    }
    
    // Position was already set by projectToPlanet
    // group.position.set(x, 0, z); <- Removed
    
    group.userData = { q, r, color: tileColor, isPlayerTile, isGlowing };
    
    return group;
}

// =============================================================================
// INTERACTION VISUALS (Cursor & Selection)
// =============================================================================

// Hover Cursor (Glowing Hex)
const hoverGroup = new THREE.Group();
scene.add(hoverGroup);

const hoverCursorGeo = new THREE.RingGeometry(0.7, 0.8, 6);
const hoverCursorMat = new THREE.MeshBasicMaterial({ 
    color: 0xffffff, 
    side: THREE.DoubleSide, 
    transparent: true, 
    opacity: 0.0,
    blending: THREE.AdditiveBlending
});
const hoverCursor = new THREE.Mesh(hoverCursorGeo, hoverCursorMat);
hoverCursor.rotation.x = -Math.PI / 2;
hoverGroup.add(hoverCursor);
hoverGroup.visible = false;

// Selection Marker (Targeting Brackets)
const selectionGroup = new THREE.Group();
scene.add(selectionGroup);

// Create 3 corner brackets
for (let i = 0; i < 3; i++) {
    const bracketGeo = new THREE.TorusGeometry(1.2, 0.05, 4, 3, Math.PI / 2);
    const bracketMat = new THREE.MeshBasicMaterial({ color: 0x00e5cc, transparent: true, opacity: 0.8 });
    const bracket = new THREE.Mesh(bracketGeo, bracketMat);
    bracket.rotation.x = Math.PI / 2;
    bracket.rotation.z = (Math.PI * 2 / 3) * i;
    selectionGroup.add(bracket);
}
selectionGroup.visible = false;

/**
 * Update hover cursor position
 * @param {THREE.Group} hex - The hex tile group
 */
export function updateHoverCursor(hex) {
    if (!hex) {
        hoverGroup.visible = false;
        return;
    }
    
    hoverGroup.visible = true;
    hoverGroup.position.copy(hex.position);
    hoverGroup.quaternion.copy(hex.quaternion);
    
    // Calculate height based on ownership
    const height = hex.userData.isPlayerTile ? HEIGHT_CLAIMED : HEIGHT_UNCLAIMED;
    
    // Move slightly above the surface
    hoverGroup.translateY(height + 0.1);
    
    // Smoothly fade in (handled in animation loop, but ensure visible here)
    hoverCursor.material.opacity = Math.max(hoverCursor.material.opacity, 0.4);
}

/**
 * Update selection marker position
 * @param {THREE.Group} hex - The hex tile group
 */
export function updateSelectionMarker(hex) {
    if (!hex) {
        selectionGroup.visible = false;
        return;
    }
    selectionGroup.visible = true;
    selectionGroup.position.copy(hex.position);
    selectionGroup.quaternion.copy(hex.quaternion);
    
    // Calculate height based on ownership
    const height = hex.userData.isPlayerTile ? HEIGHT_CLAIMED : HEIGHT_UNCLAIMED;
    
    // Move above the surface (higher than hover cursor)
    selectionGroup.translateY(height + 0.3);
}

// =============================================================================
// TILE MANAGEMENT
// =============================================================================

/**
 * Add a hex tile to the scene
 * @param {THREE.Group} hex - The hex tile group
 */
export function addHexToScene(hex) {
    scene.add(hex);
    hexagons.push(hex);
    hexMap.set(`${hex.userData.q},${hex.userData.r}`, hex);
}

/**
 * Remove a hex tile from the scene
 * @param {number} q - Axial coordinate q
 * @param {number} r - Axial coordinate r
 */
export function removeHexFromScene(q, r) {
    const key = `${q},${r}`;
    const existingHex = hexMap.get(key);
    
    if (existingHex) {
        scene.remove(existingHex);
        const index = hexagons.indexOf(existingHex);
        if (index > -1) hexagons.splice(index, 1);
        hexMap.delete(key);
    }
}

/**
 * Clear all hex tiles from the scene
 */
export function clearAllHexes() {
    hexagons.forEach(hex => scene.remove(hex));
    hexagons.length = 0;
    hexMap.clear();
}

/**
 * Get a hex tile by coordinates
 * @param {number} q - Axial coordinate q
 * @param {number} r - Axial coordinate r
 * @returns {THREE.Group|undefined}
 */
export function getHexAt(q, r) {
    return hexMap.get(`${q},${r}`);
}

/**
 * Get all hexagons
 * @returns {THREE.Group[]}
 */
export function getHexagons() {
    return hexagons;
}

// =============================================================================
// ANIMATION
// =============================================================================

let time = 0;
let animationCallback = null;

/**
 * Set a callback to be called on each animation frame
 * @param {Function} callback - Function to call each frame
 */
export function setAnimationCallback(callback) {
    animationCallback = callback;
}

/**
 * Start the animation loop
 */
export function startAnimationLoop() {
    function animate() {
        requestAnimationFrame(animate);
        time += 0.02;
        
        // Pulse the center glow
        centerGlow.intensity = 0.4 + Math.sin(time * 2) * 0.15;
        
        // Animate Hex Spawning & Grid Pulse
        const now = Date.now();
        hexagons.forEach(hex => {
            // ... existing spawn / wave code ...

            // Animate Structure Parts (if any)
            if (hex.userData.hasStructure) {
                hex.children.forEach(child => {
                    // Check children of structure (which is a child of hex)
                    // Actually, hex.children includes the structure Group.
                    // We need to traverse down or tag the structure group.
                    if (child.type === 'Group') {
                        child.children.forEach(part => {
                            if (part.userData && part.userData.isAnimated && part.userData.animate) {
                                part.userData.animate(time);
                            }
                        });
                    }
                });
            }
            // 1. Spawn Animation (Scale Up)
            if (hex.scale.x < 1) {
                const delay = hex.userData.spawnDelay || 0;
                if (now - hex.userData.spawnTime > delay) {
                    const speed = 0.06; // Balanced speed for visible but snappy animation
                    hex.scale.x = Math.min(1, hex.scale.x + speed);
                    hex.scale.y = Math.min(1, hex.scale.y + speed);
                    hex.scale.z = Math.min(1, hex.scale.z + speed);
                }
            }

            // 2. Data Wave on Grid Lines
            // Find grid lines child
            const lines = hex.children.find(c => c.userData.isGridLine);
            if (lines) {
                // Create a wave based on world position and time
                // This creates a "scanning" bar moving across the map
                const wave = Math.sin(hex.position.x * 0.2 + hex.position.z * 0.1 + time * 2);
                
                // Base opacity + wave boost
                const baseOpacity = hex.userData.isPlayerTile ? 0.6 : 0.2;
                const boost = wave > 0.8 ? 0.4 : 0; // Flash when wave passes
                
                lines.material.opacity = baseOpacity + boost;
                
                // Also pulse color slightly?
                // lines.material.color.setHSL(...) // Expensive to do every frame, sticking to opacity
            }

            if (hex.userData.isGlowing) {
                const pulse = 0.3 + Math.sin(time * 3 + hex.position.x) * 0.15;
                hex.children.forEach(child => {
                    if (child.material && child.material.emissiveIntensity !== undefined) {
                        child.material.emissiveIntensity = pulse;
                    }
                });
            }
        });
        
        // Animate border glow (subtle pulse)
        borderGroup.children.forEach(border => {
            if (border.userData.isBorderWall) {
                // Pulse the wall opacity (force field effect)
                const pulse = 0.2 + Math.sin(time * 3) * 0.15;
                border.material.opacity = pulse;
            }
            if (border.userData.isBorderRail) {
                // High frequency flicker for top rail
                const flicker = 0.8 + (Math.sin(time * 20) * 0.1) + (Math.random() * 0.1);
                border.material.opacity = Math.min(1.0, Math.max(0.6, flicker));
            }
        });

        // Animate Snow
        scene.children.forEach(child => {
            if (child.userData.isSnow) {
                const positions = child.geometry.attributes.position.array;
                const velocities = child.geometry.attributes.velocity.array;
                
                for (let i = 0; i < velocities.length; i++) {
                    // Fall down
                    positions[i * 3 + 1] -= velocities[i];
                    
                    // Wind drift
                    positions[i * 3] += Math.sin(time * 0.5 + positions[i * 3 + 1] * 0.05) * 0.02;
                    
                    // Reset to top if below ground
                    if (positions[i * 3 + 1] < -10) {
                        positions[i * 3 + 1] = 60; // Reset height
                        positions[i * 3] = (Math.random() - 0.5) * 120; // New random X
                        positions[i * 3 + 2] = (Math.random() - 0.5) * 120; // New random Z
                    }
                }
                child.geometry.attributes.position.needsUpdate = true;
            }
        });
        
        // Call external animation callback if set
        if (animationCallback) {
            animationCallback(time);
        }
        
        // Update camera flight animation
        updateCameraFlight();
        
        // Update smooth orbit retarget
        updateOrbitRetarget();
        
        controls.update();
        composer.render();
    }
    
    animate();
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

/**
 * Handle window resize
 */
export function handleResize() {
    const { width, height } = getContainerSize();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    composer.setSize(width, height);
}

/**
 * Raycast from mouse position to find clicked hex
 * @param {MouseEvent} event - The click event
 * @returns {object|null} - The userData of clicked hex, or null
 */
export function raycastClick(event) {
    const rect = gameContainer.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    // Iterate through all intersections to find the first valid "top" face
    for (const intersect of intersects) {
        let obj = intersect.object;
        
        // Skip non-interactive elements:
        // - Side faces of tiles (to prevent blocking neighbors)
        // - Border walls and rails
        // - Grid lines
        if (obj.userData.isSide || 
            obj.userData.isBorderWall || 
            obj.userData.isBorderRail || 
            obj.userData.isGridLine ||
            obj.userData.isStarField ||
            obj.userData.isSnow) {
            continue;
        }

        // Walk up to find the hex group
        while (obj.parent && obj.userData.q === undefined) {
            obj = obj.parent;
        }
        
        // Found a valid hex tile
        if (obj.userData.q !== undefined) {
            return obj.userData;
        }
    }
    
    return null;
}

/**
 * Get the game container element
 * @returns {HTMLElement}
 */
export function getGameContainer() {
    return gameContainer;
}

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * Smoothly transition the orbit controls target (pivot point for zoom/rotate).
 * @param {number} x - Target x
 * @param {number} y - Target y
 * @param {number} z - Target z
 * @param {number} duration - Transition duration in ms (default 1500)
 */
export function setOrbitTarget(x, y, z, duration = 1500) {
    orbitRetarget = {
        from: controls.target.clone(),
        to: new THREE.Vector3(x, y, z),
        startTime: Date.now(),
        duration
    };
}

/**
 * Update smooth orbit retarget (called from animation loop)
 */
function updateOrbitRetarget() {
    if (!orbitRetarget) return;
    
    const elapsed = Date.now() - orbitRetarget.startTime;
    let t = Math.min(elapsed / orbitRetarget.duration, 1.0);
    
    // Smooth ease-out
    t = 1 - Math.pow(1 - t, 3);
    
    controls.target.lerpVectors(orbitRetarget.from, orbitRetarget.to, t);
    
    if (elapsed >= orbitRetarget.duration) {
        controls.target.copy(orbitRetarget.to);
        orbitRetarget = null;
    }
}

/**
 * Enable or disable orbit controls
 * @param {boolean} enabled
 */
export function setControlsEnabled(enabled) {
    controls.enabled = enabled;
}

export { 
    colors, 
    hexRadius, 
    HEIGHT_UNCLAIMED, 
    HEIGHT_CLAIMED,
    createCyberStructure,
    addStructureToHex,
    removeStructureFromHex
};
