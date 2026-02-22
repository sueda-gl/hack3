// ================================================================
//  CLAWQUEST — Space Colony Prototype
//  Low-poly isometric space village rendered with Three.js
//  Pure visual exploration — no backend integration
// ================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ────────────────────────────────────────────────────────────────
//  CONFIG
// ────────────────────────────────────────────────────────────────
const HEX_SIZE       = 1.0;
const HEX_GAP        = 0.04;
const HEX_THICKNESS  = 0.35;
const GRID_RADIUS    = 14;
const SQRT3          = Math.sqrt(3);

// ────────────────────────────────────────────────────────────────
//  COLOUR PALETTE
// ────────────────────────────────────────────────────────────────
const PAL = {
    // terrain — original village colours
    grass:    [0x7ec850, 0x72bc46, 0x8ad45e, 0x68b23c],
    farmland: [0xe8c840, 0xdcbc34, 0xd8b030, 0xf0d050],
    forest:   [0x4a8a3a, 0x3e7a2e, 0x569646, 0x3a6e2a],
    water:    [0x4ab8e8, 0x42a8d8, 0x52c0f0],
    path:     [0xc8a878, 0xbc9c6c, 0xd4b484],
    village:  [0xa8c878, 0x9cbc6c, 0xb4d484],

    // structures — sci-fi colony
    walls:    [0xb8b8c8, 0xa8a8b8, 0xc8c8d8, 0x9898a8],       // metal hull panels
    roofs:    [0x00c8ff, 0xff4488, 0x44ff88, 0xffaa00, 0x8844ff], // neon dome lights
    wood:     [0x606878, 0x585868, 0x687080],                  // alloy struts
    stone:    [0x707888, 0x606878, 0x808898],                  // composite plating

    agents:   [0xe74c3c, 0x9b59b6, 0x2ecc71, 0x3498db, 0xf39c12],
    skin:     [0xCCDDEE, 0xB0C4DE, 0xA0B8D0],                 // space-suited
};

// ────────────────────────────────────────────────────────────────
//  MOCK AGENTS & TERRITORY
// ────────────────────────────────────────────────────────────────
const AGENTS = [
    { id: 0, name: "Su'Claw",    color: PAL.agents[0] },
    { id: 1, name: "Hexwitch",   color: PAL.agents[1] },
    { id: 2, name: "Sol Patch",  color: PAL.agents[2] },
    { id: 3, name: "Ironmaw",    color: PAL.agents[3] },
    { id: 4, name: "Ashveil",    color: PAL.agents[4] },
];

const TERRITORY = {};
const CAPITALS = [
    { q: 0, r: 0, str: 4.8 },     // Red – centre
    { q: 9, r: -7, str: 3.8 },    // Purple – NE
    { q: -9, r: 7, str: 3.8 },    // Green – SW
    { q: -7, r: -4, str: 3.4 },   // Blue – NW
    { q: 8, r: 4, str: 3.4 },     // Orange – SE
];

function generateTerritory() {
    for (let q = -GRID_RADIUS; q <= GRID_RADIUS; q++) {
        const r1 = Math.max(-GRID_RADIUS, -q - GRID_RADIUS);
        const r2 = Math.min(GRID_RADIUS, -q + GRID_RADIUS);
        for (let r = r1; r <= r2; r++) {
            if (terrainType(q, r) === 'water') continue;
            let best = -1, bestScore = -Infinity;
            CAPITALS.forEach((cap, idx) => {
                const d = hexDist(q, r, cap.q, cap.r);
                const noise = (hash(q * 1337 + idx * 99, r * 7919) - 0.5) * 2.5;
                const score = cap.str + noise - d;
                if (score > 0 && score > bestScore) {
                    bestScore = score; best = idx;
                }
            });
            if (best >= 0) TERRITORY[`${q},${r}`] = best;
        }
    }
}

// ────────────────────────────────────────────────────────────────
//  GLOBALS
// ────────────────────────────────────────────────────────────────
let scene, camera, renderer, controls, clock;
let minimapCamera, minimapTarget;
const hexData       = [];   // { mesh, q, r, terrain, owner, topY }
const windmills     = [];   // { blades }
const characters    = [];
const smokeParticles= [];
const waterMeshes   = [];
const clouds        = [];

// ────────────────────────────────────────────────────────────────
//  UTILITIES
// ────────────────────────────────────────────────────────────────
function hash(a, b) {
    const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return x - Math.floor(x);
}
function pick(arr, seed) { return arr[Math.floor(hash(seed, seed * 1.7) * arr.length)]; }
function lerp(a, b, t) { return a + (b - a) * t; }

