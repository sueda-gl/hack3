import state from './state.js';
import { hexToPixel, getNeighbors } from './hex.js';
import { fox2Img, fox2IdleImg, spriteMeta } from './assets.js';

const FOX2_FRAME_W = 36;
const FOX2_FRAME_H = 36;
const FOX2_FPS = 8;
const FOX2_WALK_START = 5;
const FOX2_WALK_COUNT = 7;
const FOX2_IDLE_FRAME_COUNT = 16;
const FOX2_IDLE_FPS = 8;

export const fox = {
    q: 4, r: 2,
    x: 0, y: 0,
    targetQ: null, targetR: null,
    speedPxPerSec: 180,
    facing: 1,
    animTime: 0,
    idleTimer: 0,
};

export function initFox() {
    const tile = state.mapData[15];
    fox.q = tile?.q ?? 4;
    fox.r = tile?.r ?? 2;
    const spawn = hexToPixel(fox.q, fox.r);
    fox.x = spawn.x;
    fox.y = spawn.y;
}

function getInputDirection() {
    let dx = 0, dy = 0;
    if (state.fox2Keys.has('KeyI')) dy -= 1;
    if (state.fox2Keys.has('KeyK')) dy += 1;
    if (state.fox2Keys.has('KeyJ')) dx -= 1;
    if (state.fox2Keys.has('KeyL')) dx += 1;
    if (dx === 0 && dy === 0) return null;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
}

function chooseNeighbor(dir) {
    const current = hexToPixel(fox.q, fox.r);
    const neighbors = getNeighbors(fox.q, fox.r)
        .filter(n => state.occupiedSet.has(`${n.q},${n.r}`));
    if (neighbors.length === 0) return null;

    let best = null, bestScore = -Infinity;
    neighbors.forEach(n => {
        const np = hexToPixel(n.q, n.r);
        const vLen = Math.hypot(np.x - current.x, np.y - current.y) || 1;
        const score = ((np.x - current.x) / vLen) * dir.x + ((np.y - current.y) / vLen) * dir.y;
        if (score > bestScore) { bestScore = score; best = n; }
    });
    return bestScore > 0.15 ? best : null;
}

export function tryStartFoxMove() {
    if (fox.targetQ !== null && fox.targetR !== null) return;
    const dir = getInputDirection();
    if (!dir) return;
    const next = chooseNeighbor(dir);
    if (!next) return;
    fox.targetQ = next.q;
    fox.targetR = next.r;
    fox.facing = next.q < fox.q ? -1 : 1;
}

export function updateFox(dt) {
    if (fox.targetQ === null || fox.targetR === null) {
        fox.idleTimer += dt;
        tryStartFoxMove();
        return;
    }
    fox.idleTimer = 0;
    const targetPos = hexToPixel(fox.targetQ, fox.targetR);
    const dx = targetPos.x - fox.x;
    const dy = targetPos.y - fox.y;
    const dist = Math.hypot(dx, dy);
    const step = fox.speedPxPerSec * dt;

    if (dist <= step || dist < 0.001) {
        fox.q = fox.targetQ;
        fox.r = fox.targetR;
        fox.x = targetPos.x;
        fox.y = targetPos.y;
        fox.targetQ = null;
        fox.targetR = null;
        tryStartFoxMove();
    } else {
        fox.x += (dx / dist) * step;
        fox.y += (dy / dist) * step;
        fox.facing = dx < 0 ? -1 : 1;
        fox.animTime += dt;
    }
}

export function drawFox() {
    const { ctx, cameraX, cameraY, zoom } = state;
    const isMoving = fox.targetQ !== null && fox.targetR !== null;

    const screenX = (fox.x - cameraX) * zoom + state.canvas.width / 2;
    const screenY = (fox.y - cameraY) * zoom + state.canvas.height / 2;
    const drawW = 180 * zoom;
    const drawH = 180 * zoom;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(screenX, screenY);
    if (fox.facing < 0) ctx.scale(-1, 1);

    if (!isMoving && fox2IdleImg.complete && fox2IdleImg.naturalWidth) {
        const idleFrame = Math.floor(fox.idleTimer * FOX2_IDLE_FPS) % FOX2_IDLE_FRAME_COUNT;
        ctx.drawImage(
            fox2IdleImg,
            idleFrame * spriteMeta.FOX2_IDLE_FRAME_W, 0,
            spriteMeta.FOX2_IDLE_FRAME_W, spriteMeta.FOX2_IDLE_FRAME_H,
            -drawW / 2, -drawH, drawW, drawH
        );
    } else if (fox2Img.complete && fox2Img.naturalWidth) {
        const frameIdx = FOX2_WALK_START + Math.floor(fox.animTime * FOX2_FPS) % FOX2_WALK_COUNT;
        ctx.drawImage(
            fox2Img,
            frameIdx * FOX2_FRAME_W, 0, FOX2_FRAME_W, FOX2_FRAME_H,
            -drawW / 2, -drawH, drawW, drawH
        );
    }

    ctx.restore();
}
