const state = {
    canvas: null,
    ctx: null,

    cameraX: 0,
    cameraY: 0,
    zoom: 0.85,

    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    mouseScreen: { x: 0, y: 0 },

    time: 0,
    lastRenderTs: 0,

    loaded: false,
    loadedCount: 0,
    totalAssets: 0,

    hoveredHex: null,

    mapData: [],
    mapLookup: null,
    occupiedCells: null,
    occupiedSet: null,
    allTilesLookup: null,

    gameStats: null,
};

export default state;
