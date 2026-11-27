// js/study-studio.js – Lern-Studio: Fächer (Aufträge, Arbeiten, Themen, Hefte, Noten), Stundenplan & Lernzeiten,
// Lernplan, Statistik. Hefte öffnen den Handschrift-Editor (js/ink.js), Coden liest Aufträge und Stundenpläne von Fotos.
import { modal, confirmBox } from './apps/dialogs.js';
import { toast } from './toast.js';
import { apiJson } from './backend.js';
import { Router } from './router.js';
import { StudyStore } from './study-store.js';
import * as S from './study-core.js';
import { openInkEditor, createPages, filesToBackgrounds, deleteDocPages } from './ink.js';
import { loader } from './rich-elements.js';
import { enablePush, pushState } from './push.js';
import * as Menu from './menu.js';
import { isAutoHumanizeOn, updateHumanizerPrefs, getAutoHumanizerPrompt } from './humanizer-prefs.js';

const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v; else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
};
const ic = (n) => h('span', { class: 'material-symbols-outlined', 'aria-hidden': 'true', text: n });
const ui = { subject: null, planExam: null };
let rerender = () => {};
const save = (st) => { StudyStore.save(st); rerender(); };
const days = (d) => S.daysBetween(new Date(), (d || '') + 'T00:00:00');
const inDays = (n) => (n === 0 ? 'heute' : n === 1 ? 'morgen' : n === -1 ? 'gestern' : n < 0 ? `vor ${-n} Tagen` : `in ${n} Tagen`);
const dot = (color) => h('i', { class: 'sd-dot', style: { background: color || '#888' } });
const field = (label, input, hint) => h('label', { class: 'sd-field' }, h('span', { text: label }), input, hint ? h('small', { text: hint }) : null);
const busyBtn = async (b, label, fn) => { const old = [...b.childNodes]; b.disabled = true; b.replaceChildren(loader({ size: 18 }), ' ' + label); try { return await fn(); } finally { b.disabled = false; b.replaceChildren(...old); } };
const ask = async (system, user, images, tier = 'flash') => (await apiJson('/chat', { method: 'POST', body: JSON.stringify({ tier, messages: [{ role: 'system', content: system }, { role: 'user', content: user, ...(images?.length ? { images: images.slice(0, 3) } : {}) }] }) })).content;
const json = (t) => { const s = String(t || ''); const i = s.search(/[[{]/); const j = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']')); if (i < 0 || j < i) return null; try { return JSON.parse(s.slice(i, j + 1)); } catch (_) { return null; } };

export function renderStudioTab(tab, rr) {
    rerender = rr;
    const st = StudyStore.get();
    if (tab === 'stundenplan') return renderTimetable(st);
    if (tab === 'plan') return renderPlan(st);
    if (tab === 'statistik') return renderStats(st);
    const su = ui.subject && S.subjectOf(st, ui.subject);
    return su ? renderSubject(st, su) : renderSubjects(st);
}
export const resetStudio = () => { ui.subject = null; };

// ---------- Hefte öffnen ----------
function openDoc(st, doc, assignment = null) {
    const su = S.subjectOf(st, doc.subjectId);
    openInkEditor({
        doc, subjectName: su?.name || '', assignment,
        persist: () => StudyStore.save(st),
        onCorrected: (d, page, c) => {
            d.scores = { ...(d.scores || {}), [page.id]: c.score };
            const vals = Object.values(d.scores).filter(Number.isFinite);
            if (assignment) { assignment.score = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length); if (assignment.status === 'offen') assignment.status = 'arbeit'; }
            StudyStore.save(st);
        },
        onSubmit: (a) => { S.submitAssignment(st, a.id); StudyStore.save(st); toast('Abgegeben ✓ – stark!', { type: 'ok' }); },
        onClose: () => rerender()
    });
}
async function ensureDoc(st, { title, subjectId, assignmentId = null, backgrounds = [] }) {
    const doc = { id: 'dc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, subjectId, assignmentId, paper: /mathe|physik|chemie/i.test(S.subjectOf(st, subjectId)?.name || '') ? 'karo' : 'liniert', pages: [], createdAt: new Date().toISOString() };
    doc.pages = await createPages(doc, backgrounds.length ? backgrounds : [null], doc.paper);
    st.docs.push(doc); return doc;
}

async function confirmDeleteSubject(st, su) {
    if (!(await confirmBox(`„${su.name}“ mit allen Aufträgen, Arbeiten, Heften, Stundenplan-Einträgen und Noten löschen?`, { ok: 'Löschen', danger: true }))) return;
    const res = S.deleteSubject(st, su.id);
    for (const docId of res.docIds) deleteDocPages(docId);
    if (ui.subject === su.id) ui.subject = null;
    save(st);
    toast(`Fach „${su.name}“ gelöscht.`, { type: 'ok' });
}

// ---------- Fächer-Übersicht ----------
function renderSubjects(st) {
    const wrap = h('div', { class: 'sd-wrap' });
    wrap.append(renderToday(st));
    const head = h('div', { class: 'sd-sec-head' }, h('h2', { text: 'Deine Fächer' }),
        h('div', { class: 'sd-row' },
            h('label', { class: 'st-hz-toggle', title: 'Coden schreibt Heft-Lösungen und Aufschriebe automatisch natürlich & schülerfreundlich' },
                h('span', { class: 'st-hz-toggle-l' }, ic('auto_fix_high'), h('span', { text: 'Heft-Stil: Schülerfreundlich' })),
                h('input', {
                    type: 'checkbox',
                    checked: isAutoHumanizeOn('notebooks'),
                    onchange: (e) => { updateHumanizerPrefs({ notebooks: e.target.checked }); toast(e.target.checked ? 'Humanizer für Lernhefte aktiviert.' : 'Humanizer für Lernhefte deaktiviert.', { type: 'ok' }); }
                })
            ),
            h('button', { type: 'button', class: 'cd-btn', onclick: () => import('./handwriting.js').then(m => m.openHandwritingTrainer()) }, ic('stylus_note'), ' Handschrift'),
            h('button', { type: 'button', class: 'cd-btn', onclick: () => addAssignmentDialog(st) }, ic('upload_file'), ' Auftrag hochladen'),
            h('button', { type: 'button', class: 'cd-btn', onclick: () => addExamDialog(st) }, ic('event'), ' Arbeit eintragen'),
            h('button', { type: 'button', class: 'cd-primary', onclick: () => addSubjectDialog(st) }, ic('add'), ' Fach')));
    wrap.append(head);
    if (!st.subjects.length) {
        wrap.append(h('div', { class: 'sd-empty' }, ic('school'), h('h3', { text: 'Leg los mit deinen Fächern' }),
            h('p', { text: 'Lade am besten zuerst deinen Stundenplan hoch – Coden erkennt die Fächer automatisch und weiß, wann du Zeit zum Lernen hast.' }),
            h('div', { class: 'sd-row' }, h('button', { type: 'button', class: 'cd-primary', onclick: () => { ui.tabHint = 'stundenplan'; Router.go('lernen/stundenplan'); } }, ic('calendar_month'), ' Stundenplan hochladen'),
                h('button', { type: 'button', class: 'cd-btn', onclick: () => addSubjectDialog(st) }, ic('add'), ' Fach selbst anlegen'))));
        return wrap;
    }
    const stats = S.stats(st);
    const grid = h('div', { class: 'sd-grid' });
    for (const su of st.subjects) {
        const x = stats.subjects.find(s => s.id === su.id) || {};
        const next = x.nextExam; const open = x.open + x.overdue;
        const delBtn = h('button', {
            type: 'button',
            class: 'sd-x sd-subject-del',
            title: `Fach „${su.name}“ löschen`,
            'aria-label': `Fach ${su.name} löschen`,
            onclick: (e) => { e.stopPropagation(); confirmDeleteSubject(st, su); }
        }, ic('delete'));
        grid.append(h('div', {
            class: 'sd-subject',
            role: 'button',
            tabindex: '0',
            style: { '--sc': su.color },
            onclick: () => { ui.subject = su.id; rerender(); },
            onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.subject = su.id; rerender(); } }
        },
            h('div', { class: 'sd-subject-top' },
                h('b', { text: su.name }),
                h('div', { class: 'sd-subject-acts' },
                    x.grade != null ? h('span', { class: 'sd-chip', text: 'Ø ' + String(x.grade).replace('.', ',') }) : null,
                    delBtn)),
            h('div', { class: 'sd-subject-meta' },
                h('span', {}, ic('assignment'), open ? `${open} offen${x.overdue ? ` · ${x.overdue} überfällig` : ''}` : 'Alles erledigt'),
                next ? h('span', { class: days(next.date) <= 7 ? 'warn' : '' }, ic('event'), `${next.title || 'Arbeit'} ${inDays(days(next.date))}`) : null,
                su.topics.length ? h('span', {}, ic('checklist'), `${x.topicsDone}/${x.topics} Themen`) : null,
                x.score != null ? h('span', {}, ic('fact_check'), `Coden-Score ${x.score} %`) : null)));
    }
    wrap.append(grid);
    return wrap;
}

