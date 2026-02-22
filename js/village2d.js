// ================================================================
//  CLAWQUEST — Pixel-Art Village Prototype
//  Top-down tile-based village — Generative Agents / RPG Maker style
//  Agents walk around, chat, show activities & speech bubbles
// ================================================================
'use strict';

// ────────────────────────────────────────────────────────────────
//  CONFIG
// ────────────────────────────────────────────────────────────────
const T         = 16;           // tile size in pixels
const MAP_W     = 56;
const MAP_H     = 42;
const SCALE_MIN = 1.5;
const SCALE_MAX = 4;

// ────────────────────────────────────────────────────────────────
//  PALETTE  (earthy pixel-art colours)
// ────────────────────────────────────────────────────────────────
const C = {
    grass1:'#5daa3a', grass2:'#4e9a30', grass3:'#6ab848', grass4:'#57a436',
    path:  '#d4b888', pathDark:'#c0a070', pathLight:'#e0c898',
    water: '#3898d8', waterDark:'#2880c0', waterLight:'#58b8f0',
    dirt:  '#c8a870', dirtDark:'#b09060',
    sand:  '#e8d8a0',
    bridge:'#a08050',
    fencePost:'#8B6844',
};

// ────────────────────────────────────────────────────────────────
//  AGENTS
// ────────────────────────────────────────────────────────────────
const AGENTS = [
    { id:0, name:"Su'Claw",   color:'#e05040', hair:'#8B2010' },
    { id:1, name:"Hexwitch",  color:'#9060c0', hair:'#4a2070' },
    { id:2, name:"Sol Patch", color:'#40b868', hair:'#1a6030' },
    { id:3, name:"Matidus",   color:'#3898d8', hair:'#1a4870' },
    { id:4, name:"Voidmaw",   color:'#e8a030', hair:'#885010' },
];

const ACTIVITIES = [
    'Checking the market','Patrolling borders','Resting at the tavern',
    'Gathering supplies','Meeting an ally','Inspecting the forge',
    'Walking in the park','Watching the river','Planning next move',
    'Trading resources','Fortifying defenses','Scouting east road',
    'Visiting the library','Collecting intel','Taking a break',
];

const SPEECH_LINES = [
    ["Hey, mind if I join you?","Not at all! How's the eastern front?"],
    ["I heard Voidmaw is planning something.","We should fortify the bridge."],
    ["The market has fresh supplies.","Good, we needed more metal."],
    ["Beautiful day for a patrol.","Stay sharp near the river."],
    ["Any news from the south?","Sol Patch has been quiet lately."],
    ["Want to trade some food for metal?","Sure, how much are you offering?"],
    ["I think we should expand north.","Risky, but the farmland is rich."],
];

// ────────────────────────────────────────────────────────────────
//  BUILDINGS
// ────────────────────────────────────────────────────────────────
const BUILDINGS = [
    { name:"Su'Claw HQ",     x:8,  y:6,  w:7, h:5, roof:'#c45040', wall:'#f0e0cc', doorX:3 },
    { name:"Library",         x:20, y:5,  w:6, h:4, roof:'#5878a0', wall:'#e4e4f0', doorX:3 },
    { name:"Market",          x:22, y:16, w:8, h:5, roof:'#e8a030', wall:'#f5e6d0', doorX:4 },
    { name:"Tavern",          x:6,  y:17, w:6, h:5, roof:'#8c6c4c', wall:'#e8d8c0', doorX:3 },
    { name:"Hexwitch Lodge",  x:38, y:7,  w:7, h:5, roof:'#9060c0', wall:'#e8e0f0', doorX:3 },
    { name:"Sol Patch Camp",  x:10, y:30, w:7, h:5, roof:'#40b868', wall:'#ddf0e0', doorX:3 },
    { name:"Forge",           x:35, y:24, w:5, h:4, roof:'#607080', wall:'#d8d0c8', doorX:2 },
    { name:"Farmhouse",       x:3,  y:28, w:5, h:4, roof:'#a08040', wall:'#f0e8d0', doorX:2 },
    { name:"Watchtower",      x:46, y:16, w:4, h:4, roof:'#888',    wall:'#ccc',    doorX:2 },
    { name:"Cottage",         x:30, y:5,  w:5, h:4, roof:'#608850', wall:'#f0f0e0', doorX:2 },
    { name:"School",          x:20, y:28, w:6, h:4, roof:'#d06060', wall:'#f0e0e0', doorX:3 },
];

