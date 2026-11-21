// js/apps/dom.js – kleine Helfer zum Bauen von Oberflächen ohne innerHTML mit Nutzerdaten
export const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v === false || v == null) continue;
        if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v); else if (k === 'value') el.value = v; else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
};
export const icon = (name, cls = '') => h('span', { class: 'material-symbols-outlined ' + cls, text: name, 'aria-hidden': 'true' });
export const md = (text) => { const d = h('div', { class: 'md' }); d.innerHTML = DOMPurify.sanitize(marked.parse(String(text || '')), { ADD_ATTR: ['target'] }); d.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; }); d.querySelectorAll('pre code').forEach(c => { try { hljs.highlightElement(c); } catch (_) {} }); return d; };
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export function timeAgo(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'gerade eben'; if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`; if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
    if (s < 7 * 86400) return `vor ${Math.floor(s / 86400)} Tag${s < 2 * 86400 ? '' : 'en'}`;
    return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
}
export async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch (_) { return false; } }
export function qrSvg(text, cell = 5) {
    const q = window.qrcode(0, 'M'); q.addData(String(text)); q.make();
    const wrap = h('div', { class: 'qr' }); wrap.innerHTML = q.createSvgTag({ cellSize: cell, margin: 2, scalable: true }); return wrap;
}
