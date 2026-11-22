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
  function start() {
    const first = $('.screen.active') || $('.screen'); if (first) go(first.id, { reset: true });
    const page = (location.pathname.split('/').pop() || 'index.html');
    $$('.nav-links a').forEach(a => { if ((a.getAttribute('href') || '') === page) a.classList.add('active'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.Coden = {
    $, $$, go, back, toast, sheet, store, db, fmt, esc, loadScript, platform,
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