// ────────────────────────────────────────────────────────────────
//  MAP DATA   (generated at init)
// ────────────────────────────────────────────────────────────────
const map = [];       // 2D array: 'grass','path','water','dirt','sand','building','bridge'
const decoMap = [];   // 2D array: null or { type, variant }

function genMap() {
    // fill grass
    for (let y = 0; y < MAP_H; y++) {
        map[y] = []; decoMap[y] = [];
        for (let x = 0; x < MAP_W; x++) { map[y][x] = 'grass'; decoMap[y][x] = null; }
    }

    // ── river (curves from top-right to bottom-left) ──
    for (let y = 0; y < MAP_H; y++) {
        const cx = Math.round(42 - y * 0.6 + Math.sin(y * 0.3) * 3);
        for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx;
            if (x >= 0 && x < MAP_W) map[y][x] = 'water';
        }
        // sand banks
        [cx - 2, cx + 2].forEach(sx => { if (sx >= 0 && sx < MAP_W && map[y][sx] === 'grass') map[y][sx] = 'sand'; });
    }

    // ── buildings ──
    BUILDINGS.forEach(b => {
        for (let dy = 0; dy < b.h; dy++)
            for (let dx = 0; dx < b.w; dx++)
                if (b.y+dy < MAP_H && b.x+dx < MAP_W) map[b.y+dy][b.x+dx] = 'building';
    });

    // ── main roads ──
    // horizontal road y=14
    for (let x = 0; x < MAP_W; x++) { setPath(x, 13); setPath(x, 14); }
    // vertical road x=17
    for (let y = 0; y < MAP_H; y++) { setPath(17, y); setPath(18, y); }
    // secondary horizontal y=26
    for (let x = 2; x < 45; x++) { setPath(x, 26); setPath(x, 27); }
    // secondary vertical x=33
    for (let y = 2; y < 38; y++) { setPath(33, y); }
    // branch paths to each building door
    BUILDINGS.forEach(b => {
        const doorTX = b.x + b.doorX;
        const doorTY = b.y + b.h;
        // connect door south until hitting a road
        for (let y = doorTY; y < MAP_H; y++) { setPath(doorTX, y); if (isRoad(doorTX, y + 1)) break; }
        // connect door north
        for (let y = b.y - 1; y >= 0; y--) { setPath(doorTX, y); if (isRoad(doorTX, y - 1)) break; }
    });

    // ── bridge over river on main road ──
    for (let x = 0; x < MAP_W; x++) {
        if (map[13][x] === 'water') { map[13][x] = 'bridge'; map[14][x] = 'bridge'; }
        if (map[26][x] === 'water') { map[26][x] = 'bridge'; map[27][x] = 'bridge'; }
    }

    // ── decorations ──
    for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
            if (map[y][x] !== 'grass') continue;
            const h = hash(x * 7919, y * 6271);
            if (h < 0.08)      decoMap[y][x] = { type: 'tree_round', v: h };
            else if (h < 0.13) decoMap[y][x] = { type: 'tree_pine', v: h };
            else if (h < 0.18) decoMap[y][x] = { type: 'bush', v: h };
            else if (h < 0.23) decoMap[y][x] = { type: 'flowers', v: h };
            else if (h < 0.25) decoMap[y][x] = { type: 'rock', v: h };
        }
    }
    // ── farm plots near Farmhouse ──
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 8; dx++) {
        const fx = 1 + dx, fy = 22 + dy;
        if (fx < MAP_W && fy < MAP_H && map[fy][fx] === 'grass') {
            map[fy][fx] = 'dirt';
            if (hash(fx, fy) < 0.7) decoMap[fy][fx] = { type: 'crop', v: hash(fx*3, fy*5) };
        }
    }
    // ── park area ──
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 5; dx++) {
        const px = 44 + dx, py = 28 + dy;
        if (px < MAP_W && py < MAP_H && map[py][px] === 'grass')
            if (hash(px, py) < 0.3) decoMap[py][px] = { type: 'flowers', v: hash(px, py) };
    }
}

