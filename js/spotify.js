// js/spotify.js – Spotify in Coden: verbinden, Web API, Web Playback SDK (Coden als Lautsprecher im Browser) und Befehle aus dem Chat.
// Logik ohne Netz: shared/spotify-core.js (window.CodenSpotify). Oberfläche: js/spotify-player.js.
// Spotify-Regeln (seit Feb. 2026): Entwicklermodus nur mit Premium und für höchstens 5 eingetragene Nutzer.
import { authorizeUrl, accessToken, isConnected, clearAuth, AUTH_KEY } from './spotify-auth.js';

const C = () => window.CodenSpotify;
const API = 'https://api.spotify.com/v1';
const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

let clientId = null;          // aus /api/spotify/config (Vercel: SPOTIFY_CLIENT_ID)
let configLoaded = null;
let state = null;              // einheitlicher Wiedergabe-Zustand (siehe stateFromApi)
let sdkPlayer = null, sdkDevice = '', sdkLoading = null, sdkError = '';
const listeners = new Set();

const emit = () => { for (const f of listeners) { try { f(state); } catch (_) {} } };
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const getState = () => state;
export const configured = () => !!clientId;
export const connected = () => isConnected();
export const sdkDeviceId = () => sdkDevice;
export const sdkProblem = () => sdkError;

export async function loadConfig() {
    if (!configLoaded) {
        configLoaded = fetch('/api/spotify/config').then(r => (r.ok ? r.json() : null)).then(j => { clientId = (j && j.clientId) || null; return clientId; })
            .catch(() => { configLoaded = null; return null; });
    }
    return configLoaded;
}

// Handy/iPad: Das Web Playback SDK läuft dort nicht → die Spotify-App fernsteuern
const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

// ---------- Verbinden ----------
export async function connect() {
    await loadConfig();
    if (!clientId) { const e = new Error('Spotify ist noch nicht eingerichtet (SPOTIFY_CLIENT_ID fehlt in Vercel).'); e.code = 'not_configured'; throw e; }
    const url = await authorizeUrl(clientId, C().SCOPES, location.href);
    // Am Computer als Fenster, damit der Chat offen bleibt; am Handy und in der installierten App in derselben Seite
    if (!isMobile() && !standalone()) {
        const w = window.open(url, 'coden-spotify', 'width=480,height=720');
        if (w) return 'popup';
    }
    location.assign(url);
    return 'redirect';
}
export function disconnect() {
    clearAuth();
    try { sdkPlayer && sdkPlayer.disconnect(); } catch (_) {}
    sdkPlayer = null; sdkDevice = ''; state = null; stopPolling();
    emit();
}
// Rückmeldung aus dem Anmelde-Fenster oder aus einem anderen Tab
window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.codenSpotify === 'connected') afterConnect(); });
window.addEventListener('storage', (e) => { if (e.key === AUTH_KEY) { if (isConnected()) afterConnect(); else disconnect(); } });
function afterConnect() { window.dispatchEvent(new CustomEvent('coden:spotify-connected')); initSdk(); refresh(); startPolling(); }

// ---------- Web API ----------
function spotifyError(status, body) {
    const e = new Error(C().errorText(status, body));
    e.status = status; e.reason = body && body.error && body.error.reason;
    return e;
}
export async function api(path, { method = 'GET', body, retried = false, retried5 = false } = {}) {
    const t = await accessToken().catch(() => '');
    if (!t) { const e = new Error('Spotify ist nicht verbunden. Tippe im Plus-Menü auf „Spotify verbinden“.'); e.code = 'not_connected'; throw e; }
    const res = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + t, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 && !retried) { await accessToken(true).catch(() => ''); return api(path, { method, body, retried: true, retried5 }); }
    if (res.status >= 500 && !retried5) { await new Promise(r => setTimeout(r, 900)); return api(path, { method, body, retried, retried5: true }); }
    if (res.status === 204 || res.status === 202) return null;
    const txt = await res.text();
    let j = null; if (txt) { try { j = JSON.parse(txt); } catch (_) {} }
    if (!res.ok) {
        if (res.status === 401) { clearAuth(); emit(); }
        throw spotifyError(res.status, j || { error: { message: txt.slice(0, 160) } });
    }
    return j;
}

