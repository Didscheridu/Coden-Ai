// js/buddy.js – Code Buddy: Freunde, Nachrichten, gemeinsame Projekte (alles per DOM/textContent, kein innerHTML mit Nutzerdaten)
import { apiJson } from './backend.js';
import { auth } from './auth.js';
import { md } from './apps/dom.js';

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

// Eine Chat-Nachricht zeichnen: Menschen als Text, Coden mit Markdown (Codeblöcke), geteilte Apps/Projekte als Karte
function msgEl(m, { withName } = {}) {
    const name = m.ai ? h('small', { class: 'bd-ai-name' }, icon('auto_awesome'), ' Coden') : (withName && !m.mine ? h('small', { text: '@' + (m.handle || '?') }) : null);
    let body;
    if (m.ai) body = h('div', { class: 'bd-bubble ai' }, md(m.body));
    else if (m.attachment) body = h('div', { class: 'bd-bubble card' }, h('div', { class: 'bd-attach' }, icon(m.attachment.type === 'app' ? 'apps' : 'folder_open'),
        h('div', { class: 'grow' }, h('b', { text: m.attachment.name }), h('small', { text: m.attachment.type === 'app' ? (m.attachment.role === 'editor' ? 'App · du darfst bearbeiten' : 'App · nur ansehen') : 'Projekt · du bist Mitglied' })),
        h('button', { class: 'bd-btn', onclick: () => { if (m.attachment.type === 'app') location.hash = '#/apps/' + m.attachment.id; else { state.server = null; state.tab = 'projects'; state.view = { id: m.attachment.id }; history.replaceState(null, '', '#/buddy/projekte'); render(); } } }, 'Öffnen')));
    else body = h('div', { class: 'bd-bubble', text: m.body });
    return h('div', { class: 'bd-msg' + (m.mine ? ' mine' : '') + (m.ai ? ' ai' : '') }, name, body, m.createdAt ? h('small', { text: timeStr(m.createdAt) }) : null);
}
// „Coden schreibt …“, solange die KI antwortet
function typing(log) { const t = h('div', { class: 'bd-msg ai typing' }, h('small', { class: 'bd-ai-name' }, icon('auto_awesome'), ' Coden schreibt …')); log.append(t); log.scrollTop = log.scrollHeight; return () => t.remove(); }

let root, badge, state = { profile: null, tab: 'friends', view: null, friends: null, projects: [], timers: [], server: null, servers: [], channel: null };

function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }
function every(ms, fn) { const t = setInterval(() => { if (!document.hidden && root?.classList.contains('open')) fn().catch(() => {}); }, ms); state.timers.push(t); }
function toast(msg) { const t = h('div', { class: 'bd-toast', text: msg }); root.appendChild(t); setTimeout(() => t.remove(), 3500); }
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// ---------------- Rahmen ----------------
function build() {
    root = h('div', { id: 'buddy-view', class: 'buddy-view', 'aria-label': 'Code Buddy' });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.isConnected && !e.target.closest('input, textarea, .cd-overlay')) Buddy.close(); });
}

const TABS = [['friends', 'group', 'Freunde'], ['projects', 'folder_open', 'Projekte'], ['apps', 'apps', 'Gemeinsame Apps']];
function shell() {
    clearTimers();
    const side = h('div', { class: 'bd-side' });
    const main = h('div', { class: 'bd-main' });
    const tabs = h('nav', { class: 'bd-tabs', role: 'tablist' }, ...TABS.map(([id, ic, label]) =>
        h('button', { class: state.tab === id ? 'active' : '', role: 'tab', 'aria-selected': String(state.tab === id), onclick: () => { if (state.tab === id && !state.server) return; state.tab = id; state.server = null; state.view = null; history.replaceState(null, '', '#/buddy' + (id === 'friends' ? '' : '/' + ({ projects: 'projekte', apps: 'apps' }[id]))); render(); } }, icon(ic), h('span', { text: label }))));
    const me = h('button', { class: 'bd-me', title: 'Profil bearbeiten', onclick: () => profileForm() }, h('div', { class: 'bd-avatar', text: (state.profile?.displayName || '?')[0].toUpperCase() }),
        h('div', {}, h('b', { text: state.profile?.displayName || '' }), h('small', { text: '@' + (state.profile?.handle || '') })), icon('edit'));
    const top = h('header', { class: 'bd-top' },
        h('button', { class: 'bd-back', title: 'Zurück zum Chat (Esc)', onclick: () => Buddy.close() }, icon('arrow_back'), h('span', { text: 'Zurück' })),
        h('div', { class: 'bd-brand' }, icon('diversity_3'), h('span', { text: 'Code Buddy' })), tabs, h('span', { class: 'grow' }), me);
    side.append(h('div', { class: 'bd-list', id: 'bd-list' }));
    root.replaceChildren(h('div', { class: 'bd-card' }, top, h('div', { class: 'bd-cols' }, rail(), side, main)));
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
    root.replaceChildren(h('div', { class: 'bd-card bd-solo' }, h('button', { class: 'bd-back bd-x', title: first ? 'Zurück zum Chat' : 'Abbrechen', onclick: () => first ? Buddy.close() : render() }, icon('arrow_back'), h('span', { text: 'Zurück' })), wrap));
}