// ── hex maths (flat-top, axial coords) ──
function hexToWorld(q, r) {
    return {
        x: HEX_SIZE * 1.5 * q,
        z: HEX_SIZE * SQRT3 * (r + q / 2),
    };
}
function hexDist(q1, r1, q2 = 0, r2 = 0) {
    return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

// ────────────────────────────────────────────────────────────────
//  TERRAIN
// ────────────────────────────────────────────────────────────────
function terrainType(q, r) {
    const d = hexDist(q, r);
    const h = hash(q * 7919, r * 6271);

    // pond cluster near village
    if ((q === 4 && r === 3) || (q === 5 && r === 2) || (q === 4 && r === 2) ||
        (q === 5 && r === 3) || (q === 3 && r === 3)) return 'water';
    // stream
    if (d >= 4 && (q + 2 * r >= 9 && q + 2 * r <= 10)) return 'water';
    // large lake to the south
    if ((q === -2 && r === 8) || (q === -1 && r === 8) || (q === -2 && r === 9) ||
        (q === -3 && r === 9) || (q === -1 && r === 7) || (q === -3 && r === 10) ||
        (q === 0 && r === 7) || (q === -2 && r === 10)) return 'water';
    // river snaking through east
    if (d >= 7 && (q - r >= 10 && q - r <= 11) && h < 0.65) return 'water';
    // small pond northwest
    if ((q === -8 && r === 2) || (q === -9 && r === 3) || (q === -8 && r === 3)) return 'water';

    if (d === 0) return 'village';
    if (d <= 2) return h < 0.25 ? 'path' : 'village';
    if (d <= 3) {
        if (h < 0.15) return 'path';
        if (h < 0.40) return 'village';
        if (h < 0.60) return 'farmland';
        return 'grass';
    }
    if (d <= 5) {
        if (h < 0.25) return 'farmland';
        if (h < 0.50) return 'forest';
        return 'grass';
    }
    if (d <= 8) {
        if (h < 0.20) return 'farmland';
        if (h < 0.45) return 'forest';
        if (h < 0.60) return 'grass';
        return 'forest';
    }
    // outer rim: mostly forest and grass
    if (h < 0.45) return 'forest';
    if (h < 0.60) return 'grass';
    if (h < 0.70) return 'farmland';
    return 'forest';
}

function elevation(type, q, r) {
    const base = { water: -0.06, farmland: 0.01, path: 0.02, village: 0.03, grass: 0.04, forest: 0.09 }[type] ?? 0.04;
    return base + hash(q * 5381, r * 4217) * 0.04;
}

// ────────────────────────────────────────────────────────────────
//  SCENE SETUP
// ────────────────────────────────────────────────────────────────
function initScene() {
    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xB8D8F0, 0.014);

    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(16, 18, 22);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 5;
    controls.maxDistance = 55;
    controls.maxPolarAngle = Math.PI / 2.3;
    controls.minPolarAngle = Math.PI / 8;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.25;
    controls.target.set(0, 0, 0);

    clock = new THREE.Clock();

    // ── Minimap orthographic camera ──
    const mapExtent = 30;
    minimapCamera = new THREE.OrthographicCamera(
        -mapExtent, mapExtent, mapExtent, -mapExtent, 0.1, 100
    );
    minimapCamera.position.set(0, 40, 0);
    minimapCamera.lookAt(0, 0, 0);
    minimapCamera.up.set(0, 0, -1);
}

// ────────────────────────────────────────────────────────────────
//  LIGHTING
// ────────────────────────────────────────────────────────────────
function createLighting() {
    scene.add(new THREE.HemisphereLight(0xFFF5E6, 0x7A9B5A, 0.6));

    const sun = new THREE.DirectionalLight(0xFFF0D0, 1.4);
    sun.position.set(10, 15, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = 35;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;   sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0008;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0xC0D8F0, 0.25);
    fill.position.set(-6, 8, -4);
    scene.add(fill);

    scene.add(new THREE.AmbientLight(0xFFF8F0, 0.15));
}

// ────────────────────────────────────────────────────────────────
//  SKY DOME
// ────────────────────────────────────────────────────────────────
function createSky() {
    const geo = new THREE.SphereGeometry(150, 32, 16);
    const colors = [];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const t = Math.max(0, Math.min(1, (pos.getY(i) + 150) / 300));
        const c = new THREE.Color(0xC8DFF0).lerp(new THREE.Color(0x5A9FD4), Math.pow(t, 0.35));
        colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
}

// ────────────────────────────────────────────────────────────────
//  GROUND PLANE  (visible through hex gaps)
// ────────────────────────────────────────────────────────────────
function createGround() {
    const groundRadius = HEX_SIZE * 1.5 * GRID_RADIUS + HEX_SIZE * 1.2;
    const g = new THREE.Mesh(
        new THREE.CircleGeometry(groundRadius, 64),
        new THREE.MeshLambertMaterial({ color: 0x4A7A2A })
    );
    g.rotation.x = -Math.PI / 2;
    g.position.y = -0.25;
    g.receiveShadow = true;
    scene.add(g);
}

// ────────────────────────────────────────────────────────────────
//  CLOUDS
// ────────────────────────────────────────────────────────────────
function createClouds() {
    for (let i = 0; i < 18; i++) {
        const group = new THREE.Group();
        const n = 3 + Math.floor(Math.random() * 3);
        for (let j = 0; j < n; j++) {
            const puff = new THREE.Mesh(
                new THREE.SphereGeometry(0.8 + Math.random() * 1.4, 7, 5),
                new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.75 })
            );
            puff.position.set((j - n / 2) * 0.9, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6);
            puff.scale.y = 0.35;
            group.add(puff);
        }
        group.position.set((Math.random() - 0.5) * 90, 16 + Math.random() * 6, (Math.random() - 0.5) * 90);
        group.userData.speed = 0.015 + Math.random() * 0.025;
        scene.add(group);
        clouds.push(group);
    }
}