// ---------- Web Playback SDK ----------
export function initSdk() {
    if (sdkLoading || !isConnected() || isMobile()) return sdkLoading;
    sdkLoading = new Promise((resolve) => {
        const start = () => {
            try {
                sdkPlayer = new window.Spotify.Player({
                    name: 'Coden (Browser)', volume: 0.6,
                    getOAuthToken: (cb) => { accessToken().then(cb).catch(() => cb('')); }
                });
            } catch (e) { sdkError = String(e.message || e); resolve(''); return; }
            sdkPlayer.addListener('ready', ({ device_id }) => { sdkDevice = device_id; sdkError = ''; resolve(device_id); emit(); });
            sdkPlayer.addListener('not_ready', () => { sdkDevice = ''; emit(); });
            sdkPlayer.addListener('player_state_changed', (s) => {
                if (!s) return;
                const vol = state && state.device && state.device.id === sdkDevice ? state.device.volume : null;
                state = C().stateFromSdk(s, { id: sdkDevice, name: 'Coden (Browser)', type: 'Computer', volume: vol, active: true });
                emit();
            });
            const fail = (m) => ({ message }) => { sdkError = m + (message ? ` (${message})` : ''); resolve(''); emit(); };
            sdkPlayer.addListener('initialization_error', fail('Dein Browser kann Spotify nicht direkt abspielen'));
            sdkPlayer.addListener('authentication_error', fail('Spotify-Anmeldung abgelaufen'));
            sdkPlayer.addListener('account_error', fail('Abspielen im Browser braucht Spotify Premium'));
            sdkPlayer.addListener('autoplay_failed', () => { sdkError = 'Der Browser hat Autoplay blockiert – tippe einmal auf Play.'; emit(); });
            sdkPlayer.connect().then(ok => { if (!ok) resolve(''); });
            setTimeout(() => resolve(sdkDevice), 8000);
        };
        if (window.Spotify && window.Spotify.Player) { start(); return; }
        window.onSpotifyWebPlaybackSDKReady = start;
        const s = document.createElement('script'); s.src = SDK_URL; s.async = true;
        s.onerror = () => { sdkError = 'Spotify-Player konnte nicht geladen werden'; resolve(''); };
        document.head.appendChild(s);
    });
    return sdkLoading;
}
// Safari/Chrome lassen Ton erst nach einem Tipp zu → bei jedem Klick im Player einmal aufrufen
export function unlockAudio() { try { sdkPlayer && sdkPlayer.activateElement && sdkPlayer.activateElement(); } catch (_) {} }

// ---------- Zustand ----------
export async function refresh() {
    if (!isConnected()) { state = null; emit(); return null; }
    try { state = C().stateFromApi(await api('/me/player')); }
    catch (e) { if (e.code === 'not_connected') state = null; else throw e; }
    emit();
    return state;
}
let pollTimer = null;
function tick() {
    clearTimeout(pollTimer);
    if (!isConnected()) return;
    const every = document.hidden ? 0 : (state && state.playing ? 5000 : 15000);
    if (!every) return; // unsichtbarer Tab: nicht fragen, beim Zurückkommen weiter
    pollTimer = setTimeout(async () => { try { if (!(state && state.device && state.device.id === sdkDevice && sdkDevice)) await refresh(); } catch (_) {} tick(); }, every);
}
export function startPolling() { tick(); }
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && isConnected()) { refresh().catch(() => {}); tick(); } });

// ---------- Geräte ----------
export async function devices() { return ((await api('/me/player/devices')) || {}).devices || []; }
async function targetDevice() {
    if (state && state.device && state.device.active && state.device.id) return state.device.id;
    if (!isMobile()) await initSdk();
    const list = await devices().catch(() => []);
    const id = C().chooseDevice(list, sdkDevice);
    if (!id) { const e = new Error(C().errorText(404, { error: { reason: 'NO_ACTIVE_DEVICE' } })); e.status = 404; throw e; }
    return id;
}
export async function transfer(id, play = true) {
    await api('/me/player', { method: 'PUT', body: { device_ids: [id], play } });
    setTimeout(() => refresh().catch(() => {}), 700);
}
const later = () => { setTimeout(() => refresh().catch(() => {}), 600); setTimeout(() => refresh().catch(() => {}), 2200); };
const optimistic = (patch) => { if (state) { state = { ...state, ...patch, at: Date.now() }; emit(); } };

