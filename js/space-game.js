// ================================================================
//  VOID DRIFTER — Space Exploration Game
//  Hex tilemap using Red Blob Games pointy-top layout
//  https://www.redblobgames.com/grids/hexagons-v2/
// ================================================================
'use strict';

// ────────────────────────────────────────────────────────────────
//  SPRITE SHEET  —  7×7 grid of 122×122 cleaned tiles (49 total)
// ────────────────────────────────────────────────────────────────
const SPRITE_COLS  = 7;
const SPRITE_ROWS  = 7;
const TILE_SIZE    = 122;          // each tile cell in source sheet
const TOTAL_TILES  = 49;           // tile_00 … tile_48

// ────────────────────────────────────────────────────────────────
//  HEX METRICS  —  measured from cleaned tiles with Python/PIL
//
//  Hex shape profile (pointy-top, confirmed by alpha scan):
//    top vertex  y≈12   width=4
//    flat sides  y≈30-84  width≈88
//    bottom vtx  y≈108  width=8
//
//  ⇒  flat-side width  = 88 px  (consistent wide section)
//  ⇒  vertex-to-vertex = 96 px  (y108 − y12)
//  ⇒  hex center ≈ (61, 60) ≈ tile center (61, 61)
// ────────────────────────────────────────────────────────────────
const SQRT3 = Math.sqrt(3);

const HEX_FLAT_W   = 88;          // width at the flat sides
const HEX_VERT_H   = 96;          // vertex-to-vertex height
// Red Blob Games pointy-top:
//   width  = √3 × size_x  →  size_x = flat_w / √3
//   height = 2  × size_y  →  size_y = vert_h / 2
const SRC_SIZE_X = HEX_FLAT_W / SQRT3;   // ≈ 50.8
const SRC_SIZE_Y = HEX_VERT_H / 2;       // = 48

// Render scale (how big tiles appear on screen)
const RENDER_SCALE = 0.82;                // tweak for desired density
const SIZE_X = SRC_SIZE_X * RENDER_SCALE;
const SIZE_Y = SRC_SIZE_Y * RENDER_SCALE;
// Draw tiles ~10% larger than grid cell to eliminate seams
const RENDER_SZ = Math.round(TILE_SIZE * RENDER_SCALE * 1.10);

const MAP_COLS  = 50;
const MAP_ROWS  = 50;
const SCALE_MIN = 0.3, SCALE_MAX = 3;

// ────────────────────────────────────────────────────────────────
//  POINTY-TOP HEX → PIXEL  (Red Blob Games)
//    x = (√3·q + √3/2·r) · size_x
//    y = (         3/2·r) · size_y
// ────────────────────────────────────────────────────────────────
function hexToPixel(q, r) {
    return {
        x: (SQRT3 * q + SQRT3 / 2 * r) * SIZE_X,
        y: (              3 / 2 * r)     * SIZE_Y,
    };
}

// Offset (odd-r) → axial
function offsetToAxial(col, row) {
    const q = col - (row - (row & 1)) / 2;
    const r = row;
    return { q, r };
}

// Offset → pixel  (used for map grid)
function cellToPixel(col, row) {
    const ax = offsetToAxial(col, row);
    return hexToPixel(ax.q, ax.r);
}

// ────────────────────────────────────────────────────────────────
//  TILE INDICES  — using only tile 1 and 2 for testing
// ────────────────────────────────────────────────────────────────
const TEST_TILE = 31;

// ────────────────────────────────────────────────────────────────
//  STATE
// ────────────────────────────────────────────────────────────────
let tileset = null, tilesetReady = false;
let charImg = null, charReady = false;
let labImg = null, labReady = false;
let compoundImg = null, compoundReady = false;
const map = [], biomeMap = [];

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx    = minimapCanvas.getContext('2d');

