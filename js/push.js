// js/push.js – Push-Benachrichtigungen: Coden meldet sich, wenn eine Aufgabe fertig ist, auch bei geschlossener Seite.
// (Auf dem iPhone geht das nur, wenn Coden über „Zum Home-Bildschirm“ installiert ist.)
import { apiJson } from './backend.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
let regP = null;
const reg = () => (regP ||= navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready));

// 'on' | 'off' | 'blocked' | 'unsupported'
export async function pushState() {
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    if (Notification.permission !== 'granted') return 'off';
    try { const r = await reg(); return (await r.pushManager.getSubscription()) ? 'on' : 'off'; } catch (_) { return 'off'; }
}
export async function enablePush({ ask = true } = {}) {
    if (!supported()) return false;
    if (Notification.permission !== 'granted') { if (!ask) return false; if ((await Notification.requestPermission()) !== 'granted') return false; }
    const r = await reg();
    let sub = await r.pushManager.getSubscription();
    if (!sub) { const { key } = await apiJson('/push/key'); sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }); }
    await apiJson('/push/subscribe', { method: 'POST', body: JSON.stringify({ sub: sub.toJSON() }) });
    return true;
}
export async function disablePush() {
    if (!supported()) return;
    const r = await reg(); const sub = await r.pushManager.getSubscription(); if (!sub) return;
    await apiJson('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
}
export const testPush = () => apiJson('/push/test', { method: 'POST', body: '{}' });
// Beim Start still erneuern, wenn der Nutzer schon zugestimmt hat (Abos können ablaufen)
export function refreshPush() { if (supported() && Notification.permission === 'granted') enablePush({ ask: false }).catch(() => {}); }