// ────────────────────────────────────────────────────────────────
//  HEX TILES
// ────────────────────────────────────────────────────────────────
function createHexTiles() {
    const geo = new THREE.CylinderGeometry(HEX_SIZE - HEX_GAP, HEX_SIZE - HEX_GAP, HEX_THICKNESS, 6);

    for (let q = -GRID_RADIUS; q <= GRID_RADIUS; q++) {
        const r1 = Math.max(-GRID_RADIUS, -q - GRID_RADIUS);
        const r2 = Math.min(GRID_RADIUS, -q + GRID_RADIUS);
        for (let r = r1; r <= r2; r++) {
            const type  = terrainType(q, r);
            const elev  = elevation(type, q, r);
            const pos   = hexToWorld(q, r);
            const owner = TERRITORY[`${q},${r}`];

            let color = new THREE.Color(pick(PAL[type] || PAL.grass, q * 4219 + r * 3463));
            if (owner !== undefined) color.lerp(new THREE.Color(AGENTS[owner].color), 0.40);

            const isWater = type === 'water';
            const mat = new THREE.MeshLambertMaterial({
                color,
                flatShading: true,
                transparent: isWater,
                opacity: isWater ? 0.78 : 1,
            });

            const tile = new THREE.Mesh(geo.clone(), mat);
            tile.position.set(pos.x, elev, pos.z);
            tile.receiveShadow = true;
            scene.add(tile);

            const topY = elev + HEX_THICKNESS / 2;
            hexData.push({ mesh: tile, q, r, terrain: type, owner, topY, elev });

            if (isWater) { tile.userData.baseY = elev; waterMeshes.push(tile); }
            if (owner !== undefined && hash(q * 2341, r * 4567) < 0.12) addFlag(pos.x, topY, pos.z, AGENTS[owner].color, q, r);
        }
    }
}

// ── small coloured flag for owned hexes ──
function addFlag(x, y, z, color, q, r) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.3, 5),
        new THREE.MeshLambertMaterial({ color: 0x606878, flatShading: true })
    );
    pole.position.y = 0.15;
    g.add(pole);

    const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 0.07),
        new THREE.MeshLambertMaterial({ color, flatShading: true, side: THREE.DoubleSide })
    );
    flag.position.set(0.06, 0.26, 0);
    g.add(flag);

    g.position.set(x + 0.32, y, z + 0.32);
    g.rotation.y = hash(q, r) * Math.PI * 2;
    scene.add(g);
}

// ────────────────────────────────────────────────────────────────
//  TERRITORY BORDERS  (palisade walls along faction edges)
// ────────────────────────────────────────────────────────────────
function createTerritoryBorders() {
    const HEX_DIRS = [
        { dq: 1, dr: 0 },  { dq: 0, dr: 1 },  { dq: -1, dr: 1 },
        { dq: -1, dr: 0 }, { dq: 0, dr: -1 }, { dq: 1, dr: -1 },
    ];

    const s = HEX_SIZE - HEX_GAP;
    const frontierTiles = new Set();
    const placedPillars = new Set();

    hexData.forEach(hex => {
        if (hex.owner === undefined) return;

        const { q, r, topY, owner } = hex;
        const center = hexToWorld(q, r);
        const agentColor = AGENTS[owner].color;
        const wallMat = new THREE.MeshLambertMaterial({ color: agentColor, flatShading: true });
        let isFrontier = false;

        for (let i = 0; i < 6; i++) {
            const nq = q + HEX_DIRS[i].dq;
            const nr = r + HEX_DIRS[i].dr;
            const neighborOwner = TERRITORY[`${nq},${nr}`];

            if (neighborOwner === owner) continue;
            isFrontier = true;

            // Edge vertex positions
            const a1 = (Math.PI / 3) * i;
            const a2 = (Math.PI / 3) * ((i + 1) % 6);
            const v1x = center.x + s * Math.cos(a1);
            const v1z = center.z + s * Math.sin(a1);
            const v2x = center.x + s * Math.cos(a2);
            const v2z = center.z + s * Math.sin(a2);

            const mx = (v1x + v2x) / 2;
            const mz = (v1z + v2z) / 2;
            const dx = v2x - v1x;
            const dz = v2z - v1z;
            const edgeLen = Math.sqrt(dx * dx + dz * dz);

            // Palisade wall segment
            const wall = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.22, edgeLen * 0.88),
                wallMat
            );
            wall.position.set(mx, topY + 0.11, mz);
            wall.rotation.y = Math.atan2(dx, dz);
            wall.castShadow = true;
            scene.add(wall);

            // Corner pillars at each vertex (deduplicated)
            [[v1x, v1z], [v2x, v2z]].forEach(([vx, vz]) => {
                const key = `${vx.toFixed(2)},${vz.toFixed(2)}`;
                if (placedPillars.has(key)) return;
                placedPillars.add(key);
                const pillar = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.05, 0.06, 0.30, 6),
                    wallMat
                );
                pillar.position.set(vx, topY + 0.15, vz);
                pillar.castShadow = true;
                scene.add(pillar);
            });
        }

        if (isFrontier) frontierTiles.add(`${q},${r}`);
    });

    return frontierTiles;
}

