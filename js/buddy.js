// js/buddy.js – Code Buddy: Freunde, Nachrichten, gemeinsame Projekte (alles per DOM/textContent, kein innerHTML mit Nutzerdaten)
import { apiJson } from './backend.js';
import { auth } from './auth.js';

const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
};
const icon = (n) => h('span', { class: 'material-symbols-outlined', text: n });
const api = (path, method = 'GET', body) => apiJson('/buddy' + path, { method, body: body ? JSON.stringify(body) : undefined });
const timeStr = (iso) => { const d = new Date(iso); return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };

let root, badge, state = { profile: null, tab: 'friends', view: null, friends: null, projects: [], timers: [] };

function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }
function every(ms, fn) { const t = setInterval(() => { if (!document.hidden && root?.classList.contains('open')) fn().catch(() => {}); }, ms); state.timers.push(t); }
function toast(msg) { const t = h('div', { class: 'bd-toast', text: msg }); root.appendChild(t); setTimeout(() => t.remove(), 3500); }
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// ---------------- Rahmen ----------------
function build() {
    root = h('div', { id: 'buddy-view', class: 'buddy-view', role: 'dialog', 'aria-label': 'Code Buddy' });
    document.body.appendChild(root);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('open')) Buddy.close(); });
}

function shell() {
    clearTimers();
    const side = h('div', { class: 'bd-side' });
    const main = h('div', { class: 'bd-main' });
    const tabs = h('div', { class: 'bd-tabs' },
        h('button', { class: state.tab === 'friends' ? 'active' : '', onclick: () => { state.tab = 'friends'; state.view = null; render(); } }, icon('group'), ' Freunde'),
        h('button', { class: state.tab === 'projects' ? 'active' : '', onclick: () => { state.tab = 'projects'; state.view = null; render(); } }, icon('folder_open'), ' Projekte'));
    const me = h('div', { class: 'bd-me' }, h('div', { class: 'bd-avatar', text: (state.profile?.displayName || '?')[0].toUpperCase() }),
        h('div', {}, h('b', { text: state.profile?.displayName || '' }), h('small', { text: '@' + (state.profile?.handle || '') })),
        h('button', { class: 'bd-icon', title: 'Profil bearbeiten', onclick: () => profileForm() }, icon('edit')));
    side.append(h('div', { class: 'bd-brand' }, icon('diversity_3'), h('span', { text: 'Code Buddy' }), h('button', { class: 'bd-icon', title: 'Schließen', onclick: () => Buddy.close() }, icon('close'))), me, tabs, h('div', { class: 'bd-list', id: 'bd-list' }));
    root.replaceChildren(h('div', { class: 'bd-card' }, side, main));
    return { side, main, list: side.querySelector('#bd-list') };
}

// ---------------- Profil ----------------
function profileForm(first) {
    const wrap = h('div', { class: 'bd-card bd-center' });
    const handle = h('input', { placeholder: 'benutzername (a-z, 0-9, _)', maxlength: 20, value: state.profile?.handle || '' });
    const name = h('input', { placeholder: 'Anzeigename', maxlength: 40, value: state.profile?.displayName || '' });
    const bio = h('input', { placeholder: 'Woran arbeitest du? (optional)', maxlength: 160, value: state.profile?.bio || '' });
    const err = h('div', { class: 'bd-err' });
    const save = h('button', { class: 'bd-primary', text: 'Speichern', onclick: async () => {
        try { const r = await api('/me', 'PUT', { handle: handle.value, displayName: name.value, bio: bio.value }); state.profile = r.profile; render(); }
        catch (e) { err.textContent = e.message; }
    } });
    wrap.append(h('div', { class: 'bd-hero' }, icon('diversity_3'), h('h2', { text: first ? 'Willkommen bei Code Buddy' : 'Dein Profil' }), h('p', { text: 'Verbinde dich mit anderen Codern, schreibt euch und baut gemeinsam Projekte.' })),
        h('label', { text: 'Benutzername' }), handle, h('label', { text: 'Anzeigename' }), name, h('label', { text: 'Über dich' }), bio, err,
        h('div', { class: 'bd-row' }, first ? null : h('button', { onclick: () => render(), text: 'Abbrechen' }), save));
    root.replaceChildren(h('div', { class: 'bd-card bd-solo' }, h('button', { class: 'bd-icon bd-x', title: 'Schließen', onclick: () => Buddy.close() }, icon('close')), wrap));
}

