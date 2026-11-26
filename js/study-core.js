// js/study-core.js – Datenmodell des Lern-Studios (ohne DOM, damit testbar):
// Fächer (Themen, Noten), Aufträge (Abgabe, Status, Heft), Arbeiten (Datum, Themen), Stundenplan, Lernzeiten,
// Lernplan (freie Zeiten aus dem Stundenplan), Statistik, Erinnerungen und der Kontext für den Chat.
import { normalizeHandwriting } from './handwriting-core.js';

export const DAYS = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];
export const DAY_LABEL = { mo: 'Montag', di: 'Dienstag', mi: 'Mittwoch', do: 'Donnerstag', fr: 'Freitag', sa: 'Samstag', so: 'Sonntag' };
export const DAY_SHORT = { mo: 'Mo', di: 'Di', mi: 'Mi', do: 'Do', fr: 'Fr', sa: 'Sa', so: 'So' };
export const SUBJECT_COLORS = ['#5B8DEF', '#E5484D', '#30A46C', '#8E4EC6', '#F76B15', '#12A594', '#D6409F', '#978365', '#3E63DD', '#E5A00D'];
export const STATUS = { offen: 'Offen', arbeit: 'In Arbeit', fertig: 'Fertig', abgegeben: 'Abgegeben' };

export const uid = (p = 'x') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => DAYS[(new Date(d).getDay() + 6) % 7];
export const isoDate = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
export const toMin = (hhmm) => { const m = String(hhmm || '').match(/^(\d{1,2})[:.](\d{2})/); return m ? Math.min(24 * 60, +m[1] * 60 + +m[2]) : null; };
export const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);
const at = (date, hhmm) => { const d = startOfDay(typeof date === 'string' ? date + 'T00:00:00' : date); const m = toMin(hhmm) ?? 0; d.setMinutes(m); return d; };
export const fmtDate = (d) => new Date(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00' : d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

// ---------- Grundgerüst ----------
export function blank() {
    return {
        v: 1, subjects: [], assignments: [], exams: [], docs: [], folders: [], plan: [],
        timetable: Object.fromEntries(DAYS.map(d => [d, []])),
        prefs: { learnStart: '15:30', learnEnd: '19:30', maxPerDay: 90, sessionMin: 30, freeDays: ['so'], breakAfterSchool: 60, best: 'nachmittag' }
    };
}
export function normalize(s) {
    const b = blank(); const x = s && typeof s === 'object' ? s : {};
    const out = { ...b, ...x, prefs: { ...b.prefs, ...(x.prefs || {}) }, timetable: { ...b.timetable, ...(x.timetable || {}) } };
    for (const k of ['subjects', 'assignments', 'exams', 'docs', 'folders', 'plan']) out[k] = Array.isArray(x[k]) ? x[k] : [];
    out.docs.forEach(d => { d.pages = Array.isArray(d.pages) ? d.pages : []; d.bookmarks = Array.isArray(d.bookmarks) ? d.bookmarks : []; if (d.folderId && !out.folders.some(f => f.id === d.folderId)) d.folderId = null; });
    for (const d of DAYS) out.timetable[d] = Array.isArray(out.timetable[d]) ? out.timetable[d] : [];
    out.subjects.forEach(su => { su.topics = Array.isArray(su.topics) ? su.topics : []; su.grades = Array.isArray(su.grades) ? su.grades : []; });
    out.handwriting = normalizeHandwriting(x.handwriting);
    return out;
}

// ---------- Fächer ----------
export function addSubject(st, name, color) {
    const n = str(name, 40); if (!n) return null;
    const ex = st.subjects.find(s => s.name.toLowerCase() === n.toLowerCase()); if (ex) return ex;
    const su = { id: uid('su'), name: n, color: color || SUBJECT_COLORS[st.subjects.length % SUBJECT_COLORS.length], teacher: '', topics: [], grades: [], createdAt: new Date().toISOString() };
    st.subjects.push(su); return su;
}
export function deleteSubject(st, id) {
    const idx = st.subjects.findIndex(s => s.id === id);
    if (idx < 0) return { deleted: false, docIds: [] };
    const docIds = st.docs.filter(d => d.subjectId === id).map(d => d.id);
    st.subjects = st.subjects.filter(s => s.id !== id);
    st.assignments = st.assignments.filter(a => a.subjectId !== id);
    st.exams = st.exams.filter(e => e.subjectId !== id);
    st.docs = st.docs.filter(d => d.subjectId !== id);
    st.plan = st.plan.filter(p => p.subjectId !== id);
    for (const d of DAYS) st.timetable[d] = (st.timetable[d] || []).filter(l => l.subjectId !== id);
    return { deleted: true, docIds };
}
export const subjectOf = (st, id) => st.subjects.find(s => s.id === id) || null;
export const subjectByName = (st, name) => { const n = String(name || '').trim().toLowerCase(); if (!n) return null; return st.subjects.find(s => s.name.toLowerCase() === n) || st.subjects.find(s => s.name.toLowerCase().startsWith(n) || n.startsWith(s.name.toLowerCase())) || null; };

// Noten: Schulnoten 1–6 (auch "2-", "3+") oder Punkte 0–15
export function parseGrade(v) {
    const t = String(v ?? '').trim().replace(',', '.');
    let m = t.match(/^([1-6])\s*([+-])?$/); if (m) return { value: +m[1] + (m[2] === '+' ? -0.25 : m[2] === '-' ? 0.25 : 0), scale: 'note', label: m[1] + (m[2] || '') };
    m = t.match(/^(\d{1,2})\s*(P|Punkte|NP)$/i); if (m && +m[1] <= 15) return { value: +m[1], scale: 'punkte', label: m[1] + ' P' };
    m = t.match(/^[1-6](\.\d+)?$/); if (m) return { value: +t, scale: 'note', label: t.replace('.', ',') };
    return null;
}
const asNote = (g) => (g.scale === 'punkte' ? Math.max(1, Math.min(6, (17 - g.value) / 3)) : g.value);
export function gradeAverage(grades) {
    const list = (grades || []).filter(g => Number.isFinite(g?.value));
    const w = list.reduce((a, g) => a + (+g.weight || 1), 0); if (!w) return null;
    return Math.round(list.reduce((a, g) => a + asNote(g) * (+g.weight || 1), 0) / w * 100) / 100;
}

// ---------- Notizbücher-Bibliothek (Ordner, Favoriten, Suche) ----------
export const folderOf = (st, id) => st.folders.find(f => f.id === id) || null;
export const childFolders = (st, parentId = null) => st.folders.filter(f => (f.parentId || null) === (parentId || null)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
export function folderPath(st, id) { const out = []; let f = folderOf(st, id); const seen = new Set(); while (f && !seen.has(f.id)) { seen.add(f.id); out.unshift(f); f = folderOf(st, f.parentId); } return out; }
export function isInside(st, id, ancestorId) { let f = folderOf(st, id); const seen = new Set(); while (f && !seen.has(f.id)) { if (f.id === ancestorId) return true; seen.add(f.id); f = folderOf(st, f.parentId); } return false; }
export function addFolder(st, name, parentId = null, color = '#5B8DEF') {
    const n = str(name, 60); if (!n) return null;
    const f = { id: uid('fo'), name: n, parentId: parentId && folderOf(st, parentId) ? parentId : null, color, createdAt: new Date().toISOString() };
    st.folders.push(f); return f;
}
// Ordner verschieben – nie in sich selbst oder einen eigenen Unterordner
export function moveFolder(st, id, parentId) {
    const f = folderOf(st, id); if (!f) return false;
    if (parentId && (parentId === id || isInside(st, parentId, id))) return false;
    f.parentId = parentId || null; return true;
}
// Ordner löschen: Inhalt (Notizbücher und Unterordner) wandert eine Ebene nach oben
export function deleteFolder(st, id) {
    const f = folderOf(st, id); if (!f) return;
    st.folders.forEach(x => { if (x.parentId === id) x.parentId = f.parentId || null; });
    st.docs.forEach(d => { if (d.folderId === id) d.folderId = f.parentId || null; });
    st.folders = st.folders.filter(x => x.id !== id);
}
export function countIn(st, folderId) {
    let n = st.docs.filter(d => d.folderId === folderId).length;
    for (const c of childFolders(st, folderId)) n += countIn(st, c.id);
    return n;
}
export function sortDocs(list, by = 'bearbeitet') {
    const t = (d, k) => Date.parse(d[k] || d.createdAt || 0) || 0;
    const arr = list.slice();
    if (by === 'name') arr.sort((a, b) => String(a.title).localeCompare(String(b.title), 'de', { numeric: true }));
    else if (by === 'erstellt') arr.sort((a, b) => t(b, 'createdAt') - t(a, 'createdAt'));
    else if (by === 'geoeffnet') arr.sort((a, b) => t(b, 'openedAt') - t(a, 'openedAt'));
    else arr.sort((a, b) => t(b, 'updatedAt') - t(a, 'updatedAt'));
    return arr;
}
export function searchDocs(st, q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return [];
    return st.docs.filter(d => { const hay = [d.title, subjectOf(st, d.subjectId)?.name, ...folderPath(st, d.folderId).map(f => f.name)].join(' ').toLowerCase(); return words.every(w => hay.includes(w)); });
}
export function newDoc(st, { title, folderId = null, subjectId = null, paper = 'liniert', cover = null }) {
    const now = new Date().toISOString();
    const d = { id: 'dc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: str(title, 80) || 'Unbenanntes Notizbuch', folderId: folderId && folderOf(st, folderId) ? folderId : null, subjectId: subjectId && subjectOf(st, subjectId) ? subjectId : null, assignmentId: null, paper, cover: cover || { color: '#2B3A55', style: 'leinen' }, pages: [], bookmarks: [], favorite: false, createdAt: now, updatedAt: now };
    st.docs.push(d); return d;
}

// ---------- Aufträge ----------
export function assignmentState(a, now = Date.now()) {
    if (a.status === 'abgegeben') return a.due && a.submittedAt && Date.parse(a.submittedAt) > at(a.due, '23:59').getTime() ? 'spaet' : 'puenktlich';
    if (a.due && at(a.due, '23:59').getTime() < now) return 'ueberfaellig';
    return 'offen';
}
export function submitAssignment(st, id, when = new Date()) {
    const a = st.assignments.find(x => x.id === id); if (!a) return null;
    a.status = 'abgegeben'; a.submittedAt = new Date(when).toISOString();
    (a.topicIds || []).forEach(tid => { const t = st.subjects.flatMap(s => s.topics).find(x => x.id === tid); if (t && !t.done) { t.done = true; t.doneAt = a.submittedAt; } });
    return a;
}

// ---------- Stundenplan ----------
// Freiarbeit (Lernbüro, Selbstlernzeit …): Schulzeit, in der man an dem arbeitet, was man will → zählt als Lernzeit
export const FREE_RE = /^(freiarbeit|frei\s*arbeit|lernb(ü|ue)ro|lernzeit|selbstlern|studienzeit|eva\b|silentium|fa\b)/i;
// Termine ohne Fach (keine eigenen Fächer anlegen)
const NO_SUBJECT_RE = /^(klassenrat|klassenleiter|kl\.?\s*stunde|klassenstunde|ag\b|förder|foerder|vertretung|morgenkreis|tutor)/i;
const SKIP_RE = /^(pause|frei|freistunde|mittag|mittagspause|hofpause|-+|–)$/i;

// Ohne Uhrzeiten (z. B. Steckkarten-Plan mit Pausen): Blöcke zwischen den Pausen gleichmäßig auf die Karten verteilen
function blockTimes(days, breaks, dayStart, slot) {
    const br = (breaks || []).map(b => [toMin(b.start), toMin(b.end)]).filter(([a, b]) => a != null && b != null && b > a).sort((x, y) => x[0] - y[0]);
    const nBlocks = Math.max(br.length + 1, ...Object.values(days).flat().map(l => +l.block || 1));
    const maxIn = (k) => Math.max(1, ...Object.values(days).map(arr => arr.filter(l => (+l.block || 1) === k).length));
    const bounds = []; let cur = toMin(dayStart) ?? 8 * 60;
    for (let k = 1; k <= nBlocks; k++) {
        const b = br[k - 1]; const endB = b ? b[0] : cur + maxIn(k) * slot;
        bounds.push([cur, Math.max(cur + 20, endB)]); cur = b ? b[1] : endB + 15;
    }
    return bounds;
}

// Aus KI-Antwort (Foto eines Stundenplans) oder Eingabe: { mo: [{start,end,subject,room,teacher,group,free}], … }
// Neues Format: { dayStart, breaks:[{start,end}], days:{mo:[{subject,block,…}]}, events:[…] }
export function cleanTimetable(raw, st) {
    const out = Object.fromEntries(DAYS.map(d => [d, []]));
    const src0 = raw && typeof raw === 'object' ? (raw.days || raw.timetable || raw) : {};
    const alias = { montag: 'mo', dienstag: 'di', mittwoch: 'mi', donnerstag: 'do', freitag: 'fr', samstag: 'sa', sonntag: 'so', monday: 'mo', tuesday: 'di', wednesday: 'mi', thursday: 'do', friday: 'fr', saturday: 'sa', sunday: 'so' };
    const src = {};
    for (const [k, v] of Object.entries(src0)) { const d = DAYS.includes(k.toLowerCase().slice(0, 2)) && k.length <= 3 ? k.toLowerCase().slice(0, 2) : alias[k.toLowerCase()]; if (d && Array.isArray(v)) src[d] = v.filter(l => l && typeof l === 'object'); }
    // fehlende Uhrzeiten aus Blöcken/Pausen ableiten
    const slot = Math.max(30, Math.min(90, +raw?.slotMin || 45));
    const bounds = blockTimes(src, raw?.breaks, raw?.dayStart, slot);
    for (const [d, arr] of Object.entries(src)) {
        const byBlock = new Map(); arr.forEach(l => { if (toMin(l.start) != null && toMin(l.end) != null) return; const k = Math.max(1, +l.block || 1); if (!byBlock.has(k)) byBlock.set(k, []); byBlock.get(k).push(l); });
        for (const [k, ls] of byBlock) {
            const [a, b] = bounds[k - 1] || bounds[bounds.length - 1]; const w = ls.map(l => Math.max(0.25, Math.min(3, +l.size || 1))); const tot = w.reduce((x, y) => x + y, 0);
            let t = a; ls.forEach((l, i) => { const len = Math.round((b - a) * w[i] / tot / 5) * 5; l.start = fromMin(t); l.end = fromMin(i === ls.length - 1 ? b : t + len); t += len; });
        }
    }
    for (const [d, v] of Object.entries(src)) {
        for (const l of v) {
            const s = toMin(l.start), e = toMin(l.end); let name = str(l.subject || l.fach || l.name, 40);
            if (s == null || e == null || e <= s || !name || SKIP_RE.test(name)) continue;
            const free = !!l.free || FREE_RE.test(name); if (free && /^(fa|eva)$/i.test(name)) name = 'Freiarbeit';
            let su = null;
            if (!free && !NO_SUBJECT_RE.test(name) && st) { su = subjectByName(st, name); if (!su) su = addSubject(st, name); }
            out[d].push({ start: fromMin(s), end: fromMin(e), subjectId: su?.id || null, name: free && !l.subject ? 'Freiarbeit' : name, room: str(l.room || l.raum, 20), teacher: str(l.teacher || l.lehrer, 40), group: str(l.group || l.kurs, 20), ...(free ? { free: true } : {}) });
        }
        out[d].sort((a, b) => toMin(a.start) - toMin(b.start));
    }
    return out;
}

// Termine vom Plan (LSÜ, Arbeiten, Abgaben): Datum ohne Jahr → nächstes passendes Datum
export function parseDay(v, now = new Date()) {
    const m = String(v || '').match(/(\d{1,4})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/); if (!m) return null;
    let [, a, b, c] = m; let y, mo, d;
    if (a.length === 4) { y = +a; mo = +b; d = +c; } else { d = +a; mo = +b; y = c ? (c.length === 2 ? 2000 + +c : +c) : null; }
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    if (!y) { y = now.getFullYear(); const t = new Date(y, mo - 1, d); if (t < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 45)) y++; }
    return isoDate(new Date(y, mo - 1, d));
}
export function cleanEvents(raw, now = new Date()) {
    return (Array.isArray(raw?.events) ? raw.events : []).map(e => ({ type: /abgab|deadline|due/i.test(e?.type || '') || /abgabe/i.test(e?.title || e?.note || '') ? 'abgabe' : 'test', subject: str(e?.subject || e?.fach, 40), title: str(e?.title || e?.kind || '', 60), date: parseDay(e?.date, now) }))
        .filter(e => e.subject && e.date);
}
// Erkannte Termine eintragen (ohne Doppelte); gibt die Zahl neuer Einträge zurück
export function applyEvents(st, events) {
    let n = 0;
    for (const e of events) {
        const su = subjectByName(st, e.subject) || addSubject(st, e.subject);
        if (e.type === 'abgabe') {
            if (st.assignments.some(a => a.subjectId === su.id && a.due === e.date)) continue;
            st.assignments.push({ id: uid('as'), subjectId: su.id, title: e.title || 'Abgabe', desc: '', due: e.date, status: 'offen', createdAt: new Date().toISOString(), topicIds: [] }); n++;
        } else {
            if (st.exams.some(x => x.subjectId === su.id && x.date === e.date)) continue;
            st.exams.push({ id: uid('ex'), subjectId: su.id, title: e.title || 'Test', date: e.date, topics: [] }); n++;
        }
    }
    return n;
}
export const freiarbeitOn = (st, day) => (st.timetable[day] || []).filter(l => l.free);
export const schoolEnd = (st, day) => { const l = st.timetable[day] || []; return l.length ? Math.max(...l.map(x => toMin(x.end))) : null; };
export const lessonsOn = (st, date) => (st.timetable[dayKey(date)] || []);

// ---------- Freie Lernzeiten & Lernplan ----------
// Freie Fenster eines Tages: nach Schulschluss + Pause, innerhalb der Lernzeit, ohne bereits geplante Einheiten
export function freeWindows(st, date) {
    const p = st.prefs; const d = dayKey(date);
    if ((p.freeDays || []).includes(d)) return [];
    let from = toMin(p.learnStart) ?? 15 * 60; const to = toMin(p.learnEnd) ?? 19 * 60;
    const end = schoolEnd(st, d); if (end != null) from = Math.max(from, end + (+p.breakAfterSchool || 0));
    const day = isoDate(date);
    const busy = st.plan.filter(s => s.date === day && !s.skipped).map(s => [toMin(s.start), toMin(s.start) + (+s.min || 30)]).sort((a, b) => a[0] - b[0]);
    const out = []; let cur = from;
    // Freiarbeit in der Schule: freie Lernzeit (z. B. 09:00–10:00), sofern nicht abgeschaltet
    if (p.useFreiarbeit !== false) for (const l of (st.timetable[d] || []).filter(l => l.free)) {
        let [a, b] = [toMin(l.start), toMin(l.end)]; for (const [x, y] of busy) if (x < b && y > a) { if (x - a >= 20) out.push([a, x]); a = Math.max(a, y + 5); }
        if (b - a >= 20) out.push([a, b]);
    }
    for (const [a, b] of busy) { if (a - cur >= 20) out.push([cur, Math.min(a, to)]); cur = Math.max(cur, b + 10); }
    if (to - cur >= 20) out.push([cur, to]);
    return out.filter(([a, b]) => b - a >= 20);
}
export const plannedMinutes = (st, date) => st.plan.filter(s => s.date === isoDate(date) && !s.skipped).reduce((n, s) => n + (+s.min || 0), 0);

// Lerneinheiten bis zur Arbeit verteilen: wiederholt, zur Arbeit hin dichter (verteiltes Lernen), in freien Zeiten.
// topics: Themen der Arbeit; liefert neue Einheiten (noch nicht gespeichert)
export function buildPlan(st, { subjectId, examId = null, until, topics = [], sessions = null, now = new Date(), what = [] }) {
    const p = st.prefs; const len = Math.max(15, Math.min(90, +p.sessionMin || 30));
    const start = startOfDay(now); if (now.getHours() >= (toMin(p.learnEnd) ?? 19 * 60) / 60) start.setDate(start.getDate() + 1);
    const last = startOfDay(typeof until === 'string' ? until + 'T00:00:00' : until); last.setDate(last.getDate() - 1); // Tag vor der Arbeit ist der letzte
    const span = daysBetween(start, last) + 1; if (span <= 0) return [];
    const want = sessions || Math.max(2, Math.min(14, Math.round(Math.max(2, topics.length) * 1.5 + 1)));
    // Wunschtage: Abstände werden zur Arbeit hin kleiner (z. B. Tag 0, 4, 7, 9, 10 …)
    const days = []; for (let i = 0; i < span; i++) { const d = new Date(start); d.setDate(d.getDate() + i); days.push(d); }
    const weight = days.map((_, i) => 1 + (i / Math.max(1, span - 1)) * 2.2);
    const total = weight.reduce((a, b) => a + b, 0); let acc = 0; const targets = [];
    for (let k = 0; k < want; k++) targets.push(total * (k + 0.5) / want);
    const dayFor = targets.map(t => { let s = 0; for (let i = 0; i < days.length; i++) { s += weight[i]; if (s >= t) return i; } return days.length - 1; });
    const out = []; const tmp = { ...st, plan: [...st.plan] };
    const order = [...topics]; const label = (k) => (order.length ? order[k % order.length] : 'Wiederholen');
    dayFor.forEach((i, k) => {
        // passenden Tag suchen: Wunschtag, sonst die nächsten Tage davor/danach
        const taken = new Set(out.map(x => x.date));
        for (const [off, spread] of [0, 1, -1, 2, -2, 3, -3].flatMap(o => [[o, true]]).concat([0, 1, -1, 2, -2].map(o => [o, false]))) {
            const j = i + off; if (j < 0 || j >= days.length) continue;
            const d = days[j]; if (spread && taken.has(isoDate(d))) continue; // lieber verteilt als zwei Einheiten an einem Tag
            if (plannedMinutes(tmp, d) + len > (+p.maxPerDay || 90)) continue;
            let win = freeWindows(tmp, d).find(([a, b]) => b - a >= len); if (!win) continue;
            if (j === 0 && isoDate(d) === isoDate(now)) { const nowMin = now.getHours() * 60 + now.getMinutes() + 15; win = freeWindows(tmp, d).map(([a, b]) => [Math.max(a, Math.ceil(nowMin / 5) * 5), b]).find(([a, b]) => b - a >= len); if (!win) continue; }
            const isLast = k === dayFor.length - 1;
            const s = { id: uid('pl'), date: isoDate(d), start: fromMin(win[0]), min: len, subjectId, examId, title: isLast ? 'Generalprobe: alles wiederholen' : label(k), what: str(what[k] || (isLast ? 'Probearbeit unter Zeitdruck, Fehler danach nacharbeiten' : ''), 300), done: false };
            tmp.plan.push(s); out.push(s); return;
        }
    });
    return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

// <lernplan>-Block aus dem Chat: Zeilen "2026-12-01 16:00 | 45 | Mathe | Parabeln üben"
export function parsePlanLines(text, st) {
    const out = [];
    for (const l of String(text || '').split('\n').map(x => x.trim()).filter(Boolean)) {
        const parts = l.replace(/^[-*]\s*/, '').split(/\s*\|\s*/); if (parts.length < 3) continue;
        const m = parts[0].match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}[:.]\d{2}))?/) || parts[0].match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?:\s+(\d{1,2}[:.]\d{2}))?/);
        if (!m) continue;
        let date, time;
        if (m[0].includes('-')) { date = m[1]; time = m[2]; }
        else { const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(new Date().getFullYear()); date = `${y}-${pad(m[2])}-${pad(m[1])}`; time = m[4]; }
        const hasMin = /^\d{1,3}\s*(min)?$/i.test(parts[1] || '');
        const min = hasMin ? Math.max(10, Math.min(180, parseInt(parts[1], 10))) : 30;
        const subj = hasMin ? parts[2] : parts[1]; const title = (hasMin ? parts.slice(3) : parts.slice(2)).join(' – ');
        const su = st ? subjectByName(st, subj) : null;
        out.push({ id: uid('pl'), date, start: time ? fromMin(toMin(time.replace('.', ':'))) : (st?.prefs.learnStart || '16:00'), min, subjectId: su?.id || null, subjectName: str(subj, 40), title: str(title || 'Lernen', 120), what: '', done: false });
    }
    return out;
}

