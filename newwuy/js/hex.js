import { HEX_W, HEX_R, HEX_PACK_X, HEX_PACK_Y } from './config.js';

// Axial coordinate system (matches backend)
// 6 neighbor directions are always the same regardless of row
const AXIAL_DIRECTIONS = [
    { q: 1, r: 0 },
    { q: -1, r: 0 },
    { q: 0, r: 1 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
    { q: -1, r: 1 },
];

export function hexToPixel(q, r) {
    const x = HEX_W * HEX_PACK_X * (q + r * 0.5);
    const y = r * HEX_R * 1.5 * HEX_PACK_Y;
    return { x, y };
}

export function pixelToHex(px, py) {
    const y = py / (HEX_R * 1.5 * HEX_PACK_Y);
    const x = (px / (HEX_W * HEX_PACK_X)) - y * 0.5;
    let rq = Math.round(x);
    let rr = Math.round(y);
    const rs = Math.round(-x - y);
    const qDiff = Math.abs(rq - x);
    const rDiff = Math.abs(rr - y);
    const sDiff = Math.abs(rs - (-x - y));
    if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs;
    else if (rDiff > sDiff) rr = -rq - rs;
    return { q: rq, r: rr };
}

export function hexPath(ctx, cx, cy, radius) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (i * 60 - 30) * Math.PI / 180;
        const px = cx + radius * Math.cos(angle);
        const py = cy + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
}

export function getNeighbors(q, r) {
    return AXIAL_DIRECTIONS.map(d => ({ q: q + d.q, r: r + d.r }));
}

export function hexDistance(q1, r1, q2, r2) {
    return (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs((q1 + r1) - (q2 + r2))) / 2;
}

export function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const value = parseInt(clean, 16);
    return {
        r: (value >> 16) & 255,
        g: (value >> 8) & 255,
        b: value & 255,
    };
}