// ---------- Steuern ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Nach einem Befehl nachsehen, ob er wirklich angekommen ist (Spotify sagt oft „ok“, obwohl ein Lautsprecher schläft)
async function waitFor(check, waits = [700, 1200, 1800]) {
    for (const ms of waits) {
        await sleep(ms);
        const st = await refresh().catch(() => undefined);
        if (st !== undefined && check(st)) return st || { playing: false };
    }
    return null;
}
const devName = () => (state && state.device && state.device.name) || 'dem Gerät';
const deviceParam = async () => (state && state.device && state.device.active ? '' : '?device_id=' + encodeURIComponent(await targetDevice()));
async function playOn(body) {
    const id = await targetDevice();
    try { await api('/me/player/play?device_id=' + encodeURIComponent(id), { method: 'PUT', body }); }
    catch (e) {
        if (e.status !== 404) throw e;
        await api('/me/player', { method: 'PUT', body: { device_ids: [id], play: false } }); // Gerät erst aufwecken
        await sleep(500);
        await api('/me/player/play?device_id=' + encodeURIComponent(id), { method: 'PUT', body });
    }
    return id;
}
// Abspielen mit Prüfung und einem zweiten Versuch (Gerät aufwecken)
async function playChecked(body, ok) {
    const id = await playOn(body);
    let st = await waitFor(ok);
    if (st) return st;
    await api('/me/player', { method: 'PUT', body: { device_ids: [id], play: true } }).catch(() => {});
    await sleep(600);
    await api('/me/player/play?device_id=' + encodeURIComponent(id), { method: 'PUT', body }).catch(() => {});
    st = await waitFor(ok, [1000, 1800]);
    if (st) return st;
    throw new Error(`Spotify hat den Befehl angenommen, aber auf „${devName()}“ startet nichts. Ist das Gerät an und online? Wähl im Miniplayer unten bei „Gerät“ ein anderes aus oder öffne kurz die Spotify-App.`);
}
async function find(q, type) {
    const core = C();
    if (type === 'playlist' || /\b(meine|mein|my)\b/i.test(q)) {
        const own = await api('/me/playlists?limit=50').catch(() => null);
        const hit = core.pickOwnPlaylist(q, own && own.items);
        if (hit) return { type: 'playlist', item: hit };
    }
    const types = type ? type : 'track,artist,album,playlist';
    const res = await api(`/search?type=${types}&limit=10&q=${encodeURIComponent(core.searchQuery(q, type))}`);
    let pick = core.pickBest(q, type, res);
    if (!pick && core.splitQuery(q).artist) pick = core.pickBest(q, type, await api(`/search?type=${types}&limit=10&q=${encodeURIComponent(q)}`));
    return pick;
}
const isPick = (pick, before) => (st) => !!(st && st.playing && st.track && (pick.type === 'track' ? st.track.uri === pick.item.uri : (st.context === pick.item.uri || st.track.uri !== before)));
export async function play(q, type) {
    const pick = await find(q, type);
    if (!pick) throw new Error(`Bei Spotify nichts gefunden für „${q}“.`);
    unlockAudio();
    await playChecked(C().playBody(pick), isPick(pick, state && state.track && state.track.uri));
    return pick;
}
// Aus einer Auswahl-Karte oder dem Miniplayer: direkt eine URI abspielen
export async function playUri(type, uri, albumUri) {
    const pick = { type, item: { uri, album: albumUri ? { uri: albumUri } : null } };
    unlockAudio();
    await playChecked(C().playBody(pick), isPick(pick, state && state.track && state.track.uri));
    return state;
}
export async function resume() {
    unlockAudio();
    if (state && state.playing && state.device && state.device.active) return state;
    const st = await playChecked(undefined, (s) => !!(s && s.playing));
    return st;
}
export async function pause() {
    if (sdkPlayer && state && state.device && state.device.id === sdkDevice) await sdkPlayer.pause();
    else await api('/me/player/pause' + await deviceParam(), { method: 'PUT' });
    optimistic({ playing: false, progressMs: C().progressAt(state) });
    const st = await waitFor((s) => !s || !s.playing, [600, 1200]);
    if (!st) throw new Error(`Spotify hat „Pause“ angenommen, aber auf „${devName()}“ läuft es noch.`);
}
export async function toggle() { return state && state.playing ? pause() : resume(); }
async function skip(dir) {
    const before = state && state.track && state.track.uri;
    await api(`/me/player/${dir}` + await deviceParam(), { method: 'POST' });
    const st = await waitFor((s) => !!(s && s.track && (s.track.uri !== before || (dir === 'previous' && s.progressMs < 4000))));
    if (!st) throw new Error(`Spotify hat „${dir === 'next' ? 'Weiter' : 'Zurück'}“ angenommen, aber auf „${devName()}“ hat sich nichts getan.`);
    if (!st.playing) await resume().catch(() => {});
    return state;
}
export async function next() { return skip('next'); }
export async function previous() { return skip('previous'); }
export async function seek(ms) { await api('/me/player/seek?position_ms=' + Math.max(0, Math.round(ms)), { method: 'PUT' }); optimistic({ progressMs: ms }); }
export async function volume(v) {
    const val = Math.max(0, Math.min(100, Math.round(v)));
    if (sdkPlayer && state && state.device && state.device.id === sdkDevice) await sdkPlayer.setVolume(val / 100);
    else await api('/me/player/volume?volume_percent=' + val, { method: 'PUT' });
    if (state && state.device) { state = { ...state, device: { ...state.device, volume: val } }; emit(); }
}
export async function shuffle(on) { await api('/me/player/shuffle?state=' + (on ? 'true' : 'false'), { method: 'PUT' }); optimistic({ shuffle: !!on }); }
export async function queue(q) {
    const pick = await find(q, 'track');
    if (!pick) throw new Error(`Bei Spotify keinen Song gefunden für „${q}“.`);
    await api('/me/player/queue?uri=' + encodeURIComponent(pick.item.uri), { method: 'POST' });
    return pick;
}
// Auswahl zum Antippen (Songs, Alben, Playlists, Künstler oder eigene Playlists)
export async function choices(q, type = 'track') {
    const core = C();
    const t = core.TYPES.includes(type) ? type : 'track';
    if (t === 'playlist' && (!q || /^(?:meine?|my|eigene)(?: playlists?)?$/i.test(q.trim()))) {
        const own = await api('/me/playlists?limit=24');
        return { type: 'playlist', own: true, items: ((own && own.items) || []).map(x => core.itemOf('playlist', x)).filter(Boolean).slice(0, 12) };
    }
    const res = await api(`/search?type=${t}&limit=10&q=${encodeURIComponent(core.searchQuery(q, t))}`);
    const list = ((res && res[t + 's'] && res[t + 's'].items) || []).map(x => core.itemOf(t, x)).filter(Boolean);
    return { type: t, items: list.slice(0, t === 'track' ? 8 : 9) };
}

