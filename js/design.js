// js/design.js – „Design“: Social-Media-Designs per Prompt. Links Chat & Einstellungen, rechts Live-Vorschau/Code.
// Pipeline: 1) Coding-KI schreibt HTML/CSS in Pixelmaßen, 2) Bild-KI füllt <img data-ai-image-prompt>.
// Editor: Texte direkt anklicken und ändern, Bilder neu erzeugen oder hochladen, Brand Kit, PNG/ZIP-Export.
// Designs werden automatisch gespeichert (/api/designs) und erscheinen im Artefakte-Bereich.
import { apiJson } from './backend.js';
import { streamAiResponse } from './api.js';
import { toast } from './toast.js';
import { Router } from './router.js';
import { Storage } from './storage.js';
import { h, icon, timeAgo } from './apps/dom.js';
import { modal, confirmBox, promptBox } from './apps/dialogs.js';
import { buildZipBytes } from './doc-export.js';
import { FORMATS, FONTS, formatOf, designSystemPrompt, extractHtml, splitDoc, safeFontLink, cleanImagePrompt, exportName, frameDoc, EMPTY_IMG, safeFontName } from './design-core.js';

const TIER_NAME = { flash: 'Coden Flash', normal: 'Coden Thinking', pro: 'Coden Pro', ultra: 'Coden Ultra' };
const IDEAS = [
    ['local_cafe', 'Eröffnungs-Angebot für ein gemütliches Café, 20 % Rabatt diese Woche'],
    ['format_quote', 'Motivations-Zitat für Montag, ruhige Natur-Stimmung'],
    ['view_carousel', '5 Lerntipps für die Prüfungszeit als Karussell'],
    ['sell', 'Black-Friday-Sale für einen Sneaker-Shop, modern und laut']
];
const tierNow = () => document.querySelector('.model-option.active')?.getAttribute('data-model') || 'flash';

// ---------- Zustand ----------
const fresh = () => ({ id: null, title: 'Neues Design', titleTouched: false, format: 'square', slides: 5, head: '', body: '', messages: [], busy: false, active: 0, n: 1, view: 'preview', selImg: null, gen: 0, ac: null, streamText: '' });
let st = fresh();
let ui = null; // DOM-Teile der gerade angezeigten Seite
let libText = null;
const exportsWaiting = new Map(); let reqN = 0;
let saveT = null, saving = null;

const brand = () => { const b = Storage.getSettings().designBrand; return b && typeof b === 'object' ? b : {}; };
const loadLib = async () => {
    if (libText != null) return libText;
    try { libText = await (await fetch('js/vendor/html-to-image.min.js')).text(); } catch (_) { libText = ''; }
    return libText;
};

// ---------- HTML säubern (die KI-Ausgabe ist Material, kein vertrauenswürdiger Code) ----------
function sanitizeDoc(html, prev = new Map()) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,form,base,meta,noscript,frame,frameset,applet,portal').forEach(n => n.remove());
    doc.querySelectorAll('link').forEach(l => {
        const rel = String(l.getAttribute('rel') || '').toLowerCase(); const href = l.getAttribute('href') || '';
        const ok = (rel === 'stylesheet' && safeFontLink(href)) || (rel === 'preconnect' && /^https:\/\/fonts\.(googleapis|gstatic)\.com\/?$/.test(href));
        if (!ok) l.remove();
    });
    doc.querySelectorAll('style').forEach(s => { s.textContent = s.textContent.replace(/@import[^;]*;/gi, m => (/fonts\.googleapis\.com/.test(m) ? m : '')); });
    doc.querySelectorAll('*').forEach(el => {
        for (const a of [...el.attributes]) {
            const n = a.name.toLowerCase();
            if (n.startsWith('on') || n === 'contenteditable' || n === 'data-cd-text' || n === 'spellcheck') el.removeAttribute(a.name);
            else if (/^(src|href|xlink:href|action|formaction|poster|srcset)$/.test(n) && /^\s*(javascript|vbscript|data:(?!image\/))/i.test(a.value)) el.removeAttribute(a.name);
        }
    });
    // Slides: ohne <section data-slide> wird der ganze Inhalt eine Slide
    if (!doc.body.querySelector('[data-slide]')) {
        const sec = doc.createElement('section'); sec.setAttribute('data-slide', ''); sec.className = 'relative overflow-hidden';
        while (doc.body.firstChild) sec.appendChild(doc.body.firstChild);
        doc.body.appendChild(sec);
    }
    prepareImages(doc.body, prev);
    return { head: doc.head.innerHTML.trim(), body: doc.body.innerHTML.trim() };
}
// Jedes Bild bekommt eine ID; KI-Bilder ohne Adresse warten auf die Bild-KI (gleiche Beschreibung wie vorher = altes Bild behalten)
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
// Zum Speichern/für die KI: Platzhalter-Bilder ohne data:-Adresse
function bodyForSave(body = st.body) {
    const t = tpl(body);
    t.content.querySelectorAll('img').forEach(img => { if (/^data:/i.test(img.getAttribute('src') || '')) img.removeAttribute('src'); });
    return t.innerHTML.trim();
}
const slideCount = (body = st.body) => Math.max(1, tpl(body).content.querySelectorAll('[data-slide]').length);
const fullDoc = () => `<!DOCTYPE html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n${st.head}\n</head>\n<body>\n${bodyForSave()}\n</body>\n</html>`;