// ---------- Statistik ----------
export function stats(st, now = Date.now()) {
    const per = st.subjects.map(su => {
        const as = st.assignments.filter(a => a.subjectId === su.id);
        const states = as.map(a => assignmentState(a, now));
        const scores = as.map(a => a.score).filter(Number.isFinite);
        const plan = st.plan.filter(p => p.subjectId === su.id);
        const exams = st.exams.filter(e => e.subjectId === su.id);
        return {
            id: su.id, name: su.name, color: su.color,
            assignments: as.length, submitted: states.filter(x => x === 'puenktlich' || x === 'spaet').length,
            onTime: states.filter(x => x === 'puenktlich').length, late: states.filter(x => x === 'spaet').length,
            overdue: states.filter(x => x === 'ueberfaellig').length, open: states.filter(x => x === 'offen').length,
            score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
            grade: gradeAverage(su.grades), topics: su.topics.length, topicsDone: su.topics.filter(t => t.done).length,
            minutes: plan.filter(p => p.done).reduce((n, p) => n + (+p.min || 0), 0), planned: plan.length, planDone: plan.filter(p => p.done).length,
            nextExam: exams.filter(e => Date.parse(e.date + 'T23:59:00') >= now).sort((a, b) => a.date.localeCompare(b.date))[0] || null
        };
    });
    const sum = (k) => per.reduce((n, x) => n + (x[k] || 0), 0);
    const scored = per.filter(x => x.score != null);
    // Lern-Serie: Tage in Folge (bis heute/gestern) mit erledigter Einheit oder Abgabe
    const doneDays = new Set([...st.plan.filter(p => p.done).map(p => p.date), ...st.assignments.filter(a => a.submittedAt).map(a => isoDate(a.submittedAt))]);
    let streak = 0; const d = startOfDay(now); if (!doneDays.has(isoDate(d))) d.setDate(d.getDate() - 1);
    while (doneDays.has(isoDate(d))) { streak++; d.setDate(d.getDate() - 1); }
    // letzte 7 Tage: Lernminuten
    const week = []; for (let i = 6; i >= 0; i--) { const x = startOfDay(now); x.setDate(x.getDate() - i); const k = isoDate(x); week.push({ date: k, min: st.plan.filter(p => p.done && p.date === k).reduce((n, p) => n + (+p.min || 0), 0) }); }
    return {
        subjects: per, assignments: sum('assignments'), submitted: sum('submitted'), onTime: sum('onTime'), late: sum('late'), overdue: sum('overdue'), open: sum('open'),
        onTimeRate: sum('submitted') ? Math.round(sum('onTime') / sum('submitted') * 100) : null,
        score: scored.length ? Math.round(scored.reduce((a, x) => a + x.score, 0) / scored.length) : null,
        minutes: sum('minutes'), streak, week,
        weakest: [...per].filter(x => x.score != null || x.grade != null).sort((a, b) => (b.grade ?? (6 - (b.score ?? 50) / 20)) - (a.grade ?? (6 - (a.score ?? 50) / 20)))[0] || null
    };
}

