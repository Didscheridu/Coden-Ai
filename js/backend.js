// js/backend.js – alle Aufrufe ans eigene Backend, mit Firebase-Login-Token
import { auth } from './auth.js';

async function send(path, options, forceRefresh) {
    const token = await auth.currentUser.getIdToken(forceRefresh);
    return fetch(`/api${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
}

export async function apiFetch(path, options = {}) {
    if (!auth.currentUser) throw new Error('Nicht eingeloggt.');
    let res = await send(path, options, false);
    // Token evtl. abgelaufen: einmal mit frischem Token wiederholen (keine Schleife)
    if (res.status === 401) res = await send(path, options, true);
    return res;
}

export async function apiJson(path, options) {
    const res = await apiFetch(path, options);
    let data = {};
    try { data = await res.json(); } catch (e) { /* leere Antwort */ }
    if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.code = data.code; throw err; }
    return data;
}
