// ================================================================
//  CLAWQUEST — 2D Low-Poly Hex Map Prototype
//  Pure Canvas 2D — no Three.js, no WebGL
//  Flat top-down hex map with Polytopia-style art
// ================================================================
'use strict';

// ────────────────────────────────────────────────────────────────
//  CONFIG
// ────────────────────────────────────────────────────────────────
const HEX_SIZE   = 52;        // outer radius (centre → vertex)
const GRID_RADIUS = 7;
const SQRT3 = Math.sqrt(3);

// ────────────────────────────────────────────────────────────────
//  PALETTE
// ────────────────────────────────────────────────────────────────
const PAL = {
    grass:     ['#7ec850','#72bc46','#8ad45e','#66b23c'],
    farmland:  ['#e8c840','#dcbc34','#f0d050','#d4b028'],
    forest:    ['#3e7a2e','#4a8a3a','#347024','#568646'],
    water:     ['#48b0e0','#3ca0d0','#58c0f0','#2e90c0'],
    mine:      ['#a09088','#90807a','#b0a098','#887870'],
    path:      ['#c8a878','#bc9c6c','#d4b484'],
    village:   ['#a8c878','#9cbc6c','#b4d484'],

    wallLight: '#f5e6d0',  wallDark: '#dcc8b0',
    roofRed: '#c45040', roofBlue: '#5878a0', roofGreen: '#608850', roofBrown: '#8c6c4c',
    wood: '#8B6844',  stone: '#9c9c9c',
    trunk: '#7a5c3a', leafDark: '#3a6e28', leafMid: '#4a8a3a', leafLight: '#5ca04a',

    agents: ['#e05040','#9060c0','#40b868','#e8a030','#3898d8'],
    border: ['#ff7060','#b080e0','#60d888'],
};

// ────────────────────────────────────────────────────────────────
//  AGENTS & TERRITORY
// ────────────────────────────────────────────────────────────────
const AGENTS = [
    { id:0, name:"Su'Claw",  color:PAL.agents[0] },
    { id:1, name:"Hexwitch", color:PAL.agents[1] },
    { id:2, name:"Sol Patch",color:PAL.agents[2] },
];
const TERRITORY = {};
[[0,0],[1,0],[0,1],[-1,1],[1,-1],[0,-1],[-1,0]].forEach(([q,r])=>TERRITORY[`${q},${r}`]=0);
[[3,0],[4,0],[3,1],[4,-1]].forEach(([q,r])=>TERRITORY[`${q},${r}`]=1);
[[-3,0],[-4,1],[-3,-1]].forEach(([q,r])=>TERRITORY[`${q},${r}`]=2);

// ────────────────────────────────────────────────────────────────
//  GLOBALS
// ────────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
let W, H;
let camX = 0, camY = 0, zoom = 1;
let hexes = [];   // { q, r, terrain, owner, fort, px, py }
let selected = null;
let agents = [];  // animated characters
let time = 0;
let dragging = false, dragStartX = 0, dragStartY = 0, camStartX = 0, camStartY = 0;

// ────────────────────────────────────────────────────────────────
//  UTILITIES
// ────────────────────────────────────────────────────────────────
function hash(a,b){ const x=Math.sin(a*127.1+b*311.7)*43758.5453; return x-Math.floor(x); }
function pick(arr,seed){ return arr[Math.floor(hash(seed,seed*1.7)*arr.length)]; }

// flat-top hex → pixel
function hexToPixel(q,r){
    return {
        x: HEX_SIZE * 1.5 * q,
        y: HEX_SIZE * SQRT3 * (r + q/2),
    };
}
function hexDist(q1,r1,q2,r2){
    return (Math.abs(q1-q2)+Math.abs(q1+r1-q2-r2)+Math.abs(r1-r2))/2;
}
function hexCorner(cx,cy,i){
    const angle = Math.PI/180 * (60*i);
    return { x: cx + HEX_SIZE*Math.cos(angle), y: cy + HEX_SIZE*Math.sin(angle) };
}
function drawHex(cx,cy,fill,stroke,lw){
    ctx.beginPath();
    for(let i=0;i<6;i++){ const c=hexCorner(cx,cy,i); i===0?ctx.moveTo(c.x,c.y):ctx.lineTo(c.x,c.y); }
    ctx.closePath();
    if(fill){ ctx.fillStyle=fill; ctx.fill(); }
    if(stroke){ ctx.strokeStyle=stroke; ctx.lineWidth=lw||1; ctx.stroke(); }
}

