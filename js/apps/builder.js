// js/apps/builder.js – der App-Builder: links Chat mit dem Coden-Agenten, rechts Live-Vorschau (Handy-/Browser-Rahmen) und Code.
import { apiJson, apiFetch } from '../backend.js';
import { notifyDone } from '../runs.js';
import { Router } from '../router.js';
import { auth } from '../auth.js';
import { toast } from '../toast.js';
import { h, icon, md, sleep, copy } from './dom.js';
import { getEffort, setEffort, bindEffortButtons } from '../effort.js';
import { loadByok, byokReady, ownTiers, isOwnTier, isByokTier, byokEffort } from '../byok.js';
import { createThinkPanel } from '../think-panel.js';
import { loader } from '../rich-elements.js';
import { parse } from './agent.js';
import { ghExport, ghManageAccess } from './github.js';
import { KINDS } from './templates.js';
import { databaseCard, askCard, secretCard, publishCard } from './tools.js';
import { modal, confirmBox, promptBox, phoneTest, publish, invite } from './dialogs.js';

const FALLBACK_STYLES = { STYLES: [], byId: () => null, themeCss: () => '', fontsHref: () => '' };
const S = () => window.CodenStyles || FALLBACK_STYLES;
const B = () => window.CodenBundle;
const kindOf = (k) => KINDS[k] || KINDS.web;
let kitP = null;
const getKit = () => kitP || (kitP = Promise.all(['kit/coden-kit.css', 'kit/coden-kit.js'].map(u =>
    fetch(u).then(r => { if (!r.ok) throw new Error(`Kit-Datei ${u} konnte nicht geladen werden.`); return r.text(); })
)).then(([css, js]) => ({ css, js })).catch((e) => { kitP = null; throw e; }));
const TIERS = [{ id: 'ultra', label: 'Ultra', tip: 'Nur die allerbesten Modelle (nur Owner)' }, { id: 'pro', label: 'Pro', tip: 'Stärkste Modelle – am besten für Apps' }, { id: 'normal', label: 'Thinking', tip: 'Denkt länger nach' }, { id: 'flash', label: 'Flash', tip: 'Am schnellsten, für kleine Änderungen' }];
const DEVICES = { ios: { w: 393, h: 852, label: 'iPhone', icon: 'phone_iphone' }, android: { w: 412, h: 915, label: 'Android', icon: 'android' }, desktop: { w: 0, h: 0, label: 'Desktop', icon: 'desktop_windows' }, tablet: { w: 834, h: 1112, label: 'Tablet', icon: 'tablet_mac' }, phone: { w: 390, h: 844, label: 'Handy', icon: 'smartphone' }, landscape: { w: 844, h: 390, label: 'Handy quer', icon: 'stay_current_landscape' } };
const FILE_ICON = (n) => /\.html?$/.test(n) ? 'html' : /\.css$/.test(n) ? 'css' : /\.js$/.test(n) ? 'javascript' : /\.json$/.test(n) ? 'data_object' : /\.svg$/.test(n) ? 'image' : 'description';
const MAX_AUTOFIX = 3;
const AGENT_TOOLS = {
    list: ['folder_open', 'Dateien aufgelistet'],
    tree: ['account_tree', 'Projektstruktur analysiert'],
    read: ['visibility', 'Gelesen'],
    outline: ['toc', 'Gliederung gelesen'],
    search: ['search', 'Gesucht'],
    dom_map: ['hub', 'DOM-Verbindungen geprüft'],
    check: ['fact_check', 'Code geprüft'],
    move: ['drive_file_move', 'Verschoben'],
    copy: ['file_copy', 'Kopiert'],
    insert: ['playlist_add', 'Code eingefügt'],
    cdn_search: ['inventory_2', 'Bibliothek gesucht'],
    fetch: ['language', 'Webseite gelesen'],
    web_search: ['travel_explore', 'Im Web gesucht'],
    memory: ['bookmark_add', 'Projektnotiz gespeichert'],
    spawn: ['groups', 'Sub-Agenten'],
    done: ['check', 'Fertig']
};
const RESULT_META = {
    check: ['fact_check', 'Automatische Prüfung'],
    review: ['task_alt', 'Abnahme & Prüfung'],
    leg: ['replay', 'Etappen-Fortsetzung'],
    nudge: ['bolt', 'Nachbesserung'],
    apply: ['warning', 'Änderung prüfen'],
    spawn: ['groups', 'Sub-Agenten'],
    image: ['image', 'Bild-Generierung']
};
function fmtDur(ms) {
    const s = Math.max(1, Math.round((ms || 0) / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60), r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
}
function toolDetail(t) {
    const a = t.attrs || {};
    let what = a.path || a.file || a.query || a.url || a.pattern || '';
    if (t.name === 'read' && a.start) what += ` (Zeilen ${a.start}–${a.end || '…'})`;
    if (t.name === 'move' || t.name === 'copy') what = `${a.from || ''} → ${a.to || ''}`;
    if (t.name === 'insert') what = `${a.path || a.file || ''}${a.line ? ':' + a.line : a.after ? ':nach ' + a.after : ''}`;
    if (t.name === 'search' && a.pattern) what = `${a.query || t.body || ''} (${a.pattern})`;
    if (t.name === 'memory') what = (t.body || a.text || '').slice(0, 80);
    if (t.name === 'spawn') { try { const j = JSON.parse((t.body.match(/\{[\s\S]*\}/) || ['{}'])[0]); what = (j.tasks || []).map(x => x.title).filter(Boolean).join(' · '); } catch (_) { what = ''; } }
    return String(what || '').trim().slice(0, 110);
}
function cleanProse(s) {
    return String(s || '')
        .replace(/<!--\s*\(frühere Antwort:[\s\S]*?-->/gi, '')
        .replace(/<\/(?:tool|result|plan|file|edit|delete|sql)\s*>/gi, '')
        .replace(/\[Datei (geschrieben|geändert|gelöscht): ([^\]]+)\]\n?/g, '')
        .replace(/\(Geänderte Dateien:[^)]*\)/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function mountBuilder(host, appId) {
    const st = { id: appId, app: null, files: {}, members: [], messages: [], seen: new Set(), lastId: 0, version: 0, running: false, abort: null, autoFix: 0, imgRounds: 0,
        tier: localStorage.getItem('coden_app_tier') || 'pro', mode: localStorage.getItem('coden_agent_mode') || 'auto', runId: null, liveEl: null, device: null, page: 'index.html', view: 'preview', pane: 'chat', logs: [], renderErrors: [], codeFile: null, openFiles: [], dirty: false, alive: true, timers: [], live: null };
    const ns = `codenprev:${appId}:`;

    // ---------- Gerüst ----------
    const nameIn = h('input', { class: 'bl-name', maxlength: 60, spellcheck: 'false', 'aria-label': 'App-Name' });
    const badges = h('div', { class: 'bl-badges' });
    const people = h('div', { class: 'bl-people' });
    const log = h('div', { class: 'bl-log', 'aria-live': 'polite' });
    const input = h('textarea', { class: 'bl-input', rows: 1, placeholder: 'Beschreibe, was Coden bauen oder ändern soll …' });
    const sendBtn = h('button', { class: 'bl-send', title: 'Senden (Enter)' }, icon('arrow_upward'));
    const stopBtn = h('button', { class: 'bl-stop hidden', title: 'Stoppen' }, icon('stop'));
    const tierBox = h('div', { class: 'bl-tiers' });
    // Für jeden neuen Geräterahmen ein frisches iframe (ein verschobenes iframe lädt neu und bleibt teils leer)
    const makeFrame = () => { const f = h('iframe', { class: 'bl-frame', title: 'Vorschau', sandbox: 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock', allow: 'geolocation; camera; microphone; clipboard-write; fullscreen; autoplay' }); f.addEventListener('load', () => loading.classList.add('hidden')); return f; };
    let frame = null;
    const devBox = h('div', { class: 'bl-dev' });
    const canvas = h('div', { class: 'bl-canvas' }, devBox);
    const loading = h('div', { class: 'bl-loading' }, h('span', { class: 'cd-spin' }));
    const consoleBox = h('div', { class: 'bl-console hidden' });
    const consoleBtn = h('button', { class: 'bl-tbtn', title: 'Konsole' }, icon('terminal'), h('span', { class: 'bl-cnt hidden' }));
    const deviceBtns = h('div', { class: 'bl-seg' });
    const pageSel = h('select', { class: 'bl-page hidden', title: 'Seite' });
    const codeBox = h('div', { class: 'bl-code hidden' });
    const viewSeg = h('div', { class: 'bl-seg' });
    const workspace = h('div', { class: 'bl-workspace' }, canvas, codeBox);
    const stage = h('div', { class: 'bl-stage' },
        h('div', { class: 'bl-toolbar' }, viewSeg, h('span', { class: 'bl-sep' }), deviceBtns, pageSel, h('span', { class: 'grow' }),
            h('button', { type: 'button', class: 'bl-tbtn', title: 'Vorschau neu laden', 'aria-label': 'Vorschau neu laden', onclick: () => render() }, icon('refresh')), consoleBtn,
            h('button', { type: 'button', class: 'bl-tbtn', title: 'Im neuen Tab öffnen (Testlink)', 'aria-label': 'Testlink öffnen', onclick: () => st.app?.testUrl && window.open(st.app.testUrl, '_blank', 'noopener,noreferrer') }, icon('open_in_new'))),
        workspace, consoleBox);
    const paneControls = h('div', { class: 'bl-pane-ctrl' });
    const paneHead = h('div', { class: 'bl-pane-head' },
        h('div', { class: 'bl-pane-title' }, icon('build'), h('span', { text: 'Build' })),
        paneControls);
    const chat = h('div', { class: 'bl-chat' }, paneHead, log, h('div', { class: 'bl-composer' }, input, h('div', { class: 'bl-crow' }, tierBox, h('span', { class: 'grow' }), stopBtn, sendBtn)));
    const mtabs = h('div', { class: 'bl-mtabs' });
    const head = h('header', { class: 'bl-head' },
        h('button', { class: 'bl-ibtn', title: 'Zurück zu deinen Apps', onclick: () => Router.go('apps') }, icon('arrow_back')),
        h('div', { class: 'bl-title' }, nameIn, badges), people, h('span', { class: 'grow' }),
        h('button', { class: 'bl-btn', onclick: () => openInvite() }, icon('group_add'), h('span', { text: 'Einladen' })),
        h('button', { class: 'bl-btn', onclick: () => openPhone() }, icon('qr_code_2'), h('span', { text: 'Handy-Test' })),
        h('button', { class: 'bl-btn primary', id: 'bl-pub', onclick: () => openPublish() }, icon('rocket_launch'), h('span', { text: 'Veröffentlichen' })),
        h('button', { class: 'bl-ibtn', title: 'Mehr', onclick: (e) => openMenu(e.currentTarget) }, icon('more_vert')));
    const resizer = h('div', { class: 'bl-resizer', title: 'Breite ändern' });
    const root = h('div', { class: 'bl' }, head, mtabs, h('div', { class: 'bl-body' }, chat, resizer, stage));
    host.append(root);

    // Chat-Breite merken und ziehen
    const savedW = parseInt(localStorage.getItem('coden_bl_chat_w'), 10); if (savedW) chat.style.width = savedW + 'px';
    resizer.addEventListener('pointerdown', (e) => { e.preventDefault(); resizer.setPointerCapture(e.pointerId); const x0 = e.clientX, w0 = chat.offsetWidth; root.classList.add('resizing');
        const mv = (ev) => { chat.style.width = Math.max(300, Math.min(760, w0 + ev.clientX - x0)) + 'px'; fit(); };
        const up = () => { resizer.removeEventListener('pointermove', mv); resizer.removeEventListener('pointerup', up); root.classList.remove('resizing'); localStorage.setItem('coden_bl_chat_w', chat.offsetWidth); };
        resizer.addEventListener('pointermove', mv); resizer.addEventListener('pointerup', up); });

    // ---------- Laden ----------
    async function loadBuilder() {
        log.replaceChildren(h('div', { class: 'bl-empty' }, h('span', { class: 'cd-spin' })));
        try {
            const r = await apiJson('/apps/' + appId);
            if (!st.alive) return;
            setApp(r.app); st.files = r.files || {}; st.members = r.members || []; st.version = r.app.version;
            const msgs = (await apiJson(`/apps/${appId}/messages`)).messages || [];
            if (!st.alive) return;
            log.replaceChildren(); msgs.forEach(addMessage); if (!msgs.length) log.append(welcome());
            drawPeople(); drawTiers(); loadByok().then(() => { if (st.alive) drawTiers(); }).catch(() => {}); drawDevices(); drawViewSeg(); drawMobileTabs(); render(); scrollLog(true);
            const pending = sessionStorage.getItem('coden_app_prompt_' + appId);
            if (pending) { sessionStorage.removeItem('coden_app_prompt_' + appId); input.value = pending; send(); }
            else setTimeout(() => { if (st.alive) input.focus(); }, 100);
            poll();
        } catch (e) {
            if (!st.alive) return;
            const notFound = e?.status === 404 || /nicht gefunden/i.test(e?.message || '');
            root.replaceChildren(h('div', { class: 'ap-empty' },
                icon(notFound ? 'search_off' : 'cloud_off'),
                h('h2', { text: notFound ? 'App nicht gefunden' : 'App konnte nicht geladen werden' }),
                h('p', { text: e?.message || 'Verbindung zur Datenbank fehlgeschlagen.' }),
                h('div', { class: 'ap-actions' },
                    !notFound ? h('button', { type: 'button', class: 'bl-btn primary', onclick: () => { root.replaceChildren(head, mtabs, h('div', { class: 'bl-body' }, chat, resizer, stage)); loadBuilder(); } }, icon('refresh'), ' Erneut versuchen') : null,
                    h('button', { type: 'button', class: notFound ? 'bl-btn primary' : 'bl-btn', onclick: () => Router.go('apps') }, icon('arrow_back'), ' Zu deinen Apps'))));
        }
    }
    loadBuilder();

    function setApp(app) {
        if (!app) return;
        const kd = kindOf(app.kind);
        st.app = app; if (document.activeElement !== nameIn) nameIn.value = app.name;
        const ro = app.role === 'viewer'; input.disabled = ro; sendBtn.disabled = ro; nameIn.disabled = ro; if (ro) input.placeholder = 'Du darfst diese App nur ansehen (Rolle: Zuschauer).';
        if (!st.device) st.device = kd.devices[0];
        const style = S().byId(app.style);
        badges.replaceChildren(
            h('span', { class: 'bl-badge' }, icon(kd.icon), kd.label),
            h('span', { class: 'bl-dot-sep', text: '·', 'aria-hidden': 'true' }),
            h('button', { type: 'button', class: 'bl-badge btn', title: 'Stil ändern', onclick: () => changeStyle() }, icon('palette'), style ? style.name : 'Eigener Stil'),
            app.published ? h('a', { class: 'bl-badge live', href: app.url, target: '_blank', rel: 'noopener noreferrer', title: app.url }, h('i'), 'Live') : null
        );
        const pub = root.querySelector('#bl-pub span:last-child'); if (pub) pub.textContent = app.published ? 'Veröffentlicht' : 'Veröffentlichen';
        root.querySelector('#bl-pub')?.classList.toggle('done', app.published);
        document.title = app.name + ' · Coden Studio';
    }
    nameIn.addEventListener('keydown', (e) => { if (!st.app) return; if (e.key === 'Enter') nameIn.blur(); if (e.key === 'Escape') { nameIn.value = st.app.name; nameIn.blur(); } });
    nameIn.addEventListener('blur', async () => { if (!st.app) return; const n = nameIn.value.trim(); if (!n || n === st.app.name) { nameIn.value = st.app.name; return; } try { setApp((await apiJson('/apps/' + appId, { method: 'PATCH', body: JSON.stringify({ name: n }) })).app); st.version = st.app.version; toast('Umbenannt', { type: 'ok' }); } catch (e) { toast(e.message, { type: 'error' }); if (st.app) nameIn.value = st.app.name; } });

    function drawPeople() {
        people.replaceChildren(...st.members.slice(0, 5).map(m => h('span', { class: 'bl-ava' + (m.online ? ' on' : ''), title: `${m.displayName}${m.handle ? ' (@' + m.handle + ')' : ''}${m.me ? ' – du' : ''}${m.online ? ' · online' : ''}`, text: (m.displayName || '?')[0].toUpperCase() })));
        people.classList.toggle('hidden', st.members.length < 2);
    }
    function drawEffort() {
        const box = h('span', { class: 'effort-seg bl-effort', title: 'Denkaufwand' }, ...[['low', 'Niedrig'], ['medium', 'Mittel'], ['high', 'Hoch']].map(([v, l]) => h('button', { type: 'button', 'data-effort': v, text: l })));
        bindEffortButtons(box); return box;
    }
    const MODES = [['auto', 'smart_toy', 'Auto', 'Der Main Agent entscheidet selbst, ob er Sub-Agenten startet'], ['team', 'groups', 'Team', 'Der Main Agent startet immer Sub-Agenten (Layout, Logik, Spiel, Daten …) mit passendem Modell und prüft danach alles'], ['single', 'bolt', 'Solo', 'Nur der Main Agent – am schnellsten für kleine Änderungen']];
    function drawTiers() {
        const mode = h('select', { class: 'bl-mode', title: 'Agenten-Modus', onchange: (e) => { st.mode = e.target.value; localStorage.setItem('coden_agent_mode', st.mode); } }, ...MODES.map(([v, , l, tip]) => h('option', { value: v, text: (v === 'team' ? '👥 ' : v === 'single' ? '⚡ ' : '🤖 ') + l, title: tip, selected: st.mode === v })));
        const own = ownTiers();
        if (isOwnTier(st.tier) && byokReady() && !own.some(o => o.tier === st.tier)) st.tier = 'pro'; // gelöschtes eigenes Modell
        const pick = (t) => { st.tier = t; localStorage.setItem('coden_app_tier', t); drawTiers(); };
        const ownSel = own.length ? h('select', { class: 'bl-own' + (isOwnTier(st.tier) ? ' active' : ''), title: 'Eigene Modelle und Ketten (Bring your own Key)', onchange: (e) => { if (e.target.value) pick(e.target.value); } },
            h('option', { value: '', text: 'Eigene …' }), ...own.map(o => h('option', { value: o.tier, text: (o.kind === 'chain' ? '⛓ ' : '🔑 ') + o.label, selected: st.tier === o.tier || undefined }))) : null;
        const cfgBtn = h('button', { type: 'button', class: 'bl-ibtn sm', title: 'Modelle der Sub-Agenten, Ketten und Key-Plätze einstellen', 'aria-label': 'Agenten-Modelle einstellen', onclick: () => window.dispatchEvent(new CustomEvent('coden:settings', { detail: { tab: 'models', sub: 'app' } })) }, icon('tune'));
        paneControls.replaceChildren(mode, cfgBtn);
        tierBox.replaceChildren(...[...TIERS.filter(t => t.id !== 'ultra' || auth.currentUser?.isOwner).map(t => h('button', { class: 'bl-tier' + (st.tier === t.id ? ' active' : ''), title: t.tip, text: t.label, onclick: () => pick(t.id) })), ownSel, isByokTier(st.tier) ? null : drawEffort()].filter(Boolean));
    }
    const showPreview = () => st.view === 'preview' || st.view === 'split';
    const showCode = () => st.view === 'code' || st.view === 'split';
    function drawDevices() {
        if (!st.app) return;
        const list = kindOf(st.app.kind).devices; deviceBtns.classList.toggle('hidden', list.length < 2 || !showPreview());
        deviceBtns.replaceChildren(...list.map(d => h('button', { type: 'button', class: st.device === d ? 'active' : '', title: DEVICES[d].label, onclick: () => { st.device = d; drawDevices(); render(); } }, icon(DEVICES[d].icon), h('span', { text: DEVICES[d].label }))));
    }
    function drawViewSeg() {
        viewSeg.replaceChildren(...[['preview', 'visibility', 'Vorschau'], ['code', 'code', 'Code'], ['split', 'vertical_split', 'Split']].map(([v, ic, l]) => h('button', { type: 'button', class: ((st.view === v ? 'active ' : '') + (v === 'split' ? 'hide-mobile' : '')).trim(), onclick: () => setView(v) }, icon(ic), h('span', { text: l }))));
    }
    function setView(v) {
        if (showCode() && v === 'preview' && st.dirty) { saveCode(); }
        st.view = v;
        workspace.classList.toggle('split', v === 'split');
        drawViewSeg(); drawDevices();
        canvas.classList.toggle('hidden', !showPreview());
        codeBox.classList.toggle('hidden', !showCode());
        pageSel.classList.toggle('hidden', !showPreview() || pageSel.options.length < 2);
        if (showCode()) drawCode();
        if (showPreview()) render();
        setTimeout(fit, 30);
    }
    function drawMobileTabs() {
        mtabs.replaceChildren(...[['chat', 'forum', 'Chat'], ['preview', 'visibility', 'Vorschau'], ['code', 'code', 'Code']].map(([p, ic, l]) => h('button', { type: 'button', class: st.pane === p ? 'active' : '', onclick: () => { st.pane = p; root.dataset.pane = p; if (p !== 'chat') setView(p); drawMobileTabs(); } }, icon(ic), l)));
        root.dataset.pane = st.pane;
    }

    // ---------- Vorschau ----------
    const snapshot = () => { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(ns)) o[k.slice(ns.length)] = localStorage.getItem(k); } } catch (_) {} return o; };
    let renderTimer = 0, renderSeq = 0;
    function render(immediate) {
        clearTimeout(renderTimer);
        return new Promise((resolve) => { renderTimer = setTimeout(async () => { await doRender(); resolve(); }, immediate ? 0 : 60); });
    }
    async function doRender() {
        if (!st.alive || !st.app || !showPreview()) return;
        const bundle = B();
        if (!bundle) { toast('Vorschau-Modul fehlt. Bitte Seite neu laden.', { type: 'error' }); return; }
        let kit;
        try { kit = await getKit(); } catch (e) { toast(e.message || 'Vorschau konnte nicht geladen werden.', { type: 'error' }); return; }
        if (!st.alive || !st.app || !showPreview()) return;
        const style = S().byId(st.app.style);
        const platform = st.app.kind === 'web' || st.app.kind === 'game' ? 'web' : st.device === 'android' ? 'android' : 'ios';
        const b = bundle.build(st.files, { kit, themeCss: S().themeCss(style), fontsHref: S().fontsHref(style), platform });
        if (!b.pages[st.page]) st.page = b.entry;
        const pages = Object.keys(b.pages); pageSel.replaceChildren(...pages.map(p => h('option', { value: p, text: p, selected: p === st.page }))); pageSel.classList.toggle('hidden', pages.length < 2);
        drawFrame(style);
        st.renderErrors = []; st.logs = []; drawConsole(); renderSeq++;
        loading.classList.remove('hidden');
        frame.srcdoc = bundle.withStore(b.pages[st.page], snapshot());
    }
    pageSel.addEventListener('change', () => { st.page = pageSel.value; render(); });

    let frameKey = '';
    function drawFrame(style) {
        const d = DEVICES[st.device] || DEVICES.desktop; const dark = style ? !!style.v.dark : false; const bg = style && /^#/.test(style.v.bg) ? style.v.bg : (dark ? '#000' : '#fff');
        const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const url = st.app.url.replace(/^https?:\/\//, '') + (st.page !== 'index.html' ? st.page : '');
        const key = [st.device, bg, dark].join('|');
        // Rahmen nur neu bauen, wenn sich Gerät oder Stil ändern (ein verschobenes iframe lädt sonst neu)
        if (key === frameKey && frame && frame.isConnected) {
            const t = devBox.querySelector('.bl-status b'); if (t) t.textContent = time;
            const u = devBox.querySelector('.bl-url span:last-child'); if (u) u.textContent = url;
            return false;
        }
        frameKey = key; frame = makeFrame();
        devBox.className = 'bl-dev ' + st.device;
        if (st.device === 'ios' || st.device === 'android' || st.device === 'phone') {
            const ios = st.device !== 'android';
            devBox.replaceChildren(h('div', { class: 'bl-phone ' + (ios ? 'ios' : 'android'), style: { width: d.w + 'px', height: d.h + 'px' } },
                h('div', { class: 'bl-screen', style: { background: bg } },
                    h('div', { class: 'bl-status' + (dark ? ' dark' : ''), style: { background: bg } }, h('b', { text: time }), ios ? h('i', { class: 'bl-island' }) : h('i', { class: 'bl-punch' }), h('span', {}, icon('signal_cellular_alt'), icon('wifi'), icon(ios ? 'battery_full' : 'battery_5_bar'))),
                    h('div', { class: 'bl-viewport' }, frame, loading),
                    ios ? h('div', { class: 'bl-home', style: { background: bg } }, h('i', { class: dark ? 'dark' : '' })) : h('div', { class: 'bl-nav' }, h('i'), h('i'), h('i')))));
        } else {
            devBox.replaceChildren(h('div', { class: 'bl-browser', style: d.w ? { width: d.w + 'px', height: d.h + 'px' } : {} },
                h('div', { class: 'bl-bbar' }, h('span', { class: 'bl-dots' }, h('i'), h('i'), h('i')), h('div', { class: 'bl-url' }, icon('lock'), h('span', { text: url }))),
                h('div', { class: 'bl-viewport' }, frame, loading)));
        }
        fit();
        return true;
    }
    function fit() {
        const el = devBox.firstElementChild; if (!el || st.device === 'desktop') { if (el) { el.style.transform = ''; devBox.style.width = devBox.style.height = ''; } return; }
        const pad = 28; const aw = canvas.clientWidth - pad, ah = canvas.clientHeight - pad;
        const w = el.offsetWidth, hh = el.offsetHeight; if (!w || !hh || aw <= 0 || ah <= 0) return;
        const s = Math.min(1, aw / w, ah / hh); el.style.transform = `scale(${s})`; el.style.transformOrigin = 'top left';
        devBox.style.width = w * s + 'px'; devBox.style.height = hh * s + 'px';
    }
    const ro = new ResizeObserver(() => fit()); ro.observe(canvas);

    // Nachrichten aus der Vorschau (Fehler, Konsole, Seitenwechsel, Speicher)
    const onMsg = (e) => {
        if (!st.alive || !frame || e.source !== frame.contentWindow || !e.data || e.data.__coden !== 1) return; const m = e.data;
        if (m.t === 'error') { const msg = `${String(m.message || 'Unbekannter Fehler')}${m.line ? ` (Zeile ${m.line})` : ''}`; st.renderErrors.push(msg); st.logs.push({ level: 'error', text: msg }); drawConsole(); }
        else if (m.t === 'console') { st.logs.push({ level: m.level, text: String(m.text ?? '') }); if (st.logs.length > 200) st.logs.shift(); if (m.level === 'error') st.renderErrors.push(String(m.text ?? '')); drawConsole(); }
        else if (m.t === 'nav') { const p = String(m.page || '').replace(/^\.?\//, ''); st.page = p || 'index.html'; render(); }
        else if (m.t === 'store') {
            if (typeof m.k !== 'string' || !m.k || m.k.length > 200) return;
            try { if (m.v === null) localStorage.removeItem(ns + m.k); else if (String(m.v).length < 400000) localStorage.setItem(ns + m.k, String(m.v)); } catch (_) {}
        }
        else if (m.t === 'store-clear') { Object.keys(snapshot()).forEach(k => localStorage.removeItem(ns + k)); }
        else if (m.t === 'ready') loading.classList.add('hidden');
    };
    window.addEventListener('message', onMsg);

    function drawConsole() {
        const errs = st.logs.filter(l => l.level === 'error').length; const cnt = consoleBtn.querySelector('.bl-cnt');
        cnt.textContent = errs || st.logs.length; cnt.classList.toggle('hidden', !st.logs.length); cnt.classList.toggle('err', !!errs);
        if (consoleBox.classList.contains('hidden')) return;
        consoleBox.replaceChildren(h('div', { class: 'bl-chead' }, h('b', { text: 'Konsole' }), h('span', { class: 'grow' }),
            errs ? h('button', { class: 'bl-btn sm', onclick: () => { const t = st.logs.filter(l => l.level === 'error').map(l => '- ' + l.text).join('\n'); consoleBox.classList.add('hidden'); runUser(`In der Vorschau gibt es diese Fehler. Bitte finde die Ursache und behebe sie:\n${t}`); } }, icon('auto_fix_high'), ' Coden beheben lassen') : null,
            h('button', { class: 'bl-btn sm', title: 'Gespeicherte Daten der Vorschau löschen', onclick: () => { Object.keys(snapshot()).forEach(k => localStorage.removeItem(ns + k)); toast('Daten der Vorschau gelöscht'); render(); } }, icon('delete_sweep'), ' Daten zurücksetzen'),
            h('button', { class: 'bl-tbtn', onclick: () => { consoleBox.classList.add('hidden'); } }, icon('close'))),
            h('div', { class: 'bl-clines' }, st.logs.length ? st.logs.map(l => h('div', { class: 'bl-cl ' + l.level, text: l.text })) : h('div', { class: 'bl-cl muted', text: 'Keine Ausgaben. console.log aus deiner App erscheint hier.' })));
        const lines = consoleBox.querySelector('.bl-clines'); lines.scrollTop = lines.scrollHeight;
    }
    consoleBtn.addEventListener('click', () => { consoleBox.classList.toggle('hidden'); drawConsole(); });

    // ---------- Code-Ansicht (AI Studio-Stil mit Dateibaum, Tabs & Zeilennummern) ----------
    const editor = h('textarea', { class: 'bl-editor', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off' });
    const gutter = h('div', { class: 'bl-lines', 'aria-hidden': 'true' });
    const lineMeta = h('small', { class: 'bl-clines-cnt' });
    const codeStatus = h('small', { class: 'bl-cstatus' });
    const updateLines = () => {
        const count = Math.max(1, editor.value.split('\n').length);
        lineMeta.textContent = `${count} ${count === 1 ? 'Zeile' : 'Zeilen'}`;
        if (gutter.childElementCount !== count) {
            gutter.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
        }
    };
    editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });
    editor.addEventListener('input', () => { st.dirty = true; codeStatus.textContent = 'Nicht gespeichert'; updateLines(); if (st.view === 'split') { clearTimeout(splitSyncTimer); splitSyncTimer = setTimeout(() => { if (st.codeFile) { st.files[st.codeFile] = editor.value; render(true); } }, 450); } });
    let splitSyncTimer = 0;
    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') { e.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); st.dirty = true; updateLines(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCode(); }
    });
    async function saveCode() {
        if (!st.dirty || !st.codeFile) return; const name = st.codeFile, content = editor.value;
        try { await saveFiles({ [name]: content }, []); st.files[name] = content; st.dirty = false; codeStatus.textContent = 'Gespeichert'; toast(`${name} gespeichert`, { type: 'ok', ms: 1500 }); if (showPreview()) render(true); drawCode(); }
        catch (e) { toast(e.message, { type: 'error' }); }
    }
    const openFile = async (n) => {
        if (st.codeFile === n) return;
        if (st.dirty) await saveCode();
        st.codeFile = n; st.dirty = false;
        if (!st.openFiles.includes(n)) st.openFiles.push(n);
        drawCode();
    };
    function drawCode() {
        const names = Object.keys(st.files).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
        if (!st.codeFile || !(st.codeFile in st.files)) { st.codeFile = names[0] || null; st.dirty = false; }
        st.openFiles = st.openFiles.filter(f => f in st.files);
        if (st.codeFile && !st.openFiles.includes(st.codeFile)) st.openFiles.push(st.codeFile);
        if (!st.dirty && st.codeFile) { editor.value = st.files[st.codeFile]; updateLines(); }
        const list = h('div', { class: 'bl-files' }, h('div', { class: 'bl-fhead' }, h('b', { text: 'Dateien' }), h('button', { class: 'bl-tbtn', title: 'Neue Datei', onclick: async () => {
            const n = await promptBox('Neue Datei', { label: 'Dateiname', placeholder: 'z. B. daten.js, kontakt.html, logo.svg', ok: 'Anlegen' }); if (!n) return;
            if (!/^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.\-\/]{0,99}$/.test(n)) return toast('Ungültiger Dateiname', { type: 'error' });
            if (n in st.files) return toast('Die Datei gibt es schon', { type: 'warn' });
            try { await saveFiles({ [n]: '' }, []); st.files[n] = ''; st.codeFile = n; st.dirty = false; if (!st.openFiles.includes(n)) st.openFiles.push(n); drawCode(); } catch (e) { toast(e.message, { type: 'error' }); }
        } }, icon('note_add'))),
        ...names.map(n => h('div', { class: 'bl-file' + (n === st.codeFile ? ' active' : ''), onclick: () => openFile(n) },
            icon(FILE_ICON(n)), h('span', { class: 'grow', text: n }), h('small', { text: (st.files[n].length / 1024).toFixed(1) + ' KB' }),
            names.length > 1 ? h('button', { class: 'bl-x', title: 'Löschen', onclick: async (e) => { e.stopPropagation(); if (!(await confirmBox(`${n} löschen?`, { ok: 'Löschen', danger: true }))) return; try { await saveFiles({}, [n]); delete st.files[n]; st.openFiles = st.openFiles.filter(f => f !== n); if (st.codeFile === n) st.codeFile = null; st.dirty = false; drawCode(); if (showPreview()) render(true); } catch (er) { toast(er.message, { type: 'error' }); } } }, icon('delete')) : null)));
        const tabs = h('div', { class: 'bl-tabs' }, ...st.openFiles.map(n => h('div', { class: 'bl-tab' + (n === st.codeFile ? ' active' : ''), onclick: () => openFile(n) },
            icon(FILE_ICON(n)), h('span', { text: n }), n === st.codeFile && st.dirty ? h('i', { class: 'bl-tab-dirty', title: 'Ungespeichert' }) : null,
            st.openFiles.length > 1 ? h('button', { type: 'button', class: 'bl-tab-x', title: 'Tab schließen', onclick: async (e) => { e.stopPropagation(); if (n === st.codeFile && st.dirty) await saveCode(); st.openFiles = st.openFiles.filter(f => f !== n); if (st.codeFile === n) { st.codeFile = st.openFiles[0] || names[0] || null; st.dirty = false; } drawCode(); } }, icon('close')) : null)));
        codeBox.replaceChildren(list, h('div', { class: 'bl-ecol' },
            tabs,
            h('div', { class: 'bl-ebar' }, icon(FILE_ICON(st.codeFile || '')), h('b', { text: st.codeFile || '–' }), lineMeta, codeStatus, h('span', { class: 'grow' }),
                h('button', { class: 'bl-btn sm', title: 'Kopieren', onclick: async () => { if (await copy(editor.value)) toast('Kopiert', { type: 'ok', ms: 1200 }); } }, icon('content_copy')),
                h('button', { class: 'bl-btn sm primary', onclick: saveCode }, icon('save'), ' Speichern')),
            h('div', { class: 'bl-codewrap' }, gutter, editor)));
        if (!st.dirty) codeStatus.textContent = '';
    }

    // ---------- Speichern & Nachrichten ----------
    async function saveFiles(set, remove) {
        const r = await apiJson(`/apps/${appId}/files`, { method: 'PUT', body: JSON.stringify({ set, remove }) });
        st.version = Math.max(st.version, r.version); return r;
    }
    async function postMessage(role, body, meta = {}) {
        const r = await apiJson(`/apps/${appId}/messages`, { method: 'POST', body: JSON.stringify({ role, body, meta }) });
        return r.message;
    }

    function welcome() {
        const kind = kindOf(st.app?.kind);
        const ideas = st.app?.kind === 'game' ? ['Füge Level mit steigender Schwierigkeit und einen Bossgegner hinzu', 'Mach Power-ups: Schild, Doppelsprung, Magnet', 'Gestalte alles im Pixel-Art-Stil mit Retro-Sound'] : st.app?.kind === 'web' ? ['Eine Webseite für mein Café mit Speisekarte und Öffnungszeiten', 'Ein Portfolio mit meinen Projekten und Kontaktformular', 'Eine Landingpage für meine App mit Preisen'] : ['Eine To-do-App mit Kategorien und Erinnerungen', 'Ein Habit-Tracker mit Statistiken', 'Eine Rezept-App mit Favoriten und Einkaufsliste'];
        return h('div', { class: 'bl-welcome' }, h('div', { class: 'bl-wicon' }, icon(kind.icon)), h('h3', { text: 'Was soll ' + (st.app?.name || 'deine App') + ' können?' }),
            h('p', { text: 'Coden baut die App direkt hier – du siehst rechts jede Änderung live. Je genauer du beschreibst, desto besser.' }),
            h('div', { class: 'bl-ideas' }, ideas.map(t => h('button', { class: 'bl-idea', onclick: () => { input.value = t; autoGrow(); input.focus(); } }, icon('lightbulb'), h('span', { text: t })))));
    }
    const scrollLog = (force) => { const near = log.scrollHeight - log.scrollTop - log.clientHeight < 160; if (force || near) log.scrollTop = log.scrollHeight; };

    // Werkzeug-Antworten: welches Werkzeug (Nachricht + Index) ist schon beantwortet?
    const answers = () => { const a = {}; for (const m of st.messages) if (m.role === 'tool' && m.meta?.toolFor) a[m.meta.toolFor] = m.meta.display || 'Beantwortet'; return a; };
    function addMessage(m) {
        if (st.seen.has(m.id)) return; st.seen.add(m.id); st.lastId = Math.max(st.lastId, m.id); st.messages.push(m);
        log.querySelector('.bl-welcome')?.remove();
        const node = renderMessage(m);
        const anchor = st.liveEl?.isConnected ? st.liveEl : log.querySelector('.bl-loading-row');
        if (anchor) log.insertBefore(node, anchor); else log.append(node);
        scrollLog(m.mine);
        if (m.role === 'tool' && m.meta?.toolFor) { const el = log.querySelector(`[data-mid="${m.meta.toolFor.split(':')[0]}"]`); if (el) el.replaceWith(renderMessage(st.messages.find(x => x.id === +m.meta.toolFor.split(':')[0]))); }
    }
    function who(m) { return m.mine ? null : (m.handle ? '@' + m.handle : 'Mitglied'); }
    function renderMessage(m) {
        if (m.role === 'event') return h('div', { class: 'bl-event', 'data-mid': m.id }, icon(m.meta?.icon || 'info'), h('span', { text: m.body }));
        if (m.role === 'user') return h('div', { class: 'bl-msg user' + (m.mine ? ' mine' : ''), 'data-mid': m.id }, who(m) ? h('small', { text: who(m) }) : null, h('div', { class: 'bl-bubble', text: m.body }));
        if (m.role === 'tool' && m.meta?.auto) return h('div', { class: 'bl-event', 'data-mid': m.id }, icon('troubleshoot'), h('span', { text: m.meta.display || 'Automatische Prüfung' }));
        if (m.role === 'tool') return h('div', { class: 'bl-msg user tool' + (m.mine ? ' mine' : ''), 'data-mid': m.id }, who(m) ? h('small', { text: who(m) }) : null, h('div', { class: 'bl-bubble', text: m.meta?.display || 'Antwort gesendet' }));
        const el = h('div', { class: 'bl-msg ai', 'data-mid': m.id }, h('div', { class: 'bl-aava' }, h('img', { src: './images/coden_logo.jpg', alt: '' })));
        const body = h('div', { class: 'bl-abody' }); el.append(body);
        fillAssistant(body, m.body, { meta: m.meta || {}, msgId: m.id, final: true });
        return el;
    }

    const openFileInCode = (path) => {
        if (!path || !(path in st.files)) return;
        st.codeFile = path; st.dirty = false;
        if (!st.openFiles.includes(path)) st.openFiles.push(path);
        if (window.innerWidth <= 900) { st.pane = 'code'; drawMobileTabs(); setView('code'); }
        else setView(st.view === 'split' ? 'split' : 'code');
    };

    const statusBadge = (status) => {
        if (status === 'run') return h('span', { class: 'bl-ah-st run', title: 'Läuft' }, h('span', { class: 'cd-spin xs' }));
        if (status === 'wait') return h('span', { class: 'bl-ah-st wait', title: 'Wartet' }, icon('schedule'));
        if (status === 'error') return h('span', { class: 'bl-ah-st err', title: 'Problem' }, icon('error'));
        if (status === 'warn') return h('span', { class: 'bl-ah-st warn', title: 'Hinweis' }, icon('info'));
        return h('span', { class: 'bl-ah-st ok', title: 'Erledigt' }, icon('check_circle'));
    };

    // Zeichnet eine Coden-Antwort im Stil von Google AI Studio Build (Aktionsverlauf + knappe Zusammenfassung)
    function fillAssistant(body, text, { meta = {}, msgId = null, final = false } = {}) {
        const p = parse(text); const done = answers(); const frag = [];
        const wasOpen = body.querySelector('.bl-ah')?.open;
        if (body.firstElementChild && !body.firstElementChild._sig) body.replaceChildren();

        const proseSegs = [], sqlSegs = [], uiTools = [], actionItems = [];
        const pendingByName = new Map();
        const liveFilesMap = new Map();
        const lastPlanIdx = p.segs.reduce((k, x, i) => x.kind === 'plan' ? i : k, -1);
        let latestPlan = null, ti = 0;

        for (const [si, s] of p.segs.entries()) {
            if (s.kind === 'text') {
                const cleaned = cleanProse(s.text);
                if (cleaned) proseSegs.push(cleaned);
            } else if (s.kind === 'op') {
                liveFilesMap.set(s.op.path, {
                    path: s.op.path,
                    type: s.op.type === 'delete' ? 'delete' : s.op.type === 'edit' ? 'edit' : 'write',
                    lines: s.op.type === 'file' ? s.op.content.split('\n').length : null,
                    status: s.op.closed ? 'done' : 'run'
                });
            } else if (s.kind === 'plan') {
                if (si === lastPlanIdx && s.plan?.items?.length) latestPlan = s.plan;
            } else if (s.kind === 'sql') {
                sqlSegs.push(s.sql);
            } else if (s.kind === 'tool' && AGENT_TOOLS[s.tool.name]) {
                if (s.tool.name === 'done') continue;
                const [ic, label] = AGENT_TOOLS[s.tool.name];
                const what = toolDetail(s.tool);
                const item = { icon: ic, label: what ? `${label}:` : label, code: what, detail: '', status: final ? 'done' : 'run' };
                actionItems.push(item);
                if (!pendingByName.has(s.tool.name)) pendingByName.set(s.tool.name, []);
                pendingByName.get(s.tool.name).push(item);
            } else if (s.kind === 'tool' && s.tool.name === 'image') {
                const item = { icon: 'image', label: 'Bild' + (s.tool.id ? ` (${s.tool.id})` : ''), code: (s.tool.prompt || '').slice(0, 60), detail: '', status: final ? 'done' : 'run' };
                actionItems.push(item);
                if (!pendingByName.has('image')) pendingByName.set('image', []);
                pendingByName.get('image').push(item);
            } else if (s.kind === 'result') {
                const queue = pendingByName.get(s.name);
                const matched = queue?.shift();
                if (matched) {
                    matched.status = s.ok ? 'done' : 'error';
                    if (s.text) matched.detail = s.text;
                } else {
                    const [ic, lbl] = RESULT_META[s.name] || ['check_circle', s.name];
                    actionItems.push({
                        icon: ic,
                        label: lbl,
                        code: '',
                        detail: s.text || '',
                        status: s.ok ? 'done' : (s.name === 'nudge' ? 'warn' : 'error')
                    });
                }
            } else if (s.kind === 'tool') {
                uiTools.push({ tool: s.tool, key: msgId ? `${msgId}:${ti++}` : null });
            }
        }

        // Dateiliste (bevorzugt meta.changed bei fertiger Antwort; Fallback auf Live-Ops oder gekürzte Marker)
        let filesList = [];
        if (final && meta.changed?.length) {
            filesList = meta.changed.filter(c => c.type !== 'same').map(c => ({ path: c.path, type: c.type, status: 'done' }));
        } else if (liveFilesMap.size) {
            filesList = [...liveFilesMap.values()];
        } else if (final) {
            const mList = [...String(text || '').matchAll(/\[Datei (geschrieben|geändert|gelöscht): ([^\]]+)\]/g)];
            const seenF = new Map();
            mList.forEach(x => seenF.set(x[2], { path: x[2], type: x[1] === 'gelöscht' ? 'delete' : x[1] === 'geändert' ? 'edit' : 'write', status: 'done' }));
            filesList = [...seenF.values()];
        }
        const editableFiles = filesList.filter(f => f.type !== 'delete' && (f.path in st.files));
        const subAgents = (meta.agents || []).filter((a, idx) => idx > 0 || (meta.agents || []).length > 1);

        // 1) Kopfzeile (Modell • Laufzeit)
        const durMs = meta.durationMs ?? (meta.startedAt ? Math.max(0, Date.now() - (Date.parse(meta.startedAt) || meta.startedAt || Date.now())) : null);
        if (meta.model || durMs != null || filesList.length || actionItems.length || subAgents.length) {
            const headParts = [];
            if (meta.model) headParts.push(h('span', { text: meta.model }));
            if (durMs != null) {
                if (headParts.length) headParts.push(h('span', { class: 'bl-runhead-dot', text: '•' }));
                headParts.push(h('span', { class: 'bl-runhead-dur', text: (final ? 'Laufzeit ' : 'Läuft · ') + fmtDur(durMs) }));
            }
            if (headParts.length) frag.push(sig('runhead:' + (final ? 1 : 0), h('div', { class: 'bl-runhead' }, ...headParts)));
        }

        // 2) Einheitliche "Aktionsverlauf"-Karte (wie Google AI Studio Build)
        const hasHistory = filesList.length || actionItems.length || latestPlan || subAgents.length > 1;
        if (hasHistory) {
            const ahBody = h('div', { class: 'bl-ah-body' }, h('div', { class: 'bl-ah-sub', text: 'Hier sind die wichtigsten Schritte für deine App:' }));

            if (filesList.length) {
                const nNew = filesList.filter(f => f.type === 'new').length;
                const nAll = filesList.length;
                const fileTitle = nNew === nAll ? `${nAll} Datei${nAll > 1 ? 'en' : ''} erstellt` : `${nAll} Datei${nAll > 1 ? 'en' : ''} bearbeitet`;
                ahBody.append(h('div', { class: 'bl-ah-group' },
                    h('div', { class: 'bl-ah-ghead' }, icon('edit'), h('span', { text: fileTitle })),
                    ...filesList.map(f => {
                        const clickable = final && f.type !== 'delete' && (f.path in st.files);
                        return h(clickable ? 'button' : 'div', {
                            type: clickable ? 'button' : undefined,
                            class: 'bl-ah-row' + (clickable ? ' tap' : ''),
                            title: clickable ? 'Im Code ansehen' : undefined,
                            onclick: clickable ? () => openFileInCode(f.path) : undefined
                        },
                        h('code', { class: 'bl-ah-path', text: f.path }),
                        f.lines ? h('small', { class: 'bl-ah-meta', text: f.lines + ' Z.' }) : null,
                        statusBadge(f.status));
                    })
                ));
            }

            if (subAgents.length > 1) {
                const doneSub = subAgents.filter(a => a.status === 'done').length;
                ahBody.append(h('div', { class: 'bl-ah-group' },
                    h('div', { class: 'bl-ah-ghead' }, icon('groups'), h('span', { text: `Agenten-Team (${doneSub}/${subAgents.length})` })),
                    ...subAgents.map(a => h('div', { class: 'bl-ah-row' },
                        h('span', { class: 'bl-ah-lbl', text: a.title }),
                        a.tier ? h('em', { class: 'bl-ah-tier', text: a.tier }) : null,
                        statusBadge(a.status)))
                ));
            }

            if (latestPlan) {
                const doneP = latestPlan.items.filter(x => x.done).length;
                ahBody.append(h('div', { class: 'bl-ah-group' },
                    h('div', { class: 'bl-ah-ghead' }, icon('checklist'), h('span', { text: `Plan (${doneP}/${latestPlan.items.length})` })),
                    ...latestPlan.items.map(it => h('div', { class: 'bl-ah-row' + (it.done ? ' done' : '') },
                        h('span', { class: 'bl-ah-lbl', text: it.text }),
                        statusBadge(it.done ? 'done' : 'wait')))
                ));
            }

            if (actionItems.length) {
                ahBody.append(h('div', { class: 'bl-ah-group' },
                    h('div', { class: 'bl-ah-ghead' }, icon('terminal'), h('span', { text: `Schritte & Prüfungen (${actionItems.length})` })),
                    ...actionItems.map(it => h('div', { class: 'bl-ah-row' },
                        icon(it.icon),
                        h('div', { class: 'bl-ah-main' },
                            h('span', { class: 'bl-ah-lbl', text: it.label }),
                            it.code ? h('code', { class: 'bl-ah-code', text: it.code }) : null,
                            it.detail ? h('small', { class: 'bl-ah-det', text: it.detail }) : null
                        ),
                        statusBadge(it.status)))
                ));
            }

            const totalCount = filesList.length + actionItems.length + (latestPlan ? 1 : 0);
            const footLabel = !final ? 'Wird gebaut …' : (filesList.length ? 'Gebaut' : 'Geprüft');
            const detailsEl = h('details', { class: 'bl-ah', open: wasOpen !== false ? true : undefined },
                h('summary', { class: 'bl-ah-head' },
                    icon('list_alt'),
                    h('b', { text: 'Aktionsverlauf' }),
                    h('span', { class: 'bl-ah-cnt', text: `${totalCount} ${totalCount === 1 ? 'Aktion' : 'Aktionen'}` }),
                    h('span', { class: 'material-symbols-outlined bl-ah-chev', text: 'expand_more' })),
                ahBody,
                h('div', { class: 'bl-ah-foot' }, icon(final ? 'build' : 'progress_activity'), h('span', { text: footLabel }))
            );
            frag.push(sig('ah:' + (final ? 'final' : 'live') + ':' + filesList.length + ':' + actionItems.length + ':' + (latestPlan ? 1 : 0), detailsEl));
        }

        // 3) Kompakte Zusammenfassung / Antworttext
        const proseText = proseSegs.join('\n\n');
        if (proseText) {
            const sum = md(proseText); sum.classList.add('bl-summary');
            frag.push(sum);
        }

        // 4) SQL-Blöcke
        for (const s of sqlSegs) {
            frag.push(h('div', { class: 'bl-sql' }, h('div', { class: 'bl-sqlh' }, icon('database'), h('b', { text: 'SQL' }), h('span', { class: 'grow' }),
                h('button', { class: 'bl-btn sm', onclick: async () => { if (await copy(s.code)) toast('SQL kopiert – füge es im SQL-Editor ein', { type: 'ok' }); } }, icon('content_copy'), ' Kopieren'),
                st.app?.integrations?.database?.provider === 'supabase' ? h('a', { class: 'bl-btn sm', href: 'https://supabase.com/dashboard/project/' + ((st.app.integrations.database.url || '').match(/https:\/\/([a-z0-9-]+)\./)?.[1] || '') + '/sql/new', target: '_blank', rel: 'noopener noreferrer' }, icon('open_in_new'), ' SQL-Editor') : null),
                h('pre', {}, h('code', { class: 'language-sql', text: s.code }))));
        }

        // 5) Interaktive Werkzeuge (Datenbank, Rückfrage, Key, Veröffentlichen)
        for (const { tool, key } of uiTools) {
            const ans = key ? done[key] : null;
            if (!final) { frag.push(sig('tool:' + tool.name, h('div', { class: 'bl-op busy' }, icon('build'), h('span', { text: 'Werkzeug wird vorbereitet: ' + tool.name })))); continue; }
            const onAnswer = (a) => answerTool(key, a);
            if (tool.name === 'database') frag.push(databaseCard(tool, { answered: ans, onAnswer, current: st.app?.integrations?.database }));
            else if (tool.name === 'ask') frag.push(askCard(tool, { answered: ans, onAnswer }));
            else if (tool.name === 'secret') frag.push(secretCard(tool, { answered: ans, onAnswer }));
            else if (tool.name === 'publish') frag.push(publishCard(tool, { published: st.app?.published, onPublish: () => openPublish() }));
        }

        // 6) Fußleiste ("Änderungen ansehen") + autoFix Hinweis
        if (final && editableFiles.length) {
            frag.push(h('div', { class: 'bl-ah-actions' },
                h('button', { type: 'button', class: 'bl-viewchg', onclick: () => openFileInCode(editableFiles[0].path) },
                    icon('code'), h('span', { text: 'Änderungen ansehen' })),
                meta.auto ? h('small', { class: 'bl-meta', text: 'automatische Korrektur' }) : null
            ));
        } else if (final && meta.auto) {
            frag.push(h('small', { class: 'bl-meta', text: 'automatische Korrektur' }));
        }
        if (!frag.length && !final) frag.push(loader({ size: 20 }));
        reconcile(body, frag);
    }

    // Stabile Signatur für Karten, die sich beim Streamen nur im Detail ändern (z. B. Dauer)
    function sig(key, node) { node._sig = key; return node; }
    // Aktualisiert nur, was sich wirklich geändert hat – so flackern fertige Karten nicht mehr
    function reconcile(body, frag) {
        const nodes = [];
        frag.forEach((n, i) => {
            const o = body.children[i]; const k = n._sig || n.outerHTML;
            if (o && o._sig === k && n._sig?.startsWith('runhead:')) {
                const d1 = o.querySelector('.bl-runhead-dur'), d2 = n.querySelector('.bl-runhead-dur');
                if (d1 && d2 && d1.textContent !== d2.textContent) d1.textContent = d2.textContent;
                if (o.children.length === n.children.length) { nodes.push(o); return; }
            }
            if (o && o._sig === k && !n._sig?.startsWith('ah:')) {
                nodes.push(o);
            } else { n._sig = k; nodes.push(n); }
        });
        nodes.forEach((n, i) => { if (body.children[i] !== n) body.insertBefore(n, body.children[i] || null); });
        while (body.children.length > nodes.length) body.lastElementChild.remove();
    }

    async function answerTool(key, a) {
        try {
            if (a.integrations) {
                let integ = a.integrations;
                if (a.mergeSecrets) integ = { secrets: { ...(st.app.integrations?.secrets || {}), ...a.integrations.secrets } };
                setApp((await apiJson('/apps/' + appId, { method: 'PATCH', body: JSON.stringify({ integrations: integ }) })).app); st.version = st.app.version;
            }
            const msg = await postMessage('tool', a.body, { toolFor: key, display: a.display });
            addMessage(msg);
            runAgent();
        } catch (e) { toast(e.message, { type: 'error' }); }
    }

    // ---------- Agent (läuft auf dem Server – baut weiter, auch wenn die Seite zu ist) ----------
    function setBusy(on) { st.running = on; stopBtn.classList.toggle('hidden', !on); sendBtn.classList.toggle('hidden', on); root.classList.toggle('busy', on); }
    const stopAgent = () => apiJson(`/apps/${appId}/agent/stop`, { method: 'POST', body: '{}' }).catch(() => {}); // stoppt den Lauf auf dem Server (für alle)
    stopBtn.addEventListener('click', stopAgent);

    // Live-Ansicht eines Agenten-Laufs: Denk-Anzeige + Echtzeit-Aktionsverlauf im Google AI Studio Stil
    function liveView(startedAt) {
        const el = h('div', { class: 'bl-msg ai streaming' }, h('div', { class: 'bl-aava' }, h('img', { src: './images/coden_logo.jpg', alt: '' })));
        const col = h('div', { class: 'bl-abody' }); el.append(col);
        const t0 = Date.parse(startedAt) || Date.now();
        const panel = createThinkPanel({ startedAt: t0, label: 'Coden arbeitet …' });
        const body = h('div', { class: 'bl-livebody' });
        col.append(panel.el, body); log.append(el); st.liveEl = el; scrollLog(true);
        let text = '', raf = 0, lastPaint = 0, tick = null, agents = [], currentModel = '', thinkGone = false;
        const paint = () => {
            raf = 0; lastPaint = Date.now();
            fillAssistant(body, text, { meta: { model: currentModel, agents, startedAt: t0 }, final: false });
            scrollLog();
        };
        tick = setInterval(() => {
            const dur = body.querySelector('.bl-runhead-dur');
            if (dur) dur.textContent = 'Läuft · ' + fmtDur(Date.now() - t0);
        }, 1000);
        return {
            text: () => text,
            set(t) { text = t; if (text.trim() && !thinkGone) panel.done(); if (!raf) raf = setTimeout(paint, Math.max(0, 120 - (Date.now() - lastPaint))); },
            think: (k) => { if (!thinkGone) panel.think(k); },
            model: (m) => { currentModel = m || ''; if (!thinkGone) panel.model(m); },
            agents(list) { agents = list || []; if (agents.length >= 2 && !thinkGone) { thinkGone = true; panel.remove(); } if (!raf) raf = setTimeout(paint, 40); },
            remove() { clearTimeout(raf); clearInterval(tick); panel.remove(); el.remove(); if (st.liveEl === el) st.liveEl = null; }
        };
    }
    async function readSse(res, on) {
        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
        for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
            let i; while ((i = buf.indexOf('\n\n')) !== -1) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (line.startsWith('data: ')) { try { on(JSON.parse(line.slice(6))); } catch (_) {} } } }
    }
    // Einem laufenden Lauf per Abfrage folgen (nach Neuladen, anderem Gerät oder abgerissener Verbindung)
    async function follow(runId, view, from = 0) {
        let text = view.text(), sig = '', wait = 800;
        for (;;) {
            if (!st.alive) return 'gone';
            let r; try { r = await apiJson(`/apps/${appId}/agent?run=${runId}&from=${text.length}`); wait = document.hidden ? 2500 : 900; } catch (_) { await sleep(wait = Math.min(wait * 1.6, 8000)); continue; }
            if (!r.id) return 'gone';
            if (r.from === text.length && r.len >= text.length) { if (r.text) { text += r.text; view.set(text); } }
            else { text = (await apiJson(`/apps/${appId}/agent?run=${runId}`)).text || ''; view.set(text); }
            if (r.think?.h) view.think({ h: r.think.h, v: r.think.v, steps: r.think.steps });
            if (r.model) view.model(r.model);
            const s2 = JSON.stringify(r.agents || []); if (s2 !== sig) { sig = s2; view.agents(r.agents); }
            pollNow();
            if (r.status !== 'running') return r.status;
            await sleep(wait);
        }
    }
    function showBuilderLoading(label = 'Coden startet …') {
        let row = log.querySelector('.bl-loading-row');
        if (!row) {
            row = h('div', { class: 'bl-loading-row' },
                loader({ size: 28 }),
                h('span', { class: 'loading-text', text: label }));
            log.append(row);
        } else {
            const t = row.querySelector('.loading-text');
            if (t) t.textContent = label;
        }
        scrollLog(true);
        return row;
    }
    function hideBuilderLoading() {
        log.querySelectorAll('.bl-loading-row').forEach(el => el.remove());
    }

    async function runAgent({ attach, force = false } = {}) {
        if ((!force && st.running) || !st.alive) return;
        setBusy(true);
        const ac = new AbortController(); st.abort = ac;
        let view = null, runId = attach?.id || null, status = null, err = null;
        if (!attach) showBuilderLoading('Coden startet …');
        const ensureView = (startedAt) => {
            if (!view) {
                hideBuilderLoading();
                view = liveView(startedAt);
            }
            return view;
        };
        try {
            if (attach) {
                status = await follow(runId, ensureView(attach.startedAt));
            } else {
                const res = await apiFetch(`/apps/${appId}/agent`, { method: 'POST', signal: ac.signal, body: JSON.stringify({ tier: st.tier, effort: isByokTier(st.tier) ? byokEffort(st.tier) : getEffort(), mode: st.mode }) });
                if (res.status === 409) { const d = await res.json().catch(() => ({})); if (d.runId) { runId = d.runId; status = await follow(runId, ensureView()); } else throw new Error(d.error || 'Coden arbeitet schon.'); }
                else if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'HTTP ' + res.status); }
                else {
                    let text = '';
                    try {
                        await readSse(res, (ev) => {
                            if (ev.t === 'run') { runId = ev.id; st.runId = runId; }
                            else if (ev.t === 'd') { text += ev.v; ensureView().set(text); }
                            else if (ev.t === 'r') { text = ev.v; ensureView().set(text); pollNow(); }
                            else if (ev.t === 'k') ensureView().think({ h: ev.h, v: ev.v });
                            else if (ev.t === 'm') ensureView().model(ev.model);
                            else if (ev.t === 'a') ensureView().agents(ev.agents);
                            else if (ev.t === 'done') status = ev.status || 'done';
                            else if (ev.t === 'e') { status = 'error'; err = ev.error; }
                        });
                    } catch (_) { /* Verbindung weg */ }
                    if (!status && runId && st.alive) status = await follow(runId, ensureView()); // Server arbeitet weiter -> dranbleiben
                }
            }
        } catch (e) { err = e.message; status = 'error'; }
        hideBuilderLoading();
        view?.remove(); st.abort = null; st.runId = null;
        await refresh();
        setBusy(false);
        if (!st.alive) return;
        if (status === 'error') { log.append(h('div', { class: 'bl-event err' }, icon('error'), h('span', { text: 'Coden konnte nicht weiterbauen: ' + (err || 'unbekannter Fehler') }), h('button', { class: 'bl-btn sm', onclick: (ev) => { ev.currentTarget.parentNode.remove(); runAgent(); } }, icon('refresh'), ' Nochmal'))); scrollLog(true); return; }
        if (status === 'stopped') { log.append(h('div', { class: 'bl-event' }, icon('stop_circle'), h('span', { text: 'Gestoppt. Fertige Dateien wurden übernommen.' }))); return; }
        notifyDone(st.app?.name ? `${st.app.name}: Coden ist fertig` : 'Coden ist fertig', 'Deine App wurde aktualisiert.');
        // Laufzeitfehler kann nur die echte Vorschau finden -> Coden korrigiert sich selbst (begrenzt)
        const lastAi = [...st.messages].reverse().find(m => m.role === 'assistant');
        const waits = /<tool\s+name="(database|ask|secret)"/.test(lastAi?.body || '');
        if (waits || !lastAi?.meta?.changed?.length || !showPreview()) { st.autoFix = 0; return; }
        const seq = renderSeq; await sleep(2200);
        const errs = seq === renderSeq ? [...new Set(st.renderErrors)].slice(0, 8) : [];
        if (errs.length && st.autoFix < MAX_AUTOFIX && st.alive) {
            st.autoFix++;
            try { addMessage(await postMessage('tool', `[Automatische Prüfung] In der Vorschau gibt es diese Fehler:\n${errs.map(e => '- Fehler in der Vorschau: ' + e).join('\n')}\nBehebe sie jetzt (nur die nötigen Änderungen).`, { display: `Coden hat die Vorschau geprüft: ${errs.length} Fehler – wird behoben …`, auto: true })); } catch (_) { return; }
            return runAgent();
        }
        if (errs.length) {
            log.append(h('div', { class: 'bl-event err' },
                icon('warning'),
                h('span', { text: `Es gibt noch ${errs.length} Fehler in der Vorschau.` }),
                h('button', { type: 'button', class: 'bl-btn sm', onclick: (ev) => {
                    ev.currentTarget.closest('.bl-event')?.remove();
                    runUser(`In der Vorschau gibt es noch diese Fehler. Bitte prüfe alle betroffenen Dateien und behebe sie vollständig:\n${errs.map(e => '- ' + e).join('\n')}`);
                } }, icon('auto_fix_high'), ' Fehler prüfen & beheben')));
            scrollLog(true);
        }
        st.autoFix = 0;
    }
    // Nach einem Lauf: neue Nachrichten und Dateien holen
    async function refresh() {
        try {
            const r = await apiJson(`/apps/${appId}/messages?after=${st.lastId}`); r.messages.forEach(addMessage);
            const full = await apiJson('/apps/' + appId); setApp(full.app);
            const changed = JSON.stringify(full.files) !== JSON.stringify(st.files); st.files = full.files; st.version = full.app.version;
            if (changed) { if (showCode() && !st.dirty) drawCode(); if (showPreview()) await render(true); }
        } catch (_) {}
    }
    let pollSoon = 0; const pollNow = () => { const n = Date.now(); if (n - pollSoon > 1500) { pollSoon = n; pollOnce(); } };

    async function runUser(text) {
        if (st.running) { toast('Coden arbeitet noch – kurz warten oder stoppen.', { type: 'warn' }); return; }
        st.autoFix = 0; st.imgRounds = 0;
        if (window.innerWidth <= 900 && st.pane !== 'chat') { st.pane = 'chat'; drawMobileTabs(); }
        setBusy(true);
        log.querySelector('.bl-welcome')?.remove();
        const pendingEl = h('div', { class: 'bl-msg user mine' }, h('div', { class: 'bl-bubble', text }));
        log.append(pendingEl);
        showBuilderLoading('Coden startet …');
        try {
            const msg = await postMessage('user', text);
            pendingEl.remove();
            addMessage(msg);
        } catch (e) {
            pendingEl.remove();
            hideBuilderLoading();
            setBusy(false);
            if (!input.value) { input.value = text; autoGrow(); }
            toast(e.message, { type: 'error' });
            return;
        }
        runAgent({ force: true });
    }
    function send() { const t = input.value.trim(); if (!t || st.running) return; input.value = ''; autoGrow(); runUser(t); }
    const autoGrow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; };
    input.addEventListener('input', autoGrow);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    sendBtn.addEventListener('click', send);

    // ---------- Zusammenarbeit (Abfrage alle 3 s) ----------
    async function pollOnce() {
        if (!st.alive || !st.app) return;
        try {
            const r = await apiJson(`/apps/${appId}/poll?after=${st.lastId}`);
            if (!st.alive || !st.app) return;
            st.members = r.members || []; drawPeople();
            (r.messages || []).forEach(m => { if (!st.seen.has(m.id)) addMessage(m); });
            if (r.published !== st.app.published || r.name !== st.app.name) setApp({ ...st.app, published: r.published, name: r.name });
            if (r.version > st.version) {
                const full = await apiJson('/apps/' + appId);
                if (!st.alive) return;
                st.version = full.app.version; setApp(full.app);
                const changed = JSON.stringify(full.files) !== JSON.stringify(st.files); st.files = full.files;
                if (changed) { if (showCode() && !st.dirty) drawCode(); else if (showCode()) codeStatus.textContent = '⚠ Jemand hat Dateien geändert – speichern überschreibt'; if (showPreview()) render(); }
            }
            // Ein Agent arbeitet (von einem anderen Gerät oder Mitglied gestartet)? -> live mit anschauen
            if (r.agentRun && !st.running && st.alive) { const x = await apiJson(`/apps/${appId}/agent?run=${r.agentRun}`); if (st.alive && x.status === 'running') runAgent({ attach: x }); }
        } catch (_) {}
    }
    async function poll() {
        if (!st.alive) return;
        if (!document.hidden) await pollOnce();
        if (!st.alive) return;
        st.timers.push(setTimeout(poll, 3000));
    }

    // ---------- Menüs & Dialoge ----------
    const ctx = () => ({ app: st.app, members: () => st.members, onApp: (a) => { setApp(a); st.version = Math.max(st.version, a.version); }, openPhone: () => openPhone(), openPublish: (o) => openPublish(o), reloadMembers: async () => { const r = await apiJson('/apps/' + appId); st.members = r.members; drawPeople(); } });
    function openPhone() { if (st.app) phoneTest(ctx()); }
    function openPublish(o) { if (st.app) publish(ctx(), o); }
    function openInvite() { if (st.app) invite(ctx()); }

    async function changeStyle() {
        if (!st.app) return;
        const list = S().STYLES || []; const cur = st.app.style;
        const grid = h('div', { class: 'ap-styles compact' }, [{ id: '', name: 'Eigener Stil', desc: 'Coden gestaltet frei' }, ...list].map(s => h('button', { type: 'button', class: 'ap-style' + (s.id === cur ? ' active' : ''), onclick: async () => {
            try { setApp((await apiJson('/apps/' + appId, { method: 'PATCH', body: JSON.stringify({ style: s.id, ...(s.v && /^#/.test(s.v.primary) ? { themeColor: s.v.primary } : {}) }) })).app); st.version = st.app.version; m.close(); render(); toast(`Stil: ${s.name}`, { type: 'ok' }); } catch (e) { toast(e.message, { type: 'error' }); }
        } }, stylePreview(s), h('b', { text: s.name }), h('small', { text: s.desc }))));
        loadStyleFonts();
        const m = modal('Stil ändern', grid, { wide: true });
    }

    function openMenu(anchor) {
        if (!st.app) return;
        const close = () => { menu.remove(); document.removeEventListener('pointerdown', out, true); };
        const out = (e) => { if (!menu.contains(e.target)) close(); };
        const item = (ic, label, fn, danger) => h('button', { type: 'button', class: 'bl-mi' + (danger ? ' danger' : ''), onclick: () => { close(); fn(); } }, icon(ic), h('span', { text: label }));
        const owner = st.app.role === 'owner';
        const narrow = window.innerWidth <= 360; // dort sind „Einladen“ und „Auf dem Handy testen“ aus der Kopfzeile ausgeblendet
        const menu = h('div', { class: 'bl-menu' },
            narrow ? item('group_add', 'Einladen', openInvite) : null,
            narrow ? item('qr_code_2', 'Auf dem Handy testen', openPhone) : null,
            item('palette', 'Stil ändern', changeStyle),
            item('swap_horiz', 'App-Typ ändern', changeKind),
            item('download', 'Als ZIP herunterladen', downloadZip),
            item('code', 'Auf GitHub speichern', () => ghExport({ app: st.app, files: st.files })),
            item('verified_user', 'GitHub-Zugriff verwalten', () => ghManageAccess()),
            item('html', 'Als eine HTML-Datei herunterladen', downloadHtml),
            item('link', 'Testlink kopieren', async () => { if (await copy(st.app.testUrl)) toast('Testlink kopiert', { type: 'ok' }); }),
            owner ? item('lock_reset', 'Testlink erneuern', async () => { if (!(await confirmBox('Der alte Testlink funktioniert danach nicht mehr.', { ok: 'Erneuern' }))) return; try { setApp((await apiJson(`/apps/${appId}/token`, { method: 'POST', body: '{}' })).app); toast('Neuer Testlink erstellt', { type: 'ok' }); } catch (e) { toast(e.message, { type: 'error' }); } }) : null,
            owner ? item('delete_sweep', 'Chat leeren', async () => { if (!(await confirmBox('Den ganzen Chat mit Coden löschen? Die Dateien bleiben.', { ok: 'Leeren', danger: true }))) return; await apiJson(`/apps/${appId}/messages`, { method: 'DELETE' }); st.messages = []; st.seen.clear(); log.replaceChildren(welcome()); }) : null,
            owner ? item('delete_forever', 'App löschen', async () => { if (!(await confirmBox(`„${st.app.name}“ mit allen Dateien endgültig löschen? Die Coden-Adresse wird frei.`, { ok: 'Endgültig löschen', danger: true }))) return; try { await apiJson('/apps/' + appId, { method: 'DELETE' }); toast('App gelöscht'); Router.go('apps'); } catch (e) { toast(e.message, { type: 'error' }); } }, true)
                : item('logout', 'App verlassen', async () => { const me = st.members.find(x => x.me); if (!me?.handle || !(await confirmBox('Diese App verlassen? Du kannst danach nicht mehr mitbauen.', { ok: 'Verlassen', danger: true }))) return; try { await apiJson(`/apps/${appId}/members/${me.handle}`, { method: 'DELETE' }); Router.go('apps'); } catch (e) { toast(e.message, { type: 'error' }); } }, true));
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect(); menu.style.top = r.bottom + 6 + 'px'; menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
        setTimeout(() => document.addEventListener('pointerdown', out, true), 0);
    }
    async function changeKind() {
        if (!st.app) return;
        const body = h('div', { class: 'ap-kinds compact' }, Object.entries(KINDS).map(([k, v]) => h('button', { type: 'button', class: 'ap-kind' + (k === st.app.kind ? ' active' : ''), onclick: async () => {
            try { setApp((await apiJson('/apps/' + appId, { method: 'PATCH', body: JSON.stringify({ kind: k }) })).app); st.version = st.app.version; st.device = kindOf(k).devices[0]; drawDevices(); m.close(); render();
                toast(`Typ: ${v.label}. Sag Coden, ob er die Oberfläche anpassen soll.`, { type: 'ok', ms: 4500 }); } catch (e) { toast(e.message, { type: 'error' }); }
        } }, h('span', { class: 'ap-kic' }, icon(v.icon)), h('b', { text: v.label }), h('small', { text: v.desc }))));
        const m = modal('App-Typ ändern', body, { wide: true });
    }
    async function downloadZip() {
        if (!st.app) return;
        try {
            if (!window.JSZip) await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'; s.onload = ok; s.onerror = () => fail(new Error('ZIP-Bibliothek nicht erreichbar')); document.head.appendChild(s); });
            const zip = new window.JSZip(); const kit = await getKit();
            Object.entries(st.files).forEach(([n, c]) => zip.file(n, c)); zip.file('coden-kit.css', kit.css); zip.file('coden-kit.js', kit.js);
            const style = S().byId(st.app.style); if (style) zip.file('coden-theme.css', S().themeCss(style) + '\n/* Schrift: ' + (S().fontsHref(style) || 'System') + ' */');
            const blob = await zip.generateAsync({ type: 'blob' }); dl(blob, (st.app.slug || 'app') + '.zip');
        } catch (e) { toast(e.message, { type: 'error' }); }
    }
    async function downloadHtml() {
        if (!st.app || !B()) return;
        try {
            const kit = await getKit(); const style = S().byId(st.app.style);
            const b = B().build(st.files, { kit, themeCss: S().themeCss(style), fontsHref: S().fontsHref(style), platform: st.app.kind === 'both' ? null : st.app.kind === 'game' ? 'web' : st.app.kind });
            dl(new Blob([B().withStore(b.pages[b.entry], {})], { type: 'text/html' }), (st.app.slug || 'app') + '.html');
        } catch (e) { toast(e.message || 'Export fehlgeschlagen.', { type: 'error' }); }
    }
    const dl = (blob, name) => { const u = URL.createObjectURL(blob); const a = h('a', { href: u, download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); };

    const onKey = (e) => { if (e.key === 'Escape' && st.running && document.activeElement === input) stopAgent(); };
    document.addEventListener('keydown', onKey);
    return {
        unmount() {
            st.alive = false;
            st.abort?.abort(); // trennt nur die Verbindung – der Agent baut auf dem Server weiter
            st.timers.forEach(clearTimeout);
            st.timers.length = 0;
            clearTimeout(renderTimer);
            ro.disconnect();
            window.removeEventListener('message', onMsg);
            document.removeEventListener('keydown', onKey);
            document.title = 'Coden AI';
            if (st.dirty && st.codeFile) saveFiles({ [st.codeFile]: editor.value }, []).catch(() => {});
            document.querySelectorAll('.cd-overlay, .bl-menu').forEach(x => x.remove());
        }
    };
}

// Kleine Stil-Vorschau (auch im Assistenten genutzt)
export function stylePreview(s) {
    if (!s.v) return h('div', { class: 'ap-sp auto' }, icon('auto_awesome'));
    const v = s.v; const f = (x) => x === '-apple-system' ? '-apple-system, system-ui, sans-serif' : `"${x}", system-ui, sans-serif`;
    return h('div', { class: 'ap-sp', style: { background: v.bg, backgroundImage: v.bgImage || 'none', color: v.text, fontFamily: f(v.font) } },
        h('div', { class: 'ap-sp-bar', style: { borderColor: v.border } }, h('i', { style: { background: v.primary } }), h('span', { style: { fontFamily: f(v.fontHead), color: v.text }, text: 'Aa' })),
        h('div', { class: 'ap-sp-card', style: { background: v.surface, borderColor: v.border, borderRadius: `min(${v.radius}, 12px)`, boxShadow: v.shadow ? v.shadow.split(',')[0].replace(/\d+px \d+px \d+px/, '2px 2px 0') : 'none' } },
            h('i', { style: { background: v.muted, opacity: .5 } }), h('i', { style: { background: v.muted, opacity: .3, width: '60%' } })),
        h('div', { class: 'ap-sp-btn', style: { background: v.gradient || v.primary, color: v.onPrimary, borderRadius: `min(${v.radius}, 10px)`, fontFamily: f(v.fontHead) }, text: 'Los' }));
}
let fontsLoaded = false;
export function loadStyleFonts() {
    if (fontsLoaded || !window.CodenStyles?.STYLES) return;
    fontsLoaded = true;
    const fams = new Set(); window.CodenStyles.STYLES.forEach(s => [s.v.font, s.v.fontHead].forEach(f => f !== '-apple-system' && fams.add(f)));
    const href = 'https://fonts.googleapis.com/css2?' + [...fams].map(f => 'family=' + f.replace(/ /g, '+') + (/(VT323|Press Start 2P)/.test(f) ? '' : ':wght@600')).join('&') + '&display=swap';
    document.head.appendChild(h('link', { rel: 'stylesheet', href }));
}
