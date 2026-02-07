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

// =============================================================================
// HEXAGON PARAMETERS
// =============================================================================

const hexRadius = 0.9;
const hexHeight = 0.45;
const gap = 0.06;

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
const centerGlow = new THREE.PointLight(0x00e5cc, 1.5, 8);
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
const BORDER_HEIGHT_OFFSET = 0.02;  // Slightly above tile surface
const BORDER_WIDTH = 0.08;          // Width of the border ribbon
const BORDER_GLOW_INTENSITY = 0.6;  // Emissive intensity

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
    
    const y = tileHeight + BORDER_HEIGHT_OFFSET;
    
    return {
        v1: {
            x: centerX + Math.cos(angle1) * effectiveRadius,
            y: y,
            z: centerZ + Math.sin(angle1) * effectiveRadius
        },
        v2: {
            x: centerX + Math.cos(angle2) * effectiveRadius,
            y: y,
            z: centerZ + Math.sin(angle2) * effectiveRadius
        }
    };
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
        
        // Get tile height (owned tiles are taller)
        const tileHeight = hexHeight * 1.5;
        
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
    
    // Create one merged mesh per color
    for (const [colorValue, colorBorders] of bordersByColor) {
        const positions = [];
        const indices = [];
        let vertexIndex = 0;
        
        colorBorders.forEach(border => {
            const { v1, v2 } = getEdgeVertices(border.q, border.r, border.edgeIndex, border.tileHeight);
            
            // Calculate the normal direction (perpendicular to edge, pointing outward)
            const edgeDirX = v2.x - v1.x;
            const edgeDirZ = v2.z - v1.z;
            const edgeLength = Math.sqrt(edgeDirX * edgeDirX + edgeDirZ * edgeDirZ);
            
            // Normalized perpendicular (rotate 90 degrees)
            const normalX = -edgeDirZ / edgeLength;
            const normalZ = edgeDirX / edgeLength;
            
            // Create a ribbon: 4 vertices forming a quad
            // Inner edge (on the tile)
            const innerOffset = BORDER_WIDTH * 0.3;
            // Outer edge (extending outward)
            const outerOffset = BORDER_WIDTH * 0.7;
            
            // Vertex positions for the ribbon quad
            // v1 inner, v1 outer, v2 outer, v2 inner
            positions.push(
                v1.x - normalX * innerOffset, v1.y, v1.z - normalZ * innerOffset,  // 0: v1 inner
                v1.x + normalX * outerOffset, v1.y, v1.z + normalZ * outerOffset,  // 1: v1 outer
                v2.x + normalX * outerOffset, v2.y, v2.z + normalZ * outerOffset,  // 2: v2 outer
                v2.x - normalX * innerOffset, v2.y, v2.z - normalZ * innerOffset   // 3: v2 inner
            );
            
            // Two triangles for the quad
            indices.push(
                vertexIndex, vertexIndex + 1, vertexIndex + 2,
                vertexIndex, vertexIndex + 2, vertexIndex + 3
            );
            
            vertexIndex += 4;
        });
        
        // Create the geometry
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        
        // Create glowing material
        const color = new THREE.Color(colorValue);
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
        });
        
        // Also create an emissive overlay for glow effect
        const glowMaterial = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: BORDER_GLOW_INTENSITY,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
        });
        
        const mesh = new THREE.Mesh(geometry, glowMaterial);
        mesh.userData.isBorder = true;
        mesh.userData.borderColor = colorValue;
        
        borderGroup.add(mesh);
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
        
        // Animate border glow (subtle pulse)
        borderGroup.children.forEach(border => {
            if (border.material && border.material.emissiveIntensity !== undefined) {
                const pulse = BORDER_GLOW_INTENSITY + Math.sin(time * 2) * 0.15;
                border.material.emissiveIntensity = pulse;
            }
        });
        
        // Call external animation callback if set
        if (animationCallback) {
            animationCallback(time);
        }
        
        controls.update();
        renderer.render(scene, camera);
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
    
    if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj.parent && obj.userData.q === undefined) {
            obj = obj.parent;
        }
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

export { colors, hexRadius, hexHeight };
