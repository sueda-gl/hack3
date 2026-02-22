// ================================================================
//  CLAWQUEST — Stellaris-style Galaxy Map Prototype
//  Node-based star systems, hyperlane network, territory nebulae
//  Pure visual exploration — no backend integration
// ================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ────────────────────────────────────────────────────────────────
//  CONFIG
// ────────────────────────────────────────────────────────────────
const SYSTEM_COUNT   = 85;
const GALAXY_RADIUS  = 18;
const WORLD_SIZE     = 45;    // territory texture covers ±22.5
const HYPERLANE_MAX  = 5.5;   // max distance for a hyperlane
const TERRITORY_RES  = 512;   // territory texture resolution

// ────────────────────────────────────────────────────────────────
//  STAR TYPES
// ────────────────────────────────────────────────────────────────
const STAR_TYPES = {
    yellow:  { color: 0xFFE566, size: 0.30, label: 'Yellow Dwarf'  },
    blue:    { color: 0x6699FF, size: 0.36, label: 'Blue Giant'    },
    red:     { color: 0xFF7755, size: 0.26, label: 'Red Dwarf'     },
    white:   { color: 0xDDEEFF, size: 0.28, label: 'White Star'    },
    orange:  { color: 0xFFBB55, size: 0.32, label: 'Orange Star'   },
    binary:  { color: 0xBBDDFF, size: 0.38, label: 'Binary System' },
};
const STAR_TYPE_KEYS = Object.keys(STAR_TYPES);

// ────────────────────────────────────────────────────────────────
//  AGENTS
// ────────────────────────────────────────────────────────────────
const AGENTS = [
    { id: 0, name: "Su'Claw Empire",   color: 0xe74c3c, count: 7 },
    { id: 1, name: "Hexwitch Domain",  color: 0x9b59b6, count: 4 },
    { id: 2, name: "Sol Patch League", color: 0x2ecc71, count: 3 },
];

// ────────────────────────────────────────────────────────────────
//  STAR NAMES
// ────────────────────────────────────────────────────────────────
const STAR_NAMES = [
    'Sol Prime','Sirius','Rigel','Vega','Altair','Deneb','Polaris','Arcturus',
    'Capella','Aldebaran','Antares','Spica','Procyon','Betelgeuse','Fomalhaut',
    'Regulus','Canopus','Achernar','Castor','Pollux','Bellatrix','Mira','Shaula',
    'Nexus','Haven','Forge','Sentinel','Bastion','Citadel','Pinnacle','Meridian',
    'Aegis','Horizon','Zenith','Nadir','Eclipse','Aurora','Tempest','Solace',
    'Beacon','Requiem','Dominion','Sanctuary','Vanguard','Crescent','Helix','Nova',
    'Alpha Cygni','Beta Hydri','Gamma Vel','Delta Pav','Epsilon Eri','Zeta Pup',
    'Eta Car','Theta Per','Iota Ori','Kappa Cru','Lambda Sco','Mu Cep',
    'Kepler-7','Kepler-22','Kepler-62','Kepler-186','Kepler-442',
    'Gliese 581','Wolf 359','Ross 128','Lalande 298','Barnard',
    'Serpent Gate','Void Edge','Crown Nebula','Phoenix Rise','Dragon Reach',
    'Obsidian','Wraith Veil','Crimson Eye','Iron Forge','Amber Drift',
    'Starfall','Deep Watch','Silver Wake','Ghost Light','Ember Throne',
    'Frost Arc','Titan\'s Maw','Crystal Shard','Hollow Sun','Dark Meridian',
];

// ────────────────────────────────────────────────────────────────
//  GLOBALS
// ────────────────────────────────────────────────────────────────
let scene, camera, renderer, controls, clock;
let starSystems = [];    // { x, z, name, type, owner, isCapital, index, ... }
let hyperlanes  = [];    // [indexA, indexB]
const fleets    = [];
const systemMeshes = []; // THREE.Group per system (for raycasting)
let selectionRing = null;
let glowTex = null;