let W, H, camX = 0, camY = 0, zoom = 1.0;
const ship = { x:0, y:0, angle:-Math.PI/2, vx:0, vy:0, speed:200, energy:85, hull:100, fuel:72 };
const keys = {};
let dragging = false, dragStart = {x:0,y:0}, camStart = {x:0,y:0};

// ────────────────────────────────────────────────────────────────
//  LOAD TILESET
// ────────────────────────────────────────────────────────────────
function loadTileset() {
    return new Promise((resolve, reject) => {
        tileset = new Image();
        tileset.onload = () => {
            tilesetReady = true;
            console.log(`Sheet ${tileset.width}×${tileset.height} → cell ${TILE_SIZE}×${TILE_SIZE}`);
            resolve();
        };
        tileset.onerror = () => reject(new Error('Tileset load failed'));
        tileset.src = 'space-tiles.png';
    });
}

// ────────────────────────────────────────────────────────────────
//  HELPERS
// ────────────────────────────────────────────────────────────────
function hash(a, b)   { const x = Math.sin(a*127.1+b*311.7)*43758.5453; return x - Math.floor(x); }
function noise(x,y,s) { const xi=Math.floor(x*s),yi=Math.floor(y*s),xf=x*s-xi,yf=y*s-yi;
    const a=hash(xi,yi),b=hash(xi+1,yi),c=hash(xi,yi+1),d=hash(xi+1,yi+1);
    const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v; }
function fbm(x,y,s,o) { let v=0,a=0.5;for(let i=0;i<o;i++){v+=noise(x,y,s)*a;s*=2;a*=0.5;}return v; }
function pick(arr,seed){ return arr[Math.floor(hash(seed,seed*1.7)*arr.length)]; }
function clamp(v,lo,hi){ return v<lo?lo:v>hi?hi:v; }

// ────────────────────────────────────────────────────────────────
//  MAP GENERATION  — ~30 tiles clustered near center, rest empty
// ────────────────────────────────────────────────────────────────
function generateMap() {
    const cx = Math.floor(MAP_COLS / 2);
    const cy = Math.floor(MAP_ROWS / 2);
    // Place ~30 tiles in a rough organic cluster around center
    const placed = new Set();
    const queue = [`${cx},${cy}`];
    placed.add(queue[0]);

    while (placed.size < 30 && queue.length > 0) {
        const idx = Math.floor(hash(placed.size * 17, queue.length * 31) * queue.length);
        const [pc, pr] = queue.splice(idx, 1)[0].split(',').map(Number);
        // Pointy-top hex neighbors in offset (odd-r) coords
        const isOdd = pr & 1;
        const dirs = isOdd
            ? [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]]
            : [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]];
        for (const [dc, dr] of dirs) {
            const nc = pc + dc, nr = pr + dr;
            const key = `${nc},${nr}`;
            if (nc >= 0 && nc < MAP_COLS && nr >= 0 && nr < MAP_ROWS && !placed.has(key)) {
                if (placed.size < 30) {
                    placed.add(key);
                    queue.push(key);
                }
            }
        }
    }

    // Pick decoration tiles
    const placedArr = [...placed];
    const deco1 = placedArr[Math.floor(placedArr.length * 0.7)]; // tile 43

    // Pick a tile fully inside the cluster, close to center but offset by 1-2 tiles
    let labTile = placedArr[Math.floor(placedArr.length * 0.4)]; // fallback
    let bestDist = Infinity;
    for (let i = 0; i < placedArr.length; i++) {
        const [tc, tr] = placedArr[i].split(',').map(Number);
        // skip the exact center (avatar spawns there)
        if (tc === cx && tr === cy) continue;
        const dist = Math.abs(tc - cx) + Math.abs(tr - cy);
        // want 1-2 tiles away from center
        if (dist < 1 || dist > 2) continue;
        const isOdd = tr & 1;
        const dirs = isOdd
            ? [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]]
            : [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]];
        let nCount = 0;
        for (const [dc, dr] of dirs) {
            if (placed.has(`${tc+dc},${tr+dr}`)) nCount++;
        }
        if (nCount >= 5 && dist < bestDist) { bestDist = dist; labTile = placedArr[i]; }
    }
    const labSlots = [labTile];
    const labSet = new Set(labSlots);

    for (let r = 0; r < MAP_ROWS; r++) {
        map[r] = []; biomeMap[r] = [];
        for (let c = 0; c < MAP_COLS; c++) {
            biomeMap[r][c] = 'test';
            const key = `${c},${r}`;
            if (key === deco1) map[r][c] = 43;
            else               map[r][c] = placed.has(key) ? TEST_TILE : -1;
        }
    }

    // Find a tile for the compound structure — 3 tiles from center, well surrounded
    const takenTiles = new Set([labTile, deco1]);
    let compoundTile = null;
    for (let i = 0; i < placedArr.length; i++) {
        const key = placedArr[i];
        if (takenTiles.has(key)) continue;
        const [tc, tr] = key.split(',').map(Number);
        const dist = Math.abs(tc - cx) + Math.abs(tr - cy);
        if (dist < 2 || dist > 3) continue;
        const isOdd = tr & 1;
        const dirs = isOdd
            ? [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]]
            : [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]];
        let nCount = 0;
        for (const [dc, dr] of dirs) {
            if (placed.has(`${tc+dc},${tr+dr}`)) nCount++;
        }
        if (nCount >= 4) { compoundTile = key; takenTiles.add(key); break; }
    }

    // Store building positions (pixel coords)
    function addBuilding(key, type) {
        if (!key) return;
        const [bc, br] = key.split(',').map(Number);
        const p = cellToPixel(bc, br);
        buildings.push({ x: p.x, y: p.y, type });
    }
    addBuilding(labSlots[0], 'lab');
    addBuilding(compoundTile, 'compound');
}

