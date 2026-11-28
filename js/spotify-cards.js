// js/spotify-cards.js – Spotify-Elemente im Chat (<spotifycard>{json}</spotifycard>, gebaut von js/app.js):
//   k: 'status' → was Coden gemacht hat (Spielt jetzt · Cover · Titel · Gerät), statt des grauen Werkzeug-Kastens
//   k: 'pick'   → Auswahl zum Antippen (Songs als Liste, Alben/Playlists/Künstler als Kacheln)
//   k: 'busy'   → läuft gerade
// Die Karten werden über window.CodenWidgets in js/rich-elements.js eingehängt und zeigen live, was gerade läuft.
import { h, icon } from './apps/dom.js';
import { toast } from './toast.js';
import * as Sp from './spotify.js';

const C = () => window.CodenSpotify;
const ACT = {
    play: ['play_circle', 'Spielt jetzt'], resume: ['play_arrow', 'Läuft weiter'], pause: ['pause', 'Pausiert'],
    next: ['skip_next', 'Nächster Song'], previous: ['skip_previous', 'Zurück'], volume: ['volume_up', 'Lautstärke'],
    shuffle: ['shuffle', 'Zufallswiedergabe'], queue: ['queue_music', 'Als Nächstes'], now: ['graphic_eq', 'Läuft gerade'], choose: ['library_music', 'Auswahl']
};
const TYPE_LABEL = { track: 'Songs', album: 'Alben', playlist: 'Playlists', artist: 'Künstler' };