// ────────────────────────────────────────────────────────────────
//  UTILITIES
// ────────────────────────────────────────────────────────────────
function dist2D(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2); }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

// ────────────────────────────────────────────────────────────────
//  GALAXY GENERATION
// ────────────────────────────────────────────────────────────────
function generateGalaxy() {
    const names = shuffle([...STAR_NAMES]);
    const systems = [];
    let attempts = 0;

    while (systems.length < SYSTEM_COUNT && attempts < 5000) {
        attempts++;
        // spiral-disc distribution (3 arms)
        const arm = Math.floor(Math.random() * 3);
        const armAngle = (arm / 3) * Math.PI * 2;
        const r = Math.pow(Math.random(), 0.55) * GALAXY_RADIUS;
        const angle = armAngle + r * 0.25 + (Math.random() - 0.5) * 1.4;
        const x = r * Math.cos(angle) + (Math.random() - 0.5) * 1.8;
        const z = r * Math.sin(angle) + (Math.random() - 0.5) * 1.8;

        // min separation
        if (systems.some(s => dist2D(s, { x, z }) < 1.6)) continue;

        systems.push({
            x, z, index: systems.length,
            name: names[systems.length] || `SYS-${systems.length}`,
            type: STAR_TYPE_KEYS[Math.floor(Math.random() * STAR_TYPE_KEYS.length)],
            owner: undefined,
            isCapital: false,
            resources: Math.random() < 0.3 ? 'food' : Math.random() < 0.5 ? 'metal' : 'none',
            defense: Math.floor(Math.random() * 12),
        });
    }
    return systems;
}

// ── hyperlane graph ──
function generateHyperlanes(systems) {
    const edgeSet = new Set();
    const k = 3;
    systems.forEach((s, i) => {
        const sorted = systems
            .map((o, j) => ({ j, d: dist2D(s, o) }))
            .filter(d => d.j !== i)
            .sort((a, b) => a.d - b.d)
            .slice(0, k);
        sorted.forEach(({ j, d }) => {
            if (d < HYPERLANE_MAX) edgeSet.add(`${Math.min(i, j)}-${Math.max(i, j)}`);
        });
    });
    return [...edgeSet].map(k => k.split('-').map(Number));
}

// ── territory assignment ──
function assignTerritory(systems) {
    // pick 3 well-separated seeds
    const seeds = [Math.floor(Math.random() * systems.length)];
    // 2nd seed: farthest from 1st
    let best = 0, bestD = 0;
    systems.forEach((s, i) => { const d = dist2D(s, systems[seeds[0]]); if (d > bestD) { bestD = d; best = i; } });
    seeds.push(best);
    // 3rd seed: farthest from both
    bestD = 0;
    systems.forEach((s, i) => {
        const d = Math.min(dist2D(s, systems[seeds[0]]), dist2D(s, systems[seeds[1]]));
        if (d > bestD) { bestD = d; best = i; }
    });
    seeds.push(best);

    seeds.forEach((idx, ai) => { systems[idx].owner = ai; systems[idx].isCapital = true; });

    // expand outward
    AGENTS.forEach((agent, ai) => {
        let claimed = 1;
        while (claimed < agent.count) {
            let bDist = Infinity, bIdx = -1;
            systems.forEach((cand, ci) => {
                if (cand.owner !== undefined) return;
                systems.forEach(own => {
                    if (own.owner !== ai) return;
                    const d = dist2D(cand, own);
                    if (d < bDist) { bDist = d; bIdx = ci; }
                });
            });
            if (bIdx < 0) break;
            systems[bIdx].owner = ai;
            claimed++;
        }
    });
}

// ────────────────────────────────────────────────────────────────
//  TEXTURES (procedural)
// ────────────────────────────────────────────────────────────────
function getGlowTexture() {
    if (glowTex) return glowTex;
    const s = 128, c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s/2,s/2,0, s/2,s/2,s/2);
    g.addColorStop(0,   'rgba(255,255,255,1)');
    g.addColorStop(0.08,'rgba(255,255,255,0.85)');
    g.addColorStop(0.25,'rgba(255,255,255,0.2)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.03)');
    g.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,s,s);
    glowTex = new THREE.CanvasTexture(c);
    return glowTex;
}