// ────────────────────────────────────────────────────────────────
//  TERRAIN
// ────────────────────────────────────────────────────────────────
function terrainType(q,r){
    const d=hexDist(q,r,0,0), h=hash(q*7919,r*6271);
    if((q===4&&r===3)||(q===5&&r===2)||(q===4&&r===2)||(q===5&&r===3)||(q===3&&r===3)) return 'water';
    if(d>=4&&(q+2*r>=9&&q+2*r<=10)) return 'water';
    if(d===0) return 'village';
    if(d<=2) return h<0.25?'path':'village';
    if(d<=3){ if(h<0.15)return 'path'; if(h<0.35)return 'village'; if(h<0.55)return 'farmland'; return 'grass'; }
    if(d<=5){ if(h<0.15)return 'mine'; if(h<0.35)return 'farmland'; if(h<0.55)return 'forest'; return 'grass'; }
    if(h<0.4)return 'forest'; if(h<0.55)return 'farmland';
    return 'grass';
}

// ────────────────────────────────────────────────────────────────
//  BUILD GRID
// ────────────────────────────────────────────────────────────────
function buildGrid(){
    hexes=[];
    for(let q=-GRID_RADIUS;q<=GRID_RADIUS;q++){
        const r1=Math.max(-GRID_RADIUS,-q-GRID_RADIUS);
        const r2=Math.min(GRID_RADIUS,-q+GRID_RADIUS);
        for(let r=r1;r<=r2;r++){
            const t=terrainType(q,r);
            const p=hexToPixel(q,r);
            const owner=TERRITORY[`${q},${r}`];
            hexes.push({
                q,r, terrain:t,
                owner: owner!==undefined?owner:undefined,
                fort: owner!==undefined? Math.floor(hash(q*99,r*77)*5) : 0,
                px:p.x, py:p.y,
                color: pick(PAL[t]||PAL.grass, q*4219+r*3463),
            });
        }
    }
}

