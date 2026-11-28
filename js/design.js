// js/design.js – Coden Design Studio im Canva-Aufbau:
// Linke Icon-Rail + einklappbares Panel (KI-Studio, Vorlagen, Text, Elemente, Uploads, Brand Kit),
// obere Header- & dynamische Kontext-Toolbar, interaktive Leinwand (Drag/Resize/Rotate/Smart-Guides/Inline-Text),
// untere Seiten-/Slide-Leiste & Zoom-Steuerung, Undo/Redo, PNG/JPG/ZIP-Export (1×/2×).
import { apiJson } from './backend.js';
import { streamAiResponse } from './api.js';
import { toast } from './toast.js';
import { Router } from './router.js';
import { Storage } from './storage.js';
import { h, icon, timeAgo } from './apps/dom.js';
import { modal, confirmBox, promptBox } from './apps/dialogs.js';
import { buildZipBytes } from './doc-export.js';
import {
    FORMATS, FONTS, BACKGROUNDS, TEXT_PRESETS, SHAPES, TEMPLATES,
    formatOf, fontLinkFor, blankSlideHtml, designSystemPrompt, extractHtml,
    safeFontLink, cleanImagePrompt, exportName, frameDoc, EMPTY_IMG, safeFontName
} from './design-core.js';

const TIER_NAME = { flash: 'Coden Flash', normal: 'Coden Thinking', pro: 'Coden Pro', ultra: 'Coden Ultra' };
const IDEAS = [
    ['local_cafe', 'Eröffnungs-Angebot für ein gemütliches Café, 20 % Rabatt diese Woche'],
    ['format_quote', 'Motivations-Zitat für Montag, ruhige Editorial-Stimmung'],
    ['view_carousel', '5 Lerntipps für die Prüfungszeit als modernes Karussell'],
    ['sell', 'Weekend-Drop für einen Sneaker-Shop, modern und kontrastreich']
];
const RAIL_TABS = [
    ['ai', 'auto_awesome', 'KI-Studio'],
    ['templates', 'dashboard', 'Vorlagen'],
    ['text', 'title', 'Text'],
    ['elements', 'category', 'Elemente'],
    ['uploads', 'cloud_upload', 'Uploads'],
    ['brand', 'palette', 'Brand Kit']
];
const IMG_FILTERS = [
    ['Normal', 'none'],
    ['S/W', 'grayscale(1)'],
    ['Warm', 'sepia(0.32) saturate(1.25)'],
    ['Kontrast', 'contrast(1.22) saturate(1.1)'],
    ['Weich', 'brightness(1.06) contrast(0.92)']
];
const UPLOADS_KEY = 'coden_design_uploads_v1';
const tierNow = () => document.querySelector('.model-option.active')?.getAttribute('data-model') || 'flash';

// ---------- Zustand ----------
const fresh = () => ({
    id: null, title: 'Neues Design', titleTouched: false,
    format: 'square', width: 1080, height: 1080, slides: 5,
    head: '', body: '', messages: [], busy: false,
    active: 0, n: 1, view: 'preview', selImg: null, sel: null,
    tab: 'ai', drawerOpen: true, tplCat: 'Alle', zoom: null,
    gen: 0, ac: null, streamText: '',
    history: [], hIdx: -1
});
let st = fresh();
let ui = null;
let libText = null;
const exportsWaiting = new Map(); let reqN = 0;
let saveT = null, saving = null;

