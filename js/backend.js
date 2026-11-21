// js/backend.js – alle Aufrufe ans eigene Backend (Sitzung läuft über httpOnly-Cookie)
import { auth, refreshAuth } from './auth.js';

export async function apiFetch(path, options = {}) {
    const res = await fetch(`/api${path}`, {
        ...options,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    // Sitzung abgelaufen -> zurück zum Login
    if (res.status === 401 && auth.currentUser) refreshAuth();
    return res;
}

export async function apiJson(path, options) {
    const res = await apiFetch(path, options);
    let data = {};
    try { data = await res.json(); } catch (e) { /* leere Antwort */ }
    if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.code = data.code; throw err; }
    return data;
}
