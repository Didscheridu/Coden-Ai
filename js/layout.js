// js/layout.js – Claude-ähnliches Layout: Begrüßung, Artefakt-Galerie, Konto-Menü, Abschnitte der Seitenleiste
import { collectArtifacts, thumbFor, Artifacts } from './artifacts.js';
import { Buddy } from './buddy.js';

const $ = (id) => document.getElementById(id);
let getSessions = () => [], loadSession = () => {};

export function greetingText(name) {
    const h = new Date().getHours();
    const g = h >= 5 && h < 11 ? 'Guten Morgen' : h >= 11 && h < 17 ? 'Guten Tag' : 'Guten Abend';
    return name ? `${g}, ${name}` : g;
}

function card(item) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'we-card';
    const t = document.createElement('div'); t.className = 'we-title'; t.textContent = item.title;
    const k = document.createElement('small'); k.textContent = { html: 'Webseite', svg: 'Grafik', markdown: 'Dokument', code: item.language || 'Code' }[item.type];
    b.append(thumbFor(item), t, k);
    b.addEventListener('click', () => { document.dispatchEvent(new CustomEvent('loadChatSession', { detail: item.sessionId })); setTimeout(() => Artifacts.open(item), 80); });
    return b;
}

function refreshGallery() {
    const items = collectArtifacts(getSessions());
    const wrap = $('we-cards'); if (!wrap) return;
    wrap.replaceChildren(...items.slice(0, 3).map(card));
    $('we-gallery').classList.toggle('hidden', !items.length);
    $('welcome-extra').classList.remove('hidden');
    const full = $('artifact-gallery');
    if (full && full.classList.contains('open')) fillFull(items);
}

function fillFull(items) {
    const g = $('artifact-gallery').querySelector('.ag-grid'); g.replaceChildren();
    if (!items.length) { const p = document.createElement('p'); p.className = 'ag-empty'; p.textContent = 'Noch keine Artefakte. Bitte Coden z. B. um ein Spiel oder eine Webseite.'; g.appendChild(p); return; }
    items.forEach(it => { const c = card(it); c.addEventListener('click', () => closeGallery()); g.appendChild(c); });
}
function openGallery() {
    let el = $('artifact-gallery');
    if (!el) {
        el = document.createElement('div'); el.id = 'artifact-gallery'; el.className = 'artifact-gallery';
        el.innerHTML = '<div class="ag-card"><div class="ag-head"><h2>Artefakte</h2><button class="bd-icon" title="Schließen"><span class="material-symbols-outlined">close</span></button></div><div class="ag-grid"></div></div>';
        el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.ag-head button')) closeGallery(); });
        document.body.appendChild(el);
    }
    el.classList.add('open'); fillFull(collectArtifacts(getSessions()));
}
function closeGallery() { $('artifact-gallery')?.classList.remove('open'); }

export const Layout = {
    init({ sessionsGetter }) {
        getSessions = sessionsGetter;
        document.addEventListener('sessionsRendered', refreshGallery);
        $('we-all')?.addEventListener('click', openGallery);
        $('open-artifacts-btn')?.addEventListener('click', (e) => { e.preventDefault(); openGallery(); });
        $('open-projects-btn')?.addEventListener('click', (e) => { e.preventDefault(); Buddy.open({ tab: 'projects' }); });
        // Konto-Menü
        const chip = $('user-chip'), menu = $('user-menu');
        chip?.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); chip.classList.toggle('open', !menu.classList.contains('hidden')); });
        document.addEventListener('click', (e) => { if (menu && !menu.classList.contains('hidden') && !e.target.closest('#user-menu')) { menu.classList.add('hidden'); chip?.classList.remove('open'); } });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeGallery(); });
        refreshGallery();
    },
    setUser(name, email) {
        const n = name || (email || '').split('@')[0] || 'Konto';
        if ($('uc-name')) $('uc-name').textContent = n;
        if ($('uc-avatar')) $('uc-avatar').textContent = n[0].toUpperCase();
    }
};