// ────────────────────────────────────────────────────────────────
//  WATCHTOWER  (placed on frontier tiles)
// ────────────────────────────────────────────────────────────────
function createWatchtower(x, y, z, color) {
    const g = new THREE.Group();
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x505068, flatShading: true });
    const darkMat  = new THREE.MeshLambertMaterial({ color: 0x383848, flatShading: true });
    const flagMat  = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.3, flatShading: true, side: THREE.DoubleSide });

    // Stone base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.24, 0.14, 8), stoneMat);
    base.position.y = 0.07; base.castShadow = true; base.receiveShadow = true;
    g.add(base);

    // Tower body
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.72, 8), stoneMat);
    tower.position.y = 0.50; tower.castShadow = true;
    g.add(tower);

    // Battlements
    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.045), darkMat);
        merlon.position.set(Math.cos(angle) * 0.14, 0.92, Math.sin(angle) * 0.14);
        merlon.rotation.y = angle;
        g.add(merlon);
    }

    // Antenna
    const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, 0.40, 5),
        new THREE.MeshLambertMaterial({ color: 0x606878, flatShading: true })
    );
    pole.position.y = 1.12; g.add(pole);

    // Flag
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.12), flagMat);
    flag.position.set(0.11, 1.24, 0); g.add(flag);

    g.position.set(x, y, z);
    scene.add(g);
    return g;
}

// ────────────────────────────────────────────────────────────────
//  BUILDINGS
// ────────────────────────────────────────────────────────────────

// ── Habitat Pod ──
function createCottage(x, y, z) {
    const g = new THREE.Group();
    const wc = pick(PAL.walls, x * 100 + z);
    const rc = pick(PAL.roofs, x * 200 + z * 300);

    // hull
    const walls = new THREE.Mesh(
        new THREE.BoxGeometry(0.52, 0.38, 0.44),
        new THREE.MeshLambertMaterial({ color: wc, flatShading: true })
    );
    walls.position.y = 0.19; walls.castShadow = true; walls.receiveShadow = true;
    g.add(walls);

    // dome roof (glowing neon)
    const roof = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: rc, emissive: rc, emissiveIntensity: 0.35, flatShading: true, transparent: true, opacity: 0.85 })
    );
    roof.position.y = 0.38; roof.castShadow = true;
    g.add(roof);

    // airlock door
    const door = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.18, 0.02),
        new THREE.MeshLambertMaterial({ color: 0x222238, flatShading: true })
    );
    door.position.set(0, 0.09, 0.23);
    g.add(door);

    // viewport window (glowing)
    const win = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, 0.02),
        new THREE.MeshLambertMaterial({ color: 0x00ddff, emissive: 0x00aacc, emissiveIntensity: 0.6, flatShading: true })
    );
    win.position.set(0.16, 0.24, 0.23);
    g.add(win);

    // antenna mast
    const chim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.3, 5),
        new THREE.MeshLambertMaterial({ color: 0x606878, flatShading: true })
    );
    chim.position.set(-0.14, 0.52, 0); chim.castShadow = true;
    g.add(chim);

    // antenna tip glow
    const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 5, 4),
        new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.8 })
    );
    tip.position.set(-0.14, 0.68, 0);
    g.add(tip);

    g.position.set(x, y, z);
    g.rotation.y = Math.floor(hash(x * 1000, z * 2000) * 4) * (Math.PI / 2);
    scene.add(g);

    // exhaust vapor
    spawnSmoke(x, y + 0.62, z);

    return g;
}

// ── Energy Turbine ──
function createWindmill(x, y, z) {
    const g = new THREE.Group();

    // pylon body
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.26, 0.85, 8),
        new THREE.MeshLambertMaterial({ color: 0x505068, flatShading: true })
    );
    body.position.y = 0.425; body.castShadow = true; body.receiveShadow = true;
    g.add(body);

    // dome top (glowing)
    const roof = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0x00ddff, emissive: 0x0088aa, emissiveIntensity: 0.4, flatShading: true })
    );
    roof.position.y = 0.86; roof.castShadow = true;
    g.add(roof);

    // energy collector blades
    const bladeGroup = new THREE.Group();
    bladeGroup.position.set(0, 0.62, 0.24);
    for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        const blade = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.45, 0.015),
            new THREE.MeshLambertMaterial({ color: 0x00ccee, emissive: 0x006688, emissiveIntensity: 0.3, flatShading: true })
        );
        blade.position.y = 0.24;
        arm.add(blade);
        arm.rotation.z = (i / 4) * Math.PI * 2;
        bladeGroup.add(arm);
    }
    g.add(bladeGroup);
    g.position.set(x, y, z);
    scene.add(g);
    windmills.push({ blades: bladeGroup });
    return g;
}

// ── Supply Depot ──
function createMarket(x, y, z) {
    const g = new THREE.Group();
    const canopyColor = pick([0x00ddff, 0xff4488, 0x44ff88, 0xffaa00, 0x8844ff], x * 300 + z);
    const metalColor  = pick(PAL.wood, x + z);

    // struts
    const postGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.42, 6);
    const postMat = new THREE.MeshLambertMaterial({ color: metalColor, flatShading: true });
    [[-0.2, -0.14], [0.2, -0.14], [-0.2, 0.14], [0.2, 0.14]].forEach(([px, pz]) => {
        const p = new THREE.Mesh(postGeo, postMat);
        p.position.set(px, 0.21, pz);
        g.add(p);
    });

    // energy canopy (glowing)
    const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.025, 0.38),
        new THREE.MeshLambertMaterial({ color: canopyColor, emissive: canopyColor, emissiveIntensity: 0.25, flatShading: true, transparent: true, opacity: 0.7 })
    );
    canopy.position.y = 0.42; canopy.rotation.z = 0.08; canopy.castShadow = true;
    g.add(canopy);

    // cargo containers
    const crateGeo = new THREE.BoxGeometry(0.09, 0.07, 0.09);
    const crateMat = new THREE.MeshLambertMaterial({ color: 0x383848, flatShading: true });
    for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(crateGeo, crateMat);
        c.position.set(-0.11 + i * 0.11, 0.035, 0);
        g.add(c);
    }

    g.position.set(x, y, z);
    g.rotation.y = hash(x * 500, z) * Math.PI * 2;
    scene.add(g);
    return g;
}