function renderToday(st) {
    const now = new Date(); const today = S.isoDate(now);
    const box = h('div', { class: 'sd-today' });
    const lessons = S.lessonsOn(st, now);
    const sessions = st.plan.filter(p => p.date === today && !p.skipped);
    const due = st.assignments.filter(a => a.status !== 'abgegeben' && a.due && days(a.due) <= 3).sort((a, b) => a.due.localeCompare(b.due));
    const exams = st.exams.filter(e => days(e.date) >= 0 && days(e.date) <= 14).sort((a, b) => a.date.localeCompare(b.date));
    const name = (id) => S.subjectOf(st, id)?.name || '';
    const col = (title, iconName, items, empty) => h('div', { class: 'sd-today-col' }, h('div', { class: 'sd-today-h' }, ic(iconName), h('b', { text: title })), items.length ? h('div', { class: 'sd-today-list' }, ...items) : h('small', { class: 'sd-muted', text: empty }));
    box.append(
        h('div', { class: 'sd-today-head' }, h('div', {}, h('h2', { text: now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) }), h('small', { class: 'sd-muted', text: lessons.length ? `Schule ${lessons[0].start}–${S.fromMin(S.schoolEnd(st, S.dayKey(now)))} · ${lessons.length} Stunde${lessons.length === 1 ? '' : 'n'}` : 'Heute keine Schule eingetragen' })), notifyButton()),
        h('div', { class: 'sd-today-grid' },
            col('Heute lernen', 'self_improvement', sessions.map(p => sessionRow(st, p, true)), 'Nichts geplant – erstell einen Lernplan für deine nächste Arbeit.'),
            col('Bald abgeben', 'assignment_late', due.map(a => h('button', { type: 'button', class: 'sd-li', onclick: () => openAssignment(st, a) }, dot(S.subjectOf(st, a.subjectId)?.color), h('span', { text: `${name(a.subjectId)}: ${a.title}` }), h('small', { class: days(a.due) < 0 ? 'bad' : days(a.due) <= 1 ? 'warn' : '', text: inDays(days(a.due)) }))), 'Keine Abgaben in den nächsten Tagen.'),
            col('Arbeiten', 'event', exams.map(e => h('button', { type: 'button', class: 'sd-li', onclick: () => { ui.subject = e.subjectId; rerender(); } }, dot(S.subjectOf(st, e.subjectId)?.color), h('span', { text: `${name(e.subjectId)}: ${e.title || 'Arbeit'}` }), h('small', { class: days(e.date) <= 3 ? 'warn' : '', text: inDays(days(e.date)) }))), 'Keine Arbeit in den nächsten 2 Wochen.'))
    );
    return box;
}
function notifyButton() {
    const b = h('button', { type: 'button', class: 'cd-btn sd-notify' }, ic('notifications'), ' Erinnerungen');
    pushState().then(s => { if (s === 'on') { b.replaceChildren(ic('notifications_active'), ' Erinnerungen an'); b.classList.add('on'); } else if (s === 'unsupported') b.title = 'Auf dem iPhone/iPad: Coden über „Zum Home-Bildschirm“ installieren, dann gehen Benachrichtigungen.'; });
    b.addEventListener('click', async () => {
        const ok = await enablePush().catch(() => false);
        if (ok) { StudyStore.syncReminders(); toast('Coden erinnert dich an Arbeiten, Abgaben und Lernzeiten.', { type: 'ok' }); b.replaceChildren(ic('notifications_active'), ' Erinnerungen an'); b.classList.add('on'); }
        else toast('Benachrichtigungen sind blockiert oder nicht möglich. Auf iPhone/iPad: Coden erst zum Home-Bildschirm hinzufügen.', { type: 'warn', ms: 7000 });
    });
    return b;
}
function sessionRow(st, p, compact = false) {
    const su = S.subjectOf(st, p.subjectId);
    const cb = h('input', { type: 'checkbox', checked: p.done, title: 'Erledigt', onchange: () => { const x = st.plan.find(q => q.id === p.id); if (x) { x.done = cb.checked; x.doneAt = cb.checked ? new Date().toISOString() : null; } save(st); if (cb.checked) toast(`+${p.min} min gelernt 💪`, { type: 'ok' }); } });
    return h('div', { class: 'sd-session' + (p.done ? ' done' : '') },
        cb, h('span', { class: 'sd-time', text: p.start }), dot(su?.color),
        h('div', { class: 'sd-session-tx' }, h('b', { text: `${su?.name || p.subjectName || 'Lernen'}: ${p.title}` }), p.what ? h('small', { text: p.what }) : null),
        h('small', { class: 'sd-muted', text: p.min + ' min' }),
        compact ? null : h('button', { type: 'button', class: 'sd-x', title: 'Entfernen', onclick: () => { st.plan = st.plan.filter(q => q.id !== p.id); save(st); } }, ic('close')));
}

