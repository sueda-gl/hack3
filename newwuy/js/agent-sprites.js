import state from './state.js';
import { hexToPixel, getNeighbors } from './hex.js';
import { getAgentColor } from './agents.js';
import { testCharImg, fox2Img, fox2IdleImg, spriteMeta } from './assets.js';
import { getAgentRocket, activateRocket, sendRocketHome, launchTravelRocket } from './ships.js';

const CHAR_FRAME_W = 48;
const CHAR_FRAME_H = 48;
const CHAR_WALK_FRAMES = 6;
const CHAR_ROW_IDLE = 0;
const CHAR_ROW_WALK = 4;
const CHAR_FPS = 8;

const FOX2_FRAME_W = 36;
const FOX2_FRAME_H = 36;
const FOX2_FPS = 8;
const FOX2_WALK_START = 5;
const FOX2_WALK_COUNT = 7;
const FOX2_IDLE_FRAME_COUNT = 16;
const FOX2_IDLE_FPS = 8;

const SPRITE_TYPES = ['char', 'fox'];

const sprites = [];

// Sprite states: 'idle', 'walking', 'boarding', 'flying', 'visiting', 'returning'

function getAgentTiles(ownerId) {
    return state.mapData.filter(t => t.owner_id === ownerId);
}

function getBorderTiles(ownerId) {
    return getAgentTiles(ownerId).filter(t => {
        return getNeighbors(t.q, t.r).some(n => {
            const neighbor = state.mapLookup?.get(`${n.q},${n.r}`);
            return !neighbor || neighbor.owner_id !== ownerId;
        });
    });
}

function getCapitalTile(ownerId) {
    return getAgentTiles(ownerId).find(t => t.is_capital) || null;
}

function pickRandomTile(ownerId) {
    const tiles = getAgentTiles(ownerId);
    return tiles.length > 0 ? tiles[Math.floor(Math.random() * tiles.length)] : null;
}

function pickBorderTile(ownerId) {
    const borders = getBorderTiles(ownerId);
    return borders.length > 0 ? borders[Math.floor(Math.random() * borders.length)] : null;
}

function pickNeighborInTerritory(q, r, ownerId) {
    const neighbors = getNeighbors(q, r)
        .filter(n => {
            const tile = state.mapLookup?.get(`${n.q},${n.r}`);
            return tile && tile.owner_id === ownerId;
        });
    return neighbors.length > 0 ? neighbors[Math.floor(Math.random() * neighbors.length)] : null;
}

function pickTileNearAgent(targetOwnerId) {
    const tiles = getAgentTiles(targetOwnerId);
    return tiles.length > 0 ? tiles[Math.floor(Math.random() * tiles.length)] : null;
}

export function initAgentSprites() {
    sprites.length = 0;

    const ownerIds = [...new Set(state.mapData.filter(t => t.owner_id).map(t => t.owner_id))];

    ownerIds.forEach((ownerId, idx) => {
        const startTile = pickRandomTile(ownerId);
        if (!startTile) return;

        const pos = hexToPixel(startTile.q, startTile.r);
        sprites.push({
            ownerId,
            spriteType: SPRITE_TYPES[idx % SPRITE_TYPES.length],
            q: startTile.q,
            r: startTile.r,
            x: pos.x,
            y: pos.y,
            targetQ: null,
            targetR: null,
            speedPxPerSec: 120 + Math.random() * 60,
            facing: 1,
            animTime: 0,
            idleTimer: 0,
            wanderCooldown: 2 + Math.random() * 3,
            spriteState: 'idle',
            // Rocket travel state
            travelTargetOwnerId: null,
            travelPhase: null,   // 'to-border', 'flying-out', 'visiting', 'flying-back'
            travelTimer: 0,
            travelShipRef: null,
            travelDestQ: null,
            travelDestR: null,
            travelHomeQ: null,
            travelHomeR: null,
            homeQ: startTile.q,
            homeR: startTile.r,
            visible: true,
            patrolIndex: 0,
        });
    });
}

export function updateAgentSprites(dt) {
    sprites.forEach(sprite => {
        sprite.animTime += dt;

        switch (sprite.spriteState) {
            case 'idle':
                updateIdle(sprite, dt);
                break;
            case 'walking':
                updateWalking(sprite, dt);
                break;
            case 'traveling':
                updateTraveling(sprite, dt);
                break;
        }
    });
}