// ---------------- Rendern ----------------
async function render() {
    if (!state.profile) return profileForm(true);
    const { main, list } = shell();
    if (state.tab === 'friends') await renderFriends(main, list); else await renderProjects(main, list);
}

async function renderFriends(main, list) {
    const draw = async () => {
        const data = await api('/friends'); state.friends = data;
        const sel = list.dataset.sel || '';
        list.replaceChildren();
        const search = h('input', { class: 'bd-search', placeholder: '@benutzername suchen…', maxlength: 21 });
        const result = h('div', { class: 'bd-result' });
        search.addEventListener('keydown', guard(async (e) => {
            if (e.key !== 'Enter') return; result.replaceChildren();
            const { result: r } = await api('/search?handle=' + encodeURIComponent(search.value));
            if (!r) { result.append(h('small', { text: 'Niemanden gefunden.' })); return; }
            const row = h('div', { class: 'bd-item' }, h('div', { class: 'bd-avatar', text: r.displayName[0].toUpperCase() }), h('div', { class: 'grow' }, h('b', { text: r.displayName }), h('small', { text: '@' + r.handle })));
            const lbl = { self: 'Das bist du', friend: 'Befreundet', outgoing: 'Anfrage gesendet', incoming: 'Hat dir eine Anfrage gesendet' }[r.relation];
            if (lbl) row.append(h('small', { text: lbl })); else row.append(h('button', { class: 'bd-primary sm', text: 'Hinzufügen', onclick: guard(async () => { await api('/requests', 'POST', { handle: r.handle }); search.value = ''; result.replaceChildren(); toast('Anfrage gesendet'); await draw(); }) }));
            result.append(row);
        }));
        list.append(search, result);
        if (data.incoming.length) list.append(h('div', { class: 'bd-sec', text: 'Anfragen' }), ...data.incoming.map(u => h('div', { class: 'bd-item' }, h('div', { class: 'bd-avatar', text: u.displayName[0].toUpperCase() }), h('div', { class: 'grow' }, h('b', { text: u.displayName }), h('small', { text: '@' + u.handle })),
            h('button', { class: 'bd-icon ok', title: 'Annehmen', onclick: guard(async () => { await api(`/requests/${u.handle}/accept`, 'POST'); await draw(); updateBadge(); }) }, icon('check')),
            h('button', { class: 'bd-icon', title: 'Ablehnen', onclick: guard(async () => { await api(`/requests/${u.handle}/decline`, 'POST'); await draw(); updateBadge(); }) }, icon('close')))));
        list.append(h('div', { class: 'bd-sec', text: 'Freunde' }));
        if (!data.friends.length) list.append(h('small', { class: 'bd-empty', text: 'Noch keine Freunde. Suche oben nach einem Benutzernamen.' }));
        for (const f of data.friends) {
            const it = h('div', { class: 'bd-item clickable' + (state.view?.handle === f.handle ? ' active' : ''), onclick: () => openChat(f, main, list) },
                h('div', { class: 'bd-avatar' + (f.online ? ' online' : ''), text: f.displayName[0].toUpperCase() }), h('div', { class: 'grow' }, h('b', { text: f.displayName }), h('small', { text: '@' + f.handle })),
                f.unread ? h('span', { class: 'bd-badge', text: f.unread }) : null);
            list.append(it);
        }
        if (data.outgoing.length) list.append(h('div', { class: 'bd-sec', text: 'Gesendet' }), ...data.outgoing.map(u => h('div', { class: 'bd-item' }, h('div', { class: 'bd-avatar', text: u.displayName[0].toUpperCase() }), h('div', { class: 'grow' }, h('b', { text: u.displayName }), h('small', { text: 'wartet auf Antwort' })),
            h('button', { class: 'bd-icon', title: 'Zurückziehen', onclick: guard(async () => { await api('/friends/' + u.handle, 'DELETE'); await draw(); }) }, icon('close')))));
    };
    await draw();
    if (!state.view) main.replaceChildren(h('div', { class: 'bd-placeholder' }, icon('chat'), h('p', { text: 'Wähle einen Freund, um zu schreiben.' })));
    else openChat(state.view, main, list, true);
    every(6000, async () => { const keep = list.querySelector('.bd-search')?.value; if (!keep) await draw(); });
}

