// js/ink.js – Coden Heft: handschriftlich arbeiten wie in GoodNotes.
// Schreiben mit Maus, Finger oder Apple Pencil (Druckstärke, Handballen wird ignoriert, sobald ein Stift erkannt ist),
// Stift / Textmarker / Radierer / Text, Papier (blanko, liniert, karo, punkte), Arbeitsblätter als Hintergrund (Foto, PDF),
// Rückgängig, Zoom, Seiten. "Coden prüfen" korrigiert die Seite wie ein Lehrer (rote Anmerkungen am Rand, Note, Tipps).
// Export als PDF (A4) und danach als abgegeben abhaken.
import { apiJson } from './backend.js';
import { loader } from './rich-elements.js';
import { correctionPrompt, parseCorrection, fmtDate, STATUS } from './study-core.js';

export const PAGE_W = 1000, PAGE_H = 1414; // A4 in Seiten-Einheiten
const PAPERS = [['liniert', 'Liniert'], ['karo', 'Karo'], ['punkte', 'Punkte'], ['blanko', 'Blanko']];
const PEN_COLORS = ['#1b1f2a', '#1d4ed8', '#c62828', '#2e7d32', '#7c3aed'];
const HL_COLORS = ['#ffe94d', '#a8f0b8', '#a9dcff', '#ffb3c9', '#ffc98a'];
const WIDTHS = { pen: [1.6, 2.6, 4.2], hl: [14, 22, 32], eraser: [10, 22, 44] };

// ---------- kleine Helfer ----------
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const icon = (n) => el('span', 'material-symbols-outlined', n);
const btn = (ic, label, fn, cls = '') => { const b = el('button', 'ink-btn ' + cls); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); if (ic) b.append(icon(ic)); if (cls.includes('labeled')) b.append(el('span', '', label)); b.addEventListener('click', fn); return b; };
export const newPageId = () => 'pg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Striche kompakt speichern: Ganzzahlen, Unterschiede zum vorigen Punkt
export function encodeStrokes(strokes) {
    return JSON.stringify(strokes.map(s => {
        const d = []; let px = 0, py = 0, pp = 0;
        for (let i = 0; i < s.p.length; i += 3) { const x = Math.round(s.p[i] * 10), y = Math.round(s.p[i + 1] * 10), p = Math.round((s.p[i + 2] ?? 0.5) * 100); d.push(x - px, y - py, p - pp); px = x; py = y; pp = p; }
        return [s.t, s.c, s.w, d];
    }));
}
export function decodeStrokes(str) {
    let arr; try { arr = JSON.parse(str || '[]'); } catch (_) { return []; }
    return (Array.isArray(arr) ? arr : []).map(([t, c, w, d]) => {
        const p = []; let x = 0, y = 0, q = 0;
        for (let i = 0; i + 2 < (d || []).length; i += 3) { x += d[i]; y += d[i + 1]; q += d[i + 2]; p.push(x / 10, y / 10, q / 100); }
        return { t: t === 'hl' ? 'hl' : 'pen', c: String(c || '#1b1f2a'), w: +w || 2, p };
    }).filter(s => s.p.length >= 3);
}

