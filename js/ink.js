// js/ink.js – Coden Heft: handschriftlich arbeiten wie in GoodNotes.
// Durchgehend scrollbare Seiten, Seitenleiste mit Vorschauen und Lesezeichen, Stifte (Füller, Kugelschreiber, Pinsel) mit Druck
// (Apple Pencil), Handballen-Erkennung, Textmarker, Radierer (ganzer Strich oder teilweise), Lasso (verschieben, skalieren, Farbe,
// kopieren, duplizieren, löschen, Handschrift → Text mit Coden), Formen (zeichnen und halten), Text, Bilder, Laserpointer,
// Zwei-Finger-Zoom, Vorlagen (liniert, karo, punkte, Cornell, Notenlinien …), Arbeitsblätter als Hintergrund (Foto/PDF),
// "Coden prüfen" (Korrektur wie ein Lehrer), Export als PDF, bei Aufträgen danach abgeben.
import { apiJson } from './backend.js';
import { streamAiResponse } from './api.js';
import { ownTiers, byokEffort, isByokTier } from './byok.js';
import { loader } from './rich-elements.js';
import { renderRichBlock } from './ui.js';
import { buildChatPrompt } from './system-prompt.js';
import { StudyStore } from './study-store.js';
import { correctionPrompt, parseCorrection, fmtDate, parseNotebookReads, hideNotebookTags, parseNotebookWrites, stripNotebookWriteTags } from './study-core.js';
import { activeProfile, handwritingRequested } from './handwriting-core.js';
import { captureLivePageSnapshot, readNotebookRequests } from './notebook-ai.js';
import { startStudyLive, stopLive, liveActive, sendLiveImage, sendLiveNote } from './study-live.js';
import { buildPdfBlob, downloadPdfBlob, safePdfFilename } from './pdf-export.js';
import { FORMULA_SUBJECTS, filterFormulas, UNIT_CATEGORIES, convertUnit, evaluateMathExpr } from './formula-helper.js';
import { PAGE_W, PAGE_H, TEMPLATES, PEN_TYPES, encodeStrokes, decodeStrokes, widthAt, recognizeShape, eraseFrom, eraseWhole, lassoSelect, selectionBox, transformSelection, strokeOutline, rotateSelection, isPalm, stageMetrics } from './ink-core.js';
export { PAGE_W, PAGE_H, encodeStrokes, decodeStrokes } from './ink-core.js';

const PEN_COLORS = ['#1b1f2a', '#1d4ed8', '#c62828', '#2e7d32', '#7c3aed', '#ea580c'];
const HL_COLORS = ['#ffe94d', '#a8f0b8', '#a9dcff', '#ffb3c9', '#ffc98a'];
const WIDTHS = { pen: [1.8, 2.9, 4.6], hl: [14, 22, 32], eraser: [8, 18, 40], shape: [1.8, 2.9, 4.6] };

// ---------- kleine Helfer ----------
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const icon = (n) => el('span', 'material-symbols-outlined', n);
const btn = (ic, label, fn, cls = '') => { const b = el('button', 'ink-btn ' + cls); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); if (ic) b.append(icon(ic)); if (cls.includes('labeled')) b.append(el('span', 'ink-l', label)); b.addEventListener('click', fn); return b; };
export const newPageId = () => 'pg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = (pg) => ({ strokes: pg.strokes.slice(), text: pg.text.map(t => ({ ...t })), items: pg.items.map(i => ({ ...i })) });

// ---------- lokaler Zwischenspeicher (IndexedDB) – schnell und offline ----------
const idb = (() => {
    let dbp = null;
    const open = () => (dbp ||= new Promise((res, rej) => { const r = indexedDB.open('coden-heft', 1); r.onupgradeneeded = () => r.result.createObjectStore('pages'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const run = (mode, fn) => open().then(db => new Promise((res, rej) => { const tx = db.transaction('pages', mode); const st = tx.objectStore('pages'); const q = fn(st); tx.oncomplete = () => res(q?.result); tx.onerror = () => rej(tx.error); }));
    return { get: (k) => run('readonly', s => s.get(k)).catch(() => null), put: (k, v) => run('readwrite', s => s.put(v, k)).catch(() => null) };
})();

// ---------- Papier & Zeichnen ----------
export function drawPaper(ctx, paper, k) {
    ctx.fillStyle = '#fffefb'; ctx.fillRect(0, 0, PAGE_W * k, PAGE_H * k);
    const line = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0 * k, y0 * k); ctx.lineTo(x1 * k, y1 * k); ctx.stroke(); };
    ctx.lineWidth = Math.max(1, k);
    if (paper === 'liniert' || paper === 'eng') {
        const gap = paper === 'eng' ? 28 : 36; ctx.strokeStyle = '#c9d6ea';
        for (let y = 120; y < PAGE_H - 40; y += gap) line(0, y, PAGE_W, y);
        ctx.strokeStyle = '#eaa3a3'; line(92, 0, 92, PAGE_H);
    } else if (paper === 'karo') {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PAGE_W * k, PAGE_H * k); // GoodNotes: weißes Blatt, hellgraues Karo
        ctx.strokeStyle = '#d3d5d6'; ctx.lineWidth = Math.max(0.7, k * 0.8);
        for (let x = 25; x < PAGE_W; x += 25) line(x, 0, x, PAGE_H);
        for (let y = 25; y < PAGE_H; y += 25) line(0, y, PAGE_W, y);
    } else if (paper === 'punkte') {
        ctx.fillStyle = '#b8c4d8';
        for (let x = 25; x < PAGE_W; x += 25) for (let y = 25; y < PAGE_H; y += 25) { ctx.beginPath(); ctx.arc(x * k, y * k, 1.3 * k, 0, 7); ctx.fill(); }
    } else if (paper === 'cornell') {
        ctx.strokeStyle = '#d3dceb'; for (let y = 150; y < PAGE_H - 300; y += 34) line(0, y, PAGE_W, y);
        ctx.strokeStyle = '#9fb1cf'; ctx.lineWidth = Math.max(1.5, 2 * k); line(0, 110, PAGE_W, 110); line(270, 110, 270, PAGE_H - 280); line(0, PAGE_H - 280, PAGE_W, PAGE_H - 280);
        ctx.fillStyle = '#9fb1cf'; ctx.font = `600 ${18 * k}px system-ui, sans-serif`; ctx.fillText('Stichworte / Fragen', 24 * k, 140 * k); ctx.fillText('Notizen', 296 * k, 140 * k); ctx.fillText('Zusammenfassung', 24 * k, (PAGE_H - 250) * k);
    } else if (paper === 'noten') {
        ctx.strokeStyle = '#b9c3d3';
        for (let y = 140; y < PAGE_H - 120; y += 120) for (let i = 0; i < 5; i++) line(60, y + i * 12, PAGE_W - 60, y + i * 12);
    }
}
function drawBg(ctx, img, k) {
    if (!img) return;
    const s = Math.min(PAGE_W / img.width, PAGE_H / img.height); const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, (PAGE_W - w) / 2 * k, 0, w * k, h * k);
}
// Umrisse merken: Striche ändern sich nie (neue Objekte beim Bearbeiten), also einmal rechnen, immer wieder füllen
const outlines = new WeakMap();
function fillOutline(ctx, o, k) {
    ctx.beginPath(); const n = o.length;
    ctx.moveTo((o[0][0] + o[1][0]) / 2 * k, (o[0][1] + o[1][1]) / 2 * k);
    for (let i = 1; i <= n; i++) { const a = o[i % n], b = o[(i + 1) % n]; ctx.quadraticCurveTo(a[0] * k, a[1] * k, (a[0] + b[0]) / 2 * k, (a[1] + b[1]) / 2 * k); }
    ctx.closePath(); ctx.fill();
}
export function drawStroke(ctx, s, k, { live = false } = {}) {
    const p = s.p; if (p.length < 3) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = s.c; ctx.fillStyle = s.c;
    if (s.t === 'hl') {
        ctx.globalAlpha = 0.42; ctx.globalCompositeOperation = 'multiply'; ctx.lineCap = 'butt';
        ctx.lineWidth = widthAt(s, 0.5) * k;
        ctx.beginPath(); ctx.moveTo(p[0] * k, p[1] * k);
        if (p.length === 3) ctx.lineTo(p[0] * k + 0.1, p[1] * k);
        for (let i = 3; i < p.length; i += 3) { const mx = (p[i - 3] + p[i]) / 2, my = (p[i - 2] + p[i + 1]) / 2; ctx.quadraticCurveTo(p[i - 3] * k, p[i - 2] * k, mx * k, my * k); }
        ctx.lineTo(p[p.length - 3] * k, p[p.length - 2] * k); ctx.stroke(); ctx.restore(); return;
    }
    let o = live ? null : outlines.get(s);
    if (!o) { o = strokeOutline(s); if (!live) outlines.set(s, o); }
    fillOutline(ctx, o, k);
    ctx.restore();
}
function drawText(ctx, t, k) { ctx.save(); ctx.fillStyle = t.c || '#1b1f2a'; ctx.font = `${t.z * k}px "Plus Jakarta Sans", system-ui, sans-serif`; ctx.textBaseline = 'top'; String(t.s).split('\n').forEach((l, i) => ctx.fillText(l, t.x * k, (t.y + i * t.z * 1.35) * k)); ctx.restore(); }
function drawCorrection(ctx, c, k) {
    if (!c) return;
    ctx.save(); ctx.font = `700 ${34 * k}px Caveat, Kalam, cursive`; ctx.textBaseline = 'middle';
    for (const it of c.items || []) { const y = 60 + it.y * (PAGE_H - 120); ctx.fillStyle = it.ok ? '#2e7d32' : '#c62828'; ctx.fillText(it.ok ? '✓' : '✗', (PAGE_W - 54) * k, y * k); }
    if (c.grade) { ctx.strokeStyle = '#c62828'; ctx.lineWidth = 3 * k; ctx.beginPath(); ctx.ellipse((PAGE_W - 90) * k, 70 * k, 56 * k, 40 * k, -0.15, 0, 7); ctx.stroke(); ctx.fillStyle = '#c62828'; ctx.font = `700 ${46 * k}px Caveat, Kalam, cursive`; ctx.textAlign = 'center'; ctx.fillText(c.grade, (PAGE_W - 90) * k, 72 * k); }
    ctx.restore();
}
const imgCache = new Map();
function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (imgCache.has(src)) return imgCache.get(src);
    const p = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    imgCache.set(src, p); if (imgCache.size > 60) imgCache.delete(imgCache.keys().next().value);
    return p;
}
function renderPage(ctx, page, k, { img, imgs = [], correction = false } = {}) {
    drawPaper(ctx, page.paper, k); drawBg(ctx, img, k);
    (page.items || []).forEach((it, i) => { const im = imgs[i]; if (im) ctx.drawImage(im, it.x * k, it.y * k, it.w * k, it.h * k); });
    const strokes = page.strokes || [];
    strokes.filter(s => s.t === 'hl').forEach(s => drawStroke(ctx, s, k)); strokes.filter(s => s.t !== 'hl').forEach(s => drawStroke(ctx, s, k));
    (page.text || []).forEach(t => drawText(ctx, t, k));
    if (correction) drawCorrection(ctx, page.correction, k);
}

// Ganze Seite als Bild (Korrektur, PDF, Vorschau). page: geladene Seite ({strokes:[…]} oder gespeichert {strokes:'…'})
export async function pageImage(page, { width = 1240, quality = 0.86, correction = false, type = 'image/jpeg', region = null } = {}) {
    const pg = { ...page, strokes: Array.isArray(page.strokes) ? page.strokes : decodeStrokes(page.strokes) };
    const k = width / (region ? region.w : PAGE_W); const c = document.createElement('canvas');
    c.width = Math.round((region ? region.w : PAGE_W) * k); c.height = Math.round((region ? region.h : PAGE_H) * k);
    const ctx = c.getContext('2d'); if (region) ctx.translate(-region.x * k, -region.y * k);
    renderPage(ctx, pg, k, { img: await loadImage(pg.bg), imgs: await Promise.all((pg.items || []).map(i => loadImage(i.src))), correction });
    return c.toDataURL(type, quality);
}

// Fotos/PDF-Seiten: verkleinern, als JPEG
export function fileToImage(file, max = 1600) {
    return new Promise((res, rej) => {
        const r = new FileReader(); r.onerror = () => rej(new Error('Datei konnte nicht gelesen werden.'));
        r.onload = async () => { const img = await loadImage(r.result); if (!img) return rej(new Error('Kein Bild.')); res(shrink(img, max)); };
        r.readAsDataURL(file);
    });
}
function shrink(img, max, q = 0.82) { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q); }
let pdfjs = null;
export async function pdfToImages(file, maxPages = 60) {
    if (!pdfjs) {
        await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = res; s.onerror = () => rej(new Error('PDF-Leser konnte nicht geladen werden.')); document.head.append(s); });
        pdfjs = window.pdfjsLib; pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise; const out = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
        const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 1600 / pg.getViewport({ scale: 1 }).width });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise; out.push(c.toDataURL('image/jpeg', 0.8));
    }
    return out;
}
export async function filesToBackgrounds(files) {
    const out = [];
    for (const f of files) {
        if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) out.push(...await pdfToImages(f));
        else if (/^image\//.test(f.type)) out.push(await fileToImage(f));
    }
    return out;
}

// ---------- Seiten laden/speichern (Server + IndexedDB) ----------
export async function loadPage(id) {
    let p = null;
    try { p = (await apiJson('/study/pages/' + id)).page; if (p) idb.put(id, p); } catch (e) { p = await idb.get(id); if (!p && e.status !== 404) throw e; }
    return p;
}
export async function savePage(page, { withBg = false, withCorrection = false } = {}) {
    const strokes = Array.isArray(page.strokes) ? encodeStrokes(page.strokes) : (page.strokes || '[]');
    const body = { doc: page.doc, idx: page.idx || 0, paper: page.paper, strokes, text: page.text || [], items: page.items || [], ...(withBg ? { bg: page.bg || '' } : { keepBg: true }), ...(withCorrection ? { correction: page.correction || null } : {}) };
    await idb.put(page.id, { ...body, id: page.id, bg: page.bg || null, correction: page.correction || null });
    await apiJson('/study/pages/' + page.id, { method: 'PUT', body: JSON.stringify(body) });
}
export async function createPages(doc, backgrounds = [null], paper = 'liniert', startIdx = 0) {
    const ids = [];
    for (let i = 0; i < backgrounds.length; i++) {
        const page = { id: newPageId(), doc: doc.id, idx: startIdx + i, paper: backgrounds[i] ? 'blanko' : paper, strokes: '[]', text: [], items: [], bg: backgrounds[i] || null };
        await savePage(page, { withBg: true }); ids.push(page.id);
    }
    return ids;
}
// Seite kopieren (für "Duplizieren" von Seiten und ganzen Notizbüchern)
export async function copyPage(id, docId) {
    const p = await loadPage(id); const nid = newPageId();
    await savePage({ ...(p || { paper: 'liniert', strokes: '[]', text: [], items: [] }), id: nid, doc: docId, correction: p?.correction || null }, { withBg: true, withCorrection: true });
    return nid;
}
export async function deleteDocPages(docId) { try { await apiJson('/study/docs/' + docId, { method: 'DELETE' }); } catch (_) {} }

export async function exportDocPdf(doc, { subjectName = '', withCorrection = true, onProgress = () => {} } = {}) {
    const ids = Array.isArray(doc?.pages) ? doc.pages : [];
    if (!ids.length) throw new Error('Dieses Notizbuch hat keine Seiten.');
    const imgs = [];
    for (let i = 0; i < ids.length; i++) {
        onProgress(i + 1, ids.length);
        const pg = (await loadPage(ids[i]).catch(() => null)) || { paper: doc.paper || 'liniert', strokes: '[]', text: [], items: [], bg: null };
        imgs.push(await pageImage(pg, { width: 1654, quality: 0.9, correction: withCorrection }));
    }
    const blob = buildPdfBlob(imgs);
    const filename = safePdfFilename([subjectName, doc.title].filter(Boolean).join(' – '));
    downloadPdfBlob(blob, filename);
    return { pages: imgs.length, filename };
}

