// js/spotify-auth.js – Spotify-Anmeldung ohne Client Secret (Authorization Code mit PKCE).
// Der Browser spricht direkt mit accounts.spotify.com. Tokens liegen nur in diesem Browser (localStorage), nie auf dem Server.
// Wird von js/spotify.js und von spotify-callback.html benutzt.
const KEY = 'coden_spotify_auth';
const PKCE = 'coden_spotify_pkce';
const ACCOUNTS = 'https://accounts.spotify.com';
export const REDIRECT_PATH = '/spotify-callback.html';
export const redirectUri = () => location.origin + REDIRECT_PATH;

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

export const AUTH_KEY = KEY;
export const getAuth = () => read(KEY);
export const isConnected = () => !!(read(KEY) || {}).refresh;
export function clearAuth() { write(KEY, null); }

function randomString(n = 64) {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return Array.from(bytes, b => abc[b % abc.length]).join('');
}
async function challengeOf(verifier) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Anmelde-Adresse bauen und den Prüfwert merken (gilt 15 Minuten)
export async function authorizeUrl(clientId, scopes, back) {
    const verifier = randomString(64);
    const state = randomString(24);
    write(PKCE, { verifier, state, clientId, back: back || location.href, at: Date.now() });
    const p = new URLSearchParams({
        response_type: 'code', client_id: clientId, scope: scopes.join(' '),
        code_challenge_method: 'S256', code_challenge: await challengeOf(verifier),
        redirect_uri: redirectUri(), state
    });
    return `${ACCOUNTS}/authorize?${p}`;
}

async function tokenRequest(params) {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params)
    });
    let j = null; try { j = await res.json(); } catch (_) {}
    if (!res.ok || !j || !j.access_token) {
        const err = new Error((j && (j.error_description || j.error)) || `Spotify-Anmeldung fehlgeschlagen (${res.status})`);
        err.status = res.status; err.code = j && j.error;
        throw err;
    }
    return j;
}
function save(j, clientId, old) {
    const a = { access: j.access_token, refresh: j.refresh_token || (old && old.refresh), exp: Date.now() + (j.expires_in || 3600) * 1000 - 60000, scope: j.scope || (old && old.scope) || '', clientId };
    write(KEY, a);
    return a;
}

// Rückkehr von Spotify: ?code=…&state=… gegen Tokens tauschen
export async function finishLogin(search = location.search) {
    const q = new URLSearchParams(search);
    const pk = read(PKCE);
    write(PKCE, null);
    if (q.get('error')) throw new Error(q.get('error') === 'access_denied' ? 'Du hast die Verbindung abgebrochen.' : 'Spotify: ' + q.get('error'));
    if (!pk || !pk.verifier || Date.now() - (pk.at || 0) > 15 * 60000) throw new Error('Die Anmeldung ist abgelaufen. Bitte nochmal auf „Spotify verbinden“ tippen.');
    if (!q.get('code') || q.get('state') !== pk.state) throw new Error('Ungültige Antwort von Spotify. Bitte nochmal verbinden.');
    const j = await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), client_id: pk.clientId, code_verifier: pk.verifier });
    save(j, pk.clientId);
    return { back: pk.back };
}

// Gültiges Zugriffstoken (erneuert sich selbst). Nur eine Erneuerung gleichzeitig, weil Spotify das Refresh-Token dabei austauscht.
let refreshing = null;
export async function accessToken(force = false) {
    const a = read(KEY);
    if (!a || !a.refresh) return '';
    if (!force && a.access && Date.now() < a.exp) return a.access;
    if (!refreshing) {
        refreshing = (async () => {
            try {
                const fresh = read(KEY);
                if (!force && fresh && fresh.access && Date.now() < fresh.exp) return fresh.access; // anderer Tab war schneller
                const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: fresh.refresh, client_id: fresh.clientId });
                return save(j, fresh.clientId, fresh).access;
            } catch (e) {
                if (e.status === 400 || e.code === 'invalid_grant') clearAuth(); // Zugriff widerrufen → neu verbinden
                throw e;
            } finally { setTimeout(() => { refreshing = null; }, 0); }
        })();
    }
    return refreshing;
}