// ── Reactor Core ──
function createWell(x, y, z) {
    const g = new THREE.Group();
    const metalMat = new THREE.MeshLambertMaterial({ color: 0x505068, flatShading: true });
    const strutMat = new THREE.MeshLambertMaterial({ color: 0x606878, flatShading: true });

    // containment ring
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.16, 8), metalMat);
    ring.position.y = 0.08; ring.castShadow = true;
    g.add(ring);

    // pylons
    [[-0.09, 0], [0.09, 0]].forEach(([px, pz]) => {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 5), strutMat);
        p.position.set(px, 0.32, pz); g.add(p);
    });

    // crossbar
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.025), strutMat);
    bar.position.y = 0.48; g.add(bar);

    // energy orb (glowing core)
    const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.10, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.7 })
    );
    orb.position.y = 0.30;
    g.add(orb);

    g.position.set(x, y, z);
    scene.add(g);
    return g;
}

// ── Metal Catwalk (energy pool crossings) ──
function createBridge(x, y, z, rotation = 0) {
    const g = new THREE.Group();
    const metalMat = new THREE.MeshLambertMaterial({ color: 0x505068, flatShading: true });

    // deck
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.35), metalMat);
    deck.position.y = 0.12; deck.castShadow = true;
    g.add(deck);

    // railings
    [-0.16, 0.16].forEach(zz => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 0.02), metalMat);
        rail.position.set(0, 0.17, zz); g.add(rail);
    });

    g.position.set(x, y, z);
    g.rotation.y = rotation;
    scene.add(g);
    return g;
}

// ────────────────────────────────────────────────────────────────
//  VEGETATION
// ────────────────────────────────────────────────────────────────

// ── Crystal Spire (replaces pine tree) ──
function createPineTree(x, y, z, s = 1) {
    const g = new THREE.Group();
    const crystalColor = pick(PAL.forest, x * 1000 + z);

    // crystal base
    const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.06, 0.12, 5),
        new THREE.MeshLambertMaterial({ color: 0x383848, flatShading: true })
    );
    base.position.y = 0.06; g.add(base);

    // crystal shards
    const crystalMat = new THREE.MeshLambertMaterial({
        color: crystalColor, emissive: crystalColor, emissiveIntensity: 0.4,
        flatShading: true, transparent: true, opacity: 0.8,
    });
    const shards = [
        { r: 0.06, h: 0.40, y: 0.32, tilt: 0 },
        { r: 0.04, h: 0.30, y: 0.27, tilt: 0.2 },
        { r: 0.035, h: 0.22, y: 0.23, tilt: -0.25 },
    ];
    shards.forEach((sh, i) => {
        const shard = new THREE.Mesh(new THREE.ConeGeometry(sh.r, sh.h, 5), crystalMat);
        shard.position.set((i - 1) * 0.04, sh.y, 0);
        shard.rotation.z = sh.tilt;
        shard.castShadow = true;
        g.add(shard);
    });

    g.position.set(x, y, z);
    g.scale.setScalar(s);
    scene.add(g);
    return g;
}

// ── Glowing Orb Plant (replaces round tree) ──
function createRoundTree(x, y, z, s = 1) {
    const g = new THREE.Group();
    const orbColor = pick([0x8844ff, 0x44ccff, 0xff44aa, 0x44ff88], x * 800 + z);

    // stem
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.035, 0.28, 6),
        new THREE.MeshLambertMaterial({ color: 0x383848, flatShading: true })
    );
    trunk.position.y = 0.14; g.add(trunk);

    // glowing orb
    const crown = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.20, 1),
        new THREE.MeshLambertMaterial({
            color: orbColor, emissive: orbColor, emissiveIntensity: 0.5,
            flatShading: true, transparent: true, opacity: 0.75,
        })
    );
    crown.position.y = 0.40; crown.castShadow = true;
    g.add(crown);

    g.position.set(x, y, z);
    g.scale.setScalar(s);
    scene.add(g);
    return g;
}

// ── Alien Spore Cluster (replaces bush) ──
function createBush(x, y, z) {
    const g = new THREE.Group();
    const sporeColor = pick([0x6030a0, 0x4020a0, 0x8040c0], x * 600 + z);
    for (let i = 0; i < 3; i++) {
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.08 + hash(x + i, z) * 0.05, 6, 4),
            new THREE.MeshLambertMaterial({
                color: sporeColor, emissive: sporeColor, emissiveIntensity: 0.25,
                flatShading: true, transparent: true, opacity: 0.7,
            })
        );
        sphere.position.set((i - 1) * 0.07, 0.06, (hash(i, x) - 0.5) * 0.06);
        sphere.castShadow = true;
        g.add(sphere);
    }
    g.position.set(x, y, z);
    scene.add(g);
}

// ── Bioluminescent Particles (replace flowers) ──
function createFlowers(x, y, z) {
    const colors = [0x00ffcc, 0xff44aa, 0x44ccff, 0xaaff44, 0xffaa00];
    for (let i = 0; i < 6; i++) {
        const f = new THREE.Mesh(
            new THREE.SphereGeometry(0.018, 4, 3),
            new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true, opacity: 0.7 })
        );
        f.position.set(
            x + (hash(x * 100, i) - 0.5) * 0.5,
            y + 0.02,
            z + (hash(z * 100, i) - 0.5) * 0.5
        );
        scene.add(f);
    }
}

