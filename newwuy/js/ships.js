import state from './state.js';
import { hexToPixel } from './hex.js';
import { shipImg, ship2Img, spriteMeta } from './assets.js';
import { agents, getAgentColor } from './agents.js';

const SHIP_FRAME_COUNT = 5;
const SHIP_FPS = 6;
const SHIP2_FRAME_COUNT = 16;
const SHIP2_TAKEOFF_FRAMES = [1, 2, 3];
const SHIP2_LAND_FRAMES = [12, 13, 14, 15];
const SHIP2_ANIM_FPS = 5;

let shipFrameIdx = 0;
let shipFrameTimer = 0;

const tradeRoutes = [];

function pickRandomTileForAgent(ownerId) {
    const tiles = state.mapData.filter(t => t.owner_id === ownerId);
    return tiles.length > 0 ? tiles[Math.floor(Math.random() * tiles.length)] : null;
}

export function initTradeRoutes() {
    tradeRoutes.length = 0;
    const activeOwners = [...new Set(state.mapData.filter(t => t.owner_id).map(t => t.owner_id))];
    activeOwners.forEach(ownerId => {
        const tile = pickRandomTileForAgent(ownerId);
        if (!tile) return;
        const pos = hexToPixel(tile.q, tile.r);
        tradeRoutes.push({
            fromOwnerId: ownerId,
            toOwnerId: null,
            x: pos.x,
            y: pos.y,
            targetX: 0,
            targetY: 0,
            altitude: 0,
            rotation: 0,
            state: 'idle',
            stateTimer: Infinity,
            animTime: Math.random() * 10,
            frameProgress: 0,
            flySpeed: 250,
            liftSpeed: 160,
            maxAlt: 300,
            tiltSpeed: 3,
            goingForward: true,
            oneShot: false,
            homeX: pos.x,
            homeY: pos.y,
            homeQ: tile.q,
            homeR: tile.r,
        });
    });
}

export function addTradeRoute(fromId, toId) {
    launchExpressRocket(fromId, toId);
}

export function launchExpressRocket(fromOwnerId, toOwnerId) {
    const fromTile = pickRandomTileForAgent(fromOwnerId);
    const toTile = pickRandomTileForAgent(toOwnerId);
    if (!fromTile || !toTile) return;

    const fromPos = hexToPixel(fromTile.q, fromTile.r);
    const toPos = hexToPixel(toTile.q, toTile.r);

    tradeRoutes.push({
        fromOwnerId,
        toOwnerId,
        x: fromPos.x,
        y: fromPos.y,
        targetX: toPos.x,
        targetY: toPos.y,
        altitude: 0,
        rotation: 0,
        state: 'takeoff',
        stateTimer: 0,
        animTime: 0,
        frameProgress: 0,
        flySpeed: 250,
        liftSpeed: 160,
        maxAlt: 300,
        tiltSpeed: 3,
        goingForward: true,
        oneShot: true,
    });
}

export function launchTravelRocket(fromX, fromY, toX, toY) {
    const ship = {
        fromOwnerId: null,
        toOwnerId: null,
        x: fromX,
        y: fromY,
        targetX: toX,
        targetY: toY,
        altitude: 0,
        rotation: 0,
        state: 'takeoff',
        stateTimer: 0,
        animTime: 0,
        frameProgress: 0,
        flySpeed: 250,
        liftSpeed: 160,
        maxAlt: 300,
        tiltSpeed: 3,
        goingForward: true,
        oneShot: true,
    };
    tradeRoutes.push(ship);
    return ship;
}

export function removeRocket(ship) {
    const idx = tradeRoutes.indexOf(ship);
    if (idx !== -1) tradeRoutes.splice(idx, 1);
}

export function getAgentRocket(ownerId) {
    return tradeRoutes.find(r => r.fromOwnerId === ownerId && !r.oneShot);
}

export function activateRocket(ship, toX, toY) {
    ship.targetX = toX;
    ship.targetY = toY;
    ship.state = 'takeoff';
    ship.stateTimer = 0;
    ship.frameProgress = 0;
    ship.rotation = 0;
}

export function sendRocketHome(ship) {
    ship.targetX = ship.homeX;
    ship.targetY = ship.homeY;
    ship.state = 'takeoff';
    ship.stateTimer = 0;
    ship.frameProgress = 0;
    ship.rotation = 0;
}

export function updateShips(dt) {
    shipFrameTimer += dt;
    if (shipFrameTimer >= 1 / SHIP_FPS) {
        shipFrameTimer -= 1 / SHIP_FPS;
        shipFrameIdx = (shipFrameIdx + 1) % SHIP_FRAME_COUNT;
    }

    tradeRoutes.forEach(s => updateRocketShip(s, dt));

    // Remove one-shot rockets that have landed
    for (let i = tradeRoutes.length - 1; i >= 0; i--) {
        if (tradeRoutes[i].oneShot && tradeRoutes[i].state === 'idle' && tradeRoutes[i].stateTimer <= 0) {
            tradeRoutes.splice(i, 1);
        }
    }
}