// ---------- Erinnerungen (für Push) ----------
export function reminders(st, now = Date.now()) {
    const out = []; const name = (id) => subjectOf(st, id)?.name || 'Fach'; const horizon = now + 21 * 864e5;
    const push = (id, when, title, body, url = '/#/lernen') => { const t = when.getTime(); if (t > now - 60e3 && t < horizon) out.push({ id, at: when.toISOString(), title, body, url }); };
    const evening = (date, daysBefore, hhmm = '17:00') => { const d = at(date, hhmm); d.setDate(d.getDate() - daysBefore); return d; };
    for (const e of st.exams) {
        const open = (e.topics || []).length ? ` Themen: ${(e.topics || []).slice(0, 4).join(', ')}` : '';
        push(`ex:${e.id}:7`, evening(e.date, 7), `${name(e.subjectId)}: Arbeit in einer Woche`, `${e.title || 'Arbeit'} am ${fmtDate(e.date)}.${open}`);
        push(`ex:${e.id}:3`, evening(e.date, 3), `${name(e.subjectId)}: noch 3 Tage`, `Zeit für die Hauptwiederholung – ${e.title || 'Arbeit'} am ${fmtDate(e.date)}.`);
        push(`ex:${e.id}:1`, evening(e.date, 1, '18:00'), `Morgen: ${name(e.subjectId)}`, `Heute nur noch locker wiederholen und früh schlafen. Du schaffst das!`);
    }
    for (const a of st.assignments) {
        if (a.status === 'abgegeben' || !a.due) continue;
        push(`as:${a.id}:1`, evening(a.due, 1, '16:00'), `Abgabe morgen: ${name(a.subjectId)}`, `${a.title} ist morgen fällig.${a.status === 'fertig' ? ' Fertig – nur noch exportieren und abgeben.' : ''}`);
        push(`as:${a.id}:0`, at(a.due, '07:00'), `Heute abgeben: ${a.title}`, `${name(a.subjectId)} – nicht vergessen.`);
    }
    for (const p of st.plan) {
        if (p.done || p.skipped) continue;
        const t = at(p.date, p.start); t.setMinutes(t.getMinutes() - 10);
        push(`pl:${p.id}`, t, `Gleich lernen: ${subjectOf(st, p.subjectId)?.name || p.subjectName || 'Lernzeit'}`, `${p.title} (${p.min} min) um ${p.start}.`);
    }
    // offene Themen eines Fachs mit Arbeit in < 10 Tagen: abends einmal erinnern
    for (const e of st.exams) {
        const left = daysBetween(now, e.date + 'T00:00:00'); if (left < 2 || left > 10) continue;
        const su = subjectOf(st, e.subjectId); const open = (su?.topics || []).filter(t => !t.done);
        if (open.length) push(`tp:${e.id}:${isoDate(now)}`, evening(isoDate(now), 0, '19:00'), `${su.name}: ${open.length} Thema${open.length === 1 ? '' : 'en'} offen`, `Noch nicht fertig: ${open.slice(0, 3).map(t => t.title).join(', ')}.`);
    }
    return out.sort((a, b) => a.at.localeCompare(b.at)).slice(0, 80);
}

