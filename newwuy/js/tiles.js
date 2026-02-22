export const TILES = {
    hex_orange: [0, 0],
    hex_plant: [0, 0],
    hex_debris: [0, 2],
    hex_plain1: [0, 3],
    hex_plain2: [0, 4],
    hex_plain3: [0, 0],
    hex_tall: [0, 6],

    hex_orange2: [0, 0],
    hex_garden: [1, 1],
    hex_broken: [1, 2],
    hex_reactor: [1, 3],
    hex_factory: [1, 4],
    hex_pipes: [1, 5],
    hex_wall: [1, 6],

    hex_green: [0, 0],
    hex_vines: [2, 1],
    hex_cracked: [2, 2],
    hex_core_orange: [2, 3],
    hex_junction: [2, 4],
    hex_cables: [2, 5],
    hex_corner: [2, 6],

    hex_pink: [0, 0],
    hex_rock: [3, 1],
    hex_damage: [3, 2],
    hex_core_pink: [3, 3],
    hex_terminal1: [3, 4],
    hex_terminal2: [3, 5],
    hex_terminal3: [3, 6],

    hex_pink2: [0, 0],
    hex_metal: [0, 0],
    hex_curve: [4, 2],
    hex_grate1: [4, 3],
    hex_grate2: [4, 4],
    hex_grate3: [4, 5],
    hex_grid: [4, 6],

    hex_orange3: [0, 0],
    hex_platform: [5, 1],
    hex_half: [5, 2],
    hex_vent1: [5, 3],
    hex_vent2: [5, 4],
    hex_alien: [5, 5],
    hex_console: [5, 6],

    hex_plain4: [0, 0],
    hex_stone: [0, 0],
    hex_broken2: [6, 2],
    hex_vent3: [6, 3],
    hex_vent4: [6, 4],
    hex_data: [6, 5],
    hex_dark: [6, 6],

    hex_tile_new1: [1, 0],
    hex_tile_new2: [4, 0],
    hex_nature_1: [4, 1],
    hex_nature_2: [6, 0],
    hex_nature_3: [6, 1],
    hex_nature_4: [0, 1],
    hex_cracked_alt: [2, 2],
    snow_tile_1: [0, 5],
    snow_tile_2: [5, 0],
    hex_trial_outer: [0, 1],
    hex_trial_inner: [0, 0],
    hex_enemy_outer: [5, 0],
    hex_border_cyan: [0, 5],
    hex_border_green: [2, 0],
    hex_border_pink: [0, 0],
    hex_border_orange: [5, 0],

    deco_crystal: '9',
    deco_globe: '7',

    trial_nature_1: 'hex_nature_1',
    trial_nature_2: 'hex_nature_2',
    trial_nature_3: 'hex_nature_3',
    trial_nature_4: 'hex_nature_4',
    trial_snow_1: 'snow_tile_1',
    trial_snow_2: 'snow_tile_2',

    earthgreem: 'earthgreem',
    earthtilecorrect: 'earthtilecorrect',
    earthivy: 'earthivy',
    earthmushroom: 'earthmushroom',
    ivycorrect: 'ivycorrect',
    mushroomcorrextc: 'mushroomcorrextc',
};

export function getTileCoords(row, col) {
    return { x: col * 412, y: row * 412, w: 412, h: 412 };
}

// Terrain → sprite pools
// Interior tiles: lush earth/nature for owned territory interiors
const FARMLAND_POOL = [
    'earthtilecorrect', 'earthtilecorrect', 'earthtilecorrect',
    'ivycorrect', 'ivycorrect',
    'mushroomcorrextc',
    'ivycorrect', 'mushroomcorrextc',
];

const MINE_POOL = [
    'hex_reactor', 'hex_factory', 'hex_pipes', 'hex_terminal1',
    'hex_terminal2', 'hex_terminal3', 'hex_grate1', 'hex_grate2',
];

const MIXED_POOL = [
    'ivycorrect', 'mushroomcorrextc',
    'hex_junction', 'hex_platform', 'hex_console',
    'hex_grate3', 'hex_vent1',
];

const BARREN_POOL = [
    'hex_plain1', 'hex_plain2', 'hex_plain3', 'hex_plain4',
    'hex_rock', 'hex_stone', 'hex_cracked', 'hex_metal',
];

const UNKNOWN_POOL = [
    'hex_dark', 'hex_debris', 'hex_broken', 'hex_broken2',
    'hex_damage', 'hex_data',
];

// Nature-heavy pool for default owned interiors (new earth tiles dominate)
const INTERIOR_POOL = [
    'earthtilecorrect', 'earthtilecorrect', 'earthtilecorrect', 'earthtilecorrect',
    'ivycorrect', 'ivycorrect', 'ivycorrect',
    'mushroomcorrextc', 'mushroomcorrextc',
    'ivycorrect', 'mushroomcorrextc',
];

function hashQR(q, r) {
    return Math.abs((q * 73856093) ^ (r * 19349663));
}

export function pickFromPool(pool, q, r) {
    return pool[hashQR(q, r) % pool.length];
}

export function getTerrainSprite(terrain, q, r) {
    const hash = hashQR(q, r);
    switch (terrain) {
        case 'farmland': return FARMLAND_POOL[hash % FARMLAND_POOL.length];
        case 'mine':     return MINE_POOL[hash % MINE_POOL.length];
        case 'mixed':    return MIXED_POOL[hash % MIXED_POOL.length];
        case 'barren':   return BARREN_POOL[hash % BARREN_POOL.length];
        case 'unknown':  return UNKNOWN_POOL[hash % UNKNOWN_POOL.length];
        default:         return INTERIOR_POOL[hash % INTERIOR_POOL.length];
    }
}

export function getInteriorSprite(q, r) {
    return INTERIOR_POOL[hashQR(q, r) % INTERIOR_POOL.length];
}
