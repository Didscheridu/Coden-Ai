// js/auth.js – Anmeldung über das eigene Backend (Cookie-Sitzung)
const listeners = new Set();
export const auth = { currentUser: null };

async function post(path, body) {
    const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.code = data.code; throw err; }
    return data;
}

export async function refreshAuth() {
    try {
        const res = await fetch('/api/me', { credentials: 'same-origin' });
        auth.currentUser = res.ok ? await res.json() : null;
    } catch (e) { auth.currentUser = null; }
    listeners.forEach(cb => cb(auth.currentUser));
}

export function onAuthStateChanged(_auth, cb) { listeners.add(cb); refreshAuth(); }

export const loginWithEmail = async (email, password) => { await post('/auth/login', { email, password }); await refreshAuth(); };
export const registerWithEmail = async (email, password, setupCode) => { await post('/auth/register', { email, password, setupCode }); await refreshAuth(); };
export const logoutUser = async () => { await post('/auth/logout'); await refreshAuth(); };

// Google-Login (optional): nur aktiv, wenn GOOGLE_CLIENT_ID im Backend gesetzt ist
export async function initGoogleLogin(onError) {
    try {
        const { googleClientId } = await (await fetch('/api/config')).json();
        if (!googleClientId) return;
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
        google.accounts.id.initialize({
            client_id: googleClientId,
            callback: async ({ credential }) => {
                try { await post('/auth/google', { credential }); await refreshAuth(); } catch (e) { onError(e.message); }
            }
        });
        const box = document.getElementById('google-btn-container');
        google.accounts.id.renderButton(box, { theme: 'filled_black', size: 'large', text: 'signin_with', width: 280 });
        box.style.display = 'flex';
    } catch (e) { console.warn('Google-Login nicht verfügbar', e); }
}
