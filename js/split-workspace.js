// js/split-workspace.js – Geteilter Arbeitsbereich rechts neben dem Chat:
// Umschaltbar zwischen Research-Browser und Lernheft (Chat links, Browser/Heft rechts).
// Weicht automatisch dem Artefakt-Fenster aus und passt sich auf Mobilgeräten als Tab/Drawer an.

import { StudyStore } from './study-store.js';
import * as S from './study-core.js';
import { Artifacts } from './artifacts.js';
import { toast } from './toast.js';
import { COVERS } from './ink-core.js';
import { loadPage, savePage, drawPaper, drawStroke, decodeStrokes, newPageId } from './ink.js';
import { mountBrowserPane, openInBrowser } from './browser-ui.js';

const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
};
const ic = (name) => h('span', { class: 'material-symbols-outlined', 'aria-hidden': 'true', text: name });

const WIDTH_KEY = 'coden_split_w';

const ws = {
    openState: false,
    tab: 'browser', // 'browser' | 'notebook'
    mobilePane: 'split', // 'chat' | 'split'
    docId: null,
    pageIdx: 0,
    el: null,
    bodyEl: null,
    mobSwitchEl: null
};

function setWidth(w) {
    const px = Math.round(Math.max(360, Math.min(window.innerWidth - 360, w)));
    document.documentElement.style.setProperty('--sw-w', px + 'px');
    return px;
}