// ---------- Kontext für den Chat (Coden hat Überblick) ----------
// Nächste Schulstunden ab jetzt (heute nur, was noch nicht vorbei ist), höchstens 8 Tage voraus.
// Rechnet die App selbst aus, damit Coden nicht „heute 14:50“ sagt, wenn es schon 23 Uhr ist.
export function nextLessons(st, now = new Date(), { count = 3, free = false } = {}) {
    const out = []; const nowMin = now.getHours() * 60 + now.getMinutes();
    for (let i = 0; i < 8 && out.length < count; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
        const list = (st.timetable[dayKey(d)] || []).filter(l => (!free || l.free) && toMin(l.start) != null)
            .filter(l => i > 0 || toMin(l.end ?? l.start) > nowMin)
            .sort((a, b) => toMin(a.start) - toMin(b.start));
        for (const l of list) { if (out.length >= count) break; out.push({ date: isoDate(d), day: i === 0 ? 'heute' : i === 1 ? 'morgen' : DAY_LABEL[dayKey(d)], start: l.start, end: l.end, name: l.name, teacher: l.teacher || '', free: !!l.free, running: i === 0 && toMin(l.start) <= nowMin }); }
    }
    return out;
}
const lessonText = (l) => `${l.day} (${fmtDate(l.date)}) ${l.start}–${l.end} ${l.name}${l.teacher ? ` bei ${l.teacher}` : ''}${l.running ? ' – läuft gerade' : ''}`;