// ---------- Ein Fach ----------
function renderSubject(st, su) {
    const x = S.stats(st).subjects.find(s => s.id === su.id) || {};
    const wrap = h('div', { class: 'sd-wrap', style: { '--sc': su.color } });
    wrap.append(h('div', { class: 'sd-subject-head' },
        h('button', { type: 'button', class: 'cd-btn', onclick: () => { ui.subject = null; rerender(); } }, ic('arrow_back'), ' Fächer'),
        h('h1', {}, dot(su.color), su.name),
        h('div', { class: 'sd-row' },
            h('button', { type: 'button', class: 'cd-btn', title: 'Umbenennen', onclick: () => addSubjectDialog(st, su) }, ic('edit')),
            h('button', { type: 'button', class: 'cd-btn', title: 'Fach löschen', onclick: () => confirmDeleteSubject(st, su) }, ic('delete')))));
    wrap.append(h('div', { class: 'sd-kpis' },
        kpi('Ø Note', x.grade != null ? String(x.grade).replace('.', ',') : '–', 'grade'),
        kpi('Coden-Score', x.score != null ? x.score + ' %' : '–', 'fact_check'),
        kpi('Aufträge', `${x.submitted}/${x.assignments} abgegeben`, 'assignment_turned_in'),
        kpi('Themen', su.topics.length ? `${x.topicsDone}/${x.topics}` : '–', 'checklist'),
        kpi('Gelernt', `${x.minutes} min`, 'timer')));

    // Aufträge
    const as = st.assignments.filter(a => a.subjectId === su.id).sort((a, b) => (a.status === 'abgegeben') - (b.status === 'abgegeben') || String(a.due || '9').localeCompare(String(b.due || '9')));
    wrap.append(section('Aufträge', 'assignment', h('button', { type: 'button', class: 'cd-primary', onclick: () => addAssignmentDialog(st, su.id) }, ic('upload_file'), ' Auftrag hochladen'),
        as.length ? h('div', { class: 'sd-list' }, ...as.map(a => assignmentCard(st, a))) : h('p', { class: 'sd-muted', text: 'Noch keine Aufträge. Lade ein Arbeitsblatt (Foto/PDF) hoch – du kannst direkt darauf schreiben.' })));
    // Arbeiten
    const ex = st.exams.filter(e => e.subjectId === su.id).sort((a, b) => a.date.localeCompare(b.date));
    wrap.append(section('Arbeiten & Tests', 'event', h('button', { type: 'button', class: 'cd-btn', onclick: () => addExamDialog(st, su.id) }, ic('add'), ' Arbeit eintragen'),
        ex.length ? h('div', { class: 'sd-list' }, ...ex.map(e => examCard(st, e))) : h('p', { class: 'sd-muted', text: 'Trag deine nächste Arbeit ein – Coden plant dann, wann du was lernst.' })));
    // Themen
    const tIn = h('input', { class: 'cd-input', placeholder: 'Neues Thema, z. B. Scheitelform', onkeydown: (e) => { if (e.key === 'Enter' && tIn.value.trim()) { su.topics.push({ id: S.uid('tp'), title: tIn.value.trim().slice(0, 80), done: false }); save(st); } } });
    wrap.append(section('Themen', 'checklist', null, h('div', { class: 'sd-topics' },
        ...su.topics.map(t => h('label', { class: 'sd-topic' + (t.done ? ' done' : '') }, h('input', { type: 'checkbox', checked: t.done, onchange: (e) => { t.done = e.target.checked; t.doneAt = t.done ? new Date().toISOString() : null; save(st); } }), h('span', { text: t.title }),
            h('button', { type: 'button', class: 'sd-x', title: 'Entfernen', onclick: (e) => { e.preventDefault(); su.topics = su.topics.filter(y => y.id !== t.id); save(st); } }, ic('close')))),
        tIn)));
    // Hefte
    const docs = st.docs.filter(d => d.subjectId === su.id && !d.assignmentId);
    wrap.append(section('Hefte', 'stylus_note', h('button', { type: 'button', class: 'cd-btn', onclick: async (e) => { const t = prompt('Name des Hefts:', su.name + ' – Mitschrift'); if (!t) return; await busyBtn(e.currentTarget, 'Lege an …', async () => { const d = await ensureDoc(st, { title: t.slice(0, 60), subjectId: su.id }); StudyStore.save(st); openDoc(st, d); }); } }, ic('add'), ' Neues Heft'),
        docs.length ? h('div', { class: 'sd-docs' }, ...docs.map(d => h('div', { class: 'sd-doc' }, h('button', { type: 'button', class: 'sd-doc-open', onclick: () => openDoc(st, d) }, h('div', { class: 'sd-doc-paper ' + (d.paper || 'liniert') }), h('b', { text: d.title }), h('small', { text: `${d.pages.length} Seite${d.pages.length === 1 ? '' : 'n'}` })),
            h('button', { type: 'button', class: 'sd-x', title: 'Heft löschen', onclick: async () => { if (!(await confirmBox(`Heft „${d.title}“ löschen?`, { ok: 'Löschen', danger: true }))) return; deleteDocPages(d.id); st.docs = st.docs.filter(y => y.id !== d.id); save(st); } }, ic('delete'))))) : h('p', { class: 'sd-muted', text: 'Hefte sind wie in GoodNotes: mit Apple Pencil, Finger oder Maus schreiben, Coden korrigiert auf Wunsch.' })));
    // Noten
    const gIn = h('input', { class: 'cd-input sd-small', placeholder: 'z. B. 2- oder 11 P' }); const gKind = h('select', { class: 'cd-input sd-small' }, ...['Klassenarbeit', 'Test', 'Mündlich', 'Referat', 'Hausaufgabe'].map(k => h('option', { text: k })));
    const addGrade = () => { const g = S.parseGrade(gIn.value); if (!g) { toast('Note als 1–6 (mit +/-) oder Punkte (z. B. 11 P) eingeben.', { type: 'warn' }); return; } su.grades.push({ id: S.uid('gr'), ...g, kind: gKind.value, weight: gKind.value === 'Klassenarbeit' ? 2 : 1, date: S.isoDate(new Date()) }); save(st); };
    wrap.append(section('Noten', 'grade', null, h('div', {},
        su.grades.length ? h('div', { class: 'sd-grades' }, ...su.grades.map(g => h('span', { class: 'sd-grade', title: `${g.kind} · ${g.date} · Gewicht ${g.weight}` }, h('b', { text: g.label }), h('small', { text: g.kind }), h('button', { type: 'button', class: 'sd-x', onclick: () => { su.grades = su.grades.filter(y => y.id !== g.id); save(st); } }, ic('close'))))) : null,
        h('div', { class: 'sd-row' }, gIn, gKind, h('button', { type: 'button', class: 'cd-btn', onclick: addGrade }, ic('add'), ' Note')))));
    return wrap;
}
const kpi = (label, value, iconName) => h('div', { class: 'sd-kpi' }, ic(iconName), h('div', {}, h('small', { text: label }), h('b', { text: value })));
const section = (title, iconName, action, body) => h('section', { class: 'sd-section' }, h('div', { class: 'sd-sec-head' }, h('h3', {}, ic(iconName), ' ' + title), action), body);

