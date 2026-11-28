// js/spotify-player.js – Miniplayer für Spotify (schwebende Karte, verschiebbar, einklappbar).
// Zeigt Cover, Titel, Fortschritt, Play/Pause, Vor/Zurück, Zufall, Lautstärke, Gerätewahl und eine eigene Suche.
import { h, icon } from './apps/dom.js';
import { toast } from './toast.js';
import * as Sp from './spotify.js';
import { registerCards } from './spotify-cards.js';

const C = () => window.CodenSpotify;
const UI_KEY = 'coden_spotify_ui';
const ui = (() => { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (_) { return {}; } })();
const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (_) {} };

const DEV_ICON = { Computer: 'computer', Smartphone: 'smartphone', Tablet: 'tablet', Speaker: 'speaker', TV: 'tv', CastAudio: 'cast', CastVideo: 'cast', AVR: 'speaker_group', Automobile: 'directions_car', GameConsole: 'sports_esports' };
let root, els = {}, ticker = null, lastTrackUri = '', menuOpen = false, busy = false;

const btn = (name, label, onClick, cls = '') => h('button', { type: 'button', class: 'sp-btn ' + cls, title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); Sp.unlockAudio(); onClick(e); } }, icon(name));

async function act(fn) {
    if (busy) return;
    busy = true; root.classList.add('busy');
    try { await fn(); } catch (e) { showError(e.message || String(e)); } finally { busy = false; root.classList.remove('busy'); }
}
function showError(msg) {
    els.err.textContent = msg; els.err.hidden = false;
    clearTimeout(showError.t); showError.t = setTimeout(() => { els.err.hidden = true; }, 7000);
}