// ---------- lokaler Zwischenspeicher (IndexedDB) – schnell und offline ----------
const idb = (() => {
    let dbp = null;
    const open = () => (dbp ||= new Promise((res, rej) => { const r = indexedDB.open('coden-heft', 1); r.onupgradeneeded = () => r.result.createObjectStore('pages'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const run = (mode, fn) => open().then(db => new Promise((res, rej) => { const tx = db.transaction('pages', mode); const st = tx.objectStore('pages'); const q = fn(st); tx.oncomplete = () => res(q?.result); tx.onerror = () => rej(tx.error); }));
    return { get: (k) => run('readonly', s => s.get(k)).catch(() => null), put: (k, v) => run('readwrite', s => s.put(v, k)).catch(() => null), del: (k) => run('readwrite', s => s.delete(k)).catch(() => null) };
})();

// ---------- Papier & Zeichnen ----------
function drawPaper(ctx, paper, k) {
    ctx.fillStyle = '#fffefb'; ctx.fillRect(0, 0, PAGE_W * k, PAGE_H * k);
    if (paper === 'liniert') {
        ctx.strokeStyle = '#c9d6ea'; ctx.lineWidth = Math.max(1, k);
        for (let y = 120; y < PAGE_H - 40; y += 36) { ctx.beginPath(); ctx.moveTo(0, y * k); ctx.lineTo(PAGE_W * k, y * k); ctx.stroke(); }
        ctx.strokeStyle = '#eaa3a3'; ctx.beginPath(); ctx.moveTo(92 * k, 0); ctx.lineTo(92 * k, PAGE_H * k); ctx.stroke();
    } else if (paper === 'karo') {
        ctx.strokeStyle = '#d6e0ef'; ctx.lineWidth = Math.max(1, k * 0.9);
        for (let x = 25; x < PAGE_W; x += 25) { ctx.beginPath(); ctx.moveTo(x * k, 0); ctx.lineTo(x * k, PAGE_H * k); ctx.stroke(); }
        for (let y = 25; y < PAGE_H; y += 25) { ctx.beginPath(); ctx.moveTo(0, y * k); ctx.lineTo(PAGE_W * k, y * k); ctx.stroke(); }
    } else if (paper === 'punkte') {
        ctx.fillStyle = '#b8c4d8';
        for (let x = 25; x < PAGE_W; x += 25) for (let y = 25; y < PAGE_H; y += 25) { ctx.beginPath(); ctx.arc(x * k, y * k, 1.3 * k, 0, 7); ctx.fill(); }
    }
}
function drawBg(ctx, img, k) {
    if (!img) return;
    const s = Math.min(PAGE_W / img.width, PAGE_H / img.height); const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, (PAGE_W - w) / 2 * k, 0, w * k, h * k);
}
const widthAt = (s, p) => (s.t === 'hl' ? s.w : s.w * (0.35 + 0.95 * Math.max(0.05, Math.min(1, p))));
export function drawStroke(ctx, s, k) {
    const p = s.p; if (p.length < 3) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = s.c; ctx.fillStyle = s.c;
    if (s.t === 'hl') {
        ctx.globalAlpha = 0.42; ctx.globalCompositeOperation = 'multiply'; ctx.lineWidth = s.w * k; ctx.lineCap = 'butt';
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
    for (const it of c.items || []) {
        const y = 60 + it.y * (PAGE_H - 120); ctx.fillStyle = it.ok ? '#2e7d32' : '#c62828';
        ctx.fillText(it.ok ? '✓' : '✗', (PAGE_W - 54) * k, y * k);
    }
    if (c.grade) { ctx.strokeStyle = '#c62828'; ctx.lineWidth = 3 * k; ctx.beginPath(); ctx.ellipse((PAGE_W - 90) * k, 70 * k, 56 * k, 40 * k, -0.15, 0, 7); ctx.stroke(); ctx.fillStyle = '#c62828'; ctx.font = `700 ${46 * k}px Caveat, Kalam, cursive`; ctx.textAlign = 'center'; ctx.fillText(c.grade, (PAGE_W - 90) * k, 72 * k); }
    ctx.restore();
}
function loadImage(src) { return new Promise((res) => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }

// Ganze Seite als Bild (für Coden-Korrektur und PDF)
export async function pageImage(page, { width = 1240, quality = 0.86, correction = false } = {}) {
    const k = width / PAGE_W; const c = document.createElement('canvas'); c.width = width; c.height = Math.round(PAGE_H * k);
    const ctx = c.getContext('2d'); drawPaper(ctx, page.paper, k); drawBg(ctx, page._img || await loadImage(page.bg), k);
    const strokes = page._strokes || decodeStrokes(page.strokes);
    strokes.filter(s => s.t === 'hl').forEach(s => drawStroke(ctx, s, k)); strokes.filter(s => s.t !== 'hl').forEach(s => drawStroke(ctx, s, k));
    (page.text || []).forEach(t => drawText(ctx, t, k));
    if (correction) drawCorrection(ctx, page.correction, k);
    return c.toDataURL('image/jpeg', quality);
}

// Fotos/PDF-Seiten als Hintergrund: verkleinern, als JPEG
export function fileToImage(file, max = 1600) {
    return new Promise((res, rej) => {
        const r = new FileReader(); r.onerror = () => rej(new Error('Datei konnte nicht gelesen werden.'));
        r.onload = async () => { const img = await loadImage(r.result); if (!img) return rej(new Error('Kein Bild.')); res(shrink(img, max)); };
        r.readAsDataURL(file);
    });
}
function shrink(img, max, q = 0.82) { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q); }
let pdfjs = null;
export async function pdfToImages(file, maxPages = 30) {
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

// ---------- Seiten laden/speichern ----------
export async function loadPage(id) {
    let p = null;
    try { p = (await apiJson('/study/pages/' + id)).page; if (p) idb.put(id, p); } catch (e) { p = await idb.get(id); if (!p && e.status !== 404) throw e; }
    return p;
}
export async function savePage(page, { withBg = false } = {}) {
    const body = { doc: page.doc, idx: page.idx, paper: page.paper, strokes: page.strokes, text: page.text || [], ...(withBg ? { bg: page.bg || '' } : { keepBg: true }), ...(page._correctionChanged ? { correction: page.correction } : {}) };
    await idb.put(page.id, { ...body, id: page.id, bg: page.bg || null, correction: page.correction || null });
    await apiJson('/study/pages/' + page.id, { method: 'PUT', body: JSON.stringify(body) });
    page._correctionChanged = false;
}
export async function createPages(doc, backgrounds = [null], paper = 'liniert', startIdx = 0) {
    const ids = [];
    for (let i = 0; i < backgrounds.length; i++) {
        const page = { id: newPageId(), doc: doc.id, idx: startIdx + i, paper: backgrounds[i] ? 'blanko' : paper, strokes: '[]', text: [], bg: backgrounds[i] || null };
        await savePage(page, { withBg: true }); ids.push(page.id);
    }
    return ids;
}
export async function deleteDocPages(docId) { try { await apiJson('/study/docs/' + docId, { method: 'DELETE' }); } catch (_) {} }

// ---------- Editor ----------
// ctx: { doc, study(), persist(), subjectName, assignment, onChange(), onClose() }
export function openInkEditor(ctx) {
    const doc = ctx.doc;
    const st = { tool: 'pen', color: { pen: PEN_COLORS[0], hl: HL_COLORS[0] }, width: { pen: 1, hl: 1, eraser: 1 }, zoom: 1, penOnly: false, idx: 0, page: null, undo: [], redo: [], showCorr: true, saving: 0, dirty: false };
    try { Object.assign(st, JSON.parse(localStorage.getItem('coden_ink_tools') || '{}'), { idx: 0, page: null, undo: [], redo: [] }); } catch (_) {}
    const rememberTools = () => { try { localStorage.setItem('coden_ink_tools', JSON.stringify({ tool: st.tool, color: st.color, width: st.width, penOnly: st.penOnly })); } catch (_) {} };

    const root = el('div', 'ink-app'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Heft');
    // Kopfzeile
    const top = el('header', 'ink-top');
    const title = el('div', 'ink-title'); const tName = el('b', '', doc.title || 'Heft'); const tSub = el('small', '', [ctx.subjectName, ctx.assignment?.due ? 'Abgabe ' + fmtDate(ctx.assignment.due) : ''].filter(Boolean).join(' · ')); title.append(tName, tSub);
    const saveState = el('span', 'ink-save', 'Gespeichert');
    const left = el('div', 'ink-row'); left.append(btn('arrow_back', 'Zurück', () => close()), title);
    const right = el('div', 'ink-row');
    const checkBtn = btn('fact_check', 'Coden prüfen', () => correct(), 'primary labeled');
    const doneBtn = btn(ctx.assignment ? 'task_alt' : 'picture_as_pdf', ctx.assignment ? 'Fertig & abgeben' : 'Als PDF', () => finish(), 'labeled');
    right.append(saveState, checkBtn, doneBtn);
    top.append(left, right);

    // Werkzeuge
    const tools = el('div', 'ink-tools');
    const toolBtns = {};
    for (const [k, ic, label] of [['pen', 'edit', 'Stift (P)'], ['hl', 'ink_highlighter', 'Textmarker (H)'], ['eraser', 'ink_eraser', 'Radierer (E)'], ['text', 'title', 'Text (T)'], ['hand', 'pan_tool', 'Verschieben']]) {
        toolBtns[k] = btn(ic, label, () => { st.tool = k; rememberTools(); syncTools(); }, 'tool');
        tools.append(toolBtns[k]);
    }
    const sep = () => el('span', 'ink-sep');
    const colorsBox = el('div', 'ink-colors'); const widthBox = el('div', 'ink-widths');
    tools.append(sep(), colorsBox, sep(), widthBox, sep(),
        btn('undo', 'Rückgängig (Strg+Z)', () => undo()), btn('redo', 'Wiederholen', () => redo()), sep());
    const paperSel = el('select', 'ink-select'); paperSel.title = 'Papier';
    PAPERS.forEach(([v, l]) => { const o = el('option', '', l); o.value = v; paperSel.append(o); });
    paperSel.addEventListener('change', () => { if (!st.page) return; st.page.paper = paperSel.value; paintBg(); markDirty(); });
    const zoomOut = btn('zoom_out', 'Kleiner', () => setZoom(st.zoom / 1.2)); const zoomIn = btn('zoom_in', 'Größer', () => setZoom(st.zoom * 1.2));
    const penOnly = btn('stylus', 'Nur Stift zeichnet (Finger scrollt)', () => { st.penOnly = !st.penOnly; rememberTools(); syncTools(); }, 'tool');
    const fileIn = el('input'); fileIn.type = 'file'; fileIn.accept = 'image/*,application/pdf'; fileIn.multiple = true; fileIn.hidden = true;
    fileIn.addEventListener('change', () => importFiles([...fileIn.files]).finally(() => { fileIn.value = ''; }));
    tools.append(paperSel, zoomOut, zoomIn, penOnly, btn('add_photo_alternate', 'Arbeitsblatt (Foto/PDF) einfügen', () => fileIn.click()), fileIn);

    // Arbeitsfläche
    const stage = el('div', 'ink-stage'); const wrap = el('div', 'ink-page');
    const cBg = el('canvas', 'ink-c'), cInk = el('canvas', 'ink-c'), cLive = el('canvas', 'ink-c live');
    const textLayer = el('div', 'ink-text-layer'), markLayer = el('div', 'ink-mark-layer');
    wrap.append(cBg, cInk, cLive, textLayer, markLayer); stage.append(wrap);
    // Seitenleiste unten
    const nav = el('div', 'ink-nav');
    const pageLbl = el('span', 'ink-pages');
    nav.append(btn('chevron_left', 'Vorige Seite', () => go(st.idx - 1)), pageLbl, btn('chevron_right', 'Nächste Seite', () => go(st.idx + 1)),
        btn('note_add', 'Neue Seite', () => addPage(), 'labeled'), btn('delete', 'Seite löschen', () => delPage()));
    // Korrektur-Panel
    const panel = el('aside', 'ink-panel'); panel.hidden = true;
    const body = el('div', 'ink-body'); body.append(stage, panel);
    root.append(top, tools, body, nav);
    document.body.append(root); document.body.classList.add('ink-open');

    // ---------- Werkzeug-Anzeige ----------
    function syncTools() {
        Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('on', st.tool === k));
        penOnly.classList.toggle('on', st.penOnly);
        colorsBox.replaceChildren(); widthBox.replaceChildren();
        const kind = st.tool === 'hl' ? 'hl' : 'pen';
        if (st.tool === 'pen' || st.tool === 'hl' || st.tool === 'text') {
            (kind === 'hl' ? HL_COLORS : PEN_COLORS).forEach(c => { const b = el('button', 'ink-swatch' + (st.color[kind] === c ? ' on' : '')); b.type = 'button'; b.style.setProperty('--sw', c); b.title = 'Farbe'; b.addEventListener('click', () => { st.color[kind] = c; rememberTools(); syncTools(); }); colorsBox.append(b); });
            const custom = el('input'); custom.type = 'color'; custom.className = 'ink-custom'; custom.value = st.color[kind]; custom.title = 'Eigene Farbe'; custom.addEventListener('input', () => { st.color[kind] = custom.value; rememberTools(); }); colorsBox.append(custom);
        }
        const wk = st.tool === 'hl' ? 'hl' : st.tool === 'eraser' ? 'eraser' : st.tool === 'pen' ? 'pen' : null;
        if (wk) WIDTHS[wk].forEach((w, i) => { const b = el('button', 'ink-width' + (st.width[wk] === i ? ' on' : '')); b.type = 'button'; b.title = ['Fein', 'Mittel', 'Dick'][i]; const dot = el('i'); dot.style.width = dot.style.height = (6 + i * 5) + 'px'; b.append(dot); b.addEventListener('click', () => { st.width[wk] = i; rememberTools(); syncTools(); }); widthBox.append(b); });
        cLive.style.cursor = st.tool === 'hand' ? 'grab' : st.tool === 'text' ? 'text' : st.tool === 'eraser' ? 'cell' : 'crosshair';
        wrap.classList.toggle('pan', st.tool === 'hand');
        cLive.style.touchAction = 'none';
    }

    // ---------- Größe & Zeichnen ----------
    let k = 1, dpr = 1, img = null;
    function layout() {
        const avail = Math.max(280, stage.clientWidth - 24);
        const cssW = Math.round(Math.min(avail, 900) * st.zoom); const cssH = Math.round(cssW * PAGE_H / PAGE_W);
        wrap.style.width = cssW + 'px'; wrap.style.height = cssH + 'px';
        dpr = Math.min(window.devicePixelRatio || 1, 2600 / cssW, 3); k = cssW * dpr / PAGE_W;
        for (const c of [cBg, cInk, cLive]) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); }
        wrap.style.setProperty('--k', cssW / PAGE_W);
        paintBg(); paintInk(); paintText(); paintMarks();
    }
    function paintBg() { const g = cBg.getContext('2d'); g.clearRect(0, 0, cBg.width, cBg.height); drawPaper(g, st.page?.paper, k); drawBg(g, img, k); }
    function paintInk() {
        const g = cInk.getContext('2d'); g.clearRect(0, 0, cInk.width, cInk.height); if (!st.page) return;
        const s = st.page._strokes; s.filter(x => x.t === 'hl').forEach(x => drawStroke(g, x, k)); s.filter(x => x.t !== 'hl').forEach(x => drawStroke(g, x, k));
    }
    function setZoom(z) { st.zoom = Math.max(0.5, Math.min(3, z)); layout(); }

    // ---------- Text ----------
    function paintText() {
        textLayer.replaceChildren(); if (!st.page) return;
        (st.page.text || []).forEach((t, i) => textLayer.append(textBox(t, i)));
    }
    function textBox(t, i) {
        const d = el('div', 'ink-textbox'); d.textContent = t.s; d.style.left = `calc(var(--k) * ${t.x}px)`; d.style.top = `calc(var(--k) * ${t.y}px)`; d.style.fontSize = `calc(var(--k) * ${t.z}px)`; d.style.color = t.c;
        d.addEventListener('pointerdown', (e) => { if (st.tool !== 'text') return; e.stopPropagation(); d.contentEditable = 'true'; d.focus(); });
        d.addEventListener('blur', () => { d.contentEditable = 'false'; const s = d.innerText.replace(/\n$/, ''); const arr = st.page.text; const old = arr[i]?.s; if (!s.trim()) { pushUndo({ type: 'text', before: [...arr] }); arr.splice(i, 1); } else if (s !== old) { pushUndo({ type: 'text', before: arr.map(x => ({ ...x })) }); arr[i] = { ...arr[i], s }; } paintText(); markDirty(); });
        return d;
    }
    function addText(x, y) {
        const t = { x, y: y - 10, s: '', c: st.color.pen, z: 22 }; st.page.text = st.page.text || []; st.page.text.push(t);
        const d = textBox(t, st.page.text.length - 1); textLayer.append(d); d.contentEditable = 'true'; setTimeout(() => d.focus(), 0);
    }

    // ---------- Korrektur am Rand ----------
    function paintMarks() {
        markLayer.replaceChildren(); const c = st.page?.correction; if (!c || !st.showCorr) return;
        if (c.grade) { const g = el('div', 'ink-grade', c.grade); markLayer.append(g); }
        (c.items || []).forEach((it) => {
            const m = el('button', 'ink-mark ' + (it.ok ? 'ok' : 'bad')); m.type = 'button'; m.style.top = `calc(var(--k) * ${60 + it.y * (PAGE_H - 120)}px)`;
            m.append(el('b', '', it.ok ? '✓' : '✗'), el('span', '', it.text));
            if (it.fix) { const f = el('em', '', '→ ' + it.fix); m.append(f); }
            m.addEventListener('click', () => m.classList.toggle('open'));
            markLayer.append(m);
        });
    }
    function showPanel() {
        const c = st.page?.correction; panel.replaceChildren(); panel.hidden = !c; root.classList.toggle('with-panel', !!c); if (!c) return;
        const head = el('div', 'ink-p-head'); const g = el('div', 'ink-p-grade', c.grade || '–'); const meta = el('div'); meta.append(el('b', '', 'Korrektur von Coden'), el('small', '', [c.points, c.score != null ? c.score + ' %' : ''].filter(Boolean).join(' · ')));
        head.append(g, meta, btn('close', 'Schließen', () => { panel.hidden = true; root.classList.remove('with-panel'); }));
        const sum = el('p', 'ink-p-sum', c.summary || '');
        const list = el('ul', 'ink-p-items'); (c.items || []).forEach(it => { const li = el('li', it.ok ? 'ok' : 'bad'); li.append(el('b', '', it.ok ? '✓' : '✗'), el('span', '', it.text)); if (it.fix) li.append(el('em', '', 'Richtig: ' + it.fix)); list.append(li); });
        const tips = el('div', 'ink-p-tips'); if ((c.tips || []).length) { tips.append(el('b', '', 'So wirst du besser')); const ul = el('ul'); c.tips.forEach(t => ul.append(el('li', '', t))); tips.append(ul); }
        const acts = el('div', 'ink-p-acts');
        acts.append(btn(st.showCorr ? 'visibility_off' : 'visibility', st.showCorr ? 'Rot ausblenden' : 'Rot einblenden', () => { st.showCorr = !st.showCorr; paintMarks(); showPanel(); }, 'labeled'), btn('refresh', 'Nochmal prüfen', () => correct(), 'labeled'));
        panel.append(head, sum, list, tips, acts);
    }

    // ---------- Stift-Eingabe ----------
    let cur = null, erasing = null, sawPen = false, panStart = null;
    const toPage = (e) => { const r = cLive.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * PAGE_W, (e.clientY - r.top) / r.height * PAGE_H]; };
    const pressure = (e) => (e.pointerType === 'pen' ? (e.pressure || 0.5) : e.pointerType === 'touch' ? 0.55 : 0.5);
    cLive.addEventListener('pointerdown', (e) => {
        if (!st.page) return;
        if (e.pointerType === 'pen') { if (!sawPen) { sawPen = true; if (!st.penOnly) { st.penOnly = true; rememberTools(); syncTools(); } } }
        // Finger/Handballen bei "Nur Stift" und das Hand-Werkzeug: Seite verschieben statt malen (selbst umgesetzt,
        // weil touch-action sonst auch den Apple Pencil zum Scrollen benutzen würde)
        if (st.tool === 'hand' || (e.pointerType === 'touch' && st.penOnly)) { if (panStart && panStart.id !== e.pointerId) return; panStart = [e.clientX, e.clientY, stage.scrollLeft, stage.scrollTop]; panStart.id = e.pointerId; try { cLive.setPointerCapture(e.pointerId); } catch (_) {} return; }
        if (e.button > 0) return;
        e.preventDefault(); try { cLive.setPointerCapture(e.pointerId); } catch (_) {}
        const [x, y] = toPage(e);
        if (st.tool === 'text') { addText(x, y); return; }
        if (st.tool === 'eraser') { erasing = { removed: [] }; eraseAt(x, y); return; }
        const t = st.tool === 'hl' ? 'hl' : 'pen';
        cur = { t, c: st.color[t], w: WIDTHS[t][st.width[t]], p: [x, y, pressure(e)] };
    });
    cLive.addEventListener('pointermove', (e) => {
        if (panStart) { if (e.pointerId === panStart.id) { stage.scrollLeft = panStart[2] - (e.clientX - panStart[0]); stage.scrollTop = panStart[3] - (e.clientY - panStart[1]); } return; }
        if (!cur && !erasing) return;
        e.preventDefault();
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of (evs.length ? evs : [e])) {
            const [x, y] = toPage(ev);
            if (erasing) { eraseAt(x, y); continue; }
            const p = cur.p; const lx = p[p.length - 3], ly = p[p.length - 2];
            if (Math.hypot(x - lx, y - ly) < 0.6) continue;
            p.push(x, y, pressure(ev));
        }
        if (cur) paintLive();
    });
    const end = (e) => {
        if (panStart) { if (!e || e.pointerId === panStart.id) panStart = null; return; }
        if (erasing) { if (erasing.removed.length) { pushUndo({ type: 'erase', strokes: erasing.removed }); markDirty(); } erasing = null; return; }
        if (!cur) return;
        const s = cur; cur = null; cLive.getContext('2d').clearRect(0, 0, cLive.width, cLive.height);
        if (s.t === 'hl' && s.p.length > 6) straightenHl(s);
        st.page._strokes.push(s); pushUndo({ type: 'add', stroke: s });
        if (s.t === 'hl') paintInk(); else drawStroke(cInk.getContext('2d'), s, k);
        markDirty();
    };
    cLive.addEventListener('pointerup', end); cLive.addEventListener('pointercancel', end); cLive.addEventListener('lostpointercapture', end);
    function paintLive() {
        const g = cLive.getContext('2d'); g.clearRect(0, 0, cLive.width, cLive.height); drawStroke(g, cur, k);
    }
    // Textmarker wie im echten Heft: fast waagrechte Striche gerade ziehen
    function straightenHl(s) {
        const p = s.p; const x0 = p[0], y0 = p[1], x1 = p[p.length - 3], y1 = p[p.length - 2];
        let dev = 0; for (let i = 0; i < p.length; i += 3) dev = Math.max(dev, Math.abs(p[i + 1] - (y0 + (y1 - y0) * ((p[i] - x0) / ((x1 - x0) || 1)))));
        if (Math.abs(x1 - x0) > 40 && Math.abs(y1 - y0) < 18 && dev < 14) { const y = (y0 + y1) / 2; s.p = [x0, y, 0.5, x1, y, 0.5]; }
    }
    function eraseAt(x, y) {
        const r = WIDTHS.eraser[st.width.eraser]; const list = st.page._strokes; let hit = false;
        for (let i = list.length - 1; i >= 0; i--) {
            const s = list[i]; const rr = r + s.w / 2;
            for (let j = 0; j < s.p.length; j += 3) if (Math.abs(s.p[j] - x) < rr && Math.abs(s.p[j + 1] - y) < rr && Math.hypot(s.p[j] - x, s.p[j + 1] - y) < rr) { erasing.removed.push({ stroke: s, at: i }); list.splice(i, 1); hit = true; break; }
        }
        if (hit) paintInk();
    }

    // ---------- Rückgängig ----------
    function pushUndo(a) { st.undo.push(a); if (st.undo.length > 200) st.undo.shift(); st.redo = []; }
    function apply(a, back) {
        const list = st.page._strokes;
        if (a.type === 'add') { if (back) { const i = list.lastIndexOf(a.stroke); if (i >= 0) list.splice(i, 1); } else list.push(a.stroke); }
        else if (a.type === 'erase') { if (back) [...a.strokes].reverse().forEach(r => list.splice(Math.min(r.at, list.length), 0, r.stroke)); else a.strokes.forEach(r => { const i = list.indexOf(r.stroke); if (i >= 0) list.splice(i, 1); }); }
        else if (a.type === 'text') { const now = st.page.text.map(x => ({ ...x })); st.page.text = a.before; a.before = now; paintText(); }
        paintInk(); markDirty();
    }
    function undo() { const a = st.undo.pop(); if (!a) return; apply(a, true); st.redo.push(a); }
    function redo() { const a = st.redo.pop(); if (!a) return; apply(a, false); st.undo.push(a); }

    // ---------- Speichern ----------
    let saveTimer = 0, bgDirty = false;
    function markDirty() { st.dirty = true; saveState.textContent = 'Ungespeichert …'; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 1200); }
    async function flush() {
        clearTimeout(saveTimer); if (!st.page || !st.dirty) return;
        st.dirty = false; st.page.strokes = encodeStrokes(st.page._strokes); saveState.textContent = 'Speichert …';
        try { await savePage(st.page, { withBg: bgDirty }); bgDirty = false; saveState.textContent = 'Gespeichert'; doc.updatedAt = new Date().toISOString(); ctx.persist?.(); }
        catch (e) { st.dirty = true; saveState.textContent = 'Nur auf diesem Gerät gespeichert'; saveState.title = e.message || ''; }
    }

    // ---------- Seiten ----------
    async function go(i) {
        if (i < 0 || i >= doc.pages.length) return;
        await flush(); st.idx = i; st.undo = []; st.redo = []; pageLbl.textContent = `Seite ${i + 1} / ${doc.pages.length}`;
        stage.classList.add('loading');
        let p = null; try { p = await loadPage(doc.pages[i]); } catch (_) {}
        p = p || { id: doc.pages[i], doc: doc.id, idx: i, paper: doc.paper || 'liniert', strokes: '[]', text: [], bg: null };
        p.id = doc.pages[i]; p._strokes = decodeStrokes(p.strokes); p.text = p.text || [];
        st.page = p; img = await loadImage(p.bg); p._img = img; paperSel.value = p.paper || 'liniert';
        stage.classList.remove('loading'); layout(); showPanel(); stage.scrollTop = 0;
    }
    async function addPage(bgs = [null]) {
        await flush();
        const ids = await createPages(doc, bgs, st.page?.paper || doc.paper || 'liniert', doc.pages.length).catch(e => { alert('Seite konnte nicht angelegt werden: ' + e.message); return []; });
        if (!ids.length) return; doc.pages.push(...ids); ctx.persist?.(); go(doc.pages.length - ids.length);
    }
    async function delPage() {
        if (doc.pages.length <= 1) { alert('Ein Heft braucht mindestens eine Seite.'); return; }
        if (!confirm('Diese Seite wirklich löschen?')) return;
        const id = doc.pages[st.idx]; doc.pages.splice(st.idx, 1); ctx.persist?.(); st.dirty = false;
        apiJson('/study/pages/' + id, { method: 'DELETE' }).catch(() => {});
        go(Math.min(st.idx, doc.pages.length - 1));
    }
    async function importFiles(files) {
        if (!files.length) return;
        const busy = overlay('Arbeitsblatt wird eingefügt …', 'Seiten werden vorbereitet');
        try {
            const bgs = await filesToBackgrounds(files);
            if (!bgs.length) throw new Error('Nur Fotos oder PDFs gehen.');
            // leere aktuelle Seite? Dann dort einsetzen
            if (st.page && !st.page._strokes.length && !st.page.bg && !(st.page.text || []).length) {
                st.page.bg = bgs.shift(); st.page.paper = 'blanko'; img = await loadImage(st.page.bg); st.page._img = img; bgDirty = true; paperSel.value = 'blanko'; layout(); st.dirty = true; await flush();
            }
            if (bgs.length) await addPage(bgs);
        } catch (e) { alert(e.message); } finally { busy.remove(); }
    }

    // ---------- Coden prüfen ----------
    function overlay(text, sub) {
        const o = el('div', 'ink-busy'); const box = el('div', 'ink-busy-box'); const t = el('div'); t.append(el('b', '', text), el('small', '', sub || '')); box.append(loader({ size: 40 }), t); o.append(box); root.append(o);
        o.setSub = (s) => { t.lastChild.textContent = s; }; return o;
    }
    async function correct() {
        if (!st.page) return;
        if (!st.page._strokes.length && !(st.page.text || []).length) { alert('Auf dieser Seite steht noch nichts. Schreib zuerst etwas, dann prüft Coden.'); return; }
        await flush();
        const busy = overlay('Coden korrigiert deine Seite …', 'Liest deine Handschrift');
        const steps = ['Liest deine Handschrift', 'Prüft jeden Rechenschritt', 'Vergleicht mit der Aufgabe', 'Schreibt Anmerkungen an den Rand'];
        let n = 0; const tm = setInterval(() => busy.setSub(steps[Math.min(steps.length - 1, ++n)]), 3500);
        try {
            const image = await pageImage(st.page, { width: 1100, quality: 0.82 });
            const task = [ctx.assignment ? `${ctx.assignment.title}\n${ctx.assignment.desc || ''}` : '', st.page.bg ? '(Die Aufgabe steht auf dem Arbeitsblatt im Hintergrund.)' : ''].filter(Boolean).join('\n');
            const r = await apiJson('/chat', { method: 'POST', body: JSON.stringify({ tier: 'flash', messages: [{ role: 'system', content: correctionPrompt({ subject: ctx.subjectName, task }) }, { role: 'user', content: 'Bitte korrigiere diese Heftseite.', images: [image] }] }) });
            const c = parseCorrection(r.content);
            if (!c) throw new Error('Coden konnte die Seite nicht sicher lesen. Schreib etwas größer oder prüfe nochmal.');
            st.page.correction = c; st.page._correctionChanged = true; st.showCorr = true; st.dirty = true; await flush();
            paintMarks(); showPanel(); ctx.onCorrected?.(doc, st.page, c);
        } catch (e) { alert(e.message || 'Prüfen hat nicht geklappt.'); }
        finally { clearInterval(tm); busy.remove(); }
    }

    // ---------- Fertig: PDF & abgeben ----------
    async function exportPdf() {
        await flush();
        const busy = overlay('PDF wird vorbereitet …', `${doc.pages.length} Seite${doc.pages.length === 1 ? '' : 'n'}`);
        try {
            const imgs = [];
            for (let i = 0; i < doc.pages.length; i++) { busy.setSub(`Seite ${i + 1} von ${doc.pages.length}`); const p = i === st.idx ? st.page : await loadPage(doc.pages[i]); if (p) imgs.push(await pageImage(p, { width: 1654, quality: 0.9, correction: false })); }
            document.getElementById('ink-print-root')?.remove();
            const pr = el('div'); pr.id = 'ink-print-root';
            imgs.forEach(src => { const im = el('img'); im.src = src; pr.append(im); });
            document.body.append(pr); document.body.classList.add('ink-printing');
            const old = document.title; document.title = [ctx.subjectName, doc.title].filter(Boolean).join(' – ').replace(/[\\/:*?"<>|]+/g, ' ');
            const done = () => { document.body.classList.remove('ink-printing'); pr.remove(); document.title = old; window.removeEventListener('afterprint', done); };
            window.addEventListener('afterprint', done);
            await Promise.all([...pr.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
            busy.remove(); window.print();
            return true;
        } catch (e) { busy.remove(); alert('PDF ging nicht: ' + e.message); return false; }
    }
    function finish() {
        if (!ctx.assignment) { exportPdf(); return; }
        const a = ctx.assignment;
        const o = el('div', 'ink-busy'); const box = el('div', 'ink-finish');
        box.append(el('h3', '', 'Fertig mit „' + a.title + '“?'), el('p', '', 'Speichere die Seiten als PDF und gib sie bei deiner Lehrkraft ab (z. B. per Mail, Teams oder Moodle). Danach hakt Coden den Auftrag ab.'));
        const row = el('div', 'ink-finish-row');
        row.append(btn('picture_as_pdf', '1. Als PDF speichern', () => { a.status = a.status === 'abgegeben' ? a.status : 'fertig'; ctx.persist?.(); exportPdf(); }, 'labeled'),
            btn('task_alt', '2. Abgegeben ✓', () => { ctx.onSubmit?.(a); o.remove(); tSub.textContent = [ctx.subjectName, 'Abgegeben ✓'].join(' · '); doneBtn.classList.add('done'); }, 'primary labeled'),
            btn('close', 'Abbrechen', () => o.remove(), 'labeled'));
        if (a.status === 'abgegeben') box.append(el('p', 'ink-finish-note', 'Schon abgegeben am ' + new Date(a.submittedAt).toLocaleDateString('de-DE') + '.'));
        box.append(row); o.append(box); o.addEventListener('click', (e) => { if (e.target === o) o.remove(); }); root.append(o);
    }

    // ---------- Tastatur, Größe, Schließen ----------
    const onKey = (e) => {
        if (e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
        const map = { p: 'pen', h: 'hl', e: 'eraser', t: 'text' }; if (!e.ctrlKey && !e.metaKey && map[e.key]) { st.tool = map[e.key]; syncTools(); }
        if (e.key === 'Escape') close();
    };
    const onWheel = (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(st.zoom * (e.deltaY < 0 ? 1.1 : 0.9)); } };
    const ro = new ResizeObserver(() => layout());
    document.addEventListener('keydown', onKey); stage.addEventListener('wheel', onWheel, { passive: false }); ro.observe(stage);
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); }; document.addEventListener('visibilitychange', onHide);
    async function close() {
        await flush();
        document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onHide); ro.disconnect();
        root.remove(); document.body.classList.remove('ink-open'); ctx.onClose?.();
    }

    syncTools();
    if (!doc.pages?.length) { doc.pages = []; addPage(); } else go(0);
    return { close, root };
}