function setPath(x, y) { if (x >= 0 && x < MAP_W && y >= 0 && y < MAP_H && map[y][x] === 'grass') map[y][x] = 'path'; }
function isRoad(x, y) { return x >= 0 && x < MAP_W && y >= 0 && y < MAP_H && (map[y][x] === 'path' || map[y][x] === 'bridge'); }
function hash(a, b) { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); }
function pick(arr, s) { return arr[Math.floor(hash(s, s * 1.7) * arr.length)]; }

// ────────────────────────────────────────────────────────────────
//  CANVAS & CAMERA
// ────────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
let W, H;
let camX = MAP_W * T / 2, camY = MAP_H * T / 2, zoom = 2.2;
let dragging = false, dsx = 0, dsy = 0, csx = 0, csy = 0;

function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }

// ────────────────────────────────────────────────────────────────
//  TILE DRAWING
// ────────────────────────────────────────────────────────────────
function drawTile(x, y) {
    const px = x * T, py = y * T;
    const type = map[y][x];
    const h = hash(x * 31, y * 47);

    switch (type) {
        case 'grass':
            ctx.fillStyle = h < 0.3 ? C.grass1 : h < 0.55 ? C.grass2 : h < 0.8 ? C.grass3 : C.grass4;
            ctx.fillRect(px, py, T, T);
            break;
        case 'path':
            ctx.fillStyle = h < 0.4 ? C.path : h < 0.7 ? C.pathDark : C.pathLight;
            ctx.fillRect(px, py, T, T);
            // subtle edge lines
            ctx.fillStyle = '#00000010';
            if (y > 0 && map[y-1][x] !== 'path' && map[y-1][x] !== 'bridge') ctx.fillRect(px, py, T, 1);
            if (y < MAP_H-1 && map[y+1][x] !== 'path' && map[y+1][x] !== 'bridge') ctx.fillRect(px, py+T-1, T, 1);
            break;
        case 'water':
            ctx.fillStyle = (x + y) % 2 === 0 ? C.water : C.waterDark;
            ctx.fillRect(px, py, T, T);
            break;
        case 'bridge':
            ctx.fillStyle = C.bridge;
            ctx.fillRect(px, py, T, T);
            // planks
            ctx.fillStyle = '#90703a';
            for (let i = 2; i < T; i += 4) ctx.fillRect(px, py + i, T, 1);
            break;
        case 'sand':
            ctx.fillStyle = C.sand;
            ctx.fillRect(px, py, T, T);
            break;
        case 'dirt':
            ctx.fillStyle = h < 0.5 ? C.dirt : C.dirtDark;
            ctx.fillRect(px, py, T, T);
            break;
        case 'building':
            ctx.fillStyle = '#807060'; // floor shadow
            ctx.fillRect(px, py, T, T);
            break;
    }
}

