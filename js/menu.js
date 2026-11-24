// js/menu.js – Ein Menü-Baukasten für ganz Coden (Stil und Aufbau wie bei Claude):
// Kopfzeile (z. B. E-Mail), Einträge mit Symbol, Kurzbefehl rechts, Untermenüs mit Pfeil (fliegen seitlich auf), Trennlinien.
// Wurzel-Menüs bleiben normale Elemente im HTML (IDs bleiben gleich), Untermenüs werden hier gebaut.
import { h, icon } from './apps/dom.js';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export const kbd = (k) => isMac ? k.replace(/Strg\+/g, '⌘').replace(/Umschalt\+/g, '⇧') : k;

// ---------- Bausteine ----------
// o: { icon, emoji, label, desc, meta, kbd, sub, onClick, danger, accent, checked, id, cls, keep, title }
//   sub: (panel) => void|Promise   → Untermenü
//   keep: true                      → Menü nach dem Klick offen lassen (z. B. Schalter)
export function item(o) {
    const b = h('button', { type: 'button', class: 'cm-item' + (o.danger ? ' danger' : '') + (o.accent ? ' accent' : '') + (o.cls ? ' ' + o.cls : ''), role: o.checked !== undefined ? 'menuitemcheckbox' : 'menuitem', id: o.id, title: o.title });
    fill(b, o);
    if (o.sub) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); bindSub(b, o.sub); }
    else if (o.onClick) b.addEventListener('click', (e) => { e.stopPropagation(); if (!o.keep) closeAll(); o.onClick(e, b); });
    return b;
}
// Inhalt eines Eintrags (auch für bestehende Knöpfe im HTML nutzbar)
export function fill(b, o) {
    const kids = [];
    if (o.emoji) kids.push(h('span', { class: 'cm-ic cm-emoji', text: o.emoji, 'aria-hidden': 'true' }));
    else if (o.icon) kids.push(icon(o.icon, 'cm-ic'));
    kids.push(o.desc ? h('span', { class: 'cm-text' }, h('span', { class: 'cm-label', text: o.label }), h('span', { class: 'cm-desc', text: o.desc })) : h('span', { class: 'cm-label', text: o.label }));
    if (o.meta) kids.push(h('span', { class: 'cm-meta', text: o.meta }));
    if (o.kbd) kids.push(h('span', { class: 'cm-kbd', text: kbd(o.kbd) }));
    if (o.checked !== undefined) { b.setAttribute('aria-checked', String(!!o.checked)); kids.push(icon('check', 'cm-check' + (o.checked ? '' : ' off'))); }
    if (o.sub) kids.push(icon('chevron_right', 'cm-chev'));
    if (o.external) kids.push(icon('arrow_outward', 'cm-chev'));
    b.replaceChildren(...kids);
    return b;
}
export function setChecked(b, on) { b.setAttribute('aria-checked', String(!!on)); b.querySelector('.cm-check')?.classList.toggle('off', !on); }
export const sep = () => h('div', { class: 'cm-sep', role: 'separator' });
export const head = (text) => h('div', { class: 'cm-head', text });
export const note = (text) => h('div', { class: 'cm-note', text });
export const group = (text) => h('div', { class: 'cm-group', text });

// ---------- Untermenüs ----------
const subs = []; // offene Untermenüs: { el, item }
const fine = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
let hoverTimer = null;

function levelOf(el) { const p = el.closest('.cm-flyout'); return p ? Number(p.dataset.level) + 1 : 0; }
export function closeSubs(level = 0) {
    while (subs.length > level) { const s = subs.pop(); s.el.remove(); s.item.setAttribute('aria-expanded', 'false'); s.item.classList.remove('open'); }
}
function bindSub(b, build) {
    b.addEventListener('click', (e) => { e.stopPropagation(); const lv = levelOf(b); if (subs[lv]?.item === b) closeSubs(lv); else openSub(b, build); });
    b.addEventListener('mouseenter', () => { if (!fine()) return; clearTimeout(hoverTimer); hoverTimer = setTimeout(() => { if (subs[levelOf(b)]?.item !== b) openSub(b, build); }, 110); });
    b.addEventListener('mouseleave', () => clearTimeout(hoverTimer));
}
// Andere Einträge im selben Menü schließen ein offenes Untermenü (wie bei Claude)
document.addEventListener('mouseover', (e) => {
    if (!fine() || !subs.length) return;
    const it = e.target.closest?.('.cm-item'); if (!it || it.getAttribute('aria-haspopup') === 'menu') return;
    const lv = levelOf(it); if (subs.length > lv) { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => closeSubs(lv), 120); }
});

// Untermenü an einen schon vorhandenen Eintrag (z. B. aus dem HTML) hängen
export function attachSub(b, build) { if (!b) return; b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); bindSub(b, build); }

