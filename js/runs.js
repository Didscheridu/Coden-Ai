// js/runs.js – Hintergrund-Läufe im Browser.
// Ein Lauf wird auf dem Server gestartet und läuft dort zu Ende, egal ob die Seite offen bleibt.
// Solange die Verbindung steht, kommen die Stücke live (SSE). Reißt sie ab (Handy gesperrt, Tab zu, Netz weg),
// wird per Abfrage weiterverfolgt. Beim nächsten Öffnen holt der Chat fertige Antworten selbst ab.
import { apiFetch, apiJson } from './backend.js';
import { getEffort } from './effort.js';
import { enablePush } from './push.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Liest einen SSE-Strom und ruft für jedes Ereignis onEvent auf
async function readSse(res, onEvent) {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) !== -1) {
            const line = buf.slice(0, i); buf = buf.slice(i + 2);
            if (!line.startsWith('data: ')) continue;
            let ev; try { ev = JSON.parse(line.slice(6)); } catch (_) { continue; }
            onEvent(ev);
        }
    }
}

// Verfolgt einen Lauf per Abfrage, bis er fertig ist. Liefert den Endstand.
export async function watchRun(id, { onDelta, onThink, onModel, onAgents, onExtra, signal, from = 0, text = '' } = {}) {
    let full = text, last = { h: null, v: null }, agentsSig = '', wait = 700;
    for (;;) {
        if (signal?.aborted) { await stopRun(id).catch(() => {}); return { status: 'stopped', text: full }; }
        let r;
        try { r = await apiJson(`/runs/${id}?from=${full.length}`); wait = document.hidden ? 2500 : 800; }
        catch (e) { if (/nicht gefunden/i.test(e.message)) throw e; await sleep(Math.min(wait *= 1.6, 8000)); continue; }
        if (r.from === full.length && r.text) { full += r.text; onDelta?.(full); }
        else if (r.from !== full.length) { const all = await apiJson(`/runs/${id}`); full = all.text; onDelta?.(full); }
        if (r.think?.h && (r.think.h !== last.h || r.think.v !== last.v)) { last = r.think; onThink?.({ h: r.think.h, v: r.think.v, steps: r.think.steps }); }
        if (r.model) onModel?.(r.model);
        const sig = JSON.stringify(r.agents || []); if (sig !== agentsSig) { agentsSig = sig; onAgents?.(r.agents || []); }
        if (r.meta?.extra) onExtra?.(r.meta.extra);
        if (r.status !== 'running') return { status: r.status, text: full, error: r.error, meta: r.meta, startedAt: r.startedAt };
        await sleep(wait);
    }
}