export function chatContext(st, now = new Date()) {
    if (!st.subjects.length && !st.exams.length && !st.assignments.length) return '';
    const name = (id) => subjectOf(st, id)?.name || '?'; const today = isoDate(now);
    const lines = ['## LERN-STUDIO DES NUTZERS (aktueller Stand, nutze das für Lernpläne und Hilfe)'];
    lines.push('Fächer: ' + st.subjects.map(s => { const g = gradeAverage(s.grades); const open = s.topics.filter(t => !t.done).length; return `${s.name}${g ? ` (Ø Note ${String(g).replace('.', ',')})` : ''}${open ? `, ${open} offene Themen` : ''}`; }).join('; '));
    const tt = DAYS.filter(d => (st.timetable[d] || []).length).map(d => `${DAY_SHORT[d]}: ${(st.timetable[d] || []).map(l => `${l.start}–${l.end} ${l.name}${l.free ? ' (frei wählbar)' : ''}${l.group ? ` ${l.group}` : ''}${l.teacher ? ` bei ${l.teacher}` : ''}`).join(', ')}`);
    if (tt.length) lines.push('Stundenplan: ' + tt.join(' | '));
    if (DAYS.some(d => (st.timetable[d] || []).some(l => l.free))) lines.push('Freiarbeit = Schulstunde, in der der Nutzer an dem arbeitet, was er will (Aufträge, Lernen für Arbeiten). Schlag konkret vor, was er in seiner nächsten Freiarbeit machen sollte, und nutze Freiarbeit auch für Lernpläne.');
    lines.push(`Lernzeiten: ${st.prefs.learnStart}–${st.prefs.learnEnd}, max. ${st.prefs.maxPerDay} min/Tag, Einheiten à ${st.prefs.sessionMin} min, frei: ${(st.prefs.freeDays || []).map(d => DAY_SHORT[d]).join(', ') || '–'}.`);
    const exams = st.exams.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
    if (exams.length) lines.push('Anstehende Arbeiten: ' + exams.map(e => `${fmtDate(e.date)} ${name(e.subjectId)} – ${e.title || 'Arbeit'}${(e.topics || []).length ? ` (Themen: ${e.topics.join(', ')})` : ''}`).join('; '));
    const open = st.assignments.filter(a => a.status !== 'abgegeben').sort((a, b) => String(a.due || '9').localeCompare(String(b.due || '9'))).slice(0, 10);
    if (open.length) lines.push('Offene Aufträge: ' + open.map(a => `${name(a.subjectId)}: ${a.title}${a.due ? ` (fällig ${fmtDate(a.due)})` : ''} [${STATUS[a.status] || 'Offen'}]`).join('; '));
    const soon = st.plan.filter(p => !p.done && p.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 8);
    if (soon.length) lines.push('Geplante Lerneinheiten: ' + soon.map(p => `${fmtDate(p.date)} ${p.start} ${p.min} min ${subjectOf(st, p.subjectId)?.name || p.subjectName || ''}: ${p.title}`).join('; '));
    const today2 = (st.timetable[dayKey(now)] || []); if (today2.length) {
        const end = schoolEnd(st, dayKey(now)); const over = end != null && now.getHours() * 60 + now.getMinutes() >= end;
        lines.push(`Heute (${DAY_LABEL[dayKey(now)]}) Schule bis ${fromMin(end)}${over ? ' – für heute ist die Schule schon vorbei' : ''}.`);
    }
    // Was als Nächstes kommt, ab der aktuellen Uhrzeit gerechnet (diese Angaben haben Vorrang vor eigenen Rechnungen)
    const clock = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const nxt = nextLessons(st, now, { count: 3 }); const nf = nextLessons(st, now, { count: 1, free: true });
    if (nxt.length) lines.push(`Jetzt ist ${DAY_LABEL[dayKey(now)]}, ${clock} Uhr. Nächste Schulstunden ab jetzt: ${nxt.map(lessonText).join('; ')}.`);
    if (nf.length) lines.push(`Nächste Freiarbeit ab jetzt: ${lessonText(nf[0])}.`);
    lines.push(`Wenn der Nutzer einen Lernplan will: plane in seinen freien Zeiten (nach Schulschluss + Pause, innerhalb der Lernzeiten, nicht an freien Tagen), verteilt bis zur Arbeit, zur Arbeit hin dichter, letzte Einheit = Generalprobe am Vortag. Gib ihn als Block aus, den er mit einem Klick ins Lern-Studio übernehmen kann:
<lernplan title="Mathe-Arbeit 12.12.">
2026-12-01 16:00 | 30 | Mathe | Scheitelform üben
2026-12-03 16:30 | 45 | Mathe | pq-Formel + Aufgaben S. 54
</lernplan>
(je Zeile: Datum Uhrzeit | Minuten | Fach | was genau). Heute ist ${today}.`);
    return lines.join('\n');
}

