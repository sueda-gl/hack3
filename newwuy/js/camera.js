import state from './state.js';

const ZOOM_MIN = 0.12;
const ZOOM_MAX = 3;

export function setupCameraControls(canvas) {
    canvas.addEventListener('mousedown', (e) => {
        state.isDragging = true;
        state.lastMouse = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('mouseup', () => {
        state.isDragging = false;
        canvas.style.cursor = 'grab';
    });

    canvas.addEventListener('mouseleave', () => {
        state.isDragging = false;
        canvas.style.cursor = 'grab';
    });

    canvas.addEventListener('mousemove', (e) => {
        state.mouseScreen = { x: e.clientX, y: e.clientY };
        if (!state.isDragging) return;
        const dx = e.clientX - state.lastMouse.x;
        const dy = e.clientY - state.lastMouse.y;
        state.cameraX -= dx / state.zoom;
        state.cameraY -= dy / state.zoom;
        state.lastMouse = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = Math.exp(-e.deltaY * 0.0015);
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.zoom * zoomFactor));

        const mouseWorldX = state.cameraX + (e.clientX - canvas.width / 2) / state.zoom;
        const mouseWorldY = state.cameraY + (e.clientY - canvas.height / 2) / state.zoom;
        state.cameraX = mouseWorldX - (e.clientX - canvas.width / 2) / newZoom;
        state.cameraY = mouseWorldY - (e.clientY - canvas.height / 2) / newZoom;

        state.zoom = newZoom;
    }, { passive: false });

    canvas.style.cursor = 'grab';
}
