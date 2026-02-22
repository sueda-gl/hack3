import state from './state.js';
import {
    TILE_W, TILE_H, HEX_R, HEX_W,
    HEX_PACK_X, HEX_PACK_Y, TILE_SCALE_UP,
    PLANET_FRAME_COUNT, PLANET_FPS, PLANET_FRAME_W, PLANET_FRAME_H,
} from './config.js';
import { hexToPixel, hexPath, hexToRgb, pixelToHex } from './hex.js';
import { TILES } from './tiles.js';
import { getAgentColor } from './agents.js';
import { tileImages, planetSpriteSheet } from './assets.js';

let planetFrameIdx = 0;
let planetFrameTimer = 0;

export function drawStars() {
    const { ctx, canvas, cameraX, cameraY, time } = state;

    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(200, 200, 255, 0.4)';
    for (let i = 0; i < 150; i++) {
        const x = ((i * 412 + 100) - cameraX * 0.1) % (canvas.width + 100);
        const y = ((i * 123 + 200) - cameraY * 0.1) % (canvas.height + 100);
        const dx = x < 0 ? x + canvas.width : x;
        const dy = y < 0 ? y + canvas.height : y;
        if (dx > 0 && dx < canvas.width && dy > 0 && dy < canvas.height) {
            ctx.fillRect(dx, dy, 1, 1);
        }
    }

    for (let i = 0; i < 80; i++) {
        const x = ((i * 231 + 50) - cameraX * 0.3) % (canvas.width + 200);
        const y = ((i * 311 + 90) - cameraY * 0.3) % (canvas.height + 200);
        const dx = x < 0 ? x + canvas.width : x;
        const dy = y < 0 ? y + canvas.height : y;
        const flicker = 0.5 + Math.sin(time * 0.1 + i) * 0.4;
        ctx.fillStyle = `rgba(255, 255, 255, ${flicker})`;
        if (dx > 0 && dx < canvas.width && dy > 0 && dy < canvas.height) {
            ctx.fillRect(dx, dy, 2, 2);
        }
    }

    ctx.fillStyle = 'rgba(100, 255, 218, 0.15)';
    for (let i = 0; i < 40; i++) {
        const x = ((i * 91 + time * 5) - cameraX * 0.6) % (canvas.width + 400);
        const y = ((i * 73) - cameraY * 0.6) % (canvas.height + 400);
        const dx = x < 0 ? x + canvas.width : x;
        const dy = y < 0 ? y + canvas.height : y;
        if (dx > 0 && dx < canvas.width && dy > 0 && dy < canvas.height) {
            ctx.beginPath();
            ctx.arc(dx, dy, (i % 3) + 1, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

export function drawPlanet(dt) {
    if (!planetSpriteSheet.complete || !planetSpriteSheet.naturalWidth) return;
    const { ctx, canvas, cameraX, cameraY } = state;

    planetFrameTimer += dt;
    if (planetFrameTimer >= 1 / PLANET_FPS) {
        planetFrameTimer -= 1 / PLANET_FPS;
        planetFrameIdx = (planetFrameIdx + 1) % PLANET_FRAME_COUNT;
    }

    const size = 260;
    const baseX = canvas.width * 0.65 - cameraX * 0.08;
    const baseY = canvas.height * 0.12 - cameraY * 0.08;

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
        planetSpriteSheet,
        planetFrameIdx * PLANET_FRAME_W, 0, PLANET_FRAME_W, PLANET_FRAME_H,
        baseX - size / 2, baseY - size / 2, size, size
    );
    ctx.restore();
}

export function drawUnclaimedBackground() {
    const { ctx, canvas, cameraX, cameraY, zoom, time, occupiedCells } = state;
    if (!occupiedCells) return;

    ctx.save();
    const pulse = 0.09 + Math.sin(time * 0.02) * 0.025;
    const halfW = canvas.width / (2 * zoom);
    const halfH = canvas.height / (2 * zoom);
    const rowStep = HEX_R * 1.5 * HEX_PACK_Y;
    const colStep = HEX_W * HEX_PACK_X;

    const rMin = Math.floor((cameraY - halfH) / rowStep) - 2;
    const rMax = Math.ceil((cameraY + halfH) / rowStep) + 2;
    const qMin = Math.floor((cameraX - halfW) / colStep) - 2;
    const qMax = Math.ceil((cameraX + halfW) / colStep) + 2;

    for (let r = rMin; r <= rMax; r++) {
        for (let q = qMin; q <= qMax; q++) {
            if (occupiedCells.has(`${q},${r}`)) continue;

            const pos = hexToPixel(q, r);
            const screenX = (pos.x - cameraX) * zoom + canvas.width / 2;
            const screenY = (pos.y - cameraY) * zoom + canvas.height / 2;
            if (screenX < -120 || screenX > canvas.width + 120 ||
                screenY < -120 || screenY > canvas.height + 120) continue;

            ctx.save();
            ctx.translate(screenX, screenY);
            ctx.scale(zoom, zoom);
            hexPath(ctx, 0, 0, HEX_R * 0.92);
            ctx.fillStyle = 'rgba(20, 80, 120, 0.03)';
            ctx.fill();
            ctx.strokeStyle = `rgba(120, 235, 255, ${pulse})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            hexPath(ctx, 0, 0, HEX_R * 0.92);
            ctx.strokeStyle = `rgba(0, 255, 204, ${pulse * 0.3})`;
            ctx.lineWidth = 2.6;
            ctx.stroke();
            ctx.restore();
        }
    }
    ctx.restore();
}

function drawTileSprite(tileName, cx, cy) {
    const { ctx } = state;
    const tileDef = TILES[tileName];
    if (!tileDef) return;

    let key = '';
    if (Array.isArray(tileDef)) {
        key = `${tileDef[0]}_${tileDef[1]}`;
    } else {
        key = tileDef;
    }
    const img = tileImages[key];
    if (!img || !img.complete || !img.naturalWidth) return;

    const scale = TILE_SCALE_UP[key] || 1;
    const w = TILE_W * scale;
    const h = TILE_H * scale;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

function drawTileLighting(tile, cx, cy) {
    const { ctx, time } = state;
    const ownerColor = tile.owner_id ? getAgentColor(tile.owner_id) : '#4cc9f0';
    const rgb = hexToRgb(ownerColor);

    const distFromCenter = Math.hypot(tile.q, tile.r);
    const wave = Math.sin(time * 0.08 - distFromCenter * 0.4);
    const pulse = 0.2 + (wave * 0.5 + 0.5) * 0.15;
    const glitch = Math.random() > 0.995 ? 0.3 : 0;
    const alpha = Math.min(1, pulse + glitch);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    hexPath(ctx, cx, cy, HEX_R * 0.88);
    ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.max(0.15, alpha * 0.5)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const glowR = HEX_R * 1.2;
    let grad = ctx.createRadialGradient(cx, cy, HEX_R * 0.2, cx, cy, glowR);
    grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.15})`);
    grad.addColorStop(0.6, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.05})`);
    grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Fortification: brighter core for fortified tiles
    if (tile.fortification > 0) {
        const fortAlpha = Math.min(0.6, tile.fortification * 0.05);
        grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, HEX_R * 0.5);
        grad.addColorStop(0, `rgba(255, 255, 255, ${fortAlpha})`);
        grad.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${fortAlpha * 0.5})`);
        grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, HEX_R * 0.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // Capital: pulsing star
    if (tile.is_capital) {
        const capPulse = 0.5 + Math.sin(time * 0.15) * 0.3;
        ctx.fillStyle = `rgba(255, 255, 180, ${capPulse})`;
        ctx.beginPath();
        ctx.arc(cx, cy - HEX_R * 0.3, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

export function drawAllTiles() {
    const { ctx, cameraX, cameraY, zoom, canvas, mapData } = state;
    if (!mapData) return;

    mapData.forEach(hex => {
        const pos = hexToPixel(hex.q, hex.r);
        const screenX = (pos.x - cameraX) * zoom + canvas.width / 2;
        const screenY = (pos.y - cameraY) * zoom + canvas.height / 2;

        if (screenX < -200 || screenX > canvas.width + 200 ||
            screenY < -200 || screenY > canvas.height + 200) return;

        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.scale(zoom, zoom);
        drawTileSprite(hex.tile, 0, 0);
        drawTileLighting(hex, 0, 0);
        ctx.restore();
    });
}

export function drawTerritoryLabels() {
    const { ctx, cameraX, cameraY, zoom, canvas, mapData } = state;
    if (!mapData) return;

    const ownerCenters = new Map();
    mapData.forEach(tile => {
        if (!tile.owner_id) return;
        if (!ownerCenters.has(tile.owner_id)) {
            ownerCenters.set(tile.owner_id, { sumQ: 0, sumR: 0, count: 0, name: tile.owner_name });
        }
        const c = ownerCenters.get(tile.owner_id);
        c.sumQ += tile.q;
        c.sumR += tile.r;
        c.count++;
    });

    ownerCenters.forEach((center, ownerId) => {
        const avgQ = center.sumQ / center.count;
        const avgR = center.sumR / center.count;
        const labelPos = hexToPixel(avgQ, avgR - 1.5);
        const screenX = (labelPos.x - cameraX) * zoom + canvas.width / 2;
        const screenY = (labelPos.y - cameraY) * zoom + canvas.height / 2;

        const color = getAgentColor(ownerId);
        const text = (center.name || ownerId.slice(0, 10)).toUpperCase();
        const subtext = `${center.count} tiles`;

        ctx.save();
        ctx.font = 'bold 24px Courier New';
        ctx.textAlign = 'center';

        const w = Math.max(ctx.measureText(text).width, 80) + 50;
        const h = 70;

        ctx.translate(screenX, screenY);
        const labelScale = Math.max(zoom, 0.4);
        ctx.scale(labelScale, labelScale);

        ctx.fillStyle = 'rgba(5, 10, 20, 0.8)';
        ctx.beginPath();
        ctx.moveTo(-w/2, -h/2);
        ctx.lineTo(w/2 - 16, -h/2);
        ctx.lineTo(w/2, -h/2 + 16);
        ctx.lineTo(w/2, h/2);
        ctx.lineTo(-w/2 + 16, h/2);
        ctx.lineTo(-w/2, h/2 - 16);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.fillRect(-w/2, -h/2, 4, 16);
        ctx.fillRect(w/2 - 4, h/2 - 16, 4, 16);

        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, 0, -6);

        ctx.font = '16px Courier New';
        ctx.fillStyle = color;
        ctx.shadowBlur = 0;
        ctx.fillText(subtext, 0, 20);

        ctx.restore();
    });
}

export function getHexAtMouse() {
    const { mouseScreen, canvas, cameraX, cameraY, zoom } = state;
    const worldMouseX = cameraX + (mouseScreen.x - canvas.width / 2) / zoom;
    const worldMouseY = cameraY + (mouseScreen.y - canvas.height / 2) / zoom;

    const approx = pixelToHex(worldMouseX, worldMouseY);
    const key = `${approx.q},${approx.r}`;
    // Check owned tiles first, then fall back to allTilesLookup for unclaimed
    return state.mapLookup?.get(key) || state.allTilesLookup?.get(key) || null;
}

export function drawSelectionCursor() {
    if (!state.hoveredHex) return;
    const { ctx, cameraX, cameraY, zoom, time, canvas } = state;
    const hex = state.hoveredHex;

    const pos = hexToPixel(hex.q, hex.r);
    const screenX = (pos.x - cameraX) * zoom + canvas.width / 2;
    const screenY = (pos.y - cameraY) * zoom + canvas.height / 2;

    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.scale(zoom, zoom);
    const pulse = 1 + Math.sin(time * 0.2) * 0.1;
    const r = HEX_R * 1.0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (i * 60 - 30) * Math.PI / 180;
        const p1x = (r * pulse) * Math.cos(angle - 0.2);
        const p1y = (r * pulse) * Math.sin(angle - 0.2);
        const p2x = (r * pulse) * Math.cos(angle);
        const p2y = (r * pulse) * Math.sin(angle);
        const p3x = (r * pulse) * Math.cos(angle + 0.2);
        const p3y = (r * pulse) * Math.sin(angle + 0.2);
        ctx.moveTo(p1x, p1y);
        ctx.lineTo(p2x, p2y);
        ctx.lineTo(p3x, p3y);
    }
    ctx.stroke();
    ctx.restore();

    // Tooltip
    ctx.save();
    ctx.translate(screenX, screenY - (HEX_R * zoom) - 22);
    const ownerText = hex.owner_name || 'Unclaimed';
    const terrainText = hex.terrain === 'unknown' ? '???' : (hex.terrain || '-');
    const label = `(${hex.q},${hex.r}) ${ownerText} | ${terrainText}` +
        (hex.fortification > 0 ? ` | Fort:${hex.fortification}` : '') +
        (hex.is_capital ? ' [CAPITAL]' : '');
    ctx.font = '10px Courier New';
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(-w / 2, -13, w, 18);
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2, -13, w, 18);
    ctx.fillStyle = '#00ffcc';
    ctx.textAlign = 'center';
    ctx.fillText(label, 0, 0);
    ctx.restore();
}

export function drawLoadingScreen() {
    const { ctx, canvas, time, loadedCount, totalAssets } = state;
    const pulse = 0.5 + Math.sin(time * 0.1) * 0.5;
    ctx.save();
    ctx.fillStyle = `rgba(0, 255, 204, ${pulse})`;
    ctx.font = 'bold 20px Courier New';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 10;
    ctx.fillText('INITIALIZING STATION ZERO...', canvas.width / 2, canvas.height / 2);
    const barW = 300;
    const barH = 6;
    const progress = totalAssets > 0 ? loadedCount / totalAssets : 0;
    ctx.strokeStyle = '#004433';
    ctx.lineWidth = 2;
    ctx.strokeRect(canvas.width / 2 - barW / 2, canvas.height / 2 + 30, barW, barH);
    ctx.fillStyle = '#00ffcc';
    ctx.shadowBlur = 5;
    ctx.fillRect(canvas.width / 2 - barW / 2 + 2, canvas.height / 2 + 32, (barW - 4) * progress, barH - 4);
    ctx.font = '12px Courier New';
    ctx.fillStyle = '#008866';
    ctx.fillText(`ASSETS: ${loadedCount} / ${totalAssets}`, canvas.width / 2, canvas.height / 2 + 60);
    ctx.restore();
}
