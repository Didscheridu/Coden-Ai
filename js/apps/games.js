// js/apps/games.js – fertige Spielvorlagen für den App-Typ "Spiel". Jede Vorlage ist sofort spielbar
// (Tastatur, Maus und Touch), hat Startbildschirm, Punkte, Rekord, Pause und Game Over – und nutzt Coden.game.
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const html = (name, hint, { hud = true } = {}) => `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <title>${esc(name)}</title>
  <link rel="stylesheet" href="coden-kit.css">
  <link rel="stylesheet" href="style.css">
</head>
<body class="game">
  <div id="stage"><canvas id="game"></canvas></div>
  ${hud ? `<div class="hud"><span id="score">0</span><span id="best">Rekord 0</span><button id="pause" aria-label="Pause">❚❚</button></div>` : ''}
  <div id="menu" class="overlay">
    <h1>${esc(name)}</h1>
    <p>${hint}</p>
    <button id="play" class="play">▶ Spielen</button>
  </div>
  <div id="over" class="overlay hidden">
    <h2 id="over-title">Game Over</h2>
    <p id="final"></p>
    <button id="again" class="play">↻ Nochmal</button>
  </div>
  <script src="coden-kit.js"></script>
  <script src="game.js"></script>
</body>
</html>
`;

const css = (a = '#7c5cff', b = '#00d4ff', bg = '#070a14') => `/* Spiel-Layout: Leinwand füllt den Bildschirm, Anzeigen oben, Menüs als Overlay */
html, body { height: 100%; margin: 0; background: ${bg}; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; }
body.game { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; }
#stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
#game { border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, .5); }
.hud { position: fixed; top: calc(12px + env(safe-area-inset-top)); left: 14px; right: 14px; display: flex; gap: 12px; align-items: center; font-weight: 800; font-size: 22px; text-shadow: 0 2px 10px rgba(0, 0, 0, .6); pointer-events: none; z-index: 5; }
.hud #best { font-size: 14px; opacity: .75; margin-right: auto; }
.hud button { pointer-events: auto; width: 42px; height: 42px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, .25); background: rgba(255, 255, 255, .12); color: #fff; font-size: 14px; cursor: pointer; backdrop-filter: blur(6px); }
.overlay { position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 24px; text-align: center; background: radial-gradient(ellipse at center, rgba(20, 24, 50, .78), rgba(5, 7, 16, .92)); backdrop-filter: blur(6px); animation: ov-in .35s ease; }
.overlay.hidden { display: none; }
.overlay h1, .overlay h2 { margin: 0; font-size: clamp(36px, 8vw, 72px); line-height: 1.05; letter-spacing: -1px; background: linear-gradient(90deg, ${a}, ${b}); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 6px 24px ${a}66); }
.overlay p { margin: 0; max-width: 420px; opacity: .85; font-size: 16px; line-height: 1.5; }
.play { margin-top: 8px; padding: 14px 34px; border: 0; border-radius: 999px; font: 800 18px system-ui, sans-serif; color: #fff; background: linear-gradient(90deg, ${a}, ${b}); box-shadow: 0 10px 30px ${a}66; cursor: pointer; transition: transform .15s; }
.play:hover { transform: translateY(-2px) scale(1.03); } .play:active { transform: scale(.97); }
@keyframes ov-in { from { opacity: 0 } to { opacity: 1 } }
`;

// Gemeinsamer Rahmen: Menü, Pause, Game Over, Rekord – das eigentliche Spiel steckt in reset/update/draw
const frame = (key, { w = 960, h = 540, bg = '#0b1020', touch = "{ joystick: true, buttons: [{ key: 'Space', label: 'A' }] }", pixel = false } = {}) => ({
    top: `// ${key} – gebaut mit Coden.game (Schleife, Eingabe, Sound, Partikel). Sag Coden, was du ändern willst!
const G = Coden.game;
const g = G.create({ canvas: '#game', width: ${w}, height: ${h}, background: '${bg}'${pixel ? ', pixel: true' : ''} });
const W = g.w, H = g.h, fx = G.particles(g.ctx);
let state = 'menu', score = 0, best = G.best('${key}', 0);
const $ = (id) => document.getElementById(id);
const menu = G.overlay('#menu'), over = G.overlay('#over');
function setScore(v) { score = Math.max(0, Math.floor(v)); $('score').textContent = score; }
function start() { reset(); setScore(0); state = 'play'; menu.hide(); over.hide(); g.resume(); G.sfx('click'); }
function gameOver(title = 'Game Over') { if (state !== 'play') return; state = 'over'; best = G.best('${key}', score); $('best').textContent = 'Rekord ' + best; $('over-title').textContent = title; $('final').textContent = score + ' Punkte · Rekord ' + best; over.show(); G.sfx(title === 'Game Over' ? 'lose' : 'win'); g.shake(10, .3); }
$('best').textContent = 'Rekord ' + best;
$('play').onclick = start; $('again').onclick = start;
$('pause').onclick = () => { if (state === 'play') { g.toggle(); $('pause').textContent = g.paused ? '▶' : '❚❚'; } };
addEventListener('keydown', (e) => { if (e.code === 'KeyP') $('pause').click(); if ((e.code === 'Enter' || e.code === 'Space') && state !== 'play') start(); });
${touch ? `G.touchControls(${touch});` : ''}
`,
    bottom: `
g.loop((dt, t) => {
  if (state === 'play') update(dt, t);
  fx.update(dt);
  draw(g.ctx, t);
  fx.draw();
});
`
});

function game(key, body, opt) { const f = frame(key, opt); return f.top + '\n' + body.trim() + '\n' + f.bottom; }