// ── Solar Array Rods (replace crops) ──
function createCrops(x, y, z, q, r) {
    const color = pick([0x00aacc, 0x0088aa, 0x00bbdd], q * 100 + r);
    const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.15, flatShading: true });
    const geo = new THREE.CylinderGeometry(0.007, 0.007, 0.1, 4);
    const g = new THREE.Group();
    for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
            const stalk = new THREE.Mesh(geo, mat);
            stalk.position.set(i * 0.11, 0.05, j * 0.11);
            stalk.rotation.x = (hash(i * 10 + q, j + r) - 0.5) * 0.15;
            stalk.rotation.z = (hash(i, j * 10 + r) - 0.5) * 0.15;
            g.add(stalk);
        }
    }
    g.position.set(x, y, z);
    scene.add(g);
}

// ────────────────────────────────────────────────────────────────
//  CHARACTERS
// ────────────────────────────────────────────────────────────────
function spawnCharacter(agentIdx, startQ, startR) {
    const agent = AGENTS[agentIdx];
    const g = new THREE.Group();
    const skinCol = pick(PAL.skin, agentIdx * 100);

    // body
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.075, 0.2, 8),
        new THREE.MeshLambertMaterial({ color: agent.color, flatShading: true })
    );
    body.position.set(0, 0.1, 0);
    g.add(body);

    // head
    const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 8, 6),
        new THREE.MeshLambertMaterial({ color: skinCol, flatShading: true })
    );
    head.position.set(0, 0.26, 0);
    g.add(head);

    // helmet visor
    const hat = new THREE.Mesh(
        new THREE.SphereGeometry(0.065, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: agent.color, emissive: agent.color, emissiveIntensity: 0.2, flatShading: true, transparent: true, opacity: 0.7 })
    );
    hat.position.set(0, 0.32, 0);
    g.add(hat);

    // eyes
    const eyeW = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeP = new THREE.MeshBasicMaterial({ color: 0x333333 });
    [-0.02, 0.02].forEach(dx => {
        const white = new THREE.Mesh(new THREE.SphereGeometry(0.013, 5, 4), eyeW);
        white.position.set(dx, 0.27, 0.055);
        g.add(white);
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.007, 5, 4), eyeP);
        pupil.position.set(dx, 0.27, 0.065);
        g.add(pupil);
    });

    g.castShadow = true;
    const startPos = hexToWorld(startQ, startR);
    const startHex = hexData.find(h => h.q === startQ && h.r === startR);
    const baseY = startHex ? startHex.topY : 0.2;
    g.position.set(startPos.x, baseY, startPos.z);
    scene.add(g);

    characters.push({
        mesh: g, agentIdx,
        curQ: startQ, curR: startR,
        tgtQ: null, tgtR: null,
        progress: 0,
        speed: 0.12 + hash(agentIdx * 777, 42) * 0.08,
        wait: 0,
        startPos: { x: startPos.x, z: startPos.z },
        endPos: null,
        baseY,
    });
}

function updateCharacters(dt, t) {
    characters.forEach(ch => {
        if (ch.wait > 0) { ch.wait -= dt; return; }

        // pick new target (prefer own territory)
        if (ch.tgtQ === null) {
            const nearby = hexData.filter(h => {
                const d = hexDist(h.q, h.r, ch.curQ, ch.curR);
                return d > 0 && d <= 2 && h.terrain !== 'water';
            });
            if (!nearby.length) return;
            const ownTiles = nearby.filter(h => h.owner === ch.agentIdx);
            const pool = ownTiles.length > 0 && Math.random() < 0.8 ? ownTiles : nearby;
            const tgt = pool[Math.floor(Math.random() * pool.length)];
            ch.tgtQ = tgt.q;  ch.tgtR = tgt.r;
            ch.progress = 0;
            const tp = hexToWorld(tgt.q, tgt.r);
            ch.startPos = { x: ch.mesh.position.x, z: ch.mesh.position.z };
            ch.endPos = { x: tp.x, z: tp.z };
            ch.baseY = tgt.topY;
            const dx = ch.endPos.x - ch.startPos.x;
            const dz = ch.endPos.z - ch.startPos.z;
            ch.mesh.rotation.y = Math.atan2(dx, dz);
        }

        ch.progress += dt * ch.speed;
        if (ch.progress >= 1) {
            ch.curQ = ch.tgtQ; ch.curR = ch.tgtR;
            ch.tgtQ = null; ch.tgtR = null;
            ch.wait = 1.5 + Math.random() * 3;
        } else {
            const p = ch.progress;
            ch.mesh.position.x = lerp(ch.startPos.x, ch.endPos.x, p);
            ch.mesh.position.z = lerp(ch.startPos.z, ch.endPos.z, p);
            ch.mesh.position.y = ch.baseY + Math.sin(p * Math.PI * 6) * 0.018;
        }
    });
}

// ────────────────────────────────────────────────────────────────
//  SMOKE PARTICLES
// ────────────────────────────────────────────────────────────────
function spawnSmoke(x, y, z) {
    for (let i = 0; i < 4; i++) {
        const p = new THREE.Mesh(
            new THREE.SphereGeometry(0.018 + Math.random() * 0.015, 5, 4),
            new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.35 })
        );
        p.position.set(x, y + Math.random() * 0.2, z);
        p.userData = {
            baseX: x, baseZ: z, startY: y,
            speed: 0.06 + Math.random() * 0.08,
            maxH: 0.5 + Math.random() * 0.3,
            phase: Math.random() * Math.PI * 2,
        };
        scene.add(p);
        smokeParticles.push(p);
    }
}

