// js/api.js – die Modell-Kaskade und alle Keys liegen im Backend
import { apiJson, apiFetch } from './backend.js';
import { getEffort } from './effort.js';

// Ohne Streaming (Titel, E-Mail-Entwurf)
export async function generateAiResponse(messages, tier) {
    const data = await apiJson('/chat', { method: 'POST', body: JSON.stringify({ messages, tier }) });
    return data.content;
}

// Live-Streaming per Server-Sent Events. onDelta(text) liefert den bisherigen GESAMTTEXT.
// Gibt den fertigen Text zurück; bei Abbruch (signal) den bisherigen Text. Fehler nach Teilausgabe tragen e.partial.
export async function streamAiResponse(messages, tier, { onDelta, onModel, onThink, signal, maxTokens, model, effort } = {}) {
    const res = await apiFetch('/chat/stream', { method: 'POST', body: JSON.stringify({ messages, tier, ...(maxTokens ? { maxTokens } : {}), ...(model ? { model } : {}), effort: effort || getEffort() }), signal });
    if (!res.ok) {
        let d = {}; try { d = await res.json(); } catch (_) {}
        const err = new Error(d.error || `HTTP ${res.status}`); err.code = d.code; throw err;
    }
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = '', full = '', done = false;
    const handle = (line) => {
        if (!line.startsWith('data: ')) return;
        let ev; try { ev = JSON.parse(line.slice(6)); } catch (_) { return; }
        if (ev.t === 'd') { full += ev.v; onDelta?.(full); }
        else if (ev.t === 'm') onModel?.(ev.model);
        else if (ev.t === 'k') onThink?.({ h: ev.h, v: ev.v });
        else if (ev.t === 'done') done = true;
        else if (ev.t === 'e') { const err = new Error(ev.error || 'Fehler'); err.partial = !!ev.partial; err.text = full; throw err; }
    };
    try {
        for (;;) {
            const { value, done: end } = await reader.read();
            if (end) break;
            buf += dec.decode(value, { stream: true });
            let i; while ((i = buf.indexOf('\n\n')) !== -1) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
        }
    } catch (e) {
        if (signal?.aborted) return full;
        if (e.text === undefined) e.text = full;
        throw e;
    }
    if (!done && !signal?.aborted) { const err = new Error('Die Verbindung wurde unterbrochen.'); err.text = full; err.partial = !!full; throw err; }
    return full;
}