function openChat(friend, main, list, silent) {
    state.view = friend; if (!silent) list.querySelectorAll('.bd-item').forEach(i => i.classList.remove('active'));
    let lastId = 0; const seen = new Set();
    const log = h('div', { class: 'bd-log' });
    const input = h('textarea', { rows: 1, placeholder: `Nachricht an ${friend.displayName}…`, maxlength: 2000 });
    const add = (m) => { if (seen.has(m.id)) return; seen.add(m.id); lastId = Math.max(lastId, m.id); const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80; log.append(h('div', { class: 'bd-msg' + (m.mine ? ' mine' : '') }, h('div', { class: 'bd-bubble', text: m.body }), h('small', { text: timeStr(m.createdAt) }))); if (near || m.mine) log.scrollTop = log.scrollHeight; };
    const send = guard(async () => { const body = input.value.trim(); if (!body) return; input.value = ''; const r = await api('/messages/' + friend.handle, 'POST', { body }); add(r.message); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    main.replaceChildren(h('div', { class: 'bd-chat-head' }, h('div', { class: 'bd-avatar', text: friend.displayName[0].toUpperCase() }), h('div', { class: 'grow' }, h('b', { text: friend.displayName }), h('small', { text: '@' + friend.handle })),
        h('button', { class: 'bd-icon', title: 'Freund entfernen', onclick: guard(async () => { if (!confirm(`${friend.displayName} aus deinen Freunden entfernen?`)) return; await api('/friends/' + friend.handle, 'DELETE'); state.view = null; render(); }) }, icon('person_remove'))),
        log, h('div', { class: 'bd-compose' }, input, h('button', { class: 'bd-primary round', title: 'Senden', onclick: send }, icon('send'))));
    const poll = async () => { const r = await api(`/messages/${friend.handle}` + (lastId ? `?after=${lastId}` : '')); r.messages.forEach(add); if (r.messages.some(m => !m.mine)) updateBadge(); };
    poll().catch(e => toast(e.message)); every(3000, poll); input.focus();
}

// ---------------- Projekte ----------------
async function renderProjects(main, list) {
    const draw = async () => {
        const { projects } = await api('/projects'); state.projects = projects; list.replaceChildren();
        const title = h('input', { class: 'bd-search', placeholder: 'Neues Projekt… (Enter)', maxlength: 80 });
        title.addEventListener('keydown', guard(async (e) => { if (e.key !== 'Enter' || !title.value.trim()) return; const r = await api('/projects', 'POST', { title: title.value }); title.value = ''; await draw(); openProject(r.id, main, list); }));
        list.append(title, h('div', { class: 'bd-sec', text: 'Deine Projekte' }));
        if (!projects.length) list.append(h('small', { class: 'bd-empty', text: 'Noch keine Projekte. Gib oben einen Namen ein.' }));
        for (const p of projects) list.append(h('div', { class: 'bd-item clickable' + (state.view?.id === p.id ? ' active' : ''), onclick: () => openProject(p.id, main, list) }, icon('folder'), h('div', { class: 'grow' }, h('b', { text: p.title }), h('small', { text: `${p.members} Mitglied${p.members === 1 ? '' : 'er'}${p.role === 'owner' ? ' · Besitzer' : ''}` }))));
    };
    await draw();
    if (state.view?.id) openProject(state.view.id, main, list); else main.replaceChildren(h('div', { class: 'bd-placeholder' }, icon('code_blocks'), h('p', { text: 'Wähle ein Projekt oder lege ein neues an.' })));
}

async function openProject(id, main, list) {
    clearTimers();
    state.view = { id };
    list.querySelectorAll('.bd-item').forEach(i => i.classList.remove('active'));
    let data; try { data = await api('/projects/' + id); } catch (e) { toast(e.message); state.view = null; return render(); }
    let cur = null, dirty = false, lastMsg = 0; const seen = new Set();
    const files = h('div', { class: 'bd-files' }), members = h('div', { class: 'bd-members' });
    const editor = h('textarea', { class: 'bd-editor', spellcheck: 'false', placeholder: 'Datei links wählen oder neu anlegen…', disabled: true });
    const fname = h('b', { class: 'bd-fname', text: '—' }); const status = h('small', { class: 'bd-status' });
    const log = h('div', { class: 'bd-log small' }); const chatIn = h('textarea', { rows: 1, placeholder: 'Projekt-Chat…', maxlength: 2000 });

    const loadFile = guard(async (name) => { if (dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return; const f = await api(`/projects/${id}/file?name=${encodeURIComponent(name)}`); cur = { name, version: f.version }; editor.value = f.content; editor.disabled = false; dirty = false; fname.textContent = name; status.textContent = 'Version ' + f.version; drawFiles(); });
    const drawFiles = () => files.replaceChildren(...data.files.map(f => h('div', { class: 'bd-file' + (cur?.name === f.name ? ' active' : ''), onclick: () => loadFile(f.name) }, icon('description'), h('span', { class: 'grow', text: f.name }), h('small', { text: f.updatedBy ? '@' + f.updatedBy : '' }),
        h('button', { class: 'bd-icon sm', title: 'Löschen', onclick: guard(async (e) => { e.stopPropagation(); if (!confirm(`${f.name} löschen?`)) return; await api(`/projects/${id}/file?name=${encodeURIComponent(f.name)}`, 'DELETE'); if (cur?.name === f.name) { cur = null; editor.value = ''; editor.disabled = true; fname.textContent = '—'; } await refresh(); }) }, icon('delete')))));
    const drawMembers = () => members.replaceChildren(...data.members.map(m => h('span', { class: 'bd-chip' + (m.online ? ' online' : ''), title: m.role === 'owner' ? 'Besitzer' : 'Mitglied' }, '@' + m.handle, m.role === 'owner' ? ' 👑' : '',
        (data.project.role === 'owner' && m.role !== 'owner') ? h('button', { class: 'bd-x2', title: 'Entfernen', onclick: guard(async () => { await api(`/projects/${id}/members/${m.handle}`, 'DELETE'); await refresh(); }) }, '×') : null)));
    const refresh = async () => {
        const nd = await api('/projects/' + id); data = nd; drawFiles(); drawMembers();
        if (cur && !dirty) { const f = nd.files.find(x => x.name === cur.name); if (f && f.version !== cur.version) { const c = await api(`/projects/${id}/file?name=${encodeURIComponent(cur.name)}`); editor.value = c.content; cur.version = c.version; status.textContent = `Version ${c.version} · aktualisiert von @${f.updatedBy || '?'}`; } }
        else if (cur && dirty) { const f = nd.files.find(x => x.name === cur.name); if (f && f.version !== cur.version) status.textContent = `⚠ @${f.updatedBy || '?'} hat diese Datei geändert – beim Speichern gibt es einen Konflikt`; }
    };
    editor.addEventListener('input', () => { dirty = true; status.textContent = 'Ungespeichert…'; });
    editor.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); const s = editor.selectionStart; editor.setRangeText('  ', s, editor.selectionEnd, 'end'); dirty = true; } if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });
    const save = guard(async () => {
        if (!cur) return;
        try { const r = await api(`/projects/${id}/file`, 'PUT', { name: cur.name, content: editor.value, baseVersion: cur.version }); cur.version = r.version; dirty = false; status.textContent = 'Gespeichert · Version ' + r.version; await refresh(); }
        catch (e) { if (/geändert|gelöscht/.test(e.message)) { status.textContent = '⚠ ' + e.message; if (confirm(e.message + '\n\nDeine Fassung trotzdem speichern und die andere überschreiben?')) { const f = (await api('/projects/' + id)).files.find(x => x.name === cur.name); if (f) { const r = await api(`/projects/${id}/file`, 'PUT', { name: cur.name, content: editor.value, baseVersion: f.version }); cur.version = r.version; dirty = false; status.textContent = 'Gespeichert · Version ' + r.version; await refresh(); } } } else throw e; }
    });
    const newFile = guard(async () => { const name = prompt('Dateiname (z. B. main.py oder src/app.js):'); if (!name) return; await api(`/projects/${id}/file`, 'PUT', { name: name.trim(), content: '', baseVersion: 0 }); await refresh(); await loadFile(name.trim()); });
    const toCoden = () => { const inp = document.getElementById('main-input'); if (!inp) return; const code = editor.value.slice(0, 8000); inp.value = `Hilf mir bei meinem Projekt "${data.project.title}". Datei ${cur?.name || ''}:\n\n\`\`\`\n${code}\n\`\`\`\n\n`; inp.focus(); Buddy.close(); };
    const invite = guard(async () => { const friends = (await api('/friends')).friends.filter(f => !data.members.some(m => m.handle === f.handle)); if (!friends.length) return toast('Alle deine Freunde sind schon dabei (oder du hast noch keine).'); const handle = prompt('Welchen Freund einladen?\n' + friends.map(f => '@' + f.handle).join(', ')); if (!handle) return; await api(`/projects/${id}/members`, 'POST', { handle: handle.replace(/^@/, '').trim() }); await refresh(); toast('Eingeladen'); });
    const addMsg = (m) => { if (seen.has(m.id)) return; seen.add(m.id); lastMsg = Math.max(lastMsg, m.id); const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80; log.append(h('div', { class: 'bd-msg' + (m.mine ? ' mine' : '') }, m.mine ? null : h('small', { text: '@' + (m.handle || '?') }), h('div', { class: 'bd-bubble', text: m.body }))); if (near || m.mine) log.scrollTop = log.scrollHeight; };
    const sendChat = guard(async () => { const body = chatIn.value.trim(); if (!body) return; chatIn.value = ''; addMsg((await api(`/projects/${id}/messages`, 'POST', { body })).message); });
    chatIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
    const leave = guard(async () => { if (!confirm('Projekt verlassen?')) return; await api(`/projects/${id}/members/${state.profile.handle}`, 'DELETE'); state.view = null; render(); });
    const del = guard(async () => { if (!confirm(`„${data.project.title}“ samt allen Dateien endgültig löschen?`)) return; await api('/projects/' + id, 'DELETE'); state.view = null; render(); });

    main.replaceChildren(
        h('div', { class: 'bd-proj-head' }, h('div', { class: 'grow' }, h('b', { text: data.project.title }), h('small', { text: data.project.description })), members,
            data.project.role === 'owner' ? h('button', { class: 'bd-btn', onclick: invite }, icon('person_add'), ' Einladen') : null,
            data.project.role === 'owner' ? h('button', { class: 'bd-icon', title: 'Projekt löschen', onclick: del }, icon('delete_forever')) : h('button', { class: 'bd-icon', title: 'Verlassen', onclick: leave }, icon('logout'))),
        h('div', { class: 'bd-proj-body' },
            h('div', { class: 'bd-files-col' }, h('div', { class: 'bd-sec row' }, h('span', { text: 'Dateien' }), h('button', { class: 'bd-icon sm', title: 'Neue Datei', onclick: newFile }, icon('add'))), files),
            h('div', { class: 'bd-editor-col' }, h('div', { class: 'bd-editor-bar' }, fname, status, h('span', { class: 'grow' }), h('button', { class: 'bd-btn', onclick: toCoden, title: 'Datei an Coden schicken' }, icon('auto_awesome'), ' Mit Coden besprechen'), h('button', { class: 'bd-primary sm', onclick: save }, icon('save'), ' Speichern')), editor),
            h('div', { class: 'bd-pchat' }, h('div', { class: 'bd-sec', text: 'Projekt-Chat' }), log, h('div', { class: 'bd-compose' }, chatIn, h('button', { class: 'bd-primary round', onclick: sendChat }, icon('send'))))));
    drawFiles(); drawMembers();
    const pollMsgs = async () => { const r = await api(`/projects/${id}/messages` + (lastMsg ? `?after=${lastMsg}` : '')); r.messages.forEach(addMsg); };
    pollMsgs().catch(() => {}); clearTimers(); every(3000, pollMsgs); every(5000, refresh);
}

