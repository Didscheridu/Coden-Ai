// js/artifact-bridge.js – Die Gegenstelle für window.coden in Artefakten (wie window.claude / window.storage bei Claude).
// Ein Artefakt läuft abgeschottet (sandbox ohne allow-same-origin) und fragt per postMessage; hier wird mit dem Login
// des Nutzers die KI gefragt oder gespeichert. Nur iframes, die Coden selbst angemeldet hat (frame._coden), werden bedient.
import { apiJson } from './backend.js';

// Kurzer, stabiler Name für ein Artefakt (Chat + Titel), damit gespeicherte Daten über Fassungen hinweg bleiben
export function aidFor(sessionId, title) {
    let h1 = 0x811c9dc5, h2 = 0x01000193; const s = `${sessionId}|${title}`;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822507) >>> 0; }
    return 'c' + h1.toString(36) + h2.toString(36);
}
// info: () => { aid, published }
export function attachBridge(frame, info) { frame._coden = info; }

const enc = encodeURIComponent;
window.addEventListener('message', async (e) => {
    const d = e.data; if (!d || d.codenCall == null || typeof d.op !== 'string') return;
    const f = [...document.querySelectorAll('iframe')].find(x => x._coden && x.contentWindow === e.source);
    if (!f) return;
    const info = f._coden() || {}; const a = d.args || {};
    const reply = (ok, value, error) => { try { e.source.postMessage({ codenReply: d.codenCall, ok, value, error }, '*'); } catch (_) { /* Rahmen weg */ } };
    try {
        if (d.op === 'ask') {
            const body = Array.isArray(a.prompt) ? { messages: a.prompt } : { prompt: String(a.prompt ?? '') };
            const r = await apiJson('/artifacts/ask', { method: 'POST', body: JSON.stringify(body) });
            return reply(true, r.text);
        }
        if (!info.aid) return reply(false, null, 'Speichern geht hier nicht.');
        const shared = !!a.shared && !!info.published; // in nicht veröffentlichten Artefakten gibt es nur „persönlich“
        const base = `/artifacts/store/${enc(info.aid)}`;
        if (d.op === 'get') { const r = await apiJson(`${base}?key=${enc(a.key)}${shared ? '&shared=1' : ''}`); return reply(true, r.item ? { ...r.item, shared: !!a.shared } : null); }
        if (d.op === 'set') { const r = await apiJson(base, { method: 'PUT', body: JSON.stringify({ key: a.key, value: typeof a.value === 'string' ? a.value : JSON.stringify(a.value), shared }) }); return reply(true, { ...r, shared: !!a.shared }); }
        if (d.op === 'delete') { const r = await apiJson(`${base}?key=${enc(a.key)}${shared ? '&shared=1' : ''}`, { method: 'DELETE' }); return reply(true, { ...r, shared: !!a.shared }); }
        if (d.op === 'list') { const r = await apiJson(`${base}?prefix=${enc(a.prefix || '')}${shared ? '&shared=1' : ''}`); return reply(true, { ...r, shared: !!a.shared }); }
        reply(false, null, 'Unbekannte Funktion.');
    } catch (err) { reply(false, null, err.message || String(err)); }
});
