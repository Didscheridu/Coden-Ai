// js/ink.js – Coden Heft: handschriftlich arbeiten wie in GoodNotes.
// Durchgehend scrollbare Seiten, Seitenleiste mit Vorschauen und Lesezeichen, Stifte (Füller, Kugelschreiber, Pinsel) mit Druck
// (Apple Pencil), Handballen-Erkennung, Textmarker, Radierer (ganzer Strich oder teilweise), Lasso (verschieben, skalieren, Farbe,
// kopieren, duplizieren, löschen, Handschrift → Text mit Coden), Formen (zeichnen und halten), Text, Bilder, Laserpointer,
// Zwei-Finger-Zoom, Vorlagen (liniert, karo, punkte, Cornell, Notenlinien …), Arbeitsblätter als Hintergrund (Foto/PDF),
// "Coden prüfen" (Korrektur wie ein Lehrer), Export als PDF, bei Aufträgen danach abgeben.
import { apiJson } from './backend.js';
import { loader } from './rich-elements.js';
import { correctionPrompt, parseCorrection, fmtDate } from './study-core.js';
import { PAGE_W, PAGE_H, TEMPLATES, PEN_TYPES, encodeStrokes, decodeStrokes, widthAt, recognizeShape, eraseFrom, eraseWhole, lassoSelect, selectionBox, transformSelection } from './ink-core.js';
export { PAGE_W, PAGE_H, encodeStrokes, decodeStrokes } from './ink-core.js';

const PEN_COLORS = ['#1b1f2a', '#1d4ed8', '#c62828', '#2e7d32', '#7c3aed', '#ea580c'];
const HL_COLORS = ['#ffe94d', '#a8f0b8', '#a9dcff', '#ffb3c9', '#ffc98a'];
const WIDTHS = { pen: [1.3, 2.3, 3.8], hl: [14, 22, 32], eraser: [8, 18, 40], shape: [1.3, 2.3, 3.8] };