// ---------------- Öffentliche API ----------------
async function updateBadge() {
    if (!auth.currentUser || !badge) return;
    try { const s = await api('/summary'); const n = (s.unread || 0) + (s.requests || 0); badge.textContent = n > 9 ? '9+' : String(n); badge.style.display = n ? 'inline-flex' : 'none'; } catch (_) {}
}

export const Buddy = {
    init() {
        build();
        const btn = document.getElementById('open-buddy-btn'); if (!btn) return;
        badge = btn.querySelector('.bd-nav-badge'); btn.addEventListener('click', (e) => { e.preventDefault(); Buddy.open(); });
        setTimeout(updateBadge, 1500); setInterval(() => { if (!document.hidden && !root.classList.contains('open')) updateBadge(); }, 30000);
    },
    async open() {
        root.classList.add('open'); document.body.classList.add('buddy-open');
        root.replaceChildren(h('div', { class: 'bd-loading' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i'))));
        try { state.profile = (await api('/me')).profile; await render(); } catch (e) { root.replaceChildren(h('div', { class: 'bd-card bd-solo' }, h('button', { class: 'bd-icon bd-x', onclick: () => Buddy.close() }, icon('close')), h('div', { class: 'bd-center' }, h('p', { class: 'bd-err', text: e.message })))); }
    },
    close() { clearTimers(); root.classList.remove('open'); document.body.classList.remove('buddy-open'); updateBadge(); }
};