function createStarLabel(name, color) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.font = '14px "Share Tech Mono", monospace';
    ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 16);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.65 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.2, 0.28, 1);
    return sprite;
}

// ────────────────────────────────────────────────────────────────
//  SCENE SETUP
// ────────────────────────────────────────────────────────────────
function initScene() {
    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040810);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
    camera.position.set(0, 28, 20);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 8;
    controls.maxDistance = 55;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.minPolarAngle = Math.PI / 7;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.12;
    controls.target.set(0, 0, 0);

    clock = new THREE.Clock();
    scene.add(new THREE.AmbientLight(0x223344, 0.4));
}

// ────────────────────────────────────────────────────────────────
//  BACKGROUND STARFIELD
// ────────────────────────────────────────────────────────────────
function createStarfield() {
    const n = 4000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        pos[i*3]   = (Math.random() - 0.5) * 140;
        pos[i*3+1] = -2 - Math.random() * 8;
        pos[i*3+2] = (Math.random() - 0.5) * 140;
        const b = 0.25 + Math.random() * 0.6;
        col[i*3] = b * (0.85 + Math.random()*0.15);
        col[i*3+1] = b * (0.85 + Math.random()*0.15);
        col[i*3+2] = b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
        vertexColors: true, size: 0.06, sizeAttenuation: true,
        transparent: true, opacity: 0.85, depthWrite: false,
    })));
}

// ────────────────────────────────────────────────────────────────
//  NEBULAE (background gas clouds)
// ────────────────────────────────────────────────────────────────
function createNebulae() {
    const configs = [
        { x: -8,  z: -6,  color: 0x2c1654, size: 22, opacity: 0.10 },
        { x:  10, z:  5,  color: 0x1a3350, size: 18, opacity: 0.08 },
        { x:  -4, z:  10, color: 0x3a1a1a, size: 20, opacity: 0.07 },
        { x:  6,  z: -10, color: 0x0a2a2a, size: 16, opacity: 0.06 },
        { x:  0,  z:  0,  color: 0x101830, size: 28, opacity: 0.05 },
    ];
    configs.forEach(cfg => {
        const s = 256, c = document.createElement('canvas');
        c.width = s; c.height = s;
        const ctx = c.getContext('2d');
        const col = new THREE.Color(cfg.color);
        const g = ctx.createRadialGradient(s/2,s/2,0, s/2,s/2,s/2);
        g.addColorStop(0,   `rgba(${col.r*255|0},${col.g*255|0},${col.b*255|0},${cfg.opacity})`);
        g.addColorStop(0.5, `rgba(${col.r*255|0},${col.g*255|0},${col.b*255|0},${cfg.opacity*0.3})`);
        g.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0,0,s,s);
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(cfg.size, cfg.size),
            new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, side: THREE.DoubleSide })
        );
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(cfg.x, -1.8, cfg.z);
        scene.add(plane);
    });
}