// ────────────────────────────────────────────────────────────────
//  DRAWING — terrain icons & decorations
// ────────────────────────────────────────────────────────────────
function drawTree(x,y,s,type){
    // trunk
    ctx.fillStyle=PAL.trunk;
    ctx.fillRect(x-2*s, y+2*s, 4*s, 8*s);
    if(type==='pine'){
        // 3 triangle layers
        [0,-5,-9].forEach((off,i)=>{
            const w=10-i*2.5, h=8-i;
            ctx.fillStyle=[PAL.leafDark,PAL.leafMid,PAL.leafLight][i];
            ctx.beginPath();
            ctx.moveTo(x, y+off*s-h*s);
            ctx.lineTo(x-w*s, y+off*s+2*s);
            ctx.lineTo(x+w*s, y+off*s+2*s);
            ctx.fill();
        });
    } else {
        // round crown
        ctx.fillStyle=PAL.leafMid;
        ctx.beginPath(); ctx.arc(x, y-4*s, 9*s, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle=PAL.leafLight;
        ctx.beginPath(); ctx.arc(x-3*s, y-6*s, 5*s, 0, Math.PI*2); ctx.fill();
    }
}

function drawHouse(x,y,s){
    const w=14*s, h=10*s;
    // wall
    ctx.fillStyle=PAL.wallLight;
    ctx.fillRect(x-w/2, y-h/2, w, h);
    // roof
    ctx.fillStyle=pick([PAL.roofRed,PAL.roofBlue,PAL.roofGreen,PAL.roofBrown],x*100+y);
    ctx.beginPath();
    ctx.moveTo(x-w/2-3*s, y-h/2);
    ctx.lineTo(x, y-h/2-10*s);
    ctx.lineTo(x+w/2+3*s, y-h/2);
    ctx.fill();
    // door
    ctx.fillStyle=PAL.wood;
    ctx.fillRect(x-2*s, y+h/2-6*s, 4*s, 6*s);
    // window
    ctx.fillStyle='#ffe87c';
    ctx.fillRect(x+4*s, y-h/2+3*s, 3*s, 3*s);
}

function drawWindmill(x,y,s,t){
    // body
    ctx.fillStyle=PAL.wallLight;
    ctx.beginPath(); ctx.arc(x, y, 7*s, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle=PAL.roofBrown;
    ctx.beginPath();
    ctx.moveTo(x-8*s, y-2*s); ctx.lineTo(x, y-14*s); ctx.lineTo(x+8*s, y-2*s);
    ctx.fill();
    // blades
    const angle = t*0.8;
    ctx.save(); ctx.translate(x,y-5*s); ctx.rotate(angle);
    ctx.fillStyle=PAL.wood;
    for(let i=0;i<4;i++){
        ctx.save(); ctx.rotate(i*Math.PI/2);
        ctx.fillRect(-1.5*s, 0, 3*s, 16*s);
        ctx.restore();
    }
    ctx.restore();
}

function drawWell(x,y,s){
    ctx.fillStyle=PAL.stone;
    ctx.beginPath(); ctx.arc(x,y+2*s,5*s,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=PAL.wood;
    ctx.fillRect(x-1.5*s, y-8*s, 3*s, 1.5*s);
    ctx.fillRect(x-5*s, y-6*s, 1.5*s, 9*s);
    ctx.fillRect(x+3.5*s, y-6*s, 1.5*s, 9*s);
    ctx.fillStyle=PAL.roofBrown;
    ctx.beginPath();
    ctx.moveTo(x-6*s,y-6*s); ctx.lineTo(x,y-12*s); ctx.lineTo(x+6*s,y-6*s);
    ctx.fill();
}

function drawMarket(x,y,s){
    const canopyColor=pick(['#e05040','#e8a030','#3898d8','#40b868'],x*300+y);
    // posts
    ctx.fillStyle=PAL.wood;
    [[-7,-4],[7,-4],[-7,4],[7,4]].forEach(([dx,dy])=>{
        ctx.fillRect(x+dx*s-1*s, y+dy*s-1*s, 2*s, 10*s);
    });
    // canopy
    ctx.fillStyle=canopyColor;
    ctx.fillRect(x-9*s, y-6*s, 18*s, 3*s);
    // crates
    ctx.fillStyle=PAL.wood;
    for(let i=-1;i<=1;i++) ctx.fillRect(x+i*5*s-2*s, y+1*s, 4*s, 3*s);
}

function drawMine(x,y,s){
    // rock pile
    ctx.fillStyle='#888078';
    ctx.beginPath(); ctx.arc(x,y+2*s,7*s,Math.PI,0); ctx.fill();
    ctx.fillStyle='#a09890';
    ctx.beginPath(); ctx.arc(x-3*s,y+2*s,4*s,Math.PI,0); ctx.fill();
    ctx.fillStyle='#706860';
    ctx.beginPath(); ctx.arc(x+4*s,y+1*s,3*s,Math.PI,0); ctx.fill();
    // pickaxe
    ctx.strokeStyle='#8B6844'; ctx.lineWidth=2*s;
    ctx.beginPath(); ctx.moveTo(x-3*s,y-8*s); ctx.lineTo(x+5*s,y); ctx.stroke();
    ctx.fillStyle='#607080';
    ctx.beginPath();
    ctx.moveTo(x-3*s,y-8*s); ctx.lineTo(x-7*s,y-5*s); ctx.lineTo(x-1*s,y-6*s);
    ctx.fill();
}

function drawWheat(x,y,s,t){
    const sway = Math.sin(t*1.5+x*0.1)*2*s;
    for(let i=-3;i<=3;i++){
        ctx.strokeStyle=pick(PAL.farmland,i+x);
        ctx.lineWidth=1.5*s;
        ctx.beginPath();
        ctx.moveTo(x+i*4*s, y+6*s);
        ctx.lineTo(x+i*4*s+sway, y-4*s);
        ctx.stroke();
        // grain head
        ctx.fillStyle='#e8c840';
        ctx.beginPath(); ctx.arc(x+i*4*s+sway, y-5*s, 2*s, 0, Math.PI*2); ctx.fill();
    }
}

function drawWaterShimmer(cx,cy,t){
    ctx.globalAlpha=0.15;
    for(let i=0;i<3;i++){
        const ox=Math.sin(t*1.2+i*2)*8;
        const oy=Math.cos(t*0.9+i*3)*5;
        ctx.fillStyle='#fff';
        ctx.beginPath(); ctx.ellipse(cx+ox, cy+oy, 6, 2, t*0.5+i, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
}

function drawFlowers(x,y,s){
    const colors=['#ff6b6b','#ffd93d','#ff8cc8','#6bcfff','#fff'];
    for(let i=0;i<5;i++){
        ctx.fillStyle=colors[i];
        const fx=x+(hash(x+i,y)-0.5)*30*s;
        const fy=y+(hash(y+i,x)-0.5)*20*s;
        ctx.beginPath(); ctx.arc(fx,fy,2*s,0,Math.PI*2); ctx.fill();
    }
}

// ────────────────────────────────────────────────────────────────
//  DRAW AGENTS (little characters)
// ────────────────────────────────────────────────────────────────
function spawnAgents(){
    agents=[];
    const starts = [[0,0,0],[3,0,1],[-3,0,2],[1,1,0],[4,-1,1]];
    starts.forEach(([q,r,ai])=>{
        const p=hexToPixel(q,r);
        agents.push({
            x:p.x, y:p.y,
            agentIdx:ai,
            targetX:p.x, targetY:p.y,
            wait:Math.random()*3,
            speed:18+Math.random()*8,
        });
    });
}

function drawAgent(a,s){
    const c=AGENTS[a.agentIdx].color;
    const bob=Math.sin(time*5+a.x*0.1)*2;
    const ax=a.x, ay=a.y+bob;
    // body
    ctx.fillStyle=c;
    ctx.beginPath(); ctx.ellipse(ax, ay+2*s, 5*s, 7*s, 0, 0, Math.PI*2); ctx.fill();
    // head
    ctx.fillStyle='#ffddb5';
    ctx.beginPath(); ctx.arc(ax, ay-8*s, 5*s, 0, Math.PI*2); ctx.fill();
    // hat
    ctx.fillStyle=c;
    ctx.beginPath();
    ctx.moveTo(ax-5*s, ay-10*s);
    ctx.lineTo(ax, ay-18*s);
    ctx.lineTo(ax+5*s, ay-10*s);
    ctx.fill();
    // eyes
    ctx.fillStyle='#333';
    ctx.beginPath(); ctx.arc(ax-2*s, ay-8*s, 1.2*s, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(ax+2*s, ay-8*s, 1.2*s, 0, Math.PI*2); ctx.fill();
}

function updateAgents(dt){
    agents.forEach(a=>{
        if(a.wait>0){ a.wait-=dt; return; }
        const dx=a.targetX-a.x, dy=a.targetY-a.y;
        const d=Math.sqrt(dx*dx+dy*dy);
        if(d<2){
            // pick new target: random nearby hex
            const nearby=hexes.filter(h=>hexDist(h.q,h.r,0,0)<=4&&h.terrain!=='water');
            const t=nearby[Math.floor(Math.random()*nearby.length)];
            if(t){ a.targetX=t.px; a.targetY=t.py; }
            a.wait=1+Math.random()*3;
        } else {
            const step=a.speed*dt;
            a.x+=dx/d*step;
            a.y+=dy/d*step;
        }
    });
}

// ────────────────────────────────────────────────────────────────
//  TERRITORY BORDERS
// ────────────────────────────────────────────────────────────────
function drawBorders(){
    hexes.forEach(hex=>{
        if(hex.owner===undefined) return;
        const borderColor=PAL.border[hex.owner]||'#fff';
        // check each of the 6 neighbours
        const neighbors=[
            [hex.q+1,hex.r],[hex.q-1,hex.r],[hex.q,hex.r+1],[hex.q,hex.r-1],
            [hex.q+1,hex.r-1],[hex.q-1,hex.r+1]
        ];
        neighbors.forEach((nb,i)=>{
            const nbHex=hexes.find(h=>h.q===nb[0]&&h.r===nb[1]);
            if(!nbHex || nbHex.owner!==hex.owner){
                // draw border edge
                const c1=hexCorner(hex.px,hex.py,i);
                const c2=hexCorner(hex.px,hex.py,(i+1)%6);
                ctx.strokeStyle=borderColor;
                ctx.lineWidth=3;
                ctx.globalAlpha=0.7;
                ctx.beginPath(); ctx.moveTo(c1.x,c1.y); ctx.lineTo(c2.x,c2.y); ctx.stroke();
                ctx.globalAlpha=1;
            }
        });
    });
}

// ────────────────────────────────────────────────────────────────
//  SELECTION
// ────────────────────────────────────────────────────────────────
function selectHex(hex){
    selected=hex;
    const info=document.getElementById('tile-info');
    if(!info) return;
    const emoji={village:'🏡',forest:'🌲',farmland:'🌾',water:'💧',grass:'🌿',path:'🛤️',mine:'⛏️'}[hex.terrain]||'📍';
    const ownerName=hex.owner!==undefined?AGENTS[hex.owner].name:'Unclaimed';
    const typeLabel=hex.terrain[0].toUpperCase()+hex.terrain.slice(1);
    info.innerHTML=`
        <h3>${emoji} Tile (${hex.q}, ${hex.r})</h3>
        <p>Type: ${typeLabel}</p>
        <p>Owner: ${ownerName}</p>
        ${hex.fort?`<p>Fortification: ${hex.fort}</p>`:''}
    `;
}

// ────────────────────────────────────────────────────────────────
//  MAIN DRAW
// ────────────────────────────────────────────────────────────────
function draw(){
    ctx.clearRect(0,0,W,H);

    ctx.save();
    ctx.translate(W/2, H/2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);

    const s = 1; // icon scale

    // ── hex tiles ──
    hexes.forEach(hex=>{
        let fill=hex.color;
        // subtle territory tint
        if(hex.owner!==undefined){
            // draw a slightly larger hex behind for territory
            drawHex(hex.px,hex.py, AGENTS[hex.owner].color+'30', null);
        }
        drawHex(hex.px,hex.py, fill, '#00000018', 1);
    });

    // ── territory borders ──
    drawBorders();

    // ── decorations per terrain ──
    hexes.forEach(hex=>{
        const x=hex.px, y=hex.py, h=hash(hex.q*6151,hex.r*5087);

        if(hex.terrain==='forest'){
            const count=1+Math.floor(h*2.5);
            for(let i=0;i<count;i++){
                const ox=(hash(hex.q*100,hex.r*200+i)-0.5)*HEX_SIZE*0.6;
                const oy=(hash(hex.q*300,hex.r*400+i)-0.5)*HEX_SIZE*0.4;
                drawTree(x+ox, y+oy, s*0.65, h+i*0.3<0.6?'pine':'round');
            }
        }
        if(hex.terrain==='village'){
            if(hex.q===0&&hex.r===0){
                drawWell(x, y, s*0.7);
            } else if(h<0.12){
                drawWindmill(x, y, s*0.65, time);
            } else if(h<0.3){
                drawMarket(x, y, s*0.6);
            } else {
                drawHouse(x, y, s*0.65);
            }
        }
        if(hex.terrain==='farmland'){
            drawWheat(x, y, s*0.55, time);
        }
        if(hex.terrain==='mine'){
            drawMine(x, y, s*0.6);
        }
        if(hex.terrain==='water'){
            drawWaterShimmer(x, y, time);
        }
        if(hex.terrain==='grass'){
            if(h<0.2) drawTree(x+(h-0.1)*HEX_SIZE, y, s*0.45, 'round');
            if(h>0.7) drawFlowers(x, y, s*0.5);
        }
        if(hex.terrain==='path'){
            // subtle dashes
            ctx.fillStyle='#b09060';
            for(let i=-2;i<=2;i++){
                ctx.beginPath();
                ctx.arc(x+i*8, y+((i%2)*4), 2, 0, Math.PI*2);
                ctx.fill();
            }
        }

        // fortification indicator
        if(hex.fort>0 && hex.owner!==undefined){
            ctx.fillStyle=AGENTS[hex.owner].color;
            ctx.globalAlpha=0.5;
            ctx.font=`bold ${10}px Nunito`;
            ctx.textAlign='center';
            ctx.fillText('🛡️'+hex.fort, x+HEX_SIZE*0.35, y-HEX_SIZE*0.35);
            ctx.globalAlpha=1;
        }
    });

    // ── agents ──
    agents.forEach(a=>drawAgent(a, s*0.6));

    // ── selection ring ──
    if(selected){
        ctx.strokeStyle='#ffd700';
        ctx.lineWidth=3;
        ctx.setLineDash([6,4]);
        drawHex(selected.px, selected.py, null, '#ffd700', 3);
        ctx.setLineDash([]);
    }

    ctx.restore();
}

// ────────────────────────────────────────────────────────────────
//  PAN & ZOOM
// ────────────────────────────────────────────────────────────────
function onPointerDown(e){
    dragging=true;
    dragStartX=e.clientX; dragStartY=e.clientY;
    camStartX=camX; camStartY=camY;
}
function onPointerMove(e){
    if(!dragging) return;
    const dx=e.clientX-dragStartX, dy=e.clientY-dragStartY;
    camX=camStartX-dx/zoom;
    camY=camStartY-dy/zoom;
}
function onPointerUp(e){
    const dx=Math.abs(e.clientX-dragStartX), dy=Math.abs(e.clientY-dragStartY);
    dragging=false;
    // if barely moved, treat as click
    if(dx<5 && dy<5) handleClick(e);
}
function handleClick(e){
    // convert screen → world
    const wx = (e.clientX - W/2)/zoom + camX;
    const wy = (e.clientY - H/2)/zoom + camY;
    // find closest hex
    let best=null, bestD=Infinity;
    hexes.forEach(h=>{
        const d=Math.sqrt((h.px-wx)**2+(h.py-wy)**2);
        if(d<bestD&&d<HEX_SIZE){ bestD=d; best=h; }
    });
    if(best) selectHex(best);
}
function onWheel(e){
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = Math.max(0.35, Math.min(3, zoom * factor));
}

document.getElementById('zoom-in').addEventListener('click',()=>{ zoom=Math.min(3,zoom*1.15); });
document.getElementById('zoom-out').addEventListener('click',()=>{ zoom=Math.max(0.35,zoom*0.87); });

// ────────────────────────────────────────────────────────────────
//  RESIZE
// ────────────────────────────────────────────────────────────────
function resize(){
    W=canvas.width=window.innerWidth;
    H=canvas.height=window.innerHeight;
}

// ────────────────────────────────────────────────────────────────
//  ANIMATION LOOP
// ────────────────────────────────────────────────────────────────
let lastTime=0;
function loop(ts){
    requestAnimationFrame(loop);
    const dt=Math.min((ts-lastTime)/1000, 0.1);
    lastTime=ts;
    time=ts/1000;

    updateAgents(dt);
    draw();
}

// ────────────────────────────────────────────────────────────────
//  INIT
// ────────────────────────────────────────────────────────────────
resize();
buildGrid();
spawnAgents();
window.addEventListener('resize', resize);
canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('wheel', onWheel, { passive: false });
requestAnimationFrame(loop);
