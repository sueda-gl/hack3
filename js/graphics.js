/**
 * CLAWQUEST - Graphics Module
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
// CAMERA SHAKE SYSTEM
// =============================================================================

let cameraShake = null; // Active shake animation

/**
 * Trigger a camera shake effect (e.g. on attack impact).
 * @param {number} intensity - Max pixel offset (default 0.3)
 * @param {number} duration - Duration in ms (default 600)
 * @param {number} frequency - Shakes per second (default 30)
 */
function triggerCameraShake(intensity = 0.3, duration = 600, frequency = 30) {
    cameraShake = {
        startTime: Date.now(),
        duration,
        intensity,
        frequency,
        originalPos: camera.position.clone()
    };
}

/**
 * Update camera shake each frame. Called from animation loop.
 */
function updateCameraShake() {
    if (!cameraShake) return;

    const elapsed = Date.now() - cameraShake.startTime;
    const t = elapsed / cameraShake.duration;

    if (t >= 1.0) {
        // Restore original position and stop
        camera.position.copy(cameraShake.originalPos);
        cameraShake = null;
        return;
    }

    // Decay envelope: strong at start, fades out
    const decay = 1 - t;
    const amp = cameraShake.intensity * decay * decay;

    // High-frequency noise shake
    const freq = cameraShake.frequency;
    const time = elapsed * 0.001;
    const offsetX = amp * (Math.sin(time * freq * 6.28) * 0.7 + Math.sin(time * freq * 4.13) * 0.3);
    const offsetY = amp * (Math.cos(time * freq * 5.17) * 0.6 + Math.cos(time * freq * 3.71) * 0.4);
    const offsetZ = amp * (Math.sin(time * freq * 4.53) * 0.5);

    camera.position.copy(cameraShake.originalPos);
    camera.position.x += offsetX;
    camera.position.y += offsetY;
    camera.position.z += offsetZ;
}

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
// TILE EFFECTS SYSTEM
// =============================================================================

const activeEffects = [];

/**
 * Trigger a tile claim effect on a hex tile.
 * @param {THREE.Group} hex - The target hex tile group
 * @param {number} [claimColor=0x00e5cc] - Color for the effect (owner color)
 */
/**
 * Trigger a tile claim effect on a hex tile.
 * Fires a beacon pillar and sets up the tile to rise from unclaimed → claimed height.
 * @param {THREE.Group} hex - The target hex tile group (should be the NEW claimed tile)
 * @param {number} [claimColor=0x00e5cc] - Color for the effect (owner color)
 */
export function triggerClaimEffect(hex, claimColor) {
    if (!hex) return;
    
    const color = claimColor || hex.userData.color || 0x00e5cc;
    
    // --- SET UP TILE RISE: start flat, animate up to claimed height ---
    hex.scale.set(1, 0.05, 1); // Start nearly flat
    
    // Flag for the rise animation (starts after beacon shoots up)
    hex.userData.claimRise = {
        startTime: Date.now() + 500,
        duration: 1000,
        startScaleY: 0.05,
        endScaleY: 1.0,
    };
    
    // --- BEACON PILLAR: vertical beam of light shoots up from the tile ---
    const beamHeight = 8;
    const beamGeo = new THREE.CylinderGeometry(0.15, 0.4, beamHeight, 6);
    const beamMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    
    const beam = new THREE.Mesh(beamGeo, beamMat);
    
    // Position at the hex tile, oriented to planet surface
    beam.position.copy(hex.position);
    beam.quaternion.copy(hex.quaternion);
    beam.translateY(0);
    beam.scale.set(1, 0.01, 1);
    
    scene.add(beam);
    
    // Outer glow cylinder (wider, softer)
    const glowGeo = new THREE.CylinderGeometry(0.4, 0.8, beamHeight, 6);
    const glowMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.copy(hex.position);
    glow.quaternion.copy(hex.quaternion);
    glow.translateY(0);
    glow.scale.set(1, 0.01, 1);
    
    scene.add(glow);
    
    activeEffects.push({
        type: 'beacon',
        beam: beam,
        glow: glow,
        beamHeight: beamHeight,
        startTime: Date.now(),
        duration: 1800,
    });
}