// ---------- Notizbuch-Index & <notebook_read> für Coden-Chats ----------
const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));
export function expandPageSpec(spec, maxPage = 1) {
    const cap = Math.max(1, Number(maxPage) || 1);
    const s = String(spec || '').trim();
    if (!s) return [1];
    const out = [];
    for (const part of s.split(/[\s,;]+/)) {
        if (!part) continue;
        const m = part.match(/^(\d{1,4})\s*[-–..]+\s*(\d{1,4})$/);
        if (m) {
            let a = clampInt(+m[1], 1, cap), b = clampInt(+m[2], 1, cap);
            if (a > b) [a, b] = [b, a];
            for (let p = a; p <= b && out.length < 3; p++) if (!out.includes(p)) out.push(p);
        } else if (/^\d{1,4}$/.test(part)) {
            const p = clampInt(+part, 1, cap);
            if (!out.includes(p) && out.length < 3) out.push(p);
        }
        if (out.length >= 3) break;
    }
    return out.length ? out : [1];
}

export function notebooksPrompt(st, { currentDocId = null, currentPage = null } = {}) {
    const docs = Array.isArray(st?.docs) ? st.docs : [];
    if (!docs.length) return '';
    const sorted = sortDocs(docs, 'bearbeitet').slice(0, 40);
    const assignById = new Map((st.assignments || []).map(a => [a.id, a]));
    const lines = ['## NOTIZBÜCHER DES NUTZERS (Coden Heft – direkter Zugriff für dich)'];
    lines.push('Der Nutzer besitzt folgende Notizbücher. Wenn der Nutzer ein Notizbuch, Mitschriften, Aufgaben, Zeichnungen, Arbeitsblätter oder Rechnungen daraus erwähnt – oder wenn du nachsehen musst, was auf einer Seite steht – lies dir die passende Seite direkt mit `<notebook_read .../>` an statt zu raten:');
    for (const d of sorted) {
        const su = subjectOf(st, d.subjectId)?.name || '';
        const fp = folderPath(st, d.folderId).map(f => f.name).join('/');
        const as = d.assignmentId ? assignById.get(d.assignmentId) : null;
        const nPages = (d.pages || []).length || 1;
        const bms = (d.bookmarks || []).map(bid => (d.pages || []).indexOf(bid) + 1).filter(n => n > 0).sort((a, b) => a - b);
        const upd = d.updatedAt ? String(d.updatedAt).slice(0, 10) : '';
        const meta = [
            fp ? `Ordner: ${fp}` : null,
            su ? `Fach: ${su}` : null,
            as ? `Auftrag: ${as.title}` : null,
            `${nPages} Seite${nPages === 1 ? '' : 'n'}`,
            bms.length ? `Lesezeichen: S. ${bms.slice(0, 6).join(', ')}` : null,
            upd ? `Stand: ${upd}` : null,
            d.id === currentDocId ? `AKTUELL GEÖFFNET${currentPage ? ` (Seite ${currentPage})` : ''}` : null
        ].filter(Boolean).join(' · ');
        lines.push(`- [${d.id}] "${d.title || 'Unbenanntes Notizbuch'}" (${meta})`);
    }
    if (docs.length > sorted.length) lines.push(`(… und ${docs.length - sorted.length} weitere Notizbücher)`);
    lines.push(`So siehst du dir Seiten aus einem Notizbuch an (du bekommst das fertige Seitenbild inkl. Handschrift, Arbeitsblatt-Hintergrund, getipptem Text und Korrekturen):
- Eine Seite: <notebook_read id="NOTIZBUCH_ID" page="1"/>
- Mehrere Seiten (höchstens 3 pro Aufruf): <notebook_read id="NOTIZBUCH_ID" pages="1-3"/>
Schreibe das Tag direkt ohne Codeblock darum. Sobald du die Seiten erhalten hast, beantworte die Frage präzise anhand des Gesehenen.`);
    return lines.join('\n');
}

