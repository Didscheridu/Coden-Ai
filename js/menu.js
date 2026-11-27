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
        const vh = window.innerHeight, vw = window.innerWidth, pad = 8;
        const maxW = Math.max(180, vw - pad * 2);
        panel.style.maxWidth = maxW + 'px';
        const w = Math.min(Math.max(panel.offsetWidth, 220), maxW);
        let left = pr.right + 4, overlay = false;
        if (left + w > vw - pad) left = pr.left - w - 4;
        if (left < pad) { overlay = true; left = Math.max(pad, Math.min(pr.left, vw - w - pad)); }
        panel.classList.toggle('overlay', overlay);
        if (overlay) {
            panel.style.width = Math.min(Math.max(pr.width, 220), maxW) + 'px';
            panel.style.minWidth = '0px';
        } else {
            panel.style.width = '';
            panel.style.minWidth = '';
        }
        const actualW = Math.min(panel.offsetWidth || w, maxW);
        left = Math.max(pad, Math.min(vw - actualW - pad, left));
        const topSafe = (!b.closest('.top-bar') && (() => {
            const tb = document.querySelector('.top-bar')?.getBoundingClientRect();
            return tb && tb.height > 0 && tb.bottom > 0 && tb.top < 80 ? Math.max(pad, Math.ceil(tb.bottom) + 6) : pad;
        })()) || pad;
        const maxAvailH = Math.max(96, vh - pad - topSafe);
        panel.style.maxHeight = maxAvailH + 'px';
        const hgt = Math.min(panel.scrollHeight || panel.offsetHeight || 120, maxAvailH);
        let top = overlay ? pr.top : ir.top - 6;
        if (top + hgt > vh - pad) top = vh - pad - hgt;
        top = Math.max(topSafe, top);
        panel.style.left = Math.round(left) + 'px';
        panel.style.top = Math.round(top) + 'px';
        panel.style.maxHeight = Math.max(80, Math.floor(vh - pad - top)) + 'px';
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
function topSafeFor(anchor) {
    const pad = 8;
    if (!anchor || anchor.closest('.top-bar')) return pad;
    const tb = document.querySelector('.top-bar')?.getBoundingClientRect();
    return (tb && tb.height > 0 && tb.bottom > 0 && tb.top < 80) ? Math.max(pad, Math.ceil(tb.bottom) + 6) : pad;
}
// Verbindet einen Knopf mit einem Menü (Element mit Klasse cm-panel): auf/zu, außerhalb klicken, Esc, Pfeiltasten.
function clampPanel(menu, anchor) {
    if (!menu || !menu.isConnected || menu.classList.contains('hidden')) return;
    const vw = window.innerWidth, vh = window.innerHeight, pad = 8, gap = 6;
    const maxW = Math.max(180, vw - pad * 2);
    const topSafe = topSafeFor(anchor);

    menu.style.position = 'fixed';
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.margin = '0';
    menu.style.transform = '';
    menu.style.maxWidth = maxW + 'px';
    menu.style.maxHeight = '';
    menu.style.overflowY = 'auto';

    if (anchor && anchor.isConnected) {
        const br = anchor.getBoundingClientRect();
        // Breite erst normal messen und auf Bildschirmbreite deckeln
        const naturalW = Math.min(Math.max(menu.offsetWidth || 220, anchor.closest('#user-chip, .sidebar-footer') ? br.width : 0), maxW);
        if (naturalW > 0 && menu.offsetWidth > maxW) menu.style.width = maxW + 'px';
        const mw = Math.min(menu.offsetWidth || naturalW || 240, maxW);

        // Horizontal: Sidebar-Konto links ausrichten, rechte Buttons (z. B. top-bar ...) rechtsbündig am Button
        const alignRight = br.left + mw > vw - pad || br.right > vw * 0.55;
        let left = alignRight ? (br.right - mw) : br.left;
        left = Math.max(pad, Math.min(vw - mw - pad, left));

        const spaceBelow = Math.max(0, vh - br.bottom - pad - gap);
        const spaceAbove = Math.max(0, br.top - topSafe - gap);
        const naturalH = menu.scrollHeight || menu.offsetHeight || 220;
        const preferUp = menu.classList.contains('user-menu') || menu.classList.contains('composer-tools-menu');
        const openUp = preferUp
            ? (naturalH <= spaceAbove || spaceAbove >= spaceBelow)
            : (naturalH > spaceBelow && spaceAbove > spaceBelow);

        const availH = Math.max(80, Math.floor(openUp ? spaceAbove : spaceBelow));
        const finalH = Math.min(naturalH, availH);
        let top = openUp
            ? Math.max(topSafe, br.top - gap - finalH)
            : Math.min(vh - pad - finalH, br.bottom + gap);
        top = Math.max(topSafe, Math.min(vh - pad - 80, top));
        const maxH = Math.max(80, Math.min(availH, Math.floor(vh - pad - top)));

        menu.style.left = Math.round(left) + 'px';
        menu.style.top = Math.round(top) + 'px';
        menu.style.maxHeight = maxH + 'px';
        menu.style.transformOrigin = `${openUp ? 'bottom' : 'top'} ${alignRight ? 'right' : 'left'}`;
    } else {
        menu.style.maxHeight = Math.max(80, vh - topSafe - pad) + 'px';
        const r = menu.getBoundingClientRect();
        if (r.right > vw - pad) menu.style.left = Math.max(pad, vw - pad - r.width) + 'px';
        if (r.left < pad) menu.style.left = pad + 'px';
        if (r.bottom > vh - pad) menu.style.top = Math.max(topSafe, vh - pad - r.height) + 'px';
        if (r.top < topSafe) menu.style.top = topSafe + 'px';
    }
}
export function bindMenu(btn, menu, { onOpen, onClose } = {}) {
    if (!btn || !menu) return null;
    const home = document.createComment('cm-home');
    const portal = () => {
        if (menu.parentElement === document.body) return;
        if (menu.parentElement) menu.parentElement.insertBefore(home, menu);
        document.body.appendChild(menu);
    };
    const restore = () => {
        if (home.isConnected && home.parentElement) {
            home.parentElement.insertBefore(menu, home);
            home.remove();
        } else if (!home.isConnected && menu.parentElement === document.body && !document.body.contains(btn)) {
            menu.remove();
        }
    };
    const ctl = {
        get open() { return !menu.classList.contains('hidden'); },
        show() {
            closeAll();
            portal();
            onOpen?.(menu);
            menu.classList.remove('hidden');
            btn.setAttribute('aria-expanded', 'true');
            btn.classList.add('open');
            clampPanel(menu, btn);
            requestAnimationFrame(() => clampPanel(menu, btn));
        },
        close() {
            if (!ctl.open) { restore(); return; }
            menu.classList.add('hidden');
            btn.setAttribute('aria-expanded', 'false');
            btn.classList.remove('open');
            closeSubs(0);
            restore();
            onClose?.();
        },
        toggle() { ctl.open ? ctl.close() : ctl.show(); }
    };
    roots.add(ctl);
    btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); ctl.toggle(); });
    window.addEventListener('resize', () => { if (ctl.open) clampPanel(menu, btn); }, { passive: true });
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
