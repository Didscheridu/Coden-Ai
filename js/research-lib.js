// js/research-lib.js – Research: Thema eingeben → Coden sucht, liest Quellen und schreibt einen Bericht.
// Alle Berichte liegen in einer Bibliothek (Server: research_reports) und hängen mit dem Rest von Coden zusammen:
// Chat (Bericht anhängen, Coden liest selbst mit <research_read/>), Projekte (als Wissensdatei), Lernheft, Export, Quiz/Karteikarten.
import { apiJson } from './backend.js';
import { toast } from './toast.js';
import { Router } from './router.js';
import { h, icon, timeAgo, copy, sleep } from './apps/dom.js';
import { modal, confirmBox } from './apps/dialogs.js';
import { stopRun } from './runs.js';
import { renderRichBlock } from './ui.js';
import { Projects } from './projects.js';
import { exportAsPdfReport, exportAsDocx } from './doc-export.js';
import { libraryPrompt, lernzettel, sourcesFromText } from './research-lib-core.js';

// Stufen wie auf dem Server (shared/research-core.js): immer Coden Ultra
const DEPTHS = [['quick', 'Schnell', '1 Agent prüft 25 Webseiten · ca. 2 Min.'], ['normal', 'Normal', '2 Agenten prüfen 50 Webseiten · ca. 3 Min.'], ['deep', 'Gründlich', '2 Agenten prüfen 100 Webseiten · ca. 5 Min.']];
const ORIGIN = { page: 'Research', chat: 'aus dem Chat', task: 'geplante Aufgabe' };
let cache = null, cacheAt = 0, loading = null;
const full = new Map(); // id -> kompletter Bericht (nur fertige)

const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }); } catch (_) { return ''; } };

export const ResearchLib = {
    cached: () => cache || [],
    async list(force = false) {
        if (!force && cache && Date.now() - cacheAt < 60_000) return cache;
        if (loading) return loading;
        loading = apiJson('/research/reports').then(r => { cache = r.reports || []; cacheAt = Date.now(); return cache; }).finally(() => { loading = null; });
        return loading;
    },
    bust() { cacheAt = 0; },
    async get(id, { fresh = false } = {}) {
        id = Number(id);
        if (!fresh && full.has(id)) return full.get(id);
        const { report } = await apiJson('/research/reports/' + id);
        if (report.status === 'done') full.set(id, report);
        return report;
    },
    async start({ question, depth = 'normal', projects = [] }) {
        const { report } = await apiJson('/research/reports', { method: 'POST', body: JSON.stringify({ question, depth, projects }) }); // Modell: immer Coden Ultra (Server)
        ResearchLib.bust();
        return report;
    },
    async patch(id, body) {
        const { report } = await apiJson('/research/reports/' + id, { method: 'PATCH', body: JSON.stringify(body) });
        full.delete(Number(id)); ResearchLib.bust(); return report;
    },
    async remove(report) {
        await apiJson('/research/reports/' + report.id, { method: 'DELETE' }); // der Server nimmt ihn auch aus den Projekten
        for (const pid of report.projects || []) Projects.bust(pid);
        full.delete(Number(report.id)); ResearchLib.bust();
    },
    // Projekt bekommt den Bericht als Wissensdatei – damit kennt jeder Chat im Projekt den Inhalt
    async addToProject(report, projectId) {
        const { report: u } = await apiJson(`/research/reports/${report.id}/projects`, { method: 'POST', body: JSON.stringify({ projectId }) });
        Projects.bust(projectId); full.delete(Number(report.id)); ResearchLib.bust(); return u;
    },
    async removeFromProject(report, projectId) {
        const { report: u } = await apiJson(`/research/reports/${report.id}/projects/${projectId}`, { method: 'DELETE' });
        Projects.bust(projectId); full.delete(Number(report.id)); ResearchLib.bust(); return u;
    },
    prompt: (projectId) => libraryPrompt(cache || [], { projectId }),
    // Chat: Bericht anhängen bzw. neuen Chat mit Bericht starten (app.js hört auf die Ereignisse)
    attach: async (report) => document.dispatchEvent(new CustomEvent('coden:attachResearch', { detail: { report: report.text ? report : await ResearchLib.get(report.id) } })),
    chatWith: async (report, prompt = '', send = false) => document.dispatchEvent(new CustomEvent('coden:researchChat', { detail: { report: report.text ? report : await ResearchLib.get(report.id), prompt, send } })),
    pick: pickReport
};

