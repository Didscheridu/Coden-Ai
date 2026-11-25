// js/layout.js – Layout: Begrüßung, Artefakt-Galerie, Tabs (Apps, Artefakte, Code Buddy), Konto-Menü
import { mountAccountMenu } from './account-menu.js';
import { McpView } from './mcp.js';
import { ProjectsView } from './projects.js';
import { collectArtifacts, thumbFor, Artifacts } from './artifacts.js';
import { attachBridge } from './artifact-bridge.js';
import { apiJson } from './backend.js';
import { Buddy } from './buddy.js';
import { Router } from './router.js';
import { AppsView } from './apps/apps.js';
import { StudyView } from './study.js';

const $ = (id) => document.getElementById(id);
let getSessions = () => [];
const KIND_LABEL = { html: 'Webseite', svg: 'Grafik', markdown: 'Dokument', code: 'Code' };

export function greetingText(name) {
    const h = new Date().getHours();
    const g = h >= 5 && h < 11 ? 'Guten Morgen' : h >= 11 && h < 17 ? 'Guten Tag' : 'Guten Abend';
    return name ? `${g}, ${name}` : g;
}

// Öffnet den Chat, in dem das Artefakt entstanden ist, und zeigt es an
function openArtifact(item) {
    Router.go('chat');
    setTimeout(() => { document.dispatchEvent(new CustomEvent('loadChatSession', { detail: item.sessionId })); setTimeout(() => Artifacts.open(item), 80); }, 30);
}

function card(item, { actions = false } = {}) {
    const b = document.createElement('div'); b.className = 'we-card'; b.tabIndex = 0; b.setAttribute('role', 'button');
    const t = document.createElement('div'); t.className = 'we-title'; t.textContent = item.title;
    const k = document.createElement('small'); k.textContent = (item.type === 'code' ? (item.language || 'Code') : KIND_LABEL[item.type]) + (item.chatTitle ? ' · ' + item.chatTitle : '');
    b.append(thumbFor(item), t, k);
    if (actions && item.type === 'html') {
        const a = document.createElement('button'); a.type = 'button'; a.className = 'we-act'; a.title = 'Als App mit eigener Adresse weiterbauen';
        a.innerHTML = '<span class="material-symbols-outlined">rocket_launch</span>'; a.append('Als App');
        a.addEventListener('click', (e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('artifactToApp', { detail: item })); });
        b.appendChild(a);
    }
    b.addEventListener('click', () => openArtifact(item));
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter') openArtifact(item); });
    return b;
}

function refreshGallery() {
    const items = collectArtifacts(getSessions());
    const wrap = $('we-cards'); if (!wrap) return;
    wrap.replaceChildren(...items.slice(0, 3).map(i => card(i)));
    $('we-gallery').classList.toggle('hidden', !items.length);
    $('welcome-extra').classList.remove('hidden');
}

// ---------- Tab "Artefakte" ----------
const ArtifactsView = {
    mount(host) {
        let filter = 'all', q = '';
        const grid = document.createElement('div'); grid.className = 'ag-grid';
        const page = document.createElement('div'); page.className = 'ap-page';
        page.innerHTML = `<div class="ap-hero"><div><h1>Artefakte</h1><p>Alles, was Coden in deinen Chats gebaut hat: Webseiten, Spiele, Grafiken, Dokumente und Code.</p></div></div>
          <div class="ap-filters ag-bar"><input class="ag-search" type="search" placeholder="Artefakte durchsuchen …" aria-label="Artefakte durchsuchen"></div>`;
        const bar = page.querySelector('.ag-bar'); const search = page.querySelector('.ag-search');
        const all = collectArtifacts(getSessions());
        const chips = [['all', 'Alle'], ['html', 'Webseiten'], ['svg', 'Grafiken'], ['markdown', 'Dokumente'], ['code', 'Code']].map(([k, l]) => {
            const b = document.createElement('button'); b.className = 'ap-chip'; b.dataset.k = k; b.textContent = l;
            const n = document.createElement('span'); n.textContent = String(k === 'all' ? all.length : all.filter(x => x.type === k).length); b.appendChild(n);
            b.addEventListener('click', () => { filter = k; draw(); }); return b;
        });
        bar.prepend(...chips);
        const draw = () => {
            chips.forEach(c => c.classList.toggle('active', c.dataset.k === filter));
            const list = all.filter(x => (filter === 'all' || x.type === filter) && (!q || (x.title + ' ' + (x.chatTitle || '')).toLowerCase().includes(q)));
            if (!all.length) { grid.innerHTML = '<div class="ap-empty wide"><span class="material-symbols-outlined">deployed_code</span><h2>Noch keine Artefakte</h2><p>Bitte Coden im Chat z. B. um ein Spiel, eine Webseite oder ein Diagramm – es erscheint dann hier.</p></div>'; return; }
            grid.replaceChildren(...(list.length ? list.map(i => card(i, { actions: true })) : [Object.assign(document.createElement('p'), { className: 'ap-none', textContent: 'Nichts gefunden.' })]));
        };
        search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); draw(); });
        page.appendChild(grid); host.appendChild(page); draw();
    }
};

