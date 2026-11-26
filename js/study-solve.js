// js/study-solve.js – „Coden lösen lassen“ im Lern-Studio: Coden liest das Arbeitsblatt, löst alle Aufgaben und
// schreibt die Lösung in der Handschrift des Nutzers ins Heft: kurze Antworten direkt in die Felder des Blatts,
// Rechenwege und längere Texte auf Karo-Seiten dahinter. Alles von Coden Geschriebene ist markiert (o: 'coden')
// und lässt sich mit „Coden-Lösung entfernen“ wieder herausnehmen.
import { apiJson } from './backend.js';
import { StudyStore } from './study-store.js';
import * as S from './study-core.js';
import { loadPage, savePage, newPageId, decodeStrokes, encodeStrokes, PAGE_W, PAGE_H } from './ink.js';
import { activeProfile } from './handwriting-core.js';
import { strokesInBox, notebookPagesFor } from './handwriting.js';
import { solvePrompt, parseSolve, boxToPage, extraPagesText } from './study-solve-core.js';

const imgSize = (src) => new Promise((res) => {
    const i = new Image();
    i.onload = () => res({ w: i.naturalWidth || 1000, h: i.naturalHeight || 1414 });
    i.onerror = () => res(null);
    i.src = src;
});

export async function solveAssignment(st, a, { ensureDoc, onStep = () => {} } = {}) {
    let doc = st.docs.find(d => d.assignmentId === a.id);
    if (!doc) { doc = await ensureDoc(st, { title: a.title, subjectId: a.subjectId, assignmentId: a.id }); StudyStore.save(st); }
    if (a.coden) await removeCodenSolution(st, a, { quiet: true }); // alte Coden-Lösung zuerst raus

    onStep('Coden liest das Blatt …');
    const pages = await Promise.all((doc.pages || []).map(async (id) => ({ id, p: await loadPage(id).catch(() => null) })));
    const sheets = pages.filter(x => x.p?.bg).slice(0, 3);
    if (!sheets.length && !String(a.desc || '').trim()) throw new Error('Kein Arbeitsblatt und keine Aufgabenstellung. Lade ein Foto hoch oder trag die Aufgabe ein.');

    const { system, user } = solvePrompt({ subject: S.subjectOf(st, a.subjectId)?.name || '', title: a.title, desc: a.desc, pages: sheets.length, today: S.isoDate(new Date()) });
    const r = await apiJson('/chat', {
        method: 'POST',
        body: JSON.stringify({ tier: sheets.length ? 'flash' : 'normal', messages: [{ role: 'system', content: system }, { role: 'user', content: user, ...(sheets.length ? { images: sheets.map(x => x.p.bg) } : {}) }] })
    });
    const items = parseSolve(r.content, sheets.length);
    if (!items?.length) throw new Error('Coden konnte die Aufgaben nicht lesen. Versuch es noch einmal.');

    onStep('Schreibt in deiner Handschrift …');
    const prof = activeProfile(StudyStore.handwriting());
    const changed = new Map(); // Seiten-ID → neue Striche
    const sizes = new Map();
    let i = 0;
    for (const it of items) {
        i++;
        if (!it.box || !it.answer) continue;
        const sh = sheets[it.page];
        if (!sh) continue;
        if (!sizes.has(sh.id)) sizes.set(sh.id, await imgSize(sh.p.bg));
        const size = sizes.get(sh.id);
        if (!size) continue;
        const strokes = strokesInBox(it.answer, prof, boxToPage(it.box, size.w, size.h, PAGE_W, PAGE_H), { seed: 3 + i });
        if (!strokes) continue;
        it.placed = true;
        if (!changed.has(sh.id)) changed.set(sh.id, []);
        changed.get(sh.id).push(...strokes);
    }
    for (const sh of sheets) {
        const add = changed.get(sh.id);
        if (!add?.length) continue;
        await savePage({ ...sh.p, id: sh.id, strokes: encodeStrokes([...decodeStrokes(sh.p.strokes), ...add]) });
    }

    // Was nicht aufs Blatt passt + Rechenwege → Karo-Seiten hinten im Heft
    const extraIds = [];
    const extra = extraPagesText(items, { title: sheets.length ? 'Lösungen' : a.title });
    if (extra) {
        const { pages: inkPages, paper } = notebookPagesFor(extra, prof, { paper: 'karo', origin: 'coden' });
        for (const strokes of inkPages) {
            const id = newPageId();
            await savePage({ id, doc: doc.id, idx: doc.pages.length, paper, strokes: encodeStrokes(strokes), text: [], items: [] }, { withBg: true });
            doc.pages.push(id); extraIds.push(id);
        }
    }
    a.coden = { at: new Date().toISOString(), pages: extraIds, placed: items.filter(x => x.placed).length, total: items.length };
    if (a.status === 'offen') a.status = 'arbeit';
    StudyStore.save(st);
    return { doc, placed: a.coden.placed, total: items.length, extraPages: extraIds.length };
}

// Alles wieder herausnehmen, was Coden geschrieben hat (eigene Striche bleiben)
export async function removeCodenSolution(st, a) {
    const doc = st.docs.find(d => d.assignmentId === a.id);
    if (doc) {
        const extra = new Set(a.coden?.pages || []);
        for (const id of [...(doc.pages || [])]) {
            if (extra.has(id)) {
                const p = await loadPage(id).catch(() => null);
                const own = p ? decodeStrokes(p.strokes).filter(s => s.o !== 'coden') : [];
                if (!own.length && !(p?.text || []).length && !(p?.items || []).length) {
                    await apiJson('/study/pages/' + id, { method: 'DELETE' }).catch(() => {});
                    doc.pages = doc.pages.filter(x => x !== id);
                    continue;
                }
            }
            const p = await loadPage(id).catch(() => null);
            if (!p) continue;
            const all = decodeStrokes(p.strokes);
            const keep = all.filter(s => s.o !== 'coden');
            if (keep.length !== all.length) await savePage({ ...p, id, strokes: encodeStrokes(keep) });
        }
    }
    delete a.coden;
    StudyStore.save(st);
}
