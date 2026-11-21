// js/apps/builder.js – der App-Builder: links Chat mit dem Coden-Agenten, rechts Live-Vorschau (Handy-/Browser-Rahmen) und Code.
import { apiJson } from '../backend.js';
import { streamAiResponse } from '../api.js';
import { Router } from '../router.js';
import { toast } from '../toast.js';
import { h, icon, md, sleep, copy } from './dom.js';
import { systemPrompt, parse, apply, condense } from './agent.js';
import { KINDS } from './templates.js';
import { databaseCard, askCard, secretCard, publishCard } from './tools.js';
import { modal, confirmBox, promptBox, phoneTest, publish, invite } from './dialogs.js';

const S = () => window.CodenStyles; const B = () => window.CodenBundle;
let kitP; const getKit = () => kitP || (kitP = Promise.all(['kit/coden-kit.css', 'kit/coden-kit.js'].map(u => fetch(u).then(r => r.text()))).then(([css, js]) => ({ css, js })));
const TIERS = [{ id: 'pro', label: 'Pro', tip: 'Stärkste Modelle – am besten für Apps' }, { id: 'normal', label: 'Thinking', tip: 'Denkt länger nach' }, { id: 'flash', label: 'Flash', tip: 'Am schnellsten, für kleine Änderungen' }];
const DEVICES = { ios: { w: 393, h: 852, label: 'iPhone', icon: 'phone_iphone' }, android: { w: 412, h: 915, label: 'Android', icon: 'android' }, desktop: { w: 0, h: 0, label: 'Desktop', icon: 'desktop_windows' }, tablet: { w: 834, h: 1112, label: 'Tablet', icon: 'tablet_mac' }, phone: { w: 390, h: 844, label: 'Handy', icon: 'smartphone' } };
const FILE_ICON = (n) => /\.html?$/.test(n) ? 'html' : /\.css$/.test(n) ? 'css' : /\.js$/.test(n) ? 'javascript' : /\.json$/.test(n) ? 'data_object' : /\.svg$/.test(n) ? 'image' : 'description';
const MAX_AUTOFIX = 2;

