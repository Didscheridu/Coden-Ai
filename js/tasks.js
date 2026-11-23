// js/tasks.js – Aufgaben & Zeitpläne: Coden erledigt etwas zu festen Zeiten (auch mit Deep Research) und legt das Ergebnis ab.
// Verwaltung in Einstellungen → Aufgaben. Der Server führt fällige Aufgaben aus (Zeitgeber oder, solange die App offen ist, ein Tick von hier).
// Die Logik (Zeitplan prüfen, nächster Termin) steckt in shared/tasks-core.js und ist dort getestet.
import { apiJson } from './backend.js';
import { toast } from './toast.js';
import { h, icon, md, timeAgo } from './apps/dom.js';
import { confirmBox } from './apps/dialogs.js';

const T = () => window.CodenTasks;
const TIERS = { flash: 'Coden Flash', normal: 'Coden Thinking', pro: 'Coden Pro' };
const fmt = (iso) => new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(',', '');
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'; } catch (_) { return 'Europe/Berlin'; } };
const localInput = (iso) => { const d = new Date(iso || Date.now() + 3600e3); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

let state = { tasks: [], unseen: 0, cron: true, limits: {} };
let lastUnseen = null, timer = null;

function badge(n) {
    state.unseen = n;
    const nav = document.getElementById('tasks-nav-badge'); if (nav) { nav.textContent = n > 9 ? '9+' : String(n); nav.style.display = n ? 'flex' : 'none'; }
    const tab = document.getElementById('tasks-tab-badge'); if (tab) { tab.textContent = String(n); tab.style.display = n ? 'inline-flex' : 'none'; }
}
const openTab = () => window.dispatchEvent(new CustomEvent('coden:settings', { detail: { tab: 'tasks' } }));

export const Tasks = {
    async load() { const r = await apiJson('/tasks'); state = { ...state, ...r }; badge(r.unseen); return r; },

    // Beim Start und danach alle paar Minuten: fällige Aufgaben anstoßen, neue Ergebnisse melden
    start() {
        if (timer) return;
        const cycle = async () => {
            if (document.hidden) return;
            try {
                await apiJson('/tasks/tick', { method: 'POST', body: '{}' }).catch(() => {});
                const r = await this.load();
                if (lastUnseen !== null && r.unseen > lastUnseen) {
                    const l = (await apiJson('/tasks/results')).results.find(x => !x.seen);
                    toast(l ? `Aufgabe erledigt: ${l.title}` : 'Eine Aufgabe ist fertig', { type: l && !l.ok ? 'warn' : 'ok', ms: 8000, action: { label: 'Ansehen', run: openTab } });
                }
                lastUnseen = r.unseen;
            } catch (_) { /* offline: nächster Versuch */ }
        };
        cycle(); timer = setInterval(cycle, 90_000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) cycle(); });
        // Tippen auf die Benachrichtigung öffnet die Aufgaben
        const fromPush = () => { if (location.hash === '#aufgaben') { history.replaceState(null, '', '#/chat'); openTab(); } };
        window.addEventListener('hashchange', fromPush); if (location.hash === '#aufgaben') setTimeout(fromPush, 600);
    },
    stop() { clearInterval(timer); timer = null; lastUnseen = null; },

    async renderSettings(host = document.getElementById('tasks-ui')) {
        if (!host) return;
        host.replaceChildren(h('p', { class: 'settings-hint', text: 'Lade …' }));
        let results = [], models = { models: [], chains: [] };
        try { await this.load(); results = (await apiJson('/tasks/results')).results; models = await apiJson('/byok').catch(() => models); }
        catch (e) { host.replaceChildren(h('p', { class: 'cd-err', text: 'Konnte die Aufgaben nicht laden: ' + e.message })); return; }
        this.draw(host, results, models);
    },

    draw(host, results, models) {
        const redraw = async () => { await this.load().catch(() => {}); const r = (await apiJson('/tasks/results').catch(() => ({ results }))).results; this.draw(host, r, models); };
        const L = state.limits || {};
        const task = (t) => h('div', { class: 'tk-card' + (t.enabled ? '' : ' off') },
            h('div', { class: 'tk-info' },
                h('b', { text: t.title }),
                h('small', { text: [t.when, t.research ? 'mit Recherche' : null, t.enabled ? (t.next ? 'nächster Lauf ' + fmt(t.next) : null) : (t.next === null && t.schedule.kind === 'once' ? 'erledigt' : 'aus')].filter(Boolean).join(' · ') }),
                t.lastStatus === 'error' ? h('small', { class: 'tk-warn', text: 'Der letzte Lauf ist fehlgeschlagen' }) : null),
            h('div', { class: 'tk-btns' },
                h('label', { class: 'tk-sw', title: t.enabled ? 'Ausschalten' : 'Einschalten' }, h('input', { type: 'checkbox', checked: t.enabled, onchange: async (e) => { try { await apiJson('/tasks/' + t.id, { method: 'PUT', body: JSON.stringify({ enabled: e.target.checked }) }); redraw(); } catch (er) { toast(er.message, { type: 'warn' }); redraw(); } } }), h('span', {})),
                h('button', { type: 'button', class: 'cd-x', title: 'Jetzt ausführen', 'aria-label': 'Jetzt ausführen', onclick: async () => { try { await apiJson(`/tasks/${t.id}/run`, { method: 'POST', body: '{}' }); toast('Läuft jetzt. Das Ergebnis erscheint hier und als Benachrichtigung.', { type: 'ok', ms: 5000 }); setTimeout(redraw, 20000); } catch (er) { toast(er.message, { type: 'warn' }); } } }, icon('play_arrow')),
                h('button', { type: 'button', class: 'cd-x', title: 'Bearbeiten', 'aria-label': 'Bearbeiten', onclick: () => this.editor(host, t, models, redraw) }, icon('edit')),
                h('button', { type: 'button', class: 'cd-x', title: 'Löschen', 'aria-label': 'Löschen', onclick: async () => { if (await confirmBox(`Aufgabe „${t.title}“ löschen? Schon erledigte Ergebnisse bleiben erhalten.`, { ok: 'Löschen', danger: true })) { await apiJson('/tasks/' + t.id, { method: 'DELETE' }); redraw(); } } }, icon('delete'))));
        const result = (r) => {
            const body = h('div', { class: 'tk-res-body hidden' });
            const row = h('div', { class: 'tk-res' + (r.seen ? '' : ' new') + (r.ok ? '' : ' bad') });
            const head = h('button', { type: 'button', class: 'tk-res-head', onclick: async () => {
                if (!body.classList.contains('hidden')) { body.classList.add('hidden'); return; }
                body.classList.remove('hidden');
                if (!body.dataset.loaded) {
                    try {
                        const full = await apiJson('/tasks/results/' + r.id); body.dataset.loaded = '1';
                        body.replaceChildren(md(full.text), h('div', { class: 'cd-row end' },
                            h('button', { type: 'button', class: 'cd-btn', onclick: async () => { await apiJson('/tasks/results/' + r.id, { method: 'DELETE' }); redraw(); } }, icon('delete'), ' Löschen'),
                            h('button', { type: 'button', class: 'cd-primary', onclick: () => { document.getElementById('close-settings')?.click(); document.dispatchEvent(new CustomEvent('openTaskResult', { detail: { title: full.title, text: full.text } })); } }, icon('chat'), ' Im Chat öffnen')));
                        row.classList.remove('new'); head.querySelector('.tk-dot')?.remove(); badge(Math.max(0, state.unseen - (r.seen ? 0 : 1)));
                    } catch (er) { body.textContent = er.message; }
                }
            } },
                h('span', { class: 'tk-dot', 'aria-hidden': 'true' }),
                icon(r.ok ? 'task_alt' : 'error'),
                h('span', { class: 'tk-res-t' }, h('b', { text: r.title }), h('small', { text: r.preview })),
                h('small', { class: 'tk-when', text: timeAgo(r.at) }));
            row.append(head, body); return row;
        };
        host.replaceChildren(
            h('div', { class: 'as-head' }, h('span', { class: 'as-count', text: `${state.tasks.length} von ${L.tasks || 10}` }),
                h('button', { type: 'button', class: 'cd-primary as-new', onclick: () => this.editor(host, {}, models, redraw) }, icon('add'), ' Neue Aufgabe')),
            state.cron ? null : h('p', { class: 'tk-note', text: 'Aufgaben laufen zur eingestellten Zeit, solange Coden geöffnet ist. Ein Zeitgeber auf dem Server kann sie auch bei geschlossener App starten.' }),
            state.tasks.length ? h('div', { class: 'tk-list' }, state.tasks.map(task)) :
                h('div', { class: 'as-empty' }, icon('schedule'), h('p', { text: 'Noch keine Aufgabe. Zum Beispiel: „Jeden Morgen um 7 Uhr die wichtigsten Tech-Nachrichten zusammenfassen“ oder „Jeden Freitag Neues zu meinem Hobby recherchieren“. Coden erledigt es von allein und meldet sich, wenn es fertig ist.' })),
            h('div', { class: 'tk-results' }, h('div', { class: 'as-head' }, h('h5', { class: 'rs-h', text: 'Ergebnisse' }), results.some(r => !r.seen) ? h('button', { type: 'button', class: 'cd-btn', onclick: async () => { await apiJson('/tasks/results-seen', { method: 'POST', body: '{}' }); redraw(); } }, 'Alle als gelesen markieren') : null),
                results.length ? h('div', { class: 'tk-list' }, results.map(result)) : h('p', { class: 'settings-hint', text: 'Sobald eine Aufgabe gelaufen ist, steht ihr Ergebnis hier.' })));
    },

    editor(host, t, models, back) {
        const isNew = !t.id; const sc = t.schedule || { kind: 'daily', time: '08:00' };
        const prompt = h('textarea', { class: 'cd-input tk-prompt', rows: 4, maxlength: T().LIMITS.prompt, placeholder: 'Was soll Coden tun? Zum Beispiel: „Fasse mir die wichtigsten Tech-Nachrichten des Tages in fünf Punkten zusammen.“' }); prompt.value = t.prompt || '';
        const title = h('input', { class: 'cd-input', value: t.title || '', maxlength: T().LIMITS.title, placeholder: 'Name (optional)' });
        const kind = h('select', { class: 'cd-input' }, [['daily', 'Jeden Tag'], ['weekly', 'An bestimmten Wochentagen'], ['once', 'Einmal']].map(([v, l]) => h('option', { value: v, text: l, ...(sc.kind === v ? { selected: true } : {}) })));
        kind.value = sc.kind;
        const time = h('input', { class: 'cd-input', type: 'time', value: sc.time || '08:00' });
        const at = h('input', { class: 'cd-input', type: 'datetime-local', value: localInput(sc.at) });
        const days = new Set(sc.days || [1, 2, 3, 4, 5]);
        const dayBtns = T().DAYS.map((d, i) => { const b = h('button', { type: 'button', class: 'tk-day' + (days.has(i + 1) ? ' on' : ''), text: d, 'aria-pressed': String(days.has(i + 1)), onclick: () => { days.has(i + 1) ? days.delete(i + 1) : days.add(i + 1); b.classList.toggle('on', days.has(i + 1)); b.setAttribute('aria-pressed', String(days.has(i + 1))); } }); return b; });
        const daysRow = h('div', { class: 'tk-days' }, dayBtns);
        const timeCol = h('div', { class: 'as-col' }, h('label', { class: 'cd-label', text: 'Uhrzeit' }), time), atCol = h('div', { class: 'as-col' }, h('label', { class: 'cd-label', text: 'Datum und Uhrzeit' }), at);
        const showKind = () => { daysRow.classList.toggle('hidden', kind.value !== 'weekly'); timeCol.classList.toggle('hidden', kind.value === 'once'); atCol.classList.toggle('hidden', kind.value !== 'once'); };
        kind.addEventListener('change', showKind); showKind();
        const own = [...(models.models || []).filter(m => m.ready).map(m => [m.tier, m.label]), ...(models.chains || []).filter(c => c.ready).map(c => [c.tier, c.name])];
        const tier = h('select', { class: 'cd-input' }, [...Object.entries(TIERS), ...own].map(([v, l]) => h('option', { value: v, text: l })));
        tier.value = t.tier || 'flash'; if (tier.value !== (t.tier || 'flash')) tier.value = 'flash';
        const research = h('input', { type: 'checkbox', checked: !!t.research });
        const depth = h('select', { class: 'cd-input' }, [['quick', 'Schnell'], ['normal', 'Normal'], ['deep', 'Gründlich']].map(([v, l]) => h('option', { value: v, text: l }))); depth.value = t.depth || 'normal';
        const showDepth = () => depth.classList.toggle('hidden', !research.checked); research.addEventListener('change', showDepth); showDepth();
        const err = h('div', { class: 'cd-err' });
        const save = h('button', { type: 'button', class: 'cd-primary', onclick: async () => {
            const schedule = kind.value === 'once' ? { kind: 'once', at: at.value ? new Date(at.value).toISOString() : '' } : kind.value === 'weekly' ? { kind: 'weekly', time: time.value, days: [...days] } : { kind: 'daily', time: time.value };
            err.textContent = '';
            const c = T().cleanTask({ title: title.value, prompt: prompt.value, schedule, research: research.checked, depth: depth.value, tier: tier.value, tz: tz() });
            if (c.error) { err.textContent = c.error; return; }
            save.disabled = true;
            try { await apiJson(isNew ? '/tasks' : '/tasks/' + t.id, { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(c.task) }); toast(isNew ? 'Aufgabe angelegt' : 'Gespeichert', { type: 'ok' }); back(); }
            catch (e) { err.textContent = e.message; save.disabled = false; }
        } }, icon('save'), ' Speichern');
        host.replaceChildren(h('div', { class: 'as-edit' },
            h('h5', { text: isNew ? 'Neue Aufgabe' : 'Aufgabe bearbeiten' }),
            h('label', { class: 'cd-label', text: 'Aufgabe' }), prompt,
            h('label', { class: 'cd-label', text: 'Name' }), title,
            h('label', { class: 'cd-label', text: 'Wann?' }), kind, daysRow, h('div', { class: 'as-row' }, timeCol, atCol),
            h('label', { class: 'cd-label', text: 'Modell' }), tier,
            h('label', { class: 'tk-check' }, research, h('span', {}, h('b', { text: 'Mit Deep Research' }), h('small', { text: 'Coden sucht im Web und schreibt einen Bericht mit Quellen. Dauert länger und braucht mehr von deinem Kontingent.' }))), depth,
            err, h('div', { class: 'cd-row end' }, h('button', { type: 'button', class: 'cd-btn', onclick: back }, 'Abbrechen'), save)));
        prompt.focus();
    }
};

// „Im Chat öffnen“: Ergebnis als neuer Chat, damit man nachfragen kann (Handler sitzt in app.js)
export const resultAsMessages = ({ title, text }) => ({ title: String(title || 'Aufgabe').slice(0, 60), messages: [{ text: `Aufgabe: ${title}`, isUser: true }, { text, isUser: false }] });