function updateSmoke(dt) {
    smokeParticles.forEach(p => {
        const u = p.userData;
        p.position.y += u.speed * dt;
        p.position.x = u.baseX + Math.sin(p.position.y * 3 + u.phase) * 0.025;
        p.position.z = u.baseZ + Math.cos(p.position.y * 2.5 + u.phase) * 0.02;
        const h = p.position.y - u.startY;
        p.material.opacity = Math.max(0, 0.35 * (1 - h / u.maxH));
        p.scale.setScalar(1 + h * 1.5);
        if (h > u.maxH) { p.position.y = u.startY; p.material.opacity = 0.35; p.scale.setScalar(1); }
    });
}

// ────────────────────────────────────────────────────────────────
//  POPULATE THE WORLD
// ────────────────────────────────────────────────────────────────
function populateWorld() {
    hexData.forEach(hex => {
        const { q, r, terrain, topY } = hex;
        const pos = hexToWorld(q, r);
        const h = hash(q * 6151, r * 5087);

        if (terrain === 'village') {
            if (q === 0 && r === 0) {
                createWell(pos.x, topY, pos.z);
            } else if (h < 0.12) {
                createWindmill(pos.x, topY, pos.z);
            } else if (h < 0.30) {
                createMarket(pos.x, topY, pos.z);
            } else {
                createCottage(pos.x, topY, pos.z);
            }
        }

        if (terrain === 'forest') {
            const count = 1 + Math.floor(h * 3);
            for (let i = 0; i < count; i++) {
                const ox = (hash(q * 100, r * 200 + i) - 0.5) * 0.45;
                const oz = (hash(q * 300, r * 400 + i) - 0.5) * 0.45;
                const s  = 0.7 + hash(q * 500, i) * 0.5;
                (hash(q + r * 10, i) < 0.5)
                    ? createPineTree(pos.x + ox, topY, pos.z + oz, s)
                    : createRoundTree(pos.x + ox, topY, pos.z + oz, s);
            }
        }

        if (terrain === 'grass') {
            if (h < 0.18) {
                createRoundTree(pos.x + (h - 0.09) * 2, topY, pos.z, 0.5 + h * 2);
            } else if (h < 0.35) {
                createBush(pos.x, topY, pos.z);
            }
            if (h > 0.6) createFlowers(pos.x, topY, pos.z);
        }

        if (terrain === 'farmland') {
            createCrops(pos.x, topY, pos.z, q, r);
            if (h < 0.15) createBush(pos.x + 0.35, topY, pos.z + 0.3);
        }

        if (terrain === 'path' && h < 0.08) {
            createBush(pos.x + 0.3, topY, pos.z - 0.3);
        }
    });

    // bridge over the water (rough placement)
    const bridgeWater = hexData.find(h => h.terrain === 'water' && h.q === 4 && h.r === 2);
    if (bridgeWater) {
        const bp = hexToWorld(bridgeWater.q, bridgeWater.r);
        createBridge(bp.x, bridgeWater.topY + 0.04, bp.z, Math.PI / 3);
    }
}

// ────────────────────────────────────────────────────────────────
//  TILE SELECTION (click → highlight + update UI)
// ────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();
let selectionRing = null;

function setupInteraction() {
    renderer.domElement.addEventListener('pointerdown', onPointer);
}

function onPointer(e) {
    mouse.x =  (e.clientX / window.innerWidth)  *  2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) *  2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(hexData.map(h => h.mesh));
    if (!hits.length) return;
    const tile = hexData.find(h => h.mesh === hits[0].object);
    if (tile) selectTile(tile);
}

function selectTile(tile) {
    if (selectionRing) scene.remove(selectionRing);
    const ringGeo = new THREE.TorusGeometry(HEX_SIZE * 0.82, 0.03, 6, 6);
    ringGeo.rotateX(Math.PI / 2);
    selectionRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xFFD700 }));
    const pos = hexToWorld(tile.q, tile.r);
    selectionRing.position.set(pos.x, tile.topY + 0.02, pos.z);
    scene.add(selectionRing);

    // update UI panel
    const info = document.getElementById('tile-info');
    if (!info) return;
    const ownerName = tile.owner !== undefined ? AGENTS[tile.owner].name : 'Unclaimed';
    const typeLabel = tile.terrain.charAt(0).toUpperCase() + tile.terrain.slice(1);
    const emoji = { village: '🏡', forest: '🌲', farmland: '🌾', water: '💧', grass: '🌿', path: '🛤️' }[tile.terrain] || '📍';
    info.innerHTML = `
        <h3>${emoji} Tile (${tile.q}, ${tile.r})</h3>
        <p>Type: ${typeLabel}</p>
        <p>Owner: ${ownerName}</p>
    `;
}

// ────────────────────────────────────────────────────────────────
//  WATER ANIMATION
// ────────────────────────────────────────────────────────────────
function animateWater(t) {
    waterMeshes.forEach((m, i) => {
        m.position.y = m.userData.baseY + Math.sin(t * 1.8 + i * 0.7) * 0.012;
        m.material.opacity = 0.72 + Math.sin(t * 1.2 + i * 0.5) * 0.06;
    });
}