// ────────────────────────────────────────────────────────────────
//  BUILDINGS  — decorative structures placed on tiles
// ────────────────────────────────────────────────────────────────
const buildings = [];
const BUILDING_SCALE = 0.3;      // tweak to fit hex tiles

function loadLabBuilding() {
    return new Promise((resolve, reject) => {
        labImg = new Image();
        labImg.onload = () => { labReady = true; resolve(); };
        labImg.onerror = () => reject(new Error('Lab sprite load failed'));
        labImg.src = 'lab.png';
    });
}
// Load 5 dungeon tiles and composite them into one big structure
function loadCompoundStructure() {
    const srcs = ['dung_00.png','dung_05.png','dung_10.png','dung_15.png','dung_20.png'];
    return Promise.all(srcs.map(s => new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = s;
    }))).then(imgs => {
        // Arrange in a cross/plus pattern:
        //       [0]
        //    [1][2][3]
        //       [4]
        const tw = imgs[0].width, th = imgs[0].height;
        const cw = tw * 3, ch = th * 3;
        const offCanvas = document.createElement('canvas');
        offCanvas.width = cw; offCanvas.height = ch;
        const oc = offCanvas.getContext('2d');

        // positions: col, row in the 3x3 grid
        const layout = [
            [1, 0],  // top center
            [0, 1],  // middle left
            [1, 1],  // middle center
            [2, 1],  // middle right
            [1, 2],  // bottom center
        ];
        for (let i = 0; i < imgs.length; i++) {
            const [gc, gr] = layout[i];
            oc.drawImage(imgs[i], gc * tw, gr * th, tw, th);
        }

        compoundImg = offCanvas;
        compoundReady = true;
    });
}
const COMPOUND_SCALE = 0.18;