export async function openSub(b, build) {
    const lv = levelOf(b);
    closeSubs(lv);
    const parent = b.closest('.cm-panel') || b.parentElement;
    const panel = h('div', { class: 'cm-panel cm-flyout', role: 'menu', 'data-level': String(lv) });
    panel.addEventListener('click', (e) => e.stopPropagation());
    subs.push({ el: panel, item: b });
    b.setAttribute('aria-expanded', 'true'); b.classList.add('open');
    document.body.append(panel);
    const place = () => {
        const pr = parent.getBoundingClientRect(), ir = b.getBoundingClientRect();
        const w = Math.max(panel.offsetWidth, 220), vh = window.innerHeight, vw = window.innerWidth;
        let left = pr.right + 4, overlay = false;
        if (left + w > vw - 8) left = pr.left - w - 4;
        if (left < 8) { overlay = true; left = Math.max(8, Math.min(pr.left, vw - w - 8)); }
        panel.classList.toggle('overlay', overlay);
        const hgt = panel.offsetHeight;
        let top = overlay ? pr.top : ir.top - 6;
        if (top + hgt > vh - 8) top = Math.max(8, vh - 8 - hgt);
        panel.style.left = left + 'px'; panel.style.top = Math.max(8, top) + 'px';
        panel.style.maxHeight = (vh - 16) + 'px';
        if (overlay) panel.style.minWidth = Math.min(pr.width, vw - 16) + 'px';
    };
    const back = h('button', { type: 'button', class: 'cm-item cm-back', onclick: (e) => { e.stopPropagation(); closeSubs(lv); b.focus(); } }, icon('chevron_left', 'cm-ic'), h('span', { class: 'cm-label', text: b.querySelector('.cm-label')?.textContent || 'Zurück' }));
    const render = async () => {
        const body = h('div', { class: 'cm-body' });
        const r = build(body);
        if (r && typeof r.then === 'function') {
            panel.replaceChildren(back, h('div', { class: 'cm-body' }, note('Lade …'))); place();
            try { await r; } catch (e) { body.replaceChildren(note('Konnte nicht geladen werden.')); }
            if (!panel.isConnected) return; // inzwischen geschlossen
        }
        panel.replaceChildren(back, body);
        place();
    };
    panel.rerender = render; // Einträge können das Untermenü neu zeichnen (z. B. nach einem Schalter)
    await render();
}
export const rerenderSubs = () => subs.forEach((s) => s.el.rerender?.());

// ---------- Wurzel-Menüs ----------
const roots = new Set();
export function closeAll() {
    closeSubs(0);
    for (const r of roots) r.close();
}
// Verbindet einen Knopf mit einem Menü (Element mit Klasse cm-panel): auf/zu, außerhalb klicken, Esc, Pfeiltasten.
export function bindMenu(btn, menu, { onOpen, onClose } = {}) {
    if (!btn || !menu) return null;
    const ctl = {
        get open() { return !menu.classList.contains('hidden'); },
        show() { closeAll(); onOpen?.(menu); menu.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); btn.classList.add('open'); },
        close() { if (!ctl.open) return; menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('open'); closeSubs(0); onClose?.(); },
        toggle() { ctl.open ? ctl.close() : ctl.show(); }
    };
    roots.add(ctl);
    btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); ctl.toggle(); });
    // Einträge ohne eigenes Untermenü schließen das Menü nach dem Klick
    menu.addEventListener('click', (e) => { const it = e.target.closest('.cm-item'); if (it && it.getAttribute('aria-haspopup') !== 'menu' && !it.dataset.keep) setTimeout(() => closeAll(), 0); });
    return ctl;
}
document.addEventListener('click', (e) => { if (!e.target.closest?.('.cm-panel')) closeAll(); });
document.addEventListener('keydown', (e) => {
    const openRoot = [...roots].find((r) => r.open);
    if (!openRoot && !subs.length) return;
    if (e.key === 'Escape') { closeAll(); return; }
    const panel = document.activeElement?.closest?.('.cm-panel');
    if (!panel) { if (e.key === 'ArrowDown') { const p = subs.length ? subs[subs.length - 1].el : [...document.querySelectorAll('.cm-panel:not(.hidden):not(.cm-flyout)')].pop(); p?.querySelector('.cm-item:not(.cm-back)')?.focus(); e.preventDefault(); } return; }
    const items = [...panel.querySelectorAll('.cm-item')].filter((x) => x.offsetParent && !x.disabled);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = items.length; items[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus(); }
    else if (e.key === 'ArrowRight' && document.activeElement.getAttribute('aria-haspopup') === 'menu') { e.preventDefault(); document.activeElement.click(); setTimeout(() => subs[subs.length - 1]?.el.querySelector('.cm-item:not(.cm-back)')?.focus(), 30); }
    else if (e.key === 'ArrowLeft' && panel.classList.contains('cm-flyout')) { e.preventDefault(); const lv = Number(panel.dataset.level); const it = subs[lv]?.item; closeSubs(lv); it?.focus(); }
});
window.addEventListener('resize', () => closeSubs(0));