function build() {
    els.cover = h('div', { class: 'sp-cover' }, icon('music_note'));
    els.eq = h('div', { class: 'sp-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
    els.title = h('div', { class: 'sp-title', text: 'Nichts läuft' });
    els.artist = h('div', { class: 'sp-artist', text: 'Sag Coden, was er spielen soll.' });
    els.play = btn('play_arrow', 'Abspielen', () => act(() => Sp.toggle()), 'sp-main');
    els.pillPlay = btn('play_arrow', 'Abspielen', () => act(() => Sp.toggle()), 'sp-pill-play');
    els.shuffle = btn('shuffle', 'Zufallswiedergabe', () => act(() => Sp.shuffle(!(Sp.getState() || {}).shuffle)), 'sp-small');
    els.time = h('span', { class: 'sp-time', text: '0:00' });
    els.dur = h('span', { class: 'sp-time', text: '0:00' });
    els.seek = h('input', { type: 'range', class: 'sp-range sp-seek', min: '0', max: '1000', value: '0', 'aria-label': 'Position' });
    els.seek.addEventListener('input', () => { els.seek.dataset.drag = '1'; const st = Sp.getState(); if (st && st.track) els.time.textContent = C().fmtTime(st.track.durationMs * els.seek.value / 1000); paintRange(els.seek); });
    els.seek.addEventListener('change', () => { delete els.seek.dataset.drag; const st = Sp.getState(); if (st && st.track) act(() => Sp.seek(st.track.durationMs * els.seek.value / 1000)); });
    els.volIcon = btn('volume_up', 'Stumm', () => { const st = Sp.getState(); const v = st && st.device ? st.device.volume : 60; if (v > 0) { ui.lastVol = v; saveUi(); } act(() => Sp.volume(v > 0 ? 0 : (ui.lastVol || 60))); }, 'sp-small');
    els.vol = h('input', { type: 'range', class: 'sp-range sp-vol', min: '0', max: '100', value: '60', 'aria-label': 'Lautstärke' });
    let volT;
    els.vol.addEventListener('input', () => { paintRange(els.vol); clearTimeout(volT); volT = setTimeout(() => act(() => Sp.volume(+els.vol.value)), 250); });
    els.device = h('button', { type: 'button', class: 'sp-device', title: 'Gerät wählen', onclick: (e) => { e.stopPropagation(); toggleMenu(); } }, icon('speaker'), h('span', { text: 'Kein Gerät' }));
    els.open = h('a', { class: 'sp-open', href: 'https://open.spotify.com', target: '_blank', rel: 'noopener noreferrer', title: 'In Spotify öffnen' }, h('span', { text: 'Spotify' }), icon('arrow_outward'));
    els.err = h('div', { class: 'sp-err', role: 'alert' }); els.err.hidden = true;
    els.searchInput = h('input', { type: 'search', class: 'sp-search-input', placeholder: 'Song, Künstler, Playlist …', 'aria-label': 'Bei Spotify suchen und abspielen', enterkeyhint: 'go' });
    els.searchInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const q = els.searchInput.value.trim(); if (!q) return;
        e.preventDefault(); Sp.unlockAudio();
        act(async () => { const p = await Sp.play(q); els.searchInput.value = ''; toast('Spielt jetzt ' + C().describe(p), { type: 'ok' }); });
    });
    els.search = h('div', { class: 'sp-search' }, icon('search'), els.searchInput);
    els.menu = h('div', { class: 'sp-menu', role: 'menu' }); els.menu.hidden = true;

    const head = h('div', { class: 'sp-head' },
        h('div', { class: 'sp-art' }, els.cover, els.eq),
        h('div', { class: 'sp-meta' }, els.title, els.artist),
        btn('search', 'Suchen', () => { root.classList.toggle('searching'); if (root.classList.contains('searching')) els.searchInput.focus(); }, 'sp-small'),
        btn('more_horiz', 'Mehr', () => toggleMenu(), 'sp-small'),
        btn('keyboard_arrow_down', 'Einklappen', () => setCollapsed(true), 'sp-small')
    );
    const progress = h('div', { class: 'sp-progress' }, els.time, els.seek, els.dur);
    const controls = h('div', { class: 'sp-controls' },
        els.shuffle,
        btn('skip_previous', 'Zurück', () => act(() => Sp.previous())),
        els.play,
        btn('skip_next', 'Weiter', () => act(() => Sp.next())),
        h('div', { class: 'sp-volwrap' }, els.volIcon, els.vol)
    );
    const foot = h('div', { class: 'sp-foot' }, els.device, els.open);
    els.card = h('div', { class: 'sp-card' }, head, els.search, progress, controls, els.err, foot, els.menu);
    els.pill = h('button', { type: 'button', class: 'sp-pill', title: 'Spotify-Player öffnen', 'aria-label': 'Spotify-Player öffnen', onclick: () => setCollapsed(false) },
        h('div', { class: 'sp-art' }, h('div', { class: 'sp-cover sp-pill-cover' }, icon('music_note')), h('div', { class: 'sp-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))));
    root = h('div', { id: 'sp-mini', class: 'sp-mini', role: 'region', 'aria-label': 'Spotify-Miniplayer' }, els.card, h('div', { class: 'sp-pillwrap' }, els.pill, els.pillPlay));
    root.hidden = true;
    document.body.appendChild(root);
    draggable(head);
    draggable(els.pill, true);
    document.addEventListener('click', (e) => { if (menuOpen && !els.menu.contains(e.target)) closeMenu(); });
    placeSaved();
    window.addEventListener('resize', () => placeSaved());
}

function paintRange(r) { const p = (r.value - r.min) / (r.max - r.min) * 100; r.style.setProperty('--p', p + '%'); }

// ---------- Verschieben (Maus und Finger) ----------
function draggable(handle, isPill = false) {
    let sx, sy, ox, oy, moved = false, id = null;
    handle.addEventListener('pointerdown', (e) => {
        if (!isPill && (e.target.closest('button, input, a') || innerWidth < 640)) return;
        if (e.button !== 0) return;
        const r = root.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; moved = false; id = e.pointerId;
    });
    handle.addEventListener('pointermove', (e) => {
        if (id !== e.pointerId) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        if (!moved) { moved = true; try { handle.setPointerCapture(id); } catch (_) {} root.classList.add('dragging'); }
        place(ox + dx, oy + dy);
    });
    const end = (e) => {
        if (id !== e.pointerId) return;
        id = null; root.classList.remove('dragging');
        if (moved) {
            const r = root.getBoundingClientRect();
            ui.pos = { x: r.left / innerWidth, y: r.top / innerHeight }; saveUi();
            if (isPill) { const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; handle.addEventListener('click', stop, { capture: true, once: true }); }
        }
    };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
}
function place(x, y) {
    const r = root.getBoundingClientRect();
    const nx = Math.max(8, Math.min(innerWidth - r.width - 8, x));
    const ny = Math.max(8, Math.min(innerHeight - r.height - 8, y));
    root.style.left = nx + 'px'; root.style.top = ny + 'px'; root.style.right = 'auto'; root.style.bottom = 'auto';
}
function placeSaved() {
    if (!root) return;
    if (!ui.pos || innerWidth < 640) { root.style.left = root.style.top = root.style.right = root.style.bottom = ''; return; }
    requestAnimationFrame(() => place(ui.pos.x * innerWidth, ui.pos.y * innerHeight));
}

// ---------- Ein-/Ausklappen, Anzeigen ----------
function setCollapsed(on) { ui.collapsed = !!on; saveUi(); closeMenu(); root.classList.toggle('collapsed', ui.collapsed); placeSaved(); }
export function show({ expand = true } = {}) {
    if (!root) return;
    ui.hidden = false; if (expand) ui.collapsed = false; saveUi();
    render(Sp.getState());
}
function hide() { ui.hidden = true; saveUi(); closeMenu(); render(Sp.getState()); toast('Spotify-Player ausgeblendet. Über das Plus-Menü holst du ihn zurück.'); }

// ---------- Menü: Geräte, Öffnen, Ausblenden, Trennen ----------
async function toggleMenu() { if (menuOpen) closeMenu(); else openMenu(); }
function closeMenu() { menuOpen = false; if (els.menu) els.menu.hidden = true; }
async function openMenu() {
    menuOpen = true; els.menu.hidden = false;
    els.menu.replaceChildren(h('div', { class: 'sp-menu-h', text: 'Geräte' }), h('div', { class: 'sp-menu-note', text: 'Suche Geräte …' }));
    let list = [];
    try { list = await Sp.devices(); } catch (e) { list = []; }
    const st = Sp.getState();
    const cur = st && st.device ? st.device.id : '';
    const items = list.map(d => h('button', { type: 'button', class: 'sp-menu-i' + (d.id === cur ? ' on' : ''), role: 'menuitem', onclick: (e) => { e.stopPropagation(); closeMenu(); Sp.unlockAudio(); act(() => Sp.transfer(d.id, true)); } },
        icon(DEV_ICON[d.type] || 'speaker'),
        h('span', { text: d.name }), d.id === cur ? icon('check', 'sp-menu-check') : null));
    const sdkNote = Sp.sdkProblem();
    els.menu.replaceChildren(...[
        h('div', { class: 'sp-menu-h', text: 'Geräte' }),
        ...(items.length ? items : [h('div', { class: 'sp-menu-note', text: 'Kein Gerät gefunden. Öffne die Spotify-App auf Handy oder Computer.' })]),
        sdkNote ? h('div', { class: 'sp-menu-note', text: sdkNote }) : null,
        h('div', { class: 'sp-menu-sep' }),
        h('a', { class: 'sp-menu-i', href: (st && st.track && st.track.url) || 'https://open.spotify.com', target: '_blank', rel: 'noopener noreferrer', role: 'menuitem' }, icon('open_in_new'), h('span', { text: 'In Spotify öffnen' })),
        h('button', { type: 'button', class: 'sp-menu-i', role: 'menuitem', onclick: (e) => { e.stopPropagation(); hide(); } }, icon('visibility_off'), h('span', { text: 'Player ausblenden' })),
        h('button', { type: 'button', class: 'sp-menu-i danger', role: 'menuitem', onclick: (e) => { e.stopPropagation(); closeMenu(); Sp.disconnect(); toast('Spotify getrennt.'); } }, icon('link_off'), h('span', { text: 'Spotify trennen' }))
    ].filter(Boolean));
}

// ---------- Zeichnen ----------
function setCover(box, url) {
    if (!box) return;
    const img = box.querySelector('img');
    if (!url) { if (img) img.remove(); box.classList.remove('has-img'); return; }
    if (img && img.src === url) return;
    const n = img || h('img', { alt: '' });
    n.src = url; if (!img) box.appendChild(n); box.classList.add('has-img');
}
function render(st) {
    if (!root) return;
    const visible = Sp.connected() && !ui.hidden;
    root.hidden = !visible;
    if (!visible) { stopTick(); return; }
    root.classList.toggle('collapsed', !!ui.collapsed);
    const t = st && st.track;
    root.classList.toggle('empty', !t);
    root.classList.toggle('playing', !!(st && st.playing));
    if (!t) root.classList.add('searching');
    else if (t.uri !== lastTrackUri && lastTrackUri === '') root.classList.remove('searching');
    lastTrackUri = t ? t.uri : '';
    els.title.textContent = t ? t.name : 'Nichts läuft';
    els.artist.textContent = t ? t.artists : 'Sag Coden, was er spielen soll – oder such hier.';
    els.card.title = t ? `${t.name} – ${t.artists}${t.album ? ' · ' + t.album : ''}` : '';
    setCover(els.cover, t && t.image);
    setCover(root.querySelector('.sp-pill-cover'), t && t.image);
    const playIc = st && st.playing ? 'pause' : 'play_arrow';
    for (const b of [els.play, els.pillPlay]) { b.firstChild.textContent = playIc; const l = st && st.playing ? 'Pause' : 'Abspielen'; b.title = l; b.setAttribute('aria-label', l); }
    els.shuffle.classList.toggle('on', !!(st && st.shuffle));
    const dev = st && st.device;
    els.device.lastChild.textContent = dev ? dev.name : (Sp.sdkDeviceId() ? 'Coden (Browser)' : 'Gerät wählen');
    els.device.firstChild.textContent = DEV_ICON[dev && dev.type] || 'speaker';
    if (dev && dev.volume != null && document.activeElement !== els.vol) { els.vol.value = dev.volume; }
    paintRange(els.vol);
    els.volIcon.firstChild.textContent = +els.vol.value === 0 ? 'volume_off' : +els.vol.value < 50 ? 'volume_down' : 'volume_up';
    els.vol.disabled = !!(dev && dev.volume == null);
    els.open.href = (t && t.url) || 'https://open.spotify.com';
    updateProgress();
    if (st && st.playing) startTick(); else stopTick();
}
function updateProgress() {
    const st = Sp.getState();
    const t = st && st.track;
    if (!t) { els.time.textContent = els.dur.textContent = '0:00'; els.seek.value = 0; paintRange(els.seek); return; }
    if (els.seek.dataset.drag) return;
    const p = C().progressAt(st);
    els.time.textContent = C().fmtTime(p); els.dur.textContent = C().fmtTime(t.durationMs);
    els.seek.value = t.durationMs ? Math.round(p / t.durationMs * 1000) : 0;
    paintRange(els.seek);
    if (t.durationMs && p >= t.durationMs && st.playing) { stopTick(); setTimeout(() => Sp.refresh().catch(() => {}), 1200); }
}
function startTick() { if (!ticker) ticker = setInterval(updateProgress, 500); }
function stopTick() { clearInterval(ticker); ticker = null; }

export function mount() {
    if (root) return;
    build();
    registerCards();
    Sp.onChange(render);
    document.addEventListener('coden:spotify-show', () => { ui.hidden = false; ui.collapsed = false; saveUi(); render(Sp.getState()); });
    window.addEventListener('coden:spotify-connected', () => { ui.hidden = false; ui.collapsed = false; saveUi(); render(Sp.getState()); toast('Spotify ist verbunden 🎵', { type: 'ok' }); });
    // Ein Chat-Befehl holt den Player wieder hervor (eingeklappt bleibt eingeklappt)
    window.addEventListener('coden:spotify-command', () => { ui.hidden = false; saveUi(); render(Sp.getState()); });
    render(Sp.getState());
}