function updateIdle(sprite, dt) {
    sprite.idleTimer += dt;
    sprite.wanderCooldown -= dt;

    if (sprite.wanderCooldown <= 0) {
        let target;
        const roll = Math.random();

        // 65% patrol border, 25% visit random tile, 10% visit capital
        if (roll < 0.65) {
            target = pickBorderTile(sprite.ownerId);
        } else if (roll < 0.90) {
            target = pickRandomTile(sprite.ownerId);
        } else {
            target = getCapitalTile(sprite.ownerId) || pickRandomTile(sprite.ownerId);
        }

        if (target && (target.q !== sprite.q || target.r !== sprite.r)) {
            sprite.targetQ = target.q;
            sprite.targetR = target.r;
            sprite.spriteState = 'walking';
            const nextPos = hexToPixel(target.q, target.r);
            sprite.facing = nextPos.x < sprite.x ? -1 : 1;
        }

        sprite.wanderCooldown = 2 + Math.random() * 3;
    }
}

function updateWalking(sprite, dt) {
    if (sprite.targetQ === null || sprite.targetR === null) {
        sprite.spriteState = 'idle';
        return;
    }

    const targetPos = hexToPixel(sprite.targetQ, sprite.targetR);
    const dx = targetPos.x - sprite.x;
    const dy = targetPos.y - sprite.y;
    const dist = Math.hypot(dx, dy);
    const step = sprite.speedPxPerSec * dt;

    if (dist <= step || dist < 0.5) {
        sprite.q = sprite.targetQ;
        sprite.r = sprite.targetR;
        sprite.x = targetPos.x;
        sprite.y = targetPos.y;
        sprite.targetQ = null;
        sprite.targetR = null;
        sprite.spriteState = 'idle';
        sprite.wanderCooldown = 1.5 + Math.random() * 2;
        sprite.idleTimer = 0;
    } else {
        sprite.x += (dx / dist) * step;
        sprite.y += (dy / dist) * step;
        sprite.facing = dx < 0 ? -1 : 1;
    }
}

function abortTravel(sprite) {
    const homeTile = pickRandomTile(sprite.ownerId);
    if (homeTile) {
        const pos = hexToPixel(homeTile.q, homeTile.r);
        sprite.x = pos.x;
        sprite.y = pos.y;
        sprite.q = homeTile.q;
        sprite.r = homeTile.r;
    }
    sprite.visible = true;
    sprite.spriteState = 'idle';
    sprite.travelPhase = null;
    sprite.travelTargetOwnerId = null;
    sprite.travelShipRef = null;
    sprite.travelDestQ = null;
    sprite.travelDestR = null;
    sprite.travelHomeQ = null;
    sprite.travelHomeR = null;
    sprite.wanderCooldown = 2 + Math.random() * 3;
    sprite.idleTimer = 0;
}

function launchOrActivateRocket(sprite, toX, toY) {
    const rocket = getAgentRocket(sprite.ownerId);
    if (rocket && rocket.state === 'idle') {
        rocket.x = sprite.x;
        rocket.y = sprite.y;
        activateRocket(rocket, toX, toY);
        return rocket;
    }
    return launchTravelRocket(sprite.x, sprite.y, toX, toY);
}

