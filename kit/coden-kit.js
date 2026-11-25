/* Coden-Kit 1.1 – kleine Helfer für Apps aus Coden (Bildschirme, Tabs, Toasts, Sheets, Speicher, Datenbank, Spiele). */
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const listeners = {}; const stack = [];
  const platform = document.documentElement.dataset.platform || (/iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'web');
  if (!document.documentElement.dataset.platform) document.documentElement.dataset.platform = platform;

  function setTitle(screen) {
    const t = $('.appbar-title'); const title = screen?.dataset.title;
    if (t && title) t.textContent = title;
    $$('[data-back]').forEach(b => b.classList.toggle('hidden', stack.length < 2));
  }
  // Zeigt einen Bildschirm (<section class="screen" id="...">). push=false bei Tabs (Verlauf neu)
  function go(id, opts = {}) {
    const next = document.getElementById(id); if (!next || !next.classList.contains('screen')) return console.warn('[Coden] Bildschirm nicht gefunden:', id);
    const isTab = $$('.tab[data-go]').some(t => t.dataset.go === id);
    if (isTab || opts.reset) stack.length = 0;
    if (stack[stack.length - 1] !== id) stack.push(id);
    $$('.screen').forEach(s => s.classList.toggle('active', s === next));
    $$('.tab[data-go]').forEach(t => t.classList.toggle('active', t.dataset.go === (isTab ? id : (stack[0] || id))));
    setTitle(next); window.scrollTo(0, 0);
    (listeners[id] || []).forEach(fn => { try { fn(next, opts.data); } catch (e) { console.error(e); } });
  }
  function back() { if (stack.length < 2) return; stack.pop(); const id = stack.pop(); go(id); }

  function toast(msg, ms = 2200) {
    $$('.ck-toast').forEach(t => t.remove());
    const t = document.createElement('div'); t.className = 'ck-toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 260); }, ms);
  }
  const sheet = {
    open(id) { const s = document.getElementById(id); if (!s) return; let bd = s.nextElementSibling; if (!bd || !bd.classList.contains('sheet-backdrop')) { bd = document.createElement('div'); bd.className = 'sheet-backdrop'; s.after(bd); bd.addEventListener('click', () => sheet.close(id)); } requestAnimationFrame(() => s.classList.add('open')); },
    close(id) { const s = id ? document.getElementById(id) : $('.sheet.open'); if (s) s.classList.remove('open'); }
  };
  const store = {
    get(k, fallback = null) { try { const v = localStorage.getItem('app:' + k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem('app:' + k, JSON.stringify(v)); } catch (e) {} return v; },
    remove(k) { try { localStorage.removeItem('app:' + k); } catch (e) {} }
  };
  const loaded = {};
  function loadScript(src) { return loaded[src] || (loaded[src] = new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Konnte ' + src + ' nicht laden')); document.head.appendChild(s); })); }
  const db = {
    // Supabase-Client (nur öffentlicher anon-Key!). const sb = await Coden.db.supabase(URL, KEY)
    async supabase(url, anonKey) { await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'); return window.supabase.createClient(url, anonKey); },
    // Firebase (compat). const fb = await Coden.db.firebase({ apiKey, projectId, ... }) -> fb.firestore()
    async firebase(config) { const v = '10.12.2'; await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-app-compat.js`); await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore-compat.js`); await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-auth-compat.js`); return window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(config); },
    // Beliebige REST-API (z. B. PocketBase, Appwrite, eigenes Backend)
    async rest(base, path, { method = 'GET', body, headers = {} } = {}) { const r = await fetch(base.replace(/\/$/, '') + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || d.error || 'HTTP ' + r.status); return d; }
  };
  const fmt = {
    date: (d, o = { day: '2-digit', month: 'short', year: 'numeric' }) => new Date(d).toLocaleDateString('de-DE', o),
    time: (d) => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    money: (n, cur = 'EUR') => new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).format(n),
    num: (n) => new Intl.NumberFormat('de-DE').format(n)
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.dataset.go); return; }
    if (e.target.closest('[data-back]')) { e.preventDefault(); back(); return; }
    const o = e.target.closest('[data-open-sheet]'); if (o) { e.preventDefault(); sheet.open(o.dataset.openSheet); return; }
    if (e.target.closest('[data-close-sheet]')) { e.preventDefault(); sheet.close(); return; }
    const nt = e.target.closest('.nav-toggle'); if (nt) { $('.nav-links')?.classList.toggle('open'); return; }
    if (e.target.closest('.nav-links a')) $('.nav-links')?.classList.remove('open');
  });
  // ---------- Automatisches Autoscaling & Responsive-Schutz ----------
  function wrapTables() {
    $$('table').forEach(t => {
      if (t.closest('.ck-table-scroll')) return;
      const w = document.createElement('div'); w.className = 'ck-table-scroll';
      t.parentNode?.insertBefore(w, t); w.appendChild(t);
    });
  }
  function fit(el, { maxWidth, minScale = 0.55 } = {}) {
    const node = typeof el === 'string' ? $(el) : el;
    if (!node) return 1;
    node.style.zoom = '';
    const parent = node.parentElement || document.body;
    const avail = Math.max(240, (parent.clientWidth || window.innerWidth) - 8);
    const need = maxWidth || node.scrollWidth || node.offsetWidth;
    if (need > avail + 2) {
      const s = Math.max(minScale, Math.min(1, avail / need));
      node.style.zoom = s.toFixed(4);
      return s;
    }
    return 1;
  }
  let autoTimer = 0;
  function autoscale() {
    if (document.documentElement.hasAttribute('data-no-autoscale') || document.body?.hasAttribute('data-no-autoscale')) return;
    if (document.body?.classList.contains('game') || $('#game') || $('#scene')) return;
    wrapTables();
    const vw = window.innerWidth || document.documentElement.clientWidth || 390;
    // Sanfte Grundskalierung für sehr schmale Ansichten (z. B. Split-Vorschau oder kleine Handys)
    const rootStyle = getComputedStyle(document.documentElement);
    if (!document.documentElement.dataset.ckScaleInit) {
      document.documentElement.dataset.ckScaleInit = '1';
      document.documentElement.dataset.ckBaseScale = rootStyle.getPropertyValue('--font-scale').trim() || '1';
    }
    const base = parseFloat(document.documentElement.dataset.ckBaseScale) || 1;
    const autoFactor = vw < 360 ? Math.max(0.86, vw / 380) : vw < 480 ? Math.max(0.92, vw / 480) : 1;
    document.documentElement.style.setProperty('--font-scale', (base * autoFactor).toFixed(3));
    // Prüfen, ob ein Bereich breiter als das Fenster ist und sauber herunterskalieren
    if (document.body && document.documentElement.scrollWidth > vw + 4) {
      for (const ch of Array.from(document.body.children)) {
        if (/^(SCRIPT|STYLE|LINK)$/i.test(ch.tagName) || ch.classList.contains('ck-toast') || ch.classList.contains('sheet')) continue;
        ch.style.zoom = '';
        if (ch.scrollWidth > vw + 4) {
          const s = Math.max(0.55, Math.min(1, (vw - 2) / ch.scrollWidth));
          ch.style.zoom = s.toFixed(4);
        }
      }
    }
  }
  const scheduleAutoscale = () => { clearTimeout(autoTimer); autoTimer = setTimeout(autoscale, 40); };

  function start() {
    const first = $('.screen.active') || $('.screen'); if (first) go(first.id, { reset: true });
    const page = (location.pathname.split('/').pop() || 'index.html');
    $$('.nav-links a').forEach(a => { if ((a.getAttribute('href') || '') === page) a.classList.add('active'); });
    autoscale();
    if (window.ResizeObserver && document.body) new ResizeObserver(scheduleAutoscale).observe(document.body);
  }
  window.addEventListener('resize', scheduleAutoscale);
  window.addEventListener('load', scheduleAutoscale);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.Coden = {
    $, $$, go, back, toast, sheet, store, db, fmt, esc, loadScript, platform, fit, autoscale,
    onScreen(id, fn) { (listeners[id] ||= []).push(fn); },
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    haptic: (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }
  };

  // ---------- Coden.game: Spielschleife, Skalierung, Eingabe (Tastatur, Maus, Touch), Sound, Partikel ----------
  window.Coden.game = (function () {
    const keys = new Set(); const once = new Set(); const joy = { x: 0, y: 0 }; const pointer = { x: 0, y: 0, down: false, clicked: false };
    const STOP = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
    addEventListener('keydown', (e) => { if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; if (!keys.has(e.code)) once.add(e.code); keys.add(e.code); if (STOP.includes(e.code)) e.preventDefault(); }, { passive: false });
    addEventListener('keyup', (e) => keys.delete(e.code));
    addEventListener('blur', () => { keys.clear(); joy.x = joy.y = 0; });
    const pressed = (code) => { if (once.has(code)) { once.delete(code); return true; } return false; };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const axis = () => {
      let x = joy.x, y = joy.y;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1; if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
      if (keys.has('ArrowUp') || keys.has('KeyW')) y -= 1; if (keys.has('ArrowDown') || keys.has('KeyS')) y += 1;
      const l = Math.hypot(x, y); return l > 1 ? { x: x / l, y: y / l } : { x, y };
    };
    function create(o = {}) {
      const width = o.width || 960, height = o.height || 540;
      let c = typeof o.canvas === 'string' ? document.querySelector(o.canvas) : o.canvas;
      if (!c) { c = document.createElement('canvas'); c.id = 'game'; document.body.appendChild(c); }
      const ctx = c.getContext('2d');
      const g = { canvas: c, ctx, w: width, h: height, scale: 1, paused: false, t: 0, fps: 60, background: o.background || null, shakeT: 0, shakeA: 0 };
      c.style.touchAction = 'none'; c.style.display = 'block'; c.style.margin = '0 auto';
      if (o.pixel) { c.style.imageRendering = 'pixelated'; }
      function resize() {
        const box = c.parentElement === document.body ? { width: innerWidth, height: innerHeight } : c.parentElement.getBoundingClientRect();
        const s = o.fit === 'cover' ? Math.max(box.width / width, box.height / height) : Math.min(box.width / width, box.height / height) || 1;
        const dpr = Math.min(devicePixelRatio || 1, 2); g.scale = s; g.dpr = dpr;
        c.style.width = Math.floor(width * s) + 'px'; c.style.height = Math.floor(height * s) + 'px';
        c.width = Math.floor(width * s * dpr); c.height = Math.floor(height * s * dpr);
        if (o.pixel) ctx.imageSmoothingEnabled = false;
      }
      addEventListener('resize', resize); resize(); setTimeout(resize, 50);
      const toGame = (e) => { const r = c.getBoundingClientRect(); const p = e.touches ? e.touches[0] || e.changedTouches[0] : e; pointer.x = (p.clientX - r.left) / r.width * width; pointer.y = (p.clientY - r.top) / r.height * height; };
      c.addEventListener('pointerdown', (e) => { toGame(e); pointer.down = true; pointer.clicked = true; once.add('Pointer'); });
      addEventListener('pointermove', (e) => toGame(e));
      addEventListener('pointerup', () => { pointer.down = false; });
      g.loop = (cb) => {
        let last = performance.now(), acc = 0, frames = 0;
        const frame = (now) => {
          const dt = Math.min(0.05, (now - last) / 1000); last = now; acc += dt; frames++; if (acc > 1) { g.fps = frames; frames = 0; acc = 0; }
          const k = g.scale * g.dpr; ctx.setTransform(k, 0, 0, k, 0, 0);
          if (!g.paused) {
            g.t += dt;
            if (g.background) { ctx.fillStyle = g.background; ctx.fillRect(0, 0, width, height); } else ctx.clearRect(0, 0, width, height);
            if (g.shakeT > 0) { g.shakeT -= dt; ctx.translate((Math.random() - .5) * g.shakeA, (Math.random() - .5) * g.shakeA); }
            try { cb(dt, g.t); } catch (e) { console.error(e); }
          }
          once.clear(); pointer.clicked = false;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      };
      g.pause = () => { g.paused = true; }; g.resume = () => { g.paused = false; }; g.toggle = () => { g.paused = !g.paused; };
      g.shake = (amount = 8, time = .25) => { g.shakeA = amount; g.shakeT = time; };
      document.addEventListener('visibilitychange', () => { if (document.hidden && o.autoPause !== false) g.paused = true; });
      return g;
    }
    // Joystick + Knöpfe auf Touch-Geräten
    function touchControls(o = {}) {
      if (!matchMedia('(pointer: coarse)').matches && !o.always) return null;
      const box = document.createElement('div'); box.className = 'cg-touch';
      if (o.joystick !== false) {
        const pad = document.createElement('div'); pad.className = 'cg-joy'; const knob = document.createElement('i'); pad.appendChild(knob); box.appendChild(pad);
        let id = null; const move = (t) => { const r = pad.getBoundingClientRect(); const dx = (t.clientX - r.left - r.width / 2) / (r.width / 2), dy = (t.clientY - r.top - r.height / 2) / (r.height / 2); const l = Math.min(1, Math.hypot(dx, dy)) || 0; const a = Math.atan2(dy, dx); joy.x = Math.cos(a) * l; joy.y = Math.sin(a) * l; if (l < .18) joy.x = joy.y = 0; knob.style.transform = `translate(${joy.x * 34}px, ${joy.y * 34}px)`; };
        pad.addEventListener('touchstart', (e) => { e.preventDefault(); id = e.changedTouches[0].identifier; move(e.changedTouches[0]); }, { passive: false });
        pad.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === id) move(t); }, { passive: false });
        const end = () => { id = null; joy.x = joy.y = 0; knob.style.transform = ''; };
        pad.addEventListener('touchend', end); pad.addEventListener('touchcancel', end);
      }
      const btns = document.createElement('div'); btns.className = 'cg-btns';
      (o.buttons || [{ key: 'Space', label: 'A' }]).forEach(b => {
        const el = document.createElement('button'); el.className = 'cg-btn'; el.textContent = b.label || 'A';
        el.addEventListener('touchstart', (e) => { e.preventDefault(); if (!keys.has(b.key)) once.add(b.key); keys.add(b.key); el.classList.add('on'); }, { passive: false });
        const up = (e) => { e.preventDefault(); keys.delete(b.key); el.classList.remove('on'); }; el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
        btns.appendChild(el);
      });
      box.appendChild(btns); document.body.appendChild(box); return box;
    }
    // Sound ohne Dateien (WebAudio)
    let ac = null, master = null, musicTimer = null;
    const audio = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = .25; master.connect(ac.destination); } catch (e) { return null; } } if (ac.state === 'suspended') ac.resume(); return ac; };
    addEventListener('pointerdown', () => audio(), { once: true }); addEventListener('keydown', () => audio(), { once: true });
    function tone(f1, f2, dur, type = 'square', vol = .5, delay = 0) {
      const a = audio(); if (!a) return; const t = a.currentTime + delay; const o = a.createOscillator(); const gn = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f1, t); if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
      gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur + .02);
    }
    function noise(dur = .3, vol = .6) { const a = audio(); if (!a) return; const n = a.createBufferSource(); const b = a.createBuffer(1, a.sampleRate * dur, a.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); n.buffer = b; const gn = a.createGain(); gn.gain.value = vol; n.connect(gn); gn.connect(master); n.start(); }
    const SFX = {
      jump: () => tone(280, 640, .16, 'square', .35), coin: () => { tone(988, 0, .07, 'square', .3); tone(1319, 0, .18, 'square', .3, .07); },
      hit: () => { tone(220, 60, .2, 'sawtooth', .4); noise(.12, .3); }, shoot: () => tone(880, 220, .12, 'square', .22),
      boom: () => { noise(.45, .7); tone(120, 40, .4, 'sawtooth', .4); }, click: () => tone(660, 0, .05, 'triangle', .3),
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0, .16, 'square', .3, i * .11)), lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0, .2, 'triangle', .4, i * .15)),
      power: () => [440, 554, 659, 880].forEach((f, i) => tone(f, 0, .08, 'square', .25, i * .05))
    };
    const sfx = (name) => { try { (SFX[name] || SFX.click)(); } catch (e) {} };
    function music(on = true, notes = [262, 330, 392, 330, 294, 349, 440, 349]) {
      clearInterval(musicTimer); if (!on) return; let i = 0;
      musicTimer = setInterval(() => { tone(notes[i % notes.length], 0, .18, 'triangle', .12); if (i % 2 === 0) tone(notes[i % notes.length] / 2, 0, .3, 'sine', .1); i++; }, 220);
    }
    // Partikel (Explosionen, Funken, Staub)
    function particles(ctx) {
      const list = [];
      return {
        list,
        burst(x, y, o = {}) { const n = o.n || 18; for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = (o.speed || 180) * (.3 + Math.random()); list.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: (o.life || .6) * (.5 + Math.random() * .5), max: o.life || .6, size: o.size || 3, color: o.color || '#ffd43b', g: o.gravity || 0 }); } },
        update(dt) { for (let i = list.length - 1; i >= 0; i--) { const p = list[i]; p.life -= dt; if (p.life <= 0) { list.splice(i, 1); continue; } p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .98; p.vy *= .98; } },
        draw(c = ctx) { for (const p of list) { c.globalAlpha = Math.max(0, p.life / p.max); c.fillStyle = p.color; c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); } c.globalAlpha = 1; }
      };
    }
    // Wischgesten (Handy) -> 'left' | 'right' | 'up' | 'down'
    function onSwipe(cb, min = 28) {
      let sx = 0, sy = 0, on = false;
      addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; on = true; }, { passive: true });
      addEventListener('touchend', (e) => { if (!on) return; on = false; const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy; if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return; cb(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')); }, { passive: true });
    }
    const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const best = (key, score) => { const k = 'best:' + key; const cur = store.get(k, 0); if (score > cur) { store.set(k, score); return score; } return cur; };
    const overlay = (sel) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; return { el, show() { el && el.classList.remove('hidden'); }, hide() { el && el.classList.add('hidden'); }, get visible() { return !!el && !el.classList.contains('hidden'); } }; };
    return {
      create, keys, pressed, axis, pointer, touchControls, onSwipe, sfx, music, particles, hit, best, overlay, clamp,
      dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y), rand: (a, b) => a + Math.random() * (b - a), randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
      lerp: (a, b, t) => a + (b - a) * t, pick: (arr) => arr[Math.floor(Math.random() * arr.length)]
    };
  })();
})();

/* ---------- Coden.three: fertige 3D-Bausteine für three.js (Welt, Autos, Strecken, Städte, Gelände, Fahrphysik) ----------
   three.js einbinden (VOR den eigenen Skripten):
   <script src="https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"></script>
   Einheiten: 1 = 1 Meter. Modelle schauen nach -Z (vorne), Y ist oben. */
(function () {
  'use strict';
  if (!window.Coden) window.Coden = {};
  const CDN = 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js';
  let cmDone = false;
  const T = () => { const TH = window.THREE; if (!TH) throw new Error('three.js fehlt: <script src="' + CDN + '"></script> VOR deinen Skripten einbinden');
    // Farben richtig umrechnen (sonst wirkt alles blass/ausgewaschen)
    if (!cmDone && TH.ColorManagement) { cmDone = true; if ('legacyMode' in TH.ColorManagement) TH.ColorManagement.legacyMode = false; else TH.ColorManagement.enabled = true; }
    return TH; };
  const load = () => window.THREE ? Promise.resolve(window.THREE) : new Promise((ok, no) => { const s = document.createElement('script'); s.src = CDN; s.onload = () => ok(window.THREE); s.onerror = () => no(new Error('three.js konnte nicht geladen werden')); document.head.appendChild(s); });

  // Zufall mit Startwert (gleiche Welt bei gleichem seed)
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }
  const matCache = new Map();
  function mat(color, o = {}) {
    const k = JSON.stringify([color, o]); if (!o.unique && matCache.has(k)) return matCache.get(k);
    const m = new (T().MeshStandardMaterial)({ color, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0.05, flatShading: !!o.flat, transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1,
      emissive: o.glow ? (o.emissive ?? color) : 0x000000, emissiveIntensity: o.glow ?? 0, side: o.double ? T().DoubleSide : T().FrontSide, map: o.map || null });
    if (!o.unique) matCache.set(k, m); return m;
  }
  function shadows(o, cast = true, receive = true) { o.traverse(m => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = receive; } }); return o; }
  function mesh(geo, material, x = 0, y = 0, z = 0) { const m = new (T().Mesh)(geo, material); m.position.set(x, y, z); return m; }
  function box(w, h, d, color, o) { return mesh(new (T().BoxGeometry)(w, h, d), typeof color === 'object' && color.isMaterial ? color : mat(color, o)); }
  function group(...kids) { const g = new (T().Group)(); kids.flat().filter(Boolean).forEach(k => g.add(k)); return g; }
  // Abgerundeter Kasten (für Karosserien): Extrusion eines abgerundeten Rechtecks
  function roundBox(w, h, d, r, color, o) {
    const TH = T(); r = Math.min(r, h / 2.5, w / 2.5); const bs = r * 0.6; w -= bs * 2; h -= bs * 2; const s = new TH.Shape(); const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const g = new TH.ExtrudeGeometry(s, { depth: d - r * 2, bevelEnabled: true, bevelSize: bs, bevelThickness: r, bevelSegments: 3, curveSegments: 6 });
    g.translate(0, 0, -(d - r * 2) / 2);
    return mesh(g, typeof color === 'object' && color.isMaterial ? color : mat(color, o));
  }
  // Leinwand-Textur (z. B. Fenster, Schachbrett, Schilder)
  function canvasTexture(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new (T().CanvasTexture)(c); t.encoding = T().sRGBEncoding; t.anisotropy = 4; return t; }

  // ---------- Welt: Renderer, Licht, Himmel, Nebel, Kamera, Schleife ----------
  function world(opts = {}) {
    const TH = T();
    let canvas = typeof opts.canvas === 'string' ? document.querySelector(opts.canvas) : opts.canvas;
    if (!canvas) { canvas = document.createElement('canvas'); canvas.id = 'scene'; Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none' }); (opts.parent ? document.querySelector(opts.parent) : document.body).appendChild(canvas); }
    const renderer = new TH.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.pixelRatio || 2));
    renderer.outputEncoding = TH.sRGBEncoding; renderer.toneMapping = TH.ACESFilmicToneMapping; renderer.toneMappingExposure = opts.exposure ?? 1.05;
    renderer.shadowMap.enabled = opts.shadows !== false; renderer.shadowMap.type = TH.PCFSoftShadowMap;
    const scene = new TH.Scene();
    const skyTop = new TH.Color(opts.skyTop ?? 0x3d7fd6), skyBottom = new TH.Color(opts.skyBottom ?? 0xbfe3ff);
    if (opts.sky !== false) {
      const sky = new TH.Mesh(new TH.SphereGeometry(1800, 32, 16), new TH.ShaderMaterial({ side: TH.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: skyTop }, bottom: { value: skyBottom } },
        vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 1.4 + 0.15, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0); }' }));
      sky.name = 'sky'; scene.add(sky); scene.background = skyBottom.clone();
    } else scene.background = new TH.Color(opts.background ?? 0x0b1020);
    if (opts.fog !== false) scene.fog = new TH.Fog(opts.fogColor ?? skyBottom, opts.fogNear ?? 80, opts.fogFar ?? 520);
    const camera = new TH.PerspectiveCamera(opts.fov ?? 60, 1, 0.1, 4000); camera.position.set(0, 8, 16);
    const hemi = new TH.HemisphereLight(opts.skyLight ?? 0xcfe8ff, opts.groundLight ?? 0x4a5a3a, opts.ambient ?? 0.55); scene.add(hemi);
    const sun = new TH.DirectionalLight(opts.sunColor ?? 0xfff1d6, opts.sun ?? 1.35); sun.position.set(60, 110, 40); sun.castShadow = renderer.shadowMap.enabled;
    const S = opts.shadowSize ?? 90; Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 400 });
    sun.shadow.mapSize.set(opts.shadowRes ?? 2048, opts.shadowRes ?? 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    if (opts.ground !== false) { const gr = mesh(new TH.PlaneGeometry(4000, 4000), mat(opts.groundColor ?? 0x4f7f3f, { rough: 1 })); gr.rotation.x = -Math.PI / 2; gr.position.y = -0.02; gr.receiveShadow = true; gr.name = 'ground'; scene.add(gr); }
    function resize() { const p = canvas.parentElement === document.body ? null : canvas.parentElement; const w = (p ? p.clientWidth : window.innerWidth) || 300, h = (p ? p.clientHeight : window.innerHeight) || 200; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    resize(); addEventListener('resize', resize); if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement || document.body);
    const updaters = []; let running = true, last = 0, sunTarget = null, cam = null;
    const w = {
      THREE: TH, scene, camera, renderer, sun, hemi, canvas,
      add(...o) { o.flat().forEach(x => scene.add(x.group || x.mesh || x)); return o[0]; },
      remove(...o) { o.flat().forEach(x => scene.remove(x.group || x.mesh || x)); },
      onUpdate(fn) { updaters.push(fn); return w; },
      loop(fn) { if (fn) updaters.push(fn); return w; },
      pause() { running = false; }, resume() { running = true; last = performance.now(); }, get paused() { return !running; },
      sunFollow(obj) { sunTarget = obj; return w; },
      // Verfolger-Kamera hinter einem Objekt (Autos, Figuren)
      follow(target, o = {}) { const off = new TH.Vector3(), look = new TH.Vector3(), want = new TH.Vector3(); let first = true;
        cam = (dt) => { const d = o.distance ?? 9, h = o.height ?? 3.6, lag = o.lag ?? 6; const yaw = target.rotation.y;
          want.set(target.position.x + Math.sin(yaw) * d, target.position.y + h, target.position.z + Math.cos(yaw) * d);
          if (first) { camera.position.copy(want); first = false; } else camera.position.lerp(want, 1 - Math.exp(-lag * dt));
          off.set(-Math.sin(yaw) * (o.lookAhead ?? 6), o.lookHeight ?? 1.2, -Math.cos(yaw) * (o.lookAhead ?? 6)); look.copy(target.position).add(off); camera.lookAt(look); };
        return w; },
      // Kamera per Ziehen/Wischen drehen, Mausrad/Zwei-Finger zoomen
      orbit(o = {}) { const tgt = new TH.Vector3(...(o.target || [0, 0, 0])); let yaw = o.yaw ?? 0.6, pitch = o.pitch ?? 0.5, dist = o.distance ?? 30, drag = null, pinch = 0;
        const pts = new Map();
        canvas.addEventListener('pointerdown', e => { pts.set(e.pointerId, e); drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
        canvas.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e);
          if (pts.size === 2) { const [a, b] = [...pts.values()]; const dd = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (pinch) dist = Math.max(4, Math.min(400, dist * pinch / dd)); pinch = dd; return; }
          if (drag) { yaw -= (e.clientX - drag.x) * 0.006; pitch = Math.max(0.05, Math.min(1.45, pitch + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; } });
        const up = e => { pts.delete(e.pointerId); pinch = 0; if (!pts.size) drag = null; }; canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
        canvas.addEventListener('wheel', e => { e.preventDefault(); dist = Math.max(4, Math.min(400, dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: false });
        cam = () => { camera.position.set(tgt.x + Math.cos(pitch) * Math.sin(yaw) * dist, tgt.y + Math.sin(pitch) * dist, tgt.z + Math.cos(pitch) * Math.cos(yaw) * dist); camera.lookAt(tgt); };
        return w; },
      render() { renderer.render(scene, camera); }
    };
    function frame(now) {
      requestAnimationFrame(frame);
      if (!running) { last = now; return; }
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now; const t = now / 1000;
      for (const fn of updaters) { try { fn(dt, t); } catch (e) { console.error(e); running = false; throw e; } }
      if (cam) cam(dt);
      if (sunTarget) { sun.position.set(sunTarget.position.x + 60, sunTarget.position.y + 110, sunTarget.position.z + 40); sun.target.position.copy(sunTarget.position); }
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
    return w;
  }

  // ---------- Fahrzeuge ----------
  const CAR = {
    sport:  { L: 4.4, W: 1.95, H: 0.62, cabH: 0.5, cabL: 0.42, cabZ: 0.05, wheel: 0.36, spoiler: true },
    muscle: { L: 4.7, W: 2.0, H: 0.72, cabH: 0.52, cabL: 0.4, cabZ: 0.18, wheel: 0.38, stripes: true },
    suv:    { L: 4.6, W: 2.0, H: 0.95, cabH: 0.72, cabL: 0.62, cabZ: 0.12, wheel: 0.44, lift: 0.18, rack: true },
    hatch:  { L: 3.8, W: 1.8, H: 0.75, cabH: 0.62, cabL: 0.58, cabZ: 0.18, wheel: 0.33 },
    truck:  { L: 5.3, W: 2.1, H: 0.95, cabH: 0.8, cabL: 0.34, cabZ: -0.22, wheel: 0.46, lift: 0.2, bed: true },
    police: { L: 4.6, W: 1.95, H: 0.72, cabH: 0.58, cabL: 0.5, cabZ: 0.1, wheel: 0.36, siren: true },
    taxi:   { L: 4.5, W: 1.9, H: 0.72, cabH: 0.6, cabL: 0.5, cabZ: 0.1, wheel: 0.35, sign: true },
    kart:   { L: 2.2, W: 1.4, H: 0.3, cabH: 0, cabL: 0, cabZ: 0, wheel: 0.26, kart: true },
    f1:     { L: 5.0, W: 1.9, H: 0.4, cabH: 0, cabL: 0, cabZ: 0, wheel: 0.42, f1: true }
  };
  function car(o = {}) {
    const TH = T(); const type = CAR[o.type] ? o.type : 'sport'; const c = CAR[type];
    const color = o.color ?? (type === 'taxi' ? 0xf5c518 : type === 'police' ? 0xf4f6f8 : 0xd62828);
    const paint = mat(color, { metal: 0.45, rough: 0.28, unique: true }); const dark = mat(0x16181d, { rough: 0.8 }); const glass = mat(0x1d2633, { metal: 0.6, rough: 0.08, opacity: 0.88 });
    const chrome = mat(0xc9ced6, { metal: 0.9, rough: 0.25 }); const tire = mat(0x111111, { rough: 0.95 });
    const g = new TH.Group(); g.name = 'car'; const body = new TH.Group(); g.add(body);
    const lift = c.lift || 0, base = c.wheel * 0.95 + lift;
    if (c.f1 || c.kart) {
      body.add(roundBox(c.W * 0.42, c.H, c.L * 0.86, 0.12, paint).translateY(base + c.H / 2 - 0.1));
      body.add(box(c.W * 0.95, 0.06, 0.5, paint).translateY(base + 0.05).translateZ(-c.L / 2 + 0.1));            // Frontflügel
      body.add(box(c.W * 0.85, 0.08, 0.45, paint).translateY(base + c.H + 0.35).translateZ(c.L / 2 - 0.3));      // Heckflügel
      body.add(box(0.08, 0.4, 0.3, dark).translateY(base + c.H + 0.15).translateZ(c.L / 2 - 0.3).translateX(c.W * 0.38), box(0.08, 0.4, 0.3, dark).translateY(base + c.H + 0.15).translateZ(c.L / 2 - 0.3).translateX(-c.W * 0.38));
      body.add(mesh(new TH.SphereGeometry(0.22, 16, 12), mat(o.helmet ?? 0xffffff, { rough: 0.3 }), 0, base + c.H + 0.12, 0.25));
    } else {
      body.add(roundBox(c.W, c.H, c.L, 0.18, paint).translateY(base + c.H / 2));
      if (c.cabH) { const cab = roundBox(c.W * 0.84, c.cabH, c.L * c.cabL, 0.16, glass); cab.position.set(0, base + c.H + c.cabH / 2 - 0.04, c.L * c.cabZ); body.add(cab);
        const roof = roundBox(c.W * 0.78, 0.07, c.L * c.cabL * 0.82, 0.03, paint); roof.position.set(0, base + c.H + c.cabH - 0.02, c.L * c.cabZ); body.add(roof); }
      body.add(box(c.W * 1.01, 0.18, 0.16, dark).translateY(base + 0.12).translateZ(-c.L / 2 - 0.02), box(c.W * 1.01, 0.18, 0.16, dark).translateY(base + 0.12).translateZ(c.L / 2 + 0.02)); // Stoßstangen
      const hl = mat(0xfff6d8, { glow: 1.6 }), tl = mat(0xff2a2a, { glow: 1.4 });
      for (const s of [-1, 1]) { body.add(box(0.42, 0.12, 0.06, hl).translateX(s * c.W * 0.32).translateY(base + c.H * 0.62).translateZ(-c.L / 2 - 0.01));
        body.add(box(0.42, 0.12, 0.06, tl).translateX(s * c.W * 0.32).translateY(base + c.H * 0.62).translateZ(c.L / 2 + 0.01));
        body.add(box(0.06, 0.08, 0.2, paint).translateX(s * (c.W / 2 + 0.06)).translateY(base + c.H + 0.08).translateZ(c.L * c.cabZ - c.L * c.cabL / 2 + 0.05)); } // Spiegel
      body.add(box(c.W * 0.5, 0.1, 0.04, chrome).translateY(base + c.H * 0.4).translateZ(-c.L / 2 - 0.1)); // Kühlergrill
      if (c.spoiler) body.add(box(c.W * 0.9, 0.06, 0.32, dark).translateY(base + c.H + 0.28).translateZ(c.L / 2 - 0.2), box(0.06, 0.26, 0.12, dark).translateY(base + c.H + 0.13).translateZ(c.L / 2 - 0.2).translateX(0.6), box(0.06, 0.26, 0.12, dark).translateY(base + c.H + 0.13).translateZ(c.L / 2 - 0.2).translateX(-0.6));
      if (c.stripes) { const st = mat(o.stripe ?? 0xffffff, { rough: 0.3 }); body.add(box(0.22, 0.02, c.L * 1.0, st).translateX(0.18).translateY(base + c.H + 0.005), box(0.22, 0.02, c.L * 1.0, st).translateX(-0.18).translateY(base + c.H + 0.005)); }
      if (c.bed) { body.add(box(c.W, 0.5, c.L * 0.38, paint).translateY(base + c.H + 0.2).translateZ(c.L * 0.29)); body.add(box(c.W * 0.86, 0.1, c.L * 0.34, dark).translateY(base + c.H + 0.42).translateZ(c.L * 0.29)); }
      if (c.rack) for (const s of [-1, 1]) body.add(box(0.06, 0.06, c.L * c.cabL * 0.8, chrome).translateX(s * c.W * 0.32).translateY(base + c.H + c.cabH + 0.06).translateZ(c.L * c.cabZ));
      if (c.siren) { const bar = group(box(0.5, 0.14, 0.24, mat(0xff1f3d, { glow: 2 })).translateX(-0.26), box(0.5, 0.14, 0.24, mat(0x1f6dff, { glow: 2 })).translateX(0.26)); bar.position.set(0, base + c.H + c.cabH + 0.08, c.L * c.cabZ); bar.name = 'siren'; body.add(bar);
        body.add(box(0.03, 0.3, c.L * 0.5, mat(0x1f3a8a)).translateX(c.W / 2 + 0.005).translateY(base + c.H * 0.55), box(0.03, 0.3, c.L * 0.5, mat(0x1f3a8a)).translateX(-c.W / 2 - 0.005).translateY(base + c.H * 0.55)); }
      if (c.sign) body.add(box(0.7, 0.2, 0.26, mat(0xfff7cc, { glow: 0.8 })).translateY(base + c.H + c.cabH + 0.1).translateZ(c.L * c.cabZ));
      if (o.number != null) { const tex = canvasTexture(128, 128, (x) => { x.fillStyle = '#fff'; x.beginPath(); x.arc(64, 64, 58, 0, 7); x.fill(); x.fillStyle = '#111'; x.font = 'bold 74px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(o.number), 64, 68); });
        for (const s of [-1, 1]) { const p = mesh(new TH.PlaneGeometry(0.62, 0.62), new TH.MeshStandardMaterial({ map: tex, transparent: true }), s * (c.W / 2 + 0.012), base + c.H * 0.55, 0.15); p.rotation.y = s * Math.PI / 2; body.add(p); } }
    }
    // Räder: Reifen + Felge, vorne lenkbar
    const wheels = [], steer = [];
    const wx = c.W / 2 - (c.f1 || c.kart ? -0.05 : 0.12), wz = c.L / 2 - c.wheel * 1.35;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pivot = new TH.Group(); pivot.position.set(sx * wx, c.wheel, sz * wz);
      const spin = new TH.Group(); pivot.add(spin);
      const t = mesh(new TH.CylinderGeometry(c.wheel, c.wheel, c.wheel * (c.f1 ? 1.1 : 0.72), 22), tire); t.rotation.z = Math.PI / 2; spin.add(t);
      const rim = mesh(new TH.CylinderGeometry(c.wheel * 0.62, c.wheel * 0.62, c.wheel * 0.76, 10), chrome); rim.rotation.z = Math.PI / 2; spin.add(rim);
      for (let k = 0; k < 5; k++) { const sp = box(0.04, c.wheel * 1.1, 0.07, dark); sp.rotation.x = k * Math.PI / 5; sp.position.x = sx * c.wheel * 0.39; spin.add(sp); }
      g.add(pivot); wheels.push(spin); if (sz < 0) steer.push(pivot);
    }
    g.userData = { type, wheels, steer, body, radius: c.wheel, length: c.L, width: c.W, half: new TH.Vector3(c.W / 2, 1, c.L / 2) };
    return shadows(g);
  }

  // ---------- Natur & Stadt ----------
  function tree(o = {}) {
    const TH = T(); const h = o.height ?? 5 + Math.random() * 3; const type = o.type || 'pine'; const leaf = o.color ?? (type === 'pine' ? 0x2f6b3a : type === 'autumn' ? 0xd9822b : 0x4f9a3c);
    const g = new TH.Group(); const trunk = mesh(new TH.CylinderGeometry(h * 0.04, h * 0.06, h * (type === 'palm' ? 0.95 : 0.4), 7), mat(0x6b4a2f, { rough: 1, flat: true }), 0, h * (type === 'palm' ? 0.475 : 0.2), 0); g.add(trunk);
    if (type === 'pine') for (let i = 0; i < 3; i++) g.add(mesh(new TH.ConeGeometry(h * (0.32 - i * 0.07), h * 0.38, 8), mat(leaf, { flat: true, rough: 0.9 }), 0, h * (0.42 + i * 0.18), 0));
    else if (type === 'palm') for (let i = 0; i < 6; i++) { const l = box(h * 0.08, 0.05, h * 0.4, mat(0x3f8f3a, { flat: true })); l.position.set(0, h * 0.95, 0); l.rotation.set(-0.5, i * Math.PI / 3, 0); l.translateZ(h * 0.18); g.add(l); }
    else for (let i = 0; i < 3; i++) g.add(mesh(new TH.IcosahedronGeometry(h * (0.26 - i * 0.04), 0), mat(leaf, { flat: true, rough: 0.9 }), (i - 1) * h * 0.08, h * (0.55 + i * 0.12), (i % 2) * h * 0.06));
    g.userData.radius = h * 0.15; return shadows(g);
  }
  function rock(o = {}) { const s = o.size ?? 1.5; const m = mesh(new (T().DodecahedronGeometry)(s, 0), mat(o.color ?? 0x8a8f98, { flat: true, rough: 1 })); m.scale.set(1, 0.7, 1.1); m.rotation.set(Math.random(), Math.random(), 0); m.position.y = s * 0.4; return shadows(m); }
  function cloud(o = {}) { const g = group(); for (let i = 0; i < 5; i++) g.add(mesh(new (T().IcosahedronGeometry)(3 + Math.random() * 3, 1), mat(0xffffff, { flat: true, rough: 1 }), i * 4 - 8, Math.random() * 2, Math.random() * 3)); g.position.set(o.x ?? 0, o.y ?? 60, o.z ?? 0); return g; }
  function windows(cols, rows, base, lit = 0.35) {
    return canvasTexture(256, 512, (x, w, h) => { x.fillStyle = base; x.fillRect(0, 0, w, h); const cw = w / cols, rh = h / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { x.fillStyle = Math.random() < lit ? '#ffe7a3' : '#2a3547'; x.fillRect(c * cw + cw * 0.18, r * rh + rh * 0.2, cw * 0.64, rh * 0.55); } });
  }
  function building(o = {}) {
    const TH = T(); const w = o.width ?? 14, d = o.depth ?? 14, h = o.height ?? 20 + Math.random() * 40; const colors = ['#9aa5b1', '#c8b8a2', '#7d8b99', '#b5a48c', '#6f7c8a', '#d6d1c4'];
    const base = o.color || colors[Math.floor(Math.random() * colors.length)];
    const tex = windows(Math.max(2, Math.round(w / 3.2)), Math.max(3, Math.round(h / 3.4)), base, o.lit ?? 0.35); tex.wrapS = tex.wrapT = TH.ClampToEdgeWrapping;
    const side = new TH.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0xffd27a, emissiveMap: o.night ? tex : null, emissiveIntensity: o.night ? 0.6 : 0 });
    const top = mat(0x4b525c, { rough: 0.9 });
    const g = new TH.Group(); const b = mesh(new TH.BoxGeometry(w, h, d), [side, side, top, top, side, side], 0, h / 2, 0); g.add(b);
    if (o.roof !== false) { g.add(box(w * 0.3, 2.4, d * 0.3, 0x5a626d).translateY(h + 1.2).translateX(w * 0.15)); g.add(box(w * 1.02, 0.6, d * 1.02, 0x3d434b).translateY(h + 0.3)); }
    g.userData.half = new TH.Vector3(w / 2, h / 2, d / 2); g.userData.solid = true; return shadows(g);
  }
  function house(o = {}) { const TH = T(); const w = o.width ?? 8, d = o.depth ?? 7, h = o.height ?? 4; const g = group(box(w, h, d, o.color ?? 0xf1e3c8).translateY(h / 2));
    const roof = mesh(new TH.ConeGeometry(Math.max(w, d) * 0.78, h * 0.8, 4), mat(o.roof ?? 0xa4452c, { flat: true }), 0, h + h * 0.4, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
    g.add(box(1.2, 2.2, 0.1, 0x6b4a2f).translateY(1.1).translateZ(d / 2 + 0.05)); for (const s of [-1, 1]) g.add(box(1.2, 1.1, 0.1, mat(0x9fd3ff, { glow: 0.2 })).translateX(s * w * 0.3).translateY(h * 0.6).translateZ(d / 2 + 0.05));
    g.userData.half = new TH.Vector3(w / 2, h / 2, d / 2); g.userData.solid = true; return shadows(g); }
  function lamp(o = {}) { const g = group(mesh(new (T().CylinderGeometry)(0.08, 0.12, 6, 8), mat(0x3b3f46, { metal: 0.6 }), 0, 3, 0), box(1.4, 0.12, 0.25, 0x3b3f46).translateY(6).translateX(0.6), box(0.6, 0.1, 0.3, mat(0xfff2c0, { glow: o.on === false ? 0 : 1.5 })).translateY(5.92).translateX(1.1)); return shadows(g, true, false); }
  function cone() { return shadows(group(mesh(new (T().ConeGeometry)(0.25, 0.7, 12), mat(0xff6a00), 0, 0.35, 0), box(0.6, 0.05, 0.6, 0x222222).translateY(0.025))); }
  function barrier(o = {}) { const len = o.length ?? 4; const g = group(); const n = Math.round(len / 1); for (let i = 0; i < n; i++) g.add(box(len / n, 0.8, 0.5, i % 2 ? 0xffffff : 0xd62828).translateX(-len / 2 + (i + 0.5) * len / n).translateY(0.4)); return shadows(g); }
  function coin(o = {}) { const m = mesh(new (T().CylinderGeometry)(o.size ?? 0.7, o.size ?? 0.7, 0.14, 24), mat(o.color ?? 0xffc928, { metal: 0.8, rough: 0.25, glow: 0.25 })); m.rotation.x = Math.PI / 2; const g = group(m); g.position.y = 1.2; g.userData.spin = true; return shadows(g, true, false); }
  function checkpoint(o = {}) { const r = o.radius ?? 7; const m = mesh(new (T().TorusGeometry)(r, 0.35, 10, 48), mat(o.color ?? 0x39d0ff, { glow: 1.2, opacity: 0.85 })); m.position.y = r; return group(m); }
  function character(o = {}) {
    const TH = T(); const skin = mat(o.skin ?? 0xf0c8a0), shirt = mat(o.color ?? 0x2b7de9), pants = mat(o.pants ?? 0x2d3142);
    const g = new TH.Group(); const torso = roundBox(0.7, 0.8, 0.4, 0.12, shirt); torso.position.y = 1.35; g.add(torso);
    const head = mesh(new TH.SphereGeometry(0.28, 20, 16), skin, 0, 2.0, 0); g.add(head); g.add(box(0.44, 0.12, 0.46, mat(o.hair ?? 0x3b2416)).translateY(2.2));
    const limb = (m, w, h, x, y) => { const p = new TH.Group(); p.position.set(x, y, 0); const l = roundBox(w, h, w, w * 0.4, m); l.position.y = -h / 2; p.add(l); g.add(p); return p; };
    const armL = limb(shirt, 0.2, 0.75, -0.48, 1.7), armR = limb(shirt, 0.2, 0.75, 0.48, 1.7), legL = limb(pants, 0.26, 0.9, -0.18, 0.95), legR = limb(pants, 0.26, 0.9, 0.18, 0.95);
    g.userData = { limbs: { armL, armR, legL, legR }, radius: 0.4 }; return shadows(g);
  }
  // Lauf-Animation für character(): speed 0 = stehen
  function walk(ch, t, speed = 1) { const L = ch.userData.limbs; if (!L) return; const a = Math.sin(t * 9) * 0.7 * Math.min(1, speed); L.legL.rotation.x = a; L.legR.rotation.x = -a; L.armL.rotation.x = -a * 0.8; L.armR.rotation.x = a * 0.8; }

  // ---------- Straßen, Rennstrecken, Städte, Gelände ----------
  function asphalt() { const TH = T(); const t = canvasTexture(256, 256, (x, w, h) => { x.fillStyle = '#3a3d42'; x.fillRect(0, 0, w, h); for (let i = 0; i < 2600; i++) { const v = 50 + Math.random() * 30; x.fillStyle = `rgb(${v},${v},${v + 4})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }); t.wrapS = t.wrapT = TH.RepeatWrapping; return t; }
  // Band entlang einer Kurve (Straße, Bordstein, Mittellinie)
  function ribbon(curve, from, to, n, y, closed, uvRepeat, material, dashed) {
    const TH = T(); const pos = [], uv = [], idx = []; const up = new TH.Vector3(0, 1, 0), side = new TH.Vector3();
    for (let i = 0; i <= n; i++) { const u = i / n; const p = curve.getPointAt(closed ? u % 1 : u); const t = curve.getTangentAt(closed ? u % 1 : u); side.crossVectors(t, up).normalize();
      pos.push(p.x + side.x * from, p.y + y, p.z + side.z * from, p.x + side.x * to, p.y + y, p.z + side.z * to); uv.push(0, u * uvRepeat, 1, u * uvRepeat);
      if (i < n && (!dashed || i % 2 === 0)) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    const g = new TH.BufferGeometry(); g.setAttribute('position', new TH.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new TH.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new TH.Mesh(g, material); m.receiveShadow = true; return m;
  }
  const PRESETS = {
    oval: [[0, 0], [120, 0], [170, 60], [120, 120], [0, 120], [-50, 60]],
    circuit: [[0, 0], [140, -10], [200, 40], [170, 110], [90, 100], [60, 160], [-30, 170], [-90, 110], [-60, 40]],
    figure8: [[0, 0], [80, 60], [160, 0], [80, -60], [0, 0], [-80, 60], [-160, 0], [-80, -60]],
    city: [[0, 0], [150, 0], [150, 150], [0, 150]]
  };
  function track(o = {}) {
    const TH = T(); const s = o.scale ?? 1; const pts = (o.points || PRESETS[o.preset || 'circuit']).map(p => Array.isArray(p) ? new TH.Vector3(p[0] * s, 0, p[1] * s) : p);
    const curve = new TH.CatmullRomCurve3(pts, true, 'centripetal', 0.5); const len = curve.getLength(); const n = Math.max(200, Math.round(len / 2)); const W = o.width ?? 14, h = W / 2;
    const tex = asphalt(); const g = new TH.Group(); g.name = 'track';
    g.add(ribbon(curve, -h, h, n, 0.02, true, len / 12, new TH.MeshStandardMaterial({ map: tex, roughness: 0.92, color: 0xffffff })));
    const curbTex = canvasTexture(64, 64, (x) => { x.fillStyle = '#d62828'; x.fillRect(0, 0, 64, 32); x.fillStyle = '#ffffff'; x.fillRect(0, 32, 64, 32); }); curbTex.wrapS = curbTex.wrapT = TH.RepeatWrapping;
    const curb = new TH.MeshStandardMaterial({ map: curbTex, roughness: 0.7 });
    g.add(ribbon(curve, -h - 1.2, -h, n, 0.05, true, len / 3, curb), ribbon(curve, h, h + 1.2, n, 0.05, true, len / 3, curb));
    const line = mat(0xffffff, { rough: 0.6 }); g.add(ribbon(curve, -0.15, 0.15, Math.round(len / 3), 0.04, true, 1, line, true));
    g.add(ribbon(curve, -h + 0.3, -h + 0.5, n, 0.035, true, 1, line), ribbon(curve, h - 0.5, h - 0.3, n, 0.035, true, 1, line));
    // Start/Ziel-Linie (Schachbrett)
    const fin = canvasTexture(256, 32, (x) => { for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 8, j * 8, 8, 8); } });
    const start = mesh(new TH.PlaneGeometry(W, 2.4), new TH.MeshStandardMaterial({ map: fin, roughness: 0.8 })); const p0 = curve.getPointAt(0), t0 = curve.getTangentAt(0);
    start.rotation.x = -Math.PI / 2; start.position.set(p0.x, 0.06, p0.z); start.rotation.z = -Math.atan2(t0.x, t0.z); g.add(start);
    if (o.walls !== false) { for (const sd of [-1, 1]) { const off = sd * (h + (o.wallGap ?? 6)); const geo = new TH.BufferGeometry(); const P = [], I = []; const up = new TH.Vector3(0, 1, 0), side = new TH.Vector3();
      for (let i = 0; i <= n; i++) { const u = (i / n) % 1; const p = curve.getPointAt(u), t = curve.getTangentAt(u); side.crossVectors(t, up).normalize(); P.push(p.x + side.x * off, 0, p.z + side.z * off, p.x + side.x * off, 1.1, p.z + side.z * off); if (i < n) { const a = i * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
      geo.setAttribute('position', new TH.Float32BufferAttribute(P, 3)); geo.setIndex(I); geo.computeVertexNormals(); const wmesh = new TH.Mesh(geo, new TH.MeshStandardMaterial({ color: sd < 0 ? 0xd62828 : 0xeeeeee, side: TH.DoubleSide, roughness: 0.8 })); wmesh.castShadow = true; g.add(wmesh); } }
    const samples = Array.from({ length: n }, (_, i) => curve.getPointAt(i / n));
    const api = { group: g, mesh: g, curve, width: W, length: len,
      pointAt: (u) => curve.getPointAt(((u % 1) + 1) % 1), tangentAt: (u) => curve.getTangentAt(((u % 1) + 1) % 1),
      // nächster Punkt auf der Strecke: { u (0..1), dist (Abstand zur Mittellinie), point }
      nearest(pos, hint) { let best = 0, bd = Infinity; const from = hint != null ? Math.round(hint * n) - 25 : 0, to = hint != null ? Math.round(hint * n) + 25 : n;
        for (let k = from; k < to; k++) { const i = ((k % n) + n) % n; const p = samples[i]; const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2; if (d < bd) { bd = d; best = i; } } return { u: best / n, dist: Math.sqrt(bd), point: samples[best] }; },
      onTrack(pos, hint) { return api.nearest(pos, hint).dist <= h + 1.2; },
      // Startaufstellung: Plätze hinter der Startlinie (Reihen à 2)
      grid(count = 4, gap = 9) { return Array.from({ length: count }, (_, i) => { const u = 1 - ((Math.floor(i / 2) + 1) * gap) / len; const p = curve.getPointAt(((u % 1) + 1) % 1), t = curve.getTangentAt(((u % 1) + 1) % 1); const side = new TH.Vector3().crossVectors(t, new TH.Vector3(0, 1, 0)).normalize().multiplyScalar((i % 2 ? 1 : -1) * W * 0.22);
        return { position: p.clone().add(side), rotationY: Math.atan2(-t.x, -t.z) }; }); },
      checkpoints(k = 8) { return Array.from({ length: k }, (_, i) => api.pointAt(i / k)); },
      // Deko am Rand: Bäume, Zuschauer-Tribüne, Lampen (dichte 0..1)
      decorate(w, d = 0.5) { const r = rng(o.seed ?? 7); const steps = Math.round(len / 10); for (let i = 0; i < steps; i++) { if (r() > d) continue; const u = i / steps; const p = api.pointAt(u), t = api.tangentAt(u); const side = new TH.Vector3().crossVectors(t, new TH.Vector3(0, 1, 0)).normalize(); const sd = r() < 0.5 ? -1 : 1; const off = h + (o.wallGap ?? 6) + 4 + r() * 25;
          const obj = r() < 0.75 ? tree({ type: r() < 0.5 ? 'pine' : 'round', height: 5 + r() * 5 }) : r() < 0.5 ? rock({ size: 1 + r() * 2 }) : lamp(); obj.position.set(p.x + side.x * off * sd, 0, p.z + side.z * off * sd); (w ? w.scene : g).add(obj); } return api; }
    };
    return api;
  }
  function road(o = {}) { const TH = T(); const L = o.length ?? 100, W = o.width ?? 10; const g = group(); const t = asphalt(); t.repeat.set(W / 10, L / 10);
    const r = mesh(new TH.PlaneGeometry(W, L), new TH.MeshStandardMaterial({ map: t, roughness: 0.92 })); r.rotation.x = -Math.PI / 2; r.position.y = 0.02; r.receiveShadow = true; g.add(r);
    const lanes = o.lanes ?? 2; for (let l = 1; l < lanes; l++) for (let z = -L / 2 + 2; z < L / 2; z += 6) { const d = box(0.18, 0.02, 3, 0xffffff); d.position.set(-W / 2 + (W / lanes) * l, 0.04, z + 1.5); g.add(d); }
    for (const s of [-1, 1]) { const e = box(0.2, 0.02, L, 0xf2f2f2); e.position.set(s * (W / 2 - 0.4), 0.04, 0); g.add(e); } return g; }
  function city(o = {}) {
    const TH = T(); const r = rng(o.seed ?? 42); const N = o.blocks ?? 5, B = o.block ?? 44, R = o.road ?? 12, cell = B + R, size = N * cell; const g = new TH.Group(); g.name = 'city'; const solids = [];
    const t = asphalt(); t.repeat.set(size / 10, size / 10); const ground = mesh(new TH.PlaneGeometry(size + R, size + R), new TH.MeshStandardMaterial({ map: t, roughness: 0.95 })); ground.rotation.x = -Math.PI / 2; ground.position.y = 0.01; ground.receiveShadow = true; g.add(ground);
    for (let i = 0; i <= N; i++) for (let z = -size / 2; z < size / 2; z += 7) { for (const [x, zz, rot] of [[-size / 2 + i * cell, z + 3.5, 0], [z + 3.5, -size / 2 + i * cell, 1]]) { const d = box(0.25, 0.02, 3, 0xf4d03f); d.position.set(x, 0.03, zz); if (rot) d.rotation.y = Math.PI / 2; g.add(d); } }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const cx = -size / 2 + R / 2 + i * cell + B / 2, cz = -size / 2 + R / 2 + j * cell + B / 2;
      const walk = box(B, 0.25, B, 0xb9bcc2); walk.position.set(cx, 0.12, cz); walk.receiveShadow = true; g.add(walk);
      if (r() < (o.parks ?? 0.15)) { const grass = box(B - 4, 0.3, B - 4, 0x5d9b4c); grass.position.set(cx, 0.15, cz); g.add(grass); for (let k = 0; k < 6; k++) { const tr = tree({ type: r() < 0.5 ? 'round' : 'pine', height: 5 + r() * 4 }); tr.position.set(cx + (r() - 0.5) * (B - 10), 0.3, cz + (r() - 0.5) * (B - 10)); g.add(tr); } continue; }
      const split = r() < 0.5 ? 1 : 2; const bw = (B - 6) / split;
      for (let a = 0; a < split; a++) for (let b = 0; b < split; b++) { const center = Math.hypot(cx, cz) / size; const h = (o.minHeight ?? 10) + r() * (o.maxHeight ?? 60) * (1.2 - center);
        const bd = building({ width: bw - 2, depth: bw - 2, height: h, night: o.night, lit: o.night ? 0.55 : 0.3 }); bd.position.set(cx - (B - 6) / 2 + bw * (a + 0.5), 0.25, cz - (B - 6) / 2 + bw * (b + 0.5)); g.add(bd); solids.push(bd); }
      for (const [dx, dz] of [[-1, -1], [1, 1]]) { const l = lamp(); l.position.set(cx + dx * (B / 2 - 1), 0.25, cz + dz * (B / 2 - 1)); g.add(l); }
    }
    g.updateMatrixWorld(true);
    return { group: g, mesh: g, size, cell, road: R, solids, boxes: solids.map(s => new TH.Box3().setFromObject(s)),
      // Startpunkt auf einer Straße
      spawn: () => ({ position: new TH.Vector3(-size / 2 + R / 2 + cell, 0, 0), rotationY: 0 }),
      onRoad(p) { const m = (v) => ((v + size / 2) % cell + cell) % cell; return m(p.x) < R || m(p.z) < R; } };
  }
  function noise2(seed) { const r = rng(seed); const ph = Array.from({ length: 8 }, () => [r() * 6.28, r() * 6.28, 0.5 + r()]); return (x, z) => { let v = 0, a = 1, f = 0.012; for (let i = 0; i < 4; i++) { const p = ph[i]; v += a * Math.sin(x * f * p[2] + p[0]) * Math.cos(z * f * p[2] + p[1]); a *= 0.5; f *= 2.1; } return v; }; }
  function terrain(o = {}) {
    const TH = T(); const S = o.size ?? 600, seg = o.segments ?? 120, H = o.height ?? 18, flat = o.flatRadius ?? 0; const nz = noise2(o.seed ?? 3);
    const heightAt = (x, z) => { const d = Math.hypot(x, z); const k = flat ? Math.min(1, Math.max(0, (d - flat) / (flat * 0.6 + 1))) : 1; return nz(x, z) * H * k; };
    const geo = new TH.PlaneGeometry(S, S, seg, seg); geo.rotateX(-Math.PI / 2); const pos = geo.attributes.position; const col = []; const c = new TH.Color();
    const low = new TH.Color(o.low ?? 0x5d8f4e), mid = new TH.Color(o.mid ?? 0x7a9a4a), high = new TH.Color(o.high ?? 0x9a958c), top = new TH.Color(o.snow ?? 0xf4f6f8);
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); const y = heightAt(x, z); pos.setY(i, y); const t = (y / H + 1) / 2;
      c.copy(t < 0.5 ? low : t < 0.7 ? mid : t < 0.88 ? high : top); if (t >= 0.5 && t < 0.7) c.lerp(mid, (t - 0.5) * 5); col.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new TH.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
    const m = new TH.Mesh(geo, new TH.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: o.flat !== false })); m.receiveShadow = true;
    return { mesh: m, group: m, heightAt };
  }
  function water(o = {}) { const m = mesh(new (T().PlaneGeometry)(o.size ?? 2000, o.size ?? 2000), mat(o.color ?? 0x2a7fb8, { metal: 0.3, rough: 0.15, opacity: 0.85 })); m.rotation.x = -Math.PI / 2; m.position.y = o.level ?? -1; return m; }

  // ---------- Fahrphysik (Arcade): Gas, Bremse, Lenken, Driften, Kollision ----------
  function vehicle(obj, o = {}) {
    const TH = T(); const ud = obj.userData || {}; const cfg = { maxSpeed: 46, reverse: 12, accel: 16, brake: 34, drag: 0.35, roll: 3, turn: 2.1, grip: 7, driftGrip: 1.8, boost: 1.5, ...o };
    const vel = new TH.Vector3(); const fwd = new TH.Vector3(); const right = new TH.Vector3(); let steerA = 0, boostLeft = 0;
    const box3 = new TH.Box3(), other = new TH.Box3();
    const ctl = {
      object: obj, speed: 0, drifting: false, velocity: vel,
      // input: { x: -1..1 lenken, y: -1..1 Gas/Rückwärts, brake: bool (Handbremse = Drift), boost: bool }
      update(dt, input = {}) {
        const x = Math.max(-1, Math.min(1, input.x || 0)), y = Math.max(-1, Math.min(1, input.y || 0));
        fwd.set(-Math.sin(obj.rotation.y), 0, -Math.cos(obj.rotation.y)); right.set(Math.cos(obj.rotation.y), 0, -Math.sin(obj.rotation.y));
        let vf = vel.dot(fwd), vs = vel.dot(right);
        const top = cfg.maxSpeed * (input.boost && boostLeft > 0 ? cfg.boost : 1); if (input.boost) boostLeft = Math.max(0, boostLeft - dt);
        if (y > 0) vf += cfg.accel * y * dt * (vf < top ? 1 : 0); else if (y < 0) vf += (vf > 0.5 ? -cfg.brake : -cfg.accel * 0.6) * -y * dt;
        if (vf < -cfg.reverse) vf = -cfg.reverse;
        vf -= vf * cfg.drag * dt + Math.sign(vf) * Math.min(Math.abs(vf), (y === 0 ? cfg.roll : 0) * dt);
        if (input.brake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), cfg.brake * 0.35 * dt);
        ctl.drifting = !!input.brake && Math.abs(vf) > 12 && Math.abs(x) > 0.2;
        vs -= vs * Math.min(1, (ctl.drifting ? cfg.driftGrip : cfg.grip) * dt);
        const steerTarget = x * (0.55 - 0.3 * Math.min(1, Math.abs(vf) / cfg.maxSpeed)); steerA += (steerTarget - steerA) * Math.min(1, 10 * dt);
        obj.rotation.y -= steerA * cfg.turn * dt * Math.min(1, Math.abs(vf) / 6) * Math.sign(vf || 1) * (ctl.drifting ? 1.35 : 1);
        fwd.set(-Math.sin(obj.rotation.y), 0, -Math.cos(obj.rotation.y)); right.set(Math.cos(obj.rotation.y), 0, -Math.sin(obj.rotation.y));
        vel.copy(fwd).multiplyScalar(vf).addScaledVector(right, vs);
        obj.position.addScaledVector(vel, dt);
        if (o.heightAt) obj.position.y += (o.heightAt(obj.position.x, obj.position.z) - obj.position.y) * Math.min(1, 12 * dt);
        // Kollision mit festen Objekten (Gebäude, Wände): zurückschieben und abbremsen
        if (o.solids && o.solids.length) { const half = ud.half || new TH.Vector3(1, 1, 2); box3.setFromCenterAndSize(obj.position.clone().setY(obj.position.y + 1), new TH.Vector3(half.z * 2, 2, half.z * 2));
          for (const s of o.solids) { other.copy(s.isBox3 ? s : other.setFromObject(s)); if (box3.intersectsBox(other)) { const c = other.getCenter(new TH.Vector3()); const push = obj.position.clone().sub(c).setY(0).normalize(); obj.position.addScaledVector(push, 0.6); vel.multiplyScalar(-0.3); if (o.onCrash) o.onCrash(s); break; } } }
        ctl.speed = vel.length() * Math.sign(vf || 1);
        // Räder drehen, Vorderräder lenken, Karosserie neigt sich
        (ud.wheels || []).forEach(wh => { wh.rotation.x -= vf * dt / (ud.radius || 0.36); });
        (ud.steer || []).forEach(p => { p.rotation.y = -steerA * 1.2; });
        if (ud.body) { ud.body.rotation.z += ((-steerA * Math.min(1, Math.abs(vf) / 20)) * 0.12 - ud.body.rotation.z) * Math.min(1, 8 * dt); ud.body.rotation.x += ((y > 0 ? 0.02 : y < 0 ? -0.03 : 0) - ud.body.rotation.x) * Math.min(1, 6 * dt); }
        const siren = obj.getObjectByName && obj.getObjectByName('siren'); if (siren) siren.children.forEach((c, i) => { c.material.emissiveIntensity = (Math.floor(performance.now() / 250) + i) % 2 ? 2.4 : 0.2; });
        return ctl;
      },
      addBoost(sec = 2) { boostLeft += sec; },
      get kmh() { return Math.round(Math.abs(ctl.speed) * 3.6); },
      reset(pos, rotY = 0) { if (pos) obj.position.copy(pos); obj.rotation.y = rotY; vel.set(0, 0, 0); ctl.speed = 0; steerA = 0; }
    };
    return ctl;
  }
  // Eingabe für Fahrzeuge/Figuren: Pfeile/WASD, Leertaste = Handbremse, Shift = Boost; auf Handys Joystick + Knöpfe (über Coden.game)
  function input(o = {}) {
    const G = window.Coden.game; if (G && o.touch !== false && ('ontouchstart' in window)) G.touchControls({ joystick: true, buttons: o.buttons || [{ key: 'Space', label: '⟲' }, { key: 'ShiftLeft', label: '⚡' }] });
    return () => { const a = G ? G.axis() : { x: 0, y: 0 }; const k = G ? G.keys : new Set(); return { x: a.x, y: -a.y, brake: k.has('Space'), boost: k.has('ShiftLeft') || k.has('ShiftRight') }; };
  }
  // KI-Fahrer: steuert auf einen Punkt vor sich auf der Strecke zu
  function driver(ctl, trk, o = {}) {
    let u = trk.nearest(ctl.object.position).u; const lane = o.lane ?? 0; const TH = T(); const aim = new TH.Vector3();
    return () => { u = trk.nearest(ctl.object.position, u).u; const ahead = (o.lookAhead ?? 18) / trk.length; const p = trk.pointAt(u + ahead), t = trk.tangentAt(u + ahead);
      aim.crossVectors(t, new TH.Vector3(0, 1, 0)).normalize().multiplyScalar(lane * trk.width * 0.25).add(p);
      const obj = ctl.object; const dx = aim.x - obj.position.x, dz = aim.z - obj.position.z; const want = Math.atan2(-dx, -dz); let diff = want - obj.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const x = Math.max(-1, Math.min(1, -diff * 2.2)); const speedK = o.skill ?? 0.9; return { x, y: Math.abs(diff) > 0.5 ? 0.4 : speedK, brake: false, progress: u }; };
  }
  const collide = (a, b, pad = 0) => { const TH = T(); const A = new TH.Box3().setFromObject(a).expandByScalar(pad), B = new TH.Box3().setFromObject(b); return A.intersectsBox(B); };
  const near = (a, b, r) => a.position.distanceTo(b.position) < r;
  // Dreht Münzen/Objekte mit userData.spin, lässt sie schweben
  function animate(list, t) { for (const o of list) if (o.userData && o.userData.spin) { o.rotation.y = t * 2.5; o.position.y = (o.userData.baseY ?? (o.userData.baseY = o.position.y)) + Math.sin(t * 3) * 0.15; } }

  const ready = (fn) => load().then(() => fn(window.THREE)); // three.js nachladen, falls das <script> fehlt
  window.Coden.three = { load, ready, CDN, world, car, tree, rock, cloud, building, house, lamp, cone, barrier, coin, checkpoint, character, walk, road, track, city, terrain, water,
    vehicle, input, driver, collide, near, animate, mat, box, roundBox, group, shadows, canvasTexture, rng, CARS: Object.keys(CAR), TRACKS: Object.keys(PRESETS) };
})();