// ---------- 3D-Rennspiel (Coden.three) ----------
const racer3dHtml = (name) => `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <title>${esc(name)}</title>
  <link rel="stylesheet" href="coden-kit.css">
  <link rel="stylesheet" href="style.css">
  <script src="https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"></script>
</head>
<body class="game">
  <canvas id="scene"></canvas>
  <div class="hud3d">
    <div class="box"><small>Platz</small><b id="pos">1/6</b></div>
    <div class="box"><small>Runde</small><b id="lap">1/3</b></div>
    <div class="box"><small>Zeit</small><b id="time">0:00.0</b></div>
    <button id="pause" aria-label="Pause">❚❚</button>
  </div>
  <div class="speedo"><b id="kmh">0</b><small>km/h</small><i id="boost"></i></div>
  <div id="count" class="count hidden">3</div>
  <div id="menu" class="overlay">
    <h1>${esc(name)}</h1>
    <p>3 Runden gegen 5 Gegner. Pfeile/WASD fahren, Leertaste driften, Shift Boost. Goldene Münzen laden den Boost auf. Auf dem Handy: Joystick + Knöpfe.</p>
    <button id="play" class="play">▶ Rennen starten</button>
  </div>
  <div id="over" class="overlay hidden">
    <h2 id="over-title">Ziel!</h2>
    <p id="final"></p>
    <button id="again" class="play">↻ Nochmal</button>
  </div>
  <script src="coden-kit.js"></script>
  <script src="game.js"></script>
</body>
</html>
`;
const racer3dCss = () => css('#ff4d4d', '#ffd43b', '#0b1020') + `
#scene { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
.hud3d { position: fixed; top: calc(10px + env(safe-area-inset-top)); left: 10px; right: 10px; display: flex; gap: 8px; z-index: 5; pointer-events: none; }
.hud3d .box { background: rgba(10, 14, 30, .55); backdrop-filter: blur(6px); border: 1px solid rgba(255, 255, 255, .15); border-radius: 12px; padding: 6px 12px; display: flex; flex-direction: column; min-width: 64px; }
.hud3d small { font-size: 11px; opacity: .7; text-transform: uppercase; letter-spacing: .5px; } .hud3d b { font-size: 20px; font-variant-numeric: tabular-nums; }
.hud3d button { margin-left: auto; pointer-events: auto; width: 44px; height: 44px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, .25); background: rgba(255, 255, 255, .12); color: #fff; cursor: pointer; }
.speedo { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); z-index: 5; text-align: right; pointer-events: none; text-shadow: 0 2px 12px rgba(0, 0, 0, .6); }
.speedo b { font-size: clamp(36px, 7vw, 64px); font-variant-numeric: tabular-nums; display: block; line-height: 1; } .speedo small { opacity: .8; }
.speedo i { display: block; height: 6px; margin-top: 6px; border-radius: 6px; background: linear-gradient(90deg, #ffd43b, #ff4d4d); width: 0; transition: width .2s; }
.count { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; font: 900 clamp(80px, 20vw, 180px) system-ui; z-index: 8; pointer-events: none; text-shadow: 0 10px 40px rgba(0, 0, 0, .6); }
@media (hover: none) { .speedo { bottom: auto; top: calc(70px + env(safe-area-inset-top)); } }
`;
const racer3dJs = () => `// 3D-Rennspiel mit Coden.three: Strecke, 6 Autos, KI-Gegner, Runden, Platzierung, Boost, Touch-Steuerung
const $ = (id) => document.getElementById(id);
const C3 = Coden.three, G = Coden.game;
const LAPS = 3;
const w = C3.world({ canvas: '#scene', fogFar: 650 });
const trk = C3.track({ preset: 'circuit', width: 16 }); w.add(trk); trk.decorate(w, 0.6);
for (let i = 0; i < 8; i++) w.add(C3.cloud({ x: G.rand(-300, 300), y: G.rand(70, 110), z: G.rand(-300, 300) }));
const COLORS = [0xd62828, 0x1f6feb, 0x2fbf71, 0xf5a524, 0x8b5cf6, 0xf1f3f5];
const TYPES = ['sport', 'muscle', 'sport', 'hatch', 'suv', 'sport'];
const grid = trk.grid(6);
const cars = grid.map((g, i) => { const c = C3.car({ type: TYPES[i], color: COLORS[i], number: i + 1 }); w.add(c); return c; });
const player = C3.vehicle(cars[0], { maxSpeed: 48 });
const rivals = cars.slice(1).map((c, i) => { const v = C3.vehicle(c, { maxSpeed: 39 + i * 1.6 }); return { v, ai: C3.driver(v, trk, { lane: i % 2 ? 1 : -1, skill: 0.86 + i * 0.025 }) }; });
const racers = [{ v: player, human: true }, ...rivals].map((r, i) => ({ ...r, i, lap: 0, u: 0, last: 0, done: false }));
const coins = trk.checkpoints(30).map((p) => { const c = C3.coin(); c.position.set(p.x + G.rand(-5, 5), 1.2, p.z + G.rand(-5, 5)); w.add(c); return c; });
const steer = C3.input();
const menu = G.overlay('#menu'), over = G.overlay('#over');
let state = 'menu', time = 0, boost = 0, countdown = 0;
w.follow(cars[0], { distance: 9, height: 3.4 }); w.sunFollow(cars[0]);

function reset() {
  racers.forEach((r, i) => { r.v.reset(grid[i].position, grid[i].rotationY); r.lap = 0; r.u = trk.nearest(r.v.object.position).u; r.last = r.u; r.done = false; });
  coins.forEach(c => { c.visible = true; }); time = 0; boost = 0;
}
function start() { reset(); menu.hide(); over.hide(); state = 'count'; countdown = 3.99; G.sfx('click'); }
function fmt(t) { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }
function progress(r) { const n = trk.nearest(r.v.object.position, r.u); if (r.last > 0.85 && n.u < 0.15) r.lap++; else if (r.last < 0.15 && n.u > 0.85) r.lap--; r.last = r.u = n.u; return n; }
function finish() {
  state = 'over'; const place = 1 + racers.filter(r => !r.human && r.lap + r.u > racers[0].lap + racers[0].u).length;
  const key = 'best-time'; const best = Coden.store.get(key, 0); const nb = !best || time < best; if (nb) Coden.store.set(key, time);
  $('over-title').textContent = place === 1 ? '🏆 Sieg!' : 'Platz ' + place;
  $('final').textContent = 'Zeit ' + fmt(time) + (nb ? ' · neuer Rekord!' : ' · Rekord ' + fmt(best));
  over.show(); G.sfx(place === 1 ? 'win' : 'lose');
}
w.loop((dt, t) => {
  C3.animate(coins, t);
  if (state === 'count') { countdown -= dt; const n = Math.ceil(countdown); $('count').classList.remove('hidden'); $('count').textContent = n > 0 ? n : 'LOS!'; if (countdown <= -0.6) { $('count').classList.add('hidden'); state = 'race'; } return; }
  if (state !== 'race') { rivals.forEach(r => r.v.update(dt, state === 'menu' ? r.ai() : { y: 0 })); return; }
  time += dt;
  const input = steer(); input.boost = input.boost && boost > 0; if (input.boost) boost = Math.max(0, boost - dt);
  player.update(dt, input);
  rivals.forEach(r => r.v.update(dt, r.ai()));
  racers.forEach(r => { const n = progress(r); if (!trk.onTrack(r.v.object.position, r.u)) r.v.velocity.multiplyScalar(1 - Math.min(1, 1.6 * dt)); });
  coins.forEach(c => { if (c.visible && C3.near(c, cars[0], 3)) { c.visible = false; boost = Math.min(4, boost + 1.2); player.addBoost(1.2); G.sfx('coin'); } });
  const me = racers[0]; const place = 1 + racers.filter(r => !r.human && r.lap + r.u > me.lap + me.u).length;
  $('pos').textContent = place + '/' + racers.length; $('lap').textContent = Math.min(LAPS, me.lap + 1) + '/' + LAPS; $('time').textContent = fmt(time);
  $('kmh').textContent = player.kmh; $('boost').style.width = (boost / 4 * 100) + '%';
  if (me.lap >= LAPS) finish();
});
reset();
$('play').onclick = start; $('again').onclick = start;
$('pause').onclick = () => { if (state !== 'race') return; if (w.paused) { w.resume(); $('pause').textContent = '❚❚'; } else { w.pause(); $('pause').textContent = '▶'; } };
addEventListener('keydown', (e) => { if (e.code === 'KeyP') $('pause').click(); if (e.code === 'Enter' && (state === 'menu' || state === 'over')) start(); });
`;