function updateTraveling(sprite, dt) {
    sprite.travelTimer -= dt;

    if (sprite.travelPhase === 'to-border') {
        if (sprite.targetQ !== null) {
            updateWalking(sprite, dt);
            if (sprite.spriteState === 'idle') {
                sprite.spriteState = 'traveling';
                sprite.travelPhase = 'flying-out';
                const destTile = pickTileNearAgent(sprite.travelTargetOwnerId);
                if (destTile) {
                    const destPos = hexToPixel(destTile.q, destTile.r);
                    sprite.travelShipRef = launchOrActivateRocket(sprite, destPos.x, destPos.y);
                    sprite.travelDestQ = destTile.q;
                    sprite.travelDestR = destTile.r;
                } else {
                    abortTravel(sprite);
                    return;
                }
                sprite.visible = false;
            } else {
                sprite.spriteState = 'traveling';
            }
        } else {
            sprite.travelPhase = 'flying-out';
            const destTile = pickTileNearAgent(sprite.travelTargetOwnerId);
            if (destTile) {
                const destPos = hexToPixel(destTile.q, destTile.r);
                sprite.travelShipRef = launchOrActivateRocket(sprite, destPos.x, destPos.y);
                sprite.travelDestQ = destTile.q;
                sprite.travelDestR = destTile.r;
            } else {
                abortTravel(sprite);
                return;
            }
            sprite.visible = false;
        }
    } else if (sprite.travelPhase === 'flying-out') {
        if (sprite.travelShipRef && sprite.travelShipRef.state === 'idle') {
            if (sprite.travelShipRef.oneShot) {
                sprite.travelShipRef = null;
            }

            sprite.travelPhase = 'visiting';
            sprite.travelTimer = 8 + Math.random() * 5;
            sprite.visitWanderTimer = 0;

            if (sprite.travelDestQ != null) {
                const pos = hexToPixel(sprite.travelDestQ, sprite.travelDestR);
                sprite.x = pos.x;
                sprite.y = pos.y;
                sprite.q = sprite.travelDestQ;
                sprite.r = sprite.travelDestR;
            }
            sprite.visible = true;
        } else if (!sprite.travelShipRef) {
            abortTravel(sprite);
        }
    } else if (sprite.travelPhase === 'visiting') {
        sprite.idleTimer += dt;
        sprite.visitWanderTimer = (sprite.visitWanderTimer || 0) - dt;

        if (sprite.visitWanderTimer <= 0 && sprite.targetQ === null) {
            const wanderTile = pickTileNearAgent(sprite.travelTargetOwnerId);
            if (wanderTile && (wanderTile.q !== sprite.q || wanderTile.r !== sprite.r)) {
                sprite.targetQ = wanderTile.q;
                sprite.targetR = wanderTile.r;
                const wp = hexToPixel(wanderTile.q, wanderTile.r);
                sprite.facing = wp.x < sprite.x ? -1 : 1;
            }
            sprite.visitWanderTimer = 2 + Math.random() * 2;
        }

        if (sprite.targetQ !== null) {
            const tp = hexToPixel(sprite.targetQ, sprite.targetR);
            const dx = tp.x - sprite.x;
            const dy = tp.y - sprite.y;
            const dist = Math.hypot(dx, dy);
            const step = sprite.speedPxPerSec * dt;
            if (dist <= step || dist < 0.5) {
                sprite.x = tp.x;
                sprite.y = tp.y;
                sprite.q = sprite.targetQ;
                sprite.r = sprite.targetR;
                sprite.targetQ = null;
                sprite.targetR = null;
            } else {
                sprite.x += (dx / dist) * step;
                sprite.y += (dy / dist) * step;
                sprite.facing = dx < 0 ? -1 : 1;
            }
        }

        if (sprite.travelTimer <= 0) {
            sprite.travelPhase = 'flying-back';
            sprite.targetQ = null;
            sprite.targetR = null;

            const rocket = sprite.travelShipRef;
            if (rocket && !rocket.oneShot) {
                rocket.x = sprite.x;
                rocket.y = sprite.y;
                sendRocketHome(rocket);
                sprite.travelHomeQ = rocket.homeQ;
                sprite.travelHomeR = rocket.homeR;
            } else {
                const homeTile = pickRandomTile(sprite.ownerId);
                if (homeTile) {
                    const homePos = hexToPixel(homeTile.q, homeTile.r);
                    sprite.travelShipRef = launchTravelRocket(sprite.x, sprite.y, homePos.x, homePos.y);
                    sprite.travelHomeQ = homeTile.q;
                    sprite.travelHomeR = homeTile.r;
                } else {
                    abortTravel(sprite);
                    return;
                }
            }
            sprite.visible = false;
        }
    } else if (sprite.travelPhase === 'flying-back') {
        if (sprite.travelShipRef && sprite.travelShipRef.state === 'idle') {
            if (sprite.travelHomeQ != null) {
                const pos = hexToPixel(sprite.travelHomeQ, sprite.travelHomeR);
                sprite.x = pos.x;
                sprite.y = pos.y;
                sprite.q = sprite.travelHomeQ;
                sprite.r = sprite.travelHomeR;
            }

            sprite.travelShipRef = null;
            sprite.visible = true;
            sprite.spriteState = 'idle';
            sprite.travelPhase = null;
            sprite.travelTargetOwnerId = null;
            sprite.travelDestQ = null;
            sprite.travelDestR = null;
            sprite.travelHomeQ = null;
            sprite.travelHomeR = null;
            sprite.wanderCooldown = 2 + Math.random() * 3;
            sprite.idleTimer = 0;
        } else if (!sprite.travelShipRef) {
            abortTravel(sprite);
        }
    }
}

// Called when agent expands, fortifies, or attacks a tile
// Teleports sprite to the new tile instantly (agent acts faster than walking speed)
export function moveAgentToTile(ownerId, q, r) {
    const sprite = sprites.find(s => s.ownerId === ownerId);
    if (!sprite || sprite.spriteState === 'traveling') return;

    const newPos = hexToPixel(q, r);
    sprite.facing = newPos.x < sprite.x ? -1 : 1;

    // Teleport — the agent acts instantly, sprite follows
    sprite.q = q;
    sprite.r = r;
    sprite.x = newPos.x;
    sprite.y = newPos.y;
    sprite.targetQ = null;
    sprite.targetR = null;
    sprite.spriteState = 'idle';
    sprite.wanderCooldown = 2 + Math.random() * 2;
    sprite.idleTimer = 0;
}