function drawBuildings(t) {
    const pad = 300;
    const hw = W / 2 / zoom + pad, hh = H / 2 / zoom + pad;
    for (const b of buildings) {
        if (Math.abs(b.x - camX) > hw || Math.abs(b.y - camY) > hh) continue;

        if (b.type === 'lab' && labReady) {
            const bw = labImg.width  * BUILDING_SCALE;
            const bh = labImg.height * BUILDING_SCALE;
            ctx.save();
            ctx.translate(b.x, b.y);
            const hover = Math.sin(t * 0.8 + b.x * 0.01) * 2;

            // Soft glow underneath
            ctx.globalAlpha = 0.2 + 0.05 * Math.sin(t * 1.5 + b.y * 0.02);
            ctx.fillStyle = '#4488ff';
            ctx.beginPath();
            ctx.ellipse(0, bh * 0.38, bw * 0.35, 8, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 1;
            ctx.drawImage(labImg, -bw / 2, -bh + RENDER_SZ * 0.15 + hover, bw, bh);

            // LAB sign pulse
            const pulse = 0.1 + 0.08 * Math.sin(t * 3 + b.x);
            ctx.globalAlpha = pulse;
            ctx.fillStyle = '#aa66ff';
            ctx.fillRect(-bw * 0.18, -bh * 0.35 + hover, bw * 0.36, bh * 0.12);
            ctx.restore();

        } else if (b.type === 'compound' && compoundReady) {
            const cw = compoundImg.width  * COMPOUND_SCALE;
            const ch = compoundImg.height * COMPOUND_SCALE;
            ctx.save();
            ctx.translate(b.x, b.y);

            // Large eerie ground shadow
            ctx.globalAlpha = 0.2 + 0.06 * Math.sin(t * 0.8 + b.x * 0.02);
            ctx.fillStyle = '#553322';
            ctx.beginPath();
            ctx.ellipse(0, 6, cw * 0.35, 10, 0, 0, Math.PI * 2);
            ctx.fill();

            // Draw the composite structure anchored at bottom
            ctx.globalAlpha = 1;
            ctx.drawImage(compoundImg, -cw / 2, -ch + RENDER_SZ * 0.2, cw, ch);

            // Multi-color glow — fire + crystal
            const glowR = cw * 0.4;
            const gy = -ch * 0.4;
            // Warm fire glow
            const g1 = ctx.createRadialGradient(-cw*0.15, gy, 0, -cw*0.15, gy, glowR);
            g1.addColorStop(0, '#ff8844');
            g1.addColorStop(1, 'transparent');
            ctx.globalAlpha = 0.10 + 0.06 * Math.sin(t * 2.5 + b.x);
            ctx.fillStyle = g1;
            ctx.beginPath(); ctx.arc(-cw*0.15, gy, glowR, 0, Math.PI * 2); ctx.fill();

            // Cool crystal glow
            const g2 = ctx.createRadialGradient(cw*0.15, gy, 0, cw*0.15, gy, glowR);
            g2.addColorStop(0, '#cc66ff');
            g2.addColorStop(1, 'transparent');
            ctx.globalAlpha = 0.08 + 0.05 * Math.sin(t * 1.8 + b.y);
            ctx.fillStyle = g2;
            ctx.beginPath(); ctx.arc(cw*0.15, gy, glowR, 0, Math.PI * 2); ctx.fill();

            ctx.restore();
        }
    }
    ctx.globalAlpha = 1;
}

// ────────────────────────────────────────────────────────────────
//  RENDER
// ────────────────────────────────────────────────────────────────
function drawTile(idx, cx, cy) {
    if (!tilesetReady || idx < 0 || idx >= TOTAL_TILES) return;
    const sx = (idx % SPRITE_COLS) * TILE_SIZE;
    const sy = Math.floor(idx / SPRITE_COLS) * TILE_SIZE;
    // Hex body is centered in tile, so just center the tile on the grid point
    const half = RENDER_SZ / 2;
    ctx.drawImage(tileset, sx, sy, TILE_SIZE, TILE_SIZE,
                  cx - half, cy - half, RENDER_SZ, RENDER_SZ);
}

function drawMap() {
    const pad = RENDER_SZ * 1.5;
    const vL = camX - W / 2 / zoom - pad;
    const vR = camX + W / 2 / zoom + pad;
    const vT = camY - H / 2 / zoom - pad;
    const vB = camY + H / 2 / zoom + pad;
    const t = performance.now() * 0.001;

    for (let r = 0; r < MAP_ROWS; r++) {
        for (let c = 0; c < MAP_COLS; c++) {
            if (map[r][c] < 0) continue;
            const p = cellToPixel(c, r);
            if (p.x < vL || p.x > vR || p.y < vT || p.y > vB) continue;
            drawTile(map[r][c], p.x, p.y);

            // Tile lighting — visible animated glow
            const h = hash(c * 13, r * 7);
            const wave = Math.sin(t * (0.5 + h * 1.0) + h * 20);
            const glow = 0.12 + 0.10 * wave;

            // Colored tint per tile
            const tint = h < 0.25 ? '#5577ff'
                       : h < 0.50 ? '#7755ff'
                       : h < 0.75 ? '#33ccbb'
                       :            '#9977ff';

            const rad = RENDER_SZ * 0.55;
            const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
            grad.addColorStop(0, tint);
            grad.addColorStop(0.6, tint);
            grad.addColorStop(1, 'transparent');
            ctx.globalAlpha = glow;
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }
}

// ── Stars ──
const stars = [];
function genStars() {
    const corner = cellToPixel(MAP_COLS, MAP_ROWS);
    const spread = 2.0;
    for (let i = 0; i < 2000; i++) {
        const hx = hash(i, 999), hy = hash(999, i);
        const h1 = hash(i * 11, 444);
        stars.push({
            x: (hx - 0.3) * corner.x * spread,
            y: (hy - 0.3) * corner.y * spread,
            r: 0.4 + hash(i * 2, 333) * 1.8,
            baseA: 0.3 + hash(i * 3, 777) * 0.7,
            speed: 0.3 + hash(i * 5, 111) * 4.0,
            phase: hash(i * 7, 222) * Math.PI * 2,
            color: h1 < 0.12 ? '#88bbff'
                 : h1 < 0.20 ? '#aaddff'
                 : h1 < 0.28 ? '#ffeebb'
                 : h1 < 0.33 ? '#ffbbdd'
                 : '#ddeeff',
        });
    }
}
function drawStars(t) {
    const hw = W / 2 / zoom + 200, hh = H / 2 / zoom + 200;
    for (const s of stars) {
        if (Math.abs(s.x - camX) > hw || Math.abs(s.y - camY) > hh) continue;
        const flicker = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
        ctx.globalAlpha = s.baseA * (0.3 + 0.7 * flicker);
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
}

// ── Character sprite ──
function loadCharacter() {
    return new Promise((resolve, reject) => {
        charImg = new Image();
        charImg.onload = () => { charReady = true; resolve(); };
        charImg.onerror = () => reject(new Error('Character sprite load failed'));
        charImg.src = 'character.png';
    });
}

const CHAR_SCALE = 0.7;          // tweak to taste
let charFacing = 1;               // 1 = right, -1 = left
let charBobPhase = 0;
let charMoving = false;

function drawShip() {
    const moving = keys['w']||keys['arrowup']||keys['s']||keys['arrowdown']||keys['a']||keys['arrowleft']||keys['d']||keys['arrowright'];
    charMoving = moving;

    // Track facing direction based on horizontal movement
    if (keys['a'] || keys['arrowleft'])  charFacing = -1;
    if (keys['d'] || keys['arrowright']) charFacing =  1;

    const t = performance.now() * 0.001;

    // Bobbing animation when moving
    if (moving) charBobPhase += 0.15;
    else        charBobPhase *= 0.9;  // settle back

    const bobY   = Math.sin(charBobPhase * 6) * (moving ? 3 : 0.5);
    const tiltZ  = Math.sin(charBobPhase * 6) * (moving ? 0.06 : 0);
    const scaleP = 1 + (moving ? Math.abs(Math.sin(charBobPhase * 6)) * 0.04 : 0);

    ctx.save();
    ctx.translate(ship.x, ship.y + bobY);
    ctx.rotate(tiltZ);
    ctx.scale(charFacing * CHAR_SCALE * scaleP, CHAR_SCALE * scaleP);

    if (charReady) {
        const hw = charImg.width / 2;
        const hh = charImg.height / 2;

        // Soft glow under character (shadow / glow disc)
        ctx.globalAlpha = 0.25 + 0.05 * Math.sin(t * 2);
        ctx.fillStyle = '#7b5cff';
        ctx.beginPath();
        ctx.ellipse(0, hh - 2, hw * 0.6, 6, 0, 0, Math.PI * 2);
        ctx.fill();

        // Draw the sprite
        ctx.globalAlpha = 1;
        ctx.drawImage(charImg, -hw, -hh, charImg.width, charImg.height);
    }

    ctx.restore();
}

function render() {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#06060e';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);
    const t = performance.now() * 0.001;
    drawStars(t);
    drawMap();
    drawBuildings(t);
    drawShip();
    ctx.restore();
}

// ────────────────────────────────────────────────────────────────
//  MINIMAP
// ────────────────────────────────────────────────────────────────
const BIOME_CLR = {
    deep_void: '#0a0a1e', asteroid_belt: '#2a2a3e',
    crystal_field: '#3a1a5a', volcanic: '#5a1a0a', energy_nexus: '#0a3a4a'
};
let minimapBg;
function buildMinimapBg() {
    minimapBg = document.createElement('canvas');
    minimapBg.width = 150; minimapBg.height = 150;
    const mc = minimapBg.getContext('2d');
    const sx = 150 / MAP_COLS, sy = 150 / MAP_ROWS;
    mc.fillStyle = '#06060e'; mc.fillRect(0, 0, 150, 150);
    for (let r = 0; r < MAP_ROWS; r++)
        for (let c = 0; c < MAP_COLS; c++) {
            mc.fillStyle = BIOME_CLR[biomeMap[r][c]] || '#111';
            mc.fillRect(c * sx, r * sy, sx + 0.5, sy + 0.5);
        }
}
function drawMinimap() {
    if (!minimapBg) return;
    const corner = cellToPixel(MAP_COLS, MAP_ROWS);
    minimapCtx.drawImage(minimapBg, 0, 0);
    const mx = (ship.x / corner.x) * 150, my = (ship.y / corner.y) * 150;
    minimapCtx.fillStyle = '#00f0ff';
    minimapCtx.beginPath(); minimapCtx.arc(mx, my, 3, 0, Math.PI * 2); minimapCtx.fill();
    const vw = (W / zoom / corner.x) * 150, vh = (H / zoom / corner.y) * 150;
    minimapCtx.strokeStyle = '#7b5cff50'; minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(mx - vw / 2, my - vh / 2, vw, vh);
}

// ────────────────────────────────────────────────────────────────
//  UPDATE
// ────────────────────────────────────────────────────────────────
function updateShip(dt) {
    let mx = 0, my = 0;
    if (keys['w'] || keys['arrowup'])    my = -1;
    if (keys['s'] || keys['arrowdown'])  my =  1;
    if (keys['a'] || keys['arrowleft'])  mx = -1;
    if (keys['d'] || keys['arrowright']) mx =  1;
    if (mx && my) { mx *= 0.707; my *= 0.707; }
    ship.vx += mx * ship.speed * dt;
    ship.vy += my * ship.speed * dt;
    ship.vx *= 0.93; ship.vy *= 0.93;
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    const corner = cellToPixel(MAP_COLS - 1, MAP_ROWS - 1);
    ship.x = clamp(ship.x, 50, corner.x - 50);
    ship.y = clamp(ship.y, 50, corner.y - 50);
    if (Math.abs(ship.vx) > 0.5 || Math.abs(ship.vy) > 0.5) {
        const ta = Math.atan2(ship.vy, ship.vx);
        let da = ta - ship.angle;
        while (da > Math.PI)  da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        ship.angle += da * 0.1;
    }
    camX += (ship.x - camX) * 0.08;
    camY += (ship.y - camY) * 0.08;
}

function updateUI() {
    const hSpacing = SQRT3 * SIZE_X;
    const vSpacing = 1.5 * SIZE_Y;
    const tx = Math.floor(ship.x / hSpacing);
    const ty = Math.floor(ship.y / vSpacing);
    document.getElementById('coords').textContent =
        `X: ${String(tx).padStart(4, '0')} Y: ${String(ty).padStart(4, '0')}`;
    document.getElementById('energy-bar').style.width = ship.energy + '%';
    document.getElementById('hull-bar').style.width   = ship.hull + '%';
    document.getElementById('fuel-bar').style.width    = ship.fuel + '%';
}

// ────────────────────────────────────────────────────────────────
//  INPUT
// ────────────────────────────────────────────────────────────────
function setupInput() {
    window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup',   e => { keys[e.key.toLowerCase()] = false; });
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        zoom = clamp(zoom * (e.deltaY > 0 ? 0.9 : 1.1), SCALE_MIN, SCALE_MAX);
    }, { passive: false });
    canvas.addEventListener('pointerdown', e => {
        dragging = true;
        dragStart = { x: e.clientX, y: e.clientY };
        camStart  = { x: camX, y: camY };
        canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', e => {
        if (!dragging) return;
        camX = camStart.x - (e.clientX - dragStart.x) / zoom;
        camY = camStart.y - (e.clientY - dragStart.y) / zoom;
    });
    canvas.addEventListener('pointerup', () => {
        dragging = false;
        canvas.style.cursor = 'default';
    });
}
function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }

// ────────────────────────────────────────────────────────────────
//  GAME LOOP
// ────────────────────────────────────────────────────────────────
let lastTime = 0;
function gameLoop(ts) {
    requestAnimationFrame(gameLoop);
    const dt = Math.min((ts - lastTime) / 1000, 0.1);
    lastTime = ts;
    updateShip(dt);
    render();
    drawMinimap();
    updateUI();
}

// ────────────────────────────────────────────────────────────────
//  INIT
// ────────────────────────────────────────────────────────────────
async function init() {
    const loadBar = document.getElementById('load-bar');
    const loading = document.getElementById('loading');
    resize();
    window.addEventListener('resize', resize);
    loadBar.style.width = '15%';

    try { await loadTileset(); } catch (e) { console.error(e); return; }
    loadBar.style.width = '30%';
    try { await loadCharacter(); } catch (e) { console.warn('Character sprite missing, using fallback', e); }
    loadBar.style.width = '35%';
    try { await loadLabBuilding(); } catch (e) { console.warn('Lab sprite missing', e); }
    loadBar.style.width = '40%';
    try { await loadCompoundStructure(); } catch (e) { console.warn('Compound structure missing', e); }
    loadBar.style.width = '48%';

    generateMap();
    loadBar.style.width = '60%';

    // Center camera + ship on map middle
    const center = cellToPixel(Math.floor(MAP_COLS / 2), Math.floor(MAP_ROWS / 2));
    camX = ship.x = center.x;
    camY = ship.y = center.y;

    genStars();
    buildMinimapBg();
    loadBar.style.width = '85%';

    setupInput();
    loadBar.style.width = '100%';

    console.log(`Hex layout: H-spacing=${(SQRT3*SIZE_X).toFixed(1)}, V-spacing=${(1.5*SIZE_Y).toFixed(1)}, render=${RENDER_SZ}px`);

    setTimeout(() => {
        loading.classList.add('hidden');
        requestAnimationFrame(gameLoop);
    }, 300);
}
init();