function ensureDom() {
    if (ws.el) return ws.el;
    const saved = parseInt(localStorage.getItem(WIDTH_KEY) || '', 10);
    if (saved) setWidth(saved);

    const aside = document.createElement('aside');
    aside.id = 'split-workspace';
    aside.className = 'split-workspace hidden';
    aside.setAttribute('aria-label', 'Geteilter Arbeitsbereich');

    const grip = h('div', { class: 'sw-grip', title: 'Breite ändern' });
    grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        document.body.classList.add('sw-resizing');
        const mv = (ev) => setWidth(window.innerWidth - ev.clientX);
        const up = (ev) => {
            grip.removeEventListener('pointermove', mv);
            grip.removeEventListener('pointerup', up);
            document.body.classList.remove('sw-resizing');
            try { localStorage.setItem(WIDTH_KEY, String(setWidth(window.innerWidth - ev.clientX))); } catch (_) {}
        };
        grip.addEventListener('pointermove', mv);
        grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', () => {
        document.documentElement.style.removeProperty('--sw-w');
        try { localStorage.removeItem(WIDTH_KEY); } catch (_) {}
    });

    const head = h('div', { class: 'sw-head' });
    const tabs = h('div', { class: 'sw-tabs' },
        h('button', { type: 'button', 'data-sw-tab': 'browser', onclick: () => SplitWorkspace.setTab('browser') }, ic('public'), h('span', { text: 'Browser' })),
        h('button', { type: 'button', 'data-sw-tab': 'notebook', onclick: () => SplitWorkspace.setTab('notebook') }, ic('auto_stories'), h('span', { text: 'Lernheft' }))
    );

    const chatOnlyMob = h('button', {
        type: 'button',
        class: 'sw-mob-chat-btn',
        onclick: () => SplitWorkspace.close()
    }, ic('chat'), h('span', { text: 'Zum Chat' }));

    const closeBtn = h('button', {
        type: 'button',
        class: 'sw-close',
        title: 'Arbeitsbereich schließen',
        'aria-label': 'Arbeitsbereich schließen',
        onclick: () => SplitWorkspace.close()
    }, ic('close'));

    head.append(tabs, h('div', { class: 'sw-head-right' }, chatOnlyMob, closeBtn));

    const body = h('div', { class: 'sw-body' });
    aside.append(grip, head, body);

    const appEl = document.getElementById('app');
    if (appEl) appEl.append(aside); else document.body.append(aside);

    ws.el = aside;
    ws.bodyEl = body;

    // Falls das Artefakt-Fenster geöffnet wird, schließen wir den Split-Workspace sauber, damit sich nichts überlappt
    new MutationObserver(() => {
        if (document.body.classList.contains('artifact-open') && ws.openState) {
            SplitWorkspace.close({ silent: true });
        }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    document.addEventListener('studyChanged', () => {
        if (ws.openState && ws.tab === 'notebook') renderNotebookPane();
    });

    return aside;
}

function syncHeader() {
    if (!ws.el) return;
    ws.el.querySelectorAll('[data-sw-tab]').forEach(b => {
        b.classList.toggle('active', b.dataset.swTab === ws.tab);
    });
    document.getElementById('toggle-workspace-btn')?.classList.toggle('on', ws.openState);
}

async function renderNotebookPane() {
    if (!ws.bodyEl) return;
    const st = StudyStore.get();
    const docs = S.sortDocs(st.docs || [], 'bearbeitet');

    const root = h('div', { class: 'swn-root' });

    if (!docs.length) {
        root.append(
            h('div', { class: 'swn-empty' },
                ic('auto_stories'),
                h('h3', { text: 'Noch kein Lernheft' }),
                h('p', { text: 'Erstelle direkt ein neues Heft, um Chat-Notizen oder Aufgaben daneben festzuhalten.' }),
                h('button', {
                    type: 'button',
                    class: 'cd-primary',
                    onclick: async () => {
                        await SplitWorkspace.appendNoteToNotebook('', { title: 'Mein Lernheft' });
                    }
                }, ic('add'), ' Lernheft erstellen')
            )
        );
        ws.bodyEl.replaceChildren(root);
        return;
    }

    let doc = docs.find(d => d.id === ws.docId) || docs[0];
    ws.docId = doc.id;
    const pages = Array.isArray(doc.pages) && doc.pages.length ? doc.pages : [];
    if (ws.pageIdx >= pages.length) ws.pageIdx = Math.max(0, pages.length - 1);

    const sel = h('select', {
        class: 'cd-input swn-doc-sel',
        'aria-label': 'Lernheft wählen',
        onchange: (e) => {
            ws.docId = e.target.value;
            ws.pageIdx = 0;
            renderNotebookPane();
        }
    }, ...docs.map(d => h('option', { value: d.id, text: d.title || 'Notizbuch', ...(d.id === doc.id ? { selected: true } : {}) })));

    const topBar = h('div', { class: 'swn-bar' },
        sel,
        h('button', {
            type: 'button',
            class: 'cd-btn sm',
            title: 'Vollbild-Editor öffnen',
            onclick: async () => {
                const nbMod = await import('./notebooks.js');
                nbMod.openNotebook(st, doc);
            }
        }, ic('open_in_full'), ' Heft-Editor')
    );

    const canvasWrap = h('div', { class: 'swn-canvas-wrap' });
    const canvas = document.createElement('canvas');
    canvas.className = 'swn-canvas';
    canvasWrap.append(canvas);

    const pageNav = h('div', { class: 'swn-page-nav' },
        h('button', {
            type: 'button',
            class: 'cd-btn sm',
            disabled: ws.pageIdx <= 0,
            onclick: () => { if (ws.pageIdx > 0) { ws.pageIdx--; renderNotebookPane(); } }
        }, ic('chevron_left')),
        h('span', { text: `Seite ${pages.length ? ws.pageIdx + 1 : 1} / ${Math.max(1, pages.length)}` }),
        h('button', {
            type: 'button',
            class: 'cd-btn sm',
            disabled: ws.pageIdx >= pages.length - 1,
            onclick: () => { if (ws.pageIdx < pages.length - 1) { ws.pageIdx++; renderNotebookPane(); } }
        }, ic('chevron_right'))
    );

    // Schnelle Notiz in das aktuelle Heft einfügen
    const quickInput = h('textarea', {
        class: 'cd-input swn-quick-in',
        rows: 2,
        placeholder: 'Schnelle Notiz oder Lösung direkt auf diese Seite schreiben …'
    });
    const addNoteBtn = h('button', {
        type: 'button',
        class: 'cd-primary sm',
        onclick: async () => {
            const val = quickInput.value.trim();
            if (!val) return;
            await SplitWorkspace.appendNoteToNotebook(val, { docId: doc.id, pageIndex: ws.pageIdx });
            quickInput.value = '';
            renderNotebookPane();
            toast('Notiz ins Lernheft übernommen', { type: 'ok' });
        }
    }, ic('edit_note'), ' Auf Seite schreiben');

    root.append(
        topBar,
        pageNav,
        canvasWrap,
        h('div', { class: 'swn-quick-box' }, quickInput, addNoteBtn)
    );
    ws.bodyEl.replaceChildren(root);

    // Seite rendern (Papier + Striche + Textblöcke)
    const pid = pages[ws.pageIdx];
    const pageData = pid ? await loadPage(pid).catch(() => null) : null;
    const W = 794, H = 1123;
    const scale = 0.55;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext('2d');
    drawPaper(ctx, pageData?.paper || doc.paper || 'karo', scale);
    if (pageData) {
        if (pageData.bg) {
            await new Promise((res) => {
                const im = new Image();
                im.onload = () => {
                    const s = Math.min(W / im.width, H / im.height);
                    ctx.drawImage(im, (W - im.width * s) / 2 * scale, 0, im.width * s * scale, im.height * s * scale);
                    res();
                };
                im.onerror = res;
                im.src = pageData.bg;
            });
        }
        const strokes = Array.isArray(pageData.strokes) ? pageData.strokes : decodeStrokes(pageData.strokes || '[]');
        for (const s of strokes) drawStroke(ctx, s, scale);
        for (const t of (pageData.text || [])) {
            ctx.save();
            ctx.fillStyle = t.c || '#1b1f2a';
            ctx.font = `${(t.z || 18) * scale}px "Plus Jakarta Sans", system-ui, sans-serif`;
            ctx.textBaseline = 'top';
            String(t.s || '').split('\n').forEach((line, li) => {
                ctx.fillText(line, (t.x || 90) * scale, ((t.y || 120) + li * (t.z || 18) * 1.4) * scale);
            });
            ctx.restore();
        }
    }
}

function renderActivePane() {
    if (!ws.bodyEl) return;
    if (ws.tab === 'browser') mountBrowserPane(ws.bodyEl);
    else renderNotebookPane();
}

export const SplitWorkspace = {
    isOpen: () => ws.openState,
    activeTab: () => ws.tab,

    open(tab = 'browser') {
        ensureDom();
        if (document.body.classList.contains('artifact-open')) Artifacts.close();
        ws.tab = tab === 'notebook' ? 'notebook' : 'browser';
        ws.openState = true;
        ws.el.classList.remove('hidden');
        document.body.classList.add('has-split-workspace');
        syncHeader();
        renderActivePane();
    },

    close({ silent = false } = {}) {
        if (!ws.el) return;
        ws.openState = false;
        ws.el.classList.add('hidden');
        document.body.classList.remove('has-split-workspace');
        syncHeader();
        if (!silent) document.dispatchEvent(new CustomEvent('coden:splitClosed'));
    },

    toggle(tab) {
        if (ws.openState && (!tab || ws.tab === tab)) SplitWorkspace.close();
        else SplitWorkspace.open(tab || ws.tab);
    },

    setTab(tab) {
        ws.tab = tab === 'notebook' ? 'notebook' : 'browser';
        if (!ws.openState) SplitWorkspace.open(ws.tab);
        else {
            syncHeader();
            renderActivePane();
        }
    },

    async openBrowser(target = {}) {
        SplitWorkspace.open('browser');
        if (target.url || target.site || target.query) {
            return openInBrowser(target);
        }
        return null;
    },

    async appendNoteToNotebook(noteText, { docId = null, title = 'Coden Notizen', pageIndex = 0, paper = 'karo', bg = null } = {}) {
        const st = StudyStore.get();
        let doc = docId ? st.docs.find(d => d.id === docId) : st.docs[0];
        if (!doc) {
            doc = S.newDoc(st, {
                title,
                paper,
                cover: { color: COVERS[st.docs.length % COVERS.length], style: 'leinen' }
            });
            const pid = newPageId();
            doc.pages.push(pid);
            await savePage({ id: pid, doc: doc.id, idx: 0, paper: bg ? 'blanko' : paper, strokes: '[]', text: [], items: [], bg }, { withBg: Boolean(bg) });
            StudyStore.save(st);
        } else if (!doc.pages.length || bg) {
            const pid = newPageId();
            doc.pages.push(pid);
            pageIndex = doc.pages.length - 1;
            await savePage({ id: pid, doc: doc.id, idx: pageIndex, paper: bg ? 'blanko' : (doc.paper || paper), strokes: '[]', text: [], items: [], bg }, { withBg: Boolean(bg) });
            doc.updatedAt = new Date().toISOString();
            StudyStore.save(st);
        }
        const safeIdx = Math.min(pageIndex, doc.pages.length - 1);
        const pid = doc.pages[safeIdx];
        const loaded = await loadPage(pid).catch(() => null);
        const page = loaded || { id: pid, doc: doc.id, idx: safeIdx, paper: doc.paper || paper, strokes: '[]', text: [], items: [], bg };
        const clean = String(noteText || '').trim();
        if (clean) {
            const existing = Array.isArray(page.text) ? page.text : [];
            const lastY = existing.reduce((maxY, t) => Math.max(maxY, (t.y || 120) + (String(t.s || '').split('\n').length * (t.z || 18) * 1.45)), 110);
            existing.push({ x: 96, y: Math.min(960, Math.round(lastY + 18)), z: 18, c: '#1b1f2a', s: clean });
            page.text = existing;
            await savePage({ ...page, id: pid, doc: doc.id, idx: safeIdx }, { withBg: Boolean(page.bg) });
            doc.updatedAt = new Date().toISOString();
            StudyStore.save(st);
        }
        ws.docId = doc.id;
        ws.pageIdx = safeIdx;
        if (ws.openState && ws.tab === 'notebook') renderNotebookPane();
        return doc;
    }
};

// Globales Event für Web-Vorschaukarten ("Im Split-Browser öffnen")
document.addEventListener('coden:openBrowser', (e) => {
    const d = e.detail || {};
    SplitWorkspace.openBrowser(d).catch(err => toast(err?.message || 'Konnte Seite nicht öffnen.', { type: 'error' }));
});