// Called when agent messages, trades with, or visits another agent
export function sendSpriteToAgent(fromOwnerId, toOwnerId) {
    const sprite = sprites.find(s => s.ownerId === fromOwnerId);
    if (!sprite || sprite.spriteState === 'traveling') return;
    if (fromOwnerId === toOwnerId) return;

    sprite.travelTargetOwnerId = toOwnerId;
    sprite.spriteState = 'traveling';

    // Walk to border first
    const borderTile = pickBorderTile(fromOwnerId);
    if (borderTile) {
        sprite.targetQ = borderTile.q;
        sprite.targetR = borderTile.r;
        sprite.travelPhase = 'to-border';
        const nextPos = hexToPixel(borderTile.q, borderTile.r);
        sprite.facing = nextPos.x < sprite.x ? -1 : 1;
    } else {
        sprite.travelPhase = 'to-border';
    }
}

export function drawAgentSprites() {
    const { ctx, cameraX, cameraY, zoom, canvas } = state;

    sprites.forEach(sprite => {
        if (!sprite.visible) return;

        const screenX = (sprite.x - cameraX) * zoom + canvas.width / 2;
        const screenY = (sprite.y - cameraY) * zoom + canvas.height / 2;

        if (screenX < -200 || screenX > canvas.width + 200 ||
            screenY < -200 || screenY > canvas.height + 200) return;

        const isMoving = sprite.targetQ !== null;

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.translate(screenX, screenY);
        if (sprite.facing < 0) ctx.scale(-1, 1);

        if (sprite.spriteType === 'char') {
            drawCharSprite(sprite, isMoving);
        } else {
            drawFoxSprite(sprite, isMoving);
        }

        ctx.restore();

        // Agent name label
        ctx.save();
        const color = getAgentColor(sprite.ownerId);
        const agentData = state.mapData.find(t => t.owner_id === sprite.ownerId);
        const name = agentData?.owner_name || sprite.ownerId.slice(0, 8);

        ctx.font = `${Math.max(8, 10 * zoom)}px Courier New`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        const textY = screenY - (sprite.spriteType === 'char' ? 70 : 50) * zoom;
        const tw = ctx.measureText(name).width + 6;
        ctx.fillRect(screenX - tw / 2, textY - 9, tw, 14);
        ctx.fillStyle = color;
        ctx.fillText(name, screenX, textY);

        // Show travel status
        if (sprite.spriteState === 'traveling' && sprite.travelPhase === 'visiting') {
            const visitLabel = 'visiting...';
            ctx.font = `${Math.max(6, 8 * zoom)}px Courier New`;
            ctx.fillStyle = 'rgba(255,255,150,0.8)';
            ctx.fillText(visitLabel, screenX, textY + 14);
        }

        ctx.restore();
    });
}

function drawCharSprite(sprite, isMoving) {
    if (!testCharImg.complete || !testCharImg.naturalWidth) return;
    const { zoom } = state;
    const frameCol = isMoving
        ? Math.floor(sprite.animTime * CHAR_FPS) % CHAR_WALK_FRAMES
        : 0;
    const frameRow = isMoving ? CHAR_ROW_WALK : CHAR_ROW_IDLE;
    const drawW = 140 * zoom;
    const drawH = 140 * zoom;

    state.ctx.drawImage(
        testCharImg,
        frameCol * CHAR_FRAME_W, frameRow * CHAR_FRAME_H, CHAR_FRAME_W, CHAR_FRAME_H,
        -drawW / 2, -drawH, drawW, drawH
    );
}

function drawFoxSprite(sprite, isMoving) {
    const { zoom } = state;
    const drawW = 150 * zoom;
    const drawH = 150 * zoom;

    if (!isMoving && fox2IdleImg.complete && fox2IdleImg.naturalWidth) {
        const idleFrame = Math.floor(sprite.idleTimer * FOX2_IDLE_FPS) % FOX2_IDLE_FRAME_COUNT;
        state.ctx.drawImage(
            fox2IdleImg,
            idleFrame * spriteMeta.FOX2_IDLE_FRAME_W, 0,
            spriteMeta.FOX2_IDLE_FRAME_W, spriteMeta.FOX2_IDLE_FRAME_H,
            -drawW / 2, -drawH * 0.55, drawW, drawH
        );
    } else if (fox2Img.complete && fox2Img.naturalWidth) {
        const frameIdx = FOX2_WALK_START + Math.floor(sprite.animTime * FOX2_FPS) % FOX2_WALK_COUNT;
        state.ctx.drawImage(
            fox2Img,
            frameIdx * FOX2_FRAME_W, 0, FOX2_FRAME_W, FOX2_FRAME_H,
            -drawW / 2, -drawH * 0.55, drawW, drawH
        );
    }
}

export function getSprites() { return sprites; }