// ────────────────────────────────────────────────────────────────
//  TERRITORY TEXTURE (Voronoi-based with falloff)
// ────────────────────────────────────────────────────────────────
function createTerritory(systems) {
    const owned = systems.filter(s => s.owner !== undefined);
    if (!owned.length) return;

    const s = TERRITORY_RES;
    const canvas = document.createElement('canvas');
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(s, s);
    const data = img.data;

    for (let py = 0; py < s; py++) {
        for (let px = 0; px < s; px++) {
            const wx = (px / s - 0.5) * WORLD_SIZE;
            const wz = (py / s - 0.5) * WORLD_SIZE;

            let bDist = Infinity, bOwner = -1;
            for (const sys of owned) {
                const d = Math.sqrt((wx - sys.x) ** 2 + (wz - sys.z) ** 2);
                if (d < bDist) { bDist = d; bOwner = sys.owner; }
            }

            const maxR = 7;
            if (bOwner >= 0 && bDist < maxR) {
                const c = new THREE.Color(AGENTS[bOwner].color);
                const t = bDist / maxR;
                const a = Math.pow(1 - t, 1.6) * 0.26;
                const i = (py * s + px) * 4;
                data[i]   = c.r * 255;
                data[i+1] = c.g * 255;
                data[i+2] = c.b * 255;
                data[i+3] = a * 255;
            }
        }
    }
    ctx.putImageData(img, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.25;
    scene.add(plane);
}

// ────────────────────────────────────────────────────────────────
//  SUBTLE GRID
// ────────────────────────────────────────────────────────────────
function createGrid() {
    const g = new THREE.GridHelper(WORLD_SIZE, 40, 0x0c1828, 0x0a1420);
    g.position.y = -0.3;
    g.material.opacity = 0.12;
    g.material.transparent = true;
    g.material.depthWrite = false;
    scene.add(g);
}

// ────────────────────────────────────────────────────────────────
//  HYPERLANE NETWORK
// ────────────────────────────────────────────────────────────────
function renderHyperlanes(systems, lanes) {
    const positions = [];
    const colors = [];
    lanes.forEach(([a, b]) => {
        const sa = systems[a], sb = systems[b];
        positions.push(sa.x, 0, sa.z, sb.x, 0, sb.z);
        // tint lanes inside territory
        let r = 0.12, g = 0.20, bl = 0.32;
        if (sa.owner !== undefined && sa.owner === sb.owner) {
            const c = new THREE.Color(AGENTS[sa.owner].color);
            r = c.r * 0.3 + 0.08; g = c.g * 0.3 + 0.08; bl = c.b * 0.3 + 0.08;
        }
        colors.push(r, g, bl, r, g, bl);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
    scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false,
    })));
}

// ────────────────────────────────────────────────────────────────
//  STAR SYSTEMS (glow sprite + core + label)
// ────────────────────────────────────────────────────────────────
function renderSystems(systems) {
    const tex = getGlowTexture();
    systems.forEach(sys => {
        const group = new THREE.Group();
        const info = STAR_TYPES[sys.type];

        // glow sprite
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, color: info.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        const gs = info.size * 3;
        glow.scale.set(gs, gs, 1);
        group.add(glow);

        // bright core
        const core = new THREE.Mesh(
            new THREE.SphereGeometry(info.size * 0.18, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        group.add(core);

        // label
        const labelColor = sys.owner !== undefined ? AGENTS[sys.owner].color : 0x506878;
        const label = createStarLabel(sys.name, labelColor);
        label.position.y = -0.5;
        group.add(label);

        // capital ring
        if (sys.isCapital) {
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(0.4, 0.025, 8, 24),
                new THREE.MeshBasicMaterial({ color: AGENTS[sys.owner].color, transparent: true, opacity: 0.7 })
            );
            ring.rotation.x = Math.PI / 2;
            group.add(ring);
        }

        // ownership indicator (small dot under star)
        if (sys.owner !== undefined && !sys.isCapital) {
            const dot = new THREE.Mesh(
                new THREE.CircleGeometry(0.08, 8),
                new THREE.MeshBasicMaterial({ color: AGENTS[sys.owner].color, side: THREE.DoubleSide })
            );
            dot.rotation.x = -Math.PI / 2;
            dot.position.y = -0.25;
            group.add(dot);
        }

        group.position.set(sys.x, 0.05, sys.z);
        group.userData = { systemIndex: sys.index };
        scene.add(group);
        systemMeshes.push(group);
    });
}

// ────────────────────────────────────────────────────────────────
//  FLEET SHIPS
// ────────────────────────────────────────────────────────────────
function createFleets(systems, lanes) {
    // adjacency list
    const adj = new Map();
    systems.forEach((_, i) => adj.set(i, []));
    lanes.forEach(([a, b]) => { adj.get(a).push(b); adj.get(b).push(a); });

    AGENTS.forEach((agent, ai) => {
        const owned = systems.filter(s => s.owner === ai);
        if (!owned.length) return;

        for (let f = 0; f < 2; f++) {
            const start = owned[Math.floor(Math.random() * owned.length)];

            // triangle ship shape
            const shape = new THREE.Shape();
            shape.moveTo(0, 0.14);
            shape.lineTo(0.065, -0.07);
            shape.lineTo(0, -0.02);
            shape.lineTo(-0.065, -0.07);
            shape.closePath();
            const geo = new THREE.ShapeGeometry(shape);
            geo.rotateX(-Math.PI / 2);
            const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
                color: agent.color, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
            }));
            mesh.position.set(start.x, 0.2, start.z);
            scene.add(mesh);

            // engine glow trail
            const trail = new THREE.Sprite(new THREE.SpriteMaterial({
                map: getGlowTexture(), color: agent.color,
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            }));
            trail.scale.set(0.25, 0.25, 1);
            trail.position.y = -0.08;
            mesh.add(trail);

            fleets.push({
                mesh, agentIdx: ai,
                curSys: start.index,
                tgtSys: null,
                progress: 0,
                speed: 0.06 + Math.random() * 0.04,
                wait: Math.random() * 3,
                startPos: { x: start.x, z: start.z },
                endPos: null,
                adj,
            });
        }
    });
}

