import state from './state.js';
import { hexToPixel, getNeighbors } from './hex.js';
import { testCharImg } from './assets.js';

const CHAR_FRAME_W = 48;
const CHAR_FRAME_H = 48;
const CHAR_WALK_FRAMES = 6;
const CHAR_ROW_IDLE = 0;
const CHAR_ROW_WALK = 4;
const CHAR_FPS = 8;

export const walker = {
    q: 0, r: 0,
    x: 0, y: 0,
    targetQ: null, targetR: null,
    speedPxPerSec: 180,
    facing: 1,
    animTime: 0,
};

export function initWalker() {
    const first = state.mapData[0];
    walker.q = first?.q ?? 0;
    walker.r = first?.r ?? 0;
    const spawn = hexToPixel(walker.q, walker.r);
    walker.x = spawn.x;
    walker.y = spawn.y;
}

function getInputDirection() {
    let dx = 0, dy = 0;
    if (state.pressedKeys.has('ArrowLeft') || state.pressedKeys.has('KeyA')) dx -= 1;
    if (state.pressedKeys.has('ArrowRight') || state.pressedKeys.has('KeyD')) dx += 1;
    if (state.pressedKeys.has('ArrowUp') || state.pressedKeys.has('KeyW')) dy -= 1;
    if (state.pressedKeys.has('ArrowDown') || state.pressedKeys.has('KeyS')) dy += 1;
    if (dx === 0 && dy === 0) return null;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
}

function chooseNeighborTowardDirection(dir) {
    const current = hexToPixel(walker.q, walker.r);
    const neighbors = getNeighbors(walker.q, walker.r)
        .filter(n => state.occupiedSet.has(`${n.q},${n.r}`));
    if (neighbors.length === 0) return null;

    let best = null;
    let bestScore = -Infinity;
    neighbors.forEach(n => {
        const np = hexToPixel(n.q, n.r);
        const vx = np.x - current.x;
        const vy = np.y - current.y;
        const vLen = Math.hypot(vx, vy) || 1;
        const score = (vx / vLen) * dir.x + (vy / vLen) * dir.y;
        if (score > bestScore) {
            bestScore = score;
            best = n;
        }
    });
    return bestScore > 0.15 ? best : null;
}

export function tryStartPlayerMove() {
    if (walker.targetQ !== null && walker.targetR !== null) return;
    const dir = getInputDirection();
    if (!dir) return;
    const next = chooseNeighborTowardDirection(dir);
    if (!next) return;
    walker.targetQ = next.q;
    walker.targetR = next.r;
    walker.facing = next.q < walker.q ? -1 : 1;
}

export function updateWalker(dt) {
    if (walker.targetQ === null || walker.targetR === null) {
        tryStartPlayerMove();
        return;
    }
    const targetPos = hexToPixel(walker.targetQ, walker.targetR);
    const dx = targetPos.x - walker.x;
    const dy = targetPos.y - walker.y;
    const dist = Math.hypot(dx, dy);
    const step = walker.speedPxPerSec * dt;

    if (dist <= step || dist < 0.001) {
        walker.q = walker.targetQ;
        walker.r = walker.targetR;
        walker.x = targetPos.x;
        walker.y = targetPos.y;
        walker.targetQ = null;
        walker.targetR = null;
        tryStartPlayerMove();
    } else {
        walker.x += (dx / dist) * step;
        walker.y += (dy / dist) * step;
        walker.facing = dx < 0 ? -1 : 1;
        walker.animTime += dt;
    }
}

export function drawWalker() {
    if (!testCharImg.complete || !testCharImg.naturalWidth) return;
    const { ctx, cameraX, cameraY, zoom, canvas } = state;
    const isMoving = walker.targetQ !== null && walker.targetR !== null;
    const frameCol = isMoving
        ? Math.floor(walker.animTime * CHAR_FPS) % CHAR_WALK_FRAMES
        : 0;
    const frameRow = isMoving ? CHAR_ROW_WALK : CHAR_ROW_IDLE;

    const screenX = (walker.x - cameraX) * zoom + canvas.width / 2;
    const screenY = (walker.y - cameraY) * zoom + canvas.height / 2;
    const drawW = 140 * zoom;
    const drawH = 140 * zoom;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(screenX, screenY);
    if (walker.facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(
        testCharImg,
        frameCol * CHAR_FRAME_W, frameRow * CHAR_FRAME_H, CHAR_FRAME_W, CHAR_FRAME_H,
        -drawW / 2, -drawH, drawW, drawH
    );
    ctx.restore();
}