export function mountBuilder(host, appId) {
    const st = { id: appId, app: null, files: {}, members: [], messages: [], seen: new Set(), lastId: 0, version: 0, running: false, abort: null, autoFix: 0,
        tier: localStorage.getItem('coden_app_tier') || 'pro', device: null, page: 'index.html', view: 'preview', pane: 'chat', logs: [], renderErrors: [], codeFile: null, dirty: false, alive: true, timers: [], live: null };
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
    const stage = h('div', { class: 'bl-stage' },
        h('div', { class: 'bl-toolbar' }, viewSeg, h('span', { class: 'bl-sep' }), deviceBtns, pageSel, h('span', { class: 'grow' }),
            h('button', { class: 'bl-tbtn', title: 'Neu laden', onclick: () => render() }, icon('refresh')), consoleBtn,
            h('button', { class: 'bl-tbtn', title: 'Im neuen Tab öffnen (Testlink)', onclick: () => st.app && window.open(st.app.testUrl, '_blank', 'noopener') }, icon('open_in_new'))),
        canvas, codeBox, consoleBox);
    const chat = h('div', { class: 'bl-chat' }, log, h('div', { class: 'bl-composer' }, input, h('div', { class: 'bl-crow' }, tierBox, h('span', { class: 'grow' }), stopBtn, sendBtn)));
    const mtabs = h('div', { class: 'bl-mtabs' });
    const head = h('header', { class: 'bl-head' },
        h('button', { class: 'bl-ibtn', title: 'Zurück zu deinen Apps', onclick: () => Router.go('apps') }, icon('arrow_back')),
        h('div', { class: 'bl-title' }, nameIn, badges), people, h('span', { class: 'grow' }),
        h('button', { class: 'bl-btn', onclick: () => openInvite() }, icon('group_add'), h('span', { text: 'Einladen' })),
        h('button', { class: 'bl-btn', onclick: () => openPhone() }, icon('qr_code_2'), h('span', { text: 'Auf dem Handy testen' })),
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
    (async () => {
        log.append(h('div', { class: 'bl-empty' }, h('span', { class: 'cd-spin' })));
        try {
            const r = await apiJson('/apps/' + appId);
            setApp(r.app); st.files = r.files || {}; st.members = r.members || []; st.version = r.app.version;
            const msgs = (await apiJson(`/apps/${appId}/messages`)).messages;
            log.replaceChildren(); msgs.forEach(addMessage); if (!msgs.length) log.append(welcome());
            drawPeople(); drawTiers(); drawDevices(); drawViewSeg(); drawMobileTabs(); render(); scrollLog(true);
            const pending = sessionStorage.getItem('coden_app_prompt_' + appId);
            if (pending) { sessionStorage.removeItem('coden_app_prompt_' + appId); input.value = pending; send(); }
            else setTimeout(() => input.focus(), 100);
            poll();
        } catch (e) {
            root.replaceChildren(h('div', { class: 'ap-empty' }, icon('error'), h('h2', { text: 'App nicht gefunden' }), h('p', { text: e.message }), h('button', { class: 'bl-btn primary', onclick: () => Router.go('apps') }, icon('arrow_back'), ' Zu deinen Apps')));
        }
    })();

    function setApp(app) {
        st.app = app; if (document.activeElement !== nameIn) nameIn.value = app.name;
        if (!st.device) st.device = KINDS[app.kind].devices[0];
        const style = S().byId(app.style);
        badges.replaceChildren(h('span', { class: 'bl-badge' }, icon(KINDS[app.kind].icon), KINDS[app.kind].label), h('button', { class: 'bl-badge btn', title: 'Stil ändern', onclick: () => changeStyle() }, icon('palette'), style ? style.name : 'Eigener Stil'),
            app.published ? h('a', { class: 'bl-badge live', href: app.url, target: '_blank', rel: 'noopener', title: app.url }, h('i'), 'Live') : null);
        const pub = root.querySelector('#bl-pub span:last-child'); if (pub) pub.textContent = app.published ? 'Veröffentlicht' : 'Veröffentlichen';
        root.querySelector('#bl-pub')?.classList.toggle('done', app.published);
        document.title = app.name + ' · Coden Apps';
    }
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameIn.blur(); if (e.key === 'Escape') { nameIn.value = st.app.name; nameIn.blur(); } });
    nameIn.addEventListener('blur', async () => { const n = nameIn.value.trim(); if (!n || n === st.app.name) { nameIn.value = st.app.name; return; } try { setApp((await apiJson('/apps/' + appId, { method: 'PATCH', body: JSON.stringify({ name: n }) })).app); st.version = st.app.version; toast('Umbenannt', { type: 'ok' }); } catch (e) { toast(e.message, { type: 'error' }); nameIn.value = st.app.name; } });

    function drawPeople() {
        people.replaceChildren(...st.members.slice(0, 5).map(m => h('span', { class: 'bl-ava' + (m.online ? ' on' : ''), title: `${m.displayName}${m.handle ? ' (@' + m.handle + ')' : ''}${m.me ? ' – du' : ''}${m.online ? ' · online' : ''}`, text: (m.displayName || '?')[0].toUpperCase() })));
        people.classList.toggle('hidden', st.members.length < 2);
    }
    function drawTiers() {
        tierBox.replaceChildren(...TIERS.map(t => h('button', { class: 'bl-tier' + (st.tier === t.id ? ' active' : ''), title: t.tip, text: t.label, onclick: () => { st.tier = t.id; localStorage.setItem('coden_app_tier', t.id); drawTiers(); } })));
    }
    function drawDevices() {
        const list = KINDS[st.app.kind].devices; deviceBtns.classList.toggle('hidden', list.length < 2 || st.view !== 'preview');
        deviceBtns.replaceChildren(...list.map(d => h('button', { class: st.device === d ? 'active' : '', title: DEVICES[d].label, onclick: () => { st.device = d; drawDevices(); render(); } }, icon(DEVICES[d].icon), h('span', { text: DEVICES[d].label }))));
    }
    function drawViewSeg() {
        viewSeg.replaceChildren(...[['preview', 'visibility', 'Vorschau'], ['code', 'code', 'Code']].map(([v, ic, l]) => h('button', { class: st.view === v ? 'active' : '', onclick: () => setView(v) }, icon(ic), h('span', { text: l }))));
    }
    function setView(v) {
        if (st.view === 'code' && v !== 'code' && st.dirty) { saveCode(); }
        st.view = v; drawViewSeg(); drawDevices(); canvas.classList.toggle('hidden', v !== 'preview'); codeBox.classList.toggle('hidden', v !== 'code'); pageSel.classList.toggle('hidden', v !== 'preview' || pageSel.options.length < 2);
        if (v === 'code') drawCode(); else render();
    }
    function drawMobileTabs() {
        mtabs.replaceChildren(...[['chat', 'forum', 'Chat'], ['preview', 'visibility', 'Vorschau'], ['code', 'code', 'Code']].map(([p, ic, l]) => h('button', { class: st.pane === p ? 'active' : '', onclick: () => { st.pane = p; root.dataset.pane = p; if (p !== 'chat') setView(p); drawMobileTabs(); } }, icon(ic), l)));
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
        if (!st.app || st.view !== 'preview') return;
        const kit = await getKit(); const style = S().byId(st.app.style);
        const platform = st.app.kind === 'web' ? 'web' : st.device === 'android' ? 'android' : 'ios';
        const b = B().build(st.files, { kit, themeCss: S().themeCss(style), fontsHref: S().fontsHref(style), platform });
        if (!b.pages[st.page]) st.page = b.entry;
        const pages = Object.keys(b.pages); pageSel.replaceChildren(...pages.map(p => h('option', { value: p, text: p, selected: p === st.page }))); pageSel.classList.toggle('hidden', pages.length < 2);
        drawFrame(style);
        st.renderErrors = []; st.logs = []; drawConsole(); renderSeq++;
        loading.classList.remove('hidden');
        frame.srcdoc = B().withStore(b.pages[st.page], snapshot());
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
        if (!frame || e.source !== frame.contentWindow || !e.data || e.data.__coden !== 1) return; const m = e.data;
        if (m.t === 'error') { const msg = `${m.message}${m.line ? ` (Zeile ${m.line})` : ''}`; st.renderErrors.push(msg); st.logs.push({ level: 'error', text: msg }); drawConsole(); }
        else if (m.t === 'console') { st.logs.push({ level: m.level, text: m.text }); if (st.logs.length > 200) st.logs.shift(); if (m.level === 'error') st.renderErrors.push(m.text); drawConsole(); }
        else if (m.t === 'nav') { const p = String(m.page || '').replace(/^\.?\//, ''); st.page = p || 'index.html'; render(); }
        else if (m.t === 'store') { try { if (m.v === null) localStorage.removeItem(ns + m.k); else if (String(m.v).length < 400000) localStorage.setItem(ns + m.k, String(m.v)); } catch (_) {} }
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

    // ---------- Code-Ansicht ----------
    const editor = h('textarea', { class: 'bl-editor', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off' });
    const codeStatus = h('small', { class: 'bl-cstatus' });
    editor.addEventListener('input', () => { st.dirty = true; codeStatus.textContent = 'Nicht gespeichert'; });
    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') { e.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); st.dirty = true; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCode(); }
    });
    async function saveCode() {
        if (!st.dirty || !st.codeFile) return; const name = st.codeFile, content = editor.value;
        try { await saveFiles({ [name]: content }, []); st.files[name] = content; st.dirty = false; codeStatus.textContent = 'Gespeichert'; toast(`${name} gespeichert`, { type: 'ok', ms: 1500 }); }
        catch (e) { toast(e.message, { type: 'error' }); }
    }
    function drawCode() {
        const names = Object.keys(st.files).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
        if (!st.codeFile || !(st.codeFile in st.files)) { st.codeFile = names[0] || null; st.dirty = false; }
        if (!st.dirty && st.codeFile) editor.value = st.files[st.codeFile];
        const list = h('div', { class: 'bl-files' }, h('div', { class: 'bl-fhead' }, h('b', { text: 'Dateien' }), h('button', { class: 'bl-tbtn', title: 'Neue Datei', onclick: async () => {
            const n = await promptBox('Neue Datei', { label: 'Dateiname', placeholder: 'z. B. daten.js, kontakt.html, logo.svg', ok: 'Anlegen' }); if (!n) return;
            if (!/^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.\-\/]{0,99}$/.test(n)) return toast('Ungültiger Dateiname', { type: 'error' });
            if (n in st.files) return toast('Die Datei gibt es schon', { type: 'warn' });
            try { await saveFiles({ [n]: '' }, []); st.files[n] = ''; st.codeFile = n; st.dirty = false; drawCode(); } catch (e) { toast(e.message, { type: 'error' }); }
        } }, icon('note_add'))),
        ...names.map(n => h('div', { class: 'bl-file' + (n === st.codeFile ? ' active' : ''), onclick: async () => { if (st.dirty) await saveCode(); st.codeFile = n; st.dirty = false; drawCode(); } },
            icon(FILE_ICON(n)), h('span', { class: 'grow', text: n }), h('small', { text: (st.files[n].length / 1024).toFixed(1) + ' KB' }),
            names.length > 1 ? h('button', { class: 'bl-x', title: 'Löschen', onclick: async (e) => { e.stopPropagation(); if (!(await confirmBox(`${n} löschen?`, { ok: 'Löschen', danger: true }))) return; try { await saveFiles({}, [n]); delete st.files[n]; if (st.codeFile === n) st.codeFile = null; st.dirty = false; drawCode(); } catch (er) { toast(er.message, { type: 'error' }); } } }, icon('delete')) : null)));
        codeBox.replaceChildren(list, h('div', { class: 'bl-ecol' }, h('div', { class: 'bl-ebar' }, icon(FILE_ICON(st.codeFile || '')), h('b', { text: st.codeFile || '–' }), codeStatus, h('span', { class: 'grow' }),
            h('button', { class: 'bl-btn sm', title: 'Kopieren', onclick: async () => { if (await copy(editor.value)) toast('Kopiert', { type: 'ok', ms: 1200 }); } }, icon('content_copy')),
            h('button', { class: 'bl-btn sm primary', onclick: saveCode }, icon('save'), ' Speichern')), editor));
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
        const kind = KINDS[st.app?.kind || 'web'];
        const ideas = st.app?.kind === 'web' ? ['Eine Webseite für mein Café mit Speisekarte und Öffnungszeiten', 'Ein Portfolio mit meinen Projekten und Kontaktformular', 'Eine Landingpage für meine App mit Preisen'] : ['Eine To-do-App mit Kategorien und Erinnerungen', 'Ein Habit-Tracker mit Statistiken', 'Eine Rezept-App mit Favoriten und Einkaufsliste'];
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
        log.append(renderMessage(m)); scrollLog(m.mine);
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

    // Zeichnet eine Coden-Antwort (auch während sie geschrieben wird)
    function fillAssistant(body, text, { meta = {}, msgId = null, final = false } = {}) {
        const p = parse(text); const done = answers(); const frag = [];
        if (body.firstElementChild && !body.firstElementChild._sig) body.replaceChildren();
        let ti = 0;
        for (const s of p.segs) {
            if (s.kind === 'text') { if (s.text.trim()) frag.push(md(s.text.replace(/\[Datei (geschrieben|geändert|gelöscht): ([^\]]+)\]\n?/g, '').replace(/\(Geänderte Dateien:[^)]*\)/g, ''))); }
            else if (s.kind === 'op' && !final) frag.push(sig('op:' + s.op.type + ':' + s.op.path + ':' + (s.op.closed ? 1 : 0), h('div', { class: 'bl-op' + (s.op.closed ? ' done' : ' busy') }, icon(s.op.type === 'delete' ? 'delete' : s.op.closed ? 'check_circle' : 'edit'), h('span', { text: (s.op.type === 'delete' ? 'Löscht ' : s.op.type === 'edit' ? (s.op.closed ? 'Geändert: ' : 'Ändert ') : (s.op.closed ? 'Geschrieben: ' : 'Schreibt ')) + s.op.path }), s.op.type === 'file' ? h('small', { text: s.op.content.split('\n').length + ' Zeilen' }) : null)));
            else if (s.kind === 'plan') frag.push(h('div', { class: 'bl-plan' }, h('b', {}, icon('checklist'), ' Plan'), ...s.plan.items.map(it => h('div', { class: 'bl-pi' + (it.done ? ' done' : '') }, icon(it.done ? 'check_circle' : 'radio_button_unchecked'), h('span', { text: it.text })))));
            else if (s.kind === 'sql') frag.push(h('div', { class: 'bl-sql' }, h('div', { class: 'bl-sqlh' }, icon('database'), h('b', { text: 'SQL' }), h('span', { class: 'grow' }),
                h('button', { class: 'bl-btn sm', onclick: async () => { if (await copy(s.sql.code)) toast('SQL kopiert – füge es im SQL-Editor ein', { type: 'ok' }); } }, icon('content_copy'), ' Kopieren'),
                st.app?.integrations?.database?.provider === 'supabase' ? h('a', { class: 'bl-btn sm', href: 'https://supabase.com/dashboard/project/' + ((st.app.integrations.database.url || '').match(/https:\/\/([a-z0-9-]+)\./)?.[1] || '') + '/sql/new', target: '_blank', rel: 'noopener' }, icon('open_in_new'), ' SQL-Editor') : null),
                h('pre', {}, h('code', { class: 'language-sql', text: s.sql.code }))));
            else if (s.kind === 'tool') {
                const key = msgId ? `${msgId}:${ti++}` : null; const ans = key ? done[key] : null;
                if (!final) { frag.push(sig('tool:' + s.tool.name, h('div', { class: 'bl-op busy' }, icon('build'), h('span', { text: 'Werkzeug: ' + s.tool.name })))); continue; }
                const onAnswer = (a) => answerTool(key, a);
                if (s.tool.name === 'database') frag.push(databaseCard(s.tool, { answered: ans, onAnswer, current: st.app?.integrations?.database }));
                else if (s.tool.name === 'ask') frag.push(askCard(s.tool, { answered: ans, onAnswer }));
                else if (s.tool.name === 'secret') frag.push(secretCard(s.tool, { answered: ans, onAnswer }));
                else if (s.tool.name === 'publish') frag.push(publishCard(s.tool, { published: st.app?.published, onPublish: () => openPublish() }));
            }
        }
        if (final && meta.changed?.length) frag.push(h('div', { class: 'bl-changes' }, meta.changed.filter(c => c.type !== 'same').map(c => h('button', { class: 'bl-chg ' + c.type, title: 'Im Code ansehen', onclick: () => { if (c.type === 'delete' || !(c.path in st.files)) return; st.codeFile = c.path; st.dirty = false; if (window.innerWidth <= 900) { st.pane = 'code'; drawMobileTabs(); } setView('code'); } },
            icon({ new: 'add_circle', write: 'edit_document', edit: 'edit', delete: 'delete' }[c.type] || 'description'), h('span', { text: c.path })))));
        if (final && meta.auto) frag.push(h('small', { class: 'bl-meta', text: 'automatische Korrektur' }));
        if (!frag.length && !final) frag.push(h('span', { class: 'typing-dots' }, h('i'), h('i'), h('i')));
        reconcile(body, frag);
    }

    // Stabile Signatur für Karten, die sich beim Streamen nur im Detail ändern (z. B. Zeilenzahl)
    function sig(key, node) { node._sig = key; return node; }
    // Aktualisiert nur, was sich wirklich geändert hat – so flackern fertige Karten nicht mehr
    function reconcile(body, frag) {
        const nodes = [];
        frag.forEach((n, i) => {
            const o = body.children[i]; const k = n._sig || n.outerHTML;
            if (o && o._sig === k) {
                if (n._sig) { const so = o.querySelector('small'), sn = n.querySelector('small'); if (so && sn && so.textContent !== sn.textContent) so.textContent = sn.textContent; }
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

    // ---------- Agent ----------
    function buildContext() {
        const hist = st.messages.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool').slice(-18);
        const out = [];
        for (const m of hist) {
            const role = m.role === 'assistant' ? 'assistant' : 'user';
            let content = m.role === 'user' && !m.mine && m.handle ? `@${m.handle} schreibt: ${m.body}` : m.body;
            // Frühere Datei-Blöcke sind gekürzt – als Kommentar markieren, damit das Modell sie nicht nachahmt statt echte Blöcke zu schreiben
            if (role === 'assistant') content = content.replace(/\[Datei (geschrieben|geändert|gelöscht): ([^\]]+)\]/g, '<!-- (frühere Antwort: Datei $2 $1, Inhalt hier gekürzt) -->').replace(/\(Geänderte Dateien:[^)]*\)/g, '');
            if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n\n' + content; else out.push({ role, content });
        }
        while (out.length && out[0].role !== 'user') out.shift();
        if (!out.length) out.push({ role: 'user', content: 'Mach weiter.' });
        return [{ role: 'system', content: systemPrompt({ app: st.app, files: st.files, style: S().byId(st.app.style) }) }, ...out.map(m => ({ ...m, content: m.content.slice(0, 90000) }))];
    }

    function setBusy(on) { st.running = on; stopBtn.classList.toggle('hidden', !on); sendBtn.classList.toggle('hidden', on); root.classList.toggle('busy', on); }
    stopBtn.addEventListener('click', () => st.abort?.abort());


    function withReply(text, p, aborted) {
        const segs = p.segs; let lastOp = -1; segs.forEach((x, i) => { if (x.kind === 'op') lastOp = i; });
        const hasText = (a) => segs.slice(a).some(x => x.kind === 'text' && x.text.replace(/\[Datei [^\]]*\]/g, '').trim().length > 2);
        if (p.tools.length || aborted) return text;
        if (lastOp < 0) return hasText(0) ? text : text + (text.trim() ? '\n\n' : '') + 'Ich habe gerade nichts geändert. Sag mir gern genauer, was ich bauen oder anpassen soll.';
        if (hasText(lastOp + 1)) return text;
        const names = [...new Set(p.ops.map(o => o.path))]; const list = names.slice(0, 4).join(', ') + (names.length > 4 ? ` und ${names.length - 4} weitere` : '');
        return text.replace(/\s+$/, '') + `\n\nFertig – ich habe ${list} ${p.ops.some(o => o.type === 'file') ? 'geschrieben bzw. angepasst' : 'angepasst'}. Schau dir die Vorschau an und sag mir, was ich noch ändern soll.`;
    }

    async function runAgent() {
        if (st.running || !st.alive) return;
        setBusy(true);
        const el = h('div', { class: 'bl-msg ai streaming' }, h('div', { class: 'bl-aava' }, h('img', { src: './images/coden_logo.jpg', alt: '' })));
        const body = h('div', { class: 'bl-abody' }); el.append(body); log.append(el); scrollLog(true);
        body.replaceChildren(h('div', { class: 'bl-thinking' }, h('span', { class: 'typing-dots' }, h('i'), h('i'), h('i')), h('span', { text: 'Coden denkt nach …' })));
        const ac = new AbortController(); st.abort = ac;
        let text = '', model = '', raf = 0;
        let lastPaint = 0;
        const paint = () => { raf = 0; lastPaint = Date.now(); fillAssistant(body, text); scrollLog(); };
        try {
            text = await streamAiResponse(buildContext(), st.tier, { signal: ac.signal, maxTokens: 16000, onModel: (m) => { model = m; }, onDelta: (t) => { text = t; if (!raf) raf = setTimeout(paint, Math.max(0, 120 - (Date.now() - lastPaint))); } });
        } catch (e) {
            text = e.text || text;
            if (!text.trim()) { clearTimeout(raf); el.remove(); setBusy(false); st.abort = null; log.append(h('div', { class: 'bl-event err' }, icon('error'), h('span', { text: 'Coden konnte nicht antworten: ' + e.message }), h('button', { class: 'bl-btn sm', onclick: (ev) => { ev.currentTarget.parentNode.remove(); runAgent(); } }, icon('refresh'), ' Nochmal'))); scrollLog(true); return; }
        }
        clearTimeout(raf);
        const aborted = ac.signal.aborted; st.abort = null;
        if (!text.trim()) { el.remove(); setBusy(false); return; }
        let p = parse(text);
        // Coden antwortet immer auch mit Text: fehlt eine Erklärung, schreiben wir eine kurze Zusammenfassung dazu
        text = withReply(text, p, aborted); p = parse(text);
        const res = apply(st.files, p.ops);
        let saveErr = null;
        if (Object.keys(res.set).length || res.remove.length) {
            try { await saveFiles(res.set, res.remove); st.files = res.files; }
            catch (e) { saveErr = e.message; }
        }
        const meta = { changed: res.changed, model: model || undefined, problems: res.problems.length || undefined, aborted: aborted || undefined, auto: st.autoFix > 0 || undefined };
        let saved;
        try { saved = await postMessage('assistant', condense(text) || '…', meta); }
        catch (e) { saved = { id: -Date.now(), role: 'assistant', body: condense(text), meta, mine: true }; }
        el.remove(); addMessage(saved); setBusy(false);
        if (saveErr) { toast('Speichern fehlgeschlagen: ' + saveErr, { type: 'error' }); return; }
        if (res.changed.length) { if (st.view === 'code') drawCode(); await render(true); }
        if (aborted) { log.append(h('div', { class: 'bl-event' }, icon('stop_circle'), h('span', { text: 'Gestoppt. Fertige Dateien wurden übernommen.' }))); return; }
        const waitsForUser = p.tools.some(t => ['database', 'ask', 'secret'].includes(t.name));
        if (waitsForUser) { st.autoFix = 0; return; }
        // Selbstprüfung: Probleme beim Anwenden oder Fehler in der Vorschau -> Coden korrigiert sich selbst (begrenzt)
        let issues = res.problems.slice();
        if (!p.ops.length && !p.tools.length && /\[Datei (geschrieben|geändert|gelöscht)|\(Geänderte Dateien|<!-- \(frühere Antwort/.test(text)) issues.push('Du hast nur Dateinamen genannt, aber keinen einzigen <file>- oder <edit>-Block geschrieben – dadurch wurde NICHTS geändert. Gib die Änderungen jetzt als echte Blöcke aus.');
        if (res.changed.length && st.view === 'preview') { const seq = renderSeq; await sleep(2200); if (seq === renderSeq) issues = issues.concat([...new Set(st.renderErrors)].slice(0, 8).map(e => 'Fehler in der Vorschau: ' + e)); }
        if (issues.length && st.autoFix < MAX_AUTOFIX && st.alive) {
            st.autoFix++;
            try { addMessage(await postMessage('tool', `[Automatische Prüfung] Nach deiner letzten Antwort gibt es diese Probleme:\n${issues.map(i => '- ' + i).join('\n')}\nBehebe sie jetzt (nur die nötigen Änderungen).`, { display: `Coden hat die App geprüft: ${issues.length} Problem${issues.length > 1 ? 'e' : ''} gefunden – wird behoben …`, auto: true })); } catch (_) { return; }
            return runAgent();
        }
        if (issues.length) log.append(h('div', { class: 'bl-event err' }, icon('warning'), h('span', { text: 'Es gibt noch Fehler. Öffne die Konsole oder sag Coden, was nicht klappt.' })));
        st.autoFix = 0;
    }

    async function runUser(text) {
        if (st.running) { toast('Coden arbeitet noch – kurz warten oder stoppen.', { type: 'warn' }); return; }
        st.autoFix = 0;
        try { addMessage(await postMessage('user', text)); } catch (e) { toast(e.message, { type: 'error' }); return; }
        if (window.innerWidth <= 900 && st.pane !== 'chat') { st.pane = 'chat'; drawMobileTabs(); }
        runAgent();
    }
    function send() { const t = input.value.trim(); if (!t || st.running) return; input.value = ''; autoGrow(); runUser(t); }
    const autoGrow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; };
    input.addEventListener('input', autoGrow);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    sendBtn.addEventListener('click', send);

    // ---------- Zusammenarbeit (Abfrage alle 3 s) ----------
    async function poll() {
        if (!st.alive) return;
        if (!document.hidden && st.app) {
            try {
                const r = await apiJson(`/apps/${appId}/poll?after=${st.lastId}`);
                st.members = r.members; drawPeople();
                r.messages.forEach(m => { if (!st.seen.has(m.id)) addMessage(m); });
                if (r.published !== st.app.published || r.name !== st.app.name) setApp({ ...st.app, published: r.published, name: r.name });
                if (r.version > st.version && !st.running) {
                    const full = await apiJson('/apps/' + appId); st.version = full.app.version; setApp(full.app);
                    const changed = JSON.stringify(full.files) !== JSON.stringify(st.files); st.files = full.files;
                    if (changed) { if (st.view === 'code' && !st.dirty) drawCode(); else if (st.view === 'code') codeStatus.textContent = '⚠ Jemand hat Dateien geändert – speichern überschreibt'; render(); }
                }
            } catch (_) {}
        }
        st.timers.push(setTimeout(poll, 3000));
    }

    // ---------- Menüs & Dialoge ----------
    const ctx = () => ({ app: st.app, members: () => st.members, onApp: (a) => { setApp(a); st.version = Math.max(st.version, a.version); }, openPhone: () => openPhone(), openPublish: (o) => openPublish(o), reloadMembers: async () => { const r = await apiJson('/apps/' + appId); st.members = r.members; drawPeople(); } });
    function openPhone() { if (st.app) phoneTest(ctx()); }
    function openPublish(o) { if (st.app) publish(ctx(), o); }
    function openInvite() { if (st.app) invite(ctx()); }

    async function changeStyle() {
        const list = S().STYLES; const cur = st.app.style;
        const grid = h('div', { class: 'ap-styles compact' }, [{ id: '', name: 'Eigener Stil', desc: 'Coden gestaltet frei' }, ...list].map(s => h('button', { class: 'ap-style' + (s.id === cur ? ' active' : ''), onclick: async () => {
            try { setApp((await apiJson('/apps/' + appId, { method: 'PATCH', body: JSON.stringify({ style: s.id, ...(s.v && /^#/.test(s.v.primary) ? { themeColor: s.v.primary } : {}) }) })).app); st.version = st.app.version; m.close(); render(); toast(`Stil: ${s.name}`, { type: 'ok' }); } catch (e) { toast(e.message, { type: 'error' }); }
        } }, stylePreview(s), h('b', { text: s.name }), h('small', { text: s.desc }))));
        loadStyleFonts();
        const m = modal('Stil ändern', grid, { wide: true });
    }

    function openMenu(anchor) {
        const close = () => { menu.remove(); document.removeEventListener('pointerdown', out, true); };
        const out = (e) => { if (!menu.contains(e.target)) close(); };
        const item = (ic, label, fn, danger) => h('button', { class: 'bl-mi' + (danger ? ' danger' : ''), onclick: () => { close(); fn(); } }, icon(ic), h('span', { text: label }));
        const owner = st.app.role === 'owner';
        const menu = h('div', { class: 'bl-menu' },
            item('palette', 'Stil ändern', changeStyle),
            item('swap_horiz', 'App-Typ ändern', changeKind),
            item('download', 'Als ZIP herunterladen', downloadZip),
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
        const body = h('div', { class: 'ap-kinds compact' }, Object.entries(KINDS).map(([k, v]) => h('button', { class: 'ap-kind' + (k === st.app.kind ? ' active' : ''), onclick: async () => {
            try { setApp((await apiJson('/apps/' + appId, { method: 'PATCH', body: JSON.stringify({ kind: k }) })).app); st.version = st.app.version; st.device = KINDS[k].devices[0]; drawDevices(); m.close(); render();
                toast(`Typ: ${v.label}. Sag Coden, ob er die Oberfläche anpassen soll.`, { type: 'ok', ms: 4500 }); } catch (e) { toast(e.message, { type: 'error' }); }
        } }, h('span', { class: 'ap-kic' }, icon(v.icon)), h('b', { text: v.label }), h('small', { text: v.desc }))));
        const m = modal('App-Typ ändern', body, { wide: true });
    }
    async function downloadZip() {
        try {
            if (!window.JSZip) await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'; s.onload = ok; s.onerror = () => fail(new Error('ZIP-Bibliothek nicht erreichbar')); document.head.appendChild(s); });
            const zip = new window.JSZip(); const kit = await getKit();
            Object.entries(st.files).forEach(([n, c]) => zip.file(n, c)); zip.file('coden-kit.css', kit.css); zip.file('coden-kit.js', kit.js);
            const style = S().byId(st.app.style); if (style) zip.file('coden-theme.css', S().themeCss(style) + '\n/* Schrift: ' + (S().fontsHref(style) || 'System') + ' */');
            const blob = await zip.generateAsync({ type: 'blob' }); dl(blob, (st.app.slug || 'app') + '.zip');
        } catch (e) { toast(e.message, { type: 'error' }); }
    }
    async function downloadHtml() {
        const kit = await getKit(); const style = S().byId(st.app.style);
        const b = B().build(st.files, { kit, themeCss: S().themeCss(style), fontsHref: S().fontsHref(style), platform: st.app.kind === 'both' ? null : st.app.kind });
        dl(new Blob([B().withStore(b.pages[b.entry], {})], { type: 'text/html' }), (st.app.slug || 'app') + '.html');
    }
    const dl = (blob, name) => { const u = URL.createObjectURL(blob); const a = h('a', { href: u, download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); };

    const onKey = (e) => { if (e.key === 'Escape' && st.running && document.activeElement === input) st.abort?.abort(); };
    document.addEventListener('keydown', onKey);
    return {
        unmount() {
            st.alive = false; st.abort?.abort(); st.timers.forEach(clearTimeout); clearTimeout(renderTimer); ro.disconnect();
            window.removeEventListener('message', onMsg); document.removeEventListener('keydown', onKey); document.title = 'Coden AI';
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
    if (fontsLoaded) return; fontsLoaded = true;
    const fams = new Set(); window.CodenStyles.STYLES.forEach(s => [s.v.font, s.v.fontHead].forEach(f => f !== '-apple-system' && fams.add(f)));
    const href = 'https://fonts.googleapis.com/css2?' + [...fams].map(f => 'family=' + f.replace(/ /g, '+') + (/(VT323|Press Start 2P)/.test(f) ? '' : ':wght@600')).join('&') + '&display=swap';
    document.head.appendChild(h('link', { rel: 'stylesheet', href }));
}