// ---------- Speichern (automatisch) ----------
function scheduleSave(ms = 1200) { clearTimeout(saveT); saveT = setTimeout(() => save().catch(() => {}), ms); }
async function save() {
    if (!st.body) return;
    if (saving) { await saving.catch(() => {}); }
    const payload = { title: st.title, format: st.format, slides: slideCount(), head: st.head, body: bodyForSave(), messages: st.messages.slice(-30) };
    saving = (async () => {
        try {
            if (!st.id) {
                const { design } = await apiJson('/designs', { method: 'POST', body: JSON.stringify(payload) });
                st.id = design.id;
                if (Router.parse().name === 'design') history.replaceState(null, '', '#/design/' + st.id);
            } else await apiJson('/designs/' + st.id, { method: 'PATCH', body: JSON.stringify(payload) });
            setStatus('Gespeichert · auch unter Artefakte');
        } catch (e) { setStatus('Nicht gespeichert: ' + e.message, true); }
    })();
    return saving;
}

// ---------- Vorschau ----------
const postFrame = (m) => { try { ui?.frame?.contentWindow?.postMessage({ codenDesign: 1, ...m }, '*'); } catch (_) {} };
async function render() {
    if (!ui) return;
    const has = !!st.body;
    ui.empty.classList.toggle('hidden', has);
    ui.empty.classList.toggle('busy', !has && st.busy);
    ui.emptyTxt.textContent = st.busy ? 'Coden entwirft dein Design …' : 'Hier erscheint dein Design';
    ui.canvas.classList.toggle('hidden', !has);
    if (!has) { drawNav(); return; }
    const lib = await loadLib();
    ui.frame.srcdoc = frameDoc({ head: st.head, body: st.body, format: st.format, lib, mode: 'edit', active: st.active });
    fit(); drawCode(); drawImages();
}
function fit() {
    if (!ui) return;
    const f = formatOf(st.format);
    const box = ui.stage.getBoundingClientRect();
    const scale = Math.max(0.1, Math.min((box.width - 40) / f.w, (box.height - 40) / f.h, 1));
    ui.canvas.style.width = Math.round(f.w * scale) + 'px'; ui.canvas.style.height = Math.round(f.h * scale) + 'px';
    ui.frame.style.width = f.w + 'px'; ui.frame.style.height = f.h + 'px';
    ui.frame.style.transform = `scale(${scale})`;
}
function onFrameMessage(e) {
    if (!ui || e.source !== ui.frame.contentWindow || !e.data?.codenDesign) return;
    const m = e.data;
    if (m.t === 'ready' || m.t === 'slide') { st.n = m.n || 1; if (m.t === 'slide') st.active = m.i; drawNav(); }
    else if (m.t === 'body') {
        // Texte im Design geändert (nur Text – Struktur bleibt): sicher übernehmen
        const prev = promptMap(st.body);
        st.body = sanitizeDoc(`<html><head></head><body>${m.body}</body></html>`, prev).body;
        scheduleSave(); if (st.view === 'code') drawCode();
    } else if (m.t === 'img-select') { st.selImg = m.id; drawImages(); }
    else if (m.t === 'png') { const w = exportsWaiting.get(m.req); if (w) { exportsWaiting.delete(m.req); m.error ? w.rej(new Error(m.error)) : w.res(m.data); } }
}

