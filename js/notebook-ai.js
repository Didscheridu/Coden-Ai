// js/notebook-ai.js – Notizbuch-Seiten für Coden-Chats auslesen & als Bild + Text-Kontext aufbereiten.
import { StudyStore } from './study-store.js';
import { subjectOf, folderPath, expandPageSpec } from './study-core.js';
import { decodeStrokes } from './ink-core.js';

export function findNotebookDoc(st, ref) {
    const docs = Array.isArray(st?.docs) ? st.docs : [];
    const q = String(ref || '').trim();
    if (!q) return null;
    const byId = docs.find(d => d.id === q);
    if (byId) return byId;
    const low = q.toLowerCase();
    return docs.find(d => String(d.title || '').trim().toLowerCase() === low)
        || docs.find(d => String(d.title || '').toLowerCase().includes(low))
        || null;
}

export function describePageData(pg, { doc, pageNum, totalPages } = {}) {
    const strokes = Array.isArray(pg?.strokes) ? pg.strokes : decodeStrokes(pg?.strokes);
    const textBoxes = Array.isArray(pg?.text) ? pg.text : [];
    const items = Array.isArray(pg?.items) ? pg.items : [];
    const pageId = doc?.pages?.[pageNum - 1];
    const marked = pageId && (doc?.bookmarks || []).includes(pageId);
    const lines = [`Seite ${pageNum} von ${totalPages || 1}${marked ? ' (Lesezeichen)' : ''} · Vorlage: ${pg?.paper || doc?.paper || 'liniert'}`];
    const stats = [];
    if (pg?.bg) stats.push('Arbeitsblatt/Foto im Hintergrund');
    if (strokes.length) stats.push(`${strokes.length} Handschrift-Strich${strokes.length === 1 ? '' : 'e'}`);
    if (items.length) stats.push(`${items.length} eingefügte${items.length === 1 ? 's Bild' : ' Bilder'}`);
    if (textBoxes.length) stats.push(`${textBoxes.length} Textfeld${textBoxes.length === 1 ? '' : 'er'}`);
    lines.push(stats.length ? `Inhalt: ${stats.join(', ')}` : 'Inhalt: Seite ist noch leer');
    const typed = textBoxes.map(t => String(t.s || '').trim()).filter(Boolean).join('\n---\n');
    if (typed) lines.push(`Getippter Text auf der Seite:\n${typed.slice(0, 3000)}`);
    const c = pg?.correction;
    if (c) {
        const meta = [c.grade ? `Note ${c.grade}` : '', c.points || '', c.score != null ? `${c.score} %` : ''].filter(Boolean).join(', ');
        lines.push(`Vorhandene Coden-Korrektur${meta ? ` (${meta})` : ''}: ${c.summary || ''}`);
        if (Array.isArray(c.items) && c.items.length) {
            lines.push(...c.items.slice(0, 10).map(it => `  ${it.ok ? '✓' : '✗'} ${it.text}${it.fix ? ` → Richtig: ${it.fix}` : ''}`));
        }
    }
    return {
        text: lines.join('\n'),
        hasVisual: !!(pg?.bg || strokes.length || items.length || c)
    };
}

export async function renderValidPageImage(pgData, pageImage) {
    if (!pgData || typeof pageImage !== 'function') return null;
    const inspect = (url) => {
        const fn = typeof window !== 'undefined' ? window.CodenUpload?.inspectImageDataUrl : null;
        return typeof fn === 'function' ? fn(url).ok : /^data:image\/jpeg;base64,/.test(String(url || ''));
    };
    for (const opts of [
        { width: 1050, quality: 0.78, type: 'image/jpeg', correction: true },
        { width: 760, quality: 0.62, type: 'image/jpeg', correction: true }
    ]) {
        try {
            const img = await pageImage(pgData, opts);
            if (img && inspect(img)) return img;
        } catch (_) {}
    }
    return null;
}