// ---------- Befehle aus dem Chat ----------
// Gibt für jeden Befehl { ok, act, text, track?, card? } zurück. text geht ans Modell, der Rest in die Spotify-Karte im Chat.
export async function run(cmds) {
    const core = C();
    const out = [];
    const cur = () => core.trackOfState(state);
    for (const c of cmds || []) {
        const r = { ok: true, act: c.action, q: c.q || '' };
        try {
            if (c.action === 'play') { const p = await play(c.q, c.type); r.text = `Spielt jetzt ${core.describe(p)}${state && state.device ? ` auf „${state.device.name}“` : ''}.`; r.track = cur() || core.itemOf(p.type, p.item); r.pick = core.itemOf(p.type, p.item); }
            else if (c.action === 'resume') { await resume(); r.text = 'Wiedergabe läuft weiter.'; r.track = cur(); }
            else if (c.action === 'pause') { await pause(); r.text = 'Pausiert.'; r.track = cur(); }
            else if (c.action === 'next') { await next(); r.text = `Nächster Song: ${state && state.track ? `„${state.track.name}“ von ${state.track.artists}` : 'läuft'}.`; r.track = cur(); }
            else if (c.action === 'previous') { await previous(); r.text = `Zurück: ${state && state.track ? `„${state.track.name}“ von ${state.track.artists}` : 'läuft'}.`; r.track = cur(); }
            else if (c.action === 'volume') { await volume(+c.value); r.text = `Lautstärke auf ${c.value} %.`; r.value = +c.value; }
            else if (c.action === 'shuffle') { await shuffle(c.value !== 'off'); r.text = c.value === 'off' ? 'Zufallswiedergabe aus.' : 'Zufallswiedergabe an.'; }
            else if (c.action === 'queue') { const p = await queue(c.q); r.text = `${core.describe(p)} kommt als Nächstes.`; r.track = core.itemOf('track', p.item); }
            else if (c.action === 'now') {
                const st = await refresh();
                r.text = st && st.track ? `${st.playing ? 'Läuft' : 'Pausiert'}: „${st.track.name}“ von ${st.track.artists}${st.device ? ` auf „${st.device.name}“` : ''}.` : 'Gerade läuft nichts.';
                r.track = cur();
            }
            else if (c.action === 'choose') {
                const ch = await choices(c.q, c.type || 'track');
                if (!ch.items.length) throw new Error(`Bei Spotify nichts gefunden für „${c.q}“.`);
                r.card = { k: 'pick', q: ch.own ? 'Deine Playlists' : c.q, ty: ch.type, items: ch.items };
                r.text = `Auswahl im Chat angezeigt (${ch.items.length}): ` + ch.items.map((x, i) => `${i + 1}. ${x.n}${x.a ? ' – ' + x.a : ''}`).join('; ') + '. Der Nutzer tippt selbst an, was laufen soll.';
            }
        } catch (e) { r.ok = false; r.text = e.message || String(e); }
        if (state && state.device) r.dev = state.device.name;
        out.push(r);
    }
    window.dispatchEvent(new CustomEvent('coden:spotify-command', { detail: out }));
    return out;
}
export const promptInfo = () => ({ configured: !!clientId, connected: isConnected(), state });

// Start: Konfiguration holen; ist schon verbunden, Player und Abfrage starten
export async function boot() {
    await loadConfig();
    if (clientId && isConnected()) { initSdk(); refresh().catch(() => {}); startPolling(); }
}