// ────────────────────────────────────────────────────────────────
//  BUILDING DRAWING  (roof + wall face + door + windows + sign)
// ────────────────────────────────────────────────────────────────
function drawBuildings() {
    BUILDINGS.forEach(b => {
        const bx = b.x * T, by = b.y * T;
        const bw = b.w * T, bh = b.h * T;
        const wallH = T * 1.2;

        // shadow
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(bx + 3, by + 3, bw, bh);

        // wall face (bottom strip)
        ctx.fillStyle = b.wall;
        ctx.fillRect(bx, by + bh - wallH, bw, wallH);
        // wall outline
        ctx.strokeStyle = '#00000020';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by + bh - wallH, bw, wallH);

        // roof (top portion)
        ctx.fillStyle = b.roof;
        ctx.fillRect(bx - 2, by, bw + 4, bh - wallH + 4);
        // roof ridge line
        ctx.fillStyle = '#00000015';
        ctx.fillRect(bx - 2, by + (bh - wallH) / 2, bw + 4, 2);

        // door
        const doorPx = (b.x + b.doorX) * T;
        const doorPy = by + bh - wallH;
        ctx.fillStyle = '#8B6844';
        ctx.fillRect(doorPx + 2, doorPy + 2, T - 4, wallH - 2);
        // door handle
        ctx.fillStyle = '#c0a060';
        ctx.fillRect(doorPx + T - 6, doorPy + wallH / 2, 2, 2);

        // windows
        const winColor = '#ffe87c';
        const numWin = Math.floor(b.w / 2);
        for (let i = 0; i < numWin; i++) {
            const wx = bx + (i * 2 + 1) * T + 3;
            if (Math.abs(wx - doorPx) < T) continue;
            ctx.fillStyle = winColor;
            ctx.fillRect(wx, doorPy + 4, T * 0.55, T * 0.4);
            // window frame
            ctx.strokeStyle = '#b0a090';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(wx, doorPy + 4, T * 0.55, T * 0.4);
            // cross
            ctx.fillStyle = '#c0b0a0';
            ctx.fillRect(wx + T * 0.25, doorPy + 4, 1, T * 0.4);
            ctx.fillRect(wx, doorPy + 4 + T * 0.18, T * 0.55, 1);
        }

        // name sign
        ctx.font = 'bold 7px Nunito';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#5b3a1a';
        ctx.fillText(b.name, bx + bw / 2, by - 3);
    });
}

