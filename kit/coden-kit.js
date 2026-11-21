/* Coden-Kit 1.0 – kleine Helfer für Apps aus Coden (Bildschirme, Tabs, Toasts, Sheets, Speicher, Datenbank). */
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
})();