// =============================================================================
// TRADE ROUTE EFFECT
// =============================================================================

/**
 * Generate a great-circle curve along the planet surface between two positions.
 * Returns a THREE.CatmullRomCurve3 that hugs the globe.
 * @param {THREE.Vector3} from - Start position (on planet surface)
 * @param {THREE.Vector3} to - End position (on planet surface)
 * @param {number} [liftHeight=1.5] - How far above the surface the arc floats
 * @param {number} [segments=60] - Number of interpolation points
 * @returns {THREE.CatmullRomCurve3}
 */
function createSurfaceCurve(from, to, liftHeight = 1.5, segments = 60) {
    const points = [];
    const fromDir = new THREE.Vector3().subVectors(from, PLANET_CENTER).normalize();
    const toDir = new THREE.Vector3().subVectors(to, PLANET_CENTER).normalize();

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        // Slerp along the sphere surface
        const dir = new THREE.Vector3().copy(fromDir).lerp(toDir, t).normalize();
        // Lift above surface: higher at midpoint, lower at endpoints
        const archLift = Math.sin(t * Math.PI) * liftHeight;
        const point = new THREE.Vector3()
            .copy(PLANET_CENTER)
            .addScaledVector(dir, PLANET_RADIUS + archLift);
        points.push(point);
    }
    return new THREE.CatmullRomCurve3(points);
}

/**
 * Trigger a trade route animation: a glowing wire traces across the globe
 * between two hexes, then energy pulses travel along it.
 * @param {THREE.Group} fromHex - Source hex tile
 * @param {THREE.Group} toHex - Destination hex tile
 * @param {number} [tradeColor=0xdd8844] - Color of the trade wire (amber)
 */
export function triggerTradeRoute(fromHex, toHex, tradeColor) {
    if (!fromHex || !toHex) return;
    const color = tradeColor || 0x00e5cc;

    // --- Build the surface-following curve ---
    const curve = createSurfaceCurve(fromHex.position, toHex.position, 1.8, 80);

    // --- Wire tube (initially hidden via drawRange) ---
    const tubeSegments = 120;
    const tubeGeo = new THREE.TubeGeometry(curve, tubeSegments, 0.02, 6, false);
    const tubeMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    // Start fully hidden — we'll reveal via drawRange
    tube.geometry.setDrawRange(0, 0);
    scene.add(tube);

    // --- Outer glow tube (wider, softer) ---
    const glowGeo = new THREE.TubeGeometry(curve, tubeSegments, 0.06, 6, false);
    const glowMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.geometry.setDrawRange(0, 0);
    scene.add(glow);

    // --- Energy pulse spheres (travel along the wire once it's drawn) ---
    const pulseCount = 3;
    const pulses = [];
    const pulseGeo = new THREE.SphereGeometry(0.10, 8, 8);
    for (let i = 0; i < pulseCount; i++) {
        const pulseMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const pulse = new THREE.Mesh(pulseGeo, pulseMat);
        pulse.visible = false;
        scene.add(pulse);
        pulses.push(pulse);
    }

    // --- Endpoint markers (glow rings at source and destination) ---
    const ringGeo = new THREE.TorusGeometry(0.5, 0.08, 8, 24);
    const fromRingMat = new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const toRingMat = new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const fromRing = new THREE.Mesh(ringGeo, fromRingMat);
    const toRing = new THREE.Mesh(ringGeo, toRingMat);

    // Orient rings to planet surface at each endpoint
    fromRing.position.copy(fromHex.position);
    fromRing.quaternion.copy(fromHex.quaternion);
    toRing.position.copy(toHex.position);
    toRing.quaternion.copy(toHex.quaternion);
    // Lift slightly above tile
    const fromNorm = getPlanetNormal(fromHex.position);
    const toNorm = getPlanetNormal(toHex.position);
    fromRing.position.addScaledVector(fromNorm, HEIGHT_CLAIMED + 0.2);
    toRing.position.addScaledVector(toNorm, HEIGHT_CLAIMED + 0.2);

    scene.add(fromRing);
    scene.add(toRing);

    // Total index count for the tube geometry
    const totalIndices = tubeGeo.index ? tubeGeo.index.count : tubeGeo.attributes.position.count;

    activeEffects.push({
        type: 'trade_route',
        tube, glow, pulses, curve,
        fromRing, toRing,
        totalIndices,
        startTime: Date.now(),
        // Phase 1: trace-on 2s, Phase 2: pulses 3s, Phase 3: fade 1.5s
        duration: 6500,
    });
}