function updateFleets(dt) {
    fleets.forEach(fl => {
        if (fl.wait > 0) { fl.wait -= dt; return; }

        if (fl.tgtSys === null) {
            const neighbors = fl.adj.get(fl.curSys) || [];
            if (!neighbors.length) return;
            fl.tgtSys = neighbors[Math.floor(Math.random() * neighbors.length)];
            fl.progress = 0;
            const tgt = starSystems[fl.tgtSys];
            fl.startPos = { x: fl.mesh.position.x, z: fl.mesh.position.z };
            fl.endPos = { x: tgt.x, z: tgt.z };
            // face direction
            const dx = fl.endPos.x - fl.startPos.x;
            const dz = fl.endPos.z - fl.startPos.z;
            fl.mesh.rotation.y = -Math.atan2(dx, dz);
        }

        fl.progress += dt * fl.speed;
        if (fl.progress >= 1) {
            fl.curSys = fl.tgtSys;
            fl.tgtSys = null;
            fl.wait = 1.5 + Math.random() * 4;
        } else {
            fl.mesh.position.x = fl.startPos.x + (fl.endPos.x - fl.startPos.x) * fl.progress;
            fl.mesh.position.z = fl.startPos.z + (fl.endPos.z - fl.startPos.z) * fl.progress;
        }
    });
}

// ────────────────────────────────────────────────────────────────
//  INTERACTION (click → select system)
// ────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
raycaster.params.Points = { threshold: 0.5 };

function setupInteraction() {
    renderer.domElement.addEventListener('pointerdown', e => {
        mouse.x =  (e.clientX / window.innerWidth)  *  2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) *  2 + 1;
        raycaster.setFromCamera(mouse, camera);

        // test against system groups (check children)
        let closest = null, closestDist = Infinity;
        systemMeshes.forEach(grp => {
            const hits = raycaster.intersectObjects(grp.children, true);
            if (hits.length && hits[0].distance < closestDist) {
                closestDist = hits[0].distance;
                closest = grp;
            }
        });
        if (closest) selectSystem(closest.userData.systemIndex);
    });
}