const cover = (src, cls = '') => {
    const b = h('div', { class: 'spc-cover ' + cls }, icon('music_note'));
    if (src && /^https:\/\//.test(src)) { const img = h('img', { alt: '', loading: 'lazy', src }); img.onerror = () => img.remove(); b.append(img); }
    return b;
};
const eq = () => h('span', { class: 'spc-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));

async function playItem(el, x) {
    if (!Sp.connected()) { toast('Spotify ist nicht verbunden. Plus-Menü → „Spotify verbinden“.', { type: 'warn' }); return; }
    el.classList.add('is-loading');
    try { await Sp.playUri(x.ty || 'track', x.u, x.al); }
    catch (e) { toast(e.message || String(e), { type: 'error', ms: 6000 }); }
    finally { el.classList.remove('is-loading'); mark(); }
}
async function togglePlay(btn) {
    btn.classList.add('is-loading');
    try { await Sp.toggle(); } catch (e) { toast(e.message || String(e), { type: 'error', ms: 6000 }); }
    finally { btn.classList.remove('is-loading'); mark(); }
}

// ---------- Status ----------
function buildStatus(d) {
    const rows = (d.rows || []).map(r => {
        const [ic, title] = ACT[r.act] || ['music_note', 'Spotify'];
        const head = !r.ok ? 'Hat nicht geklappt' : r.act === 'volume' ? `Lautstärke ${r.value ?? ''} %` : r.act === 'shuffle' ? r.text : r.act === 'now' && /^Pausiert/.test(r.text || '') ? 'Pausiert' : title;
        const t = r.track;
        const body = [h('div', { class: 'spc-st-h', text: head })];
        if (!r.ok) body.push(h('div', { class: 'spc-st-msg', text: r.text || '' }));
        else if (t && t.n) body.push(h('div', { class: 'spc-st-track' }, cover(t.i, 'sm'), h('div', { class: 'spc-tx' }, h('div', { class: 'spc-n', text: t.n }), h('div', { class: 'spc-a', text: t.a || '' }))));
        else if (r.act === 'now') body.push(h('div', { class: 'spc-st-msg', text: r.text || '' }));
        const row = h('div', { class: 'spc-st-row' + (r.ok ? '' : ' err'), 'data-spu': r.ok && t && t.u ? t.u : null },
            h('div', { class: 'spc-st-ic' }, icon(r.ok ? ic : 'error')), h('div', { class: 'spc-st-body' }, ...body));
        if (r.ok && t && t.u && ['play', 'resume', 'next', 'previous', 'now', 'queue'].includes(r.act)) {
            const btn = h('button', { type: 'button', class: 'spc-btn', title: 'Abspielen / Pause', 'aria-label': 'Abspielen oder Pause', onclick: (e) => { e.stopPropagation(); if (row.classList.contains('is-current')) togglePlay(btn); else playItem(btn, { ty: 'track', u: t.u }); } }, icon('play_arrow'));
            row.append(btn);
        }
        return row;
    });
    const dev = (d.rows || []).map(r => r.dev).find(Boolean);
    return h('div', { class: 'spc spc-status' }, ...rows,
        h('div', { class: 'spc-foot' }, h('span', { class: 'spc-brand' }, icon('music_note'), 'Spotify'), dev ? h('span', { class: 'spc-dev' }, icon('speaker'), dev) : null,
            h('button', { type: 'button', class: 'spc-link', onclick: () => document.dispatchEvent(new CustomEvent('coden:spotify-show')) }, 'Player öffnen')));
}

// ---------- Auswahl ----------
function buildPick(d) {
    const items = (d.items || []).filter(x => x && x.u);
    const isList = (d.ty || 'track') === 'track';
    const head = h('div', { class: 'spc-pick-h' }, h('div', { class: 'spc-st-ic' }, icon('library_music')),
        h('div', { class: 'spc-tx' }, h('div', { class: 'spc-n', text: d.q ? `„${d.q}“` : 'Auswahl' }), h('div', { class: 'spc-a', text: `${TYPE_LABEL[d.ty] || 'Songs'} · tippe zum Abspielen` })));
    let body;
    if (isList) {
        body = h('div', { class: 'spc-list' }, ...items.map((x, i) => {
            const row = h('button', { type: 'button', class: 'spc-row', 'data-spu': x.u, title: `${x.n} – ${x.a}`, onclick: () => (row.classList.contains('is-current') ? togglePlay(row) : playItem(row, x)) },
                h('span', { class: 'spc-num' }, h('span', { class: 'spc-i', text: String(i + 1) }), eq(), icon('play_arrow', 'spc-play')),
                cover(x.i, 'sm'), h('span', { class: 'spc-tx' }, h('span', { class: 'spc-n', text: x.n }), h('span', { class: 'spc-a', text: x.a || '' })),
                h('span', { class: 'spc-d', text: x.d ? C().fmtTime(x.d) : '' }));
            return row;
        }));
    } else {
        body = h('div', { class: 'spc-grid' + (d.ty === 'artist' ? ' round' : '') }, ...items.map(x => {
            const tile = h('button', { type: 'button', class: 'spc-tile', 'data-spu': x.u, title: x.n, onclick: () => (tile.classList.contains('is-current') ? togglePlay(tile) : playItem(tile, x)) },
                h('span', { class: 'spc-tile-art' }, cover(x.i), h('span', { class: 'spc-tile-play' }, icon('play_arrow')), eq()),
                h('span', { class: 'spc-n', text: x.n }), h('span', { class: 'spc-a', text: x.a || '' }));
            return tile;
        }));
    }
    return h('div', { class: 'spc spc-pick' }, head, body);
}

function buildBusy(d) {
    return h('div', { class: 'spc spc-busy' }, h('div', { class: 'spc-st-ic' }, eq()), h('div', { class: 'spc-tx' }, h('div', { class: 'spc-n', text: 'Spotify' }), h('div', { class: 'spc-a', text: d.text || 'läuft …' })));
}

export function buildCard(w) {
    const d = C() && C().parseCard(w.body);
    if (!d) return null;
    const el = d.k === 'pick' ? buildPick(d) : d.k === 'busy' ? buildBusy(d) : buildStatus(d);
    setTimeout(mark, 0);
    return el;
}

// Was gerade läuft, in allen Karten markieren
function mark() {
    const st = Sp.getState();
    const cur = st && st.track ? st.track.uri : '';
    const ctx = st && st.context ? st.context : '';
    document.querySelectorAll('.spc [data-spu]').forEach(el => {
        const on = !!cur && (el.dataset.spu === cur || el.dataset.spu === ctx);
        el.classList.toggle('is-current', on);
        el.classList.toggle('is-playing', on && !!(st && st.playing));
        const b = el.querySelector('.spc-btn .material-symbols-outlined');
        if (b) b.textContent = on && st && st.playing ? 'pause' : 'play_arrow';
    });
}

export function registerCards() {
    window.CodenWidgets = window.CodenWidgets || {};
    window.CodenWidgets.spotifycard = buildCard;
    Sp.onChange(mark);
}
