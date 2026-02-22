import state from './state.js';

const movementKeys = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
]);

const fox2MovementKeys = new Set(['KeyI', 'KeyJ', 'KeyK', 'KeyL']);

export function setupKeyboardInput(tryStartPlayerMove, tryStartFox2Move) {
    window.addEventListener('keydown', (e) => {
        if (movementKeys.has(e.code)) {
            e.preventDefault();
            state.pressedKeys.add(e.code);
            tryStartPlayerMove();
        }
        if (fox2MovementKeys.has(e.code)) {
            e.preventDefault();
            state.fox2Keys.add(e.code);
            tryStartFox2Move();
        }
    });

    window.addEventListener('keyup', (e) => {
        if (movementKeys.has(e.code)) {
            e.preventDefault();
            state.pressedKeys.delete(e.code);
        }
        if (fox2MovementKeys.has(e.code)) {
            e.preventDefault();
            state.fox2Keys.delete(e.code);
        }
    });
}
