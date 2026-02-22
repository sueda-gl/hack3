import state from './state.js';
import { getNeighbors } from './hex.js';
import { getTerrainSprite, getInteriorSprite } from './tiles.js';
import { getAgentBorderTile } from './agents.js';
import { fetchMap } from './network.js';

export async function loadWorldMap() {
    const serverTiles = await fetchMap();

    // allTilesLookup: every tile from server (owned + unclaimed) for hover info
    const allTilesLookup = new Map();
    serverTiles.forEach(tile => {
        allTilesLookup.set(`${tile.q},${tile.r}`, tile);
    });

    // mapData: ONLY owned tiles get rendered as sprites
    const mapData = [];
    const ownedLookup = new Map();

    serverTiles.forEach(tile => {
        if (!tile.owner_id) return; // skip unclaimed — they stay as background grid

        ownedLookup.set(`${tile.q},${tile.r}`, tile);
    });

    // Second pass: assign sprites with border/interior logic using ownedLookup
    ownedLookup.forEach(tile => {
        const spriteTile = pickSpriteForOwnedTile(tile, ownedLookup);

        mapData.push({
            q: tile.q,
            r: tile.r,
            tile: spriteTile,
            terrain: tile.terrain,
            owner_id: tile.owner_id,
            owner_name: tile.owner_name,
            fortification: tile.fortification || 0,
            is_capital: tile.is_capital || false,
        });
    });

    // occupiedCells = only owned tile coords, so drawUnclaimedBackground fills the rest
    const occupiedCells = new Set(mapData.map(t => `${t.q},${t.r}`));
    const mapLookup = new Map(mapData.map(t => [`${t.q},${t.r}`, t]));

    return { mapData, mapLookup, occupiedCells, occupiedSet: occupiedCells, allTilesLookup };
}

function pickSpriteForOwnedTile(tile, lookup) {
    const isBorder = getNeighbors(tile.q, tile.r).some(n => {
        const neighbor = lookup.get(`${n.q},${n.r}`);
        return !neighbor || neighbor.owner_id !== tile.owner_id;
    });

    if (isBorder) {
        return getAgentBorderTile(tile.owner_id) || getTerrainSprite(tile.terrain, tile.q, tile.r);
    }

    // Interior: mostly earth tiles, terrain adds occasional variety
    const hash = Math.abs((tile.q * 73856093) ^ (tile.r * 19349663));
    if (hash % 5 === 0 && tile.terrain !== 'barren') {
        return getTerrainSprite(tile.terrain, tile.q, tile.r);
    }
    return getInteriorSprite(tile.q, tile.r);
}

export function updateSingleTile(tileData) {
    const key = `${tileData.q},${tileData.r}`;

    // Always update allTilesLookup
    if (state.allTilesLookup) {
        state.allTilesLookup.set(key, tileData);
    }

    const existing = state.mapLookup?.get(key);
    const isNowOwned = tileData.owner_id !== null;

    if (isNowOwned) {
        // Build a temporary lookup including current owned tiles + this new one
        const tempLookup = new Map(state.mapLookup);
        tempLookup.set(key, tileData);

        const spriteTile = pickSpriteForUpdate(tileData, tempLookup);

        const updated = {
            q: tileData.q,
            r: tileData.r,
            tile: spriteTile,
            terrain: tileData.terrain,
            owner_id: tileData.owner_id,
            owner_name: tileData.owner_name,
            fortification: tileData.fortification || 0,
            is_capital: tileData.is_capital || false,
        };

        if (existing) {
            const idx = state.mapData.indexOf(existing);
            if (idx !== -1) state.mapData[idx] = updated;
        } else {
            state.mapData.push(updated);
            state.occupiedCells?.add(key);
        }
        state.mapLookup?.set(key, updated);

        // Recompute neighbor sprites (their border status may have changed)
        recomputeNeighborSprites(tileData.q, tileData.r);
    } else {
        // Tile became unclaimed: remove from rendered mapData
        if (existing) {
            const idx = state.mapData.indexOf(existing);
            if (idx !== -1) state.mapData.splice(idx, 1);
            state.mapLookup?.delete(key);
            state.occupiedCells?.delete(key);

            // Neighbors may now be borders
            recomputeNeighborSprites(tileData.q, tileData.r);
        }
    }
}

function pickSpriteForUpdate(tile, lookup) {
    const isBorder = getNeighbors(tile.q, tile.r).some(n => {
        const neighbor = lookup.get(`${n.q},${n.r}`);
        return !neighbor || neighbor.owner_id !== tile.owner_id;
    });

    if (isBorder) {
        return getAgentBorderTile(tile.owner_id) || getTerrainSprite(tile.terrain, tile.q, tile.r);
    }

    const hash = Math.abs((tile.q * 73856093) ^ (tile.r * 19349663));
    if (hash % 5 === 0 && tile.terrain !== 'barren') {
        return getTerrainSprite(tile.terrain, tile.q, tile.r);
    }
    return getInteriorSprite(tile.q, tile.r);
}

function recomputeNeighborSprites(q, r) {
    getNeighbors(q, r).forEach(n => {
        const key = `${n.q},${n.r}`;
        const tile = state.mapLookup?.get(key);
        if (!tile || !tile.owner_id) return;

        const isBorder = getNeighbors(n.q, n.r).some(nn => {
            const neighbor = state.mapLookup?.get(`${nn.q},${nn.r}`);
            return !neighbor || neighbor.owner_id !== tile.owner_id;
        });

        if (isBorder) {
            tile.tile = getAgentBorderTile(tile.owner_id) || getTerrainSprite(tile.terrain, n.q, n.r);
        } else {
            const hash = Math.abs((n.q * 73856093) ^ (n.r * 19349663));
            if (hash % 5 === 0 && tile.terrain !== 'barren') {
                tile.tile = getTerrainSprite(tile.terrain, n.q, n.r);
            } else {
                tile.tile = getInteriorSprite(n.q, n.r);
            }
        }
    });
}
