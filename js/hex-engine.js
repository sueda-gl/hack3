// ================================================================
//  CLAWQUEST — Tile Map Engine
//  Infinite scrollable map using a single repeating tile image
// ================================================================

(function() {
    'use strict';

    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0;

    let tile = null;           // the one tile image
    let tw = 0, th = 0;       // its natural width/height

    const cam = { x: 0, y: 0, zoom: 1.0, targetZoom: 1.0 };
    let dragging = false;
    let dragX = 0, dragY = 0, camStartX = 0, camStartY = 0;
    let stars = [];

    // ── LOAD THE TILE ──
    function loadTile() {
        return new Promise(function(resolve, reject) {
            var img = new Image();
            img.onload = function() {
                tile = img;
                tw = img.width;
                th = img.height;
                console.log('Tile loaded:', tw + 'x' + th);
                resolve();
            };
            img.onerror = function() { reject('Failed to load tile'); };
            img.src = 'tiles.2.png';
        });
    }

    // ── CAMERA ──
    function worldToScreen(wx, wy) {
        return {
            x: (wx - cam.x) * cam.zoom + W * 0.5,
            y: (wy - cam.y) * cam.zoom + H * 0.5
        };
    }

    function screenToWorld(sx, sy) {
        return {
            x: (sx - W * 0.5) / cam.zoom + cam.x,
            y: (sy - H * 0.5) / cam.zoom + cam.y
        };
    }

    // ── STARS ──
    function makeStars() {
        stars = [];
        for (var i = 0; i < 200; i++) {
            stars.push({
                x: Math.random() * W, y: Math.random() * H,
                r: 0.4 + Math.random() * 1.5,
                a: 0.2 + Math.random() * 0.6,
                speed: 0.5 + Math.random() * 2,
                phase: Math.random() * 6.28
            });
        }
    }

    // ── RENDER ──
    function render(t) {
        ctx.fillStyle = '#06060f';
        ctx.fillRect(0, 0, W, H);

        // Stars
        for (var i = 0; i < stars.length; i++) {
            var s = stars[i];
            ctx.globalAlpha = s.a * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
            ctx.fillStyle = '#b0c8ff';
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, 6.28);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Smooth zoom
        cam.zoom += (cam.targetZoom - cam.zoom) * 0.12;

        if (!tile) return;

        // Crispy pixel art — no blurring
        ctx.imageSmoothingEnabled = false;

        // Draw the tile repeated across the visible area
        var drawW = tw * cam.zoom;
        var drawH = th * cam.zoom;

        // Figure out which tile copies are visible
        var topLeft = screenToWorld(0, 0);
        var startCol = Math.floor(topLeft.x / tw) - 1;
        var startRow = Math.floor(topLeft.y / th) - 1;
        var endCol = Math.ceil((topLeft.x + W / cam.zoom) / tw) + 1;
        var endRow = Math.ceil((topLeft.y + H / cam.zoom) / th) + 1;

        for (var row = startRow; row <= endRow; row++) {
            for (var col = startCol; col <= endCol; col++) {
                var sp = worldToScreen(col * tw, row * th);
                ctx.drawImage(tile, sp.x, sp.y, drawW, drawH);
            }
        }
    }

    // ── INPUT ──
    function setupInput() {
        canvas.addEventListener('pointerdown', function(e) {
            dragging = true;
            dragX = e.clientX; dragY = e.clientY;
            camStartX = cam.x; camStartY = cam.y;
            var h = document.getElementById('hint');
            if (h) h.classList.add('hidden');
        });

        window.addEventListener('pointermove', function(e) {
            if (dragging) {
                cam.x = camStartX - (e.clientX - dragX) / cam.zoom;
                cam.y = camStartY - (e.clientY - dragY) / cam.zoom;
            }
        });

        window.addEventListener('pointerup', function() { dragging = false; });

        canvas.addEventListener('wheel', function(e) {
            e.preventDefault();
            var before = screenToWorld(e.clientX, e.clientY);
            cam.targetZoom = Math.max(0.15, Math.min(5.0,
                cam.targetZoom * (1 - e.deltaY * 0.001)));
            cam.zoom += (cam.targetZoom - cam.zoom) * 0.3;
            var after = screenToWorld(e.clientX, e.clientY);
            cam.x -= (after.x - before.x);
            cam.y -= (after.y - before.y);

            var zEl = document.getElementById('zoom-indicator');
            if (zEl) zEl.textContent = cam.zoom.toFixed(1) + 'x';
        }, { passive: false });

        window.addEventListener('keydown', function(e) {
            if (e.key === '0' || e.key === 'Home') {
                cam.x = 0; cam.y = 0; cam.targetZoom = 1.0;
            }
        });
    }

    // ── RESIZE ──
    function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = W;
        canvas.height = H;
        makeStars();
    }

    // ── LOOP ──
    function loop(ts) {
        requestAnimationFrame(loop);
        render(ts * 0.001);
    }

    // ── INIT ──
    async function init() {
        resize();
        window.addEventListener('resize', resize);
        try { await loadTile(); } catch (e) { console.error(e); }
        setupInput();
        var el = document.getElementById('loading');
        if (el) el.classList.add('hidden');
        requestAnimationFrame(loop);
    }

    init();
})();