const curFormat = () => formatOf(st.format, st.width, st.height);
const brand = () => { const b = Storage.getSettings().designBrand; return b && typeof b === 'object' ? b : {}; };
const loadUploads = () => {
    try { const a = JSON.parse(localStorage.getItem(UPLOADS_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => x && /^https?:\/\//.test(x.url)).slice(0, 40) : []; } catch (_) { return []; }
};
const saveUploads = (list) => { try { localStorage.setItem(UPLOADS_KEY, JSON.stringify(list.slice(0, 40))); } catch (_) {} };
const rememberUpload = (url, label = 'Bild') => {
    if (!url || !/^https?:\/\//.test(url)) return;
    const list = loadUploads().filter(x => x.url !== url);
    list.unshift({ url, label: String(label || 'Bild').slice(0, 60), at: Date.now() });
    saveUploads(list);
};

const loadLib = async () => {
    if (libText != null) return libText;
    try { libText = await (await fetch('js/vendor/html-to-image.min.js')).text(); } catch (_) { libText = ''; }
    return libText;
};

// ---------- HTML säubern ----------
function sanitizeDoc(html, prev = new Map()) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,form,base,meta,noscript,frame,frameset,applet,portal,[data-cd-injected]').forEach(n => n.remove());
    doc.querySelectorAll('link').forEach(l => {
        const rel = String(l.getAttribute('rel') || '').toLowerCase(); const href = l.getAttribute('href') || '';
        const ok = (rel === 'stylesheet' && safeFontLink(href)) || (rel === 'preconnect' && /^https:\/\/fonts\.(googleapis|gstatic)\.com\/?$/.test(href));
        if (!ok) l.remove();
    });
    doc.querySelectorAll('style').forEach(s => { s.textContent = s.textContent.replace(/@import[^;]*;/gi, m => (/fonts\.googleapis\.com/.test(m) ? m : '')); });
    doc.querySelectorAll('*').forEach(el => {
        for (const a of [...el.attributes]) {
            const n = a.name.toLowerCase();
            if (n.startsWith('on') || n === 'contenteditable' || n === 'data-cd-text' || n === 'spellcheck' || n === 'data-cd-id') el.removeAttribute(a.name);
            else if (/^(src|href|xlink:href|action|formaction|poster|srcset)$/.test(n) && /^\s*(javascript|vbscript|data:(?!image\/))/i.test(a.value)) el.removeAttribute(a.name);
        }
    });
    if (!doc.body.querySelector('[data-slide]')) {
        const f = curFormat();
        const sec = doc.createElement('section'); sec.setAttribute('data-slide', '');
        sec.setAttribute('style', `width:${f.w}px;height:${f.h}px`); sec.className = 'relative overflow-hidden';
        while (doc.body.firstChild) sec.appendChild(doc.body.firstChild);
        doc.body.appendChild(sec);
    }
    prepareImages(doc.body, prev);
    return { head: doc.head.innerHTML.trim(), body: doc.body.innerHTML.trim() };
}

function prepareImages(root, prev = new Map()) {
    let n = 0; const used = new Set();
    root.querySelectorAll('img').forEach(img => { const id = img.getAttribute('data-ai-id'); if (id) used.add(id); });
    root.querySelectorAll('img').forEach(img => {
        if (img.hasAttribute('data-brand-logo')) return;
        if (!img.getAttribute('data-ai-id')) { let id; do { id = 'img' + (++n); } while (used.has(id)); used.add(id); img.setAttribute('data-ai-id', id); }
        const src = img.getAttribute('src') || '';
        let prompt = cleanImagePrompt(img.getAttribute('data-ai-image-prompt') || '');
        if (!prompt && !/^https?:\/\//.test(src)) prompt = cleanImagePrompt(img.getAttribute('alt') || '') || 'abstract soft gradient background';
        if (prompt) img.setAttribute('data-ai-image-prompt', prompt);
        if (!/^https?:\/\//.test(src)) {
            const old = prev.get(prompt);
            if (old) { img.setAttribute('src', old); img.removeAttribute('data-ai-state'); }
            else { img.setAttribute('src', EMPTY_IMG); img.setAttribute('data-ai-state', img.getAttribute('data-ai-state') === 'error' ? 'error' : 'pending'); }
        } else img.removeAttribute('data-ai-state');
    });
}

const tpl = (html) => { const t = document.createElement('template'); t.innerHTML = html || ''; return t; };
function imagesOf(body = st.body) {
    const t = tpl(body); const slides = [...t.content.querySelectorAll('[data-slide]')];
    return [...t.content.querySelectorAll('img[data-ai-id]')].map(img => ({
        id: img.getAttribute('data-ai-id'), prompt: img.getAttribute('data-ai-image-prompt') || '', src: img.getAttribute('src') || '',
        state: img.getAttribute('data-ai-state') || '', alt: img.getAttribute('alt') || '', slide: Math.max(0, slides.findIndex(s => s.contains(img)))
    }));
}
const promptMap = (body) => new Map(imagesOf(body).filter(i => i.prompt && /^https?:\/\//.test(i.src)).map(i => [i.prompt, i.src]));
function bodyForSave(body = st.body) {
    const t = tpl(body);
    t.content.querySelectorAll('img').forEach(img => { if (/^data:/i.test(img.getAttribute('src') || '')) img.removeAttribute('src'); });
    return t.innerHTML.trim();
}
const slideCount = (body = st.body) => Math.max(1, tpl(body).content.querySelectorAll('[data-slide]').length);
const fullDoc = () => `<!DOCTYPE html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n${st.head}\n</head>\n<body>\n${bodyForSave()}\n</body>\n</html>`;

function ensureFontInHead(fontName) {
    const href = fontLinkFor(fontName);
    if (!href) return '';
    if (!st.head.includes(href)) {
        st.head = (st.head ? st.head + '\n' : '') + `<link href="${href}" rel="stylesheet">`;
    }
    postFrame({ t: 'load-font', href });
    return href;
}

// ---------- Undo / Redo ----------
function pushHistory() {
    if (!st.body) return;
    const snap = { head: st.head, body: st.body, format: st.format, width: st.width, height: st.height, active: st.active };
    const cur = st.history[st.hIdx];
    if (cur && cur.body === snap.body && cur.head === snap.head && cur.format === snap.format && cur.width === snap.width && cur.height === snap.height) return;
    st.history = st.history.slice(0, st.hIdx + 1);
    st.history.push(snap);
    if (st.history.length > 40) st.history.shift();
    st.hIdx = st.history.length - 1;
    drawHeader();
}

async function applyHistory(dir) {
    const next = st.hIdx + dir;
    if (next < 0 || next >= st.history.length || st.busy) return;
    st.hIdx = next;
    const snap = st.history[st.hIdx];
    st.head = snap.head; st.body = snap.body; st.format = snap.format;
    st.width = snap.width; st.height = snap.height; st.active = snap.active;
    st.n = slideCount(); st.sel = null;
    drawHeader(); drawContextBar(); drawSlidesBar();
    await render();
    scheduleSave(400);
}

// ---------- Speichern ----------
function scheduleSave(ms = 1100) { clearTimeout(saveT); saveT = setTimeout(() => save().catch(() => {}), ms); }
async function save() {
    if (!st.body) return;
    if (saving) { await saving.catch(() => {}); }
    const f = curFormat();
    const payload = {
        title: st.title, format: st.format,
        ...(st.format === 'custom' ? { width: f.w, height: f.h } : {}),
        slides: slideCount(), head: st.head, body: bodyForSave(), messages: st.messages.slice(-30)
    };
    saving = (async () => {
        try {
            if (!st.id) {
                const { design } = await apiJson('/designs', { method: 'POST', body: JSON.stringify(payload) });
                st.id = design.id;
                if (Router.parse().name === 'design') history.replaceState(null, '', '#/design/' + st.id);
            } else await apiJson('/designs/' + st.id, { method: 'PATCH', body: JSON.stringify(payload) });
            setStatus('Gespeichert');
        } catch (e) { setStatus('Nicht gespeichert: ' + e.message, true); }
    })();
    return saving;
}

// ---------- Vorschau & Zoom ----------
const postFrame = (m) => { try { ui?.frame?.contentWindow?.postMessage({ codenDesign: 1, ...m }, '*'); } catch (_) {} };
async function render() {
    if (!ui) return;
    const has = !!st.body;
    ui.empty.classList.toggle('hidden', has);
    ui.empty.classList.toggle('busy', !has && st.busy);
    ui.emptyTxt.textContent = st.busy ? 'Coden entwirft dein Design …' : 'Starte dein Design';
    ui.canvas.classList.toggle('hidden', !has);
    drawHeader(); drawContextBar(); drawSlidesBar();
    if (!has) return;
    const f = curFormat();
    const lib = await loadLib();
    ui.frame.srcdoc = frameDoc({ head: st.head, body: st.body, format: st.format, w: f.w, h: f.h, lib, mode: 'edit', active: st.active, assets: location.origin });
    fit(); drawCode(); drawPanel();
}

function autoScale() {
    if (!ui) return 0.5;
    const f = curFormat();
    const box = ui.stage.getBoundingClientRect();
    return Math.max(0.12, Math.min((box.width - 64) / f.w, (box.height - 64) / f.h, 1));
}

function fit() {
    if (!ui || !st.body) return;
    const f = curFormat();
    const scale = st.zoom == null ? autoScale() : Math.max(0.15, Math.min(2, st.zoom));
    ui.canvas.style.width = Math.round(f.w * scale) + 'px';
    ui.canvas.style.height = Math.round(f.h * scale) + 'px';
    ui.frame.style.width = f.w + 'px';
    ui.frame.style.height = f.h + 'px';
    ui.frame.style.transform = `scale(${scale})`;
    const pct = Math.round(scale * 100);
    if (ui.zoomRange) ui.zoomRange.value = String(Math.max(20, Math.min(180, pct)));
    if (ui.zoomLbl) ui.zoomLbl.textContent = `${pct}%`;
}

function setZoom(z) {
    st.zoom = z == null ? null : Math.max(0.2, Math.min(1.8, z));
    fit();
}

function onFrameMessage(e) {
    if (!ui || e.source !== ui.frame.contentWindow || !e.data?.codenDesign) return;
    const m = e.data;
    if (m.t === 'ready' || m.t === 'slide') {
        st.n = m.n || 1;
        if (m.t === 'slide') st.active = m.i;
        drawSlidesBar(); drawHeader();
    } else if (m.t === 'sel') {
        st.sel = m.id ? m : { id: null, kind: null, slideBg: m.slideBg };
        drawContextBar();
    } else if (m.t === 'body') {
        const prev = promptMap(st.body);
        st.body = sanitizeDoc(`<html><head></head><body>${m.body}</body></html>`, prev).body;
        st.n = slideCount();
        if (m.commit) pushHistory();
        scheduleSave();
        if (st.view === 'code') drawCode();
        drawSlidesBar();
    } else if (m.t === 'img-select') {
        st.selImg = m.id;
        if (st.tab === 'ai' || st.tab === 'uploads') drawPanel();
    } else if (m.t === 'key') {
        if (m.action === 'undo') applyHistory(-1);
        else if (m.action === 'redo') applyHistory(1);
    } else if (m.t === 'png') {
        const w = exportsWaiting.get(m.req);
        if (w) { exportsWaiting.delete(m.req); m.error ? w.rej(new Error(m.error)) : w.res(m.data); }
    }
}

// ---------- Canvas-Aktionen (Elemente, Slides, Vorlagen) ----------
async function ensureCanvas(bg = '#FFFFFF') {
    if (st.body) return;
    const f = curFormat();
    st.head = `<link href="${fontLinkFor('Plus Jakarta Sans')}" rel="stylesheet">\n<link href="${fontLinkFor('Inter')}" rel="stylesheet">`;
    st.body = blankSlideHtml(f.w, f.h, bg);
    st.active = 0; st.n = 1; st.sel = null;
    pushHistory();
    await render();
    scheduleSave(400);
}

async function addElement(html, font) {
    if (st.busy) return;
    const wasEmpty = !st.body;
    if (wasEmpty) await ensureCanvas('#FFFFFF');
    if (font) ensureFontInHead(font);
    const sendInsert = () => postFrame({ t: 'add-el', html });
    if (wasEmpty) setTimeout(sendInsert, 160);
    else sendInsert();
    if (st.view === 'code') setView('preview');
}

async function insertImageLayer(url, alt = 'Bild', asBg = false) {
    if (st.busy || !url) return;
    const f = curFormat();
    const wasEmpty = !st.body;
    if (wasEmpty) await ensureCanvas('#111114');
    const id = 'img' + Date.now().toString(36);
    const html = asBg
        ? `<img data-cd-layer="image" data-ai-id="${id}" src="${url}" alt="${cleanImagePrompt(alt)}" style="position:absolute;left:0px;top:0px;width:${f.w}px;height:${f.h}px;object-fit:cover;z-index:1">`
        : (() => {
            const w = Math.round(Math.min(f.w, f.h) * 0.56);
            const h = Math.round(w * 0.78);
            return `<img data-cd-layer="image" data-ai-id="${id}" src="${url}" alt="${cleanImagePrompt(alt)}" style="position:absolute;left:${Math.round((f.w - w) / 2)}px;top:${Math.round((f.h - h) / 2)}px;width:${w}px;height:${h}px;object-fit:cover;border-radius:20px;z-index:16">`;
        })();
    const go = () => postFrame({ t: 'add-el', html });
    if (wasEmpty) setTimeout(go, 160);
    else go();
}

async function applyTemplate(t) {
    if (st.busy) return;
    if (st.body && !await confirmBox(`Vorlage „${t.name}“ laden? Das aktuelle Design wird ersetzt (du kannst es per Rückgängig wiederherstellen).`, { ok: 'Vorlage laden', title: 'Vorlage anwenden' })) return;
    const f = formatOf(t.format);
    st.format = f.id; st.width = f.w; st.height = f.h;
    if (!st.titleTouched) { st.title = t.name; if (ui) ui.title.value = st.title; }
    const out = sanitizeDoc(`<!DOCTYPE html><html><head>${t.head || ''}</head><body>${t.body}</body></html>`);
    st.head = out.head; st.body = out.body; st.active = 0; st.n = slideCount(); st.sel = null;
    pushHistory();
    await render();
    scheduleSave(300);
    toast(`Vorlage „${t.name}“ geladen`, { type: 'ok' });
}

async function slideOp(op, index = st.active) {
    if (!st.body || st.busy) return;
    const t = tpl(st.body);
    const list = [...t.content.querySelectorAll('[data-slide]')];
    if (!list.length) return;
    const f = curFormat();
    if (op === 'add') {
        if (list.length >= 10) { toast('Maximal 10 Seiten pro Design.', { type: 'info' }); return; }
        const cur = list[index] || list[list.length - 1];
        const bg = cur.style.backgroundImage || cur.style.backgroundColor || '#FFFFFF';
        const neo = tpl(blankSlideHtml(f.w, f.h, bg)).content.firstElementChild;
        t.content.appendChild(neo);
        st.active = list.length;
    } else if (op === 'dup') {
        if (list.length >= 10) { toast('Maximal 10 Seiten pro Design.', { type: 'info' }); return; }
        const cur = list[index]; if (!cur) return;
        const clone = cur.cloneNode(true);
        cur.after(clone);
        st.active = index + 1;
    } else if (op === 'del') {
        if (list.length <= 1) return;
        list[index]?.remove();
        st.active = Math.max(0, Math.min(index, list.length - 2));
    } else if (op === 'left' && index > 0) {
        list[index - 1].before(list[index]);
        st.active = index - 1;
    } else if (op === 'right' && index < list.length - 1) {
        list[index + 1].after(list[index]);
        st.active = index + 1;
    }
    st.body = t.innerHTML.trim();
    st.n = slideCount(); st.sel = null;
    pushHistory();
    await render();
    scheduleSave(300);
}

// ---------- Bilder ----------
function setImg(id, { src, state = '', prompt } = {}) {
    const t = tpl(st.body); const img = t.content.querySelector(`img[data-ai-id="${CSS.escape(id)}"]`); if (!img) return;
    if (src) img.setAttribute('src', src);
    if (state) img.setAttribute('data-ai-state', state); else img.removeAttribute('data-ai-state');
    if (prompt != null) img.setAttribute('data-ai-image-prompt', prompt);
    st.body = t.innerHTML.trim();
    postFrame({ t: 'set-img', id, src, state, prompt });
    drawPanel(); if (!state) { pushHistory(); scheduleSave(); }
}

async function genImage(id, prompt, gen = st.gen) {
    setImg(id, { src: EMPTY_IMG, state: 'pending', prompt });
    try {
        const r = await apiJson('/designs/image', { method: 'POST', body: JSON.stringify({ prompt }) });
        if (gen !== st.gen) return;
        rememberUpload(r.url, prompt);
        setImg(id, { src: r.url });
    } catch (e) {
        if (gen !== st.gen) return;
        setImg(id, { state: 'error' });
        addMsg('ai', `⚠️ Ein Bild konnte nicht erstellt werden: ${e.message}`);
    }
}

async function runImages() {
    const todo = imagesOf().filter(i => i.state === 'pending' && i.prompt);
    if (!todo.length) return;
    const gen = st.gen; let k = 0, done = 0;
    setStatus(`Bild-KI malt ${todo.length} Bild${todo.length === 1 ? '' : 'er'} …`);
    const worker = async () => { while (k < todo.length && gen === st.gen) { const it = todo[k++]; await genImage(it.id, it.prompt, gen); setStatus(`Bild-KI: ${++done} von ${todo.length} fertig …`); } };
    await Promise.all([worker(), worker()]);
    if (gen === st.gen) { setStatus('Fertig · Elemente direkt auf der Leinwand bearbeiten'); scheduleSave(300); }
}

async function uploadImage(file, { maxSide = 1600, png = false } = {}) {
    if (!/^image\/(png|jpeg|webp|gif|avif|heic)/.test(file.type)) throw new Error('Bitte ein Bild auswählen.');
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    let data = png ? c.toDataURL('image/png') : '';
    for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) { if (data && data.length * 0.75 < 690_000) break; data = c.toDataURL('image/jpeg', q); }
    if (data.length * 0.75 >= 690_000) throw new Error('Das Bild ist zu groß.');
    return apiJson('/designs/upload', { method: 'POST', body: JSON.stringify({ dataUrl: data }) });
}
const pickFile = () => new Promise((res) => { const i = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: () => { res(i.files[0] || null); i.remove(); } }); document.body.append(i); i.click(); });

// ---------- KI: Layout erzeugen bzw. ändern ----------
async function generate(prompt) {
    prompt = String(prompt || '').trim(); if (!prompt || st.busy) return;
    const editing = !!st.body;
    if (!st.titleTouched && !editing) { st.title = prompt.replace(/\s+/g, ' ').slice(0, 60); if (ui) ui.title.value = st.title; }
    addMsg('user', prompt);
    const aiMsg = addMsg('ai', editing ? 'Coden passt das Layout an …' : 'Coden entwirft dein Design …');
    st.busy = true; st.gen++; const gen = st.gen; st.ac = new AbortController(); st.streamText = '';
    drawPanel(); if (!editing) render();
    const f = curFormat();
    const sys = designSystemPrompt({ format: st.format, slides: st.slides, brand: brand(), editing, w: f.w, h: f.h });
    const user = editing ? `Aktuelles Design:\n\`\`\`html\n${fullDoc()}\n\`\`\`\n\nÄnderungswunsch: ${prompt}` : `Auftrag: ${prompt}`;
    const tier = tierNow();
    try {
        const text = await streamAiResponse([{ role: 'system', content: sys }, { role: 'user', content: user }], tier, {
            signal: st.ac.signal, maxTokens: f.multi ? 16000 : 9000,
            onDelta: (t) => { st.streamText = t; updateMsg(aiMsg, `${editing ? 'Coden passt an' : 'Coden entwirft'} … ${(t.length / 1000).toFixed(1)}k Zeichen`); if (st.view === 'code') drawCode(); }
        });
        if (gen !== st.gen) return;
        const html = extractHtml(text);
        if (!html) { updateMsg(aiMsg, '⚠️ Die KI hat kein Design geliefert. Formuliere den Wunsch etwas genauer.'); return; }
        const prev = promptMap(st.body);
        const out = sanitizeDoc(html, prev);
        st.head = out.head; st.body = out.body; st.n = slideCount(); st.active = editing ? Math.min(st.active, st.n - 1) : 0; st.sel = null;
        const imgs = imagesOf(); const freshCount = imgs.filter(i => i.state === 'pending').length;
        updateMsg(aiMsg, `${editing ? 'Angepasst' : 'Fertig'}: ${st.n} Seite${st.n === 1 ? '' : 'n'}${freshCount ? `, ${freshCount} Bild${freshCount === 1 ? '' : 'er'} werden gemalt` : ''}. Klicke Elemente direkt auf der Leinwand an.`);
        pushHistory();
        await render(); scheduleSave(200);
        await runImages();
    } catch (e) {
        if (gen !== st.gen) return;
        updateMsg(aiMsg, st.ac?.signal.aborted ? 'Abgebrochen.' : `⚠️ ${e.code === 'limit' ? e.message : 'Fehler: ' + e.message}`);
    } finally {
        if (gen === st.gen) { st.busy = false; st.ac = null; st.streamText = ''; drawPanel(); render(); }
    }
}

// ---------- Export (PNG / JPG, 1× / 2×, einzelne Seite oder ZIP) ----------
function exportSlide(i, { mime = 'image/png', ratio = 1, quality = 0.92 } = {}) {
    return new Promise((res, rej) => {
        const req = ++reqN; exportsWaiting.set(req, { res, rej });
        postFrame({ t: 'export', i, req, ratio, mime, quality });
        setTimeout(() => { if (exportsWaiting.has(req)) { exportsWaiting.delete(req); rej(new Error('Der Export hat zu lange gedauert.')); } }, 90_000);
    });
}
const bytesOf = (dataUrl) => { const b = atob(String(dataUrl).split(',')[1] || ''); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const download = (blob, name) => { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };

async function runExport({ ext = 'png', ratio = 1, all = true } = {}) {
    if (!st.body) return;
    if (imagesOf().some(i => i.state === 'pending')) { toast('Warte kurz, die Bild-KI malt noch.', { type: 'info' }); return; }
    const mime = ext === 'jpg' ? 'image/jpeg' : 'image/png';
    const n = st.n || 1;
    setStatus(n > 1 && all ? `Exportiere ${n} Seiten (${ext.toUpperCase()} ${ratio}×) …` : `Exportiere ${ext.toUpperCase()} (${ratio}×) …`);
    try {
        if (n === 1 || !all) {
            const i = n === 1 ? 0 : st.active;
            const data = await exportSlide(i, { mime, ratio });
            download(new Blob([bytesOf(data)], { type: mime }), exportName(st.title, i + 1, n === 1 ? 1 : n, ext));
        } else {
            const files = [];
            for (let i = 0; i < n; i++) {
                setStatus(`Exportiere Seite ${i + 1} von ${n} …`);
                files.push({ name: exportName(st.title, i + 1, n, ext), data: bytesOf(await exportSlide(i, { mime, ratio })) });
            }
            download(new Blob([buildZipBytes(files)], { type: 'application/zip' }), exportName(st.title, 1, 1, 'png').replace(/\.png$/, '.zip'));
        }
        setStatus('Export abgeschlossen');
        toast('Export heruntergeladen', { type: 'ok' });
    } catch (e) { setStatus('Export fehlgeschlagen: ' + e.message, true); toast('Export fehlgeschlagen: ' + e.message, { type: 'error' }); }
}

function exportModal() {
    if (!st.body) { toast('Erstelle erst ein Design oder wähle eine Vorlage.', { type: 'info' }); return; }
    let ext = 'png', ratio = 1, all = (st.n || 1) > 1;
    const f = curFormat();
    const dimLbl = h('small', { class: 'dz-exp-dim' });
    const updateDim = () => { dimLbl.textContent = `Ausgabegröße: ${f.w * ratio} × ${f.h * ratio} px${all && st.n > 1 ? ` · ${st.n} Dateien als ZIP` : ''}`; };
    const seg = (items, cur, onPick) => {
        const wrap = h('div', { class: 'dz-seg' });
        const draw = () => wrap.replaceChildren(...items.map(([val, lbl, sub]) => h('button', {
            type: 'button', class: 'dz-seg-btn' + (cur() === val ? ' on' : ''),
            onclick: () => { onPick(val); draw(); updateDim(); }
        }, h('b', { text: lbl }), sub ? h('small', { text: sub }) : null)));
        draw(); return wrap;
    };
    updateDim();
    const m = modal('Design exportieren', h('div', { class: 'dz-exp-form' },
        h('div', { class: 'dz-field' }, h('span', { text: 'Dateiformat' }),
            seg([['png', 'PNG', 'Verlustfrei, gestochen scharf'], ['jpg', 'JPG', 'Kleinere Dateigröße']], () => ext, v => { ext = v; })),
        h('div', { class: 'dz-field' }, h('span', { text: 'Auflösung' }),
            seg([[1, '1× Standard', `${f.w} × ${f.h} px`], [2, '2× HD / Retina', `${f.w * 2} × ${f.h * 2} px`]], () => ratio, v => { ratio = v; })),
        (st.n || 1) > 1 ? h('div', { class: 'dz-field' }, h('span', { text: 'Seiten' }),
            seg([[true, `Alle ${st.n} Seiten (ZIP)`, 'Komplettes Set'], [false, `Nur Seite ${st.active + 1}`, 'Einzelbild']], () => all, v => { all = v; })) : null,
        dimLbl,
        h('div', { class: 'cd-row end' },
            h('button', { type: 'button', class: 'cd-btn', text: 'Abbrechen', onclick: () => m.close() }),
            h('button', { type: 'button', class: 'cd-primary', onclick: () => { m.close(); runExport({ ext, ratio, all }); } }, icon('download'), ' Herunterladen'))));
}

// ---------- Format & Größe Modal ----------
function formatModal() {
    let pickFmt = st.format;
    let cw = st.width || curFormat().w;
    let ch = st.height || curFormat().h;
    let slN = st.slides || 5;
    const customRow = h('div', { class: 'dz-custom-row' });
    const wInp = h('input', { type: 'number', class: 'cd-input', min: 200, max: 4000, value: cw, 'aria-label': 'Breite in Pixel' });
    const hInp = h('input', { type: 'number', class: 'cd-input', min: 200, max: 4000, value: ch, 'aria-label': 'Höhe in Pixel' });
    wInp.addEventListener('input', () => { cw = Number(wInp.value) || 1080; });
    hInp.addEventListener('input', () => { ch = Number(hInp.value) || 1080; });
    customRow.append(
        h('label', { class: 'dz-field' }, h('span', { text: 'Breite (px)' }), wInp),
        h('label', { class: 'dz-field' }, h('span', { text: 'Höhe (px)' }), hInp)
    );
    const slidesVal = h('b', { text: String(slN) });
    const slidesRow = h('div', { class: 'dz-slides' },
        h('span', { text: 'Anzahl Slides für KI-Entwurf' }),
        h('button', { type: 'button', class: 'cd-x', onclick: () => { slN = Math.max(2, slN - 1); slidesVal.textContent = String(slN); } }, icon('remove')),
        slidesVal,
        h('button', { type: 'button', class: 'cd-x', onclick: () => { slN = Math.min(10, slN + 1); slidesVal.textContent = String(slN); } }, icon('add')));

    const grid = h('div', { class: 'dz-fmt-grid' });
    const draw = () => {
        grid.replaceChildren(...Object.values(FORMATS).map(f => h('button', {
            type: 'button', class: 'dz-fmt' + (pickFmt === f.id ? ' on' : ''),
            onclick: () => { pickFmt = f.id; if (f.id !== 'custom') { cw = f.w; ch = f.h; wInp.value = cw; hInp.value = ch; } draw(); }
        }, icon(f.icon), h('b', { text: f.label }), h('small', { text: f.hint }))));
        customRow.classList.toggle('hidden', pickFmt !== 'custom');
        slidesRow.classList.toggle('hidden', !FORMATS[pickFmt]?.multi);
    };
    draw();

    const applyFmt = async (withAi) => {
        const nf = formatOf(pickFmt, cw, ch);
        st.format = nf.id; st.width = nf.w; st.height = nf.h; st.slides = slN;
        if (st.body) {
            const t = tpl(st.body);
            t.content.querySelectorAll('[data-slide]').forEach(s => { s.style.width = nf.w + 'px'; s.style.height = nf.h + 'px'; });
            st.body = t.innerHTML.trim();
            pushHistory();
            await render();
            scheduleSave(300);
        } else {
            drawHeader();
        }
        m.close();
        if (withAi && st.body) {
            st.tab = 'ai'; st.drawerOpen = true; drawRail(); drawPanel();
            generate(`Passe das Design an das neue Format ${nf.label} (${nf.w} × ${nf.h} px${nf.multi ? `, ${st.slides} Slides` : ''}) an. Inhalt und Stil bleiben.`);
        }
    };

    const m = modal('Format & Größe wählen', h('div', { class: 'dz-fmt-modal' },
        grid, customRow, slidesRow,
        h('div', { class: 'cd-row end' },
            st.body ? h('button', { type: 'button', class: 'cd-btn', onclick: () => applyFmt(true) }, icon('auto_awesome'), ' Per KI anpassen') : null,
            h('button', { type: 'button', class: 'cd-primary', onclick: () => applyFmt(false) }, icon('check'), ' Format übernehmen'))), { wide: true });
}

// ---------- Meine Designs ----------
async function designsModal() {
    const box = h('div', { class: 'dz-list' }, h('p', { class: 'cd-text', text: 'Lade …' }));
    const m = modal('Meine Designs', box, { wide: true });
    let list = [];
    try { list = (await apiJson('/designs')).designs || []; } catch (e) { box.replaceChildren(h('p', { class: 'cd-err', text: e.message })); return; }
    if (!list.length) { box.replaceChildren(h('p', { class: 'cd-text', text: 'Noch keine Designs. Wähle eine Vorlage oder beschreib im KI-Studio, was du brauchst.' })); return; }
    box.replaceChildren(h('div', { class: 'dz-grid' }, list.map(d => designCard(d, { onOpen: () => m.close(), onDeleted: () => designsModal().then(() => m.close()) }))));
}

/** Karte mit Vorschaubild (für „Meine Designs“ und den Artefakte-Bereich). */
export function designCard(d, { onOpen, onDeleted } = {}) {
    const f = formatOf(d.format, d.width, d.height);
    const thumb = h('div', { class: 'dz-thumb', style: { aspectRatio: `${f.w} / ${f.h}` } });
    const del = onDeleted ? h('button', { type: 'button', class: 'dz-del', title: 'Löschen', 'aria-label': 'Design löschen', onclick: async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (!await confirmBox(`„${d.title}“ löschen?`, { ok: 'Löschen', danger: true })) return;
        try { await apiJson('/designs/' + d.id, { method: 'DELETE' }); if (st.id === d.id) st = fresh(); onDeleted(); } catch (err) { toast(err.message, { type: 'error' }); }
    } }, icon('delete')) : null;
    const card = h('a', { class: 'dz-card', href: '#/design/' + d.id, onclick: () => onOpen?.() },
        thumb, h('b', { text: d.title }), h('small', { text: `${f.label}${d.slides > 1 ? ` · ${d.slides} Seiten` : ''} · ${timeAgo(d.updatedAt)}` }), del);
    const io = new IntersectionObserver(async (entries) => {
        if (!entries.some(e => e.isIntersecting)) return; io.disconnect();
        try {
            const { design } = await apiJson('/designs/' + d.id);
            const fr = h('iframe', { sandbox: 'allow-scripts', tabindex: '-1', 'aria-hidden': 'true', loading: 'lazy', referrerpolicy: 'no-referrer' });
            fr.style.width = f.w + 'px'; fr.style.height = f.h + 'px';
            fr.srcdoc = frameDoc({ head: design.head, body: design.body, format: design.format, w: f.w, h: f.h, mode: 'view', assets: location.origin });
            thumb.append(fr);
            const sc = () => { fr.style.transform = `scale(${thumb.clientWidth / f.w})`; };
            sc(); new ResizeObserver(sc).observe(thumb);
        } catch (_) { thumb.append(icon('palette')); }
    }, { rootMargin: '200px' });
    io.observe(thumb);
    return card;
}
export const listDesigns = async () => (await apiJson('/designs')).designs || [];

// ---------- UI-Render-Helfer ----------
function setStatus(text, bad = false) { if (ui?.status) { ui.status.textContent = text; ui.status.classList.toggle('bad', bad); } }
function addMsg(role, text) { const m = { role, text }; st.messages.push(m); if (st.tab === 'ai') drawPanel(); return m; }
function updateMsg(m, text) { m.text = text; if (st.tab === 'ai') drawAiMsgs(); }

function drawHeader() {
    if (!ui) return;
    const f = curFormat();
    ui.fmtBtn.replaceChildren(icon(f.icon), h('span', { text: `${f.label} · ${f.w}×${f.h}` }), icon('expand_more'));
    ui.undoBtn.disabled = st.hIdx <= 0 || st.busy;
    ui.redoBtn.disabled = st.hIdx >= st.history.length - 1 || st.busy;
    ui.exportBtn.disabled = !st.body || st.busy;
}

function drawRail() {
    if (!ui) return;
    ui.rail.replaceChildren(...RAIL_TABS.map(([id, ic, lbl]) => h('button', {
        type: 'button',
        class: 'dz-rail-btn' + (st.drawerOpen && st.tab === id ? ' on' : ''),
        'aria-pressed': String(st.drawerOpen && st.tab === id),
        onclick: () => {
            if (st.tab === id && st.drawerOpen) st.drawerOpen = false;
            else { st.tab = id; st.drawerOpen = true; }
            ui.body.classList.toggle('drawer-closed', !st.drawerOpen);
            drawRail(); drawPanel();
            setTimeout(() => fit(), 220);
        }
    }, icon(ic), h('span', { text: lbl }))));
    ui.body.classList.toggle('drawer-closed', !st.drawerOpen);
}

// ---------- Kontext-Toolbar (dynamisch je nach Auswahl) ----------
function sendStyle(patch, target) {
    if (patch.fontFamily) ensureFontInHead(patch.fontFamily);
    postFrame({ t: 'style', patch, target });
}

function drawContextBar() {
    if (!ui) return;
    const bar = ui.ctxBar;
    if (!st.body || st.view === 'code') {
        bar.replaceChildren(h('span', { class: 'dz-ctx-hint', text: st.view === 'code' ? 'HTML/CSS Experten-Modus · Änderungen über „Übernehmen“ anwenden' : 'Wähle links eine Vorlage, starte mit leerer Leinwand oder beschreibe dein Design im KI-Studio.' }));
        return;
    }
    const sel = st.sel;
    const sep = () => h('span', { class: 'dz-sep' });
    const colorChip = (val, title, onChange, allowClear = false) => {
        const inp = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(val) ? val : '#111114', title, 'aria-label': title });
        inp.addEventListener('input', () => onChange(inp.value));
        const wrap = h('label', { class: 'dz-cchip', title }, h('span', { class: 'dz-cswatch', style: { background: val || 'transparent' } }), inp);
        if (allowClear && val) {
            return h('span', { class: 'dz-cwrap' }, wrap, h('button', { type: 'button', class: 'dz-cclr', title: 'Keine Farbe', onclick: () => onChange('') }, icon('block')));
        }
        return wrap;
    };
    const tbtn = (ic, tip, active, fn, danger = false) => h('button', {
        type: 'button', class: 'dz-tbtn' + (active ? ' on' : '') + (danger ? ' danger' : ''), title: tip, 'aria-label': tip, onclick: fn
    }, icon(ic));

    if (!sel || !sel.id) {
        const bg = sel?.slideBg?.color || '#ffffff';
        bar.replaceChildren(
            h('span', { class: 'dz-ctx-lbl', text: 'Hintergrund' }),
            colorChip(bg, 'Hintergrundfarbe der Seite', v => sendStyle({ backgroundColor: v }, 'slide')),
            h('div', { class: 'dz-quick-sw' }, BACKGROUNDS.solids.slice(0, 7).map(c => h('button', {
                type: 'button', class: 'dz-qsw', title: c.name, style: { background: c.value },
                onclick: () => sendStyle({ backgroundColor: c.value }, 'slide')
            }))),
            sep(),
            h('button', { type: 'button', class: 'dz-tchip', onclick: () => { const f = curFormat(); addElement(TEXT_PRESETS[0].make(f.w, f.h)); } }, icon('title'), ' + Text'),
            h('button', { type: 'button', class: 'dz-tchip', onclick: () => { const f = curFormat(); addElement(SHAPES[1].make(f.w, f.h)); } }, icon('category'), ' + Form'),
            h('button', { type: 'button', class: 'dz-tchip', onclick: () => { st.tab = 'elements'; st.drawerOpen = true; drawRail(); drawPanel(); } }, icon('gradient'), ' Verläufe'),
            h('span', { class: 'grow' }),
            h('span', { class: 'dz-ctx-hint', text: 'Element anklicken zum Verschieben · Doppelklick auf Text zum Schreiben' })
        );
        return;
    }

    const s = sel.styles || {};
    const commonEnd = [
        sep(),
        h('span', { class: 'dz-op-wrap', title: 'Deckkraft' },
            icon('opacity'),
            h('input', { type: 'range', min: 5, max: 100, value: s.opacity ?? 100, class: 'dz-mini-range', oninput: (e) => sendStyle({ opacity: Number(e.target.value) }) })),
        sep(),
        tbtn('align_horizontal_center', 'Horizontal zentrieren', false, () => postFrame({ t: 'cmd', cmd: 'align', arg: 'cx' })),
        tbtn('align_vertical_center', 'Vertikal zentrieren', false, () => postFrame({ t: 'cmd', cmd: 'align', arg: 'cy' })),
        tbtn('flip_to_front', 'Eine Ebene nach vorne', false, () => postFrame({ t: 'cmd', cmd: 'front' })),
        tbtn('flip_to_back', 'Eine Ebene nach hinten', false, () => postFrame({ t: 'cmd', cmd: 'back' })),
        sep(),
        tbtn('content_copy', 'Duplizieren (Strg+D)', false, () => postFrame({ t: 'cmd', cmd: 'dup' })),
        tbtn('delete', 'Löschen (Entf)', false, () => postFrame({ t: 'cmd', cmd: 'del' }), true)
    ];

    if (sel.kind === 'text') {
        const fontSel = h('select', { class: 'dz-ctx-sel', 'aria-label': 'Schriftart', onchange: (e) => sendStyle({ fontFamily: e.target.value }) },
            FONTS.map(f => h('option', { value: f, selected: f.toLowerCase() === String(s.fontFamily || '').toLowerCase() }, f)));
        if (s.fontFamily && !FONTS.some(f => f.toLowerCase() === s.fontFamily.toLowerCase())) {
            fontSel.prepend(h('option', { value: s.fontFamily, selected: true }, s.fontFamily));
        }
        let fz = s.fontSize || 48;
        const fzInp = h('input', { type: 'number', class: 'dz-num', min: 10, max: 400, value: fz, 'aria-label': 'Schriftgröße', onchange: () => { fz = Number(fzInp.value) || 32; sendStyle({ fontSize: fz }); } });
        const stepFz = (d) => { fz = Math.max(10, Math.min(400, fz + d)); fzInp.value = fz; sendStyle({ fontSize: fz }); };
        const isBold = Number(s.fontWeight) >= 600 || s.fontWeight === 'bold';
        const isItalic = s.fontStyle === 'italic';
        const isUnder = String(s.textDecoration || '').includes('underline');
        const isUpper = s.textTransform === 'uppercase';

        bar.replaceChildren(
            fontSel,
            h('div', { class: 'dz-stepper' },
                h('button', { type: 'button', onclick: () => stepFz(-4), title: 'Kleiner' }, icon('remove')),
                fzInp,
                h('button', { type: 'button', onclick: () => stepFz(4), title: 'Größer' }, icon('add'))),
            sep(),
            colorChip(s.color, 'Textfarbe', v => sendStyle({ color: v })),
            colorChip(s.backgroundColor, 'Texthintergrund', v => sendStyle({ backgroundColor: v }), true),
            sep(),
            tbtn('format_bold', 'Fett', isBold, () => sendStyle({ fontWeight: isBold ? '400' : '700' })),
            tbtn('format_italic', 'Kursiv', isItalic, () => sendStyle({ fontStyle: isItalic ? 'normal' : 'italic' })),
            tbtn('format_underlined', 'Unterstrichen', isUnder, () => sendStyle({ textDecoration: isUnder ? 'none' : 'underline' })),
            tbtn('match_case', 'Großbuchstaben', isUpper, () => sendStyle({ textTransform: isUpper ? 'none' : 'uppercase' })),
            sep(),
            tbtn('format_align_left', 'Linksbündig', s.textAlign === 'left' || s.textAlign === 'start', () => sendStyle({ textAlign: 'left' })),
            tbtn('format_align_center', 'Zentriert', s.textAlign === 'center', () => sendStyle({ textAlign: 'center' })),
            tbtn('format_align_right', 'Rechtsbündig', s.textAlign === 'right' || s.textAlign === 'end', () => sendStyle({ textAlign: 'right' })),
            ...commonEnd
        );
    } else if (sel.kind === 'image') {
        const im = sel.img;
        const fitMode = s.objectFit || 'cover';
        const filterSel = h('select', { class: 'dz-ctx-sel sm', 'aria-label': 'Bildfilter', onchange: (e) => sendStyle({ filter: e.target.value }) },
            IMG_FILTERS.map(([lbl, val]) => h('option', { value: val }, 'Filter: ' + lbl)));
        const radInp = h('input', { type: 'number', class: 'dz-num', min: 0, max: 500, value: s.borderRadius || 0, title: 'Eckenradius (px)', onchange: () => sendStyle({ borderRadius: Number(radInp.value) || 0 }) });
        bar.replaceChildren(
            im?.aiId && im.prompt ? h('button', { type: 'button', class: 'dz-tchip', onclick: () => genImage(im.aiId, im.prompt) }, icon('refresh'), ' Neu malen') : null,
            im?.aiId ? h('button', { type: 'button', class: 'dz-tchip', onclick: async () => {
                const p = await promptBox('Bild per KI neu beschreiben', { label: 'Beschreibung (am besten Englisch, ohne Text im Bild)', value: im.prompt || '', ok: 'Neu generieren' });
                if (p && p.trim()) genImage(im.aiId, cleanImagePrompt(p));
            } }, icon('auto_awesome'), ' KI-Prompt') : null,
            im?.aiId ? h('button', { type: 'button', class: 'dz-tchip', onclick: async () => {
                const file = await pickFile(); if (!file) return;
                setImg(im.aiId, { src: im.src, state: 'pending' });
                try { const r = await uploadImage(file); rememberUpload(r.url, file.name); setImg(im.aiId, { src: r.url }); }
                catch (err) { setImg(im.aiId, { src: im.src, state: im.state }); toast(err.message, { type: 'error' }); }
            } }, icon('upload'), ' Ersetzen') : null,
            sep(),
            tbtn('crop_free', fitMode === 'cover' ? 'Einpassen (Contain)' : 'Ausfüllen (Cover)', fitMode === 'contain', () => sendStyle({ objectFit: fitMode === 'cover' ? 'contain' : 'cover' })),
            filterSel,
            h('label', { class: 'dz-mini-lbl', title: 'Eckenradius' }, icon('rounded_corner'), radInp),
            ...commonEnd
        );
    } else {
        const bwInp = h('input', { type: 'number', class: 'dz-num', min: 0, max: 40, value: s.borderWidth || 0, title: 'Rahmenstärke (px)', onchange: () => sendStyle({ borderWidth: Number(bwInp.value) || 0 }) });
        const radInp = h('input', { type: 'number', class: 'dz-num', min: 0, max: 500, value: Math.min(500, s.borderRadius || 0), title: 'Eckenradius (px)', onchange: () => sendStyle({ borderRadius: Number(radInp.value) || 0 }) });
        bar.replaceChildren(
            h('span', { class: 'dz-ctx-lbl', text: sel.hasSvg ? 'Farbe' : 'Füllung' }),
            sel.hasSvg
                ? colorChip(s.color, 'Symbolfarbe', v => sendStyle({ color: v || '#18181b' }))
                : colorChip(s.backgroundColor, 'Füllfarbe', v => sendStyle({ backgroundColor: v }), true),
            sep(),
            h('span', { class: 'dz-ctx-lbl', text: 'Rahmen' }),
            colorChip(s.borderColor, 'Rahmenfarbe', v => sendStyle({ borderColor: v, borderWidth: Math.max(2, Number(bwInp.value) || 2) })),
            bwInp,
            sep(),
            h('label', { class: 'dz-mini-lbl', title: 'Eckenradius' }, icon('rounded_corner'), radInp),
            ...commonEnd
        );
    }
}

// ---------- Linkes Werkzeug-Panel (6 Tabs) ----------
function drawAiMsgs() {
    if (!ui?.aiMsgs) return;
    if (!st.messages.length) {
        ui.aiMsgs.replaceChildren(h('div', { class: 'dz-hello' },
            h('b', { text: 'Was möchtest du gestalten?' }),
            h('p', { text: 'Beschreib Anlass, Inhalt und Stimmung – Coden baut das Layout und die Bild-KI malt passende Motive. Danach kannst du jedes Element frei verschieben.' }),
            h('div', { class: 'dz-ideas' }, IDEAS.map(([ic, t]) => h('button', {
                type: 'button', class: 'dz-idea',
                onclick: () => {
                    if (/Karussell/.test(t) && !st.body) { st.format = 'carousel'; drawHeader(); }
                    if (ui.aiInput) { ui.aiInput.value = t; ui.aiInput.focus(); }
                }
            }, icon(ic), h('span', { text: t }))))));
        return;
    }
    ui.aiMsgs.replaceChildren(...st.messages.map(m => h('div', { class: 'dz-msg ' + m.role }, h('span', { text: m.text }))));
    ui.aiMsgs.scrollTop = ui.aiMsgs.scrollHeight;
}

function renderImagesList() {
    const list = imagesOf();
    if (!list.length) return null;
    return h('details', { class: 'dz-imgbox', open: true },
        h('summary', { text: `Bilder im Design (${list.length})` }),
        h('div', { class: 'dz-imgs' }, list.map((im, k) => {
            const thumb = im.state === 'pending' ? h('span', { class: 'dz-ithumb pending' })
                : im.state === 'error' ? h('span', { class: 'dz-ithumb err' }, icon('error'))
                : h('img', { class: 'dz-ithumb', src: im.src, alt: '' });
            const regen = h('button', { type: 'button', class: 'cd-x', title: 'Neu generieren', disabled: im.state === 'pending' || !im.prompt || st.busy, onclick: (e) => { e.stopPropagation(); genImage(im.id, im.prompt); } }, icon('refresh'));
            const edit = h('button', { type: 'button', class: 'cd-x', title: 'Prompt ändern', disabled: im.state === 'pending' || st.busy, onclick: async (e) => {
                e.stopPropagation();
                const p = await promptBox('Bild neu beschreiben', { label: 'Beschreibung (am besten Englisch, ohne Text im Bild)', value: im.prompt, ok: 'Neu generieren' });
                if (p && p.trim()) genImage(im.id, cleanImagePrompt(p));
            } }, icon('edit'));
            const upl = h('button', { type: 'button', class: 'cd-x', title: 'Eigenes Bild hochladen', disabled: im.state === 'pending' || st.busy, onclick: async (e) => {
                e.stopPropagation(); const f = await pickFile(); if (!f) return;
                setImg(im.id, { src: im.src, state: 'pending' });
                try { const r = await uploadImage(f); rememberUpload(r.url, f.name); setImg(im.id, { src: r.url }); }
                catch (err) { setImg(im.id, { src: im.src, state: im.state }); toast(err.message, { type: 'error' }); }
            } }, icon('upload'));
            return h('div', { class: 'dz-irow' + (st.selImg === im.id ? ' sel' : ''), role: 'button', tabindex: '0', onclick: () => { st.selImg = im.id; postFrame({ t: 'select-img', id: im.id }); drawPanel(); } },
                thumb, h('span', { class: 'dz-itext' }, h('b', { text: `Bild ${k + 1}${(st.n || 1) > 1 ? ` · Seite ${im.slide + 1}` : ''}` }), h('small', { text: im.prompt || im.alt || 'eigenes Bild' })), regen, edit, upl);
        })));
}

function drawPanel() {
    if (!ui) return;
    const p = ui.panel;
    const prevDraft = ui.aiInput?.value || '';
    const hadAiFocus = ui.aiInput && document.activeElement === ui.aiInput;
    ui.aiMsgs = null; ui.aiInput = null;

    if (st.tab === 'ai') {
        const msgs = h('div', { class: 'dz-msgs', 'aria-live': 'polite' });
        const input = h('textarea', {
            class: 'dz-input', rows: 3, maxlength: 2000, value: prevDraft,
            placeholder: st.body ? 'Was soll Coden ändern? z. B. „Farben wärmer, Headline größer“' : 'Beschreib dein Design …'
        });
        const send = h('button', { type: 'button', class: 'dz-send' + (st.busy ? ' hidden' : ''), title: 'Erstellen', 'aria-label': 'Design erstellen', onclick: () => { const v = input.value; input.value = ''; generate(v); } }, icon('arrow_upward'));
        const stop = h('button', { type: 'button', class: 'dz-send stop' + (st.busy ? '' : ' hidden'), title: 'Stopp', 'aria-label': 'Stopp', onclick: () => st.ac?.abort() }, icon('stop'));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click(); } });
        const tierLbl = h('small', { class: 'dz-tier', text: `${TIER_NAME[tierNow()] || 'Coden'} · Layout + Bild-KI` });
        ui.aiMsgs = msgs; ui.aiInput = input;
        p.replaceChildren(
            h('div', { class: 'dz-phead' }, h('b', { text: 'KI-Designer' }), h('small', { text: 'Erstellen & per Chat verfeinern' })),
            msgs,
            renderImagesList(),
            h('div', { class: 'dz-composer' }, input, h('div', { class: 'dz-comprow' }, tierLbl, send, stop))
        );
        drawAiMsgs();
        if (hadAiFocus) input.focus();
        return;
    }

    if (st.tab === 'templates') {
        const cats = ['Alle', 'Social', 'Karussell', 'Story', 'Video', 'Präsentation', 'Print'];
        const list = st.tplCat === 'Alle' ? TEMPLATES : TEMPLATES.filter(t => t.cat === st.tplCat);
        p.replaceChildren(
            h('div', { class: 'dz-phead' }, h('b', { text: 'Vorlagen' }), h('small', { text: 'Sofort anklicken & frei bearbeiten' })),
            h('div', { class: 'dz-chips' }, cats.map(c => h('button', {
                type: 'button', class: 'dz-chip' + (st.tplCat === c ? ' on' : ''),
                onclick: () => { st.tplCat = c; drawPanel(); }
            }, c))),
            h('div', { class: 'dz-pscroll' },
                h('button', { type: 'button', class: 'dz-blank-btn', onclick: async () => {
                    if (st.body && !await confirmBox('Neue leere Leinwand starten?', { ok: 'Leer starten' })) return;
                    st.body = ''; await ensureCanvas('#FFFFFF'); toast('Leere Leinwand bereit', { type: 'ok' });
                } }, icon('add_box'), h('span', {}, h('b', { text: 'Leere Leinwand' }), h('small', { text: `${curFormat().label} · ${curFormat().w}×${curFormat().h}` }))),
                h('div', { class: 'dz-tpl-grid' }, list.map(t => h('button', {
                    type: 'button', class: 'dz-tpl-card', onclick: () => applyTemplate(t)
                },
                    h('div', { class: 'dz-tpl-prev', style: { background: t.previewBg, color: t.previewFg } },
                        h('span', { class: 'dz-tpl-tag', style: { background: t.previewAccent, color: (parseInt(t.previewAccent.slice(1, 3), 16) * 0.299 + parseInt(t.previewAccent.slice(3, 5), 16) * 0.587 + parseInt(t.previewAccent.slice(5, 7), 16) * 0.114) > 145 ? '#111' : '#fff' }, text: t.previewTag }),
                        h('strong', { text: t.previewTitle })),
                    h('div', { class: 'dz-tpl-meta' }, h('b', { text: t.name }), h('small', { text: formatOf(t.format).label }))))))
        );
        return;
    }

    if (st.tab === 'text') {
        const basics = TEXT_PRESETS.filter(x => !x.group);
        const combos = TEXT_PRESETS.filter(x => x.group === 'combos');
        p.replaceChildren(
            h('div', { class: 'dz-phead' }, h('b', { text: 'Text' }), h('small', { text: 'Klicken zum Einfügen auf die Leinwand' })),
            h('div', { class: 'dz-pscroll' },
                h('div', { class: 'dz-txt-stack' }, basics.map(x => h('button', {
                    type: 'button', class: 'dz-txt-btn',
                    onclick: () => { const f = curFormat(); addElement(x.make(f.w, f.h), x.font); }
                }, h('span', { style: x.sampleStyle, text: x.preview })))),
                h('div', { class: 'dz-psec', text: 'Schrift-Kombinationen & Badges' }),
                h('div', { class: 'dz-combo-grid' }, combos.map(x => h('button', {
                    type: 'button', class: 'dz-combo-card',
                    onclick: () => { const f = curFormat(); addElement(x.make(f.w, f.h), x.font); }
                }, h('span', { style: x.sampleStyle, text: x.preview }), h('small', { text: x.label })))))
        );
        return;
    }

    if (st.tab === 'elements') {
        const shapes = SHAPES.filter(x => x.cat === 'shapes');
        const decos = SHAPES.filter(x => x.cat === 'deco');
        const customBg = h('input', { type: 'color', value: st.sel?.slideBg?.color || '#ffffff', title: 'Eigene Hintergrundfarbe' });
        customBg.addEventListener('input', async () => { if (!st.body) await ensureCanvas(customBg.value); else sendStyle({ backgroundColor: customBg.value }, 'slide'); });
        p.replaceChildren(
            h('div', { class: 'dz-phead' }, h('b', { text: 'Elemente & Hintergründe' }), h('small', { text: 'Formen, Icons und Verläufe' })),
            h('div', { class: 'dz-pscroll' },
                h('div', { class: 'dz-psec', text: 'Formen' }),
                h('div', { class: 'dz-el-grid' }, shapes.map(s => h('button', {
                    type: 'button', class: 'dz-el-tile', title: s.label,
                    onclick: () => { const f = curFormat(); addElement(s.make(f.w, f.h)); }
                }, icon(s.icon), h('small', { text: s.label })))),
                h('div', { class: 'dz-psec', text: 'Deko & Symbole' }),
                h('div', { class: 'dz-el-grid' }, decos.map(s => h('button', {
                    type: 'button', class: 'dz-el-tile', title: s.label,
                    onclick: () => { const f = curFormat(); addElement(s.make(f.w, f.h)); }
                }, icon(s.icon), h('small', { text: s.label })))),
                h('div', { class: 'dz-psec', text: 'Hintergrundfarbe' }),
                h('div', { class: 'dz-bg-solids' },
                    h('label', { class: 'dz-sw-pick', title: 'Eigene Farbe' }, icon('colorize'), customBg),
                    ...BACKGROUNDS.solids.map(c => h('button', {
                        type: 'button', class: 'dz-bg-sw', title: c.name, style: { background: c.value },
                        onclick: async () => { if (!st.body) await ensureCanvas(c.value); else sendStyle({ backgroundColor: c.value }, 'slide'); }
                    }))),
                h('div', { class: 'dz-psec', text: 'Verläufe' }),
                h('div', { class: 'dz-grad-grid' }, BACKGROUNDS.gradients.map(g => h('button', {
                    type: 'button', class: 'dz-grad-tile', title: g.name, style: { background: g.value },
                    onclick: async () => { if (!st.body) await ensureCanvas(g.value); else sendStyle({ backgroundImage: g.value }, 'slide'); }
                }, h('span', { text: g.name }))))
            )
        );
        return;
    }

    if (st.tab === 'uploads') {
        const uploads = loadUploads();
        const aiImgInp = h('input', { class: 'cd-input', placeholder: 'Bildidee, z. B. minimal coffee cup warm light …', maxlength: 400 });
        const aiImgBtn = h('button', { type: 'button', class: 'cd-primary sm', onclick: async () => {
            const prompt = cleanImagePrompt(aiImgInp.value);
            if (prompt.length < 3) { toast('Beschreib das Bild kurz.', { type: 'info' }); return; }
            aiImgBtn.disabled = true; setStatus('Bild-KI erzeugt Bild …');
            try {
                const r = await apiJson('/designs/image', { method: 'POST', body: JSON.stringify({ prompt }) });
                rememberUpload(r.url, prompt);
                aiImgInp.value = '';
                await insertImageLayer(r.url, prompt, false);
                drawPanel();
                setStatus('KI-Bild eingefügt');
            } catch (e) { toast(e.message, { type: 'error' }); setStatus('Bild-Fehler', true); }
            finally { aiImgBtn.disabled = false; }
        } }, icon('auto_awesome'), ' Generieren');
        aiImgInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') aiImgBtn.click(); });

        const handleFile = async (file) => {
            if (!file) return;
            setStatus('Lade Bild hoch …');
            try {
                const r = await uploadImage(file);
                rememberUpload(r.url, file.name);
                await insertImageLayer(r.url, file.name, false);
                drawPanel();
                setStatus('Bild eingefügt');
                toast('Bild hochgeladen & eingefügt', { type: 'ok' });
            } catch (e) { toast(e.message, { type: 'error' }); setStatus('Upload fehlgeschlagen', true); }
        };
        const dropZone = h('button', {
            type: 'button', class: 'dz-drop',
            onclick: async () => handleFile(await pickFile()),
            ondragover: (e) => { e.preventDefault(); dropZone.classList.add('over'); },
            ondragleave: () => dropZone.classList.remove('over'),
            ondrop: (e) => { e.preventDefault(); dropZone.classList.remove('over'); handleFile(e.dataTransfer?.files?.[0]); }
        }, icon('cloud_upload'), h('b', { text: 'Bild hochladen oder hierher ziehen' }), h('small', { text: 'PNG, JPG oder WebP' }));

        p.replaceChildren(
            h('div', { class: 'dz-phead' }, h('b', { text: 'Uploads & KI-Bilder' }), h('small', { text: 'Anklicken, um auf die Leinwand zu legen' })),
            h('div', { class: 'dz-pscroll' },
                dropZone,
                h('div', { class: 'dz-psec', text: 'Neues KI-Bild erzeugen' }),
                h('div', { class: 'dz-aimg-row' }, aiImgInp, aiImgBtn),
                renderImagesList(),
                h('div', { class: 'dz-psec', text: `Meine Medien (${uploads.length})` }),
                uploads.length
                    ? h('div', { class: 'dz-media-grid' }, uploads.map(u => h('div', { class: 'dz-media-tile' },
                        h('img', { src: u.url, alt: u.label, onclick: () => insertImageLayer(u.url, u.label, false) }),
                        h('div', { class: 'dz-media-acts' },
                            h('button', { type: 'button', title: 'Als Hintergrund', onclick: (e) => { e.stopPropagation(); insertImageLayer(u.url, u.label, true); } }, icon('wallpaper')),
                            h('button', { type: 'button', title: 'Aus Liste entfernen', onclick: (e) => { e.stopPropagation(); saveUploads(loadUploads().filter(x => x.url !== u.url)); drawPanel(); } }, icon('close'))))))
                    : h('p', { class: 'dz-empty-sub', text: 'Hochgeladene und erzeugte Bilder erscheinen hier zum schnellen Wiederverwenden.' })
            )
        );
        return;
    }

    if (st.tab === 'brand') {
        const b = { primary: '#18181b', secondary: '#2563eb', font: '', logo: '', ...brand() };
        const persist = () => {
            const s = Storage.getSettings();
            s.designBrand = { primary: b.primary, secondary: b.secondary, font: b.font, logo: b.logo };
            Storage.saveSettings(s);
        };
        const colorRow = (key, label) => {
            const pick = h('input', { type: 'color', value: b[key] || '#18181b', 'aria-label': label });
            const hex = h('input', { class: 'cd-input dz-hex', value: b[key] || '', maxlength: 7, placeholder: '#rrggbb' });
            const apply = h('button', { type: 'button', class: 'cd-btn sm', title: 'Auf Auswahl oder Hintergrund anwenden', onclick: async () => {
                if (!st.body) await ensureCanvas(b[key]);
                else if (st.sel?.id) sendStyle(st.sel.kind === 'text' ? { color: b[key] } : { backgroundColor: b[key] });
                else sendStyle({ backgroundColor: b[key] }, 'slide');
            } }, 'Anwenden');
            pick.addEventListener('input', () => { b[key] = pick.value; hex.value = pick.value; persist(); });
            hex.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { b[key] = hex.value; pick.value = hex.value; persist(); } else hex.value = b[key] || ''; });
            return h('div', { class: 'dz-field' }, h('span', { text: label }), h('div', { class: 'dz-color' }, pick, hex, apply));
        };
        const fontSel = h('select', { class: 'cd-input', onchange: () => { b.font = fontSel.value; persist(); } },
            h('option', { value: '' }, 'Coden entscheidet'),
            FONTS.map(f => h('option', { value: f, selected: b.font === f }, f)));
        const applyFont = h('button', { type: 'button', class: 'cd-btn sm', onclick: () => {
            if (!b.font) { toast('Wähle zuerst eine Marken-Schriftart.', { type: 'info' }); return; }
            if (st.sel?.id) sendStyle({ fontFamily: b.font });
            else toast('Markiere einen Text auf der Leinwand, um die Schrift anzuwenden.', { type: 'info' });
        } }, 'Auf Text anwenden');

        const logoBox = h('div', { class: 'dz-logo' },
            b.logo ? h('img', { src: b.logo, alt: 'Logo' }) : h('span', { class: 'dz-logo-empty', text: 'Kein Logo hinterlegt' }),
            h('button', { type: 'button', class: 'cd-btn sm', onclick: async () => {
                const f = await pickFile(); if (!f) return;
                try { b.logo = (await uploadImage(f, { maxSide: 600, png: true })).url; persist(); drawPanel(); toast('Logo gespeichert', { type: 'ok' }); }
                catch (err) { toast(err.message, { type: 'error' }); }
            } }, icon('upload'), b.logo ? ' Ändern' : ' Hochladen'),
            b.logo ? h('button', { type: 'button', class: 'cd-btn sm', onclick: () => {
                const f = curFormat();
                addElement(`<img data-cd-layer="image" data-brand-logo src="${b.logo}" alt="Logo" style="position:absolute;left:72px;top:72px;width:160px;height:auto;object-fit:contain;z-index:30">`);
            } }, icon('add_photo_alternate'), ' Einfügen') : null,
            b.logo ? h('button', { type: 'button', class: 'cd-x', title: 'Entfernen', onclick: () => { b.logo = ''; persist(); drawPanel(); } }, icon('delete')) : null);

        p.replaceChildren(
            h('div', { class: 'dz-phead' }, h('b', { text: 'Brand Kit' }), h('small', { text: 'Gilt für KI-Entwürfe & Ein-Klick-Styling' })),
            h('div', { class: 'dz-pscroll dz-brand-panel' },
                colorRow('primary', 'Primärfarbe'),
                colorRow('secondary', 'Sekundärfarbe'),
                h('div', { class: 'dz-field' }, h('span', { text: 'Marken-Schriftart' }), h('div', { class: 'dz-color' }, fontSel, applyFont)),
                h('div', { class: 'dz-field' }, h('span', { text: 'Logo' }), logoBox)
            )
        );
    }
}