function assignmentCard(st, a) {
    const state = S.assignmentState(a); const d = a.due ? days(a.due) : null;
    const label = { puenktlich: 'Abgegeben ✓', spaet: 'Zu spät abgegeben', ueberfaellig: 'Überfällig', offen: S.STATUS[a.status] || 'Offen' }[state];
    const progress = h('div', { class: 'sd-solve', hidden: true });
    const editBtn = h('button', { type: 'button', class: 'cd-primary', onclick: () => openAssignment(st, a) }, ic('stylus_note'), a.status === 'abgegeben' ? ' Ansehen' : ' Bearbeiten');
    // Drei Punkte: Coden lösen lassen, Abgabe, Löschen
    const more = h('button', { type: 'button', class: 'cd-btn sd-more', title: 'Mehr', 'aria-label': `Optionen für ${a.title}` }, ic('more_vert'));
    const menu = h('div', { class: 'cm-panel sd-menu hidden', role: 'menu' },
        Menu.item({ icon: 'auto_awesome', label: a.coden ? 'Coden nochmal lösen lassen' : 'Coden lösen lassen', desc: 'Schreibt die Lösung in deiner Handschrift ins Heft', accent: true, onClick: () => solveWithCoden(st, a, { progress, buttons: [editBtn, more] }) }),
        a.coden ? Menu.item({ icon: 'ink_eraser', label: 'Coden-Lösung entfernen', onClick: async () => { if (!(await confirmBox('Alles entfernen, was Coden in dieses Heft geschrieben hat? Deine eigenen Striche bleiben.', { ok: 'Entfernen', danger: true }))) return; const { removeCodenSolution } = await import('./study-solve.js'); await removeCodenSolution(st, a); save(st); toast('Coden-Lösung entfernt.', { type: 'ok' }); } }) : null,
        Menu.sep(),
        a.status !== 'abgegeben'
            ? Menu.item({ icon: 'task_alt', label: 'Als abgegeben markieren', onClick: () => { S.submitAssignment(st, a.id); save(st); toast('Abgegeben ✓', { type: 'ok' }); } })
            : Menu.item({ icon: 'undo', label: 'Doch nicht abgegeben', onClick: () => { a.status = 'fertig'; a.submittedAt = null; save(st); } }),
        Menu.item({ icon: 'delete', label: 'Löschen', danger: true, onClick: async () => { if (!(await confirmBox(`Auftrag „${a.title}“ löschen?`, { ok: 'Löschen', danger: true }))) return; const doc = st.docs.find(x => x.assignmentId === a.id); if (doc) { deleteDocPages(doc.id); st.docs = st.docs.filter(x => x !== doc); } st.assignments = st.assignments.filter(x => x.id !== a.id); save(st); } }));
    Menu.bindMenu(more, menu);
    return h('div', { class: 'sd-card sd-as ' + state },
        h('div', { class: 'sd-card-main' },
            h('b', { text: a.title }),
            h('small', { class: 'sd-muted', text: [a.due ? `Abgabe ${S.fmtDate(a.due)} (${inDays(d)})` : 'ohne Abgabedatum', a.score != null ? `Coden-Score ${a.score} %` : '', a.coden ? 'von Coden gelöst' : ''].filter(Boolean).join(' · ') }),
            a.desc ? h('p', { class: 'sd-desc', text: a.desc.slice(0, 220) + (a.desc.length > 220 ? ' …' : '') }) : null,
            progress),
        h('span', { class: 'sd-status ' + state, text: label }),
        h('div', { class: 'sd-row' }, editBtn, h('div', { class: 'sd-more-wrap' }, more, menu)));
}
// Coden löst den Auftrag und schreibt in der Handschrift des Nutzers ins Heft, danach öffnet sich das Heft
async function solveWithCoden(st, a, { progress, buttons = [] } = {}) {
    const step = (t) => { progress.hidden = false; progress.replaceChildren(loader({ size: 18 }), h('span', { text: t })); };
    buttons.forEach(b => { b.disabled = true; });
    try {
        const { solveAssignment } = await import('./study-solve.js');
        const r = await solveAssignment(st, a, { ensureDoc, onStep: step });
        const where = [r.placed ? `${r.placed} Antwort${r.placed === 1 ? '' : 'en'} aufs Blatt` : '', r.extraPages ? `${r.extraPages} Seite${r.extraPages === 1 ? '' : 'n'} mit Rechenwegen` : ''].filter(Boolean).join(', ');
        toast(`Coden hat ${r.total} Aufgabe${r.total === 1 ? '' : 'n'} gelöst${where ? ': ' + where : ''}. Prüf es bitte kurz.`, { type: 'ok', ms: 7000 });
        rerender();
        openDoc(st, r.doc, a);
    } catch (e) {
        toast(e.message || 'Coden konnte den Auftrag nicht lösen.', { type: 'error', ms: 7000 });
    } finally {
        progress.hidden = true;
        buttons.forEach(b => { b.disabled = false; });
    }
}
async function openAssignment(st, a) {
    let doc = st.docs.find(d => d.assignmentId === a.id);
    if (!doc) { doc = await ensureDoc(st, { title: a.title, subjectId: a.subjectId, assignmentId: a.id }); StudyStore.save(st); }
    if (a.status === 'offen') { a.status = 'arbeit'; StudyStore.save(st); }
    openDoc(st, doc, a);
}
function examCard(st, e) {
    const d = days(e.date); const sessions = st.plan.filter(p => p.examId === e.id); const done = sessions.filter(p => p.done).length;
    return h('div', { class: 'sd-card sd-ex' + (d < 0 ? ' past' : d <= 3 ? ' soon' : '') },
        h('div', { class: 'sd-ex-date' }, h('b', { text: new Date(e.date + 'T12:00').getDate() }), h('small', { text: new Date(e.date + 'T12:00').toLocaleDateString('de-DE', { month: 'short' }) })),
        h('div', { class: 'sd-card-main' }, h('b', { text: e.title || 'Arbeit' }), h('small', { class: 'sd-muted', text: `${inDays(d)}${(e.topics || []).length ? ' · ' + e.topics.join(', ') : ''}` }),
            sessions.length ? h('div', { class: 'sd-progress' }, h('i', { style: { width: Math.round(done / sessions.length * 100) + '%' } }), h('small', { text: `Lernplan ${done}/${sessions.length}` })) : null),
        h('div', { class: 'sd-row' },
            d >= 1 ? h('button', { type: 'button', class: sessions.length ? 'cd-btn' : 'cd-primary', onclick: (ev) => makePlan(st, e, ev.currentTarget) }, ic('auto_awesome'), sessions.length ? ' Neu planen' : ' Lernplan erstellen') : null,
            d < 0 && !e.grade ? h('button', { type: 'button', class: 'cd-btn', onclick: () => { const v = prompt('Welche Note hast du bekommen? (z. B. 2- oder 11 P)'); const g = S.parseGrade(v); if (!g) return; e.grade = g.label; S.subjectOf(st, e.subjectId)?.grades.push({ id: S.uid('gr'), ...g, kind: 'Klassenarbeit', weight: 2, date: e.date }); save(st); } }, ic('grade'), ' Note') : e.grade ? h('span', { class: 'sd-chip', text: 'Note ' + e.grade }) : null,
            h('button', { type: 'button', class: 'cd-btn', title: 'Löschen', onclick: async () => { if (!(await confirmBox(`„${e.title || 'Arbeit'}“ löschen?`, { ok: 'Löschen', danger: true }))) return; st.exams = st.exams.filter(x => x.id !== e.id); st.plan = st.plan.filter(p => p.examId !== e.id || p.done); save(st); } }, ic('delete'))));
}