// =============================================================================
// ATTACK EFFECT
// =============================================================================

/**
 * Trigger an orbital strike attack animation: a projectile arcs high above
 * the globe from attacker to target, then impacts with a shockwave.
 * @param {THREE.Group} fromHex - Attacker hex tile
 * @param {THREE.Group} toHex - Target hex tile
 * @param {number} [attackColor=0xe53e6b] - Color of the attack (red/pink)
 * @param {boolean} [success=true] - Whether the attack succeeded
 */
export function triggerAttackEffect(fromHex, toHex, attackColor, success) {
    if (!fromHex || !toHex) return;
    const color = attackColor || 0xe53e6b;
    const isSuccess = success !== undefined ? success : true;

    // --- Compute the high parabolic arc ---
    const fromPos = fromHex.position.clone();
    const toPos = toHex.position.clone();
    const fromDir = new THREE.Vector3().subVectors(fromPos, PLANET_CENTER).normalize();
    const toDir = new THREE.Vector3().subVectors(toPos, PLANET_CENTER).normalize();
    const midDir = new THREE.Vector3().addVectors(fromDir, toDir).normalize();

    // Apex: push midpoint high above the globe
    const apexHeight = 14;
    const apex = new THREE.Vector3()
        .copy(PLANET_CENTER)
        .addScaledVector(midDir, PLANET_RADIUS + apexHeight);

    const startNorm = getPlanetNormal(fromPos);
    const impactNorm = getPlanetNormal(toPos);
    const fromLift = fromPos.clone().addScaledVector(startNorm, HEIGHT_CLAIMED);
    const toLift = toPos.clone().addScaledVector(impactNorm, HEIGHT_CLAIMED);

    // --- Warning laser line (flickers from attacker to target before launch) ---
    const laserGeo = new THREE.BufferGeometry().setFromPoints([fromLift, toLift]);
    const laserMat = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        linewidth: 2
    });
    const warningLaser = new THREE.Line(laserGeo, laserMat);
    scene.add(warningLaser);

    // --- Charge-up glow at source (pulsing sphere) ---
    const chargeGeo = new THREE.SphereGeometry(0.6, 12, 12);
    const chargeMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const chargeGlow = new THREE.Mesh(chargeGeo, chargeMat);
    chargeGlow.position.copy(fromLift);
    scene.add(chargeGlow);

    // --- Projectile sphere (bigger, brighter) ---
    const projGeo = new THREE.SphereGeometry(0.35, 12, 12);
    const projMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const projectile = new THREE.Mesh(projGeo, projMat);
    projectile.position.copy(fromLift);
    projectile.visible = false;
    scene.add(projectile);

    // --- Projectile outer glow (larger) ---
    const projGlowGeo = new THREE.SphereGeometry(0.7, 8, 8);
    const projGlowMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const projGlow = new THREE.Mesh(projGlowGeo, projGlowMat);
    projGlow.position.copy(fromLift);
    projGlow.visible = false;
    scene.add(projGlow);

    // --- Comet trail particles (more, brighter) ---
    const trailCount = 18;
    const trailPositions = new Float32Array(trailCount * 3);
    for (let i = 0; i < trailCount; i++) {
        trailPositions[i * 3] = fromLift.x;
        trailPositions[i * 3 + 1] = fromLift.y;
        trailPositions[i * 3 + 2] = fromLift.z;
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trailMat = new THREE.PointsMaterial({
        color: color,
        size: 0.45,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    });
    const trail = new THREE.Points(trailGeo, trailMat);
    trail.visible = false;
    scene.add(trail);

    // --- Impact shockwave ring (bigger) ---
    const shockGeo = new THREE.TorusGeometry(0.4, 0.15, 8, 32);
    const shockMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const shockwave = new THREE.Mesh(shockGeo, shockMat);
    shockwave.position.copy(toLift);
    shockwave.quaternion.copy(toHex.quaternion);
    shockwave.position.addScaledVector(impactNorm, 0.1);
    shockwave.visible = false;
    scene.add(shockwave);

    // --- Impact flash (bigger) ---
    const flashGeo = new THREE.SphereGeometry(0.6, 12, 12);
    const flashMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(shockwave.position);
    flash.visible = false;
    scene.add(flash);

    // --- Ember particles (more particles, stronger velocity) ---
    const emberCount = 35;
    const emberPositions = new Float32Array(emberCount * 3);
    const emberVelocities = [];
    for (let i = 0; i < emberCount; i++) {
        emberPositions[i * 3] = toLift.x;
        emberPositions[i * 3 + 1] = toLift.y;
        emberPositions[i * 3 + 2] = toLift.z;
        const vel = impactNorm.clone().multiplyScalar(0.04 + Math.random() * 0.08);
        vel.x += (Math.random() - 0.5) * 0.05;
        vel.y += (Math.random() - 0.5) * 0.05;
        vel.z += (Math.random() - 0.5) * 0.05;
        emberVelocities.push(vel);
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
    const emberMat = new THREE.PointsMaterial({
        color: isSuccess ? color : 0x888888,
        size: 0.25,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    });
    const embers = new THREE.Points(emberGeo, emberMat);
    embers.visible = false;
    scene.add(embers);

    // --- Second shockwave ring ---
    let successRing = null;
    if (isSuccess) {
        const srGeo = new THREE.TorusGeometry(0.3, 0.08, 8, 32);
        const srMat = new THREE.MeshBasicMaterial({
            color: 0xff4444,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        successRing = new THREE.Mesh(srGeo, srMat);
        successRing.position.copy(shockwave.position);
        successRing.quaternion.copy(toHex.quaternion);
        successRing.visible = false;
        scene.add(successRing);
    }

    activeEffects.push({
        type: 'attack_strike',
        warningLaser, chargeGlow,
        projectile, projGlow, trail, trailPositions,
        shockwave, flash, embers, emberVelocities, emberPositions,
        successRing,
        fromPos: fromLift,
        toPos: toLift,
        apex,
        isSuccess,
        targetHex: toHex,
        shakeTriggered: false,
        startTime: Date.now(),
        // Phase 0: charge-up 0.8s, Phase 1: projectile 1.4s, Phase 2: impact 0.6s, Phase 3: aftermath 1.2s
        duration: 4000,
    });
}

// =============================================================================
// UPDATE ACTIVE EFFECTS (all types)
// =============================================================================

/**
 * Update all active tile effects. Called from animation loop.
 */
function updateActiveEffects() {
    for (let i = activeEffects.length - 1; i >= 0; i--) {
        const effect = activeEffects[i];
        const elapsed = Date.now() - effect.startTime;
        const t = Math.min(elapsed / effect.duration, 1.0);
        
        // ----- BEACON (expansion) -----
        if (effect.type === 'beacon') {
            if (t < 0.3) {
                const riseT = t / 0.3;
                const easedRise = 1 - Math.pow(1 - riseT, 2);
                effect.beam.scale.set(1, easedRise, 1);
                effect.glow.scale.set(1, easedRise, 1);
                effect.beam.scale.y = easedRise;
                effect.glow.scale.y = easedRise;
            } else if (t < 0.5) {
                effect.beam.scale.set(1, 1, 1);
                effect.glow.scale.set(1, 1, 1);
                const pulseT = (t - 0.3) / 0.2;
                const pulse = 1 + Math.sin(pulseT * Math.PI * 2) * 0.15;
                effect.beam.scale.set(pulse, 1, pulse);
                effect.glow.scale.set(pulse * 1.2, 1, pulse * 1.2);
            } else {
                const fadeT = (t - 0.5) / 0.5;
                const easedFade = fadeT * fadeT;
                effect.beam.material.opacity = 0.9 * (1 - easedFade);
                effect.glow.material.opacity = 0.3 * (1 - easedFade);
                const thin = 1 - easedFade * 0.7;
                effect.beam.scale.set(thin, 1, thin);
                effect.glow.scale.set(thin, 1, thin);
            }
        }

        // ----- TRADE ROUTE -----
        if (effect.type === 'trade_route') {
            // Phase timings (fractions of total duration 6500ms):
            // Trace-on: 0% – 30%  (~2s)
            // Pulses:   30% – 77% (~3s)
            // Fade:     77% – 100% (~1.5s)

            if (t < 0.30) {
                // Phase 1: Wire traces from source to destination
                const traceT = t / 0.30;
                const easedTrace = 1 - Math.pow(1 - traceT, 3); // ease-out cubic
                const revealCount = Math.floor(easedTrace * effect.totalIndices);
                effect.tube.geometry.setDrawRange(0, revealCount);
                effect.glow.geometry.setDrawRange(0, revealCount);

                // Fade in endpoint rings
                effect.fromRing.material.opacity = Math.min(traceT * 2, 0.8);
                effect.toRing.material.opacity = Math.min(Math.max(traceT - 0.5, 0) * 2, 0.8);

                // Tube brightens as it extends
                effect.tube.material.opacity = 0.4 + easedTrace * 0.45;
                effect.glow.material.opacity = 0.1 + easedTrace * 0.15;

            } else if (t < 0.77) {
                // Phase 2: Wire fully drawn, energy pulses travel along it
                effect.tube.geometry.setDrawRange(0, effect.totalIndices);
                effect.glow.geometry.setDrawRange(0, effect.totalIndices);
                effect.tube.material.opacity = 0.85;
                effect.glow.material.opacity = 0.25;

                // Pulse endpoint rings
                const ringPulse = 0.6 + Math.sin(elapsed * 0.008) * 0.2;
                effect.fromRing.material.opacity = ringPulse;
                effect.toRing.material.opacity = ringPulse;

                // Animate energy pulse spheres along the curve
                const phaseT = (t - 0.30) / 0.47; // 0..1 within phase 2
                for (let p = 0; p < effect.pulses.length; p++) {
                    const pulse = effect.pulses[p];
                    // Stagger each pulse: they travel one after another
                    const offset = p / effect.pulses.length;
                    // Each pulse does multiple trips — use modulo
                    const speed = 1.5; // number of full trips during phase 2
                    let pulseProgress = ((phaseT * speed) + offset) % 1.0;

                    pulse.visible = true;
                    const pos = effect.curve.getPointAt(pulseProgress);
                    pulse.position.copy(pos);

                    // Pulse glow: brighter in the middle of its journey
                    const glow = Math.sin(pulseProgress * Math.PI);
                    pulse.material.opacity = 0.5 + glow * 0.5;
                    pulse.scale.setScalar(0.8 + glow * 0.6);
                }

            } else {
                // Phase 3: Fade everything out
                const fadeT = (t - 0.77) / 0.23;
                const fadeEase = fadeT * fadeT; // ease-in

                effect.tube.material.opacity = 0.85 * (1 - fadeEase);
                effect.glow.material.opacity = 0.25 * (1 - fadeEase);
                effect.fromRing.material.opacity = 0.6 * (1 - fadeEase);
                effect.toRing.material.opacity = 0.6 * (1 - fadeEase);

                for (let p = 0; p < effect.pulses.length; p++) {
                    effect.pulses[p].material.opacity = Math.max(0, effect.pulses[p].material.opacity * (1 - fadeEase));
                    effect.pulses[p].scale.setScalar(Math.max(0.1, effect.pulses[p].scale.x * (1 - fadeEase * 0.5)));
                }
            }
        }

        // ----- ATTACK STRIKE -----
        if (effect.type === 'attack_strike') {
            // Phase timings (fractions of total duration 4000ms):
            // Charge-up:     0% – 20%   (~0.8s) — warning laser flicker + charge glow
            // Projectile:    20% – 55%  (~1.4s) — high arc with comet trail
            // Impact:        55% – 70%  (~0.6s) — flash + shockwave + camera shake
            // Aftermath:     70% – 100% (~1.2s) — embers + fade

            if (t < 0.20) {
                // Phase 0: Charge-up — warning laser flickers, charge glow builds
                const chargeT = t / 0.20;

                // Warning laser flickers rapidly (on/off)
                const flicker = Math.sin(elapsed * 0.04) > 0 ? 1 : 0;
                const flickerIntensity = chargeT * 0.6;
                effect.warningLaser.material.opacity = flicker * flickerIntensity;

                // Charge glow builds at source
                const pulse = 0.5 + Math.sin(elapsed * 0.015) * 0.3;
                effect.chargeGlow.material.opacity = chargeT * 0.7 * pulse;
                effect.chargeGlow.scale.setScalar(0.5 + chargeT * 0.8 * pulse);

            } else if (t < 0.55) {
                // Phase 1: Projectile flies along parabolic arc
                const arcT = (t - 0.20) / 0.35;

                // Hide charge-up visuals
                effect.warningLaser.material.opacity = 0;
                effect.chargeGlow.visible = false;

                // Show projectile
                effect.projectile.visible = true;
                effect.projGlow.visible = true;
                effect.trail.visible = true;
                effect.projectile.material.opacity = 1.0;
                effect.trail.material.opacity = 0.7;

                const easedArc = arcT < 0.5
                    ? 2 * arcT * arcT
                    : 1 - Math.pow(-2 * arcT + 2, 2) / 2;

                // Quadratic bezier: from -> apex -> to
                const a = 1 - easedArc;
                const b = easedArc;
                const pos = new THREE.Vector3();
                pos.x = a * a * effect.fromPos.x + 2 * a * b * effect.apex.x + b * b * effect.toPos.x;
                pos.y = a * a * effect.fromPos.y + 2 * a * b * effect.apex.y + b * b * effect.toPos.y;
                pos.z = a * a * effect.fromPos.z + 2 * a * b * effect.apex.z + b * b * effect.toPos.z;

                effect.projectile.position.copy(pos);
                effect.projGlow.position.copy(pos);

                // Pulsate glow
                const gPulse = 0.9 + Math.sin(elapsed * 0.025) * 0.3;
                effect.projGlow.scale.setScalar(gPulse);
                effect.projGlow.material.opacity = 0.35 + gPulse * 0.2;

                // Speed up near end (menacing acceleration)
                effect.projectile.scale.setScalar(1.0 + arcT * 0.3);

                // Comet trail: shift positions, newest at index 0
                const tp = effect.trailPositions;
                for (let ti = tp.length / 3 - 1; ti > 0; ti--) {
                    tp[ti * 3] = tp[(ti - 1) * 3];
                    tp[ti * 3 + 1] = tp[(ti - 1) * 3 + 1];
                    tp[ti * 3 + 2] = tp[(ti - 1) * 3 + 2];
                }
                tp[0] = pos.x;
                tp[1] = pos.y;
                tp[2] = pos.z;
                effect.trail.geometry.attributes.position.needsUpdate = true;

            } else if (t < 0.70) {
                // Phase 2: Impact — flash + shockwave + camera shake
                const impactT = (t - 0.55) / 0.15;

                // Trigger camera shake on first frame of impact
                if (!effect.shakeTriggered) {
                    effect.shakeTriggered = true;
                    triggerCameraShake(1.2, 900, 40);
                }

                // Hide projectile
                effect.projectile.visible = false;
                effect.projGlow.visible = false;
                effect.trail.visible = false;
                effect.warningLaser.visible = false;

                // Flash: big white sphere that shrinks fast
                effect.flash.visible = true;
                const flashScale = 3.0 * (1 - impactT);
                effect.flash.scale.setScalar(Math.max(0.01, flashScale));
                effect.flash.material.opacity = 1.0 * (1 - impactT * impactT);

                // Main shockwave: expands wide
                effect.shockwave.visible = true;
                const shockScale = 0.5 + impactT * 7.0;
                effect.shockwave.scale.setScalar(shockScale);
                effect.shockwave.material.opacity = 1.0 * (1 - impactT);

                // Second shockwave (delayed, larger)
                if (effect.successRing) {
                    const delayedT = Math.max(0, impactT - 0.25) / 0.75;
                    effect.successRing.visible = true;
                    effect.successRing.scale.setScalar(0.5 + delayedT * 5.0);
                    effect.successRing.material.opacity = 0.8 * (1 - delayedT);
                }

                // Start embers
                effect.embers.visible = true;
                effect.embers.material.opacity = 0.9;

                // Flash target tile red
                if (effect.targetHex) {
                    effect.targetHex.children.forEach(child => {
                        if (child.material && child.material.emissive) {
                            child.material.emissive.setHex(effect.isSuccess ? 0xe53e6b : 0x888888);
                            child.material.emissiveIntensity = 1.2 * (1 - impactT);
                        }
                    });
                }

            } else {
                // Phase 3: Aftermath — embers rise and fade, everything cleans up
                const afterT = (t - 0.70) / 0.30;

                // Flash gone
                if (effect.flash.visible) effect.flash.visible = false;

                // Shockwaves fade
                effect.shockwave.material.opacity = Math.max(0, 0.15 * (1 - afterT));
                if (effect.successRing) {
                    effect.successRing.material.opacity = Math.max(0, 0.1 * (1 - afterT));
                }

                // Embers rise and fade
                const ep = effect.emberPositions;
                for (let ei = 0; ei < effect.emberVelocities.length; ei++) {
                    const vel = effect.emberVelocities[ei];
                    ep[ei * 3] += vel.x;
                    ep[ei * 3 + 1] += vel.y;
                    ep[ei * 3 + 2] += vel.z;
                    vel.multiplyScalar(0.96);
                }
                effect.embers.geometry.attributes.position.needsUpdate = true;
                effect.embers.material.opacity = 0.9 * (1 - afterT);

                // Reset target hex emissive
                if (effect.targetHex && afterT > 0.2) {
                    effect.targetHex.children.forEach(child => {
                        if (child.material && child.material.emissive) {
                            child.material.emissiveIntensity = Math.max(0, child.material.emissiveIntensity - 0.06);
                        }
                    });
                }
            }
        }
        
        // ----- REMOVE COMPLETED EFFECTS -----
        if (t >= 1.0) {
            if (effect.type === 'beacon') {
                scene.remove(effect.beam);
                scene.remove(effect.glow);
                effect.beam.geometry.dispose();
                effect.beam.material.dispose();
                effect.glow.geometry.dispose();
                effect.glow.material.dispose();
            }
            if (effect.type === 'trade_route') {
                scene.remove(effect.tube);
                scene.remove(effect.glow);
                effect.tube.geometry.dispose();
                effect.tube.material.dispose();
                effect.glow.geometry.dispose();
                effect.glow.material.dispose();
                scene.remove(effect.fromRing);
                scene.remove(effect.toRing);
                effect.fromRing.geometry.dispose();
                effect.fromRing.material.dispose();
                effect.toRing.geometry.dispose();
                effect.toRing.material.dispose();
                for (const pulse of effect.pulses) {
                    scene.remove(pulse);
                    pulse.material.dispose();
                }
                // Shared geometry — only dispose once
                if (effect.pulses.length > 0) {
                    effect.pulses[0].geometry.dispose();
                }
            }
            if (effect.type === 'attack_strike') {
                scene.remove(effect.warningLaser);
                scene.remove(effect.chargeGlow);
                scene.remove(effect.projectile);
                scene.remove(effect.projGlow);
                scene.remove(effect.trail);
                scene.remove(effect.shockwave);
                scene.remove(effect.flash);
                scene.remove(effect.embers);
                effect.warningLaser.geometry.dispose();
                effect.warningLaser.material.dispose();
                effect.chargeGlow.geometry.dispose();
                effect.chargeGlow.material.dispose();
                effect.projectile.geometry.dispose();
                effect.projectile.material.dispose();
                effect.projGlow.geometry.dispose();
                effect.projGlow.material.dispose();
                effect.trail.geometry.dispose();
                effect.trail.material.dispose();
                effect.shockwave.geometry.dispose();
                effect.shockwave.material.dispose();
                effect.flash.geometry.dispose();
                effect.flash.material.dispose();
                effect.embers.geometry.dispose();
                effect.embers.material.dispose();
                if (effect.successRing) {
                    scene.remove(effect.successRing);
                    effect.successRing.geometry.dispose();
                    effect.successRing.material.dispose();
                }
                // Reset target hex emissive to 0
                if (effect.targetHex) {
                    effect.targetHex.children.forEach(child => {
                        if (child.material && child.material.emissive) {
                            child.material.emissiveIntensity = 0;
                            child.material.emissive.setHex(0x000000);
                        }
                    });
                }
            }
            activeEffects.splice(i, 1);
        }
    }
}

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
            // 1. Spawn Animation (Scale Up) — for initial map load
            if (hex.scale.x < 1 && !hex.userData.claimRise) {
                const delay = hex.userData.spawnDelay || 0;
                if (now - hex.userData.spawnTime > delay) {
                    const speed = 0.06; // Balanced speed for visible but snappy animation
                    hex.scale.x = Math.min(1, hex.scale.x + speed);
                    hex.scale.y = Math.min(1, hex.scale.y + speed);
                    hex.scale.z = Math.min(1, hex.scale.z + speed);
                }
            }
            
            // 1b. Claim Rise Animation — tile rises from flat to claimed height
            if (hex.userData.claimRise) {
                const rise = hex.userData.claimRise;
                const elapsed = now - rise.startTime;
                
                if (elapsed >= 0) {
                    const t = Math.min(elapsed / rise.duration, 1.0);
                    // Ease-out with slight overshoot then settle
                    let easedT;
                    if (t < 0.7) {
                        easedT = (t / 0.7) * 1.08;
                    } else {
                        const settleT = (t - 0.7) / 0.3;
                        easedT = 1.08 - 0.08 * settleT;
                    }
                    
                    hex.scale.y = rise.startScaleY + (rise.endScaleY - rise.startScaleY) * Math.min(easedT, 1.08);
                    
                    if (t >= 1.0) {
                        hex.scale.y = 1.0;
                        delete hex.userData.claimRise;
                    }
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
        
        // Update tile effects (shockwaves, beacons, etc.)
        updateActiveEffects();
        
        // Update camera flight animation
        updateCameraFlight();
        
        // Update smooth orbit retarget
        updateOrbitRetarget();
        
        // Update camera shake
        updateCameraShake();
        
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