// ---------- Untere Seiten-/Slide-Leiste ----------
function drawSlidesBar() {
    if (!ui) return;
    const strip = ui.slidesStrip;
    if (!st.body) {
        strip.replaceChildren(h('span', { class: 'dz-ctx-hint', text: 'Keine Seiten aktiv' }));
        return;
    }
    const n = Math.max(1, slideCount());
    st.n = n;
    const pills = [];
    for (let i = 0; i < n; i++) {
        const on = i === st.active;
        pills.push(h('div', { class: 'dz-spage' + (on ? ' on' : '') },
            h('button', { type: 'button', class: 'dz-spage-btn', onclick: () => { st.active = i; postFrame({ t: 'show', i }); drawSlidesBar(); } },
                h('span', { class: 'dz-spage-num', text: String(i + 1) }),
                h('span', { class: 'dz-spage-lbl', text: `Seite ${i + 1}` })),
            on ? h('div', { class: 'dz-spage-acts' },
                i > 0 ? h('button', { type: 'button', title: 'Nach links', onclick: (e) => { e.stopPropagation(); slideOp('left', i); } }, icon('chevron_left')) : null,
                i < n - 1 ? h('button', { type: 'button', title: 'Nach rechts', onclick: (e) => { e.stopPropagation(); slideOp('right', i); } }, icon('chevron_right')) : null,
                h('button', { type: 'button', title: 'Seite duplizieren', onclick: (e) => { e.stopPropagation(); slideOp('dup', i); } }, icon('content_copy')),
                n > 1 ? h('button', { type: 'button', title: 'Seite löschen', class: 'del', onclick: (e) => { e.stopPropagation(); slideOp('del', i); } }, icon('delete')) : null
            ) : null));
    }
    pills.push(h('button', {
        type: 'button', class: 'dz-add-page', title: 'Neue Seite hinzufügen',
        onclick: () => slideOp('add', st.active)
    }, icon('add'), h('span', { text: 'Seite' })));
    strip.replaceChildren(...pills);
}