// ---------- Lernplan erstellen ----------
async function makePlan(st, exam, button) {
    const su = S.subjectOf(st, exam.subjectId);
    st.plan = st.plan.filter(p => !(p.examId === exam.id && !p.done)); // offene Einheiten dieser Arbeit neu planen
    const topics = (exam.topics?.length ? exam.topics : (su?.topics || []).filter(t => !t.done).map(t => t.title)).slice(0, 12);
    const sessions = S.buildPlan(st, { subjectId: exam.subjectId, examId: exam.id, until: exam.date, topics });
    if (!sessions.length) { toast('Keine freie Lernzeit bis zur Arbeit gefunden. Prüfe Stundenplan und Lernzeiten (Tab „Stundenplan“).', { type: 'warn', ms: 7000 }); return; }
    const run = async () => {
        const humDir = getAutoHumanizerPrompt('study');
        try { const what = json(await ask('Du bist ein Lerncoach für Schüler. Antworte nur mit JSON.' + (humDir ? '\n\n' + humDir : ''), S.planWhatPrompt({ subject: su?.name || '', exam: exam.title, topics, sessions }))); if (Array.isArray(what)) sessions.forEach((s, i) => { if (what[i]) s.what = String(what[i]).slice(0, 200); }); } catch (_) { /* ohne KI-Details geht der Plan trotzdem */ }
    };
    if (button) await busyBtn(button, 'Coden plant …', run); else await run();
    st.plan.push(...sessions); st.plan.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    save(st);
    toast(`${sessions.length} Lerneinheiten bis ${S.fmtDate(exam.date)} geplant – im Tab „Lernplan“.`, { type: 'ok', ms: 6000 });
}

// ---------- Dialoge ----------
function addSubjectDialog(st, su = null) {
    const name = h('input', { class: 'cd-input', value: su?.name || '', placeholder: 'z. B. Mathe' });
    let color = su?.color || S.SUBJECT_COLORS[st.subjects.length % S.SUBJECT_COLORS.length];
    const sw = h('div', { class: 'sd-swatches' }, ...S.SUBJECT_COLORS.map(c => { const b = h('button', { type: 'button', class: 'sd-sw' + (c === color ? ' on' : ''), style: { background: c }, onclick: () => { color = c; sw.querySelectorAll('.sd-sw').forEach(x => x.classList.toggle('on', x === b)); } }); return b; }));
    const m = modal(su ? 'Fach bearbeiten' : 'Neues Fach', h('div', { class: 'sd-form' }, field('Name', name), field('Farbe', sw),
        h('div', { class: 'cd-row end' }, h('button', { class: 'cd-btn', text: 'Abbrechen', onclick: () => m.close() }), h('button', { class: 'cd-primary', text: 'Speichern', onclick: () => { const n = name.value.trim(); if (!n) return; if (su) { su.name = n.slice(0, 40); su.color = color; } else S.addSubject(st, n, color); m.close(); save(st); } }))));
}
function subjectSelect(st, sel) {
    return h('select', { class: 'cd-input' }, ...st.subjects.map(s => h('option', { value: s.id, text: s.name, ...(s.id === sel ? { selected: true } : {}) })), h('option', { value: '__new', text: '+ Neues Fach …' }));
}
const pickSubject = (st, sel) => { if (sel.value !== '__new') return sel.value; const n = prompt('Name des neuen Fachs:'); return n ? S.addSubject(st, n).id : null; };