export async function captureLivePageSnapshot({ doc, pageIndex, pages, ensureData, pageImage }) {
    const pg = pages?.[pageIndex];
    if (!doc || !pg) return null;
    const data = await ensureData(pg);
    const info = describePageData(data, { doc, pageNum: pageIndex + 1, totalPages: pages.length });
    const image = info.hasVisual ? await renderValidPageImage(data, pageImage) : null;
    return { ...info, image, pageNum: pageIndex + 1 };
}

export async function readNotebookRequests(reqs, { loadPage, pageImage, liveDoc = null, livePages = null, ensureLiveData = null } = {}) {
    const st = StudyStore.get();
    const list = Array.isArray(reqs) ? reqs : [];
    const seen = new Set();
    const images = [];
    const detailLines = [];
    const promptBlocks = [];
    const docTitles = [];
    const errors = [];

    for (const req of list) {
        if (images.length >= 3) break;
        const doc = findNotebookDoc(st, req.ref);
        if (!doc) {
            errors.push(`Notizbuch „${req.ref}“ wurde nicht gefunden.`);
            continue;
        }
        if (!docTitles.includes(doc.title)) docTitles.push(doc.title || 'Notizbuch');
        const totalPages = Math.max(1, (doc.pages || []).length);
        const pageNums = expandPageSpec(req.pageSpec, totalPages);
        const su = subjectOf(st, doc.subjectId)?.name || '';
        const fp = folderPath(st, doc.folderId).map(f => f.name).join('/');
        const as = doc.assignmentId ? (st.assignments || []).find(a => a.id === doc.assignmentId) : null;
        const header = `[Notizbuch „${doc.title || 'Notizbuch'}“${su ? ` · Fach: ${su}` : ''}${fp ? ` · Ordner: ${fp}` : ''}${as ? ` · Auftrag: ${as.title}` : ''}]`;

        for (const pNum of pageNums) {
            if (images.length >= 3) break;
            const key = `${doc.id}:${pNum}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const pageId = (doc.pages || [])[pNum - 1];
            let pgData = null;
            try {
                if (liveDoc && liveDoc.id === doc.id && livePages?.[pNum - 1] && typeof ensureLiveData === 'function') {
                    pgData = await ensureLiveData(livePages[pNum - 1]);
                } else if (pageId && typeof loadPage === 'function') {
                    pgData = await loadPage(pageId);
                }
            } catch (e) {
                errors.push(`${doc.title} S. ${pNum}: ${e.message || 'konnte nicht geladen werden'}`);
                continue;
            }
            if (!pgData) {
                pgData = { paper: doc.paper || 'liniert', strokes: '[]', text: [], items: [], bg: null };
            }

            const info = describePageData(pgData, { doc, pageNum: pNum, totalPages });
            const img = await renderValidPageImage(pgData, pageImage);
            if (img) images.push(img);

            detailLines.push(`${doc.title} · Seite ${pNum}/${totalPages}${img ? ' (Bild geladen)' : ''}`);
            promptBlocks.push(`${header}\n${info.text}${img ? `\n(Siehe beigefügtes Bild #${images.length} dieser Antwort.)` : ''}`);
        }
    }

    if (!promptBlocks.length) {
        const msg = errors.join(' ') || 'Keine passenden Notizbuch-Seiten gefunden.';
        return {
            srcLabel: list.map(r => r.ref).join(', ') || 'Notizbuch',
            noteLabel: 'nicht gefunden',
            detailsText: msg,
            modelPrompt: `Notizbuch-Abruf fehlgeschlagen: ${msg} Sag dem Nutzer kurz, welches Notizbuch oder welche Seite fehlt.`,
            images: [],
            err: true
        };
    }

    return {
        srcLabel: docTitles.join(', '),
        noteLabel: `${promptBlocks.length} Seite${promptBlocks.length === 1 ? '' : 'n'}`,
        detailsText: [...detailLines, ...errors].join('\n'),
        modelPrompt: `Hier sind die angeforderten Notizbuch-Seiten des Nutzers (Handschrift, getippter Text, Arbeitsblätter und Korrekturen sind als Text und Bild enthalten). Nutze diesen Inhalt direkt für deine Antwort:\n\n${promptBlocks.join('\n\n')}`,
        images,
        err: false
    };
}