function drawCode() {
    if (!ui) return;
    ui.code.value = st.busy && st.streamText ? st.streamText : (st.body ? fullDoc() : '');
    ui.code.readOnly = st.busy;
    ui.applyCode.disabled = st.busy || !st.body;
}

function setView(v) {
    if (!ui) return;
    st.view = v;
    ui.tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    ui.stage.classList.toggle('behind', v === 'code');
    ui.code.classList.toggle('hidden', v !== 'code');
    ui.codeBar.classList.toggle('hidden', v !== 'code');
    drawContextBar();
    if (v === 'code') drawCode(); else fit();
}

function reset(to = fresh()) { if (st.ac) st.ac.abort(); st = to; }
async function open(id) {
    if (st.id === id && st.body) return;
    reset();
    try {
        const { design: d } = await apiJson('/designs/' + id);
        const f = formatOf(d.format, d.width, d.height);
        st = {
            ...fresh(), id: d.id, title: d.title, titleTouched: true,
            format: d.format, width: f.w, height: f.h, slides: Math.max(2, d.slides || 5),
            head: d.head, body: d.body, messages: d.messages || [], n: d.slides || 1
        };
        if (st.body) {
            st.body = sanitizeDoc(`<html><head>${st.head}</head><body>${st.body}</body></html>`).body;
            pushHistory();
        }
    } catch (e) { toast(e.message, { type: 'error' }); Router.go('design'); }
}