function updateRocketShip(s, dt) {
    s.animTime += dt;
    s.frameProgress += dt;
    const tiltTarget = Math.PI / 2;
    const goingRight = s.targetX >= s.x;
    const tiltDir = goingRight ? tiltTarget : -tiltTarget;

    if (s.state === 'idle') {
        s.stateTimer -= dt;
    } else if (s.state === 'takeoff') {
        s.altitude += s.liftSpeed * dt;
        if (s.altitude >= s.maxAlt) {
            s.altitude = s.maxAlt;
            s.state = 'tilt_to_fly';
            s.frameProgress = 0;
        }
    } else if (s.state === 'tilt_to_fly') {
        s.rotation += tiltDir * s.tiltSpeed * dt / tiltTarget;
        if (Math.abs(s.rotation) >= tiltTarget) {
            s.rotation = tiltDir;
            s.state = 'flying';
            s.frameProgress = 0;
        }
    } else if (s.state === 'flying') {
        s.rotation = tiltDir;
        const dx = s.targetX - s.x;
        const dy = s.targetY - s.y;
        const dist = Math.hypot(dx, dy);
        const step = s.flySpeed * dt;
        if (dist <= step || dist < 1) {
            s.x = s.targetX;
            s.y = s.targetY;
            s.state = 'tilt_to_land';
            s.frameProgress = 0;
        } else {
            s.x += (dx / dist) * step;
            s.y += (dy / dist) * step;
        }
    } else if (s.state === 'tilt_to_land') {
        const sign = s.rotation > 0 ? -1 : 1;
        s.rotation += sign * tiltTarget * s.tiltSpeed * dt;
        if (Math.abs(s.rotation) < 0.05) {
            s.rotation = 0;
            s.state = 'landing';
            s.frameProgress = 0;
        }
    } else if (s.state === 'landing') {
        s.altitude -= s.liftSpeed * dt;
        if (s.altitude <= 0) {
            s.altitude = 0;
            s.state = 'idle';
            s.stateTimer = 3 + Math.random() * 3;
            s.frameProgress = 0;
            s.rotation = 0;
        }
    }
}

function getShipFrame(s) {
    if (s.state === 'idle') return 0;
    if (['takeoff', 'tilt_to_fly', 'flying', 'tilt_to_land'].includes(s.state)) {
        return SHIP2_TAKEOFF_FRAMES[Math.floor(s.frameProgress * SHIP2_ANIM_FPS) % SHIP2_TAKEOFF_FRAMES.length];
    }
    if (s.state === 'landing') {
        return SHIP2_LAND_FRAMES[Math.min(
            Math.floor(s.frameProgress * SHIP2_ANIM_FPS),
            SHIP2_LAND_FRAMES.length - 1
        )];
    }
    return 0;
}

export function drawShips() {
    tradeRoutes.forEach(s => drawRocketShip(s));
}

function drawRocketShip(s) {
    if (!ship2Img.complete || !ship2Img.naturalWidth) return;
    const { ctx, cameraX, cameraY, zoom } = state;
    const frame = getShipFrame(s);

    const screenX = (s.x - cameraX) * zoom + state.canvas.width / 2;
    const screenY = (s.y - cameraY) * zoom + state.canvas.height / 2;

    if (screenX < -300 || screenX > state.canvas.width + 300 ||
        screenY < -300 || screenY > state.canvas.height + 300) return;

    const bob = s.state === 'idle' ? Math.sin(s.animTime * 2.2) * 2 : 0;
    const drawSize = 160 * zoom;
    const altPx = s.altitude * zoom;
    const baseOffset = -drawSize * 0.8;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(screenX, screenY);

    const shadowScale = 1 - (s.altitude / s.maxAlt) * 0.4;
    ctx.globalAlpha = 0.15 * shadowScale;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 0, drawSize * 0.3 * shadowScale, drawSize * 0.08 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    const spriteY = baseOffset - altPx + bob * zoom;
    ctx.save();
    ctx.translate(0, spriteY + drawSize / 2);
    ctx.rotate(s.rotation);
    ctx.drawImage(
        ship2Img,
        frame * spriteMeta.SHIP2_FRAME_W, 0, spriteMeta.SHIP2_FRAME_W, spriteMeta.SHIP2_FRAME_H,
        -drawSize / 2, -drawSize / 2, drawSize, drawSize
    );
    ctx.restore();

    const isActive = s.state !== 'idle';
    const glowAlpha = isActive
        ? 0.35 + Math.sin(s.animTime * 10) * 0.15
        : 0.12 + Math.sin(s.animTime * 5) * 0.06;
    const glowY = spriteY + drawSize * 0.85;
    const glowRad = isActive ? drawSize * 0.28 : drawSize * 0.16;
    const grad = ctx.createRadialGradient(0, glowY, 0, 0, glowY, glowRad);
    grad.addColorStop(0, `rgba(80, 255, 120, ${glowAlpha})`);
    grad.addColorStop(1, 'rgba(80, 255, 120, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, glowY, glowRad, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}
