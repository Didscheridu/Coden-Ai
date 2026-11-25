// Denk-Anzeige wie bei Claude/ChatGPT/Perplexity:
// - Überschrift des aktuellen Schritts + Timer ("Denkt nach · 12 s"), danach kompakt "Hat 34 s nachgedacht"
// - Aufgeklappt: Liste der bisherigen Schritte (✓) und ein kurzer Ausschnitt des aktuellen Schritts
// - Dauert es länger: Hinweis, dass Coden im Hintergrund weiterarbeitet, plus "Benachrichtigen, wenn fertig"
import { canAskNotify, askNotify } from './runs.js';
import { loader } from './rich-elements.js';

const fmt = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);
const QUIET = /^(Anfrage läuft|Modell antwortet langsam|Anderes Modell|Neuer Versuch|Anbieter überlastet)/;

export function createThinkPanel({ label = 'Coden denkt nach …', startedAt = Date.now(), hint = true } = {}) {
    const el = document.createElement('details'); el.className = 'think-panel live';
    const sum = document.createElement('summary');
    const dots = loader({ size: 20 }); dots.classList.add('think-loader'); // gleiche Lade-Animation wie überall in Coden
    const head = document.createElement('span'); head.className = 'think-head'; head.textContent = label;
    const time = document.createElement('span'); time.className = 'think-time';
    const model = document.createElement('span'); model.className = 'think-model'; model.hidden = true;
    const chev = document.createElement('span'); chev.className = 'material-symbols-outlined think-chev'; chev.textContent = 'expand_more';
    sum.append(dots, head, time, model, chev);
    const steps = document.createElement('ol'); steps.className = 'think-steps';
    const body = document.createElement('div'); body.className = 'think-body';
    const note = document.createElement('div'); note.className = 'think-note'; note.hidden = true;
    // Live-Zeile: zeigt schon während des Denkens, woran Coden gerade arbeitet (ohne Aufklappen)
    const live = document.createElement('div'); live.className = 'think-live'; live.hidden = true;
    el.append(sum, live, steps, body, note);

    const parsedStart = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
    const t0 = Number.isFinite(parsedStart) ? parsedStart : Date.now();
    const seen = []; const notes = new Map(); let cur = ''; let lastText = ''; let ended = false; let finalSecs = null;
    const secs = () => (finalSecs !== null ? finalSecs : Math.max(0, Math.round((Date.now() - t0) / 1000)));
    const tick = () => {
        if (ended) return; const s = secs(); time.textContent = s >= 1 ? '· ' + fmt(s) : '';
        if (hint && s >= 8 && note.hidden) showNote();
    };
    const timer = setInterval(tick, 1000); tick();
    function showNote() {
        note.hidden = false; note.replaceChildren();
        const t = document.createElement('span'); t.textContent = 'Coden arbeitet auf dem Server weiter – du kannst die Seite schließen oder den Chat wechseln.';
        note.append(Object.assign(document.createElement('span'), { className: 'material-symbols-outlined', textContent: 'cloud_sync' }), t);
        if (canAskNotify()) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'think-notify';
            b.innerHTML = '<span class="material-symbols-outlined">notifications</span>Benachrichtigen';
            b.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); const ok = await askNotify(); b.replaceWith(Object.assign(document.createElement('small'), { textContent: ok ? '🔔 Du bekommst eine Nachricht.' : 'Benachrichtigungen sind blockiert.' })); });
            note.append(b);
        }
    }
    function buildSummaryText() {
        const entries = [...notes.entries()].filter(([, v]) => v && v.trim());
        if (entries.length > 1) {
            return entries.map(([k, v]) => (k ? `${k}:\n${v}` : v)).join('\n\n').slice(-3000);
        }
        if (entries.length === 1) return entries[0][1].slice(-3000);
        return lastText.slice(-3000);
    }
    function drawSteps() {
        steps.replaceChildren(...seen.map(s => { const li = document.createElement('li'); li.className = 'done'; li.textContent = s; return li; }));
        if (cur && !ended) { const li = document.createElement('li'); li.className = 'now'; li.textContent = cur; steps.append(li); }
        el.classList.toggle('has-steps', steps.children.length > 0);
    }
    return {
        el,
        think(k) {
            if (!k || ended) return;
            if (Array.isArray(k.steps)) { k.steps.forEach(s => { if (!seen.includes(s)) seen.push(s); }); }
            if (k.h) { if (k.h !== cur && cur && !QUIET.test(cur) && !seen.includes(cur)) seen.push(cur); cur = k.h; head.textContent = k.h; }
            const val = typeof k.v === 'string' ? k.v.trim() : '';
            if (val) {
                lastText = val;
                if (!QUIET.test(cur)) notes.set(cur || 'Überlege', val);
            }
            body.textContent = val;
            el.classList.toggle('has-body', !!val);
            const snip = val.replace(/\s+/g, ' ').trim();
            const doneN = seen.filter(x => !QUIET.test(x)).length;
            live.hidden = !(snip || doneN);
            live.textContent = (doneN ? `✓ ${doneN} Schritt${doneN === 1 ? '' : 'e'} erledigt${snip ? ' · ' : ''}` : '') + (snip.length > 160 ? '… ' + snip.slice(-160) : snip);
            drawSteps();
        },
        model(name) { if (!name) return; model.textContent = name; model.hidden = false; },
        // Antwort fertig: kompakt "Hat 12 s nachgedacht" (aufklappbar mit Schritten & Gedanken). Liefert {secs, steps, text?}
        done() {
            if (ended) { const txt = buildSummaryText(); return { secs: finalSecs ?? 0, steps: seen.slice(), ...(txt ? { text: txt } : {}) }; }
            finalSecs = Math.max(0, Math.round((Date.now() - t0) / 1000));
            ended = true; clearInterval(timer);
            if (cur && !QUIET.test(cur) && !seen.includes(cur)) seen.push(cur);
            const s = finalSecs;
            const txt = buildSummaryText();
            el.classList.remove('live');
            note.hidden = true; live.hidden = true;
            body.textContent = txt;
            el.classList.toggle('has-body', !!txt);
            head.textContent = s >= 2 ? `Hat ${fmt(s)} nachgedacht` : (s >= 1 ? 'Hat 1 s nachgedacht' : 'Kurz nachgedacht');
            time.textContent = '';
            drawSteps();
            return { secs: s, steps: seen.slice(), ...(txt ? { text: txt } : {}) };
        },
        remove() { clearInterval(timer); el.remove(); }
    };
}

// Gespeicherte Denk-Info einer fertigen Antwort (beim Neuladen des Chats)
export function thinkSummary(info) {
    if (!info || !(info.secs >= 1 || info.steps?.length || info.text)) return null;
    const p = createThinkPanel({ hint: false, startedAt: Date.now() - (info.secs || 0) * 1000 });
    p.think({ steps: info.steps || [], v: info.text || '' }); p.done(); return p.el;
}
