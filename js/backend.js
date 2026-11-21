// js/backend.js – alle Aufrufe ans eigene Backend, mit Firebase-Login-Token
import { auth } from './firebase-init.js';

export async function apiFetch(path, options = {}) {
    const user = auth.currentUser;
    if (!user) throw new Error('Nicht eingeloggt.');
    const token = await user.getIdToken();
    return fetch(`/api${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
}

export async function apiJson(path, options) {
    const res = await apiFetch(path, options);
    let data = {};
    try { data = await res.json(); } catch (e) { /* leere Antwort */ }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}