// ---------- Veröffentlichtes Artefakt in Coden ansehen (#/s/<id>): mit KI und geteilten Daten über das eigene Konto ----------
const SharedView = {
    async mount(host, params) {
        const id = String(params[0] || '');
        const page = document.createElement('div'); page.className = 'sa-page';
        host.appendChild(page);
        let a;
        try { a = await apiJson('/public/artifacts/' + encodeURIComponent(id)); }
        catch (e) { page.innerHTML = '<div class="ap-empty wide"><span class="material-symbols-outlined">link_off</span><h2>Dieses Artefakt gibt es nicht (mehr)</h2><p></p></div>'; page.querySelector('p').textContent = e.message; return; }
        const bar = document.createElement('div'); bar.className = 'sa-bar';
        const t = document.createElement('b'); t.textContent = a.title;
        const by = document.createElement('small'); by.textContent = 'Veröffentlichtes Artefakt' + (a.author ? ' von ' + a.author : '');
        const mk = (ic, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'cd-btn sm'; const i = document.createElement('span'); i.className = 'material-symbols-outlined'; i.textContent = ic; b.append(i, ' ' + label); b.addEventListener('click', fn); return b; };
        const copyBtn = mk('link', 'Link kopieren', async () => { try { await navigator.clipboard.writeText(`${location.origin}/s/${a.id}`); copyBtn.lastChild.textContent = ' Kopiert'; } catch (_) {} });
        const remix = mk('edit', 'In einem Chat weiterbauen', () => document.dispatchEvent(new CustomEvent('coden:compose', { detail: { text: `Bau dieses Artefakt „${a.title}“ für mich weiter:\n\n<artifact type="${a.type}" title="${a.title.replace(/"/g, '')}">\n${a.body}\n</artifact>\n\nMeine Änderungswünsche: ` } })));
        bar.append(t, by, copyBtn, remix);
        const f = document.createElement('iframe'); f.className = 'sa-frame';
        f.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms allow-pointer-lock allow-popups allow-popups-to-escape-sandbox');
        f.setAttribute('referrerpolicy', 'no-referrer'); f.setAttribute('allow', 'fullscreen; autoplay'); f.title = a.title;
        attachBridge(f, () => ({ aid: a.id, published: true }));
        f.srcdoc = a.html;
        page.append(bar, f);
    }
};

let layoutWired = false;
export const Layout = {
    init({ sessionsGetter }) {
        getSessions = sessionsGetter;
        if (!layoutWired) {
            layoutWired = true;
            document.addEventListener('sessionsRendered', refreshGallery);
            Router.register('apps', AppsView);
            Router.register('lernen', StudyView);
            Router.register('artefakte', ArtifactsView);
            Router.register('verbindungen', McpView);
            Router.register('s', SharedView);
            Router.register('projekte', ProjectsView);
            Router.register('buddy', { mount: (host, params) => Buddy.mount(host, params), unmount: () => Buddy.unmount() });
            const nav = (id, path) => $(id)?.addEventListener('click', (e) => { e.preventDefault(); Router.go(path); });
            nav('open-apps-btn', 'apps'); nav('open-study-btn', 'lernen'); nav('open-artifacts-btn', 'artefakte'); nav('open-mcp-btn', 'verbindungen'); nav('open-buddy-btn', 'buddy'); nav('open-projects-btn', 'projekte');
            $('we-all')?.addEventListener('click', () => Router.go('artefakte'));
            // "Neu" und Chats in der Seitenleiste führen immer zurück in den Chat
            $('sb-new')?.addEventListener('click', () => Router.go('chat'));
            document.addEventListener('loadChatSession', () => { if (Router.parse().name !== 'chat') Router.go('chat'); });
            // Das Artefakt-Fenster gehört zum Chat: beim Wechsel in einen anderen Tab schließen
            window.addEventListener('hashchange', () => { if (Router.parse().name !== 'chat') Artifacts.close(); });
            // Konto-Menü
            mountAccountMenu();
        }
        refreshGallery();
        Router.init();
    },
    setUser(name, email) {
        const n = name || (email || '').split('@')[0] || 'Konto';
        if ($('uc-name')) $('uc-name').textContent = n;
        if ($('uc-avatar')) $('uc-avatar').textContent = n[0].toUpperCase();
    }
};