function addAssignmentDialog(st, subjectId = null) {
    if (!st.subjects.length) { addSubjectDialog(st); return; }
    const sel = subjectSelect(st, subjectId || ui.subject || st.subjects[0].id);
    const title = h('input', { class: 'cd-input', placeholder: 'z. B. Arbeitsblatt Parabeln S. 54' });
    const due = h('input', { class: 'cd-input', type: 'date', value: S.isoDate(Date.now() + 7 * 864e5) });
    const desc = h('textarea', { class: 'cd-input', rows: 3, placeholder: 'Was ist zu tun? (optional – Coden liest es auch vom Foto)' });
    const files = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, class: 'sd-file' });
    const fileInfo = h('small', { class: 'sd-muted', text: 'Fotos oder PDF vom Arbeitsblatt – du schreibst dann direkt darauf.' });
    files.addEventListener('change', () => { fileInfo.textContent = files.files.length ? `${files.files.length} Datei(en): ${[...files.files].map(f => f.name).join(', ')}` : ''; });
    const go = h('button', { class: 'cd-primary' }, ic('check'), ' Speichern & öffnen');
    const m = modal('Auftrag hochladen', h('div', { class: 'sd-form' }, field('Fach', sel), h('label', { class: 'sd-drop' }, ic('upload_file'), h('b', { text: 'Arbeitsblatt auswählen' }), fileInfo, files),
        field('Titel', title), field('Abgabe bis', due), field('Aufgabe', desc),
        h('div', { class: 'cd-row end' }, h('button', { class: 'cd-btn', text: 'Abbrechen', onclick: () => m.close() }), go)), { wide: true });
    go.addEventListener('click', () => busyBtn(go, 'Wird angelegt …', async () => {
        const sid = pickSubject(st, sel); if (!sid) return;
        let bgs = [];
        try { bgs = await filesToBackgrounds([...files.files]); } catch (e) { toast(e.message, { type: 'error' }); return; }
        const a = { id: S.uid('as'), subjectId: sid, title: title.value.trim().slice(0, 120), desc: desc.value.trim().slice(0, 6000), due: due.value || null, status: 'offen', createdAt: new Date().toISOString(), topicIds: [] };
        // Coden liest den Auftrag vom Foto (Titel, Abgabe, Aufgabe), wenn nichts eingetragen ist
        if (bgs.length && (!a.title || !a.desc)) {
            try {
                const r = json(await ask('Du liest Arbeitsaufträge von Fotos. Antworte NUR mit JSON.', `Lies den Arbeitsauftrag auf dem Bild. JSON: {"title":"kurzer Titel (max 8 Wörter)","task":"die Aufgabenstellung knapp, Aufgaben nummeriert","due":"YYYY-MM-DD oder leer"}. Heute ist ${S.isoDate(new Date())}.`, bgs.slice(0, 2)));
                if (r) { if (!a.title && r.title) a.title = String(r.title).slice(0, 120); if (!a.desc && r.task) a.desc = String(r.task).slice(0, 6000); if (r.due && /^\d{4}-\d{2}-\d{2}$/.test(r.due) && !due.value) a.due = r.due; }
            } catch (_) { /* ohne KI weiter */ }
        }
        if (!a.title) a.title = 'Auftrag vom ' + new Date().toLocaleDateString('de-DE');
        st.assignments.push(a);
        const doc = await ensureDoc(st, { title: a.title, subjectId: sid, assignmentId: a.id, backgrounds: bgs });
        StudyStore.save(st); m.close(); rerender(); openDoc(st, doc, a);
    }));
}
function addExamDialog(st, subjectId = null) {
    if (!st.subjects.length) { addSubjectDialog(st); return; }
    const sel = subjectSelect(st, subjectId || ui.subject || st.subjects[0].id);
    const title = h('input', { class: 'cd-input', value: 'Klassenarbeit', placeholder: 'Klassenarbeit, Test, Referat …' });
    const date = h('input', { class: 'cd-input', type: 'date', value: S.isoDate(Date.now() + 14 * 864e5) });
    const topics = h('textarea', { class: 'cd-input', rows: 3, placeholder: 'Themen, je Zeile oder mit Komma (z. B. Scheitelform, pq-Formel)' });
    const planNow = h('input', { type: 'checkbox', checked: true });
    const go = h('button', { class: 'cd-primary' }, ic('check'), ' Eintragen');
    const m = modal('Arbeit eintragen', h('div', { class: 'sd-form' }, field('Fach', sel), field('Was', title), field('Datum', date), field('Themen', topics),
        h('label', { class: 'sd-check' }, planNow, h('span', { text: 'Coden erstellt gleich einen Lernplan in meinen freien Zeiten' })),
        h('div', { class: 'cd-row end' }, h('button', { class: 'cd-btn', text: 'Abbrechen', onclick: () => m.close() }), go)));
    go.addEventListener('click', () => busyBtn(go, 'Speichert …', async () => {
        const sid = pickSubject(st, sel); if (!sid || !date.value) return;
        const list = topics.value.split(/[\n,;]/).map(t => t.trim()).filter(Boolean).slice(0, 20);
        const e = { id: S.uid('ex'), subjectId: sid, title: title.value.trim().slice(0, 80) || 'Arbeit', date: date.value, topics: list };
        st.exams.push(e);
        const su = S.subjectOf(st, sid); list.forEach(t => { if (!su.topics.some(x => x.title.toLowerCase() === t.toLowerCase())) su.topics.push({ id: S.uid('tp'), title: t.slice(0, 80), done: false }); });
        if (planNow.checked && days(e.date) >= 1) await makePlan(st, e, null); else save(st);
        m.close();
    }));
}