// ---------- Editor ----------
// ctx: { doc, persist(), subjectName, assignment, onCorrected(doc,page,c), onSubmit(a), onClose() }
export function openInkEditor(ctx) {
    const doc = ctx.doc; doc.pages = doc.pages || []; doc.bookmarks = doc.bookmarks || [];
    const st = {
        tool: 'pen', penType: 'fueller', color: { pen: PEN_COLORS[0], hl: HL_COLORS[0], shape: PEN_COLORS[1] }, width: { pen: 1, hl: 1, eraser: 1, shape: 1 },
        eraserMode: 'strich', zoom: 1, penOnly: false, sidebar: window.innerWidth > 1000, showCorr: true, panelMode: null, undo: [], redo: [], clip: null, cur: 0
    };
    try { const s = JSON.parse(localStorage.getItem('coden_ink_tools') || '{}'); ['tool', 'penType', 'color', 'width', 'eraserMode', 'penOnly'].forEach(k => { if (s[k] != null) st[k] = typeof s[k] === 'object' ? { ...st[k], ...s[k] } : s[k]; }); } catch (_) {}
    if (['text', 'laser', 'lasso', 'hand', 'image'].includes(st.tool)) st.tool = 'pen';
    // Auf iPad/Tablet: nur der Apple Pencil/Stift zeichnet; 1 Finger scrollt, 2 Finger zoomen
    const touchDevice = (navigator.maxTouchPoints || 0) > 1 || 'ontouchstart' in window || matchMedia('(pointer: coarse)').matches;
    try {
        const saved = JSON.parse(localStorage.getItem('coden_ink_tools') || '{}');
        if (touchDevice && !saved.penOnlyV2) st.penOnly = true;
    } catch (_) { if (touchDevice) st.penOnly = true; }
    const remember = (manual = false) => {
        try {
            const prev = JSON.parse(localStorage.getItem('coden_ink_tools') || '{}');
            localStorage.setItem('coden_ink_tools', JSON.stringify({
                tool: st.tool, penType: st.penType, color: st.color, width: st.width, eraserMode: st.eraserMode,
                penOnly: st.penOnly, penOnlyV2: manual ? true : (prev.penOnlyV2 || st.penOnly)
            }));
        } catch (_) {}
    };
    // Seiten: { id, data: {paper,strokes[],text[],items[],bg,correction}|null, view, dirty, bgDirty, corrDirty, thumb }
    const pages = doc.pages.map(id => ({ id }));

    // ---------- Gerüst ----------
    const root = el('div', 'ink-app'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Notizbuch');
    const top = el('header', 'ink-top');
    const title = el('button', 'ink-title'); title.type = 'button'; title.title = 'Umbenennen';
    const tName = el('b', '', doc.title || 'Notizbuch'); const tSub = el('small', '', [ctx.subjectName, ctx.assignment?.due ? 'Abgabe ' + fmtDate(ctx.assignment.due) : ''].filter(Boolean).join(' · ')); title.append(tName, tSub);
    title.addEventListener('click', () => { const n = prompt('Name des Notizbuchs:', doc.title || ''); if (n && n.trim()) { doc.title = n.trim().slice(0, 80); tName.textContent = doc.title; ctx.persist?.(); } });
    const saveState = el('span', 'ink-save', 'Gespeichert');
    const pageLbl = el('span', 'ink-pages');
    const undoB = btn('undo', 'Rückgängig (Strg+Z)', () => undo()), redoB = btn('redo', 'Wiederholen (Strg+Umschalt+Z)', () => redo());
    const markB = btn('bookmark', 'Lesezeichen für diese Seite', () => toggleBookmark(st.cur));
    const sideB = btn('view_sidebar', 'Seitenübersicht', () => { st.sidebar = !st.sidebar; side.hidden = !st.sidebar; sideB.classList.toggle('on', st.sidebar); if (st.sidebar) drawSidebar(); requestAnimationFrame(layoutAll); });
    const addB = btn('note_add', 'Seite hinzufügen', (e) => templateMenu(e.currentTarget, (t) => insertPage(st.cur + 1, t)));
    const formulaB = btn('functions', 'Formeln', () => toggleFormulas(), 'labeled ink-wide');
    const liveB = btn('graphic_eq', 'Live mit Coden', () => toggleLive(), 'labeled live');
    const chatB = btn('chat', 'Coden Chat', () => toggleChat(), 'labeled ink-chat-btn');
    const checkB = btn('fact_check', 'Coden prüfen', () => correct(), 'primary labeled');
    const doneB = ctx.assignment ? btn('task_alt', 'Fertig & abgeben', () => finish(), 'labeled') : null;
    const moreB = btn('more_horiz', 'Mehr', (e) => moreMenu(e.currentTarget));
    const left = el('div', 'ink-row ink-left'); left.append(btn('arrow_back', 'Zurück zur Bibliothek', () => close()), sideB, title);
    const mid = el('div', 'ink-row ink-mid'); mid.append(undoB, redoB, pageLbl);
    markB.classList.add('ink-wide'); addB.classList.add('ink-wide'); doneB?.classList.add('ink-wide');
    const right = el('div', 'ink-row ink-right'); right.append(saveState, markB, addB, formulaB, liveB, chatB, checkB, ...(doneB ? [doneB] : []), moreB);
    top.append(left, mid, right);

    // Werkzeugleiste (GoodNotes: mittig, Werkzeuge + passende Optionen)
    const bar = el('div', 'ink-tools');
    const toolBtns = {};
    for (const [k, ic, label] of [['pen', 'edit', 'Stift (P)'], ['hl', 'ink_highlighter', 'Textmarker (H)'], ['eraser', 'ink_eraser', 'Radierer (E)'], ['lasso', 'lasso_select', 'Lasso (L)'], ['shape', 'category', 'Formen (S)'], ['text', 'title', 'Text (T)'], ['image', 'image', 'Bild einfügen'], ['laser', 'flare', 'Laserpointer'], ['hand', 'pan_tool', 'Verschieben']]) {
        toolBtns[k] = btn(ic, label, () => { if (k === 'image') { imgIn.click(); return; } setTool(k); }, 'tool');
        bar.append(toolBtns[k]);
    }
    const opts = el('div', 'ink-opts'); bar.append(el('span', 'ink-sep'), opts);
    const imgIn = el('input'); imgIn.type = 'file'; imgIn.accept = 'image/*'; imgIn.hidden = true; imgIn.addEventListener('change', () => { insertImage(imgIn.files[0]).finally(() => { imgIn.value = ''; }); });
    const bgIn = el('input'); bgIn.type = 'file'; bgIn.accept = 'image/*,application/pdf'; bgIn.multiple = true; bgIn.hidden = true; bgIn.addEventListener('change', () => { importBackgrounds([...bgIn.files]).finally(() => { bgIn.value = ''; }); });
    bar.append(imgIn, bgIn);

    // Seitenleiste + Arbeitsfläche + Korrektur
    const side = el('aside', 'ink-side'); side.hidden = !st.sidebar; sideB.classList.toggle('on', st.sidebar);
    // ink-world: Fläche um die Seiten herum – beim Kleinzoomen lässt sich das Blatt frei hinschieben (nicht fest in der Mitte)
    const stage = el('div', 'ink-stage'); const world = el('div', 'ink-world'); const col = el('div', 'ink-col'); world.append(col); stage.append(world);
    const addTile = el('button', 'ink-addpage'); addTile.type = 'button'; addTile.append(icon('add'), el('span', '', 'Seite hinzufügen'));
    addTile.addEventListener('click', (e) => templateMenu(e.currentTarget, (t) => insertPage(pages.length, t)));
    const panel = el('aside', 'ink-panel'); panel.hidden = true;
    const body = el('div', 'ink-body'); body.append(side, stage, panel);
    root.append(top, bar, body);
    document.body.append(root); document.body.classList.add('ink-open');

    // ---------- Werkzeuge ----------
    function setTool(k) { clearSelection(); st.tool = k; remember(); syncTools(); }
    function syncTools() {
        Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('on', st.tool === k));
        opts.replaceChildren();
        const kind = st.tool === 'hl' ? 'hl' : st.tool === 'shape' ? 'shape' : 'pen';
        if (st.tool === 'pen') {
            const sel = el('select', 'ink-select'); sel.title = 'Stiftart'; PEN_TYPES.forEach(([v, l]) => { const o = el('option', '', l); o.value = v; sel.append(o); }); sel.value = st.penType;
            sel.addEventListener('change', () => { st.penType = sel.value; remember(); }); opts.append(sel);
        }
        if (['pen', 'hl', 'shape', 'text'].includes(st.tool)) {
            (kind === 'hl' ? HL_COLORS : PEN_COLORS).forEach(c => { const b = el('button', 'ink-swatch' + (st.color[kind] === c ? ' on' : '')); b.type = 'button'; b.style.setProperty('--sw', c); b.title = 'Farbe'; b.addEventListener('click', () => { st.color[kind] = c; remember(); syncTools(); }); opts.append(b); });
            const custom = el('input'); custom.type = 'color'; custom.className = 'ink-custom'; custom.value = st.color[kind]; custom.title = 'Eigene Farbe'; custom.addEventListener('input', () => { st.color[kind] = custom.value; remember(); }); opts.append(custom);
        }
        const wk = st.tool === 'hl' ? 'hl' : st.tool === 'eraser' ? 'eraser' : st.tool === 'shape' ? 'shape' : st.tool === 'pen' ? 'pen' : null;
        if (wk) WIDTHS[wk].forEach((w, i) => { const b = el('button', 'ink-width' + (st.width[wk] === i ? ' on' : '')); b.type = 'button'; b.title = ['Fein', 'Mittel', 'Dick'][i]; const d = el('i'); d.style.width = d.style.height = (5 + i * 5) + 'px'; b.append(d); b.addEventListener('click', () => { st.width[wk] = i; remember(); syncTools(); }); opts.append(b); });
        if (st.tool === 'eraser') { const sel = el('select', 'ink-select'); [['strich', 'Ganzer Strich'], ['teil', 'Teilweise']].forEach(([v, l]) => { const o = el('option', '', l); o.value = v; sel.append(o); }); sel.value = st.eraserMode; sel.addEventListener('change', () => { st.eraserMode = sel.value; remember(); }); opts.append(sel); }
        if (st.tool === 'pen') opts.append(el('small', 'ink-hint', 'Form zeichnen und kurz halten → wird gerade'));
        if (st.tool === 'shape') opts.append(el('small', 'ink-hint', 'Linie, Kreis, Rechteck, Dreieck – Coden macht sie sauber'));
        if (st.tool === 'lasso') opts.append(el('small', 'ink-hint', 'Einkreisen, dann verschieben, skalieren oder bearbeiten'));
        if (st.clip) opts.append(btn('content_paste', 'Einfügen', () => paste(), 'labeled'));
        const po = btn('stylus', 'Nur Stift zeichnet (Finger scrollt und zoomt)', () => { st.penOnly = !st.penOnly; remember(true); syncTools(); }, 'tool' + (st.penOnly ? ' on' : ''));
        opts.append(el('span', 'ink-sep'), po);
        stage.dataset.tool = st.tool;
    }

    // ---------- Seiten im Raster ----------
    let cssW = 800, dpr = 1;
    function pageEl(pg, i) {
        const w = el('div', 'ink-page'); w.dataset.i = i; pg.wrap = w;
        w.append(el('div', 'ink-pnum', String(i + 1)));
        if (doc.bookmarks.includes(pg.id)) w.classList.add('marked');
        return w;
    }
    function rebuild() {
        clearSelection();
        col.replaceChildren(...pages.map((pg, i) => { if (pg.view) unmount(pg); return pageEl(pg, i); }), addTile);
        io.disconnect(); pages.forEach(pg => io.observe(pg.wrap));
        layoutAll(); updateLabel(); if (st.sidebar) drawSidebar();
    }
    let base = 800; // Seitenbreite bei Zoom 1 (passt in die Breite)
    let zoomRenderTimer = 0, lastViewCssW = 0;
    function scheduleZoomRender(delay = 140) {
        clearTimeout(zoomRenderTimer);
        zoomRenderTimer = setTimeout(() => {
            if (pinch) return;
            layoutAll({ quick: false });
        }, delay);
    }
    function layoutAll({ quick = false } = {}) {
        const avail = Math.max(260, stage.clientWidth - 32); base = Math.min(avail, 900); cssW = Math.round(base * st.zoom);
        const cssH = Math.round(cssW * PAGE_H / PAGE_W); dpr = Math.min(window.devicePixelRatio || 1, 2800 / Math.max(1, cssW), 3);
        const m = stageMetrics({ stageW: stage.clientWidth, stageH: stage.clientHeight, cssW, zoom: st.zoom });
        st.padx = m.padx;
        st.pady = m.padyTop;
        world.style.padding = `${m.padyTop}px ${m.padx}px ${m.padyBottom}px`;
        col.style.width = cssW + 'px'; col.style.gap = Math.round(22 * st.zoom) + 'px';
        pages.forEach(pg => {
            if (!pg.wrap) return;
            pg.wrap.style.width = cssW + 'px'; pg.wrap.style.height = cssH + 'px'; pg.wrap.style.setProperty('--k', cssW / PAGE_W);
            if (!quick && pg.view && lastViewCssW !== cssW) {
                if (pg.active) pg._needResize = true;
                else sizeView(pg);
            }
        });
        if (!quick) lastViewCssW = cssW;
        placeSel();
    }
    // Zoomen um einen Bildschirmpunkt (cx, cy relativ zur Arbeitsfläche); optional gleichzeitig verschieben (2 Finger)
    function zoomAt(z, cx, cy, anchor = null, { quick = false } = {}) {
        z = Math.max(0.35, Math.min(4.5, z));
        const a = anchor || { wx: (stage.scrollLeft + cx - st.padx) / st.zoom, wy: (stage.scrollTop + cy - st.pady) / st.zoom };
        st.zoom = z; layoutAll({ quick });
        stage.scrollLeft = st.padx + a.wx * z - cx; stage.scrollTop = st.pady + a.wy * z - cy;
        if (quick) scheduleZoomRender(140);
    }
    const kOf = () => cssW * dpr / PAGE_W;
    // Sichtbare Seiten bekommen Zeichenflächen, ferne geben sie wieder frei (Speicher auf dem iPad)
    const io = new IntersectionObserver((entries) => {
        for (const e of entries) { const pg = pages[+e.target.dataset.i]; if (!pg) continue; if (e.isIntersecting) mount(pg); else if (pg.view && !pg.active && sel?.pg !== pg) unmount(pg); }
    }, { root: stage, rootMargin: '900px 0px' });
    async function ensureData(pg) {
        if (pg.data) return pg.data;
        if (!pg.loading) pg.loading = (async () => {
            let p = null; try { p = await loadPage(pg.id); } catch (_) {}
            p = p || { paper: doc.paper || 'liniert', strokes: '[]', text: [], items: [], bg: null };
            pg.data = { paper: p.paper || 'liniert', strokes: decodeStrokes(p.strokes), text: p.text || [], items: p.items || [], bg: p.bg || null, correction: p.correction || null };
            return pg.data;
        })();
        return pg.loading;
    }
    async function mount(pg) {
        if (pg.view) return;
        const v = pg.view = { bg: el('canvas', 'ink-c'), imgs: el('div', 'ink-img-layer'), ink: el('canvas', 'ink-c'), live: el('canvas', 'ink-c live'), text: el('div', 'ink-text-layer'), marks: el('div', 'ink-mark-layer') };
        try { v.live.getContext('2d', { desynchronized: true }); } catch (_) {} // weniger Verzögerung beim Schreiben (wo unterstützt)
        pg.wrap.append(v.bg, v.imgs, v.ink, v.live, v.text, v.marks); pg.wrap.classList.add('loading');
        await ensureData(pg); if (pg.view !== v) return;
        pg.wrap.classList.remove('loading'); sizeView(pg);
    }
    function unmount(pg) { const v = pg.view; if (!v) return; [v.bg, v.imgs, v.ink, v.live, v.text, v.marks].forEach(x => x.remove()); pg.view = null; }
    async function sizeView(pg) {
        const v = pg.view; if (!v || !pg.data) return;
        const img = await loadImage(pg.data.bg);
        if (pg.view !== v) return;
        const W = Math.round(cssW * dpr), H = Math.round(cssW * PAGE_H / PAGE_W * dpr);
        if (v.bg.width !== W || v.bg.height !== H) { v.bg.width = W; v.bg.height = H; }
        if (v.ink.width !== W || v.ink.height !== H) { v.ink.width = W; v.ink.height = H; }
        if (!pg.active && (v.live.width !== W || v.live.height !== H)) { v.live.width = W; v.live.height = H; }
        const g = v.bg.getContext('2d'); g.clearRect(0, 0, W, H); drawPaper(g, pg.data.paper, kOf()); drawBg(g, img, kOf());
        paintInk(pg); paintItems(pg); paintText(pg); paintMarks(pg);
    }
    async function paintBg(pg) { const v = pg.view; if (!v) return; const img = await loadImage(pg.data.bg); if (pg.view !== v) return; const g = v.bg.getContext('2d'); g.clearRect(0, 0, v.bg.width, v.bg.height); drawPaper(g, pg.data.paper, kOf()); drawBg(g, img, kOf()); }
    function paintInk(pg) {
        const v = pg.view; if (!v) return; const g = v.ink.getContext('2d'); g.clearRect(0, 0, v.ink.width, v.ink.height);
        const k = kOf(); const s = pg.data.strokes; s.filter(x => x.t === 'hl').forEach(x => drawStroke(g, x, k)); s.filter(x => x.t !== 'hl').forEach(x => drawStroke(g, x, k));
    }
    function paintItems(pg) {
        const v = pg.view; if (!v) return;
        v.imgs.replaceChildren(...pg.data.items.map(it => { const im = el('img', 'ink-item'); im.src = it.src; im.alt = ''; im.draggable = false; Object.assign(im.style, { left: `calc(var(--k) * ${it.x}px)`, top: `calc(var(--k) * ${it.y}px)`, width: `calc(var(--k) * ${it.w}px)`, height: `calc(var(--k) * ${it.h}px)` }); return im; }));
    }
    function paintText(pg) { const v = pg.view; if (!v) return; v.text.replaceChildren(...pg.data.text.map((t, i) => textBox(pg, t, i))); }
    function textBox(pg, t, i) {
        const d = el('div', 'ink-textbox'); d.textContent = t.s; Object.assign(d.style, { left: `calc(var(--k) * ${t.x}px)`, top: `calc(var(--k) * ${t.y}px)`, fontSize: `calc(var(--k) * ${t.z}px)`, color: t.c });
        d.addEventListener('pointerdown', (e) => { if (st.tool !== 'text') return; e.stopPropagation(); d.contentEditable = 'true'; d.focus(); });
        d.addEventListener('blur', () => {
            d.contentEditable = 'false'; const s = d.innerText.replace(/\n$/, ''); const arr = pg.data.text; const idx = arr.indexOf(t); if (idx < 0) return;
            if (s === t.s && s.trim()) return;
            const before = clone(pg.data); before.text[idx] = { ...t, s: d._orig ?? t.s };
            if (!s.trim()) arr.splice(idx, 1); else arr[idx] = Object.assign(t, { s });
            commit(pg, before); paintText(pg);
        });
        d.addEventListener('focus', () => { d._orig = t.s; });
        return d;
    }
    // Korrektur von Coden: rote Randnotizen wie von einer Lehrkraft. Jede lässt sich wegmachen (✕), die Note auch.
    function paintMarks(pg) {
        const v = pg.view; if (!v) return; v.marks.replaceChildren(); const c = pg.data.correction; if (!c || !st.showCorr) return;
        if (c.grade) { const g = el('div', 'ink-grade', c.grade); const x = el('span', 'ink-grade-x', '✕'); x.title = 'Note entfernen'; x.addEventListener('click', (e) => { e.stopPropagation(); editCorrection(pg, (cc) => { cc.grade = ''; }); }); g.append(x); v.marks.append(g); }
        (c.items || []).forEach((it, i) => {
            const m = el('div', 'ink-mark ' + (it.ok ? 'ok' : 'bad')); m.style.top = `calc(var(--k) * ${60 + it.y * (PAGE_H - 120)}px)`;
            const t = el('div', 'ink-mark-t'); t.append(el('b', '', it.ok ? '✓' : '✗'), el('span', '', it.text)); if (it.fix) t.append(el('em', '', '→ ' + it.fix));
            t.title = it.fix ? 'Tippen: Lösung zeigen' : ''; t.addEventListener('click', (e) => { e.stopPropagation(); m.classList.toggle('open'); });
            const x = el('span', 'ink-mark-x', '✕'); x.title = 'Diese Anmerkung entfernen';
            x.addEventListener('click', (e) => { e.stopPropagation(); editCorrection(pg, (cc) => { cc.items.splice(i, 1); }); });
            m.append(t, x); v.marks.append(m);
        });
    }
    function editCorrection(pg, fn) {
        const c = pg.data.correction; if (!c) return;
        const next = { ...c, items: (c.items || []).slice() }; fn(next);
        pg.data.correction = (next.items.length || next.grade) ? next : null;
        if (!pg.data.correction && st.panelMode === 'corr') st.panelMode = null;
        markDirty(pg, { corr: true }); paintMarks(pg); showPanel();
    }
    function removeCorrection(pg) { if (!pg?.data?.correction) return; pg.data.correction = null; if (st.panelMode === 'corr') st.panelMode = null; markDirty(pg, { corr: true }); paintMarks(pg); showPanel(); toast2('Korrektur entfernt'); }
    const repaint = (pg) => { paintInk(pg); paintItems(pg); paintText(pg); };

    // ---------- Rückgängig: ein Schnappschuss je Aktion und Seite ----------
    function commit(pg, before) { st.undo.push({ pg, before, after: clone(pg.data) }); if (st.undo.length > 150) st.undo.shift(); st.redo = []; markDirty(pg); }
    function applySnap(pg, snap) { pg.data.strokes = snap.strokes.slice(); pg.data.text = snap.text.map(t => ({ ...t })); pg.data.items = snap.items.map(i => ({ ...i })); repaint(pg); markDirty(pg); }
    function undo() { clearSelection(); const a = st.undo.pop(); if (!a) return; applySnap(a.pg, a.before); st.redo.push(a); scrollToPage(pages.indexOf(a.pg), true); }
    function redo() { clearSelection(); const a = st.redo.pop(); if (!a) return; applySnap(a.pg, a.after); st.undo.push(a); }

    // ---------- Speichern ----------
    let saveTimer = 0;
    function markDirty(pg, what = {}) { pg.dirty = true; pg.rev = (pg.rev || 0) + 1; if (what.bg) pg.bgDirty = true; if (what.corr) pg.corrDirty = true; pg.thumb = null; saveState.textContent = 'Ungespeichert …'; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 1200); }
    async function flush() {
        clearTimeout(saveTimer); const dirty = pages.filter(p => p.dirty && p.data); if (!dirty.length) return;
        saveState.textContent = 'Speichert …'; let ok = true;
        for (const pg of dirty) {
            pg.dirty = false; const idx = pages.indexOf(pg);
            try { await savePage({ id: pg.id, doc: doc.id, idx, ...pg.data }, { withBg: pg.bgDirty, withCorrection: pg.corrDirty }); pg.bgDirty = false; pg.corrDirty = false; }
            catch (e) { pg.dirty = true; ok = false; saveState.title = e.message || ''; }
        }
        saveState.textContent = ok ? 'Gespeichert' : 'Nur auf diesem Gerät gespeichert';
        doc.updatedAt = new Date().toISOString(); ctx.persist?.(); if (st.sidebar) drawSidebar();
    }

    // ---------- Eingabe (Stift, Maus, Finger) – alles über die Arbeitsfläche ----------
    // touches: Finger auf der Fläche { id, x, y, x0, y0, t0, palm, big, whilePen }. Handballen werden markiert und ignoriert; 2 Finger zoomen & bewegen jederzeit.
    const touches = new Map(); let op = null, pinch = null, pan = null, holdTimer = 0, inertia = 0, lastPenAt = 0, penDown = false, drawRaf = 0, tapGesture = null;
    const pagePos = (pg, e, rect) => { const r = rect || pg.wrap.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * PAGE_W, (e.clientY - r.top) / r.height * PAGE_H]; };
    const pageAt = (e) => { const w = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.ink-page'); return w ? pages[+w.dataset.i] : null; };
    const pressure = (e) => (e.pointerType === 'pen' ? (e.pressure || 0.5) : e.pointerType === 'touch' ? 0.55 : 0.5);
    const liveTouches = () => [...touches.values()].filter(t => !t.palm);
    const startPinchFrom = (live) => {
        const [a, b] = live; const r = stage.getBoundingClientRect();
        const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
        pinch = {
            d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
            z: st.zoom,
            anchor: { wx: (stage.scrollLeft + mx - st.padx) / st.zoom, wy: (stage.scrollTop + my - st.pady) / st.zoom },
            mx,
            my
        };
    };
    const cancelTouchOp = () => {
        if (!op || !op.touch) return;
        clearTimeout(holdTimer); cancelAnimationFrame(drawRaf); drawRaf = 0;
        clearLive(op.pg); op.pg.active = false;
        if (op.kind === 'erase' && op.changed) applySnap(op.pg, op.before);
        op = null;
    };
    // Stift setzt auf: alles, was Finger/Hand gerade tun, sofort beenden (kein Verschieben, kein Zoomen beim Schreiben)
    function penTakesOver() {
        lastPenAt = Date.now(); penDown = true; pinch = null; tapGesture = null; cancelAnimationFrame(inertia);
        if (pan && pan.touch) pan = null;
        touches.forEach(t => { t.palm = true; t.whilePen = true; });
        cancelTouchOp();
    }
    stage.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.ink-sel, .ink-selmenu, .ink-addpage, .ink-mark-x, .ink-mark-t, .ink-grade-x, .ink-textbox[contenteditable="true"]')) return;
        cancelAnimationFrame(inertia);
        if (e.pointerType === 'pen') { penTakesOver(); if (!st.penOnly) { st.penOnly = true; remember(true); syncTools(); } }
        if (e.pointerType === 'touch') {
            const nowPerf = performance.now();
            // Alte verwaiste Touch-Einträge bereinigen (falls Safari ein pointercancel verschluckt hat)
            for (const [tid, t] of touches) { if (nowPerf - (t.tLast || t.t0) > 8000) touches.delete(tid); }
            const big = Math.max(e.width || 0, e.height || 0) > 68;
            const whilePen = penDown;
            const recentPen = !penDown && lastPenAt > 0 && (Date.now() - lastPenAt < 140);
            const palm = whilePen || big || recentPen;
            touches.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: nowPerf, tLast: nowPerf, palm, big, whilePen });
            if (!whilePen && !big) { try { stage.setPointerCapture(e.pointerId); } catch (_) {} }
            // Sobald 2 echte Finger (nicht während Stift aufliegt) die Fläche berühren: direkt 2-Finger-Zoom & -Verschieben starten
            const candidates = [...touches.values()].filter(t => !t.whilePen && !t.big);
            if (!penDown && candidates.length >= 2) {
                candidates.forEach(t => { t.palm = false; });
                cancelTouchOp();
                pan = null;
                tapGesture = { n: candidates.length, t: nowPerf, moved: false };
                startPinchFrom(candidates);
                e.preventDefault();
                return;
            }
            if (palm) { e.preventDefault(); return; } // Hand liegt auf: ignorieren
            tapGesture = null;
        }
        try { stage.setPointerCapture(e.pointerId); } catch (_) {}
        const pg = pageAt(e);
        if (st.tool === 'hand' || (e.pointerType === 'touch' && st.penOnly) || !pg || !pg.data) {
            if (st.tool === 'lasso' && e.pointerType !== 'touch') clearSelection();
            pan = { id: e.pointerId, touch: e.pointerType === 'touch', x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop, t: performance.now(), vx: 0, vy: 0 };
            return;
        }
        if (e.button > 0) return;
        e.preventDefault(); st.cur = pages.indexOf(pg); updateLabel(); pg.active = true;
        const rect = pg.wrap.getBoundingClientRect(); const [x, y] = pagePos(pg, e, rect);
        if (st.tool === 'text') { addText(pg, x, y); pg.active = false; return; }
        if (st.tool === 'lasso') { clearSelection(); op = { kind: 'lasso', pg, poly: [[x, y]], id: e.pointerId, rect, touch: e.pointerType === 'touch' }; return; }
        if (st.tool === 'eraser') { op = { kind: 'erase', pg, before: clone(pg.data), id: e.pointerId, touch: e.pointerType === 'touch', rect }; eraseAt(pg, x, y); return; }
        if (st.tool === 'laser') { op = { kind: 'laser', pg, id: e.pointerId, rect, touch: e.pointerType === 'touch' }; laserAdd(pg, x, y); return; }
        const t = st.tool === 'hl' ? 'hl' : 'pen'; const kind = st.tool === 'shape' ? 'shape' : t; const ck = kind === 'shape' ? 'shape' : t;
        op = { kind, pg, id: e.pointerId, rect, touch: e.pointerType === 'touch', s: { t, c: st.color[ck], w: WIDTHS[ck][st.width[ck]], k: t === 'hl' ? 'fueller' : (kind === 'shape' ? 'kugel' : st.penType), p: [x, y, pressure(e)] } };
    });
    stage.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') {
            const tt = touches.get(e.pointerId); if (!tt) return;
            tt.x = e.clientX; tt.y = e.clientY; tt.tLast = performance.now();
            if (penDown || tt.whilePen || tt.big) return;
            const movedDist = Math.hypot(tt.x - tt.x0, tt.y - tt.y0);
            if (tt.palm && movedDist > 6 && liveTouches().length === 0) {
                tt.palm = false;
                if (st.tool === 'hand' || st.penOnly) {
                    pan = { id: tt.id, touch: true, x: tt.x, y: tt.y, sl: stage.scrollLeft, st: stage.scrollTop, t: performance.now(), vx: 0, vy: 0 };
                    return;
                }
            }
            if (tt.palm) return;
            if (movedDist > 8 && tapGesture) tapGesture.moved = true;
        }
        if (pinch) {
            const live = liveTouches(); if (live.length < 2) return; const [a, b] = live; const d = Math.hypot(a.x - b.x, a.y - b.y);
            const r = stage.getBoundingClientRect(); const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
            if (tapGesture && !tapGesture.moved && Math.abs(d - pinch.d) < 8 && Math.hypot(mx - pinch.mx, my - pinch.my) < 8) return; // vielleicht nur ein Tipp
            if (tapGesture) tapGesture.moved = true;
            // zwei Finger: zoomen UND verschieben zugleich – der Punkt unter den Fingern bleibt unter den Fingern
            zoomAt(pinch.z * d / pinch.d, mx, my, pinch.anchor, { quick: true }); return;
        }
        if (pan && e.pointerId === pan.id) {
            const now = performance.now(), dt = Math.max(4, now - pan.t);
            const ivx = ((pan.lx ?? e.clientX) - e.clientX) / dt, ivy = ((pan.ly ?? e.clientY) - e.clientY) / dt;
            pan.vx = pan.vx * 0.45 + ivx * 0.55; pan.vy = pan.vy * 0.45 + ivy * 0.55;
            pan.lx = e.clientX; pan.ly = e.clientY; pan.t = now;
            stage.scrollLeft = pan.sl - (e.clientX - pan.x); stage.scrollTop = pan.st - (e.clientY - pan.y); return;
        }
        if (!op || e.pointerId !== op.id) return;
        e.preventDefault();
        if (e.pointerType === 'pen') lastPenAt = Date.now();
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of (evs.length ? evs : [e])) {
            const [x, y] = pagePos(op.pg, ev, op.rect);
            if (op.kind === 'erase') { eraseAt(op.pg, x, y); continue; }
            if (op.kind === 'lasso') { op.poly.push([x, y]); continue; }
            if (op.kind === 'laser') { laserAdd(op.pg, x, y); continue; }
            if (op.shaped) continue; // nach dem Einrasten nicht weiter malen
            const p = op.s.p; if (Math.hypot(x - p[p.length - 3], y - p[p.length - 2]) < 0.4) continue;
            p.push(x, y, pressure(ev));
        }
        // Vorhersage des Stifts (weniger gefühlte Verzögerung wie in GoodNotes)
        if (op.s && e.getPredictedEvents) { const pr = e.getPredictedEvents(); op.pred = pr.length ? pr.slice(0, 2).map(ev => [...pagePos(op.pg, ev, op.rect), pressure(ev)]) : null; }
        if (op.kind === 'lasso') { scheduleDraw(); return; }
        if (op.kind === 'pen' || op.kind === 'shape' || op.kind === 'hl') {
            scheduleDraw();
            if (op.kind === 'pen') { clearTimeout(holdTimer); const o = op; holdTimer = setTimeout(() => holdToShape(o), 650); }
        }
    });
    // höchstens einmal pro Bild zeichnen – egal wie viele Stift-Ereignisse kommen (Apple Pencil: 240 pro Sekunde)
    function scheduleDraw() { if (drawRaf) return; drawRaf = requestAnimationFrame(() => { drawRaf = 0; if (!op) return; if (op.kind === 'lasso') drawLasso(op); else if (op.s) drawLive(op); }); }
    const end = (e) => {
        if (e.pointerType === 'touch') {
            const tt = touches.get(e.pointerId); touches.delete(e.pointerId);
            const live = liveTouches();
            // Tipp mit 2/3 Fingern (kurz, ohne Bewegung) → Rückgängig/Wiederholen
            if (tapGesture && !tt?.palm && !live.length) {
                const g = tapGesture; tapGesture = null;
                if (!g.moved && performance.now() - g.t < 320 && !penDown) { if (g.n === 2) { undo(); toast2('Rückgängig'); } else if (g.n >= 3) { redo(); toast2('Wiederholt'); } }
            }
            if (pinch && live.length < 2) {
                pinch = null;
                scheduleZoomRender(60);
                // Bleibt ein Finger nach dem Zoomen auf dem Blatt: nahtlos weiter verschieben
                if (live.length === 1 && (st.tool === 'hand' || st.penOnly)) {
                    const rem = live[0];
                    pan = { id: rem.id, touch: true, x: rem.x, y: rem.y, sl: stage.scrollLeft, st: stage.scrollTop, t: performance.now(), vx: 0, vy: 0 };
                }
            }
            if (tt?.palm) return;
        }
        if (e.pointerType === 'pen') { penDown = false; lastPenAt = Date.now(); }
        if (pan && e.pointerId === pan.id) { const p = pan; pan = null; if (performance.now() - p.t < 90) glide(p.vx, p.vy); return; }
        if (!op || e.pointerId !== op.id) return;
        clearTimeout(holdTimer); cancelAnimationFrame(drawRaf); drawRaf = 0; const o = op; op = null; o.pg.active = false;
        if (o.kind === 'erase') { clearLive(o.pg); if (o.changed) commit(o.pg, o.before); if (o.pg._needResize) { o.pg._needResize = false; sizeView(o.pg); } return; }
        if (o.kind === 'laser') return;
        if (o.kind === 'lasso') { clearLive(o.pg); finishLasso(o); return; }
        clearLive(o.pg);
        let s = o.s;
        if (o.kind === 'shape' && !o.shaped) { const r = recognizeShape(s.p); if (r) s = { ...s, p: r.p }; }
        if (s.t === 'hl' && s.p.length > 6) s = straightHl(s);
        const before = clone(o.pg.data); o.pg.data.strokes.push(s); commit(o.pg, before);
        if (o.pg._needResize) { o.pg._needResize = false; sizeView(o.pg); }
        else if (s.t === 'hl') paintInk(o.pg); else if (o.pg.view) drawStroke(o.pg.view.ink.getContext('2d'), s, kOf());
    };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    stage.addEventListener('lostpointercapture', (e) => {
        if (touches.has(e.pointerId) || e.pointerType === 'pen' || (op && op.id === e.pointerId) || (pan && pan.id === e.pointerId)) end(e);
    });
    // iPad: Mehrfinger-Gesten des Systems, Gummi-Scroll und Doppeltipp-Zoom nicht durchlassen
    const isInteractiveTarget = (t) => !!t?.closest?.('.ink-addpage, .ink-mark-x, .ink-mark-t, .ink-grade-x, .ink-selmenu, .ink-textbox[contenteditable="true"]');
    stage.addEventListener('touchstart', (e) => { if ((e.touches.length > 1 || penDown || st.penOnly || st.tool === 'hand') && !isInteractiveTarget(e.target)) e.preventDefault(); }, { passive: false });
    stage.addEventListener('touchmove', (e) => { if ((e.touches.length > 1 || penDown || st.penOnly || st.tool === 'hand') && !isInteractiveTarget(e.target)) e.preventDefault(); }, { passive: false });
    stage.addEventListener('gesturestart', (e) => e.preventDefault());
    stage.addEventListener('gesturechange', (e) => e.preventDefault());
    function toast2(t) { const d = el('div', 'ink-toast', t); root.append(d); setTimeout(() => d.remove(), 900); }
    function glide(vx, vy) {
        if (Math.hypot(vx, vy) < 0.2) return; let last = performance.now();
        const step = (t) => { const dt = t - last; last = t; stage.scrollLeft += vx * dt; stage.scrollTop += vy * dt; vx *= Math.pow(0.94, dt / 16); vy *= Math.pow(0.94, dt / 16); if (Math.hypot(vx, vy) > 0.02) inertia = requestAnimationFrame(step); };
        inertia = requestAnimationFrame(step);
    }
    const clearLive = (pg) => { const v = pg?.view; if (v) v.live.getContext('2d').clearRect(0, 0, v.live.width, v.live.height); };
    function drawLive(o) {
        const v = o.pg.view; if (!v) return; const g = v.live.getContext('2d'); g.clearRect(0, 0, v.live.width, v.live.height);
        const s = o.pred && !o.shaped ? { ...o.s, p: o.s.p.concat(...o.pred) } : o.s;
        drawStroke(g, s, kOf(), { live: true });
    }
    // Zeichnen und halten → saubere Form (wie in GoodNotes)
    function holdToShape(o) {
        if (op !== o || o.shaped || o.s.p.length < 18) return;
        const r = recognizeShape(o.s.p); if (!r) return;
        o.s = { ...o.s, p: r.p, k: o.s.k === 'pinsel' ? 'fueller' : o.s.k }; o.shaped = true; drawLive(o);
        o.pg.wrap.classList.add('snapped'); setTimeout(() => o.pg.wrap.classList.remove('snapped'), 300);
    }
    function straightHl(s) {
        const p = s.p; const x0 = p[0], y0 = p[1], x1 = p[p.length - 3], y1 = p[p.length - 2];
        let dev = 0; for (let i = 0; i < p.length; i += 3) dev = Math.max(dev, Math.abs(p[i + 1] - (y0 + (y1 - y0) * ((p[i] - x0) / ((x1 - x0) || 1)))));
        if (Math.abs(x1 - x0) > 40 && Math.abs(y1 - y0) < 18 && dev < 14) { const y = (y0 + y1) / 2; return { ...s, p: [x0, y, 0.5, x1, y, 0.5] }; }
        return s;
    }
    function eraseAt(pg, x, y) {
        const r = WIDTHS.eraser[st.width.eraser];
        const next = st.eraserMode === 'teil' ? eraseFrom(pg.data.strokes, x, y, r) : eraseWhole(pg.data.strokes, x, y, r);
        if (next !== pg.data.strokes) { pg.data.strokes = next; op.changed = true; paintInk(pg); }
        const v = pg.view; if (!v) return; const g = v.live.getContext('2d'); const k = kOf(); g.clearRect(0, 0, v.live.width, v.live.height); g.strokeStyle = 'rgba(80,80,90,.6)'; g.lineWidth = 1.5 * dpr; g.beginPath(); g.arc(x * k, y * k, r * k, 0, 7); g.stroke();
    }
    // Laserpointer: leuchtende Spur, die nach kurzer Zeit verschwindet
    function laserAdd(pg, x, y) {
        pg._laser = pg._laser || []; pg._laser.push([x, y, performance.now()]);
        if (pg._laserRaf) return;
        const tick = () => {
            const v = pg.view; const now = performance.now(); pg._laser = pg._laser.filter(q => now - q[2] < 800);
            if (!v || !pg._laser.length) { clearLive(pg); pg._laserRaf = 0; return; }
            const g = v.live.getContext('2d'); const k = kOf(); g.clearRect(0, 0, v.live.width, v.live.height); g.lineCap = 'round';
            for (let i = 1; i < pg._laser.length; i++) { const a = pg._laser[i - 1], b = pg._laser[i]; const f = 1 - (now - b[2]) / 800; g.strokeStyle = `rgba(255,40,60,${f})`; g.shadowColor = 'rgba(255,40,60,.9)'; g.shadowBlur = 12 * k; g.lineWidth = 6 * k * (0.4 + f * 0.6); g.beginPath(); g.moveTo(a[0] * k, a[1] * k); g.lineTo(b[0] * k, b[1] * k); g.stroke(); }
            pg._laserRaf = requestAnimationFrame(tick);
        };
        pg._laserRaf = requestAnimationFrame(tick);
    }

    // ---------- Text & Bilder ----------
    function addText(pg, x, y) {
        const before = clone(pg.data);
        const t = { x, y: y - 10, s: '', c: st.color.pen, z: 22 }; pg.data.text.push(t);
        const d = el('div', 'ink-textbox'); Object.assign(d.style, { left: `calc(var(--k) * ${t.x}px)`, top: `calc(var(--k) * ${t.y}px)`, fontSize: `calc(var(--k) * ${t.z}px)`, color: t.c });
        pg.view.text.append(d); d.contentEditable = 'true'; setTimeout(() => d.focus(), 0);
        d.addEventListener('blur', () => { const s = d.innerText.replace(/\n$/, ''); const i = pg.data.text.indexOf(t); if (!s.trim()) { if (i >= 0) pg.data.text.splice(i, 1); paintText(pg); return; } t.s = s; commit(pg, before); paintText(pg); }, { once: true });
    }
    async function insertImage(file) {
        if (!file) return; const pg = pages[st.cur]; if (!pg) return; await ensureData(pg);
        try {
            const src = await fileToImage(file, 1200); const im = await loadImage(src);
            const w = 520, h = Math.round(520 * im.height / im.width); const before = clone(pg.data);
            const vis = visibleY(pg); pg.data.items.push({ id: 'im' + Date.now().toString(36), type: 'img', x: (PAGE_W - w) / 2, y: Math.max(40, Math.min(PAGE_H - h - 40, vis - h / 2)), w, h, src });
            commit(pg, before); paintItems(pg); setTool('lasso'); select(pg, { si: [], ti: [], ii: [pg.data.items.length - 1] });
        } catch (e) { alert(e.message); }
    }
    const visibleY = (pg) => { const r = pg.wrap.getBoundingClientRect(), s = stage.getBoundingClientRect(); return ((s.top + s.height / 2) - r.top) / r.height * PAGE_H; };

    // ---------- Lasso & Auswahl ----------
    let sel = null;
    function drawLasso(o) {
        const v = o.pg.view; if (!v) return; const g = v.live.getContext('2d'); const k = kOf(); g.clearRect(0, 0, v.live.width, v.live.height);
        g.setLineDash([6 * dpr, 5 * dpr]); g.strokeStyle = '#6d5ce7'; g.lineWidth = 1.5 * dpr; g.fillStyle = 'rgba(109,92,231,.07)';
        g.beginPath(); o.poly.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k))); g.closePath(); g.fill(); g.stroke(); g.setLineDash([]);
    }
    function finishLasso(o) {
        if (o.poly.length < 4) return;
        const s = lassoSelect(o.pg.data, o.poly); if (!s.si.length && !s.ti.length && !s.ii.length) return;
        select(o.pg, s);
    }
    function select(pg, s) {
        clearSelection(); const box = selectionBox(pg.data, s); if (!box) return;
        sel = { pg, ...s, box };
        const r = el('div', 'ink-sel'); const h = el('span', 'ink-sel-h'); h.title = 'Größe ändern'; r.append(h);
        const rotH = el('span', 'ink-sel-r'); rotH.title = 'Drehen'; if (s.si.length && !s.ti.length && !s.ii.length) r.append(rotH);
        const menu = el('div', 'ink-selmenu');
        const mi = (ic, label, fn) => menu.append(btn(ic, label, (e) => { e.stopPropagation(); fn(e); }, 'labeled'));
        mi('palette', 'Farbe', (e) => colorMenu(e.currentTarget));
        mi('content_copy', 'Kopieren', () => copySel());
        mi('content_cut', 'Ausschneiden', () => { copySel(); deleteSel(); });
        mi('library_add', 'Duplizieren', () => duplicateSel());
        if (s.si.length) mi('text_fields', 'In Text', () => toText());
        mi('delete', 'Löschen', () => deleteSel());
        pg.wrap.append(r, menu); sel.el = r; sel.menu = menu; placeSel();
        const drag = (mode) => (e) => {
            e.stopPropagation(); e.preventDefault(); try { r.setPointerCapture(e.pointerId); } catch (_) {}
            const start = pagePos(pg, e), before = clone(pg.data), base = { strokes: pg.data.strokes, text: pg.data.text, items: pg.data.items }, b0 = { ...sel.box };
            let moved = false;
            const mv = (ev) => {
                const [x, y] = pagePos(pg, ev); moved = true;
                let out;
                if (mode === 'rotate') {
                    const cx = b0.x + b0.w / 2, cy = b0.y + b0.h / 2; let ang = Math.atan2(y - cy, x - cx) - Math.atan2(start[1] - cy, start[0] - cx);
                    const snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4); if (Math.abs(ang - snap) < 0.06) ang = snap; // auf 45° einrasten
                    out = rotateSelection(base, sel, ang, cx, cy);
                } else {
                    const t = mode === 'move' ? { dx: x - start[0], dy: y - start[1] } : { f: Math.max(0.15, (b0.w + (x - start[0])) / Math.max(1, b0.w)), ax: b0.x, ay: b0.y };
                    out = transformSelection(base, sel, t);
                    sel.box = mode === 'move' ? { ...b0, x: b0.x + t.dx, y: b0.y + t.dy } : { x: b0.x, y: b0.y, w: b0.w * t.f, h: b0.h * t.f };
                }
                pg.data.strokes = out.strokes; pg.data.text = out.text; pg.data.items = out.items;
                repaint(pg); placeSel();
            };
            const up = () => { r.removeEventListener('pointermove', mv); r.removeEventListener('pointerup', up); r.removeEventListener('pointercancel', up); if (moved) { commit(pg, before); if (mode === 'rotate') { sel.box = selectionBox(pg.data, sel) || sel.box; placeSel(); } } };
            r.addEventListener('pointermove', mv); r.addEventListener('pointerup', up); r.addEventListener('pointercancel', up);
        };
        r.addEventListener('pointerdown', (e) => (e.target === h ? drag('scale')(e) : e.target === rotH ? drag('rotate')(e) : drag('move')(e)));
    }
    function placeSel() {
        if (!sel) return; const b = sel.box, pad = 8;
        Object.assign(sel.el.style, { left: `calc(var(--k) * ${b.x - pad}px)`, top: `calc(var(--k) * ${b.y - pad}px)`, width: `calc(var(--k) * ${b.w + pad * 2}px)`, height: `calc(var(--k) * ${b.h + pad * 2}px)` });
        Object.assign(sel.menu.style, { left: `calc(var(--k) * ${Math.max(0, b.x)}px)`, top: b.y > 90 ? `calc(var(--k) * ${b.y - pad}px - 48px)` : `calc(var(--k) * ${b.y + b.h + pad}px + 8px)` });
    }
    function clearSelection() { if (!sel) return; sel.el?.remove(); sel.menu?.remove(); sel = null; document.querySelector('.ink-pop')?.remove(); }
    function copySel() { if (!sel) return; const d = sel.pg.data; st.clip = { strokes: sel.si.map(i => d.strokes[i]), text: sel.ti.map(i => ({ ...d.text[i] })), items: sel.ii.map(i => ({ ...d.items[i] })) }; syncTools(); }
    function deleteSel() {
        if (!sel) return; const { pg } = sel; const before = clone(pg.data); const S = new Set(sel.si), T = new Set(sel.ti), I = new Set(sel.ii);
        pg.data.strokes = pg.data.strokes.filter((_, i) => !S.has(i)); pg.data.text = pg.data.text.filter((_, i) => !T.has(i)); pg.data.items = pg.data.items.filter((_, i) => !I.has(i));
        clearSelection(); commit(pg, before); repaint(pg);
    }
    function pasteInto(pg, clip, off) {
        const before = clone(pg.data); const n = { s: pg.data.strokes.length, t: pg.data.text.length, i: pg.data.items.length };
        pg.data.strokes.push(...clip.strokes); pg.data.text.push(...clip.text.map(t => ({ ...t }))); pg.data.items.push(...clip.items.map(i => ({ ...i, id: 'im' + Math.random().toString(36).slice(2, 8) })));
        const s = { si: clip.strokes.map((_, k) => n.s + k), ti: clip.text.map((_, k) => n.t + k), ii: clip.items.map((_, k) => n.i + k) };
        Object.assign(pg.data, transformSelection(pg.data, s, { dx: off, dy: off }));
        commit(pg, before); repaint(pg); setTool('lasso'); select(pg, s);
    }
    function duplicateSel() { if (!sel) return; const pg = sel.pg; copySel(); pasteInto(pg, st.clip, 28); }
    async function paste() { const pg = pages[st.cur]; if (!pg || !st.clip) return; await ensureData(pg); pasteInto(pg, st.clip, 20); }
    function popAt(pop, anchor, dx = 0) { root.append(pop); const r = anchor.getBoundingClientRect(); const w = pop.offsetWidth || 240, hgt = pop.offsetHeight || 200; pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + dx)) + 'px'; pop.style.top = (r.bottom + hgt + 8 > window.innerHeight ? Math.max(8, r.top - hgt - 6) : r.bottom + 6) + 'px'; setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('pointerdown', off); } }), 0); }
    function colorMenu(anchor) {
        document.querySelector('.ink-pop')?.remove(); const pop = el('div', 'ink-pop ink-colors-pop');
        PEN_COLORS.concat(HL_COLORS).forEach(c => { const b = el('button', 'ink-swatch'); b.type = 'button'; b.style.setProperty('--sw', c); b.addEventListener('click', () => {
            if (!sel) return; const { pg } = sel; const before = clone(pg.data); sel.si.forEach(i => { pg.data.strokes[i] = { ...pg.data.strokes[i], c }; }); sel.ti.forEach(i => { pg.data.text[i] = { ...pg.data.text[i], c }; });
            commit(pg, before); repaint(pg); pop.remove();
        }); pop.append(b); });
        popAt(pop, anchor);
    }
    // Handschrift → Text: Coden liest die Auswahl und ersetzt sie durch Text
    async function toText() {
        if (!sel) return; const { pg } = sel; const box = { ...sel.box }; const keep = sel.si.slice();
        const busy = overlay('Coden liest deine Handschrift …', 'Wandelt in Text um');
        try {
            const pad = 20; const region = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
            const only = { paper: 'blanko', bg: null, items: [], text: [], strokes: keep.map(i => pg.data.strokes[i]) };
            const image = await pageImage(only, { region, width: Math.min(1400, Math.max(500, region.w * 1.6)), type: 'image/png' });
            const r = await apiJson('/chat', { method: 'POST', body: JSON.stringify({ tier: 'flash', messages: [{ role: 'system', content: 'Du liest Handschrift. Antworte NUR mit dem erkannten Text, genau wie geschrieben (Zeilenumbrüche beibehalten, Formeln in normaler Schreibweise wie x² oder √). Keine Erklärung.' }, { role: 'user', content: 'Was steht hier?', images: [image] }] }) });
            const text = String(r.content || '').replace(/^["„]|["“]$/g, '').trim(); if (!text) throw new Error('Nichts erkannt.');
            const before = clone(pg.data); const S = new Set(keep); const color = pg.data.strokes[keep[0]]?.c || '#1b1f2a';
            const lines = text.split('\n').length; const z = Math.max(14, Math.min(48, box.h / lines / 1.35));
            pg.data.strokes = pg.data.strokes.filter((_, i) => !S.has(i)); pg.data.text.push({ x: box.x, y: box.y, s: text.slice(0, 2000), c: color, z });
            clearSelection(); commit(pg, before); repaint(pg);
        } catch (e) { alert(e.message || 'Umwandeln hat nicht geklappt.'); } finally { busy.remove(); }
    }

    // ---------- Seiten verwalten ----------
    function templateMenu(anchor, pick) {
        document.querySelector('.ink-pop')?.remove(); const pop = el('div', 'ink-pop ink-tpl');
        TEMPLATES.forEach(([v, l]) => { const b = el('button', 'ink-tpl-item'); b.type = 'button'; const c = el('canvas'); c.width = 70; c.height = 99; drawPaper(c.getContext('2d'), v, 0.07); b.append(c, el('span', '', l)); b.addEventListener('click', () => { pop.remove(); pick(v); }); pop.append(b); });
        const imp = el('button', 'ink-tpl-item'); imp.type = 'button'; imp.append(icon('upload_file'), el('span', '', 'PDF / Foto')); imp.addEventListener('click', () => { pop.remove(); bgIn.click(); }); pop.append(imp);
        popAt(pop, anchor, -160);
    }
    async function insertPage(at, paper = 'liniert', bgs = [null]) {
        await flush();
        const ids = await createPages(doc, bgs, paper, at).catch(e => { alert('Seite konnte nicht angelegt werden: ' + e.message); return []; }); if (!ids.length) return;
        doc.pages.splice(at, 0, ...ids); pages.splice(at, 0, ...ids.map(id => ({ id }))); ctx.persist?.(); rebuild(); scrollToPage(at);
    }
    async function duplicatePage(i) { await flush(); const id = await copyPage(pages[i].id, doc.id).catch(() => null); if (!id) return; doc.pages.splice(i + 1, 0, id); pages.splice(i + 1, 0, { id }); ctx.persist?.(); rebuild(); scrollToPage(i + 1); }
    async function deletePage(i) {
        if (pages.length <= 1) { alert('Ein Notizbuch braucht mindestens eine Seite.'); return; }
        if (!confirm(`Seite ${i + 1} löschen?`)) return;
        const [pg] = pages.splice(i, 1); doc.pages.splice(i, 1); doc.bookmarks = doc.bookmarks.filter(b => b !== pg.id); ctx.persist?.();
        apiJson('/study/pages/' + pg.id, { method: 'DELETE' }).catch(() => {}); st.undo = st.undo.filter(a => a.pg !== pg); st.redo = st.redo.filter(a => a.pg !== pg); st.cur = Math.min(st.cur, pages.length - 1); rebuild();
    }
    function movePage(i, d) { const j = i + d; if (j < 0 || j >= pages.length) return; [pages[i], pages[j]] = [pages[j], pages[i]]; [doc.pages[i], doc.pages[j]] = [doc.pages[j], doc.pages[i]]; ctx.persist?.(); rebuild(); scrollToPage(j); }
    function toggleBookmark(i) { const id = pages[i]?.id; if (!id) return; doc.bookmarks = doc.bookmarks.includes(id) ? doc.bookmarks.filter(b => b !== id) : [...doc.bookmarks, id]; ctx.persist?.(); pages[i].wrap?.classList.toggle('marked', doc.bookmarks.includes(id)); updateLabel(); if (st.sidebar) drawSidebar(); }
    async function setPaper(i, paper) { const pg = pages[i]; await ensureData(pg); pg.data.paper = paper; markDirty(pg); if (pg.view) paintBg(pg); }
    async function importBackgrounds(files) {
        if (!files.length) return; const busy = overlay('Wird eingefügt …', 'Seiten werden vorbereitet');
        try {
            const bgs = await filesToBackgrounds(files); if (!bgs.length) throw new Error('Nur Fotos oder PDFs gehen.');
            const pg = pages[st.cur]; if (pg) await ensureData(pg);
            if (pg && !pg.data.strokes.length && !pg.data.bg && !pg.data.text.length && !pg.data.items.length) { pg.data.bg = bgs.shift(); pg.data.paper = 'blanko'; markDirty(pg, { bg: true }); if (pg.view) paintBg(pg); await flush(); }
            if (bgs.length) await insertPage(st.cur + 1, 'blanko', bgs);
        } catch (e) { alert(e.message); } finally { busy.remove(); }
    }

    // ---------- Seitenleiste (Vorschauen) ----------
    let sideFilter = false, sideSeq = 0;
    function drawSidebar() {
        const seq = ++sideSeq;
        const head = el('div', 'ink-side-head'); const all = el('button', sideFilter ? '' : 'on', 'Alle Seiten'), bm = el('button', sideFilter ? 'on' : '', `Lesezeichen (${doc.bookmarks.length})`);
        all.type = bm.type = 'button'; all.addEventListener('click', () => { sideFilter = false; drawSidebar(); }); bm.addEventListener('click', () => { sideFilter = true; drawSidebar(); }); head.append(all, bm);
        const list = el('div', 'ink-thumbs');
        pages.forEach((pg, i) => {
            if (sideFilter && !doc.bookmarks.includes(pg.id)) return;
            const t = el('div', 'ink-thumb' + (i === st.cur ? ' on' : '')); t.dataset.i = i; const im = el('img'); im.alt = ''; im.draggable = false;
            const lab = el('div', 'ink-thumb-l'); lab.append(el('span', '', String(i + 1))); if (doc.bookmarks.includes(pg.id)) lab.append(icon('bookmark'));
            const m = btn('more_vert', 'Seitenaktionen', (e) => { e.stopPropagation(); pageMenu(e.currentTarget, i); }); m.classList.add('ink-thumb-m');
            t.append(im, lab, m); t.addEventListener('click', () => scrollToPage(i)); list.append(t);
            (async () => { if (!pg.thumb) { await ensureData(pg); pg.thumb = await pageImage({ ...pg.data }, { width: 150, quality: 0.7 }); } if (seq === sideSeq) im.src = pg.thumb; })();
        });
        side.replaceChildren(head, list);
    }
    function pageMenu(anchor, i) {
        document.querySelector('.ink-pop')?.remove(); const pop = el('div', 'ink-pop ink-menu');
        const it = (ic, l, fn) => pop.append(btn(ic, l, () => { pop.remove(); fn(); }, 'labeled'));
        it('vertical_align_top', 'Seite davor einfügen', () => insertPage(i, pages[i].data?.paper || 'liniert'));
        it('vertical_align_bottom', 'Seite danach einfügen', () => insertPage(i + 1, pages[i].data?.paper || 'liniert'));
        it('content_copy', 'Duplizieren', () => duplicatePage(i));
        it('bookmark', doc.bookmarks.includes(pages[i].id) ? 'Lesezeichen entfernen' : 'Lesezeichen setzen', () => toggleBookmark(i));
        it('wallpaper', 'Vorlage ändern', () => templateMenu(anchor, (t) => setPaper(i, t)));
        it('arrow_upward', 'Nach oben', () => movePage(i, -1)); it('arrow_downward', 'Nach unten', () => movePage(i, 1));
        if (pages[i].data?.correction) it('ink_eraser', 'Korrektur entfernen', () => removeCorrection(pages[i]));
        it('delete', 'Seite löschen', () => deletePage(i));
        popAt(pop, anchor, 30);
    }
    function moreMenu(anchor) {
        document.querySelector('.ink-pop')?.remove(); const pop = el('div', 'ink-pop ink-menu');
        const it = (ic, l, fn) => pop.append(btn(ic, l, () => { pop.remove(); fn(); }, 'labeled'));
        if (window.matchMedia('(max-width: 700px)').matches) {
            it('chat', st.panelMode === 'chat' ? 'Coden Chat schließen' : 'Coden Chat öffnen', () => toggleChat());
            it('functions', st.panelMode === 'formulas' ? 'Formeln schließen' : 'Formeln & Rechner', () => toggleFormulas());
            if (doneB) it('task_alt', 'Fertig & abgeben', () => finish());
            it('note_add', 'Seite hinzufügen', () => templateMenu(anchor, (t) => insertPage(st.cur + 1, t)));
            const on = doc.bookmarks.includes(pages[st.cur]?.id); it(on ? 'bookmark_remove' : 'bookmark', on ? 'Lesezeichen entfernen' : 'Lesezeichen setzen', () => toggleBookmark(st.cur));
        }
        it('picture_as_pdf', 'Als PDF exportieren', () => exportPdf());
        it('upload_file', 'PDF / Fotos importieren', () => bgIn.click());
        it('wallpaper', 'Vorlage dieser Seite', () => templateMenu(anchor, (t) => setPaper(st.cur, t)));
        it('stylus_note', 'Handschrift trainieren', () => import('./handwriting.js').then(m => m.openHandwritingTrainer()));
        if (pages[st.cur]?.data?.strokes?.some(s => s.o === 'coden')) it('ink_eraser', 'Coden-Schrift auf Seite entfernen', () => removeCodenStrokes(pages[st.cur]));
        it('zoom_in', 'Größer', () => setZoom(st.zoom * 1.2)); it('zoom_out', 'Kleiner', () => setZoom(st.zoom / 1.2)); it('fit_width', 'Seitenbreite', () => setZoom(1));
        it(st.showCorr ? 'visibility_off' : 'visibility', st.showCorr ? 'Korrekturen ausblenden' : 'Korrekturen einblenden', () => { st.showCorr = !st.showCorr; pages.forEach(paintMarks); });
        if (pages[st.cur]?.data?.correction) it('ink_eraser', 'Korrektur dieser Seite entfernen', () => removeCorrection(pages[st.cur]));
        popAt(pop, anchor, -200);
    }
    function setZoom(z) { zoomAt(z, stage.clientWidth / 2, stage.clientHeight / 2); }
    function scrollToPage(i, keep = false) { const pg = pages[i]; if (!pg?.wrap) return; if (keep) { const r = pg.wrap.getBoundingClientRect(), s = stage.getBoundingClientRect(); if (r.bottom > s.top && r.top < s.bottom) return; } const r = pg.wrap.getBoundingClientRect(), s = stage.getBoundingClientRect(); stage.scrollTo({ top: stage.scrollTop + r.top - s.top - 16, left: stage.scrollLeft + r.left - s.left - Math.max(16, (s.width - r.width) / 2), behavior: 'smooth' }); st.cur = i; updateLabel(); }
    function updateLabel() {
        pageLbl.textContent = `${st.cur + 1} / ${pages.length}`;
        const on = doc.bookmarks.includes(pages[st.cur]?.id); markB.classList.toggle('on', on); markB.querySelector('.material-symbols-outlined').textContent = on ? 'bookmark_added' : 'bookmark';
        side.querySelectorAll('.ink-thumb').forEach(t => t.classList.toggle('on', +t.dataset.i === st.cur));
        showPanel();
    }
    stage.addEventListener('scroll', () => {
        const s = stage.getBoundingClientRect(); const mid = s.top + s.height / 2; let best = st.cur, bd = Infinity;
        pages.forEach((pg, i) => { if (!pg.wrap) return; const r = pg.wrap.getBoundingClientRect(); const d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid)); if (d < bd) { bd = d; best = i; } });
        if (best !== st.cur) { st.cur = best; updateLabel(); }
    }, { passive: true });

    // ---------- Live mit Coden (über die Aufgabe reden, Coden sieht die Seite) ----------
    let liveTimer = 0, liveSent = '';
    async function sendPage(force = false) {
        const pg = pages[st.cur]; if (!pg?.data || !liveActive()) return;
        const key = pg.id + ':' + (pg.rev || 0); if (!force && key === liveSent) return; liveSent = key;
        try { const img = await pageImage({ ...pg.data }, { width: 900, quality: 0.6, correction: false }); if (force) sendLiveNote(`(Ich bin auf Seite ${st.cur + 1} von ${pages.length}. Hier ist die Seite.)`); sendLiveImage(img); } catch (_) {}
    }
    function toggleLive() {
        if (liveActive()) { stopLive(); return; }
        const pg = pages[st.cur];
        const ok = startStudyLive({
            compact: true, subject: ctx.subjectName || '', page: `${st.cur + 1} von ${pages.length} im Notizbuch „${doc.title || ''}“`,
            task: ctx.assignment ? `${ctx.assignment.title}\n${ctx.assignment.desc || ''}` : (pg?.data?.bg ? 'Die Aufgabe steht auf dem Arbeitsblatt, das du gleich als Bild bekommst.' : ''),
            onReady: () => { liveB.classList.add('on'); liveSent = ''; sendPage(true); clearInterval(liveTimer); liveTimer = setInterval(() => sendPage(false), 4000); },
            onEnd: () => { clearInterval(liveTimer); liveB.classList.remove('on'); }
        });
        if (ok) liveB.classList.add('on');
    }

    // ---------- Seitenleiste rechts: Korrektur, Formeln & Coden Chat ----------
    const CHAT_KEY = 'coden_nb_chat_' + doc.id;
    const CHAT_TIER_KEY = 'coden_nb_chat_tier';
    const CHAT_HW_KEY = 'coden_nb_chat_hw';
    const STARTERS = [
        'Erkläre mir, was auf dieser Seite steht',
        'Prüfe meinen Rechenweg und zeig mir Fehler',
        'Schreib die Lösung in meiner Handschrift ins Heft',
        'Fasse das Thema in meiner Handschrift zusammen'
    ];
    let chatMsgs = [];
    try { const saved = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]'); if (Array.isArray(saved)) chatMsgs = saved.slice(-40); } catch (_) {}
    let chatTier = 'flash';
    try { chatTier = localStorage.getItem(CHAT_TIER_KEY) || 'flash'; } catch (_) {}
    let chatHwMode = false;
    try { chatHwMode = localStorage.getItem(CHAT_HW_KEY) === '1'; } catch (_) {}
    let chatIncludePage = true, chatBusy = false, chatAc = null, clearArm = 0;

    const saveChatMsgs = () => { try { localStorage.setItem(CHAT_KEY, JSON.stringify(chatMsgs.slice(-40))); } catch (_) {} };
    const cleanNbReply = (raw, { streaming = false } = {}) => {
        let s = hideNotebookTags(String(raw || ''));
        s = stripNotebookWriteTags(s, streaming
            ? { replacement: '\n> ✓ *In deiner Handschrift ins Heft geschrieben.*\n', streamingPlaceholder: '\n> *Schreibt in deiner Handschrift ins Heft …*\n' }
            : { replacement: '\n> ✓ *In deiner Handschrift ins Heft geschrieben.*\n', streamingPlaceholder: '' });
        return s
            .replace(/<suggestions>[\s\S]*?(<\/suggestions>|$)/gi, '')
            .replace(/<choices>[\s\S]*?(<\/choices>|$)/gi, '')
            .replace(/<(suggestions|choices|remember|app_write|mcp_call)[^>]*$/i, '')
            .trim();
    };
    const toPlainPageText = (md) => String(md || '')
        .replace(/<\/?(?:handwriting|notebook_write)[^>]*>/gi, '')
        .replace(/==\s*(?:[a-zäöü]+\s*:)?([\s\S]*?)==/gi, '$1')
        .replace(/\{\{\s*[a-zäöü]+\s*:([\s\S]*?)\}\}/gi, '$1')
        .replace(/```[\s\S]*?```/g, m => m.replace(/```[^\n]*\n?|```/g, ''))
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim()
        .slice(0, 1800);

    // Bereitet Chat- oder Formelinhalte sauber fürs Handschrift-Heft auf (behält # Titel & ==Marker==)
    function prepareNotebookHandwriting(rawText) {
        const raw = String(rawText || '').trim();
        const tagBodies = [];
        const re = /<(?:notebook_write|handwriting)\b[^>]*>([\s\S]*?)<\/(?:notebook_write|handwriting)>/gi;
        let m;
        while ((m = re.exec(raw))) {
            const b = String(m[1] || '').trim();
            if (b) tagBodies.push(b);
        }
        let s = tagBodies.length ? tagBodies.join('\n\n') : raw;
        s = s
            .replace(/\r\n?/g, '\n')
            .replace(/^>\s*[✓]*\s*\*In deiner Handschrift.*$/gim, '')
            .replace(/\\frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, '($1)/($2)')
            .replace(/\\sqrt\s*\{([^}]+)\}/g, '√($1)')
            .replace(/\\(cdot|times)/g, (_, k) => (k === 'times' ? '×' : '·'))
            .replace(/\\(pm|approx|neq|leq|le|geq|ge|to|rightarrow|leftarrow|pi|alpha|beta)/g, (_, k) => ({
                pm: '±', approx: '≈', neq: '≠', leq: '≤', le: '≤', geq: '≥', ge: '≥',
                to: '→', rightarrow: '→', leftarrow: '←', pi: 'π', alpha: 'α', beta: 'β'
            }[k] || k))
            .replace(/\^([0-9+-])/g, (_, d) => ({ '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '⁺' }[d] || '^' + d))
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/^\s*[-*]\s+/gm, '• ')
            .replace(/\$+/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return s.slice(0, 2600);
    }

    function nextFreeY(pgData) {
        let maxY = 0;
        for (const s of (pgData?.strokes || [])) {
            for (let i = 1; i < s.p.length; i += 3) {
                if (s.p[i] > maxY) maxY = s.p[i];
            }
        }
        for (const t of (pgData?.text || [])) {
            const lines = String(t.s || '').split('\n').length;
            const b = (t.y || 0) + lines * (t.z || 22) * 1.35;
            if (b > maxY) maxY = b;
        }
        for (const it of (pgData?.items || [])) {
            const b = (it.y || 0) + (it.h || 0);
            if (b > maxY) maxY = b;
        }
        return maxY > 0 ? maxY + 34 : null;
    }

    async function writeHandwritingToNotebook(rawText, { mode = 'append', paper = null, ink = null } = {}) {
        const clean = prepareNotebookHandwriting(rawText);
        if (!clean) { toast2('Nichts zum Schreiben vorhanden.'); return 0; }
        let idx = st.cur;
        let pg = pages[idx];
        if (!pg) return 0;
        await ensureData(pg);

        const prof = activeProfile(StudyStore.handwriting());
        const { strokesForNotebookPage } = await import('./handwriting.js');
        const targetPaper = paper || pg.data.paper || doc.paper || 'liniert';
        const startY = mode === 'new' ? null : nextFreeY(pg.data);
        const res = strokesForNotebookPage(clean, prof, { paper: targetPaper, ink, origin: 'coden', seed: 5 + idx, startY });

        let pageOffset = 0;
        if (mode === 'new' || res.startedOnNewPage) {
            // Auf neuer Seite direkt hinter aktueller Seite starten
            const newIds = await createPages(doc, [null], res.paper || targetPaper, idx + 1);
            if (newIds.length) {
                const newPg = { id: newIds[0], data: { paper: res.paper || targetPaper, strokes: res.pages[0].slice(), text: [], items: [], bg: null, correction: null } };
                doc.pages.splice(idx + 1, 0, newPg.id);
                pages.splice(idx + 1, 0, newPg);
                markDirty(newPg);
                pageOffset = 1;
            }
        } else {
            const before = clone(pg.data);
            pg.data.strokes.push(...res.pages[0]);
            commit(pg, before);
            if (pg.view) paintInk(pg);
        }

        // Überlaufende Seiten sauber dahinter anhängen
        if (res.pages.length > 1) {
            const insertAt = idx + 1 + pageOffset;
            const extraBgs = Array(res.pages.length - 1).fill(null);
            const extraIds = await createPages(doc, extraBgs, res.paper || targetPaper, insertAt);
            for (let k = 0; k < extraIds.length; k++) {
                const np = { id: extraIds[k], data: { paper: res.paper || targetPaper, strokes: res.pages[k + 1].slice(), text: [], items: [], bg: null, correction: null } };
                doc.pages.splice(insertAt + k, 0, np.id);
                pages.splice(insertAt + k, 0, np);
                markDirty(np);
            }
            ctx.persist?.();
            rebuild();
            scrollToPage(idx + pageOffset);
        } else if (pageOffset > 0) {
            ctx.persist?.();
            rebuild();
            scrollToPage(idx + pageOffset);
        }

        await flush();
        toast2(`In Handschrift (${prof.name}) ins Heft geschrieben`);
        return res.pages.length;
    }

    function removeCodenStrokes(pg) {
        if (!pg?.data) return;
        const keep = pg.data.strokes.filter(s => s.o !== 'coden');
        if (keep.length === pg.data.strokes.length) return;
        const before = clone(pg.data);
        pg.data.strokes = keep;
        commit(pg, before);
        repaint(pg);
        toast2('Coden-Handschrift entfernt');
    }

    async function insertTextOnPage(rawText) {
        const pg = pages[st.cur]; if (!pg) return;
        await ensureData(pg);
        const txt = toPlainPageText(rawText); if (!txt) return;
        const before = clone(pg.data);
        const y = Math.max(90, Math.min(PAGE_H - 220, Math.round(visibleY(pg) - 40)));
        pg.data.text.push({ x: 112, y, s: txt, c: '#1b1f2a', z: 22 });
        commit(pg, before); paintText(pg);
        toast2('Auf Seite eingefügt');
    }

    // Persistentes Chat-UI (bleibt beim Seitenblättern erhalten, damit Fokus & Scroll nicht verloren gehen)
    const chatBox = el('div', 'ink-chat');
    const chatHead = el('div', 'ink-chat-head');
    const chatMeta = el('div', 'ink-chat-meta');
    const chatTitleEl = el('b', '', 'Coden Chat');
    const chatSubEl = el('small', '');
    chatMeta.append(chatTitleEl, chatSubEl);
    const chatSwitchCorr = el('button', 'ink-chat-tab', 'Korrektur'); chatSwitchCorr.type = 'button';
    chatSwitchCorr.addEventListener('click', () => { const pg = pages[st.cur]; if (pg) pg._panelClosed = false; st.panelMode = 'corr'; showPanel(); });
    const chatClearB = btn('delete_sweep', 'Chatverlauf leeren', () => {
        if (!chatMsgs.length || chatBusy) return;
        if (!clearArm) {
            clearArm = setTimeout(() => { clearArm = 0; chatClearB.classList.remove('danger'); chatClearB.title = 'Chatverlauf leeren'; }, 3000);
            chatClearB.classList.add('danger'); chatClearB.title = 'Nochmal tippen zum Leeren'; toast2('Nochmal tippen zum Leeren'); return;
        }
        clearTimeout(clearArm); clearArm = 0; chatClearB.classList.remove('danger'); chatClearB.title = 'Chatverlauf leeren';
        chatMsgs = []; saveChatMsgs(); renderChatMsgs(); toast2('Chat geleert');
    });
    const chatCloseB = btn('close', 'Schließen', () => { st.panelMode = null; showPanel(); });
    chatHead.append(chatMeta, chatSwitchCorr, chatClearB, chatCloseB);

    const chatMsgsEl = el('div', 'ink-chat-msgs');
    const chatComp = el('div', 'ink-chat-comp');
    const chatBar = el('div', 'ink-chat-bar');
    const chatPageLbl = el('label', 'ink-chat-chk');
    const chatPageChk = el('input'); chatPageChk.type = 'checkbox'; chatPageChk.checked = chatIncludePage;
    chatPageChk.addEventListener('change', () => { chatIncludePage = chatPageChk.checked; });
    const chatPageSpan = el('span', '', 'Seite 1 mitsenden');
    chatPageLbl.append(chatPageChk, chatPageSpan);
    const chatHwLbl = el('label', 'ink-chat-chk');
    chatHwLbl.title = 'Coden schreibt Antworten direkt in deiner Handschrift auf die Heftseite';
    const chatHwChk = el('input'); chatHwChk.type = 'checkbox'; chatHwChk.checked = chatHwMode;
    chatHwChk.addEventListener('change', () => {
        chatHwMode = chatHwChk.checked;
        try { localStorage.setItem(CHAT_HW_KEY, chatHwMode ? '1' : '0'); } catch (_) {}
    });
    chatHwLbl.append(chatHwChk, el('span', '', 'Handschrift ins Heft'));
    const chatTierSel = el('select', 'ink-chat-tier'); chatTierSel.title = 'Modell wählen';
    chatTierSel.addEventListener('change', () => { chatTier = chatTierSel.value; try { localStorage.setItem(CHAT_TIER_KEY, chatTier); } catch (_) {} });
    chatBar.append(chatPageLbl, chatHwLbl, chatTierSel);

    const chatRow = el('div', 'ink-chat-row');
    const chatIn = el('textarea', 'ink-chat-in'); chatIn.rows = 1; chatIn.placeholder = 'Frage Coden oder lass ihn in deiner Handschrift schreiben …';
    const chatSendB = btn('arrow_upward', 'Senden', () => { if (chatBusy) chatAc?.abort(); else sendNotebookChat(); }, 'primary ink-chat-send');
    chatRow.append(chatIn, chatSendB);
    chatComp.append(chatBar, chatRow);
    chatBox.append(chatHead, chatMsgsEl, chatComp);

    const autoGrowChatIn = () => { chatIn.style.height = 'auto'; chatIn.style.height = Math.min(120, Math.max(38, chatIn.scrollHeight)) + 'px'; };
    chatIn.addEventListener('input', autoGrowChatIn);
    chatIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendNotebookChat(); }
    });

    function syncChatChrome() {
        chatSubEl.textContent = `${doc.title || 'Notizbuch'} · Seite ${st.cur + 1}/${pages.length}`;
        chatPageSpan.textContent = `Seite ${st.cur + 1}`;
        chatSwitchCorr.hidden = !pages[st.cur]?.data?.correction;
        const builtins = [['flash', 'Coden Flash'], ['normal', 'Thinking'], ['pro', 'Coden Pro']];
        const own = ownTiers().map(t => [t.tier, t.label]);
        const opts = [...builtins, ...own];
        if (!opts.some(([v]) => v === chatTier)) chatTier = 'flash';
        chatTierSel.replaceChildren(...opts.map(([v, l]) => { const o = el('option', '', l); o.value = v; return o; }));
        chatTierSel.value = chatTier;
    }

    function renderMsgActions(text) {
        const acts = el('div', 'ink-chat-acts');
        const hwB = btn('stylus_note', 'In Handschrift ins Heft', () => writeHandwritingToNotebook(text), 'labeled');
        const insB = btn('post_add', 'Als Text einfügen', () => insertTextOnPage(text), 'labeled');
        const copyB = btn('content_copy', 'Kopieren', async () => {
            try { await navigator.clipboard.writeText(text); toast2('Kopiert'); } catch (_) {}
        }, 'labeled');
        acts.append(hwB, insB, copyB);
        return acts;
    }

    function createMsgNode(m) {
        const item = el('div', 'ink-chat-msg ' + (m.role === 'user' ? 'user' : 'ai') + (m.failed ? ' err' : ''));
        if (m.role === 'user') {
            if (m.page) item.append(el('div', 'ink-chat-ctx', `Seite ${m.page} im Blick`));
            item.append(el('div', 'ink-chat-bubble', m.text));
            return item;
        }
        const metaParts = [m.thinkSecs ? `${m.thinkSecs} s nachgedacht` : '', m.model || ''].filter(Boolean);
        if (metaParts.length) item.append(el('div', 'ink-chat-meta-line', metaParts.join(' · ')));
        const body = renderRichBlock(m.text || '');
        body.classList.add('ink-chat-md');
        item.append(body);
        if (m.text && !m.failed) item.append(renderMsgActions(m.rawText || m.text));
        return item;
    }

    function renderChatMsgs() {
        if (!chatMsgs.length) {
            const empty = el('div', 'ink-chat-empty');
            empty.append(el('b', '', 'Coden hilft dir direkt im Heft'), el('p', '', 'Stelle Fragen zur aktuellen Seite oder lass dir einen Schritt erklären.'));
            const list = el('div', 'ink-chat-starters');
            STARTERS.forEach(s => {
                const b = el('button', 'ink-chat-starter', s); b.type = 'button';
                b.addEventListener('click', () => sendNotebookChat(s));
                list.append(b);
            });
            empty.append(list);
            chatMsgsEl.replaceChildren(empty);
            return;
        }
        chatMsgsEl.replaceChildren(...chatMsgs.map(createMsgNode));
        chatMsgsEl.scrollTop = chatMsgsEl.scrollHeight;
    }
    renderChatMsgs();

    async function sendNotebookChat(preset) {
        if (chatBusy) return;
        const text = String(preset ?? chatIn.value).trim();
        if (!text) return;
        if (preset == null) { chatIn.value = ''; autoGrowChatIn(); }

        const usedPage = chatIncludePage ? st.cur + 1 : null;
        const userMsg = { id: 'm' + Date.now().toString(36), role: 'user', text, ...(usedPage ? { page: usedPage } : {}) };
        chatMsgs.push(userMsg); saveChatMsgs();
        if (chatMsgs.length === 1) renderChatMsgs();
        else chatMsgsEl.append(createMsgNode(userMsg));

        chatBusy = true;
        chatAc = new AbortController();
        chatSendB.querySelector('.material-symbols-outlined').textContent = 'stop';
        chatSendB.title = 'Stoppen'; chatSendB.classList.add('stop');

        const aiNode = el('div', 'ink-chat-msg ai');
        const statusEl = el('div', 'ink-chat-meta-line', usedPage ? `Schaut Seite ${usedPage} an …` : 'Denkt nach …');
        const bodyEl = el('div', 'md ink-chat-md');
        aiNode.append(statusEl, bodyEl);
        chatMsgsEl.append(aiNode);
        chatMsgsEl.scrollTop = chatMsgsEl.scrollHeight;

        const t0 = Date.now();
        let finalText = '', modelUsed = '', failed = false;
        try {
            let snap = null;
            if (usedPage) {
                snap = await captureLivePageSnapshot({ doc, pageIndex: st.cur, pages, ensureData, pageImage }).catch(() => null);
            }
            const nbCatalog = StudyStore.notebooksContext({ currentDocId: doc.id, currentPage: st.cur + 1 });
            const studyCtx = StudyStore.context();
            const hwCtx = StudyStore.handwritingContext();
            const wantDirectWrite = chatHwMode || handwritingRequested(text) || /\b(ins\s+heft|auf\s+(?:die|das)\s+(?:seite|blatt)|hier\s+aufs?\s+blatt|direkt\s+(?:auf|ins)|schreib\s+(?:es|mir|das)\s+(?:rein|auf))\b/i.test(text);
            const hwProfile = activeProfile(StudyStore.handwriting());
            const sysExtras = [
                `## KONTEXT: SEITENLEISTE IM NOTIZBUCH (Coden Heft)`,
                `Du chattest gerade direkt neben dem Notizbuch „${doc.title || 'Notizbuch'}“ (ID: ${doc.id}, aktuell Seite ${st.cur + 1} von ${pages.length}, Vorlage: ${pages[st.cur]?.data?.paper || doc.paper || 'liniert'}).`,
                ctx.subjectName ? `Fach: ${ctx.subjectName}` : '',
                ctx.assignment ? `Verknüpfter Auftrag: ${ctx.assignment.title}${ctx.assignment.due ? ` (Abgabe ${fmtDate(ctx.assignment.due)})` : ''}${ctx.assignment.desc ? '\n' + ctx.assignment.desc : ''}` : '',
                `Antworte klar, hilfreich und kompakt. Du kannst bei Bedarf auch andere Seiten dieses Notizbuchs oder andere Notizbücher des Nutzers über <notebook_read id="…" page="…"/> nachschlagen.`,
                `## DIREKT IN DER HANDSCHRIFT DES NUTZERS INS HEFT SCHREIBEN (<notebook_write>)
Wenn der Nutzer möchte, dass du etwas direkt ins Heft/auf die Seite oder in seiner Handschrift („${hwProfile.name}“) schreibst${wantDirectWrite ? ' (GENAU JETZT AKTIV GEWÜNSCHT!)' : ''}, gib den Heftaufschrieb in EINEM \`<notebook_write>\`-Block aus:
<notebook_write page="current">
# Kurze Überschrift
• Saubere Stichpunkte, Gleichungen oder Antwortsätze
a) 3x+6=21 |-6
• x=5
</notebook_write>
Regeln für \`<notebook_write>\`:
- Coden überträgt diesen Block automatisch als echte Handschrift-Striche in der trainierten Handschrift des Nutzers auf das Papier!
- Schreibe darin wie ein Schüler ins Heft: \`# Titel\`, \`==wichtig==\` (Textmarker), kurze Zeilen, Unicode-Mathe (\`x²\`, \`√(…)\`, \`·\`, \`±\`, \`→\`, \`=\`), KEIN \`$\`-LaTeX und KEIN \`**\`-Markdown.
- Verwende \`page="new"\`, wenn ausdrücklich eine neue Seite gewünscht ist, sonst \`page="current"\`.
- Schreibe außerhalb von \`<notebook_write>\` höchstens 1–2 kurze Begleitsätze.${wantDirectWrite ? '\nWICHTIG: Antworte AUF JEDEN FALL mit einem vollständigen `<notebook_write>`-Block!' : ''}`,
                hwCtx,
                nbCatalog,
                studyCtx
            ].filter(Boolean).join('\n\n');

            const sysPrompt = buildChatPrompt({ extras: sysExtras });
            const apiHistory = chatMsgs.slice(-18, -1).map(m => ({ role: m.role, content: m.rawText || m.text }));
            const curPrompt = snap
                ? `${text}\n\n[Aktuelle Notizbuch-Seite ${snap.pageNum} von ${pages.length}]\n${snap.text}`
                : text;
            const context = [
                { role: 'system', content: sysPrompt },
                ...apiHistory,
                { role: 'user', content: curPrompt, ...(snap?.image ? { images: [snap.image] } : {}) }
            ];

            let shownPrefix = '', thinkSecs = 0;
            const collectedWrites = [];
            for (let round = 0; round < 4; round++) {
                let roundText = '';
                const reply = await streamAiResponse(context, chatTier, {
                    signal: chatAc.signal,
                    effort: isByokTier(chatTier) ? byokEffort(chatTier) : undefined,
                    onModel: (m) => { modelUsed = m; statusEl.textContent = m; },
                    onThink: (k) => { if (k?.h) statusEl.textContent = k.h + (modelUsed ? ' · ' + modelUsed : ''); },
                    onDelta: (full) => {
                        roundText = full;
                        const vis = cleanNbReply(full, { streaming: true });
                        const merged = [shownPrefix, vis].filter(Boolean).join('\n\n');
                        const rendered = renderRichBlock(merged);
                        bodyEl.replaceChildren(...rendered.childNodes);
                        chatMsgsEl.scrollTop = chatMsgsEl.scrollHeight;
                    }
                });
                roundText = reply || roundText;
                const nbReqs = round < 3 ? parseNotebookReads(roundText, { allowUnclosed: true }) : [];
                if (nbReqs.length) {
                    const pre = cleanNbReply(roundText);
                    shownPrefix = [shownPrefix, pre].filter(Boolean).join('\n\n');
                    statusEl.textContent = `Liest Notizbuch (${nbReqs.map(r => r.ref).join(', ')}) …`;
                    const res = await readNotebookRequests(nbReqs, { loadPage, pageImage, liveDoc: doc, livePages: pages, ensureLiveData: ensureData });
                    context.push({ role: 'assistant', content: roundText.trim() });
                    context.push({ role: 'user', content: res.modelPrompt, ...(res.images.length ? { images: res.images } : {}) });
                    shownPrefix = [shownPrefix, `> [!NOTE]\n> Angesehen: ${res.srcLabel} (${res.noteLabel})`].filter(Boolean).join('\n\n');
                    continue;
                }
                collectedWrites.push(...parseNotebookWrites(roundText));
                finalText = [shownPrefix, cleanNbReply(roundText)].filter(Boolean).join('\n\n');
                thinkSecs = Math.max(0, Math.round((Date.now() - t0) / 1000));
                break;
            }
            if (!finalText.trim() && chatAc.signal.aborted) {
                finalText = '⏹️ *Generierung gestoppt.*';
                failed = true;
            } else if (!finalText.trim()) {
                finalText = '⚠️ Keine Antwort erhalten. Bitte versuche es noch einmal.';
                failed = true;
            }
            let writtenBody = '';
            if (!failed && collectedWrites.length) {
                for (const w of collectedWrites) {
                    await writeHandwritingToNotebook(w.text, { mode: w.mode, paper: w.paper || null, ink: w.ink || null });
                }
                writtenBody = collectedWrites.map(w => w.text).join('\n\n');
            }
            const metaLine = [thinkSecs ? `${thinkSecs} s` : '', modelUsed].filter(Boolean).join(' · ');
            statusEl.textContent = metaLine || 'Coden';
            const rendered = renderRichBlock(finalText);
            bodyEl.replaceChildren(...rendered.childNodes);
            const actionSource = writtenBody || finalText;
            if (!failed) aiNode.append(renderMsgActions(actionSource));
            if (failed) aiNode.classList.add('err');
            chatMsgs.push({ id: 'a' + Date.now().toString(36), role: 'assistant', text: finalText, ...(writtenBody ? { rawText: writtenBody } : {}), ...(modelUsed ? { model: modelUsed } : {}), ...(thinkSecs ? { thinkSecs } : {}), ...(failed ? { failed: true } : {}) });
            saveChatMsgs();
        } catch (err) {
            if (chatAc?.signal?.aborted) {
                finalText = cleanNbReply(bodyEl.textContent) ? finalText : '⏹️ *Generierung gestoppt.*';
            } else {
                finalText = '❌ ' + (err.message || 'Chat fehlgeschlagen.');
            }
            failed = true;
            aiNode.classList.add('err');
            statusEl.textContent = 'Hinweis';
            const rendered = renderRichBlock(finalText);
            bodyEl.replaceChildren(...rendered.childNodes);
            chatMsgs.push({ id: 'a' + Date.now().toString(36), role: 'assistant', text: finalText, failed: true });
            saveChatMsgs();
        } finally {
            chatBusy = false; chatAc = null;
            chatSendB.querySelector('.material-symbols-outlined').textContent = 'arrow_upward';
            chatSendB.title = 'Senden'; chatSendB.classList.remove('stop');
            chatMsgsEl.scrollTop = chatMsgsEl.scrollHeight;
        }
    }

    function toggleChat(force) {
        const open = typeof force === 'boolean' ? force : st.panelMode !== 'chat';
        st.panelMode = open ? 'chat' : null;
        showPanel();
        if (open) setTimeout(() => { syncChatChrome(); chatIn.focus(); }, 20);
    }

    // ---------- Formelsammlung & Einheiten-Helfer (Feature #6) ----------
    let formulaTab = 'formulas';
    let formulaSubj = 'alle';
    let formulaQuery = '';
    let unitCatId = UNIT_CATEGORIES[0].id;
    let unitFromId = UNIT_CATEGORIES[0].units[1].id;
    let unitToId = UNIT_CATEGORIES[0].units[3].id;
    let unitVal = '100';
    let calcExpr = '2 * pi * 5';

    const formulaBox = el('div', 'ink-formulas');
    function buildFormulaPanel() {
        formulaBox.replaceChildren();
        const head = el('div', 'ink-chat-head');
        const meta = el('div', 'ink-chat-meta');
        meta.append(el('b', '', 'Formeln & Einheiten'), el('small', '', 'Nachschlagen & direkt ins Heft'));
        head.append(meta, btn('close', 'Schließen', () => { st.panelMode = null; showPanel(); }));

        const tabs = el('div', 'ink-f-tabs');
        [['formulas', 'Formelsammlung'], ['calc', 'Rechner & Einheiten']].forEach(([id, label]) => {
            const b = el('button', 'ink-f-tab' + (formulaTab === id ? ' on' : ''), label);
            b.type = 'button';
            b.addEventListener('click', () => { formulaTab = id; buildFormulaPanel(); });
            tabs.append(b);
        });
        formulaBox.append(head, tabs);

        const scroll = el('div', 'ink-f-body');
        if (formulaTab === 'formulas') {
            const search = el('input', 'ink-f-search');
            search.type = 'search'; search.placeholder = 'Formel suchen (z. B. Pythagoras, Kraft, Mol) …';
            search.value = formulaQuery;
            const listWrap = el('div', 'ink-f-list');
            const renderList = () => {
                const items = filterFormulas(formulaQuery, formulaSubj);
                if (!items.length) {
                    listWrap.replaceChildren(el('p', 'ink-f-empty', 'Keine passende Formel gefunden.'));
                    return;
                }
                listWrap.replaceChildren(...items.map(f => {
                    const card = el('div', 'ink-f-card');
                    const topRow = el('div', 'ink-f-top');
                    topRow.append(el('b', '', f.title), el('span', 'ink-f-subj', f.subject[0].toUpperCase() + f.subject.slice(1)));
                    const eq = el('div', 'ink-f-eq', f.formula);
                    const metaTxt = el('small', 'ink-f-vars', [f.vars, f.hint].filter(Boolean).join(' · '));
                    const acts = el('div', 'ink-f-acts');
                    acts.append(
                        btn('stylus_note', 'In Handschrift', () => writeHandwritingToNotebook(f.writeText), 'labeled'),
                        btn('post_add', 'Als Text', () => insertTextOnPage(f.writeText), 'labeled')
                    );
                    card.append(topRow, eq, metaTxt, acts);
                    return card;
                }));
            };
            search.addEventListener('input', () => { formulaQuery = search.value; renderList(); });
            const subjBar = el('div', 'ink-f-subjs');
            FORMULA_SUBJECTS.forEach(s => {
                const b = el('button', 'ink-f-subjbtn' + (formulaSubj === s.id ? ' on' : ''), s.label);
                b.type = 'button';
                b.addEventListener('click', () => { formulaSubj = s.id; subjBar.querySelectorAll('.ink-f-subjbtn').forEach(x => x.classList.remove('on')); b.classList.add('on'); renderList(); });
                subjBar.append(b);
            });
            scroll.append(search, subjBar, listWrap);
            renderList();
        } else {
            // Schneller Formel-Rechner
            const calcSec = el('div', 'ink-f-card');
            calcSec.append(el('b', '', 'Term-Rechner (Winkel in Grad)'));
            const cIn = el('input', 'ink-f-search'); cIn.type = 'text'; cIn.value = calcExpr; cIn.placeholder = 'z. B. sqrt(144) + 3^2 oder sin(30)';
            const cOut = el('div', 'ink-f-result');
            const cActs = el('div', 'ink-f-acts');
            const updateCalc = () => {
                calcExpr = cIn.value;
                const r = evaluateMathExpr(calcExpr);
                cOut.textContent = r.ok ? `= ${r.formatted}` : (calcExpr.trim() ? r.error : '–');
                cOut.classList.toggle('err', !r.ok && !!calcExpr.trim());
                cActs.hidden = !r.ok;
            };
            cIn.addEventListener('input', updateCalc);
            cActs.append(
                btn('stylus_note', 'Ergebnis in Handschrift', () => { const r = evaluateMathExpr(calcExpr); if (r.ok) writeHandwritingToNotebook(`${calcExpr} = ${r.formatted}`); }, 'labeled'),
                btn('post_add', 'Als Text', () => { const r = evaluateMathExpr(calcExpr); if (r.ok) insertTextOnPage(`${calcExpr} = ${r.formatted}`); }, 'labeled')
            );
            calcSec.append(cIn, cOut, cActs);
            updateCalc();

            // Einheiten-Umrechner
            const unitSec = el('div', 'ink-f-card');
            unitSec.append(el('b', '', 'Einheiten-Umrechner'));
            const catSel = el('select', 'ink-f-sel');
            UNIT_CATEGORIES.forEach(c => { const o = el('option', '', c.label); o.value = c.id; if (c.id === unitCatId) o.selected = true; catSel.append(o); });
            const valIn = el('input', 'ink-f-search'); valIn.type = 'text'; valIn.inputMode = 'decimal'; valIn.value = unitVal; valIn.placeholder = 'Wert';
            const fromSel = el('select', 'ink-f-sel');
            const toSel = el('select', 'ink-f-sel');
            const swapB = btn('swap_horiz', 'Einheiten tauschen', () => { const t = unitFromId; unitFromId = unitToId; unitToId = t; syncUnits(false); });
            const rowUnits = el('div', 'ink-f-urow'); rowUnits.append(fromSel, swapB, toSel);
            const uOut = el('div', 'ink-f-result');
            const uActs = el('div', 'ink-f-acts');

            const syncUnits = (resetDefaults = true) => {
                const cat = UNIT_CATEGORIES.find(c => c.id === unitCatId) || UNIT_CATEGORIES[0];
                if (resetDefaults) {
                    if (!cat.units.some(u => u.id === unitFromId)) unitFromId = cat.units[0].id;
                    if (!cat.units.some(u => u.id === unitToId)) unitToId = (cat.units[1] || cat.units[0]).id;
                }
                fromSel.replaceChildren(...cat.units.map(u => { const o = el('option', '', u.label); o.value = u.id; o.selected = u.id === unitFromId; return o; }));
                toSel.replaceChildren(...cat.units.map(u => { const o = el('option', '', u.label); o.value = u.id; o.selected = u.id === unitToId; return o; }));
                const r = convertUnit(unitVal, unitCatId, unitFromId, unitToId);
                const uF = cat.units.find(u => u.id === unitFromId)?.label || '';
                const uT = cat.units.find(u => u.id === unitToId)?.label || '';
                uOut.textContent = r.ok ? `${unitVal || '0'} ${uF} = ${r.formatted} ${uT}` : '–';
                uActs.hidden = !r.ok;
            };
            catSel.addEventListener('change', () => { unitCatId = catSel.value; syncUnits(true); });
            fromSel.addEventListener('change', () => { unitFromId = fromSel.value; syncUnits(false); });
            toSel.addEventListener('change', () => { unitToId = toSel.value; syncUnits(false); });
            valIn.addEventListener('input', () => { unitVal = valIn.value; syncUnits(false); });
            uActs.append(
                btn('stylus_note', 'In Handschrift', () => { if (uOut.textContent && uOut.textContent !== '–') writeHandwritingToNotebook(uOut.textContent); }, 'labeled'),
                btn('post_add', 'Als Text', () => { if (uOut.textContent && uOut.textContent !== '–') insertTextOnPage(uOut.textContent); }, 'labeled')
            );
            unitSec.append(catSel, valIn, rowUnits, uOut, uActs);
            syncUnits(false);
            scroll.append(calcSec, unitSec);
        }
        formulaBox.append(scroll);
    }

    function toggleFormulas(force) {
        const open = typeof force === 'boolean' ? force : st.panelMode !== 'formulas';
        st.panelMode = open ? 'formulas' : null;
        showPanel();
        if (open) buildFormulaPanel();
    }

    // ---------- Coden prüfen ----------
    function overlay(text, sub) {
        const o = el('div', 'ink-busy'); const box = el('div', 'ink-busy-box'); const t = el('div'); t.append(el('b', '', text), el('small', '', sub || '')); box.append(loader({ size: 40 }), t); o.append(box); root.append(o);
        o.setSub = (s) => { t.lastChild.textContent = s; }; return o;
    }
    function showPanel() {
        const pg = pages[st.cur]; const c = pg?.data?.correction;
        if (st.panelMode !== 'chat' && st.panelMode !== 'formulas') {
            st.panelMode = (c && !pg._panelClosed) ? 'corr' : null;
        }
        chatB.classList.toggle('on', st.panelMode === 'chat');
        formulaB.classList.toggle('on', st.panelMode === 'formulas');
        const wasHidden = panel.hidden;
        if (st.panelMode === 'chat') {
            panel.hidden = false;
            panel.classList.add('ink-chat-mode');
            syncChatChrome();
            if (panel.firstElementChild !== chatBox) panel.replaceChildren(chatBox);
            if (wasHidden) requestAnimationFrame(layoutAll);
            return;
        }
        if (st.panelMode === 'formulas') {
            panel.hidden = false;
            panel.classList.add('ink-chat-mode');
            if (panel.firstElementChild !== formulaBox) { buildFormulaPanel(); panel.replaceChildren(formulaBox); }
            if (wasHidden) requestAnimationFrame(layoutAll);
            return;
        }
        panel.classList.remove('ink-chat-mode');
        panel.replaceChildren();
        panel.hidden = st.panelMode !== 'corr' || !c;
        if (panel.hidden) { if (!wasHidden) requestAnimationFrame(layoutAll); return; }
        const head = el('div', 'ink-p-head'); const meta = el('div'); meta.append(el('b', '', `Korrektur · Seite ${st.cur + 1}`), el('small', '', [c.points, c.score != null ? c.score + ' %' : ''].filter(Boolean).join(' · ')));
        const toChat = btn('chat', 'Im Chat besprechen', () => toggleChat(true), 'labeled');
        head.append(el('div', 'ink-p-grade', c.grade || '–'), meta, btn('close', 'Schließen', () => { pg._panelClosed = true; st.panelMode = null; panel.hidden = true; requestAnimationFrame(layoutAll); }));
        const list = el('ul', 'ink-p-items'); (c.items || []).forEach(it => { const li = el('li', it.ok ? 'ok' : 'bad'); li.append(el('b', '', it.ok ? '✓' : '✗'), el('span', '', it.text)); if (it.fix) li.append(el('em', '', 'Richtig: ' + it.fix)); list.append(li); });
        const tips = el('div', 'ink-p-tips'); if ((c.tips || []).length) { tips.append(el('b', '', 'So wirst du besser')); const ul = el('ul'); c.tips.forEach(t => ul.append(el('li', '', t))); tips.append(ul); }
        const acts = el('div', 'ink-p-acts'); acts.append(toChat, btn('refresh', 'Nochmal prüfen', () => correct(), 'labeled'), btn(st.showCorr ? 'visibility_off' : 'visibility', st.showCorr ? 'Rot ausblenden' : 'Rot einblenden', () => { st.showCorr = !st.showCorr; pages.forEach(paintMarks); showPanel(); }, 'labeled'), btn('delete', 'Korrektur entfernen', () => removeCorrection(pg), 'labeled danger'));
        panel.append(head, el('p', 'ink-p-sum', c.summary || ''), list, tips, acts);
        if (wasHidden) requestAnimationFrame(layoutAll);
    }
    async function correct() {
        const pg = pages[st.cur]; if (!pg) return; await ensureData(pg);
        if (!pg.data.strokes.length && !pg.data.text.length) { toast2('Auf dieser Seite steht noch nichts.'); return; }
        await flush(); clearSelection();
        const busy = overlay('Coden korrigiert deine Seite …', 'Liest deine Handschrift');
        const steps = ['Liest deine Handschrift', 'Prüft jeden Rechenschritt', 'Vergleicht mit der Aufgabe', 'Schreibt Anmerkungen an den Rand'];
        let n = 0; const tm = setInterval(() => busy.setSub(steps[Math.min(steps.length - 1, ++n)]), 3500);
        try {
            const image = await pageImage({ ...pg.data }, { width: 1100, quality: 0.82 });
            const task = [ctx.assignment ? `${ctx.assignment.title}\n${ctx.assignment.desc || ''}` : '', pg.data.bg ? '(Die Aufgabe steht auf dem Arbeitsblatt im Hintergrund.)' : ''].filter(Boolean).join('\n');
            const r = await apiJson('/chat', { method: 'POST', body: JSON.stringify({ tier: 'flash', messages: [{ role: 'system', content: correctionPrompt({ subject: ctx.subjectName, task }) }, { role: 'user', content: 'Bitte korrigiere diese Heftseite.', images: [image] }] }) });
            const c = parseCorrection(r.content); if (!c) throw new Error('Coden konnte die Seite nicht sicher lesen. Schreib etwas größer oder prüfe nochmal.');
            pg.data.correction = c; pg._panelClosed = false; st.showCorr = true; st.panelMode = 'corr'; markDirty(pg, { corr: true }); await flush();
            paintMarks(pg); showPanel(); ctx.onCorrected?.(doc, { id: pg.id }, c);
        } catch (e) { toast2(e.message || 'Prüfen hat nicht geklappt.'); } finally { clearInterval(tm); busy.remove(); }
    }

    // ---------- Druckfertiger PDF-Export & Abgeben (Feature #4) ----------
    async function runPdfExport({ scope = 'all', withCorrection = true, mode = 'download' } = {}) {
        await flush();
        let targetPages = pages;
        if (scope === 'current') targetPages = pages[st.cur] ? [pages[st.cur]] : [];
        else if (scope === 'bookmarks') targetPages = pages.filter(p => doc.bookmarks.includes(p.id));
        if (!targetPages.length) { toast2('Keine passenden Seiten für den Export gefunden.'); return false; }

        const busy = overlay('Druckfertiges PDF wird erstellt …', `${targetPages.length} Seite${targetPages.length === 1 ? '' : 'n'}`);
        try {
            const imgs = [];
            for (let i = 0; i < targetPages.length; i++) {
                busy.setSub(`Rendere Seite ${i + 1} von ${targetPages.length}`);
                await ensureData(targetPages[i]);
                imgs.push(await pageImage({ ...targetPages[i].data }, { width: 1654, quality: 0.9, correction: withCorrection }));
            }
            const baseTitle = [ctx.subjectName, doc.title].filter(Boolean).join(' – ').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Notizbuch';
            if (mode === 'download') {
                busy.setSub('Erzeuge PDF-Datei …');
                const blob = buildPdfBlob(imgs);
                downloadPdfBlob(blob, safePdfFilename(baseTitle));
                busy.remove();
                toast2('PDF heruntergeladen ✓');
                return true;
            }
            document.getElementById('ink-print-root')?.remove(); const pr = el('div'); pr.id = 'ink-print-root';
            imgs.forEach(src => { const im = el('img'); im.src = src; pr.append(im); }); document.body.append(pr); document.body.classList.add('ink-printing');
            const old = document.title; document.title = baseTitle;
            const done = () => { document.body.classList.remove('ink-printing'); pr.remove(); document.title = old; window.removeEventListener('afterprint', done); };
            window.addEventListener('afterprint', done);
            await Promise.all([...pr.querySelectorAll('img')].map(i => i.decode().catch(() => {}))); busy.remove(); window.print(); return true;
        } catch (e) { busy.remove(); toast2('PDF-Export fehlgeschlagen: ' + (e.message || e)); return false; }
    }

    function exportPdf() {
        const o = el('div', 'ink-busy'); const box = el('div', 'ink-finish');
        box.append(el('h3', '', 'Als PDF exportieren'), el('p', '', 'Wähle Seitenbereich und ob rote Coden-Korrekturen mit gedruckt werden sollen.'));
        let scope = 'all';
        const bmCount = pages.filter(p => doc.bookmarks.includes(p.id)).length;
        const scopes = el('div', 'ink-pdf-scopes');
        [
            ['all', `Alle Seiten (${pages.length})`],
            ['current', `Aktuelle Seite (S. ${st.cur + 1})`],
            ...(bmCount ? [['bookmarks', `Lesezeichen (${bmCount})`]] : [])
        ].forEach(([val, lbl]) => {
            const b = el('button', 'ink-f-tab' + (val === scope ? ' on' : ''), lbl); b.type = 'button';
            b.addEventListener('click', () => { scope = val; scopes.querySelectorAll('.ink-f-tab').forEach(x => x.classList.remove('on')); b.classList.add('on'); });
            scopes.append(b);
        });
        const corrLbl = el('label', 'ink-chat-chk ink-pdf-chk');
        const corrChk = el('input'); corrChk.type = 'checkbox';
        corrChk.checked = pages.some(p => p.data?.correction) && st.showCorr;
        corrLbl.append(corrChk, el('span', '', 'Coden-Korrekturen & Note mit ins PDF drucken'));
        const row = el('div', 'ink-finish-row');
        row.append(
            btn('download', 'PDF herunterladen', () => { o.remove(); runPdfExport({ scope, withCorrection: corrChk.checked, mode: 'download' }); }, 'primary labeled'),
            btn('print', 'Drucken', () => { o.remove(); runPdfExport({ scope, withCorrection: corrChk.checked, mode: 'print' }); }, 'labeled'),
            btn('close', 'Abbrechen', () => o.remove(), 'labeled')
        );
        box.append(scopes, corrLbl, row);
        o.append(box); o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
        root.append(o);
    }
    function finish() {
        const a = ctx.assignment; if (!a) { exportPdf(); return; }
        const o = el('div', 'ink-busy'); const box = el('div', 'ink-finish');
        box.append(el('h3', '', 'Fertig mit „' + a.title + '“?'), el('p', '', 'Speichere die Seiten als PDF und gib sie bei deiner Lehrkraft ab (z. B. per Mail, Teams oder Moodle). Danach hakt Coden den Auftrag ab.'));
        const row = el('div', 'ink-finish-row');
        row.append(btn('picture_as_pdf', '1. Als PDF speichern', () => { if (a.status !== 'abgegeben') a.status = 'fertig'; ctx.persist?.(); exportPdf(); }, 'labeled'),
            btn('task_alt', '2. Abgegeben ✓', () => { ctx.onSubmit?.(a); o.remove(); tSub.textContent = [ctx.subjectName, 'Abgegeben ✓'].join(' · '); doneB?.classList.add('done'); }, 'primary labeled'),
            btn('close', 'Abbrechen', () => o.remove(), 'labeled'));
        if (a.status === 'abgegeben') box.append(el('p', 'ink-finish-note', 'Schon abgegeben am ' + new Date(a.submittedAt).toLocaleDateString('de-DE') + '.'));
        box.append(row); o.append(box); o.addEventListener('click', (e) => { if (e.target === o) o.remove(); }); root.append(o);
    }

    // ---------- Tastatur, Größe, Schließen ----------
    const onKey = (e) => {
        if (e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
        if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
        if (mod && k === 'y') { e.preventDefault(); redo(); return; }
        if (mod && k === 'c' && sel) { e.preventDefault(); copySel(); return; }
        if (mod && k === 'x' && sel) { e.preventDefault(); copySel(); deleteSel(); return; }
        if (mod && k === 'v' && st.clip) { e.preventDefault(); paste(); return; }
        if ((k === 'delete' || k === 'backspace') && sel) { e.preventDefault(); deleteSel(); return; }
        const map = { p: 'pen', h: 'hl', e: 'eraser', l: 'lasso', s: 'shape', t: 'text' }; if (!mod && map[k]) { setTool(map[k]); return; }
        if (k === 'escape') { if (sel) clearSelection(); else close(); }
    };
    const onWheel = (e) => { if (e.ctrlKey) { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(st.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top, null, { quick: true }); } };
    const ro = new ResizeObserver(() => layoutAll({ quick: !!pinch }));
    document.addEventListener('keydown', onKey); stage.addEventListener('wheel', onWheel, { passive: false }); ro.observe(stage);
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); }; document.addEventListener('visibilitychange', onHide);
    async function close() {
        clearTimeout(zoomRenderTimer);
        chatAc?.abort();
        if (liveActive()) stopLive(); clearInterval(liveTimer);
        await flush(); io.disconnect(); ro.disconnect();
        document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onHide);
        root.remove(); document.body.classList.remove('ink-open'); ctx.onClose?.();
    }

    syncTools();
    (async () => {
        if (!pages.length) { const ids = await createPages(doc, [null], doc.paper || 'liniert', 0).catch(() => []); doc.pages.push(...ids); pages.push(...ids.map(id => ({ id }))); ctx.persist?.(); }
        rebuild(); stage.scrollTop = 0; stage.scrollLeft = Math.max(0, (world.scrollWidth - stage.clientWidth) / 2);
    })();
    return { close, root };
}
