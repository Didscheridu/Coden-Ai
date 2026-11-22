// /model-test (nur Owner): alle Modelle mit demselben Prompt testen, live zuschauen, am Ende Rangliste als Tabelle
import { apiFetch } from './backend.js';

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sec = (ms) => (ms == null ? '–' : (ms / 1000).toFixed(1));

export async function runModelTest(UI, prompt) {
    const { content } = UI._newRow(false);
    const rows = new Map(); let order = []; let meta = { prompt: '' }; let finished = false;
    const ac = new AbortController();
    content.innerHTML = `<div class="mt"><div class="mt-head"><b>🧪 Modell-Test</b> <span class="mt-info">startet …</span> <button class="mt-btn" data-stop>Stoppen</button> <button class="mt-btn" data-copy hidden>Tabelle kopieren</button></div><div class="mt-scroll"><table class="mt-table"><thead><tr><th>#</th><th>Modell</th><th>Anbieter</th><th>Status</th><th>Start&nbsp;s</th><th>Gesamt&nbsp;s</th><th>Zeichen</th><th>Z/s</th><th>Denk-Z.</th><th>Checks</th></tr></thead><tbody></tbody></table></div><div class="mt-foot"></div></div>`;
    const tbody = content.querySelector('tbody'), info = content.querySelector('.mt-info'), foot = content.querySelector('.mt-foot');
    const stopBtn = content.querySelector('[data-stop]'), copyBtn = content.querySelector('[data-copy]');
    stopBtn.onclick = () => { ac.abort(); info.textContent = 'gestoppt'; };
    const scroll = () => { const c = document.getElementById('chat-container'); if (c) c.scrollTop = c.scrollHeight; };

    const rate = (r) => (r.ms > 0 ? r.chars / (r.ms / 1000) : 0);
    const draw = () => {
        const done = [...rows.values()].filter(r => r.state === 'done');
        const ranked = done.filter(r => r.ok).sort((a, b) => a.ms - b.ms);
        const rankOf = new Map(ranked.map((r, i) => [r.key, i + 1]));
        const view = finished ? [...ranked, ...done.filter(r => !r.ok), ...[...rows.values()].filter(r => r.state !== 'done')] : order.map(k => rows.get(k));
        tbody.innerHTML = view.map(r => {
            const live = r.state === 'run', zs = r.chars && r.ms ? rate(r).toFixed(0) : '–';
            const status = r.state === 'wait' ? '⏳ wartet' : live ? `<span class="mt-live">● läuft</span>` : r.ok ? '✅ fertig' : `❌ ${esc(r.error || 'Fehler')}`;
            return `<tr class="${r.state}${r.ok === false ? ' bad' : ''}"><td>${rankOf.get(r.key) || ''}</td><td><b>${esc(r.id)}</b></td><td>${esc(r.providerName)}</td><td>${status}</td><td>${sec(r.ttft)}</td><td>${sec(r.ms)}</td><td>${r.chars || 0}</td><td>${zs}</td><td>${r.thinkChars || 0}</td><td>${r.checks != null ? r.checks + '/6' : '–'}</td></tr>`;
        }).join('');
        scroll();
    };
    // Laufende Zeit zwischen den Server-Meldungen weiterzählen
    const ticker = setInterval(() => { for (const r of rows.values()) if (r.state === 'run') r.ms = Date.now() - r.t0; if (!finished) draw(); }, 500);

    const markdown = () => {
        const done = [...rows.values()].filter(r => r.state === 'done'); const ok = done.filter(r => r.ok).sort((a, b) => a.ms - b.ms); const bad = done.filter(r => !r.ok);
        const head = `Modell-Test (${new Date().toLocaleString('de-DE')}) · Prompt: ${(meta.prompt || '').slice(0, 120)}${(meta.prompt || '').length > 120 ? '…' : ''}\n\n| Rang | Modell | Anbieter | Start s | Gesamt s | Zeichen | Z/s | Denk-Zeichen | Checks | Vollständig |\n|---|---|---|---|---|---|---|---|---|---|`;
        const line = (r, i) => `| ${i} | ${r.id} | ${r.providerName} | ${sec(r.ttft)} | ${sec(r.ms)} | ${r.chars} | ${rate(r).toFixed(0)} | ${r.thinkChars} | ${r.checks != null ? r.checks + '/6' : '–'} | ${r.complete ? 'ja' : 'nein'} |`;
        return [head, ...ok.map((r, i) => line(r, i + 1)), ...bad.map(r => `| – | ${r.id} | ${r.providerName} | | | | | | | Fehler: ${String(r.error).replace(/\|/g, '/')} |`)].join('\n');
    };
    copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(markdown()); copyBtn.textContent = 'Kopiert ✓'; } catch (_) { copyBtn.textContent = 'Kopieren nicht möglich'; } setTimeout(() => { copyBtn.textContent = 'Tabelle kopieren'; }, 2000); };

    const handle = (ev) => {
        if (ev.t === 'init') {
            meta.prompt = ev.prompt; order = ev.models.map(m => m.key);
            ev.models.forEach(m => rows.set(m.key, { ...m, state: 'wait', chars: 0, thinkChars: 0, ms: 0, ttft: null }));
            info.textContent = `${ev.models.length} Modelle · gleicher Prompt, je 3 gleichzeitig`; foot.textContent = 'Prompt: ' + ev.prompt.slice(0, 160) + (ev.prompt.length > 160 ? '…' : '');
        } else if (ev.t === 'start') { const r = rows.get(ev.key); if (r) { r.state = 'run'; r.t0 = Date.now(); } }
        else if (ev.t === 'p') { const r = rows.get(ev.key); if (r) Object.assign(r, { chars: ev.chars, thinkChars: ev.thinkChars, ms: ev.ms, ttft: ev.ttft, t0: Date.now() - ev.ms }); }
        else if (ev.t === 'r') { const r = rows.get(ev.row.key); if (r) Object.assign(r, ev.row, { state: 'done', complete: ev.complete, checks: ev.checks }); }
        else if (ev.t === 'done') { finished = true; }
        draw();
    };
    try {
        const res = await apiFetch('/models/test', { method: 'POST', body: JSON.stringify({ prompt: prompt || undefined }), signal: ac.signal });
        if (!res.ok) { let d = {}; try { d = await res.json(); } catch (_) {} throw new Error(d.error || `HTTP ${res.status}`); }
        const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
        for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            buf += dec.decode(value, { stream: true });
            let i; while ((i = buf.indexOf('\n\n')) !== -1) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (line.startsWith('data: ')) { try { handle(JSON.parse(line.slice(6))); } catch (_) { /* kaputtes Ereignis */ } } }
        }
    } catch (e) { if (!ac.signal.aborted) { info.textContent = '❌ ' + e.message; } }
    finally { clearInterval(ticker); finished = true; stopBtn.hidden = true; draw(); if (rows.size) { copyBtn.hidden = false; const ok = [...rows.values()].filter(r => r.ok).length; info.textContent = `${ac.signal.aborted ? 'gestoppt – ' : 'fertig – '}${ok} von ${rows.size} Modellen erfolgreich · sortiert nach Gesamtzeit`; } }
}