// ---------- Stundenplan & Lernzeiten ----------
function renderTimetable(st) {
    const wrap = h('div', { class: 'sd-wrap' });
    const photo = h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true });
    const upBtn = h('button', { type: 'button', class: 'cd-primary', onclick: () => photo.click() }, ic('photo_camera'), ' Foto vom Stundenplan');
    photo.addEventListener('change', () => busyBtn(upBtn, 'Coden liest …', async () => {
        try {
            const imgs = await filesToBackgrounds([...photo.files].slice(0, 1)); photo.value = ''; if (!imgs.length) return;
            // 1. Durchgang lesen, 2. Durchgang Karte für Karte gegen das Bild prüfen (Freiarbeit, kleine Karten, Termine)
            const SYS = 'Du liest Stundenpläne von Fotos, sehr genau und vollständig. Antworte NUR mit JSON.';
            const read = async (prompt) => { try { return json(await ask(SYS, prompt, imgs.slice(0, 1), 'pro')); } catch (_) { return json(await ask(SYS, prompt, imgs.slice(0, 1))); } };
            const first = await read(S.TIMETABLE_PROMPT);
            let raw = first;
            if (first) { const second = await read(S.timetableCheckPrompt(first)).catch(() => null); if (second && S.lessonCount(second) >= S.lessonCount(first)) raw = second; }
            const tt = S.cleanTimetable(raw, st); const n = S.DAYS.reduce((a, d) => a + tt[d].length, 0);
            if (!n) { toast('Coden konnte den Stundenplan nicht lesen. Versuch ein schärferes Foto oder trag ihn unten ein.', { type: 'warn', ms: 7000 }); return; }
            const fa = S.DAYS.reduce((a, d) => a + tt[d].filter(l => l.free).length, 0);
            if (S.DAYS.some(d => st.timetable[d].length) && !(await confirmBox(`Coden hat ${n} Stunden erkannt${fa ? `, davon ${fa}× Freiarbeit` : ''}. Deinen bisherigen Stundenplan ersetzen?`, { ok: 'Ersetzen', title: 'Stundenplan erkannt' }))) return;
            st.timetable = tt;
            const events = S.cleanEvents(raw);
            let added = 0;
            if (events.length && await confirmBox(`Auf dem Plan stehen auch Termine:\n${events.map(e => `• ${S.fmtDate(e.date)} ${e.subject}: ${e.title || (e.type === 'abgabe' ? 'Abgabe' : 'Test')}`).join('\n')}\n\nAls ${events.some(e => e.type === 'abgabe') ? 'Arbeiten/Abgaben' : 'Arbeiten'} eintragen?`, { ok: 'Eintragen', title: 'Termine gefunden' })) added = S.applyEvents(st, events);
            save(st); toast(`Stundenplan übernommen: ${n} Stunden${fa ? ` (${fa}× Freiarbeit)` : ''}, ${st.subjects.length} Fächer${added ? `, ${added} Termine` : ''}. Prüf kurz, ob alles stimmt – Zeiten kannst du anpassen.`, { type: 'ok', ms: 7000 });
        } catch (e) { toast('Lesen ging nicht: ' + e.message, { type: 'error' }); }
    }));
    wrap.append(h('div', { class: 'sd-sec-head' }, h('div', {}, h('h2', { text: 'Stundenplan' }), h('small', { class: 'sd-muted', text: 'Coden weiß so, wann du Schule hast und wann Zeit zum Lernen ist.' })), h('div', { class: 'sd-row' }, upBtn, photo)));
    const grid = h('div', { class: 'sd-tt' });
    for (const d of S.DAYS.slice(0, (st.timetable.sa || []).length ? 6 : 5)) {
        const col = h('div', { class: 'sd-tt-day' + (S.dayKey(new Date()) === d ? ' today' : '') }, h('b', { text: S.DAY_LABEL[d] }));
        for (const [i, l] of (st.timetable[d] || []).entries()) {
            const su = S.subjectOf(st, l.subjectId);
            const meta = [l.group, l.teacher, l.room].filter(Boolean).join(' · ');
            col.append(h('div', { class: 'sd-lesson' + (l.free ? ' free' : ''), style: { '--sc': l.free ? 'var(--accent-green, #2fb380)' : su?.color || '#888' } }, h('small', { text: `${l.start}–${l.end}` }), h('b', { text: su?.name || l.name }), l.free ? h('small', { class: 'sd-free-l', text: 'Frei wählbar', title: 'Hier arbeitest du an dem, was du willst – Coden schlägt dir vor, was gerade dran ist' }) : null, meta ? h('small', { text: meta }) : null,
                h('button', { type: 'button', class: 'sd-x', title: 'Stunde entfernen', onclick: () => { st.timetable[d].splice(i, 1); save(st); } }, ic('close'))));
        }
        const last = (st.timetable[d] || []).slice(-1)[0];
        const s = h('input', { class: 'cd-input sd-small', type: 'time', value: last ? S.fromMin(S.toMin(last.end) + 5) : '08:00' });
        const e = h('input', { class: 'cd-input sd-small', type: 'time', value: last ? S.fromMin(S.toMin(last.end) + 50) : '08:45' });
        const sub = subjectSelect(st, null);
        col.append(h('details', { class: 'sd-add-lesson' }, h('summary', {}, ic('add'), ' Stunde'), s, e, sub,
            h('button', { type: 'button', class: 'cd-btn', title: 'Freiarbeit: Zeit, in der du an dem arbeitest, was du willst', onclick: () => { if (S.toMin(e.value) <= S.toMin(s.value)) return toast('Ende muss nach dem Beginn liegen.', { type: 'warn' }); st.timetable[d].push({ start: s.value, end: e.value, subjectId: null, name: 'Freiarbeit', room: '', free: true }); st.timetable[d].sort((a, b) => S.toMin(a.start) - S.toMin(b.start)); save(st); } }, 'Freiarbeit'),
            h('button', { type: 'button', class: 'cd-btn', onclick: () => { const sid = pickSubject(st, sub); if (!sid) return; if (S.toMin(e.value) <= S.toMin(s.value)) return toast('Ende muss nach dem Beginn liegen.', { type: 'warn' }); st.timetable[d].push({ start: s.value, end: e.value, subjectId: sid, name: S.subjectOf(st, sid).name, room: '' }); st.timetable[d].sort((a, b) => S.toMin(a.start) - S.toMin(b.start)); save(st); } }, 'Hinzufügen')));
        grid.append(col);
    }
    wrap.append(grid);
    // Lernzeiten
    const p = st.prefs;
    const ls = h('input', { class: 'cd-input', type: 'time', value: p.learnStart }), le = h('input', { class: 'cd-input', type: 'time', value: p.learnEnd });
    const mx = h('input', { class: 'cd-input', type: 'number', min: 15, max: 300, step: 15, value: p.maxPerDay }), sl = h('input', { class: 'cd-input', type: 'number', min: 15, max: 90, step: 5, value: p.sessionMin });
    const br = h('input', { class: 'cd-input', type: 'number', min: 0, max: 240, step: 15, value: p.breakAfterSchool });
    const free = h('div', { class: 'sd-days' }, ...S.DAYS.map(d => h('label', { class: 'sd-daychip' }, h('input', { type: 'checkbox', checked: (p.freeDays || []).includes(d), value: d }), h('span', { text: S.DAY_SHORT[d] }))));
    const fa = h('label', { class: 'sd-daychip' }, h('input', { type: 'checkbox', checked: p.useFreiarbeit !== false }), h('span', { text: 'Ja' }));
    const best = h('select', { class: 'cd-input' }, ...[['frueh', 'Direkt nach der Schule'], ['nachmittag', 'Nachmittags'], ['abend', 'Abends']].map(([v, l]) => h('option', { value: v, text: l, ...(p.best === v ? { selected: true } : {}) })));
    best.addEventListener('change', () => { const map = { frueh: ['14:00', '17:30', 15], nachmittag: ['15:30', '19:30', 60], abend: ['18:00', '21:30', 120] }[best.value]; ls.value = map[0]; le.value = map[1]; br.value = map[2]; });
    wrap.append(section('Wann lernst du am besten?', 'schedule', null, h('div', { class: 'sd-prefs' },
        field('Ich lerne am liebsten', best), field('Lernen ab', ls), field('Lernen bis', le), field('Pause nach der Schule (min)', br), field('Höchstens pro Tag (min)', mx), field('Länge einer Lerneinheit (min)', sl, '25–45 min sind für die meisten ideal'), field('Freie Tage (kein Lernen)', free), field('Freiarbeit zum Lernen nutzen', fa, 'Coden plant Lerneinheiten auch in deine Freiarbeit'),
        h('div', { class: 'cd-row end' }, h('button', { type: 'button', class: 'cd-primary', onclick: () => { Object.assign(p, { learnStart: ls.value || p.learnStart, learnEnd: le.value || p.learnEnd, maxPerDay: Math.max(15, +mx.value || 90), sessionMin: Math.max(15, Math.min(90, +sl.value || 30)), breakAfterSchool: Math.max(0, +br.value || 0), best: best.value, freeDays: [...free.querySelectorAll('input:checked')].map(i => i.value), useFreiarbeit: fa.querySelector('input').checked }); save(st); toast('Lernzeiten gespeichert.', { type: 'ok' }); } }, ic('check'), ' Speichern')))));
    return wrap;
}