const NB_READ_RE = /<notebook_read\b([^>]*?)\/?>/gi;
const NB_ATTR_RE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
export function parseNotebookReads(raw, { allowUnclosed = false } = {}) {
    const s = String(raw || '');
    const out = [];
    const parseAttrs = (rawAttrs) => {
        const attrs = {};
        let m; NB_ATTR_RE.lastIndex = 0;
        while ((m = NB_ATTR_RE.exec(rawAttrs))) attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
        const ref = attrs.id || attrs.doc || attrs.title || '';
        const pageSpec = attrs.pages || attrs.page || '1';
        if (ref) out.push({ ref, pageSpec });
    };
    let m; NB_READ_RE.lastIndex = 0;
    while ((m = NB_READ_RE.exec(s))) parseAttrs(m[1]);
    if (!out.length && allowUnclosed) {
        const tail = s.match(/<notebook_read\b([^>]*)$/i);
        if (tail) parseAttrs(tail[1]);
    }
    return out;
}

export function hideNotebookTags(raw) {
    return String(raw || '')
        .replace(/<notebook_read\b[^>]*\/?>/gi, '')
        .replace(/<\/notebook_read>/gi, '')
        .replace(/<notebook_read\b[^>]*$/i, '');
}

// ---------- Prompts ----------
export const TIMETABLE_PROMPT = `Lies den Stundenplan auf dem Bild VOLLSTÄNDIG aus – jede einzelne Karte/Zelle, nichts weglassen. Das kann ein gedruckter Plan, eine Tabelle oder eine Steckwand mit Kärtchen sein.
So gehst du vor: Spalte für Spalte (Tag für Tag), in jeder Spalte von oben nach unten, jede Karte einzeln. Weiße/leere-wirkende Karten, kleine Karten und Karten mit Handschrift zählen genauso.
WICHTIG:
- "Freiarbeit" (auch Lernbüro, Lernzeit, EVA, Selbstlernzeit) ist eine echte Stunde → immer aufnehmen mit "free":true. Nur echte Pausen und leere Lücken weglassen.
- "Klassenrat", AGs usw. auch aufnehmen.
- Pro Karte: Fach (ausgeschrieben, z. B. "Gesellschaftslehre/Ethik" für GW/Ethik, "Hauswirtschaft und Technik" für HWT), Lehrkraft (Name auf der Karte, z. B. "Matthias", mehrere mit "/"), Kurs/Gruppe (z. B. "Diff 1", "9/10C", "NW HS"), Raum (z. B. "Kunstraum").
- Uhrzeiten: Stehen Zeiten am Plan, nimm sie ("start"/"end" als HH:MM). Stehen nur Stundennummern da: 1.=08:00–08:45, 2.=08:50–09:35, 3.=09:55–10:40, 4.=10:45–11:30, 5.=11:50–12:35, 6.=12:40–13:25, 7.=13:45–14:30, 8.=14:35–15:20.
- Stehen KEINE Zeiten da, aber Pausen (z. B. "10:00–10:30 Pause"): trage die Pausen in "breaks" ein, setze "dayStart" (Schulbeginn, sonst "08:00") und gib jeder Karte "block": 1 = vor der 1. Pause, 2 = zwischen 1. und 2. Pause usw. – richte dich nach der Höhe der Karte auf der Wand im Vergleich zu den Pausen-Markierungen und den anderen Tagen. Lass dann start/end weg. Ist eine Karte deutlich kleiner (z. B. Klassenrat), gib "size":0.5.
- Termine, die zusätzlich auf dem Plan stehen (Arbeiten, Tests, LSÜ, Abgaben mit Datum): in "events". Leere Zeilen ohne Datum weglassen.
Antworte NUR mit JSON in diesem Format:
{"dayStart":"08:00","breaks":[{"start":"10:00","end":"10:30"}],
 "days":{"mo":[{"subject":"Klassenrat","block":1,"size":0.5},{"subject":"Freiarbeit","free":true,"teacher":"Sophie","block":1},{"subject":"Französisch","group":"Diff 2","teacher":"Sophie/Kerstin","block":1}],"di":[],"mi":[],"do":[],"fr":[]},
 "events":[{"type":"test","subject":"Deutsch","title":"LSÜ","date":"07.12."},{"type":"abgabe","subject":"Gesellschaftslehre","title":"Abgabe","date":"17.12."}],
 "counts":{"mo":8,"di":6,"mi":7,"do":7,"fr":2}}
"counts" = Anzahl der Karten/Stunden je Tag, die du auf dem Bild zählst (inkl. Freiarbeit).`;