// ────────────────────────────────────────────────────────────────
//  MINIMAP
// ────────────────────────────────────────────────────────────────
let minimapRenderer, minimapCtx, minimapViewIndicator;

function setupMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    if (!canvas) return;

    // Use a separate WebGL renderer for the minimap
    minimapRenderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    minimapRenderer.setSize(400, 400);  // internal resolution
    minimapRenderer.setPixelRatio(1);
    minimapRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    minimapRenderer.toneMappingExposure = 1.3;

    // Create a 2D overlay canvas for the viewport indicator
    const container = canvas.parentElement;
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'minimap-overlay';
    overlayCanvas.width = 400;
    overlayCanvas.height = 400;
    overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;border-radius:12px;';
    container.appendChild(overlayCanvas);
    minimapCtx = overlayCanvas.getContext('2d');
}

function renderMinimap() {
    if (!minimapRenderer) return;

    // Disable fog for clean minimap view
    const savedFog = scene.fog;
    scene.fog = null;

    minimapRenderer.render(scene, minimapCamera);

    scene.fog = savedFog;

    // Draw viewport indicator on overlay
    drawViewportIndicator();
}

function drawViewportIndicator() {
    if (!minimapCtx) return;
    const w = 400, h = 400;
    minimapCtx.clearRect(0, 0, w, h);

    // Project the camera's look-at target to minimap coords
    const target = controls.target;
    const mapExtent = 30;

    // Convert world XZ to minimap pixel coords
    const cx = ((target.x + mapExtent) / (2 * mapExtent)) * w;
    const cy = ((target.z + mapExtent) / (2 * mapExtent)) * h;

    // Estimate visible area based on camera distance
    const dist = camera.position.distanceTo(target);
    const fovRad = (camera.fov * Math.PI) / 180;
    const visibleH = 2 * Math.tan(fovRad / 2) * dist;
    const visibleW = visibleH * camera.aspect;

    // Scale to minimap pixels
    const rw = (visibleW / (2 * mapExtent)) * w * 0.35;
    const rh = (visibleH / (2 * mapExtent)) * h * 0.35;

    // Draw the viewport rectangle
    minimapCtx.save();
    minimapCtx.translate(cx, cy);

    // Rotate to match camera orientation
    const camAngle = Math.atan2(
        camera.position.x - target.x,
        camera.position.z - target.z
    );
    minimapCtx.rotate(-camAngle);

    minimapCtx.strokeStyle = 'rgba(255, 215, 0, 0.9)';
    minimapCtx.lineWidth = 2.5;
    minimapCtx.shadowColor = 'rgba(255, 215, 0, 0.4)';
    minimapCtx.shadowBlur = 6;
    minimapCtx.strokeRect(-rw / 2, -rh / 2, rw, rh);

    // Center dot
    minimapCtx.fillStyle = 'rgba(255, 215, 0, 0.9)';
    minimapCtx.beginPath();
    minimapCtx.arc(0, 0, 3, 0, Math.PI * 2);
    minimapCtx.fill();

    minimapCtx.restore();
}

// ────────────────────────────────────────────────────────────────
//  RESIZE
// ────────────────────────────────────────────────────────────────
function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ────────────────────────────────────────────────────────────────
//  ANIMATION LOOP
// ────────────────────────────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t  = clock.getElapsedTime();

    controls.update();

    // windmill blades
    windmills.forEach(w => { w.blades.rotation.z -= dt * 0.7; });

    // characters
    updateCharacters(dt, t);

    // smoke
    updateSmoke(dt);

    // water
    animateWater(t);

    // clouds
    clouds.forEach(c => {
        c.position.x += c.userData.speed * dt * 10;
        if (c.position.x > 50) c.position.x = -50;
    });

    // selection ring gentle pulse
    if (selectionRing) {
        selectionRing.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
    }

    renderer.render(scene, camera);

    // minimap (render every ~3 frames to save perf)
    if (Math.floor(t * 60) % 3 === 0) {
        renderMinimap();
    }
}

// ────────────────────────────────────────────────────────────────
//  INIT
// ────────────────────────────────────────────────────────────────
(function init() {
    initScene();
    createLighting();
    createSky();
    createGround();
    createClouds();
    generateTerritory();
    createHexTiles();
    populateWorld();

    // Territory borders (palisade walls)
    const frontierSet = createTerritoryBorders();

    // Watchtowers on ~15% of frontier tiles
    hexData.forEach(hex => {
        if (!frontierSet.has(`${hex.q},${hex.r}`)) return;
        if (hex.terrain === 'water' || hex.terrain === 'village') return;
        if (hash(hex.q * 4001, hex.r * 5003) < 0.15) {
            const pos = hexToWorld(hex.q, hex.r);
            createWatchtower(pos.x, hex.topY, pos.z, AGENTS[hex.owner].color);
        }
    });

    // Spawn 2 characters per faction (patrolling their territory)
    AGENTS.forEach((agent, idx) => {
        const cap = CAPITALS[idx];
        spawnCharacter(idx, cap.q, cap.r);
        const nearby = hexData.find(h =>
            h.owner === idx && !(h.q === cap.q && h.r === cap.r) && h.terrain !== 'water'
        );
        if (nearby) spawnCharacter(idx, nearby.q, nearby.r);
    });

    setupInteraction();
    setupMinimap();
    window.addEventListener('resize', onResize);

    // hide loading screen
    requestAnimationFrame(() => {
        const el = document.getElementById('loading');
        if (el) el.classList.add('hidden');
    });

    animate();
})();