// ---------------- Rendern ----------------
async function render() {
    if (!state.profile) return profileForm(true);
    const { main, list } = shell();
    if (state.server) await renderServer(main, list); else if (state.tab === 'friends') await renderFriends(main, list); else if (state.tab === 'apps') await renderApps(main, list); else await renderProjects(main, list);
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
    const input = h('textarea', { rows: 1, placeholder: `Nachricht an ${friend.displayName} … (mit @coden fragst du die KI)`, maxlength: 2000 });
    const add = (m) => { if (seen.has(m.id)) return; seen.add(m.id); lastId = Math.max(lastId, m.id); const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80; log.append(msgEl(m)); if (near || m.mine) log.scrollTop = log.scrollHeight; };
    const post = async (payload) => {
        const wantsAi = /(^|[^a-z0-9_])@coden(?![a-z0-9_])/i.test(payload.body || '');
        const done = wantsAi ? typing(log) : null;
        try { const r = await api('/messages/' + friend.handle, 'POST', payload); add(r.message); if (r.reply) add(r.reply); if (r.codenError) toast(r.codenError); }
        finally { done?.(); }
    };
    const send = guard(async () => { const body = input.value.trim(); if (!body) return; input.value = ''; await post({ body }); });
    const share = () => shareDialog(friend, async (attachment) => { await post({ attachment }); toast('Geteilt'); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    main.replaceChildren(h('div', { class: 'bd-chat-head' }, h('div', { class: 'bd-avatar', text: friend.displayName[0].toUpperCase() }), h('div', { class: 'grow' }, h('b', { text: friend.displayName }), h('small', { text: '@' + friend.handle })),
        h('button', { class: 'bd-icon', title: 'Freund entfernen', onclick: guard(async () => { if (!confirm(`${friend.displayName} aus deinen Freunden entfernen?`)) return; await api('/friends/' + friend.handle, 'DELETE'); state.view = null; render(); }) }, icon('person_remove'))),
        log, h('div', { class: 'bd-compose' }, h('button', { class: 'bd-icon', title: 'App oder Projekt teilen', onclick: guard(share) }, icon('attach_file')), input, h('button', { class: 'bd-primary round', title: 'Senden', onclick: send }, icon('send'))));
    const poll = async () => { const r = await api(`/messages/${friend.handle}` + (lastId ? `?after=${lastId}` : '')); r.messages.forEach(add); if (r.messages.some(m => !m.mine && !m.ai)) updateBadge(); };
    poll().catch(e => toast(e.message)); every(3000, poll); input.focus();
}

// App oder Projekt per DM teilen (gibt dem Freund sofort Zugriff)
async function shareDialog(friend, onPick) {
    const [apps, projects] = await Promise.all([apiJson('/apps').then(d => d.apps.filter(a => a.role === 'owner')).catch(() => []), api('/projects').then(d => d.projects.filter(p => p.role === 'owner')).catch(() => [])]);
    const role = h('select', { class: 'bd-role' }, h('option', { value: 'viewer', text: 'nur ansehen' }), h('option', { value: 'editor', text: 'darf bearbeiten' }));
    const ov = h('div', { class: 'bd-ov', onclick: (e) => { if (e.target === ov) ov.remove(); } });
    const pickIt = (att) => async () => { ov.remove(); try { await onPick(att); } catch (e) { toast(e.message); } };
    const row = (ic, title, sub, att) => h('div', { class: 'bd-item clickable', onclick: pickIt(att) }, icon(ic), h('div', { class: 'grow' }, h('b', { text: title }), h('small', { text: sub })), icon('send'));
    ov.append(h('div', { class: 'bd-dlg' }, h('h3', { text: `An ${friend.displayName} teilen` }),
        apps.length ? h('label', { text: 'Rechte für Apps' }) : null, apps.length ? role : null,
        h('div', { class: 'bd-sec', text: 'Deine Apps' }), ...(apps.length ? apps.map(a => h('div', { class: 'bd-item clickable', onclick: () => pickIt({ type: 'app', id: a.id, role: role.value })() }, icon('apps'), h('div', { class: 'grow' }, h('b', { text: a.name }), h('small', { text: 'App' })), icon('send'))) : [h('small', { class: 'bd-empty', text: 'Du hast noch keine eigene App.' })]),
        h('div', { class: 'bd-sec', text: 'Deine Code-Buddy-Projekte' }), ...(projects.length ? projects.map(p => row('folder_open', p.title, 'Projekt · Freund wird Mitglied', { type: 'project', id: p.id })) : [h('small', { class: 'bd-empty', text: 'Noch kein Projekt.' })]),
        h('button', { class: 'bd-btn', text: 'Abbrechen', onclick: () => ov.remove() })));
    root.appendChild(ov);
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

// ---------------- Gemeinsame Apps ----------------
async function renderApps(main, list) {
    let apps = [];
    try { apps = (await apiJson('/apps')).apps; } catch (e) { toast(e.message); }
    const shared = apps.filter(a => a.members > 1 || a.role !== 'owner'); const mine = apps.filter(a => a.role === 'owner' && a.members < 2);
    list.replaceChildren(h('div', { class: 'bd-sec', text: 'Gemeinsam' }), ...(shared.length ? shared.map(a => appRow(a)) : [h('small', { class: 'bd-empty', text: 'Noch keine gemeinsamen Apps.' })]),
        mine.length ? h('div', { class: 'bd-sec', text: 'Nur du – Freunde einladen' }) : null, ...mine.map(a => appRow(a)));
    main.replaceChildren(h('div', { class: 'bd-placeholder' }, icon('apps'), h('h3', { text: 'Apps zusammen bauen' }),
        h('p', { text: 'Öffne eine App und klicke oben auf „Einladen“. Deine Freunde sehen dann den Chat mit Coden, die Vorschau und den Code – und können mitbauen.' }),
        h('button', { class: 'bd-primary', onclick: () => { location.hash = '#/apps'; } }, icon('apps'), ' Zu deinen Apps')));
    function appRow(a) {
        return h('div', { class: 'bd-item clickable', onclick: () => { location.hash = '#/apps/' + a.id; } }, h('div', { class: 'bd-avatar', style: `background:${/^#[0-9a-f]{6}$/i.test(a.themeColor) ? a.themeColor : '#8ab4f8'}`, text: a.name[0].toUpperCase() }),
            h('div', { class: 'grow' }, h('b', { text: a.name }), h('small', { text: `${a.members} Person${a.members === 1 ? '' : 'en'}${a.role === 'owner' ? ' · Besitzer' : ' · eingeladen'}${a.published ? ' · Live' : ''}` })), icon('chevron_right'));
    }
}


// ---------------- Server (wie Discord) ----------------
const ROLE = { owner: 'Besitzer', editor: 'Bearbeiter', viewer: 'Zuschauer' };
const COLORS = ['#8ab4f8', '#81c995', '#f28b82', '#fdd663', '#c58af9', '#ff8bcb'];
function rail() {
    const goHome = () => { state.server = null; state.view = null; history.replaceState(null, '', '#/buddy'); render(); };
    const pick = (id) => { state.server = id; state.channel = null; history.replaceState(null, '', '#/buddy/server/' + id); render(); };
    return h('nav', { class: 'bd-rail', 'aria-label': 'Server' },
        h('button', { class: 'bd-srv home' + (state.server ? '' : ' active'), title: 'Startseite: Freunde, Projekte, Apps', onclick: goHome }, icon('home')),
        h('div', { class: 'bd-rail-sep' }),
        ...state.servers.map(s => h('button', { class: 'bd-srv' + (state.server === s.id ? ' active' : ''), title: s.name, style: `--c:${/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#8ab4f8'}`, onclick: () => pick(s.id), text: (s.name[0] || '?').toUpperCase() })),
        h('button', { class: 'bd-srv add', title: 'Server erstellen oder beitreten', onclick: () => serverDialog(pick) }, icon('add')));
}
async function loadServers() { try { state.servers = (await apiJson('/servers')).servers; } catch (_) { state.servers = []; } }
function serverDialog(pick) {
    const name = h('input', { placeholder: 'Name des Servers', maxlength: 40 });
    const code = h('input', { placeholder: 'Einladungscode', maxlength: 10 });
    const err = h('div', { class: 'bd-err' });
    const ov = h('div', { class: 'bd-ov', onclick: (e) => { if (e.target === ov) ov.remove(); } }, h('div', { class: 'bd-dlg' },
        h('h3', { text: 'Server' }), h('label', { text: 'Neuen Server erstellen' }), name,
        h('button', { class: 'bd-primary', text: 'Erstellen', onclick: async () => { try { const r = await apiJson('/servers', { method: 'POST', body: JSON.stringify({ name: name.value, color: COLORS[state.servers.length % COLORS.length] }) }); ov.remove(); await loadServers(); pick(r.server.id); } catch (e) { err.textContent = e.message; } } }),
        h('div', { class: 'bd-rail-sep wide' }), h('label', { text: 'Oder mit Code beitreten' }), code,
        h('button', { class: 'bd-btn', text: 'Beitreten', onclick: async () => { try { const r = await apiJson('/servers/join', { method: 'POST', body: JSON.stringify({ code: code.value }) }); ov.remove(); await loadServers(); pick(r.server.id); } catch (e) { err.textContent = e.message; } } }),
        err, h('button', { class: 'bd-btn', text: 'Schließen', onclick: () => ov.remove() })));
    root.appendChild(ov); name.focus();
}

async function renderServer(main, list) {
    const id = state.server; let d;
    try { d = await apiJson('/servers/' + id); } catch (e) { toast(e.message); state.server = null; await loadServers(); return render(); }
    const me = d.server.role, canEdit = me !== 'viewer', isOwner = me === 'owner';
    if (!state.channel || !d.channels.some(c => c.id === state.channel)) state.channel = d.channels[0]?.id;
    const refresh = () => render();
    const sApi = (path, method = 'GET', body) => apiJson(`/servers/${id}${path}`, { method, body: body ? JSON.stringify(body) : undefined });

    list.replaceChildren(
        h('div', { class: 'bd-srv-head' }, h('b', { text: d.server.name }), h('small', { text: ROLE[me] })),
        isOwner ? h('div', { class: 'bd-invite' }, h('small', { text: 'Einladungscode' }), h('code', { text: d.server.inviteCode }),
            h('button', { class: 'bd-icon sm', title: 'Kopieren', onclick: guard(async () => { await navigator.clipboard.writeText(d.server.inviteCode); toast('Code kopiert'); }) }, icon('content_copy')),
            h('button', { class: 'bd-icon sm', title: 'Neuen Code erzeugen', onclick: guard(async () => { if (!confirm('Der alte Code funktioniert danach nicht mehr. Fortfahren?')) return; await sApi('/invite/reset', 'POST'); refresh(); }) }, icon('autorenew'))) : null,
        h('div', { class: 'bd-sec row' }, h('span', { text: 'Kanäle' }), canEdit ? h('button', { class: 'bd-icon sm', title: 'Kanal anlegen', onclick: guard(async () => { const n = prompt('Name des Kanals:'); if (!n) return; const r = await sApi('/channels', 'POST', { name: n }); state.channel = r.channel.id; refresh(); }) }, icon('add')) : null),
        ...d.channels.map(c => h('div', { class: 'bd-item clickable' + (state.channel === c.id ? ' active' : ''), onclick: () => { state.channel = c.id; refresh(); } }, icon('tag'), h('div', { class: 'grow' }, h('b', { text: c.name })),
            isOwner && d.channels.length > 1 ? h('button', { class: 'bd-icon sm', title: 'Kanal löschen', onclick: guard(async (e) => { e.stopPropagation(); if (!confirm(`#${c.name} samt Nachrichten löschen?`)) return; await sApi('/channels/' + c.id, 'DELETE'); state.channel = null; refresh(); }) }, icon('delete')) : null)),
        h('div', { class: 'bd-sec row' }, h('span', { text: 'Geteilte Apps' }), canEdit ? h('button', { class: 'bd-icon sm', title: 'Eine deiner Apps teilen', onclick: guard(async () => {
            const mine = (await apiJson('/apps')).apps.filter(a => a.role === 'owner' && !d.apps.some(x => x.id === a.id));
            if (!mine.length) return toast('Du hast keine App, die du noch teilen kannst.');
            const pickName = prompt('Welche App teilen?\n' + mine.map(a => a.name).join(', ')); if (!pickName) return;
            const app = mine.find(a => a.name.toLowerCase() === pickName.trim().toLowerCase()); if (!app) return toast('Diese App gibt es nicht.');
            await sApi('/apps', 'POST', { appId: app.id }); refresh();
        }) }, icon('add')) : null),
        ...(d.apps.length ? d.apps.map(a => h('div', { class: 'bd-item clickable', onclick: () => { location.hash = '#/apps/' + a.id; } }, h('div', { class: 'bd-avatar', style: `background:${/^#[0-9a-f]{6}$/i.test(a.themeColor) ? a.themeColor : '#8ab4f8'}`, text: a.name[0].toUpperCase() }),
            h('div', { class: 'grow' }, h('b', { text: a.name }), h('small', { text: 'von @' + (a.by || '?') + (me === 'viewer' ? ' · nur ansehen' : ' · bearbeitbar') })),
            (isOwner || a.by === state.profile.handle) ? h('button', { class: 'bd-icon sm', title: 'Nicht mehr teilen', onclick: guard(async (e) => { e.stopPropagation(); await sApi('/apps/' + a.id, 'DELETE'); refresh(); }) }, icon('link_off')) : icon('chevron_right'))) : [h('small', { class: 'bd-empty', text: 'Noch nichts geteilt.' })]),
        h('div', { class: 'bd-sec', text: `Mitglieder – ${d.members.length}` }),
        ...d.members.map(m => h('div', { class: 'bd-item' }, h('div', { class: 'bd-avatar' + (m.online ? ' online' : ''), text: (m.displayName || '?')[0].toUpperCase() }),
            h('div', { class: 'grow' }, h('b', { text: m.displayName + (m.me ? ' (du)' : '') }), h('small', { text: '@' + m.handle })),
            (isOwner && m.role !== 'owner')
                ? h('select', { class: 'bd-role', title: 'Rolle', onchange: guard(async (e) => { await sApi('/members/' + m.handle, 'PATCH', { role: e.target.value }); refresh(); }) }, ...['editor', 'viewer'].map(r => h('option', { value: r, text: ROLE[r], selected: m.role === r ? '' : null })))
                : h('small', { class: 'bd-rolechip', text: ROLE[m.role] }),
            (isOwner && m.role !== 'owner') ? h('button', { class: 'bd-icon sm', title: 'Entfernen', onclick: guard(async () => { if (!confirm(`@${m.handle} vom Server entfernen?`)) return; await sApi('/members/' + m.handle, 'DELETE'); refresh(); }) }, icon('person_remove')) : null)),
        isOwner ? h('div', { class: 'bd-row' }, h('button', { class: 'bd-btn', onclick: guard(async () => { const f = prompt('Freund per @Benutzername hinzufügen (als Zuschauer):'); if (!f) return; await sApi('/members', 'POST', { handle: f.replace(/^@/, '').trim() }); refresh(); }) }, icon('person_add'), ' Freund hinzufügen'),
            h('button', { class: 'bd-icon', title: 'Server löschen', onclick: guard(async () => { if (!confirm(`„${d.server.name}“ mit allen Kanälen löschen?`)) return; await sApi('', 'DELETE'); state.server = null; await loadServers(); render(); }) }, icon('delete_forever')))
            : h('div', { class: 'bd-row' }, h('button', { class: 'bd-btn', onclick: guard(async () => { if (!confirm('Server verlassen?')) return; await sApi('/members/' + state.profile.handle, 'DELETE'); state.server = null; await loadServers(); render(); }) }, icon('logout'), ' Verlassen')));

    // Kanal-Chat
    const ch = d.channels.find(c => c.id === state.channel);
    const log = h('div', { class: 'bd-log' }); const seen = new Set(); let last = 0;
    const input = h('textarea', { rows: 1, placeholder: `Nachricht in #${ch?.name || ''} … (mit @coden fragst du die KI)`, maxlength: 2000 });
    const add = (m) => { if (seen.has(m.id)) return; seen.add(m.id); last = Math.max(last, m.id); const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        log.append(msgEl(m, { withName: true })); if (near || m.mine) log.scrollTop = log.scrollHeight; };
    const send = guard(async () => {
        const body = input.value.trim(); if (!body || !ch) return; input.value = '';
        const done = /(^|[^a-z0-9_])@coden(?![a-z0-9_])/i.test(body) ? typing(log) : null;
        try { const r = await sApi(`/channels/${ch.id}/messages`, 'POST', { body }); add(r.message); if (r.reply) add(r.reply); if (r.codenError) toast(r.codenError); } finally { done?.(); }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    main.replaceChildren(h('div', { class: 'bd-chat-head' }, icon('tag'), h('div', { class: 'grow' }, h('b', { text: ch?.name || '' }), h('small', { text: d.server.name }))), log,
        h('div', { class: 'bd-compose' }, input, h('button', { class: 'bd-primary round', title: 'Senden', onclick: send }, icon('send'))));
    const poll = async () => { if (!ch) return; const r = await sApi(`/channels/${ch.id}/messages` + (last ? `?after=${last}` : '')); r.messages.forEach(add); };
    poll().catch(e => toast(e.message)); every(3000, poll);
    every(8000, async () => { const nd = await apiJson('/servers/' + id); if (JSON.stringify(nd.members.map(m => [m.handle, m.role])) !== JSON.stringify(d.members.map(m => [m.handle, m.role])) || nd.apps.length !== d.apps.length || nd.channels.length !== d.channels.length) refresh(); });
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
        badge = btn.querySelector('.bd-nav-badge');
        setTimeout(updateBadge, 1500); setInterval(() => { if (!document.hidden && !root.isConnected) updateBadge(); }, 30000);
    },
    // Als Tab: #/buddy, #/buddy/projekte, #/buddy/apps
    open(opts = {}) { location.hash = '#/buddy' + (opts.tab === 'projects' ? '/projekte' : opts.tab === 'apps' ? '/apps' : ''); },
    async mount(host, params = []) {
        const tab = { projekte: 'projects', projects: 'projects', apps: 'apps' }[params[0]] || 'friends';
        if (tab !== state.tab) { state.tab = tab; state.view = null; }
        state.server = params[0] === 'server' && Number(params[1]) ? Number(params[1]) : (params[0] ? null : state.server);
        host.appendChild(root); root.classList.add('open'); document.body.classList.add('buddy-open');
        root.replaceChildren(h('div', { class: 'bd-loading' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i'))));
        try { state.profile = (await api('/me')).profile; await loadServers(); if (state.server && !state.servers.some(x => x.id === state.server)) state.server = null; await render(); } catch (e) { root.replaceChildren(h('div', { class: 'bd-card bd-solo' }, h('button', { class: 'bd-back bd-x', onclick: () => Buddy.close() }, icon('arrow_back'), h('span', { text: 'Zurück' })), h('div', { class: 'bd-center' }, h('p', { class: 'bd-err', text: e.message })))); }
    },
    unmount() { clearTimers(); root.classList.remove('open'); root.remove(); document.body.classList.remove('buddy-open'); updateBadge(); },
    close() { location.hash = '#/chat'; }
};
