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
export async function api(path, { method = 'GET', body, retried = false } = {}) {
    const t = await accessToken().catch(() => '');
    if (!t) { const e = new Error('Spotify ist nicht verbunden. Tippe im Plus-Menü auf „Spotify verbinden“.'); e.code = 'not_connected'; throw e; }
    const res = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + t, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 && !retried) { await accessToken(true).catch(() => ''); return api(path, { method, body, retried: true }); }
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
async function playOn(body) {
    const id = await targetDevice();
    try { await api('/me/player/play?device_id=' + encodeURIComponent(id), { method: 'PUT', body }); }
    catch (e) {
        if (e.status !== 404) throw e;
        await api('/me/player', { method: 'PUT', body: { device_ids: [id], play: false } }); // Gerät erst aufwecken
        await api('/me/player/play?device_id=' + encodeURIComponent(id), { method: 'PUT', body });
    }
    later();
    return id;
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
export async function play(q, type) {
    const pick = await find(q, type);
    if (!pick) throw new Error(`Bei Spotify nichts gefunden für „${q}“.`);
    await playOn(C().playBody(pick));
    return pick;
}
export async function resume() { unlockAudio(); await playOn(undefined); optimistic({ playing: true, progressMs: C().progressAt(state) }); }
export async function pause() {
    if (sdkPlayer && state && state.device && state.device.id === sdkDevice) await sdkPlayer.pause();
    else await api('/me/player/pause', { method: 'PUT' });
    optimistic({ playing: false, progressMs: C().progressAt(state) }); later();
}
export async function toggle() { return state && state.playing ? pause() : resume(); }
export async function next() { await api('/me/player/next', { method: 'POST' }); later(); }
export async function previous() { await api('/me/player/previous', { method: 'POST' }); later(); }
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

// ---------- Befehle aus dem Chat ----------
// Gibt für jeden Befehl { ok, text } zurück (Text geht ans Modell und in den Werkzeug-Schritt).
export async function run(cmds) {
    const core = C();
    const out = [];
    for (const c of cmds || []) {
        try {
            if (c.action === 'play') { const p = await play(c.q, c.type); out.push({ ok: true, text: `Spielt jetzt ${core.describe(p)}.` }); }
            else if (c.action === 'resume') { await resume(); out.push({ ok: true, text: 'Wiedergabe läuft weiter.' }); }
            else if (c.action === 'pause') { await pause(); out.push({ ok: true, text: 'Pausiert.' }); }
            else if (c.action === 'next') { await next(); out.push({ ok: true, text: 'Nächster Song.' }); }
            else if (c.action === 'previous') { await previous(); out.push({ ok: true, text: 'Vorheriger Song.' }); }
            else if (c.action === 'volume') { await volume(+c.value); out.push({ ok: true, text: `Lautstärke auf ${c.value} %.` }); }
            else if (c.action === 'shuffle') { await shuffle(c.value !== 'off'); out.push({ ok: true, text: c.value === 'off' ? 'Zufallswiedergabe aus.' : 'Zufallswiedergabe an.' }); }
            else if (c.action === 'queue') { const p = await queue(c.q); out.push({ ok: true, text: `${core.describe(p)} kommt als Nächstes.` }); }
            else if (c.action === 'now') {
                const st = await refresh();
                out.push({ ok: true, text: st && st.track ? `${st.playing ? 'Läuft' : 'Pausiert'}: „${st.track.name}“ von ${st.track.artists}${st.device ? ` auf „${st.device.name}“` : ''}.` : 'Gerade läuft nichts.' });
            }
        } catch (e) { out.push({ ok: false, text: e.message || String(e) }); }
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