// ---------- Lernplan ----------
function renderPlan(st) {
    const wrap = h('div', { class: 'sd-wrap' });
    const upcoming = st.exams.filter(e => days(e.date) >= 1).sort((a, b) => a.date.localeCompare(b.date));
    const exSel = h('select', { class: 'cd-input' }, ...upcoming.map(e => h('option', { value: e.id, text: `${S.subjectOf(st, e.subjectId)?.name || ''}: ${e.title} (${S.fmtDate(e.date)})` })));
    const mk = h('button', { type: 'button', class: 'cd-primary', onclick: (ev) => { const e = st.exams.find(x => x.id === exSel.value); if (e) makePlan(st, e, ev.currentTarget); } }, ic('auto_awesome'), ' Lernplan erstellen');
    const chat = h('button', { type: 'button', class: 'cd-btn', onclick: () => { Router.go('chat'); setTimeout(() => document.dispatchEvent(new CustomEvent('codenFollowup', { detail: 'Schau dir mein Lern-Studio an und mach mir einen Lernplan für meine nächsten Arbeiten.' })), 600); } }, ic('chat'), ' Mit Coden im Chat planen');
    wrap.append(h('div', { class: 'sd-sec-head' }, h('div', {}, h('h2', { text: 'Lernplan' }), h('small', { class: 'sd-muted', text: 'Verteiltes Lernen in deinen freien Zeiten – zur Arbeit hin dichter, am Vortag die Generalprobe.' })),
        h('div', { class: 'sd-row' }, upcoming.length ? exSel : null, upcoming.length ? mk : h('button', { type: 'button', class: 'cd-btn', onclick: () => addExamDialog(st) }, ic('event'), ' Erst eine Arbeit eintragen'), chat)));
    const today = S.isoDate(new Date());
    const items = st.plan.filter(p => p.date >= S.isoDate(Date.now() - 864e5) && !p.skipped).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    if (!items.length) { wrap.append(h('div', { class: 'sd-empty' }, ic('event_note'), h('h3', { text: 'Noch kein Lernplan' }), h('p', { text: 'Trag eine Arbeit mit Themen ein – Coden verteilt die Lerneinheiten automatisch auf deine freien Nachmittage. Oder sag im Chat: „Mach mir einen Lernplan für Mathe“.' }))); return wrap; }
    const byDay = new Map(); items.forEach(p => { if (!byDay.has(p.date)) byDay.set(p.date, []); byDay.get(p.date).push(p); });
    const list = h('div', { class: 'sd-agenda' });
    for (const [d, arr] of byDay) {
        const exams = st.exams.filter(e => e.date === d);
        list.append(h('div', { class: 'sd-agenda-day' + (d === today ? ' today' : '') }, h('div', { class: 'sd-agenda-h' }, h('b', { text: d === today ? 'Heute' : S.fmtDate(d) }), h('small', { class: 'sd-muted', text: `${arr.reduce((n, p) => n + p.min, 0)} min` }), ...exams.map(e => h('span', { class: 'sd-chip warn', text: `${S.subjectOf(st, e.subjectId)?.name}: ${e.title}` }))),
            ...arr.map(p => sessionRow(st, p))));
    }
    wrap.append(list);
    return wrap;
}

// ---------- Statistik ----------
function renderStats(st) {
    const s = S.stats(st); const wrap = h('div', { class: 'sd-wrap' });
    wrap.append(h('div', { class: 'sd-sec-head' }, h('div', {}, h('h2', { text: 'Statistik' }), h('small', { class: 'sd-muted', text: 'Wie pünktlich du abgibst, wie gut deine Arbeiten sind und wie viel du lernst.' }))));
    wrap.append(h('div', { class: 'sd-kpis' },
        kpi('Pünktlich abgegeben', s.onTimeRate != null ? s.onTimeRate + ' %' : '–', 'schedule'),
        kpi('Abgegeben', `${s.submitted}/${s.assignments}`, 'assignment_turned_in'),
        kpi('Überfällig', String(s.overdue), 'assignment_late'),
        kpi('Ø Coden-Score', s.score != null ? s.score + ' %' : '–', 'fact_check'),
        kpi('Gelernt', `${s.minutes} min`, 'timer'),
        kpi('Lern-Serie', `${s.streak} Tag${s.streak === 1 ? '' : 'e'}`, 'local_fire_department')));
    // Woche
    const max = Math.max(30, ...s.week.map(w => w.min));
    wrap.append(section('Diese Woche gelernt', 'bar_chart', null, h('div', { class: 'sd-week' }, ...s.week.map(w => h('div', { class: 'sd-week-col', title: `${w.min} min` }, h('div', { class: 'sd-week-bar' }, h('i', { style: { height: Math.round(w.min / max * 100) + '%' } })), h('small', { text: S.DAY_SHORT[S.dayKey(w.date + 'T12:00')] }), h('b', { text: w.min ? w.min + '′' : '' }))))));
    // Fächer
    const table = h('div', { class: 'sd-stat-table' }, h('div', { class: 'sd-stat-row head' }, ...['Fach', 'Abgaben', 'Pünktlich', 'Coden-Score', 'Ø Note', 'Themen', 'Gelernt'].map(t => h('span', { text: t }))));
    for (const x of s.subjects) {
        const rate = x.submitted ? Math.round(x.onTime / x.submitted * 100) : null;
        table.append(h('div', { class: 'sd-stat-row' },
            h('span', {}, dot(x.color), x.name),
            h('span', { text: `${x.submitted}/${x.assignments}${x.overdue ? ` (${x.overdue} überfällig)` : ''}` }),
            h('span', {}, bar(rate, rate != null && rate < 70 ? 'warn' : 'ok'), rate != null ? rate + ' %' : '–'),
            h('span', {}, bar(x.score, x.score != null && x.score < 60 ? 'warn' : 'ok'), x.score != null ? x.score + ' %' : '–'),
            h('span', { text: x.grade != null ? String(x.grade).replace('.', ',') : '–' }),
            h('span', { text: x.topics ? `${x.topicsDone}/${x.topics}` : '–' }),
            h('span', { text: x.minutes + ' min' })));
    }
    wrap.append(section('Nach Fach', 'monitoring', null, s.subjects.length ? table : h('p', { class: 'sd-muted', text: 'Noch keine Fächer.' })));
    // Abgaben-Verlauf
    const hist = st.assignments.filter(a => a.status === 'abgegeben' || S.assignmentState(a) === 'ueberfaellig').sort((a, b) => String(b.submittedAt || b.due).localeCompare(String(a.submittedAt || a.due))).slice(0, 15);
    if (hist.length) wrap.append(section('Abgaben', 'history', null, h('div', { class: 'sd-list' }, ...hist.map(a => { const stt = S.assignmentState(a); return h('div', { class: 'sd-hist ' + stt }, dot(S.subjectOf(st, a.subjectId)?.color), h('span', { text: `${S.subjectOf(st, a.subjectId)?.name || ''}: ${a.title}` }), h('small', { text: stt === 'ueberfaellig' ? `fällig ${S.fmtDate(a.due)} – noch nicht abgegeben` : `abgegeben ${new Date(a.submittedAt).toLocaleDateString('de-DE')}${a.due ? ` (Frist ${S.fmtDate(a.due)})` : ''}` }), h('span', { class: 'sd-status ' + stt, text: { puenktlich: 'Pünktlich', spaet: 'Zu spät', ueberfaellig: 'Fehlt' }[stt] }), a.score != null ? h('b', { text: a.score + ' %' }) : null); }))));
    if (s.weakest) wrap.append(h('div', { class: 'sd-tip' }, ic('tips_and_updates'), h('span', { text: `Tipp: In ${s.weakest.name} lohnt sich gerade am meisten Übung. Lass Coden eine Seite korrigieren oder erstell einen Lernplan.` })));
    return wrap;
}
const bar = (v, cls) => h('i', { class: 'sd-minibar ' + cls }, h('i', { style: { width: (v ?? 0) + '%' } }));