// ---------- Auswahl-Dialog (Chat „+“, Projekte) ----------
function pickReport({ title = 'Research-Bericht wählen', exclude = [], newLink = true } = {}) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
        const search = h('input', { class: 'cd-input', type: 'search', placeholder: 'Berichte durchsuchen' });
        const box = h('div', { class: 'rl-pick-list' }, h('p', { class: 'cd-text', text: 'Lade …' }));
        const draw = (list) => {
            const q = search.value.trim().toLowerCase();
            const items = list.filter(r => r.status === 'done' && !exclude.includes(r.id) && (!q || `${r.title} ${r.question} ${r.summary}`.toLowerCase().includes(q)));
            box.replaceChildren(...(items.length ? items.map(r => h('button', { type: 'button', class: 'rl-pick', onclick: async () => { try { finish(await ResearchLib.get(r.id)); } catch (e) { toast(e.message, { type: 'error' }); } } },
                icon('travel_explore'), h('span', { class: 'grow' }, h('b', { text: r.title }), h('small', { text: `${fmtDate(r.createdAt)} · ${r.sources} Quellen` })))) : [h('p', { class: 'cd-text', text: list.length ? 'Nichts gefunden.' : 'Noch keine Berichte. Lege unter „Research“ den ersten an.' })]));
        };
        const m = modal(title, h('div', { class: 'rl-pick-wrap' }, search, box,
            newLink ? h('div', { class: 'cd-row end' }, h('button', { type: 'button', class: 'cd-btn', onclick: () => { finish(null); Router.go('research'); } }, icon('add'), ' Neue Recherche')) : null), { onClose: () => { if (!done) { done = true; resolve(null); } } });
        ResearchLib.list(true).then(list => { draw(list); search.addEventListener('input', () => draw(list)); setTimeout(() => search.focus(), 30); }).catch(e => box.replaceChildren(h('p', { class: 'cd-err', text: e.message })));
    });
}

async function pickProject(exclude = []) {
    let ps = []; try { ps = await Projects.list(); } catch (e) { toast(e.message, { type: 'error' }); return null; }
    ps = ps.filter(p => !exclude.includes(p.id));
    if (!ps.length) { toast(exclude.length ? 'Der Bericht ist schon in allen Projekten.' : 'Du hast noch kein Projekt. Lege unter „Projekte“ eins an.', { type: 'info' }); return null; }
    return new Promise((resolve) => {
        let done = false;
        const m = modal('Zu Projekt hinzufügen', h('div', { class: 'rl-pick-list' }, ps.map(p => h('button', { type: 'button', class: 'rl-pick', onclick: () => { done = true; m.close(); resolve(p); } },
            h('span', { class: 'rl-pdot', style: { background: p.color } }), h('span', { class: 'grow' }, h('b', { text: p.name }), h('small', { text: p.description || `${p.fileCount} Dateien` }))))), { onClose: () => { if (!done) resolve(null); } });
    });
}

// Lauf mitlesen (ohne ihn beim Verlassen zu stoppen)
async function follow(runId, ac, onText, onThink) {
    let text = '', wait = 900;
    while (!ac.signal.aborted) {
        let x;
        try { x = await apiJson(`/runs/${runId}?from=${text.length}`); wait = document.hidden ? 3000 : 900; }
        catch (e) { if (/nicht gefunden/i.test(e.message)) return 'gone'; await sleep(wait = Math.min(wait * 1.6, 8000)); continue; }
        if (ac.signal.aborted) return 'left';
        if (x.from === text.length && x.text) { text += x.text; onText(text); }
        else if (x.from !== text.length) { try { text = (await apiJson(`/runs/${runId}`)).text || ''; onText(text); } catch (_) {} }
        if (x.think) onThink(x.think);
        if (x.status !== 'running') return x.status;
        await sleep(wait);
    }
    return 'left';
}

// ---------- Seite ----------
let stopWatch = null;
export const ResearchView = {
    mount(host, params = []) {
        if (params[0] && /^\d+$/.test(params[0])) return detail(host, Number(params[0]));
        return overview(host, params[0] === 'projekt' ? Number(params[1]) || null : null);
    },
    unmount() { stopWatch?.abort(); stopWatch = null; }
};