export const GAME_TEMPLATES = [
    {
        id: 'racer3d', name: '3D-Rennen', emoji: '🏎️', g: 'linear-gradient(135deg,#e03131,#f59f00)', desc: '3D-Rennspiel: Strecke, 5 KI-Gegner, Runden, Drift, Boost – mit Coden.three.',
        hint: '', files: (name) => ({ 'index.html': racer3dHtml(name), 'style.css': racer3dCss(), 'game.js': racer3dJs() })
    },
    {
        id: 'starter', name: 'Leeres Spiel', emoji: '✨', g: 'linear-gradient(135deg,#4c6ef5,#15aabf)', desc: 'Startpunkt: Figur sammelt Sterne – Coden baut daraus dein Spiel.',
        hint: 'Sammle die Sterne! Steuerung: Pfeiltasten / WASD oder Joystick.',
        code: () => game('starter', `
const player = { x: W / 2, y: H / 2, r: 18, speed: 320 };
let stars = [];
function reset() { player.x = W / 2; player.y = H / 2; stars = Array.from({ length: 5 }, spawn); }
function spawn() { return { x: G.rand(40, W - 40), y: G.rand(40, H - 40), r: 12, t: Math.random() * 6 }; }
function update(dt) {
  const a = G.axis(); player.x = G.clamp(player.x + a.x * player.speed * dt, player.r, W - player.r); player.y = G.clamp(player.y + a.y * player.speed * dt, player.r, H - player.r);
  stars.forEach((s, i) => { s.t += dt; if (G.dist(s, player) < s.r + player.r) { setScore(score + 1); fx.burst(s.x, s.y, { color: '#ffd43b' }); G.sfx('coin'); stars[i] = spawn(); } });
}
function draw(c, t) {
  stars.forEach(s => { c.save(); c.translate(s.x, s.y); c.rotate(s.t); c.fillStyle = '#ffd43b'; c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? s.r * .45 : s.r; c.lineTo(Math.cos(i * Math.PI / 5) * r, Math.sin(i * Math.PI / 5) * r); } c.fill(); c.restore(); });
  c.fillStyle = '#4dabf7'; c.beginPath(); c.arc(player.x, player.y, player.r, 0, 7); c.fill();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(player.x + 6, player.y - 5, 4, 0, 7); c.fill();
}
reset();`)
    },
    {
        id: 'platformer', name: 'Hüpf-Held', emoji: '🏃', g: 'linear-gradient(135deg,#40c057,#fab005)', desc: 'Jump & Run: springen, Münzen sammeln, Stacheln ausweichen – endlos.',
        hint: 'Lauf so weit du kannst! ← → bewegen, Leertaste / ↑ springen.', a: '#51cf66', b: '#fcc419',
        code: () => game('platformer', `
const P = { x: 120, y: 0, w: 34, h: 44, vx: 0, vy: 0, ground: false, jumps: 0 };
let plats = [], coins = [], spikes = [], camX = 0, far = 0;
function reset() { P.x = 120; P.y = 300; P.vx = P.vy = 0; camX = 0; far = 0; plats = [{ x: -200, y: 460, w: 900, h: 80 }]; coins = []; spikes = []; while (far < 3000) addChunk(); }
function addChunk() { const last = plats[plats.length - 1]; const gap = G.rand(70, 180 + Math.min(120, camX / 40)); const w = G.rand(160, 360); const y = G.clamp(last.y + G.rand(-110, 90), 220, 480); const p = { x: last.x + last.w + gap, y, w, h: 600 }; plats.push(p); far = p.x + p.w;
  for (let i = 0; i < 3; i++) if (Math.random() < .6) coins.push({ x: p.x + 30 + i * (w - 60) / 2, y: y - 70 - Math.random() * 40, w: 18, h: 18, got: false });
  if (w > 220 && Math.random() < .5) spikes.push({ x: p.x + w / 2 - 20, y: y - 18, w: 40, h: 18 }); }
function update(dt) {
  const a = G.axis(); P.vx = G.lerp(P.vx, a.x * 340, .18); P.vy += 1800 * dt;
  if ((G.pressed('Space') || G.pressed('ArrowUp') || G.pressed('KeyW')) && P.jumps < 2) { P.vy = -720; P.jumps++; G.sfx('jump'); fx.burst(P.x + P.w / 2, P.y + P.h, { color: '#e9ecef', n: 8, speed: 90 }); }
  P.x += P.vx * dt; P.y += P.vy * dt; P.ground = false;
  for (const p of plats) if (G.hit(P, p) && P.vy >= 0 && P.y + P.h - P.vy * dt <= p.y + 4) { P.y = p.y - P.h; P.vy = 0; P.ground = true; P.jumps = 0; }
  for (const c of coins) if (!c.got && G.hit(P, c)) { c.got = true; setScore(score + 10); G.sfx('coin'); fx.burst(c.x + 9, c.y + 9, { color: '#fcc419', n: 12 }); }
  for (const s of spikes) if (G.hit({ x: P.x + 6, y: P.y + 10, w: P.w - 12, h: P.h - 10 }, s)) return gameOver();
  if (P.y > H + 200) return gameOver();
  camX = Math.max(camX, P.x - 300); P.x = Math.max(P.x, camX);
  if (far - camX < 2000) addChunk();
  plats = plats.filter(p => p.x + p.w > camX - 400); coins = coins.filter(c => c.x > camX - 400); spikes = spikes.filter(s => s.x > camX - 400);
  setScore(Math.max(score, Math.floor(camX / 20) + coins.filter(c => c.got).length * 10));
}
function draw(c, t) {
  const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#74c0fc'); sky.addColorStop(1, '#d0ebff'); c.fillStyle = sky; c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 6; i++) { const x = ((i * 300 - camX * .3) % 1800 + 1800) % 1800 - 200; c.beginPath(); c.ellipse(x, 80 + (i % 3) * 40, 70, 24, 0, 0, 7); c.fill(); }
  c.save(); c.translate(-camX, 0);
  for (const p of plats) { c.fillStyle = '#8d5524'; c.fillRect(p.x, p.y, p.w, p.h); c.fillStyle = '#51cf66'; c.fillRect(p.x, p.y, p.w, 14); }
  for (const s of spikes) { c.fillStyle = '#868e96'; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(s.x + i * 10, s.y + s.h); c.lineTo(s.x + i * 10 + 5, s.y); c.lineTo(s.x + i * 10 + 10, s.y + s.h); c.fill(); } }
  for (const k of coins) if (!k.got) { c.fillStyle = '#fcc419'; c.beginPath(); c.ellipse(k.x + 9, k.y + 9 + Math.sin(t * 4 + k.x) * 3, 9 * Math.abs(Math.cos(t * 3 + k.x)) + 2, 9, 0, 0, 7); c.fill(); }
  c.fillStyle = '#e8590c'; c.fillRect(P.x, P.y, P.w, P.h); c.fillStyle = '#fff'; c.fillRect(P.x + (P.vx >= 0 ? 20 : 6), P.y + 10, 8, 8); c.fillStyle = '#212529'; c.fillRect(P.x + (P.vx >= 0 ? 24 : 8), P.y + 12, 4, 4);
  c.restore();
}
reset();`, { bg: '#74c0fc' })
    },
    {
        id: 'shooter', name: 'Sternenjäger', emoji: '🚀', g: 'linear-gradient(135deg,#5f3dc4,#e64980)', desc: 'Weltraum-Shooter: Wellen von Gegnern, Leben, Explosionen.',
        hint: 'Zerstöre die Gegner! Bewegen mit Pfeilen / WASD, schießen mit Leertaste.', a: '#9775fa', b: '#f06595',
        code: () => game('shooter', `
const ship = { x: W / 2, y: H - 70, w: 40, h: 40 }; let shots = [], foes = [], lives = 3, cool = 0, spawnT = 0, inv = 0;
const stars = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 2 + .5 }));
function reset() { ship.x = W / 2; shots = []; foes = []; lives = 3; spawnT = 0; inv = 0; }
function update(dt, t) {
  const a = G.axis(); ship.x = G.clamp(ship.x + a.x * 420 * dt, 24, W - 24); ship.y = G.clamp(ship.y + a.y * 320 * dt, H / 2, H - 30);
  cool -= dt; inv -= dt;
  if ((G.keys.has('Space') || G.pointer.down) && cool <= 0) { shots.push({ x: ship.x - 2, y: ship.y - 24, w: 4, h: 14 }); cool = .16; G.sfx('shoot'); }
  spawnT -= dt; if (spawnT <= 0) { const big = Math.random() < .15; foes.push({ x: G.rand(30, W - 70), y: -50, w: big ? 64 : 38, h: big ? 50 : 32, hp: big ? 4 : 1, vy: G.rand(70, 120) + t * 2, vx: G.rand(-40, 40), big }); spawnT = Math.max(.25, 1 - t / 80); }
  shots.forEach(s => s.y -= 700 * dt); shots = shots.filter(s => s.y > -20);
  for (const f of foes) { f.y += f.vy * dt; f.x += Math.sin(t * 2 + f.y / 50) * f.vx * dt; for (const s of shots) if (!s.dead && G.hit(s, f)) { s.dead = true; f.hp--; fx.burst(s.x, s.y, { color: '#ffd8a8', n: 6 }); if (f.hp <= 0) { f.dead = true; setScore(score + (f.big ? 50 : 10)); fx.burst(f.x + f.w / 2, f.y + f.h / 2, { color: f.big ? '#f06595' : '#ffa94d', n: 26, speed: 260 }); G.sfx('boom'); g.shake(f.big ? 9 : 4, .15); } }
    if (!f.dead && inv <= 0 && G.hit({ x: ship.x - 16, y: ship.y - 16, w: 32, h: 32 }, f)) { f.dead = true; lives--; inv = 1.5; G.sfx('hit'); g.shake(14, .3); fx.burst(ship.x, ship.y, { color: '#74c0fc', n: 30 }); if (lives <= 0) return gameOver(); }
    if (f.y > H + 40) { f.dead = true; setScore(score - 5); } }
  shots = shots.filter(s => !s.dead); foes = foes.filter(f => !f.dead);
}
function draw(c, t) {
  c.fillStyle = '#fff'; for (const s of stars) { s.y = (s.y + s.s * 60 / 60) % H; c.globalAlpha = s.s / 2.5; c.fillRect(s.x, s.y, s.s, s.s); } c.globalAlpha = 1;
  c.fillStyle = '#ffe066'; shots.forEach(s => c.fillRect(s.x, s.y, s.w, s.h));
  for (const f of foes) { c.fillStyle = f.big ? '#e64980' : '#ff922b'; c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(f.x + f.w, f.y); c.lineTo(f.x + f.w / 2, f.y + f.h); c.fill(); c.fillStyle = '#fff3'; c.fillRect(f.x + f.w * .3, f.y + 6, f.w * .4, 6); }
  if (inv <= 0 || Math.floor(t * 12) % 2) { c.save(); c.translate(ship.x, ship.y); c.fillStyle = '#74c0fc'; c.beginPath(); c.moveTo(0, -24); c.lineTo(20, 18); c.lineTo(0, 10); c.lineTo(-20, 18); c.fill(); c.fillStyle = '#ffa94d'; c.fillRect(-5, 14, 10, 6 + Math.random() * 10); c.restore(); }
  c.fillStyle = '#ff6b6b'; c.font = '20px system-ui'; c.fillText('♥'.repeat(Math.max(0, lives)), W - 90, 32);
}
reset();`, { bg: '#060816', touch: "{ joystick: true, buttons: [{ key: 'Space', label: '🔥' }] }" })
    },
    {
        id: 'breakout', name: 'Ziegel-Knaller', emoji: '🧱', g: 'linear-gradient(135deg,#f76707,#d6336c)', desc: 'Breakout: Ball, Schläger, bunte Steine und Level.',
        hint: 'Zerstöre alle Steine! Schläger mit ← → oder Maus / Finger.', a: '#ff922b', b: '#f06595',
        code: () => game('breakout', `
const pad = { x: W / 2 - 60, y: H - 34, w: 120, h: 14 }; let ball, bricks = [], level = 1, lives = 3, stuck = true;
const COLORS = ['#ff6b6b', '#ff922b', '#fcc419', '#51cf66', '#339af0', '#845ef7'];
function build() { bricks = []; const rows = Math.min(6, 3 + level); for (let r = 0; r < rows; r++) for (let i = 0; i < 12; i++) bricks.push({ x: 30 + i * 75, y: 60 + r * 30, w: 68, h: 22, c: COLORS[r % 6], hp: r < level - 2 ? 2 : 1 }); }
function serve() { stuck = true; ball = { x: pad.x + pad.w / 2, y: pad.y - 10, r: 8, vx: 0, vy: 0 }; }
function reset() { level = 1; lives = 3; build(); serve(); }
function update(dt) {
  const a = G.axis(); if (a.x) pad.x += a.x * 600 * dt; else if (G.pointer.down || G.pointer.clicked) pad.x = G.pointer.x - pad.w / 2; pad.x = G.clamp(pad.x, 0, W - pad.w);
  if (stuck) { ball.x = pad.x + pad.w / 2; ball.y = pad.y - 10; if (G.pressed('Space') || G.pointer.clicked || G.pressed('ArrowUp')) { stuck = false; const sp = 380 + level * 30; ball.vx = G.rand(-.5, .5) * sp; ball.vy = -sp; } return; }
  ball.x += ball.vx * dt; ball.y += ball.vy * dt;
  if (ball.x < ball.r || ball.x > W - ball.r) { ball.vx *= -1; ball.x = G.clamp(ball.x, ball.r, W - ball.r); G.sfx('click'); }
  if (ball.y < ball.r) { ball.vy = Math.abs(ball.vy); G.sfx('click'); }
  if (ball.vy > 0 && G.hit({ x: ball.x - ball.r, y: ball.y - ball.r, w: ball.r * 2, h: ball.r * 2 }, pad)) { const k = (ball.x - (pad.x + pad.w / 2)) / (pad.w / 2); const sp = Math.hypot(ball.vx, ball.vy) * 1.01; ball.vx = sp * k * .8; ball.vy = -Math.sqrt(Math.max(1, sp * sp - ball.vx * ball.vx)); G.sfx('jump'); }
  for (const b of bricks) if (!b.dead && G.hit({ x: ball.x - ball.r, y: ball.y - ball.r, w: ball.r * 2, h: ball.r * 2 }, b)) { b.hp--; ball.vy *= -1; if (b.hp <= 0) { b.dead = true; setScore(score + 10 * level); fx.burst(b.x + b.w / 2, b.y + b.h / 2, { color: b.c, n: 14 }); G.sfx('coin'); } break; }
  bricks = bricks.filter(b => !b.dead);
  if (!bricks.length) { level++; G.sfx('win'); build(); serve(); }
  if (ball.y > H + 20) { lives--; G.sfx('hit'); g.shake(8, .25); if (lives <= 0) return gameOver(); serve(); }
}
function draw(c) {
  for (const b of bricks) { c.fillStyle = b.c; c.globalAlpha = b.hp > 1 ? 1 : .9; c.beginPath(); c.roundRect(b.x, b.y, b.w, b.h, 6); c.fill(); } c.globalAlpha = 1;
  c.fillStyle = '#e9ecef'; c.beginPath(); c.roundRect(pad.x, pad.y, pad.w, pad.h, 7); c.fill();
  c.fillStyle = '#fff'; c.shadowColor = '#fff'; c.shadowBlur = 14; c.beginPath(); c.arc(ball.x, ball.y, ball.r, 0, 7); c.fill(); c.shadowBlur = 0;
  c.fillStyle = '#adb5bd'; c.font = '16px system-ui'; c.fillText('Level ' + level + '   ♥ ' + lives, W - 160, 30);
  if (stuck && state === 'play') { c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText('Tippen oder Leertaste zum Abschlagen', W / 2, H / 2 + 80); c.textAlign = 'left'; }
}
reset();`, { bg: '#141625', touch: "{ joystick: true, buttons: [{ key: 'Space', label: '⬆' }] }" })
    },
    {
        id: 'flappy', name: 'Flatter-Vogel', emoji: '🐤', g: 'linear-gradient(135deg,#1098ad,#94d82d)', desc: 'Tippen zum Flattern, durch die Lücken fliegen.',
        hint: 'Flieg durch die Lücken! Tippen, Klicken oder Leertaste zum Flattern.', a: '#3bc9db', b: '#94d82d',
        code: () => game('flappy', `
const bird = { x: 220, y: H / 2, vy: 0, r: 18 }; let pipes = [], timer = 0;
function reset() { bird.y = H / 2; bird.vy = 0; pipes = []; timer = 0; }
function flap() { bird.vy = -520; G.sfx('jump'); fx.burst(bird.x - 10, bird.y + 8, { color: '#fff', n: 5, speed: 60, life: .3 }); }
function update(dt) {
  if (G.pressed('Space') || G.pressed('ArrowUp') || G.pointer.clicked) flap();
  bird.vy += 1500 * dt; bird.y += bird.vy * dt;
  timer -= dt; if (timer <= 0) { const gap = Math.max(150, 220 - score * 3); const top = G.rand(60, H - 60 - gap); pipes.push({ x: W + 40, top, gap, w: 80, scored: false }); timer = 1.45; }
  for (const p of pipes) { p.x -= (240 + score * 4) * dt; if (!p.scored && p.x + p.w < bird.x) { p.scored = true; setScore(score + 1); G.sfx('coin'); }
    const b = { x: bird.x - bird.r + 4, y: bird.y - bird.r + 4, w: bird.r * 2 - 8, h: bird.r * 2 - 8 };
    if (G.hit(b, { x: p.x, y: 0, w: p.w, h: p.top }) || G.hit(b, { x: p.x, y: p.top + p.gap, w: p.w, h: H })) { fx.burst(bird.x, bird.y, { color: '#ffd43b', n: 24 }); return gameOver(); } }
  pipes = pipes.filter(p => p.x > -120);
  if (bird.y > H - 40 || bird.y < -40) return gameOver();
}
function draw(c, t) {
  const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#3bc9db'); sky.addColorStop(1, '#c5f6fa'); c.fillStyle = sky; c.fillRect(0, 0, W, H);
  for (const p of pipes) { c.fillStyle = '#74b816'; c.fillRect(p.x, 0, p.w, p.top); c.fillRect(p.x, p.top + p.gap, p.w, H); c.fillStyle = '#5c940d'; c.fillRect(p.x - 6, p.top - 26, p.w + 12, 26); c.fillRect(p.x - 6, p.top + p.gap, p.w + 12, 26); }
  c.fillStyle = '#e9d8a6'; c.fillRect(0, H - 40, W, 40); c.fillStyle = '#94d82d'; c.fillRect(0, H - 40, W, 8);
  c.save(); c.translate(bird.x, bird.y); c.rotate(G.clamp(bird.vy / 900, -.5, .9));
  c.fillStyle = '#ffd43b'; c.beginPath(); c.arc(0, 0, bird.r, 0, 7); c.fill(); c.fillStyle = '#fab005'; c.beginPath(); c.ellipse(-6, 4 + Math.sin(t * 20) * 4, 10, 6, 0, 0, 7); c.fill();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(7, -6, 6, 0, 7); c.fill(); c.fillStyle = '#000'; c.beginPath(); c.arc(9, -6, 3, 0, 7); c.fill(); c.fillStyle = '#ff922b'; c.beginPath(); c.moveTo(14, 0); c.lineTo(26, 4); c.lineTo(14, 8); c.fill();
  c.restore();
}
reset();`, { bg: '#3bc9db', touch: '' })
    },
    {
        id: 'snake', name: 'Schlange', emoji: '🐍', g: 'linear-gradient(135deg,#2b8a3e,#69db7c)', desc: 'Snake-Klassiker mit Wischen, Tempo und Bonusfutter.',
        hint: 'Friss das Futter, beiß dich nicht selbst! Pfeiltasten / WASD oder wischen.', a: '#69db7c', b: '#ffd43b',
        code: () => game('snake', `
const C = 30, COLS = Math.floor(W / C), ROWS = Math.floor(H / C);
let snake, dir, next, food, bonus, stepT, speed;
function reset() { snake = [{ x: 8, y: 9 }, { x: 7, y: 9 }, { x: 6, y: 9 }]; dir = { x: 1, y: 0 }; next = dir; stepT = 0; speed = 8; bonus = null; placeFood(); }
function free() { let p; do { p = { x: G.randInt(0, COLS - 1), y: G.randInt(0, ROWS - 1) }; } while (snake.some(s => s.x === p.x && s.y === p.y)); return p; }
function placeFood() { food = free(); }
function turn(x, y) { if (x === -dir.x && y === -dir.y) return; next = { x, y }; }
addEventListener('keydown', (e) => { const m = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] }[e.code]; if (m) turn(...m); });
G.onSwipe((d) => turn(...{ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d]));
function update(dt) {
  stepT += dt; if (stepT < 1 / speed) return; stepT = 0; dir = next;
  const head = { x: (snake[0].x + dir.x + COLS) % COLS, y: (snake[0].y + dir.y + ROWS) % ROWS };
  if (snake.some(s => s.x === head.x && s.y === head.y)) return gameOver();
  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) { setScore(score + 10); speed = Math.min(20, speed + .4); G.sfx('coin'); fx.burst(head.x * C + C / 2, head.y * C + C / 2, { color: '#ff6b6b' }); placeFood(); if (!bonus && Math.random() < .25) bonus = { ...free(), t: 6 }; }
  else if (bonus && head.x === bonus.x && head.y === bonus.y) { setScore(score + 50); G.sfx('power'); fx.burst(head.x * C + C / 2, head.y * C + C / 2, { color: '#ffd43b', n: 30 }); bonus = null; }
  else snake.pop();
  if (bonus && (bonus.t -= 1 / speed) <= 0) bonus = null;
}
function draw(c, t) {
  c.fillStyle = '#0f2417'; c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(255,255,255,.03)'; for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) if ((x + y) % 2) c.fillRect(x * C, y * C, C, C);
  c.fillStyle = '#ff6b6b'; c.beginPath(); c.arc(food.x * C + C / 2, food.y * C + C / 2, C / 2.6 + Math.sin(t * 6) * 1.5, 0, 7); c.fill();
  if (bonus) { c.fillStyle = '#ffd43b'; c.beginPath(); c.arc(bonus.x * C + C / 2, bonus.y * C + C / 2, C / 2.2, 0, 7); c.fill(); }
  snake.forEach((s, i) => { c.fillStyle = i === 0 ? '#8ce99a' : 'hsl(' + (130 - i * 2) + ',60%,' + (55 - Math.min(20, i)) + '%)'; c.beginPath(); c.roundRect(s.x * C + 2, s.y * C + 2, C - 4, C - 4, 8); c.fill(); });
  const h = snake[0]; c.fillStyle = '#000'; c.beginPath(); c.arc(h.x * C + C / 2 + dir.x * 6 - dir.y * 6, h.y * C + C / 2 + dir.y * 6 - dir.x * 6, 3, 0, 7); c.arc(h.x * C + C / 2 + dir.x * 6 + dir.y * 6, h.y * C + C / 2 + dir.y * 6 + dir.x * 6, 3, 0, 7); c.fill();
}
reset();`, { w: 960, h: 540, bg: '#0f2417', touch: '' })
    },
    {
        id: '2048', name: '2048', emoji: '🔢', g: 'linear-gradient(135deg,#e8590c,#f59f00)', desc: 'Zahlen-Puzzle: schieben, verbinden, die 2048 erreichen.',
        hint: 'Schiebe die Kacheln mit Pfeiltasten oder Wischen. Gleiche Zahlen verschmelzen!', a: '#ff922b', b: '#fcc419',
        code: () => game('2048', `
const N = 4, S = 110, GAP = 12, OX = (W - (N * S + (N + 1) * GAP)) / 2, OY = (H - (N * S + (N + 1) * GAP)) / 2;
let grid, anim = 0;
const COL = { 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' };
function reset() { grid = Array.from({ length: N }, () => Array(N).fill(0)); add(); add(); }
function add() { const e = []; grid.forEach((r, y) => r.forEach((v, x) => !v && e.push([x, y]))); if (!e.length) return; const [x, y] = G.pick(e); grid[y][x] = Math.random() < .9 ? 2 : 4; }
function slide(row) { const a = row.filter(Boolean); for (let i = 0; i < a.length - 1; i++) if (a[i] === a[i + 1]) { a[i] *= 2; setScore(score + a[i]); a.splice(i + 1, 1); if (a[i] === 2048) setTimeout(() => gameOver('Gewonnen! 🎉'), 300); } while (a.length < N) a.push(0); return a; }
function move(d) {
  if (state !== 'play') return; const before = JSON.stringify(grid);
  for (let i = 0; i < N; i++) {
    let line = d === 'left' || d === 'right' ? grid[i].slice() : grid.map(r => r[i]);
    if (d === 'right' || d === 'down') line.reverse(); line = slide(line); if (d === 'right' || d === 'down') line.reverse();
    if (d === 'left' || d === 'right') grid[i] = line; else line.forEach((v, y) => grid[y][i] = v);
  }
  if (JSON.stringify(grid) !== before) { add(); anim = 1; G.sfx('click'); if (!canMove()) setTimeout(() => gameOver(), 400); }
}
function canMove() { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const v = grid[y][x]; if (!v || (x < N - 1 && grid[y][x + 1] === v) || (y < N - 1 && grid[y + 1][x] === v)) return true; } return false; }
addEventListener('keydown', (e) => { const d = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' }[e.code]; if (d) move(d); });
G.onSwipe(move);
function update(dt) { anim = Math.max(0, anim - dt * 6); }
function draw(c) {
  c.fillStyle = '#faf8ef'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#bbada0'; c.beginPath(); c.roundRect(OX, OY, N * S + (N + 1) * GAP, N * S + (N + 1) * GAP, 14); c.fill();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  grid.forEach((r, y) => r.forEach((v, x) => { const px = OX + GAP + x * (S + GAP), py = OY + GAP + y * (S + GAP); const k = v ? 1 + anim * .04 : 1;
    c.fillStyle = v ? (COL[v] || '#3c3a32') : 'rgba(238,228,218,.35)'; c.beginPath(); c.roundRect(px + S / 2 - S * k / 2, py + S / 2 - S * k / 2, S * k, S * k, 10); c.fill();
    if (v) { c.fillStyle = v <= 4 ? '#776e65' : '#f9f6f2'; c.font = '800 ' + (v < 100 ? 48 : v < 1000 ? 40 : 32) + 'px system-ui'; c.fillText(v, px + S / 2, py + S / 2 + 2); } }));
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
}
reset();`, { bg: '#faf8ef', touch: '' })
    },
    {
        id: 'memory', name: 'Paare finden', emoji: '🃏', g: 'linear-gradient(135deg,#7048e8,#3bc9db)', desc: 'Memory mit Emojis, Zügen und Zeit – perfekt fürs Handy.',
        hint: 'Finde alle Paare! Tippe zwei Karten an. Je weniger Züge, desto mehr Punkte.', a: '#9775fa', b: '#66d9e8',
        code: () => game('memory', `
const EMO = ['🐶', '🐱', '🦊', '🐼', '🐸', '🦄', '🐙', '🍕', '🚀', '⚽', '🎸', '🌈'];
const COLS = 6, ROWS = 4, CW = 120, CH = 110, GAP = 14, OX = (W - (COLS * CW + (COLS - 1) * GAP)) / 2, OY = (H - (ROWS * CH + (ROWS - 1) * GAP)) / 2;
let cards = [], open = [], moves = 0, time = 0, lock = 0;
function reset() { const set = EMO.slice().sort(() => Math.random() - .5).slice(0, COLS * ROWS / 2); cards = [...set, ...set].sort(() => Math.random() - .5).map((e, i) => ({ e, x: OX + (i % COLS) * (CW + GAP), y: OY + Math.floor(i / COLS) * (CH + GAP), w: CW, h: CH, up: false, done: false, flip: 0 })); open = []; moves = 0; time = 0; }
function update(dt) {
  time += dt; lock -= dt; cards.forEach(c => c.flip = G.lerp(c.flip, c.up || c.done ? 1 : 0, .25));
  if (G.pointer.clicked && lock <= 0) { const p = { x: G.pointer.x, y: G.pointer.y, w: 1, h: 1 }; const c = cards.find(k => !k.up && !k.done && G.hit(p, k)); if (c && open.length < 2) { c.up = true; open.push(c); G.sfx('click');
    if (open.length === 2) { moves++; const [a, b] = open; if (a.e === b.e) { a.done = b.done = true; open = []; G.sfx('coin'); fx.burst(a.x + CW / 2, a.y + CH / 2, { color: '#ffd43b' }); fx.burst(b.x + CW / 2, b.y + CH / 2, { color: '#ffd43b' }); setScore(Math.max(0, 1000 - moves * 20 - Math.floor(time) * 2)); if (cards.every(k => k.done)) setTimeout(() => gameOver('Geschafft! 🎉'), 500); } else { lock = .8; setTimeout(() => { a.up = b.up = false; open = []; }, 800); } } } }
}
function draw(c) {
  const bg = c.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#2b1d5c'); bg.addColorStop(1, '#0b3b4a'); c.fillStyle = bg; c.fillRect(0, 0, W, H);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const k of cards) { const s = Math.abs(Math.cos(k.flip * Math.PI)); const face = k.flip > .5; c.save(); c.translate(k.x + CW / 2, k.y + CH / 2); c.scale(Math.max(.05, s), 1);
    c.fillStyle = face ? (k.done ? '#d3f9d8' : '#fff') : '#7048e8'; c.beginPath(); c.roundRect(-CW / 2, -CH / 2, CW, CH, 14); c.fill();
    if (face) { c.font = '54px system-ui'; c.fillText(k.e, 0, 4); } else { c.fillStyle = 'rgba(255,255,255,.25)'; c.font = '800 40px system-ui'; c.fillText('?', 0, 2); } c.restore(); }
  c.fillStyle = '#fff'; c.font = '16px system-ui'; c.fillText('Züge ' + moves + ' · ' + Math.floor(time) + ' s', W / 2, H - 16);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
}
reset();`, { bg: '#2b1d5c', touch: '' })
    }
];

// Dateien einer Vorlage
export function gameFiles(id, name) {
    const t = GAME_TEMPLATES.find(x => x.id === id) || GAME_TEMPLATES.find(x => x.id === 'starter');
    if (t.files) return t.files(name || t.name);
    return { 'index.html': html(name || t.name, t.hint), 'style.css': css(t.a, t.b), 'game.js': t.code() };
}