export function timetableCheckPrompt(first) {
    return `Hier ist dein erstes Ergebnis zum Stundenplan auf dem Bild:
${JSON.stringify(first).slice(0, 6000)}
Prüfe es jetzt Karte für Karte gegen das Bild: Spalte für Spalte, von oben nach unten. Fehlt eine Karte (besonders Freiarbeit, weiße Karten, kleine Karten wie Klassenrat, die letzte Karte unten), steht etwas am falschen Tag, im falschen Block oder in falscher Reihenfolge, fehlen Lehrkraft/Kurs/Raum oder ein Termin? Korrigiere alles.
Antworte NUR mit dem vollständigen, korrigierten JSON im selben Format.`;
}
// Wie viele Stunden hat die Antwort? (zum Vergleichen der beiden Durchgänge)
export const lessonCount = (raw) => { const d = raw?.days || raw || {}; return Object.values(d).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0); };

export function correctionPrompt({ subject = '', task = '', level = '' } = {}) {
    return `Du bist eine erfahrene, freundliche Lehrkraft${subject ? ` für ${subject}` : ''} und korrigierst die handschriftliche Heftseite eines Schülers auf dem Bild${level ? ` (${level})` : ''}.
${task ? `AUFGABE/AUFTRAG:\n${task.slice(0, 3000)}\n` : ''}Lies alles genau (auch Rechnungen Schritt für Schritt), prüfe Inhalt, Rechenweg, Fachbegriffe, Rechtschreibung. Sei ehrlich, aber ermutigend – wie ein guter Lehrer: konkret sagen, was falsch ist und wie es richtig geht.
Antworte NUR mit JSON:
{"grade":"2-","points":"8/10","score":78,"summary":"2–4 Sätze Gesamturteil","tips":["konkreter Lerntipp"],"items":[{"y":0.18,"ok":true,"text":"Ansatz richtig"},{"y":0.42,"ok":false,"text":"Vorzeichenfehler in Zeile 3","fix":"-(x-2)² = -x² + 4x - 4"}]}
"y" = senkrechte Position der Stelle auf der Seite (0 = oben, 1 = unten), "score" 0–100, "grade" als Schulnote (1–6 mit +/-). 3–12 items, auch Gelungenes (ok:true). Ist die Seite leer oder unlesbar, sag das in summary und gib score 0.`;
}
export function parseCorrection(text) {
    const s = String(text || ''); const i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    try { const c = JSON.parse(s.slice(i, j + 1)); if (!c || typeof c !== 'object') return null; return { grade: str(c.grade, 12), points: str(c.points, 20), score: Math.max(0, Math.min(100, Math.round(+c.score || 0))), summary: str(c.summary, 1500), tips: (c.tips || []).slice(0, 6).map(t => str(t, 240)), items: (c.items || []).slice(0, 30).map(x => ({ y: Math.max(0, Math.min(1, +x.y || 0)), ok: !!x.ok, text: str(x.text, 300), fix: str(x.fix, 400) })), at: new Date().toISOString() }; } catch (_) { return null; }
}
export function planWhatPrompt({ subject, exam, topics, sessions }) {
    return `Du planst Lerneinheiten für eine ${exam || 'Arbeit'} in ${subject}. Themen: ${topics.join(', ') || 'alles aus dem Unterricht'}.
Es gibt ${sessions.length} Einheiten: ${sessions.map((s, i) => `${i + 1}) ${s.date} ${s.min} min – ${s.title}`).join('; ')}.
Schreibe für JEDE Einheit eine konkrete Aufgabe (max. 15 Wörter, aktiv: üben, erklären, Karteikarten, Probeaufgaben, Fehler nacharbeiten). Antworte NUR mit JSON: ["…","…"] in derselben Reihenfolge.`;
}