function selectSystem(idx) {
    const sys = starSystems[idx];
    if (!sys) return;

    // selection ring
    if (selectionRing) scene.remove(selectionRing);
    selectionRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.02, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0x4488cc, transparent: true, opacity: 0.8 })
    );
    selectionRing.rotation.x = Math.PI / 2;
    selectionRing.position.set(sys.x, 0.05, sys.z);
    scene.add(selectionRing);

    // update UI
    const panel = document.getElementById('sys-detail');
    if (!panel) return;
    const info = STAR_TYPES[sys.type];
    const ownerName = sys.owner !== undefined ? AGENTS[sys.owner].name : 'Unclaimed';
    const ownerClass = sys.owner !== undefined ? ' owned' : '';
    const resourceLabel = sys.resources === 'food' ? '+10 Food/tick' : sys.resources === 'metal' ? '+10 Metal/tick' : 'None';
    panel.innerHTML = `
        <div class="sys-name">${sys.isCapital ? '★ ' : ''}${sys.name}</div>
        <div class="sys-row"><span class="sys-label">Class</span><span class="sys-val">${info.label}</span></div>
        <div class="sys-row"><span class="sys-label">Owner</span><span class="sys-val${ownerClass}">${ownerName}</span></div>
        <div class="sys-row"><span class="sys-label">Resources</span><span class="sys-val">${resourceLabel}</span></div>
        <div class="sys-row"><span class="sys-label">Defense</span><span class="sys-val">${sys.defense}</span></div>
        <div class="sys-row"><span class="sys-label">Coords</span><span class="sys-val">(${sys.x.toFixed(1)}, ${sys.z.toFixed(1)})</span></div>
    `;
}

// ────────────────────────────────────────────────────────────────
//  AMBIENT PARTICLES (slow-drifting dust)
// ────────────────────────────────────────────────────────────────
let dustParticles;
function createDust() {
    const n = 600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        pos[i*3]   = (Math.random()-0.5) * 50;
        pos[i*3+1] = (Math.random()-0.5) * 3 - 1;
        pos[i*3+2] = (Math.random()-0.5) * 50;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    dustParticles = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0x334466, size: 0.04, sizeAttenuation: true,
        transparent: true, opacity: 0.35, depthWrite: false,
    }));
    scene.add(dustParticles);
}

// ────────────────────────────────────────────────────────────────
//  UPDATE STATS UI
// ────────────────────────────────────────────────────────────────
function updateStats() {
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    el('stat-total', starSystems.length);
    el('stat-claimed', starSystems.filter(s => s.owner !== undefined).length);
    el('stat-lanes', hyperlanes.length);
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
    updateFleets(dt);

    // pulse stars
    systemMeshes.forEach((grp, i) => {
        const sprite = grp.children[0]; // glow sprite
        if (sprite && sprite.isSprite) {
            const base = sprite.scale.x;
            const pulse = 1 + Math.sin(t * 1.5 + i * 0.7) * 0.06;
            sprite.scale.setScalar(base > 0 ? (STAR_TYPES[starSystems[i]?.type]?.size ?? 0.3) * 3 * pulse : 1);
        }
    });

    // selection ring pulse
    if (selectionRing) {
        selectionRing.material.opacity = 0.55 + Math.sin(t * 3) * 0.25;
        selectionRing.rotation.z = t * 0.3;
    }

    // drift dust
    if (dustParticles) {
        const pos = dustParticles.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            pos.setX(i, pos.getX(i) + Math.sin(t * 0.2 + i) * 0.001);
            pos.setZ(i, pos.getZ(i) + Math.cos(t * 0.15 + i * 0.5) * 0.001);
        }
        pos.needsUpdate = true;
    }

    renderer.render(scene, camera);
}

// ────────────────────────────────────────────────────────────────
//  INIT
// ────────────────────────────────────────────────────────────────
(function init() {
    initScene();

    // generate galaxy
    starSystems = generateGalaxy();
    hyperlanes  = generateHyperlanes(starSystems);
    assignTerritory(starSystems);

    // build scene
    createStarfield();
    createNebulae();
    createGrid();
    createTerritory(starSystems);
    renderHyperlanes(starSystems, hyperlanes);
    renderSystems(starSystems);
    createFleets(starSystems, hyperlanes);
    createDust();

    setupInteraction();
    updateStats();
    window.addEventListener('resize', onResize);

    // hide loading
    requestAnimationFrame(() => {
        const el = document.getElementById('loading');
        if (el) el.classList.add('hidden');
    });

    animate();
})();