function statusLine(r) {
    const bits = [timeAgo(r.updatedAt || r.createdAt)];
    if (r.status === 'done') bits.push(`${r.sources} Quelle${r.sources === 1 ? '' : 'n'}`);
    if (r.origin && r.origin !== 'page') bits.push(ORIGIN[r.origin]);
    if (r.projects?.length) bits.push(`${r.projects.length} Projekt${r.projects.length === 1 ? '' : 'e'}`);
    return bits.join(' · ');
}

async function overview(host, presetProject) {
    let depth = 'normal';
    const q = h('textarea', { class: 'rl-q', rows: 2, maxlength: 600, placeholder: 'Worüber soll Coden recherchieren? Zum Beispiel: „Wie funktioniert die Photosynthese?“ oder „Vergleich der besten Schulrechner 2026“' });
    const depthBar = h('div', { class: 'rl-depth', role: 'radiogroup', 'aria-label': 'Gründlichkeit' });
    const depthHint = h('div', { class: 'rl-hint' });
    const drawDepth = () => {
        depthBar.replaceChildren(...DEPTHS.map(([id, name, t]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(id === depth), class: id === depth ? 'on' : '', title: t, onclick: () => { depth = id; drawDepth(); } }, name)));
        depthHint.replaceChildren(icon('bolt'), h('span', { text: `${DEPTHS.find(d => d[0] === depth)[2]} · läuft immer mit Coden Ultra` }));
    };
    drawDepth();
    const projSel = h('select', { class: 'cd-input rl-proj', 'aria-label': 'Projekt' }, h('option', { value: '' }, 'Kein Projekt'));
    Projects.list().then(ps => { for (const p of ps) projSel.append(h('option', { value: String(p.id) }, p.name)); if (presetProject) projSel.value = String(presetProject); }).catch(() => {});
    const err = h('div', { class: 'cd-err' });
    const go = h('button', { type: 'button', class: 'rl-go', onclick: async () => {
        err.textContent = '';
        const question = q.value.trim(); if (question.length < 3) { err.textContent = 'Gib ein Thema ein.'; q.focus(); return; }
        go.disabled = true;
        try {
            const pid = Number(projSel.value) || null;
            const report = await ResearchLib.start({ question, depth, projects: pid ? [pid] : [] });
            Router.go('research/' + report.id);
        } catch (e) { err.textContent = e.message; go.disabled = false; }
    } }, icon('travel_explore'), ' Recherchieren');
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go.click(); } });

    const search = h('input', { class: 'cd-input rl-search', type: 'search', placeholder: 'Berichte durchsuchen', 'aria-label': 'Berichte durchsuchen' });
    const listBox = h('div', { class: 'rl-list' }, h('p', { class: 'cd-text', text: 'Lade …' }));
    host.append(h('div', { class: 'ap-page rl-page' },
        h('div', { class: 'rl-hero' }, h('h1', { text: 'Research' }), h('p', { text: 'Gib Coden ein Thema. Coden sucht im Web, liest die besten Quellen und schreibt dir einen Bericht. Deine Berichte kennt Coden danach im Chat und in deinen Projekten.' })),
        h('div', { class: 'rl-composer' }, q, h('div', { class: 'rl-bar' }, depthBar, projSel, h('span', { class: 'grow' }), go), depthHint, err),
        h('div', { class: 'rl-listhead' }, h('h3', { text: 'Deine Berichte' }), search),
        listBox));
    setTimeout(() => q.focus(), 30);

    let all = [];
    const draw = () => {
        const s = search.value.trim().toLowerCase();
        const items = all.filter(r => !s || `${r.title} ${r.question} ${r.summary}`.toLowerCase().includes(s));
        if (!items.length) {
            listBox.replaceChildren(h('div', { class: 'rl-empty' }, icon('travel_explore'), h('p', { text: all.length ? 'Kein Bericht passt zur Suche.' : 'Noch keine Berichte. Starte oben deine erste Recherche – oder schalte im Chat unter „+“ die Recherche ein, die Ergebnisse landen auch hier.' })));
            return;
        }
        listBox.replaceChildren(...items.map(r => h('a', { class: 'rl-item' + (r.status !== 'done' ? ' ' + r.status : ''), href: '#/research/' + r.id },
            h('span', { class: 'rl-item-ic' }, icon(r.status === 'running' ? 'progress_activity' : r.status === 'error' ? 'error' : 'article')),
            h('span', { class: 'rl-item-t' }, h('b', { text: r.title }), h('small', { text: r.status === 'running' ? 'Recherchiert gerade …' : r.status === 'error' ? 'Fehlgeschlagen' + (r.error ? ': ' + r.error : '') : (r.summary || r.question) }), h('small', { class: 'rl-meta', text: statusLine(r) })))));
    };
    search.addEventListener('input', draw);
    const load = async () => {
        try { all = await ResearchLib.list(true); draw(); }
        catch (e) { listBox.replaceChildren(h('p', { class: 'cd-err', text: 'Berichte konnten nicht geladen werden: ' + e.message })); return; }
        if (all.some(r => r.status === 'running') && host.isConnected) setTimeout(() => { if (host.isConnected && Router.parse().name === 'research') load(); }, 4000);
    };
    load();
}

