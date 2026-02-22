export const TILE_SIZE = 412;
export const TILES_PER_ROW = 7;

export const TILE_SCALE = 1.5;
export const TILE_W = Math.round(93 * TILE_SCALE);
export const TILE_H = Math.round(97 * TILE_SCALE);

export const HEX_R = Math.ceil(TILE_H / 1.5) + 2;
export const HEX_W = Math.sqrt(3) * HEX_R;
export const HEX_H = 2 * HEX_R;

export const HEX_PACK_X = 0.78;
export const HEX_PACK_Y = 0.77;

export const TILE_SCALE_UP = {
    '9': 1.20, '7': 1.20,
    'earthtilecorrect': 0.97, 'ivycorrect': 0.97, 'mushroomcorrextc': 0.97,
};

export const PLANET_FRAME_COUNT = 162;
export const PLANET_FRAME_W = 100;
export const PLANET_FRAME_H = 100;
export const PLANET_FPS = 6;

export const CHARACTER_FRAME_COUNT = 32;

export const EXTRA_TILE_FILES = [
    'hex_nature_1', 'hex_nature_2', 'hex_nature_3', 'hex_nature_4',
    'snow_tile_1', 'snow_tile_2', '9', '7',
    'earthgreem', 'earthivy', 'earthmushroom',
    'ivycorrect', 'mushroomcorrextc', 'earthtilecorrect',
];