// ---------- kleine Helfer ----------
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const icon = (n) => el('span', 'material-symbols-outlined', n);
const btn = (ic, label, fn, cls = '') => { const b = el('button', 'ink-btn ' + cls); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); if (ic) b.append(icon(ic)); if (cls.includes('labeled')) b.append(el('span', '', label)); b.addEventListener('click', fn); return b; };
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
        ctx.strokeStyle = '#d6e0ef'; ctx.lineWidth = Math.max(1, k * 0.9);
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
export function drawStroke(ctx, s, k) {
    const p = s.p; if (p.length < 3) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = s.c; ctx.fillStyle = s.c;
    if (s.t === 'hl' || s.k === 'kugel') {
        if (s.t === 'hl') { ctx.globalAlpha = 0.42; ctx.globalCompositeOperation = 'multiply'; ctx.lineCap = 'butt'; }
        ctx.lineWidth = widthAt(s, 0.5) * k;
        ctx.beginPath(); ctx.moveTo(p[0] * k, p[1] * k);
        if (p.length === 3) ctx.lineTo(p[0] * k + 0.1, p[1] * k);
        for (let i = 3; i < p.length; i += 3) { const mx = (p[i - 3] + p[i]) / 2, my = (p[i - 2] + p[i + 1]) / 2; ctx.quadraticCurveTo(p[i - 3] * k, p[i - 2] * k, mx * k, my * k); }
        ctx.lineTo(p[p.length - 3] * k, p[p.length - 2] * k); ctx.stroke(); ctx.restore(); return;
    }
    if (p.length === 3) { ctx.beginPath(); ctx.arc(p[0] * k, p[1] * k, widthAt(s, p[2]) * k / 2, 0, 7); ctx.fill(); ctx.restore(); return; }
    let lx = p[0], ly = p[1];
    for (let i = 3; i < p.length; i += 3) {
        const mx = (p[i - 3] + p[i]) / 2, my = (p[i - 2] + p[i + 1]) / 2;
        ctx.beginPath(); ctx.lineWidth = widthAt(s, (p[i - 1] + p[i + 2]) / 2) * k;
        ctx.moveTo(lx * k, ly * k); ctx.quadraticCurveTo(p[i - 3] * k, p[i - 2] * k, mx * k, my * k); ctx.stroke();
        lx = mx; ly = my;
    }
    ctx.beginPath(); ctx.lineWidth = widthAt(s, p[p.length - 1]) * k; ctx.moveTo(lx * k, ly * k); ctx.lineTo(p[p.length - 3] * k, p[p.length - 2] * k); ctx.stroke();
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

// ---------- Editor ----------
// ctx: { doc, persist(), subjectName, assignment, onCorrected(doc,page,c), onSubmit(a), onClose() }
export function openInkEditor(ctx) {
    const doc = ctx.doc; doc.pages = doc.pages || []; doc.bookmarks = doc.bookmarks || [];
    const st = {
        tool: 'pen', penType: 'fueller', color: { pen: PEN_COLORS[0], hl: HL_COLORS[0], shape: PEN_COLORS[1] }, width: { pen: 1, hl: 1, eraser: 1, shape: 1 },
        eraserMode: 'strich', zoom: 1, penOnly: false, sidebar: window.innerWidth > 1000, showCorr: true, undo: [], redo: [], clip: null, cur: 0
    };
    try { const s = JSON.parse(localStorage.getItem('coden_ink_tools') || '{}'); ['tool', 'penType', 'color', 'width', 'eraserMode', 'penOnly'].forEach(k => { if (s[k] != null) st[k] = typeof s[k] === 'object' ? { ...st[k], ...s[k] } : s[k]; }); } catch (_) {}
    if (['text', 'laser', 'lasso', 'hand', 'image'].includes(st.tool)) st.tool = 'pen';
    const remember = () => { try { localStorage.setItem('coden_ink_tools', JSON.stringify({ tool: st.tool, penType: st.penType, color: st.color, width: st.width, eraserMode: st.eraserMode, penOnly: st.penOnly })); } catch (_) {} };
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
    const checkB = btn('fact_check', 'Coden prüfen', () => correct(), 'primary labeled');
    const doneB = ctx.assignment ? btn('task_alt', 'Fertig & abgeben', () => finish(), 'labeled') : null;
    const moreB = btn('more_horiz', 'Mehr', (e) => moreMenu(e.currentTarget));
    const left = el('div', 'ink-row'); left.append(btn('arrow_back', 'Zurück zur Bibliothek', () => close()), sideB, title);
    const mid = el('div', 'ink-row ink-mid'); mid.append(undoB, redoB, pageLbl);
    const right = el('div', 'ink-row'); right.append(saveState, markB, addB, checkB, ...(doneB ? [doneB] : []), moreB);
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
    const stage = el('div', 'ink-stage'); const col = el('div', 'ink-col'); stage.append(col);
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
        const po = btn('stylus', 'Nur Stift zeichnet (Finger scrollt und zoomt)', () => { st.penOnly = !st.penOnly; remember(); syncTools(); }, 'tool' + (st.penOnly ? ' on' : ''));
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
    function layoutAll() {
        const avail = Math.max(260, stage.clientWidth - 32); cssW = Math.round(Math.min(avail, 900) * st.zoom);
        const cssH = Math.round(cssW * PAGE_H / PAGE_W); dpr = Math.min(window.devicePixelRatio || 1, 2600 / cssW, 3);
        col.style.width = cssW + 'px';
        pages.forEach(pg => { if (!pg.wrap) return; pg.wrap.style.width = cssW + 'px'; pg.wrap.style.height = cssH + 'px'; pg.wrap.style.setProperty('--k', cssW / PAGE_W); if (pg.view) sizeView(pg); });
        placeSel();
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
        pg.wrap.append(v.bg, v.imgs, v.ink, v.live, v.text, v.marks); pg.wrap.classList.add('loading');
        await ensureData(pg); if (pg.view !== v) return;
        pg.wrap.classList.remove('loading'); sizeView(pg);
    }
    function unmount(pg) { const v = pg.view; if (!v) return; [v.bg, v.imgs, v.ink, v.live, v.text, v.marks].forEach(x => x.remove()); pg.view = null; }
    async function sizeView(pg) {
        const v = pg.view; if (!v || !pg.data) return;
        const W = Math.round(cssW * dpr), H = Math.round(cssW * PAGE_H / PAGE_W * dpr);
        for (const c of [v.bg, v.ink, v.live]) { c.width = W; c.height = H; }
        paintInk(pg); paintItems(pg); paintText(pg); paintMarks(pg); await paintBg(pg);
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
    function paintMarks(pg) {
        const v = pg.view; if (!v) return; v.marks.replaceChildren(); const c = pg.data.correction; if (!c || !st.showCorr) return;
        if (c.grade) v.marks.append(el('div', 'ink-grade', c.grade));
        (c.items || []).forEach((it) => {
            const m = el('button', 'ink-mark ' + (it.ok ? 'ok' : 'bad')); m.type = 'button'; m.style.top = `calc(var(--k) * ${60 + it.y * (PAGE_H - 120)}px)`;
            m.append(el('b', '', it.ok ? '✓' : '✗'), el('span', '', it.text)); if (it.fix) m.append(el('em', '', '→ ' + it.fix));
            m.addEventListener('click', () => m.classList.toggle('open')); v.marks.append(m);
        });
    }
    const repaint = (pg) => { paintInk(pg); paintItems(pg); paintText(pg); };

    // ---------- Rückgängig: ein Schnappschuss je Aktion und Seite ----------
    function commit(pg, before) { st.undo.push({ pg, before, after: clone(pg.data) }); if (st.undo.length > 150) st.undo.shift(); st.redo = []; markDirty(pg); }
    function applySnap(pg, snap) { pg.data.strokes = snap.strokes.slice(); pg.data.text = snap.text.map(t => ({ ...t })); pg.data.items = snap.items.map(i => ({ ...i })); repaint(pg); markDirty(pg); }
    function undo() { clearSelection(); const a = st.undo.pop(); if (!a) return; applySnap(a.pg, a.before); st.redo.push(a); scrollToPage(pages.indexOf(a.pg), true); }
    function redo() { clearSelection(); const a = st.redo.pop(); if (!a) return; applySnap(a.pg, a.after); st.undo.push(a); }

    // ---------- Speichern ----------
    let saveTimer = 0;
    function markDirty(pg, what = {}) { pg.dirty = true; if (what.bg) pg.bgDirty = true; if (what.corr) pg.corrDirty = true; pg.thumb = null; saveState.textContent = 'Ungespeichert …'; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 1200); }
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
    const touches = new Map(); let op = null, pinch = null, pan = null, holdTimer = 0, inertia = 0;
    const pagePos = (pg, e) => { const r = pg.wrap.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * PAGE_W, (e.clientY - r.top) / r.height * PAGE_H]; };
    const pageAt = (e) => { const w = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.ink-page'); return w ? pages[+w.dataset.i] : null; };
    const pressure = (e) => (e.pointerType === 'pen' ? (e.pressure || 0.5) : e.pointerType === 'touch' ? 0.55 : 0.5);
    stage.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.ink-sel, .ink-selmenu, .ink-addpage, .ink-mark, .ink-textbox[contenteditable="true"]')) return;
        cancelAnimationFrame(inertia);
        if (e.pointerType === 'pen' && !st.penOnly) { st.penOnly = true; remember(); syncTools(); }
        if (e.pointerType === 'touch') {
            touches.set(e.pointerId, [e.clientX, e.clientY]);
            if (touches.size === 2) { // zweiter Finger: Malen abbrechen, zoomen
                if (op && op.touch) { clearLive(op.pg); if (op.kind === 'erase' && op.changed) applySnap(op.pg, op.before); op = null; }
                const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z: st.zoom, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 }; pan = null; return;
            }
        }
        try { stage.setPointerCapture(e.pointerId); } catch (_) {}
        const pg = pageAt(e);
        if (st.tool === 'hand' || (e.pointerType === 'touch' && st.penOnly) || !pg || !pg.data) {
            if (st.tool === 'lasso') clearSelection();
            pan = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop, t: performance.now(), vx: 0, vy: 0 }; return;
        }
        if (e.button > 0) return;
        e.preventDefault(); st.cur = pages.indexOf(pg); updateLabel(); pg.active = true;
        const [x, y] = pagePos(pg, e);
        if (st.tool === 'text') { addText(pg, x, y); pg.active = false; return; }
        if (st.tool === 'lasso') { clearSelection(); op = { kind: 'lasso', pg, poly: [[x, y]], id: e.pointerId }; return; }
        if (st.tool === 'eraser') { op = { kind: 'erase', pg, before: clone(pg.data), id: e.pointerId, touch: e.pointerType === 'touch' }; eraseAt(pg, x, y); return; }
        if (st.tool === 'laser') { op = { kind: 'laser', pg, id: e.pointerId }; laserAdd(pg, x, y); return; }
        const t = st.tool === 'hl' ? 'hl' : 'pen'; const kind = st.tool === 'shape' ? 'shape' : t; const ck = kind === 'shape' ? 'shape' : t;
        op = { kind, pg, id: e.pointerId, touch: e.pointerType === 'touch', s: { t, c: st.color[ck], w: WIDTHS[ck][st.width[ck]], k: t === 'hl' ? 'fueller' : (kind === 'shape' ? 'kugel' : st.penType), p: [x, y, pressure(e)] } };
    });
    stage.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinch && touches.size >= 2) {
            const [a, b] = [...touches.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
            const z = Math.max(0.5, Math.min(3, pinch.z * d / pinch.d)); const r = stage.getBoundingClientRect();
            const cx = (a[0] + b[0]) / 2 - r.left, cy = (a[1] + b[1]) / 2 - r.top; const ratio = z / st.zoom;
            const nx = (stage.scrollLeft + cx) * ratio - cx, ny = (stage.scrollTop + cy) * ratio - cy;
            st.zoom = z; layoutAll(); stage.scrollLeft = nx; stage.scrollTop = ny; return;
        }
        if (pan && e.pointerId === pan.id) {
            const now = performance.now(), dt = Math.max(1, now - pan.t);
            pan.vx = ((pan.lx ?? e.clientX) - e.clientX) / dt; pan.vy = ((pan.ly ?? e.clientY) - e.clientY) / dt; pan.lx = e.clientX; pan.ly = e.clientY; pan.t = now;
            stage.scrollLeft = pan.sl - (e.clientX - pan.x); stage.scrollTop = pan.st - (e.clientY - pan.y); return;
        }
        if (!op || e.pointerId !== op.id) return;
        e.preventDefault();
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of (evs.length ? evs : [e])) {
            const [x, y] = pagePos(op.pg, ev);
            if (op.kind === 'erase') { eraseAt(op.pg, x, y); continue; }
            if (op.kind === 'lasso') { op.poly.push([x, y]); continue; }
            if (op.kind === 'laser') { laserAdd(op.pg, x, y); continue; }
            if (op.shaped) continue; // nach dem Einrasten nicht weiter malen
            const p = op.s.p; if (Math.hypot(x - p[p.length - 3], y - p[p.length - 2]) < 0.6) continue;
            p.push(x, y, pressure(ev));
        }
        if (op.kind === 'lasso') drawLasso(op);
        else if (op.kind === 'pen' || op.kind === 'shape' || op.kind === 'hl') {
            drawLive(op);
            if (op.kind === 'pen') { clearTimeout(holdTimer); const o = op; holdTimer = setTimeout(() => holdToShape(o), 650); }
        }
    });
    const end = (e) => {
        if (e.pointerType === 'touch') { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; }
        if (pan && e.pointerId === pan.id) { const p = pan; pan = null; glide(p.vx, p.vy); return; }
        if (!op || e.pointerId !== op.id) return;
        clearTimeout(holdTimer); const o = op; op = null; o.pg.active = false;
        if (o.kind === 'erase') { clearLive(o.pg); if (o.changed) commit(o.pg, o.before); return; }
        if (o.kind === 'laser') return;
        if (o.kind === 'lasso') { clearLive(o.pg); finishLasso(o); return; }
        clearLive(o.pg);
        let s = o.s;
        if (o.kind === 'shape' && !o.shaped) { const r = recognizeShape(s.p); if (r) s = { ...s, p: r.p }; }
        if (s.t === 'hl' && s.p.length > 6) s = straightHl(s);
        const before = clone(o.pg.data); o.pg.data.strokes.push(s); commit(o.pg, before);
        if (s.t === 'hl') paintInk(o.pg); else if (o.pg.view) drawStroke(o.pg.view.ink.getContext('2d'), s, kOf());
    };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    function glide(vx, vy) {
        if (Math.hypot(vx, vy) < 0.2) return; let last = performance.now();
        const step = (t) => { const dt = t - last; last = t; stage.scrollLeft += vx * dt; stage.scrollTop += vy * dt; vx *= Math.pow(0.94, dt / 16); vy *= Math.pow(0.94, dt / 16); if (Math.hypot(vx, vy) > 0.02) inertia = requestAnimationFrame(step); };
        inertia = requestAnimationFrame(step);
    }
    const clearLive = (pg) => { const v = pg?.view; if (v) v.live.getContext('2d').clearRect(0, 0, v.live.width, v.live.height); };
    function drawLive(o) { const v = o.pg.view; if (!v) return; const g = v.live.getContext('2d'); g.clearRect(0, 0, v.live.width, v.live.height); drawStroke(g, o.s, kOf()); }
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
                const t = mode === 'move' ? { dx: x - start[0], dy: y - start[1] } : { f: Math.max(0.15, (b0.w + (x - start[0])) / Math.max(1, b0.w)), ax: b0.x, ay: b0.y };
                const out = transformSelection(base, sel, t); pg.data.strokes = out.strokes; pg.data.text = out.text; pg.data.items = out.items;
                sel.box = mode === 'move' ? { ...b0, x: b0.x + t.dx, y: b0.y + t.dy } : { x: b0.x, y: b0.y, w: b0.w * t.f, h: b0.h * t.f };
                repaint(pg); placeSel();
            };
            const up = () => { r.removeEventListener('pointermove', mv); r.removeEventListener('pointerup', up); r.removeEventListener('pointercancel', up); if (moved) commit(pg, before); };
            r.addEventListener('pointermove', mv); r.addEventListener('pointerup', up); r.addEventListener('pointercancel', up);
        };
        r.addEventListener('pointerdown', (e) => (e.target === h ? drag('scale')(e) : drag('move')(e)));
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
        it('delete', 'Seite löschen', () => deletePage(i));
        popAt(pop, anchor, 30);
    }
    function moreMenu(anchor) {
        document.querySelector('.ink-pop')?.remove(); const pop = el('div', 'ink-pop ink-menu');
        const it = (ic, l, fn) => pop.append(btn(ic, l, () => { pop.remove(); fn(); }, 'labeled'));
        it('picture_as_pdf', 'Als PDF exportieren', () => exportPdf());
        it('upload_file', 'PDF / Fotos importieren', () => bgIn.click());
        it('wallpaper', 'Vorlage dieser Seite', () => templateMenu(anchor, (t) => setPaper(st.cur, t)));
        it('zoom_in', 'Größer', () => setZoom(st.zoom * 1.2)); it('zoom_out', 'Kleiner', () => setZoom(st.zoom / 1.2)); it('fit_width', 'Seitenbreite', () => setZoom(1));
        it(st.showCorr ? 'visibility_off' : 'visibility', st.showCorr ? 'Korrekturen ausblenden' : 'Korrekturen einblenden', () => { st.showCorr = !st.showCorr; pages.forEach(paintMarks); });
        popAt(pop, anchor, -200);
    }
    function setZoom(z) { const ratio = stage.scrollTop / Math.max(1, stage.scrollHeight); st.zoom = Math.max(0.5, Math.min(3, z)); layoutAll(); stage.scrollTop = ratio * stage.scrollHeight; }
    function scrollToPage(i, keep = false) { const pg = pages[i]; if (!pg?.wrap) return; if (keep) { const r = pg.wrap.getBoundingClientRect(), s = stage.getBoundingClientRect(); if (r.bottom > s.top && r.top < s.bottom) return; } stage.scrollTo({ top: pg.wrap.offsetTop - 16, behavior: 'smooth' }); st.cur = i; updateLabel(); }
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

    // ---------- Coden prüfen ----------
    function overlay(text, sub) {
        const o = el('div', 'ink-busy'); const box = el('div', 'ink-busy-box'); const t = el('div'); t.append(el('b', '', text), el('small', '', sub || '')); box.append(loader({ size: 40 }), t); o.append(box); root.append(o);
        o.setSub = (s) => { t.lastChild.textContent = s; }; return o;
    }
    function showPanel() {
        const pg = pages[st.cur]; const c = pg?.data?.correction; panel.replaceChildren(); panel.hidden = !c || !!pg._panelClosed; if (panel.hidden) return;
        const head = el('div', 'ink-p-head'); const meta = el('div'); meta.append(el('b', '', `Korrektur · Seite ${st.cur + 1}`), el('small', '', [c.points, c.score != null ? c.score + ' %' : ''].filter(Boolean).join(' · ')));
        head.append(el('div', 'ink-p-grade', c.grade || '–'), meta, btn('close', 'Schließen', () => { pg._panelClosed = true; panel.hidden = true; }));
        const list = el('ul', 'ink-p-items'); (c.items || []).forEach(it => { const li = el('li', it.ok ? 'ok' : 'bad'); li.append(el('b', '', it.ok ? '✓' : '✗'), el('span', '', it.text)); if (it.fix) li.append(el('em', '', 'Richtig: ' + it.fix)); list.append(li); });
        const tips = el('div', 'ink-p-tips'); if ((c.tips || []).length) { tips.append(el('b', '', 'So wirst du besser')); const ul = el('ul'); c.tips.forEach(t => ul.append(el('li', '', t))); tips.append(ul); }
        const acts = el('div', 'ink-p-acts'); acts.append(btn('refresh', 'Nochmal prüfen', () => correct(), 'labeled'));
        panel.append(head, el('p', 'ink-p-sum', c.summary || ''), list, tips, acts);
    }
    async function correct() {
        const pg = pages[st.cur]; if (!pg) return; await ensureData(pg);
        if (!pg.data.strokes.length && !pg.data.text.length) { alert('Auf dieser Seite steht noch nichts. Schreib zuerst etwas, dann prüft Coden.'); return; }
        await flush(); clearSelection();
        const busy = overlay('Coden korrigiert deine Seite …', 'Liest deine Handschrift');
        const steps = ['Liest deine Handschrift', 'Prüft jeden Rechenschritt', 'Vergleicht mit der Aufgabe', 'Schreibt Anmerkungen an den Rand'];
        let n = 0; const tm = setInterval(() => busy.setSub(steps[Math.min(steps.length - 1, ++n)]), 3500);
        try {
            const image = await pageImage({ ...pg.data }, { width: 1100, quality: 0.82 });
            const task = [ctx.assignment ? `${ctx.assignment.title}\n${ctx.assignment.desc || ''}` : '', pg.data.bg ? '(Die Aufgabe steht auf dem Arbeitsblatt im Hintergrund.)' : ''].filter(Boolean).join('\n');
            const r = await apiJson('/chat', { method: 'POST', body: JSON.stringify({ tier: 'flash', messages: [{ role: 'system', content: correctionPrompt({ subject: ctx.subjectName, task }) }, { role: 'user', content: 'Bitte korrigiere diese Heftseite.', images: [image] }] }) });
            const c = parseCorrection(r.content); if (!c) throw new Error('Coden konnte die Seite nicht sicher lesen. Schreib etwas größer oder prüfe nochmal.');
            pg.data.correction = c; pg._panelClosed = false; st.showCorr = true; markDirty(pg, { corr: true }); await flush();
            paintMarks(pg); showPanel(); ctx.onCorrected?.(doc, { id: pg.id }, c);
        } catch (e) { alert(e.message || 'Prüfen hat nicht geklappt.'); } finally { clearInterval(tm); busy.remove(); }
    }

    // ---------- PDF & abgeben ----------
    async function exportPdf() {
        await flush(); const busy = overlay('PDF wird vorbereitet …', `${pages.length} Seite${pages.length === 1 ? '' : 'n'}`);
        try {
            const imgs = [];
            for (let i = 0; i < pages.length; i++) { busy.setSub(`Seite ${i + 1} von ${pages.length}`); await ensureData(pages[i]); imgs.push(await pageImage({ ...pages[i].data }, { width: 1654, quality: 0.9 })); }
            document.getElementById('ink-print-root')?.remove(); const pr = el('div'); pr.id = 'ink-print-root';
            imgs.forEach(src => { const im = el('img'); im.src = src; pr.append(im); }); document.body.append(pr); document.body.classList.add('ink-printing');
            const old = document.title; document.title = [ctx.subjectName, doc.title].filter(Boolean).join(' – ').replace(/[\\/:*?"<>|]+/g, ' ');
            const done = () => { document.body.classList.remove('ink-printing'); pr.remove(); document.title = old; window.removeEventListener('afterprint', done); };
            window.addEventListener('afterprint', done);
            await Promise.all([...pr.querySelectorAll('img')].map(i => i.decode().catch(() => {}))); busy.remove(); window.print(); return true;
        } catch (e) { busy.remove(); alert('PDF ging nicht: ' + e.message); return false; }
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
    const onWheel = (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(st.zoom * (e.deltaY < 0 ? 1.08 : 0.93)); } };
    const ro = new ResizeObserver(() => layoutAll());
    document.addEventListener('keydown', onKey); stage.addEventListener('wheel', onWheel, { passive: false }); ro.observe(stage);
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); }; document.addEventListener('visibilitychange', onHide);
    async function close() {
        await flush(); io.disconnect(); ro.disconnect();
        document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onHide);
        root.remove(); document.body.classList.remove('ink-open'); ctx.onClose?.();
    }

    syncTools();
    (async () => {
        if (!pages.length) { const ids = await createPages(doc, [null], doc.paper || 'liniert', 0).catch(() => []); doc.pages.push(...ids); pages.push(...ids.map(id => ({ id }))); ctx.persist?.(); }
        rebuild(); stage.scrollTop = 0;
    })();
    return { close, root };
}