async function detail(host, id) {
    host.append(h('div', { class: 'ap-page rl-page' }, h('p', { class: 'cd-text', text: 'Lade …' })));
    let r;
    try { r = await ResearchLib.get(id, { fresh: true }); }
    catch (e) { host.replaceChildren(h('div', { class: 'ap-page rl-page' }, h('div', { class: 'rl-empty' }, icon('search_off'), h('p', { text: e.message }), h('a', { class: 'cd-btn', href: '#/research' }, 'Zu Research')))); return; }

    const title = h('input', { class: 'rl-title', value: r.title, maxlength: 120, 'aria-label': 'Titel', onchange: async () => {
        const t = title.value.trim(); if (!t) { title.value = r.title; return; }
        try { r = { ...r, ...(await ResearchLib.patch(r.id, { title: t })), text: r.text }; toast('Umbenannt', { type: 'ok' }); } catch (e) { toast(e.message, { type: 'error' }); }
    } });
    const meta = h('div', { class: 'rl-detail-meta' });
    const projBox = h('div', { class: 'rl-projs' });
    const actions = h('div', { class: 'rl-actions' });
    const think = h('div', { class: 'rl-think hidden' });
    const body = h('div', { class: 'rl-body' });

    const drawMeta = () => meta.replaceChildren(
        h('span', { text: fmtDate(r.createdAt) }),
        r.status === 'done' ? h('span', { text: `${r.sources} Quellen` }) : null,
        h('span', { text: DEPTHS.find(d => d[0] === r.depth)?.[1] || 'Normal' }),
        r.origin && r.origin !== 'page' ? h('span', { text: ORIGIN[r.origin] }) : null,
        r.question && r.question !== r.title ? h('span', { class: 'rl-qline', text: 'Frage: ' + r.question }) : null);
    const drawProjects = async () => {
        if (!r.projects?.length) { projBox.replaceChildren(); return; }
        let names = new Map(); try { names = new Map((await Projects.list()).map(p => [p.id, p])); } catch (_) {}
        projBox.replaceChildren(icon('folder_open'), ...r.projects.map(pid => h('span', { class: 'rl-chip' },
            h('a', { href: '#/projekte/' + pid, text: names.get(pid)?.name || 'Projekt ' + pid }),
            h('button', { type: 'button', title: 'Aus dem Projekt entfernen', 'aria-label': 'Aus dem Projekt entfernen', onclick: async () => {
                try { r = { ...r, ...(await ResearchLib.removeFromProject(r, pid)), text: r.text }; drawProjects(); toast('Aus dem Projekt entfernt', { type: 'ok' }); } catch (e) { toast(e.message, { type: 'error' }); }
            } }, '×'))));
    };
    const btn = (ic, label, fn, cls = 'cd-btn sm') => h('button', { type: 'button', class: cls, onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (err) { toast(err.message, { type: 'error' }); } finally { if (b.isConnected) b.disabled = false; } } }, icon(ic), ' ' + label);
    const drawActions = () => {
        if (r.status === 'running') {
            actions.replaceChildren(btn('stop_circle', 'Abbrechen', async () => { if (r.runId) await stopRun(r.runId); toast('Wird abgebrochen …', { type: 'info' }); }));
            return;
        }
        if (r.status === 'error' && !r.text) {
            actions.replaceChildren(btn('refresh', 'Nochmal versuchen', async () => { const n = await ResearchLib.start({ question: r.question, depth: r.depth, projects: r.projects }); Router.go('research/' + n.id); }, 'cd-primary sm'),
                btn('delete', 'Löschen', async () => { if (await confirmBox('Diesen Bericht löschen?', { ok: 'Löschen', danger: true })) { await ResearchLib.remove(r); Router.go('research'); } }));
            return;
        }
        const md = r.text || '';
        actions.replaceChildren(
            btn('forum', 'Im Chat besprechen', () => ResearchLib.chatWith(r), 'cd-primary sm'),
            btn('folder_open', 'Zu Projekt', async () => { const p = await pickProject(r.projects || []); if (!p) return; r = { ...r, ...(await ResearchLib.addToProject(r, p.id)), text: r.text }; drawProjects(); toast(`Zu „${p.name}“ hinzugefügt – Coden kennt den Bericht jetzt in jedem Chat des Projekts.`, { type: 'ok' }); }),
            btn('style', 'Karteikarten', () => ResearchLib.chatWith(r, 'Erstelle aus diesem Research-Bericht 10 Lern-Karteikarten als <flashcards>-Element.', true)),
            btn('quiz', 'Quiz', () => ResearchLib.chatWith(r, 'Mach aus diesem Research-Bericht ein <quiz> mit 6 Fragen, Hinweisen und Erklärungen.', true)),
            btn('travel_explore', 'Weiter recherchieren', async () => { const n = await ResearchLib.start({ question: `Vertiefe und aktualisiere: ${r.question || r.title}`, depth: r.depth, projects: r.projects }); Router.go('research/' + n.id); }),
            btn('auto_stories', 'Ins Lernheft', async () => {
                const { SplitWorkspace } = await import('./split-workspace.js');
                await SplitWorkspace.appendNoteToNotebook(`${r.title}\n${lernzettel(md)}`, { title: 'Research-Notizen' });
                SplitWorkspace.open('notebook'); toast('Kurzfassung ins Lernheft geschrieben', { type: 'ok' });
            }),
            btn('picture_as_pdf', 'PDF', () => exportAsPdfReport(r.title, md)),
            btn('description', 'Word', () => exportAsDocx(r.title, md)),
            btn('content_copy', 'Kopieren', async () => toast(await copy(md) ? 'Bericht kopiert' : 'Kopieren ging nicht', { type: 'ok' })),
            btn('delete', 'Löschen', async () => { if (await confirmBox(`„${r.title}“ löschen? Er wird auch aus seinen Projekten entfernt.`, { ok: 'Löschen', danger: true })) { await ResearchLib.remove(r); toast('Gelöscht', { type: 'ok' }); Router.go('research'); } }, 'cd-btn sm danger'));
    };
    const drawBody = (text) => {
        const W = window.CodenResearch;
        const src = sourcesFromText(text);
        text = String(text || '').replace(/^\s*#\s+.+\n+/, ''); // Titel steht schon oben
        body.replaceChildren(text ? renderRichBlock(W?.citeChips ? W.citeChips(text, src) : text, 'research-' + r.id) : h('p', { class: 'cd-text', text: r.status === 'running' ? 'Coden plant die Recherche …' : 'Der Bericht ist leer.' }));
    };

    host.replaceChildren(h('div', { class: 'ap-page rl-page rl-detail' },
        h('a', { class: 'pj-back', href: '#/research' }, icon('arrow_back'), ' Alle Berichte'),
        title, meta, projBox, actions, think, body));
    drawMeta(); drawProjects(); drawActions(); drawBody(r.text);

    if (r.status === 'running' && r.runId) {
        const ac = new AbortController(); stopWatch = ac; // Verlassen der Seite stoppt nur das Mitlesen, nicht die Recherche
        think.classList.remove('hidden');
        const drawThink = (k = {}) => think.replaceChildren(
            h('div', { class: 'rl-think-now' }, icon('progress_activity', 'rl-spin'), h('b', { text: k.h || 'Startet …' }), k.v ? h('span', { text: k.v }) : null),
            (k.steps || []).length ? h('ol', { class: 'rl-steps' }, k.steps.slice(-6).map(s => h('li', { text: String(s) }))) : null);
        drawThink();
        await follow(r.runId, ac, (t) => drawBody(t), drawThink);
        if (ac.signal.aborted || !host.isConnected) return;
        ResearchLib.bust();
        try { r = await ResearchLib.get(id, { fresh: true }); } catch (_) {}
        think.classList.add('hidden'); drawMeta(); drawActions(); drawBody(r.text); title.value = r.title;
        if (r.status === 'done') toast('Bericht fertig', { type: 'ok' });
    }
}
