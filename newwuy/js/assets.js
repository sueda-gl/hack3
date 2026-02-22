import { CHARACTER_FRAME_COUNT, EXTRA_TILE_FILES } from './config.js';
import state from './state.js';

export const tileImages = {};
export const characterFrames = [];

export const planetSpriteSheet = new Image();
export const testCharImg = new Image();
export const foxImg = new Image();
export const fox2Img = new Image();
export const fox2IdleImg = new Image();
export const shipImg = new Image();
export const ship2Img = new Image();

export const spriteMeta = {
    PLANET_FRAME_W: 100,
    PLANET_FRAME_H: 100,
    FOX2_IDLE_FRAME_W: 36,
    FOX2_IDLE_FRAME_H: 36,
    SHIP_FRAME_W: 64,
    SHIP_FRAME_H: 64,
    SHIP2_FRAME_W: 41,
    SHIP2_FRAME_H: 41,
};

function markAssetLoaded(onComplete) {
    state.loadedCount++;
    if (state.loadedCount >= state.totalAssets) {
        onComplete();
    }
}

export function loadAllAssets(onComplete) {
    const SPRITE_SHEET_COUNT = 7;
    state.totalAssets = 49 + EXTRA_TILE_FILES.length + CHARACTER_FRAME_COUNT + SPRITE_SHEET_COUNT;
    const done = () => markAssetLoaded(onComplete);

    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 7; col++) {
            const key = `${row}_${col}`;
            const img = new Image();
            img.onload = done;
            img.onerror = () => { console.error(`Failed to load tile_r${row}_c${col}.png`); done(); };
            img.src = `tiles/tile_r${row}_c${col}.png`;
            tileImages[key] = img;
        }
    }

    EXTRA_TILE_FILES.forEach(fileKey => {
        const img = new Image();
        img.onload = done;
        img.onerror = () => { console.error(`Failed to load ${fileKey}.png`); done(); };
        img.src = `tiles/${fileKey}.png`;
        tileImages[fileKey] = img;
    });

    planetSpriteSheet.onload = done;
    planetSpriteSheet.onerror = () => { console.error('Failed to load planet sprite sheet'); done(); };
    planetSpriteSheet.src = 'tiles/1893123880.png';

    testCharImg.onload = () => {
        console.log('Test char loaded:', testCharImg.naturalWidth, 'x', testCharImg.naturalHeight);
        done();
    };
    testCharImg.onerror = () => { console.error('Failed to load test character'); done(); };
    testCharImg.src = 'tiles/player.png';

    foxImg.onload = done;
    foxImg.onerror = () => { console.error('Failed to load fox sprite'); done(); };
    foxImg.src = 'tiles/Starting-from-the-front-facing-pose,-the-orange-fox-in-the-b.png';

    fox2Img.onload = done;
    fox2Img.onerror = () => { console.error('Failed to load fox2 sprite'); done(); };
    fox2Img.src = 'tiles/media-5ec5b12c.png';

    fox2IdleImg.onload = () => {
        const FOX2_IDLE_FRAME_COUNT = 16;
        spriteMeta.FOX2_IDLE_FRAME_W = Math.floor(fox2IdleImg.naturalWidth / FOX2_IDLE_FRAME_COUNT);
        spriteMeta.FOX2_IDLE_FRAME_H = fox2IdleImg.naturalHeight;
        done();
    };
    fox2IdleImg.onerror = () => { console.error('Failed to load fox2 idle sprite'); done(); };
    fox2IdleImg.src = 'tiles/media-08f5fa89.png';

    shipImg.onload = () => {
        const SHIP_FRAME_COUNT = 5;
        spriteMeta.SHIP_FRAME_W = Math.floor(shipImg.naturalWidth / SHIP_FRAME_COUNT);
        spriteMeta.SHIP_FRAME_H = shipImg.naturalHeight;
        done();
    };
    shipImg.onerror = () => { console.error('Failed to load spaceship sprite'); done(); };
    shipImg.src = 'tiles/nairan-frigate-weapons.png';

    ship2Img.onload = () => {
        const SHIP2_FRAME_COUNT = 16;
        spriteMeta.SHIP2_FRAME_W = Math.floor(ship2Img.naturalWidth / SHIP2_FRAME_COUNT);
        spriteMeta.SHIP2_FRAME_H = ship2Img.naturalHeight;
        done();
    };
    ship2Img.onerror = () => { console.error('Failed to load spaceship2 sprite'); done(); };
    ship2Img.src = 'tiles/media-3f7fd7ec.png';

    for (let i = 0; i < CHARACTER_FRAME_COUNT; i++) {
        const frame = new Image();
        const frameName = `frame_${String(i).padStart(2, '0')}.png`;
        frame.onload = done;
        frame.onerror = () => { console.error(`Failed to load character ${frameName}`); done(); };
        frame.src = `characters/blonde_cropped/${frameName}`;
        characterFrames.push(frame);
    }
}