// Startet einen Chat-Lauf. Gleiches Verhalten wie streamAiResponse (onDelta bekommt den GESAMTTEXT),
// zusätzlich onRun(id) sobald der Server den Lauf angelegt hat.
export async function runAiResponse(messages, tier, { ref, meta, onDelta, onModel, onThink, onRun, onExtra, signal, maxTokens, model, effort, research, depth } = {}) {
    const ac = new AbortController(); // nur die Verbindung – ein Abbruch hier stoppt NICHT den Lauf
    const body = JSON.stringify({ messages, tier, ref, meta, ...(maxTokens ? { maxTokens } : {}), ...(model ? { model } : {}), ...(research ? { research: true, depth } : {}), effort: effort || getEffort() });
    let res = await apiFetch('/runs/chat', { method: 'POST', signal: ac.signal, body });
    // Kurzer Server-Schluckauf (Kaltstart, Absturz einer Instanz): einmal still neu versuchen
    if (res.status >= 500 && !signal?.aborted) { await sleep(900); res = await apiFetch('/runs/chat', { method: 'POST', signal: ac.signal, body }); }
    if (!res.ok) throw await httpError(res);
    let id = null, full = '', end = null, fail = null;
    const onAbort = () => { if (id) stopRun(id).catch(() => {}); };
    signal?.addEventListener('abort', onAbort);
    try {
        await readSse(res, (ev) => {
            if (ev.t === 'run') { id = ev.id; onRun?.(id); }
            else if (ev.t === 'd') { full += ev.v; onDelta?.(full); }
            else if (ev.t === 'r') { full = ev.v; onDelta?.(full); }
            else if (ev.t === 'k') onThink?.({ h: ev.h, v: ev.v });
            else if (ev.t === 'm') onModel?.(ev.model);
            else if (ev.t === 'x') onExtra?.(ev.x);
            else if (ev.t === 'done') end = ev.status || 'done';
            else if (ev.t === 'e') fail = ev;
        });
    } catch (_) { /* Verbindung weg – unten per Abfrage weiter */ }
    signal?.removeEventListener('abort', onAbort);
    if (fail) { const err = new Error(fail.error || 'Fehler'); err.partial = !!fail.partial; err.code = fail.code; err.text = full; err.runId = id; throw err; }
    if (end) return full;
    if (signal?.aborted) return full;
    if (!id) { const err = new Error('Die Verbindung wurde unterbrochen.'); err.text = full; err.partial = !!full; throw err; }
    // Verbindung abgerissen, der Lauf arbeitet aber auf dem Server weiter -> per Abfrage dranbleiben
    const r = await watchRun(id, { onDelta, onThink, onModel, onExtra, signal, text: full });
    if (r.status === 'error') { const err = new Error(r.error || 'Fehler'); err.partial = !!r.text; err.text = r.text; err.runId = id; throw err; }
    await claimRun(id).catch(() => {}); // dieses Gerät hat die Antwort -> andere sollen sie nicht noch einmal einfügen
    return r.text;
}

// Verständliche Fehlermeldung, auch wenn der Server nur eine Fehlerseite statt JSON schickt
async function httpError(res) {
    const raw = await res.text().catch(() => ''); let d = {};
    try { d = JSON.parse(raw); } catch (_) { /* keine JSON-Antwort */ }
    const code = (raw.match(/\b[A-Z][A-Z_]{8,}\b/) || [])[0];
    const msg = d.error || (res.status >= 500 ? `Der Server hatte gerade ein Problem (HTTP ${res.status}${code ? ' · ' + code : ''}). Bitte versuch es gleich nochmal.` : `HTTP ${res.status}`);
    const err = new Error(msg); err.code = d.code; err.usage = d.usage; err.status = res.status; return err;
}

export const listRuns = (kind = 'chat') => apiJson('/runs?kind=' + kind).then(r => r.runs || []);
export const claimRun = (id) => apiJson(`/runs/${id}/claim`, { method: 'POST', body: '{}' });
export const stopRun = (id) => apiJson(`/runs/${id}/stop`, { method: 'POST', body: '{}' });

// ---------- Benachrichtigung, wenn Coden fertig ist (wie Gemini Deep Research) ----------
let baseTitle = document.title, unseen = 0;
document.addEventListener('visibilitychange', () => { if (!document.hidden && unseen) { unseen = 0; document.title = baseTitle; } });
export function notifyDone(title, body) {
    if (!document.hidden) return;
    unseen++; if (!document.title.startsWith('✓')) { baseTitle = document.title; document.title = '✓ ' + (title || 'Coden ist fertig'); }
    try {
        if ('Notification' in window && Notification.permission === 'granted') {
            const n = new Notification(title || 'Coden ist fertig', { body: String(body || '').replace(/<[^>]+>/g, '').replace(/[#*`>]/g, '').trim().slice(0, 140), icon: './images/coden_logo.jpg', tag: 'coden-done' });
            n.onclick = () => { window.focus(); n.close(); };
        }
    } catch (_) {}
}
export const canAskNotify = () => 'Notification' in window && Notification.permission === 'default';
// Fragt nach Erlaubnis und meldet das Gerät für Push an (dann klappt es auch bei komplett geschlossener Seite)
export async function askNotify() {
    try { if (await enablePush()) return true; } catch (_) { /* Push nicht möglich – normale Benachrichtigung reicht */ }
    try { return (await Notification.requestPermission()) === 'granted'; } catch (_) { return false; }
}