// ────────────────────────────────────────────────────────────────
//  DECORATION DRAWING
// ────────────────────────────────────────────────────────────────
function drawDecorations(t) {
    for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
            const d = decoMap[y][x];
            if (!d) continue;
            const px = x * T + T / 2, py = y * T + T / 2;

            if (d.type === 'tree_round') {
                ctx.fillStyle = '#6a5030'; ctx.fillRect(px - 1, py, 3, 6);
                ctx.fillStyle = '#4a9030'; ctx.beginPath(); ctx.arc(px, py - 2, 6, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#5aa840'; ctx.beginPath(); ctx.arc(px - 2, py - 4, 4, 0, Math.PI * 2); ctx.fill();
            }
            if (d.type === 'tree_pine') {
                ctx.fillStyle = '#6a5030'; ctx.fillRect(px - 1, py + 2, 3, 5);
                ctx.fillStyle = '#2a6a20';
                ctx.beginPath(); ctx.moveTo(px, py - 8); ctx.lineTo(px - 5, py); ctx.lineTo(px + 5, py); ctx.fill();
                ctx.fillStyle = '#3a7a30';
                ctx.beginPath(); ctx.moveTo(px, py - 12); ctx.lineTo(px - 4, py - 4); ctx.lineTo(px + 4, py - 4); ctx.fill();
            }
            if (d.type === 'bush') {
                ctx.fillStyle = '#3a8028';
                ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#4a9038';
                ctx.beginPath(); ctx.arc(px - 2, py - 1, 3, 0, Math.PI * 2); ctx.fill();
            }
            if (d.type === 'flowers') {
                const cols = ['#ff6b6b','#ffd93d','#ff8cc8','#6bcfff','#fff'];
                for (let i = 0; i < 4; i++) {
                    ctx.fillStyle = cols[(Math.floor(d.v * 10) + i) % cols.length];
                    ctx.beginPath();
                    ctx.arc(px + (hash(x + i, y) - 0.5) * 10, py + (hash(y + i, x) - 0.5) * 8, 1.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            if (d.type === 'rock') {
                ctx.fillStyle = '#a0a098';
                ctx.beginPath(); ctx.ellipse(px, py + 2, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#b0b0a8';
                ctx.beginPath(); ctx.ellipse(px - 1, py, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
            }
            if (d.type === 'crop') {
                const sway = Math.sin(t * 1.5 + x * 0.4) * 1;
                ctx.strokeStyle = '#c8a030'; ctx.lineWidth = 1;
                for (let i = -2; i <= 2; i++) {
                    ctx.beginPath(); ctx.moveTo(px + i * 3, py + 4); ctx.lineTo(px + i * 3 + sway, py - 4); ctx.stroke();
                    ctx.fillStyle = '#e8c840';
                    ctx.beginPath(); ctx.arc(px + i * 3 + sway, py - 5, 1.5, 0, Math.PI * 2); ctx.fill();
                }
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────
//  WATER ANIMATION
// ────────────────────────────────────────────────────────────────
function drawWaterShimmer(t) {
    ctx.globalAlpha = 0.12;
    for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
            if (map[y][x] !== 'water') continue;
            ctx.fillStyle = C.waterLight;
            const sx = Math.sin(t * 1.5 + y * 0.5 + x * 0.3) * 3;
            ctx.beginPath();
            ctx.ellipse(x * T + T / 2 + sx, y * T + T / 2, 5, 2, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.globalAlpha = 1;
}

// ────────────────────────────────────────────────────────────────
//  AGENT CHARACTERS
// ────────────────────────────────────────────────────────────────
const agentState = [];

function initAgents() {
    const spawns = [
        { q: 11, r: 12 }, { q: 41, r: 13 }, { q: 13, r: 32 },
        { q: 22, r: 22 }, { q: 35, r: 26 },
    ];
    AGENTS.forEach((a, i) => {
        const sp = spawns[i] || spawns[0];
        agentState.push({
            x: sp.q * T + T / 2, y: sp.r * T + T / 2,
            tx: sp.q * T + T / 2, ty: sp.r * T + T / 2,
            dir: 0,  // 0=down,1=left,2=up,3=right
            walking: false,
            frame: 0,
            speed: 28 + Math.random() * 12,
            wait: Math.random() * 4,
            activity: ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)],
            activityTimer: 5 + Math.random() * 8,
            bubble: null, bubbleTimer: 0,
        });
    });
}

function updateAgents(dt) {
    agentState.forEach((a, i) => {
        // bubble timer
        if (a.bubbleTimer > 0) { a.bubbleTimer -= dt; if (a.bubbleTimer <= 0) a.bubble = null; }
        // activity timer
        a.activityTimer -= dt;
        if (a.activityTimer <= 0) {
            a.activity = ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)];
            a.activityTimer = 6 + Math.random() * 10;
        }

        if (a.wait > 0) { a.wait -= dt; a.walking = false; return; }

        const dx = a.tx - a.x, dy = a.ty - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 2) {
            a.walking = false;
            // pick new target — a random path/building-entrance tile
            const targets = [];
            for (let ty = 0; ty < MAP_H; ty++)
                for (let tx = 0; tx < MAP_W; tx++)
                    if (map[ty][tx] === 'path' || map[ty][tx] === 'bridge')
                        if (Math.abs(tx - a.x / T) + Math.abs(ty - a.y / T) < 20)
                            if (hash(tx + i * 100, ty + time * 0.01) < 0.02) targets.push({ tx, ty });
            if (targets.length) {
                const tgt = targets[Math.floor(Math.random() * targets.length)];
                a.tx = tgt.tx * T + T / 2;
                a.ty = tgt.ty * T + T / 2;
            }
            a.wait = 1.5 + Math.random() * 4;
        } else {
            a.walking = true;
            a.frame += dt * 5;
            const step = a.speed * dt;
            a.x += (dx / dist) * step;
            a.y += (dy / dist) * step;
            // direction
            if (Math.abs(dx) > Math.abs(dy)) a.dir = dx > 0 ? 3 : 1;
            else a.dir = dy > 0 ? 0 : 2;
        }
    });

    // random speech bubbles between nearby agents
    if (Math.random() < dt * 0.06) {
        for (let i = 0; i < agentState.length; i++) {
            for (let j = i + 1; j < agentState.length; j++) {
                const ai = agentState[i], aj = agentState[j];
                const d = Math.sqrt((ai.x - aj.x) ** 2 + (ai.y - aj.y) ** 2);
                if (d < T * 6 && !ai.bubble && !aj.bubble) {
                    const conv = SPEECH_LINES[Math.floor(Math.random() * SPEECH_LINES.length)];
                    ai.bubble = conv[0]; ai.bubbleTimer = 5;
                    aj.bubble = conv[1]; aj.bubbleTimer = 5;
                    return;
                }
            }
        }
    }
}

function drawAgents() {
    agentState.forEach((a, i) => {
        const agent = AGENTS[i];
        const bx = Math.round(a.x), by = Math.round(a.y);
        const bob = a.walking ? Math.sin(a.frame * 2) * 1.2 : 0;

        // shadow
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath(); ctx.ellipse(bx, by + 5, 5, 2, 0, 0, Math.PI * 2); ctx.fill();

        // body
        ctx.fillStyle = agent.color;
        ctx.fillRect(bx - 4, by - 6 + bob, 8, 10);

        // head
        ctx.fillStyle = '#ffddb5';
        ctx.beginPath(); ctx.arc(bx, by - 10 + bob, 5, 0, Math.PI * 2); ctx.fill();

        // hair
        ctx.fillStyle = agent.hair;
        ctx.beginPath(); ctx.arc(bx, by - 12 + bob, 5, Math.PI, 0); ctx.fill();

        // eyes
        ctx.fillStyle = '#333';
        ctx.fillRect(bx - 2, by - 10 + bob, 1.5, 1.5);
        ctx.fillRect(bx + 1, by - 10 + bob, 1.5, 1.5);

        // legs (walking animation)
        if (a.walking) {
            const legOff = Math.sin(a.frame * 2) * 2;
            ctx.fillStyle = '#555';
            ctx.fillRect(bx - 3, by + 4 + bob, 2, 3 + legOff);
            ctx.fillRect(bx + 1, by + 4 + bob, 2, 3 - legOff);
        } else {
            ctx.fillStyle = '#555';
            ctx.fillRect(bx - 3, by + 4, 2, 3);
            ctx.fillRect(bx + 1, by + 4, 2, 3);
        }
    });
}

// ────────────────────────────────────────────────────────────────
//  AGENT LABELS & SPEECH BUBBLES  (drawn in screen space)
// ────────────────────────────────────────────────────────────────
function drawLabels() {
    agentState.forEach((a, i) => {
        const agent = AGENTS[i];
        const sx = (a.x - camX) * zoom + W / 2;
        const sy = (a.y - camY) * zoom + H / 2;

        // activity label (gray box)
        ctx.save();
        ctx.font = 'bold 10px Nunito';
        const actText = a.activity;
        const aw = ctx.measureText(actText).width + 10;
        const alx = sx - aw / 2, aly = sy - 50 * zoom;

        ctx.fillStyle = 'rgba(60,50,40,0.75)';
        roundRect(ctx, alx, aly, aw, 16, 4);
        ctx.fill();
        ctx.fillStyle = '#f0e8d8';
        ctx.textAlign = 'center';
        ctx.fillText(actText, sx, aly + 12);

        // name
        ctx.font = 'bold 9px Nunito';
        ctx.fillStyle = agent.color;
        ctx.fillText(agent.name, sx, aly + 26);
        ctx.restore();

        // speech bubble
        if (a.bubble && a.bubbleTimer > 0) {
            ctx.save();
            const alpha = Math.min(1, a.bubbleTimer / 0.5);
            ctx.globalAlpha = alpha;
            ctx.font = '10px Nunito';
            const bText = a.bubble;
            const bw = ctx.measureText(bText).width + 14;
            const blx = sx - bw / 2, bly = sy - 75 * zoom;

            // bubble bg
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#b0a090';
            ctx.lineWidth = 1;
            roundRect(ctx, blx, bly, bw, 22, 6);
            ctx.fill(); ctx.stroke();
            // tail
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(sx - 4, bly + 22);
            ctx.lineTo(sx, bly + 28);
            ctx.lineTo(sx + 4, bly + 22);
            ctx.fill();
            ctx.strokeStyle = '#b0a090'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(sx - 4, bly + 22); ctx.lineTo(sx, bly + 28); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(sx, bly + 28); ctx.lineTo(sx + 4, bly + 22); ctx.stroke();

            // text
            ctx.fillStyle = '#5b3a1a';
            ctx.textAlign = 'center';
            ctx.fillText(bText, sx, bly + 15);
            ctx.globalAlpha = 1;
            ctx.restore();
        }
    });
}

function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
    c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r);
    c.closePath();
}

// ────────────────────────────────────────────────────────────────
//  UPDATE SIDEBAR
// ────────────────────────────────────────────────────────────────
function updateSidebar() {
    const el = document.getElementById('agent-list');
    if (!el) return;
    let html = '<h3>Agents</h3>';
    AGENTS.forEach((ag, i) => {
        const act = agentState[i] ? agentState[i].activity : '';
        html += `<div class="al-row">
            <div class="al-dot" style="background:${ag.color}"></div>
            <span class="al-name">${ag.name}</span>
        </div>
        <div class="al-row"><span class="al-activity">${act}</span></div>`;
    });
    el.innerHTML = html;
}

// ────────────────────────────────────────────────────────────────
//  MAIN RENDER
// ────────────────────────────────────────────────────────────────
function render(t) {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);

    // ── world-space drawing ──
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);

    // tiles
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) drawTile(x, y);

    // water shimmer
    drawWaterShimmer(t);

    // decorations
    drawDecorations(t);

    // buildings
    drawBuildings();

    // agents
    drawAgents();

    ctx.restore();

    // ── screen-space overlays ──
    drawLabels();
}