// ---------- Host-Tastenkürzel ----------
function onHostKey(e) {
    if (!ui) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); applyHistory(e.shiftKey ? 1 : -1); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); applyHistory(1); }
    else if (mod && e.key === '0') { e.preventDefault(); setZoom(null); }
    else if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); setZoom((st.zoom ?? autoScale()) + 0.12); }
    else if (mod && e.key === '-') { e.preventDefault(); setZoom((st.zoom ?? autoScale()) - 0.12); }
    else if (mod && e.key.toLowerCase() === 'd' && st.sel?.id) { e.preventDefault(); postFrame({ t: 'cmd', cmd: 'dup' }); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel?.id) { e.preventDefault(); postFrame({ t: 'cmd', cmd: 'del' }); }
}

export const DesignView = {
    async mount(host, params = []) {
        const id = Number(params[0]) || null;
        if (id) await open(id);
        else if (st.id) history.replaceState(null, '', '#/design/' + st.id);

        // Header
        const title = h('input', {
            class: 'dz-title', value: st.title, maxlength: 80, 'aria-label': 'Titel des Designs',
            onchange: () => { st.title = title.value.trim() || 'Neues Design'; st.titleTouched = true; scheduleSave(300); }
        });
        const fmtBtn = h('button', { type: 'button', class: 'dz-fmt-pill', title: 'Format & Größe ändern', onclick: formatModal });
        const undoBtn = h('button', { type: 'button', class: 'cd-x', title: 'Rückgängig (Strg+Z)', 'aria-label': 'Rückgängig', onclick: () => applyHistory(-1) }, icon('undo'));
        const redoBtn = h('button', { type: 'button', class: 'cd-x', title: 'Wiederherstellen (Strg+Umschalt+Z)', 'aria-label': 'Wiederherstellen', onclick: () => applyHistory(1) }, icon('redo'));
        const tabs = h('div', { class: 'dz-tabs', role: 'tablist' },
            [['preview', 'Studio', 'brush'], ['code', 'Code', 'code']].map(([v, l, ic]) =>
                h('button', { type: 'button', role: 'tab', 'data-v': v, onclick: () => setView(v) }, icon(ic), ' ' + l)));
        const exportBtn = h('button', { type: 'button', class: 'cd-primary sm', onclick: exportModal }, icon('download'), ' Exportieren');
        const header = h('header', { class: 'dz-header' },
            h('button', { type: 'button', class: 'cd-x', title: 'Meine Designs', 'aria-label': 'Meine Designs', onclick: designsModal }, icon('folder_open')),
            title,
            fmtBtn,
            h('span', { class: 'dz-hsep' }),
            undoBtn, redoBtn,
            h('span', { class: 'grow' }),
            tabs,
            h('button', {
                type: 'button', class: 'cd-btn sm', title: 'Neues Design',
                onclick: () => { reset(); history.replaceState(null, '', '#/design'); Router.render(true); }
            }, icon('add'), ' Neu'),
            exportBtn
        );

        // Linke Canva-Rail + Panel
        const rail = h('nav', { class: 'dz-rail', 'aria-label': 'Design-Werkzeuge' });
        const panel = h('aside', { class: 'dz-panel' });
        const drawerToggle = h('button', {
            type: 'button', class: 'dz-drawer-toggle', title: 'Seitenleiste ein-/ausblenden', 'aria-label': 'Seitenleiste ein-/ausblenden',
            onclick: () => { st.drawerOpen = !st.drawerOpen; drawRail(); setTimeout(() => fit(), 220); }
        }, icon('chevron_left'));
        const drawerWrap = h('div', { class: 'dz-drawer-wrap' }, panel, drawerToggle);

        // Arbeitsbereich rechts (Kontext-Toolbar + Stage + Bottom-Leiste)
        const ctxBar = h('div', { class: 'dz-ctxbar' });
        const frame = h('iframe', { class: 'dz-frame', sandbox: 'allow-scripts', title: 'Design-Leinwand', referrerpolicy: 'no-referrer' });
        const canvas = h('div', { class: 'dz-canvas hidden' }, frame);
        const emptyTxt = h('b', { text: 'Starte dein Design' });
        const empty = h('div', { class: 'dz-empty' },
            icon('palette'),
            emptyTxt,
            h('p', { text: 'Wähle eine fertige Vorlage, starte mit einer leeren Leinwand oder lass Coden KI ein Design entwerfen.' }),
            h('div', { class: 'dz-start-acts' },
                h('button', { type: 'button', class: 'cd-primary', onclick: () => ensureCanvas('#FFFFFF') }, icon('add_box'), ' Leere Leinwand'),
                h('button', { type: 'button', class: 'cd-btn', onclick: () => { st.tab = 'templates'; st.drawerOpen = true; drawRail(); drawPanel(); } }, icon('dashboard'), ' Vorlage wählen'),
                h('button', { type: 'button', class: 'cd-btn', onclick: () => { st.tab = 'ai'; st.drawerOpen = true; drawRail(); drawPanel(); setTimeout(() => ui?.aiInput?.focus(), 40); } }, icon('auto_awesome'), ' Mit KI starten')
            ));
        const stage = h('div', {
            class: 'dz-stage',
            onclick: (e) => { if (e.target === stage) postFrame({ t: 'cmd', cmd: 'deselect' }); },
            onwheel: (e) => {
                if (!e.ctrlKey && !e.metaKey) return;
                e.preventDefault();
                const cur = st.zoom ?? autoScale();
                setZoom(cur * (e.deltaY < 0 ? 1.1 : 0.91));
            }
        }, canvas, empty);

        const code = h('textarea', { class: 'dz-code hidden', spellcheck: 'false', 'aria-label': 'HTML-Code des Designs' });
        const applyCode = h('button', { type: 'button', class: 'cd-btn sm', onclick: () => {
            const html = extractHtml(code.value) || code.value;
            const out = sanitizeDoc(html, promptMap(st.body));
            st.head = out.head; st.body = out.body; st.n = slideCount(); st.sel = null;
            pushHistory(); setView('preview'); render(); scheduleSave(200); runImages();
            toast('Code übernommen', { type: 'ok' });
        } }, icon('check'), ' Übernehmen');
        const copyCode = h('button', { type: 'button', class: 'cd-btn sm', onclick: async () => { try { await navigator.clipboard.writeText(fullDoc()); toast('Code kopiert', { type: 'ok' }); } catch (_) {} } }, icon('content_copy'), ' Kopieren');
        const codeBar = h('div', { class: 'dz-codebar hidden' }, copyCode, applyCode);

        const slidesStrip = h('div', { class: 'dz-slides-strip' });
        const status = h('span', { class: 'dz-status', 'aria-live': 'polite' });
        const zoomRange = h('input', {
            type: 'range', min: 20, max: 180, value: 65, class: 'dz-zoom-range', 'aria-label': 'Zoom',
            oninput: () => setZoom(Number(zoomRange.value) / 100)
        });
        const zoomLbl = h('button', { type: 'button', class: 'dz-zoom-lbl', title: 'Einpassen (Strg+0)', text: 'Fit', onclick: () => setZoom(null) });
        const bottom = h('footer', { class: 'dz-bottom' },
            slidesStrip,
            h('span', { class: 'grow' }),
            status,
            h('div', { class: 'dz-zoom' },
                h('button', { type: 'button', class: 'dz-zbtn', title: 'Verkleinern', onclick: () => setZoom((st.zoom ?? autoScale()) - 0.12) }, icon('remove')),
                zoomRange,
                h('button', { type: 'button', class: 'dz-zbtn', title: 'Vergrößern', onclick: () => setZoom((st.zoom ?? autoScale()) + 0.12) }, icon('add')),
                zoomLbl));

        const work = h('div', { class: 'dz-work' }, stage, code, codeBar);
        const main = h('section', { class: 'dz-main' }, ctxBar, work, bottom);
        const body = h('div', { class: 'dz-body' }, rail, drawerWrap, main);
        const page = h('div', { class: 'dz-page' }, header, body);
        host.append(page);

        ui = {
            host, page, body, title, fmtBtn, undoBtn, redoBtn, tabs, exportBtn,
            rail, panel, ctxBar, frame, canvas, empty, emptyTxt, stage, code, codeBar, applyCode,
            slidesStrip, status, zoomRange, zoomLbl
        };
        this._onMsg = onFrameMessage; window.addEventListener('message', this._onMsg);
        this._onKey = onHostKey; window.addEventListener('keydown', this._onKey);
        this._ro = new ResizeObserver(() => fit()); this._ro.observe(stage);

        drawRail(); drawPanel(); drawHeader(); drawSlidesBar();
        setView(st.view === 'code' ? 'code' : 'preview');
        await render();
        if (!st.busy && imagesOf().some(i => i.state === 'pending')) runImages();
        setStatus(st.id ? 'Gespeichert' : 'Bereit');
    },
    unmount() {
        if (this._onMsg) window.removeEventListener('message', this._onMsg);
        if (this._onKey) window.removeEventListener('keydown', this._onKey);
        this._ro?.disconnect();
        if (st.body) save().catch(() => {});
        ui = null;
    }
};