// ---------- Bilder ----------
function setImg(id, { src, state = '', prompt } = {}) {
    const t = tpl(st.body); const img = t.content.querySelector(`img[data-ai-id="${CSS.escape(id)}"]`); if (!img) return;
    if (src) img.setAttribute('src', src);
    if (state) img.setAttribute('data-ai-state', state); else img.removeAttribute('data-ai-state');
    if (prompt != null) img.setAttribute('data-ai-image-prompt', prompt);
    st.body = t.innerHTML.trim();
    postFrame({ t: 'set-img', id, src, state, prompt });
    drawImages(); if (!state) scheduleSave();
}
async function genImage(id, prompt, gen = st.gen) {
    setImg(id, { src: EMPTY_IMG, state: 'pending', prompt });
    try {
        const r = await apiJson('/designs/image', { method: 'POST', body: JSON.stringify({ prompt }) });
        if (gen !== st.gen) return; // inzwischen ein neues Design
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
    if (gen === st.gen) { setStatus('Fertig · Texte im Bild anklicken zum Ändern'); scheduleSave(300); }
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
    const aiMsg = addMsg('ai', editing ? 'Coden passt das Layout an …' : 'Coden entwirft das Layout …');
    st.busy = true; st.gen++; const gen = st.gen; st.ac = new AbortController(); st.streamText = '';
    drawBusy(); if (!editing) render();
    const f = formatOf(st.format);
    const sys = designSystemPrompt({ format: st.format, slides: st.slides, brand: brand(), editing });
    const user = editing ? `Aktuelles Design:\n\`\`\`html\n${fullDoc()}\n\`\`\`\n\nÄnderungswunsch: ${prompt}` : `Auftrag: ${prompt}`;
    const tier = tierNow();
    try {
        const text = await streamAiResponse([{ role: 'system', content: sys }, { role: 'user', content: user }], tier, {
            signal: st.ac.signal, maxTokens: f.multi ? 16000 : 9000,
            onDelta: (t) => { st.streamText = t; updateMsg(aiMsg, `${editing ? 'Coden passt das Layout an' : 'Coden entwirft das Layout'} … ${(t.length / 1000).toFixed(1)}k Zeichen`); if (st.view === 'code') drawCode(); }
        });
        if (gen !== st.gen) return;
        const html = extractHtml(text);
        if (!html) { updateMsg(aiMsg, '⚠️ Die KI hat kein Design geliefert. Formuliere den Wunsch etwas genauer und versuch es noch einmal.'); return; }
        const prev = promptMap(st.body);
        const out = sanitizeDoc(html, prev);
        st.head = out.head; st.body = out.body; st.active = editing ? st.active : 0;
        const imgs = imagesOf(); const fresh = imgs.filter(i => i.state === 'pending').length;
        const slides = (st.body.match(/data-slide/g) || []).length;
        updateMsg(aiMsg, `${editing ? 'Angepasst' : 'Layout fertig'}: ${slides} Slide${slides === 1 ? '' : 's'}${fresh ? `, ${fresh} Bild${fresh === 1 ? '' : 'er'} werden gemalt` : ''}. Texte kannst du direkt im Design anklicken und ändern.`);
        await render(); scheduleSave(200);
        await runImages();
    } catch (e) {
        if (gen !== st.gen) return;
        updateMsg(aiMsg, st.ac?.signal.aborted ? 'Abgebrochen.' : `⚠️ ${e.code === 'limit' ? e.message : 'Fehler: ' + e.message}`);
    } finally {
        if (gen === st.gen) { st.busy = false; st.ac = null; st.streamText = ''; drawBusy(); render(); }
    }
}

// ---------- Export ----------
function exportSlide(i) {
    return new Promise((res, rej) => {
        const req = ++reqN; exportsWaiting.set(req, { res, rej });
        postFrame({ t: 'export', i, req, ratio: 1 });
        setTimeout(() => { if (exportsWaiting.has(req)) { exportsWaiting.delete(req); rej(new Error('Der Export hat zu lange gedauert.')); } }, 90_000);
    });
}
const bytesOf = (dataUrl) => { const b = atob(String(dataUrl).split(',')[1] || ''); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const download = (blob, name) => { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
async function exportPng(all = true) {
    if (!st.body) return;
    if (imagesOf().some(i => i.state === 'pending')) { toast('Warte kurz, die Bild-KI malt noch.', { type: 'info' }); return; }
    const n = st.n || 1;
    setStatus(n > 1 && all ? `Exportiere ${n} Slides …` : 'Exportiere PNG …');
    try {
        if (n === 1 || !all) {
            const i = n === 1 ? 0 : st.active; const data = await exportSlide(i);
            download(new Blob([bytesOf(data)], { type: 'image/png' }), exportName(st.title, i + 1, n === 1 ? 1 : n));
        } else {
            const files = [];
            for (let i = 0; i < n; i++) { setStatus(`Exportiere Slide ${i + 1} von ${n} …`); files.push({ name: exportName(st.title, i + 1, n), data: bytesOf(await exportSlide(i)) }); }
            download(new Blob([buildZipBytes(files)], { type: 'application/zip' }), exportName(st.title, 1, 1).replace(/\.png$/, '.zip'));
        }
        setStatus('Export fertig');
    } catch (e) { setStatus('Export fehlgeschlagen: ' + e.message, true); toast('Export fehlgeschlagen: ' + e.message, { type: 'error' }); }
}

// ---------- Brand Kit ----------
function brandModal() {
    const b = { primary: '#6d5dfc', secondary: '#111827', font: '', logo: '', ...brand() };
    const color = (key, label) => {
        const pick = h('input', { type: 'color', value: b[key] || '#000000', 'aria-label': label });
        const hex = h('input', { class: 'cd-input dz-hex', value: b[key] || '', maxlength: 7, placeholder: '#rrggbb' });
        pick.addEventListener('input', () => { b[key] = pick.value; hex.value = pick.value; });
        hex.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { b[key] = hex.value; pick.value = hex.value; } else hex.value = b[key] || ''; });
        return h('label', { class: 'dz-field' }, h('span', { text: label }), h('div', { class: 'dz-color' }, pick, hex));
    };
    const fontSel = h('select', { class: 'cd-input' }, h('option', { value: '' }, 'Coden entscheidet'), FONTS.map(f => h('option', { value: f }, f)), h('option', { value: '__own' }, 'Eigene Google-Schrift …'));
    const ownFont = h('input', { class: 'cd-input hidden', placeholder: 'Name der Google-Schrift, z. B. Syne', maxlength: 40 });
    if (b.font && !FONTS.includes(b.font)) { fontSel.value = '__own'; ownFont.value = b.font; ownFont.classList.remove('hidden'); } else fontSel.value = b.font || '';
    fontSel.addEventListener('change', () => ownFont.classList.toggle('hidden', fontSel.value !== '__own'));
    const logoBox = h('div', { class: 'dz-logo' });
    const drawLogo = () => logoBox.replaceChildren(
        b.logo ? h('img', { src: b.logo, alt: 'Logo' }) : h('span', { class: 'dz-logo-empty', text: 'Kein Logo' }),
        h('button', { type: 'button', class: 'cd-btn sm', onclick: async (e) => {
            const f = await pickFile(); if (!f) return; const btn = e.currentTarget; btn.disabled = true;
            try { b.logo = (await uploadImage(f, { maxSide: 600, png: true })).url; drawLogo(); } catch (err) { toast(err.message, { type: 'error' }); } finally { btn.disabled = false; }
        } }, icon('upload'), b.logo ? ' Ändern' : ' Logo hochladen'),
        b.logo ? h('button', { type: 'button', class: 'cd-btn sm', onclick: () => { b.logo = ''; drawLogo(); } }, 'Entfernen') : null);
    drawLogo();
    const saveBtn = h('button', { type: 'button', class: 'cd-primary', onclick: () => {
        const font = fontSel.value === '__own' ? safeFontName(ownFont.value) : fontSel.value;
        const s = Storage.getSettings(); s.designBrand = { primary: b.primary, secondary: b.secondary, font, logo: b.logo }; Storage.saveSettings(s);
        m.close(); drawBrand(); toast('Brand Kit gespeichert – gilt für alle neuen Designs', { type: 'ok' });
    } }, 'Speichern');
    const m = modal('Brand Kit', h('div', { class: 'dz-brand-form' },
        h('p', { class: 'cd-text', text: 'Deine Farben, Schrift und dein Logo. Coden Design benutzt sie automatisch in jedem Design.' }),
        h('div', { class: 'dz-two' }, color('primary', 'Primärfarbe'), color('secondary', 'Sekundärfarbe')),
        h('label', { class: 'dz-field' }, h('span', { text: 'Schriftart' }), fontSel, ownFont),
        h('div', { class: 'dz-field' }, h('span', { text: 'Logo' }), logoBox),
        h('div', { class: 'cd-row end' }, saveBtn)));
}

// ---------- Meine Designs ----------
async function designsModal() {
    const box = h('div', { class: 'dz-list' }, h('p', { class: 'cd-text', text: 'Lade …' }));
    const m = modal('Meine Designs', box, { wide: true });
    let list = [];
    try { list = (await apiJson('/designs')).designs || []; } catch (e) { box.replaceChildren(h('p', { class: 'cd-err', text: e.message })); return; }
    if (!list.length) { box.replaceChildren(h('p', { class: 'cd-text', text: 'Noch keine Designs. Beschreib links, was du brauchst.' })); return; }
    box.replaceChildren(h('div', { class: 'dz-grid' }, list.map(d => designCard(d, { onOpen: () => m.close(), onDeleted: () => designsModal().then(() => m.close()) }))));
}

/** Karte mit Vorschaubild (für „Meine Designs“ und den Artefakte-Bereich). */
export function designCard(d, { onOpen, onDeleted } = {}) {
    const f = formatOf(d.format);
    const thumb = h('div', { class: 'dz-thumb', style: { aspectRatio: `${f.w} / ${f.h}` } });
    const del = onDeleted ? h('button', { type: 'button', class: 'dz-del', title: 'Löschen', 'aria-label': 'Design löschen', onclick: async (e) => {
        e.stopPropagation();
        if (!await confirmBox(`„${d.title}“ löschen?`, { ok: 'Löschen', danger: true })) return;
        try { await apiJson('/designs/' + d.id, { method: 'DELETE' }); if (st.id === d.id) st = fresh(); onDeleted(); } catch (err) { toast(err.message, { type: 'error' }); }
    } }, icon('delete')) : null;
    const card = h('a', { class: 'dz-card', href: '#/design/' + d.id, onclick: () => onOpen?.() },
        thumb, h('b', { text: d.title }), h('small', { text: `${f.label}${d.slides > 1 ? ` · ${d.slides} Slides` : ''} · ${timeAgo(d.updatedAt)}` }), del);
    // Vorschau erst laden, wenn die Karte sichtbar ist
    const io = new IntersectionObserver(async (entries) => {
        if (!entries.some(e => e.isIntersecting)) return; io.disconnect();
        try {
            const { design } = await apiJson('/designs/' + d.id);
            const fr = h('iframe', { sandbox: 'allow-scripts', tabindex: '-1', 'aria-hidden': 'true', loading: 'lazy', referrerpolicy: 'no-referrer' });
            fr.style.width = f.w + 'px'; fr.style.height = f.h + 'px';
            fr.srcdoc = frameDoc({ head: design.head, body: design.body, format: design.format, mode: 'view' });
            thumb.append(fr);
            const sc = () => { fr.style.transform = `scale(${thumb.clientWidth / f.w})`; };
            sc(); new ResizeObserver(sc).observe(thumb);
        } catch (_) { thumb.append(icon('palette')); }
    }, { rootMargin: '200px' });
    io.observe(thumb);
    return card;
}
export const listDesigns = async () => (await apiJson('/designs')).designs || [];

// ---------- Oberfläche ----------
function setStatus(text, bad = false) { if (ui) { ui.status.textContent = text; ui.status.classList.toggle('bad', bad); } }
function addMsg(role, text) { const m = { role, text }; st.messages.push(m); drawMsgs(); return m; }
function updateMsg(m, text) { m.text = text; drawMsgs(); }
function drawMsgs() {
    if (!ui) return;
    if (!st.messages.length) {
        ui.msgs.replaceChildren(h('div', { class: 'dz-hello' }, h('b', { text: 'Was soll Coden gestalten?' }), h('p', { text: 'Beschreib Anlass, Inhalt und Stimmung. Coden baut das Layout in HTML (gestochen scharfe Schrift) und lässt die Bild-KI passende Bilder malen.' }),
            h('div', { class: 'dz-ideas' }, IDEAS.map(([ic, t]) => h('button', { type: 'button', class: 'dz-idea', onclick: () => { if (/Karussell/.test(t)) setFormat('carousel', true); ui.input.value = t; ui.input.focus(); } }, icon(ic), h('span', { text: t }))))));
        return;
    }
    ui.msgs.replaceChildren(...st.messages.map(m => h('div', { class: 'dz-msg ' + m.role }, h('span', { text: m.text }))));
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
}
function drawBusy() {
    if (!ui) return;
    ui.send.classList.toggle('hidden', st.busy); ui.stop.classList.toggle('hidden', !st.busy);
    ui.input.placeholder = st.body ? 'Was soll Coden ändern? z. B. „Headline größer, Hintergrund dunkler“' : 'Beschreib dein Design …';
    if (st.busy) setStatus('Coden arbeitet …');
}
function drawFormats() {
    if (!ui) return;
    ui.formats.replaceChildren(...Object.values(FORMATS).map(f => h('button', { type: 'button', class: 'dz-fmt' + (st.format === f.id ? ' on' : ''), 'aria-pressed': String(st.format === f.id), onclick: () => setFormat(f.id) },
        icon(f.icon), h('b', { text: f.label }), h('small', { text: f.hint }))));
    ui.slidesRow.classList.toggle('hidden', st.format !== 'carousel');
    ui.slidesVal.textContent = String(st.slides);
}
async function setFormat(id, quiet = false) {
    if (id === st.format || st.busy) return;
    if (st.body && !quiet) {
        if (!await confirmBox(`Auf „${FORMATS[id].label}“ umstellen? Coden passt das Design an das neue Format an.`, { ok: 'Umstellen', title: 'Format ändern' })) return;
        st.format = id; drawFormats(); fit();
        generate(`Passe das Design an das neue Format ${FORMATS[id].label} (${FORMATS[id].w} × ${FORMATS[id].h} px${FORMATS[id].multi ? `, ${st.slides} Slides` : ''}) an. Inhalt und Stil bleiben.`);
        return;
    }
    st.format = id; drawFormats(); if (st.body) render();
}
function drawBrand() {
    if (!ui) return; const b = brand();
    ui.brand.replaceChildren(icon('palette'), h('span', { class: 'dz-sw', style: { background: b.primary || 'transparent' } }), h('span', { class: 'dz-sw', style: { background: b.secondary || 'transparent' } }),
        h('span', { class: 'grow', text: b.font || b.primary || b.logo ? `Brand Kit${b.font ? ' · ' + b.font : ''}${b.logo ? ' · Logo' : ''}` : 'Brand Kit einrichten' }), icon('chevron_right'));
}
function drawNav() {
    if (!ui) return;
    const n = st.n || 1; const show = !!st.body && n > 1;
    ui.nav.classList.toggle('hidden', !show);
    ui.navTxt.textContent = `${st.active + 1} / ${n}`;
    ui.exportOne.classList.toggle('hidden', !show);
    ui.exportAll.lastChild.textContent = show ? ' Alle als ZIP' : ' Als PNG herunterladen';
    [ui.exportAll, ui.exportOne].forEach(b => { b.disabled = !st.body || st.busy; });
}
function drawCode() {
    if (!ui) return;
    ui.code.value = st.busy && st.streamText ? st.streamText : (st.body ? fullDoc() : '');
    ui.code.readOnly = st.busy;
    ui.applyCode.disabled = st.busy || !st.body;
}
function drawImages() {
    if (!ui) return;
    const list = imagesOf();
    ui.imgHead.textContent = `Bilder im Design (${list.length})`;
    ui.imgBox.classList.toggle('hidden', !list.length);
    ui.imgs.replaceChildren(...list.map((im, k) => {
        const thumb = im.state === 'pending' ? h('span', { class: 'dz-ithumb pending' }) : im.state === 'error' ? h('span', { class: 'dz-ithumb err' }, icon('error')) : h('img', { class: 'dz-ithumb', src: im.src, alt: '' });
        const regen = h('button', { type: 'button', class: 'cd-x', title: 'Neu generieren', 'aria-label': 'Bild neu generieren', disabled: im.state === 'pending' || !im.prompt || st.busy, onclick: (e) => { e.stopPropagation(); genImage(im.id, im.prompt); } }, icon('refresh'));
        const edit = h('button', { type: 'button', class: 'cd-x', title: 'Beschreibung ändern und neu generieren', 'aria-label': 'Bildbeschreibung ändern', disabled: im.state === 'pending' || st.busy, onclick: async (e) => {
            e.stopPropagation();
            const p = await promptBox('Bild neu beschreiben', { label: 'Beschreibung (am besten Englisch, ohne Text im Bild)', value: im.prompt, ok: 'Neu generieren' });
            if (p && p.trim()) genImage(im.id, cleanImagePrompt(p));
        } }, icon('edit'));
        const upl = h('button', { type: 'button', class: 'cd-x', title: 'Eigenes Bild hochladen', 'aria-label': 'Eigenes Bild hochladen', disabled: im.state === 'pending' || st.busy, onclick: async (e) => {
            e.stopPropagation(); const f = await pickFile(); if (!f) return;
            setImg(im.id, { src: im.src, state: 'pending' });
            try { const r = await uploadImage(f); setImg(im.id, { src: r.url }); } catch (err) { setImg(im.id, { src: im.src, state: im.state }); toast(err.message, { type: 'error' }); }
        } }, icon('upload'));
        return h('div', { class: 'dz-irow' + (st.selImg === im.id ? ' sel' : ''), role: 'button', tabindex: '0', onclick: () => { st.selImg = im.id; postFrame({ t: 'select-img', id: im.id }); drawImages(); } },
            thumb, h('span', { class: 'dz-itext' }, h('b', { text: `Bild ${k + 1}${(st.n || 1) > 1 ? ` · Slide ${im.slide + 1}` : ''}` }), h('small', { text: im.prompt || im.alt || 'eigenes Bild' })), regen, edit, upl);
    }));
}

function reset(to = fresh()) { if (st.ac) st.ac.abort(); st = to; }
async function open(id) {
    if (st.id === id && st.body) return; // schon offen (z. B. zurück aus einem anderen Tab)
    reset();
    try {
        const { design: d } = await apiJson('/designs/' + id);
        st = { ...fresh(), id: d.id, title: d.title, titleTouched: true, format: d.format, slides: Math.max(2, d.slides || 5), head: d.head, body: d.body, messages: d.messages || [], n: d.slides || 1 };
        if (st.body) st.body = sanitizeDoc(`<html><head>${st.head}</head><body>${st.body}</body></html>`).body;
    } catch (e) { toast(e.message, { type: 'error' }); Router.go('design'); }
}

export const DesignView = {
    async mount(host, params = []) {
        const id = Number(params[0]) || null;
        if (id) await open(id);
        else if (st.id) history.replaceState(null, '', '#/design/' + st.id); // #/design zeigt das zuletzt offene Design weiter („+“ = neues Design)
        const input = h('textarea', { class: 'dz-input', rows: 3, maxlength: 2000 });
        const send = h('button', { type: 'button', class: 'dz-send', title: 'Erstellen', 'aria-label': 'Design erstellen', onclick: () => { const v = input.value; input.value = ''; generate(v); } }, icon('arrow_upward'));
        const stop = h('button', { type: 'button', class: 'dz-send stop hidden', title: 'Stopp', 'aria-label': 'Stopp', onclick: () => st.ac?.abort() }, icon('stop'));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click(); } });
        const title = h('input', { class: 'dz-title', value: st.title, maxlength: 80, 'aria-label': 'Titel des Designs', onchange: () => { st.title = title.value.trim() || 'Neues Design'; st.titleTouched = true; scheduleSave(300); } });
        const formats = h('div', { class: 'dz-fmts' });
        const slidesVal = h('b', { text: String(st.slides) });
        const step = (d) => { st.slides = Math.max(2, Math.min(10, st.slides + d)); slidesVal.textContent = String(st.slides); };
        const slidesRow = h('div', { class: 'dz-slides' }, h('span', { text: 'Slides' }), h('button', { type: 'button', class: 'cd-x', 'aria-label': 'Weniger Slides', onclick: () => step(-1) }, icon('remove')), slidesVal, h('button', { type: 'button', class: 'cd-x', 'aria-label': 'Mehr Slides', onclick: () => step(1) }, icon('add')));
        const brandBtn = h('button', { type: 'button', class: 'dz-brand', onclick: brandModal });
        const msgs = h('div', { class: 'dz-msgs', 'aria-live': 'polite' });
        const imgHead = h('summary', {});
        const imgs = h('div', { class: 'dz-imgs' });
        const imgBox = h('details', { class: 'dz-imgbox hidden', open: true }, imgHead, imgs);
        const tierLbl = h('small', { class: 'dz-tier', text: `${TIER_NAME[tierNow()] || 'Coden'} für das Layout · Bild-KI für die Bilder` });

        const frame = h('iframe', { class: 'dz-frame', sandbox: 'allow-scripts', title: 'Design-Vorschau', referrerpolicy: 'no-referrer' });
        const canvas = h('div', { class: 'dz-canvas hidden' }, frame);
        const emptyTxt = h('b', { text: 'Hier erscheint dein Design' });
        const empty = h('div', { class: 'dz-empty' }, icon('palette'), emptyTxt, h('p', { text: 'Wähle links ein Format und beschreib, was du brauchst.' }));
        const stage = h('div', { class: 'dz-stage' }, canvas, empty);
        const code = h('textarea', { class: 'dz-code hidden', spellcheck: 'false', 'aria-label': 'HTML-Code des Designs' });
        const applyCode = h('button', { type: 'button', class: 'cd-btn sm', onclick: () => {
            const html = extractHtml(code.value) || code.value; const out = sanitizeDoc(html, promptMap(st.body));
            st.head = out.head; st.body = out.body; setView('preview'); render(); scheduleSave(200); runImages(); toast('Code übernommen', { type: 'ok' });
        } }, icon('check'), ' Übernehmen');
        const copyCode = h('button', { type: 'button', class: 'cd-btn sm', onclick: async () => { try { await navigator.clipboard.writeText(fullDoc()); toast('Code kopiert', { type: 'ok' }); } catch (_) {} } }, icon('content_copy'), ' Kopieren');
        const codeBar = h('div', { class: 'dz-codebar hidden' }, copyCode, applyCode);
        const tabs = h('div', { class: 'dz-tabs', role: 'tablist' });
        const setView = (v) => {
            st.view = v; tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
            stage.classList.toggle('behind', v === 'code'); code.classList.toggle('hidden', v !== 'code'); codeBar.classList.toggle('hidden', v !== 'code');
            if (v === 'code') drawCode(); else fit();
        };
        tabs.append(...[['preview', 'Vorschau', 'visibility'], ['code', 'Code', 'code']].map(([v, l, ic]) => h('button', { type: 'button', role: 'tab', 'data-v': v, onclick: () => setView(v) }, icon(ic), ' ' + l)));
        const navTxt = h('span', { class: 'dz-navtxt' });
        const nav = h('div', { class: 'dz-nav hidden' },
            h('button', { type: 'button', class: 'cd-x', 'aria-label': 'Vorige Slide', onclick: () => postFrame({ t: 'show', i: st.active - 1 }) }, icon('chevron_left')), navTxt,
            h('button', { type: 'button', class: 'cd-x', 'aria-label': 'Nächste Slide', onclick: () => postFrame({ t: 'show', i: st.active + 1 }) }, icon('chevron_right')));
        const exportOne = h('button', { type: 'button', class: 'cd-btn sm hidden', onclick: () => exportPng(false) }, icon('image'), ' Diese Slide');
        const exportAll = h('button', { type: 'button', class: 'cd-primary sm', onclick: () => exportPng(true) }, icon('download'), ' Als PNG herunterladen');
        const status = h('div', { class: 'dz-status', 'aria-live': 'polite' });

        const page = h('div', { class: 'dz-page' },
            h('aside', { class: 'dz-left' },
                h('div', { class: 'dz-top' }, title,
                    h('button', { type: 'button', class: 'cd-x', title: 'Meine Designs', 'aria-label': 'Meine Designs', onclick: designsModal }, icon('folder_open')),
                    h('button', { type: 'button', class: 'cd-x', title: 'Neues Design', 'aria-label': 'Neues Design', onclick: () => { reset(); history.replaceState(null, '', '#/design'); Router.render(true); } }, icon('add'))),
                h('div', { class: 'dz-sec' }, h('div', { class: 'dz-label', text: 'Format' }), formats, slidesRow),
                brandBtn, msgs, imgBox,
                h('div', { class: 'dz-composer' }, input, h('div', { class: 'dz-comprow' }, tierLbl, send, stop))),
            h('section', { class: 'dz-right' },
                h('div', { class: 'dz-bar' }, tabs, nav, h('span', { class: 'grow' }), exportOne, exportAll),
                h('div', { class: 'dz-work' }, stage, code, codeBar),
                status));
        host.append(page);
        ui = { host, page, input, send, stop, title, formats, slidesRow, slidesVal, brand: brandBtn, msgs, imgs, imgHead, imgBox, frame, canvas, empty, emptyTxt, stage, code, applyCode, nav, navTxt, exportOne, exportAll, status };
        this._onMsg = onFrameMessage; window.addEventListener('message', this._onMsg);
        this._ro = new ResizeObserver(() => fit()); this._ro.observe(stage);
        setView(st.view === 'code' ? 'code' : 'preview');
        drawFormats(); drawBrand(); drawMsgs(); drawBusy(); drawNav(); await render();
        if (!st.busy && imagesOf().some(i => i.state === 'pending')) runImages(); // beim Öffnen fehlende Bilder nachholen
        setStatus(st.id ? 'Gespeichert · auch unter Artefakte' : 'Neues Design');
        if (!st.body) setTimeout(() => input.focus(), 50);
    },
    unmount() {
        if (this._onMsg) window.removeEventListener('message', this._onMsg);
        this._ro?.disconnect();
        if (st.body) save().catch(() => {}); // läuft die KI noch, speichert sie am Ende selbst
        ui = null;
    }
};