// ────────────────────────────────────────────────────────────────
//  INPUT
// ────────────────────────────────────────────────────────────────
canvas.addEventListener('pointerdown', e => { dragging = true; dsx = e.clientX; dsy = e.clientY; csx = camX; csy = camY; });
canvas.addEventListener('pointermove', e => { if (!dragging) return; camX = csx - (e.clientX - dsx) / zoom; camY = csy - (e.clientY - dsy) / zoom; });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(SCALE_MIN, Math.min(SCALE_MAX, zoom * (e.deltaY > 0 ? 0.92 : 1.08))); }, { passive: false });

// ────────────────────────────────────────────────────────────────
//  LOOP
// ────────────────────────────────────────────────────────────────
let time = 0, lastT = 0, sidebarT = 0;
function loop(ts) {
    requestAnimationFrame(loop);
    const dt = Math.min((ts - lastT) / 1000, 0.1);
    lastT = ts; time = ts / 1000;

    updateAgents(dt);
    render(time);

    sidebarT += dt;
    if (sidebarT > 2) { sidebarT = 0; updateSidebar(); }
}

// ────────────────────────────────────────────────────────────────
//  INIT
// ────────────────────────────────────────────────────────────────
resize();
genMap();
initAgents();
updateSidebar();
window.addEventListener('resize', resize);
requestAnimationFrame(loop);
