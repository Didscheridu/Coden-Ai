// Code-Buddy-Server (wie Discord): Server mit Kanälen, Mitgliedern und Rollen in Firebase Firestore.
// Rollen: owner (alles), editor (schreiben + geteilte Apps bearbeiten + Kanäle anlegen), viewer (lesen, im Chat schreiben, Apps ansehen).
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');
const Coden = require('./coden-chat');

const LIMITS = { servers: 10, members: 50, channels: 10, msg: 2000, shares: 30 };
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CODE_RE = /^[a-z0-9]{10}$/;
const bad = (res, status, error) => res.status(status).json({ error });
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const code = () => crypto.randomBytes(8).toString('hex').replace(/[^a-z0-9]/g, '').slice(0, 10).padEnd(10, 'x');
const chName = (v) => String(v ?? '').toLowerCase().trim().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const pairKey = (a, b) => [a, b].sort().join('__');

function serversRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);

  async function needProfile(req, res, next) {
    try {
      const p = await db.getDoc(`profiles/${req.user.uid}`);
      if (!p) return bad(res, 409, 'Lege zuerst dein Code-Buddy-Profil an.');
      req.profile = p; next();
    } catch (e) { next(e); }
  }
  r.use(needProfile);

  async function member(req, res, need) {
    const id = toInt(req.params.id); if (!id) { bad(res, 404, 'Server nicht gefunden.'); return null; }
    const [s, m] = await Promise.all([
      db.getDoc(`servers/${id}`),
      db.getDoc(`servers/${id}/members/${req.user.uid}`)
    ]);
    if (!s || !m) { bad(res, 404, 'Server nicht gefunden.'); return null; }
    if (need === 'owner' && m.role !== 'owner') { bad(res, 403, 'Das darf nur der Besitzer.'); return null; }
    if (need === 'editor' && m.role === 'viewer') { bad(res, 403, 'Dafür brauchst du die Rolle „Bearbeiter“.'); return null; }
    return { ...s, role: m.role };
  }
  const info = (s) => ({ id: Number(s.id), name: s.name, color: s.color, role: s.role });

  async function membersOf(serverId, uid) {
    const rows = await db.listDocs(`servers/${serverId}/members`);
    const enriched = await Promise.all(rows.map(async (m) => {
      const p = await db.getDoc(`profiles/${m.uid}`).catch(() => null);
      return {
        uid: m.uid,
        handle: p?.handle || null,
        displayName: p?.display_name || p?.handle || null,
        role: m.role,
        last_seen: p?.last_seen || null
      };
    }));
    const rank = { owner: 0, editor: 1, viewer: 2 };
    enriched.sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || String(a.handle || '').localeCompare(String(b.handle || '')));
    return enriched.map(m => ({
      handle: m.handle,
      displayName: m.displayName,
      role: m.role,
      me: m.uid === uid,
      online: m.last_seen ? Date.now() - new Date(m.last_seen).getTime() < 120000 : false
    }));
  }

  r.get('/', async (req, res) => {
    const srvs = await db.runQuery('servers', { where: [['memberUids', 'ARRAY_CONTAINS', req.user.uid]], orderBy: 'id' });
    const out = [];
    for (const s of srvs) {
      const m = await db.getDoc(`servers/${s.id}/members/${req.user.uid}`);
      if (m) out.push(info({ ...s, role: m.role }));
    }
    res.json({ servers: out });
  });

  r.post('/', rateLimit('server-create', 30, 600), async (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 40);
    if (!name) return bad(res, 400, 'Gib dem Server einen Namen.');
    const myServers = await db.runQuery('servers', { where: [['memberUids', 'ARRAY_CONTAINS', req.user.uid]] });
    if (myServers.length >= LIMITS.servers) return bad(res, 400, `Du bist schon in ${LIMITS.servers} Servern.`);
    const color = COLOR_RE.test(req.body?.color || '') ? req.body.color : '#8ab4f8';
    const id = db.nextId();
    const now = db.nowIso();
    let invCode = code();
    for (let i = 0; i < 4; i++) {
      try {
        await db.createDoc(`server_invites/${invCode}`, { code: invCode, server_id: id, owner: req.user.uid });
        break;
      } catch (e) {
        if (e.code === 'ALREADY_EXISTS') invCode = code();
        else throw e;
      }
    }
    const s = await db.createDoc(`servers/${id}`, {
      id, name, color, owner: req.user.uid, invite_code: invCode, memberUids: [req.user.uid], created_at: now
    });
    await db.setDoc(`servers/${id}/members/${req.user.uid}`, { server_id: id, uid: req.user.uid, role: 'owner', joined_at: now });
    const cid = db.nextId();
    await db.createDoc(`servers/${id}/channels/${cid}`, { id: cid, server_id: id, name: 'allgemein', created_at: now });
    res.json({ server: info({ ...s, role: 'owner' }) });
  });

  // Einladungscode einlösen (landet als Zuschauer; der Besitzer kann die Rolle ändern)
  r.post('/join', rateLimit('server-join', 20, 600), async (req, res) => {
    const c = String(req.body?.code ?? '').trim().toLowerCase();
    if (!CODE_RE.test(c)) return bad(res, 404, 'Diesen Einladungscode gibt es nicht.');
    const inv = await db.getDoc(`server_invites/${c}`);
    if (!inv) return bad(res, 404, 'Diesen Einladungscode gibt es nicht.');
    const s = await db.getDoc(`servers/${inv.server_id}`, { preferAdmin: true });
    if (!s || s.invite_code !== c) return bad(res, 404, 'Diesen Einladungscode gibt es nicht.');
    const curMembers = Array.isArray(s.memberUids) ? s.memberUids : [];
    if (curMembers.includes(req.user.uid)) {
      const m = await db.getDoc(`servers/${s.id}/members/${req.user.uid}`);
      return res.json({ server: info({ ...s, role: m?.role || 'viewer' }), already: true });
    }
    if (curMembers.length >= LIMITS.members) return bad(res, 400, 'Der Server ist voll.');
    const myServers = await db.runQuery('servers', { where: [['memberUids', 'ARRAY_CONTAINS', req.user.uid]] });
    if (myServers.length >= LIMITS.servers) return bad(res, 400, `Du bist schon in ${LIMITS.servers} Servern.`);
    await db.updateDoc(`servers/${s.id}`, { memberUids: [...curMembers, req.user.uid] }, { updateTime: s._updateTime, preferAdmin: true });
    await db.createDoc(`servers/${s.id}/members/${req.user.uid}`, { server_id: s.id, uid: req.user.uid, role: 'viewer', joined_at: db.nowIso() });
    res.json({ server: info({ ...s, role: 'viewer' }) });
  });

  r.get('/:id', async (req, res) => {
    const s = await member(req, res); if (!s) return;
    const [channels, shareDocs, members] = await Promise.all([
      db.listDocs(`servers/${s.id}/channels`, { orderBy: 'id' }),
      db.listDocs(`servers/${s.id}/shares`, { orderBy: 'created_at', desc: true }),
      membersOf(s.id, req.user.uid)
    ]);
    const apps = await Promise.all(shareDocs.map(async (x) => {
      const p = await db.getDoc(`profiles/${x.shared_by}`).catch(() => null);
      const a = await db.getDoc(`apps/${x.app_id}`, { preferAdmin: true }).catch(() => null);
      return {
        id: Number(x.app_id),
        name: a?.name ?? x.name,
        kind: a?.kind ?? x.kind,
        themeColor: a?.theme_color ?? x.theme_color,
        by: p?.handle || null,
        published: a ? !!a.published : !!x.published
      };
    }));
    res.json({
      server: { ...info(s), inviteCode: s.role === 'owner' ? s.invite_code : undefined },
      channels: channels.map(c => ({ id: Number(c.id), name: c.name })),
      members,
      apps
    });
  });

  r.patch('/:id', async (req, res) => {
    const s = await member(req, res, 'owner'); if (!s) return;
    const name = 'name' in (req.body || {}) ? String(req.body.name).trim().slice(0, 40) : s.name;
    if (!name) return bad(res, 400, 'Der Name darf nicht leer sein.');
    const color = COLOR_RE.test(req.body?.color || '') ? req.body.color : s.color;
    const u = await db.updateDoc(`servers/${s.id}`, { name, color });
    res.json({ server: info({ ...(u || s), role: s.role }) });
  });

  r.delete('/:id', async (req, res) => {
    const s = await member(req, res, 'owner'); if (!s) return;
    await db.deleteDoc(`server_invites/${s.invite_code}`).catch(() => {});
    await db.deleteTree(`servers/${s.id}`, [{ name: 'channels', nested: ['messages'] }, 'members', 'shares']);
    res.json({ ok: true });
  });

  r.post('/:id/invite/reset', async (req, res) => {
    const s = await member(req, res, 'owner'); if (!s) return;
    const oldCode = s.invite_code;
    const c = code();
    await db.createDoc(`server_invites/${c}`, { code: c, server_id: s.id, owner: req.user.uid });
    await db.updateDoc(`servers/${s.id}`, { invite_code: c });
    if (oldCode && oldCode !== c) await db.deleteDoc(`server_invites/${oldCode}`).catch(() => {});
    res.json({ inviteCode: c });
  });

  // ---------- Mitglieder & Rollen ----------
  r.post('/:id/members', rateLimit('server-add', 30, 600), async (req, res) => {   // Freund direkt hinzufügen
    const s = await member(req, res, 'owner'); if (!s) return;
    const handle = String(req.body?.handle || '').trim().toLowerCase().replace(/^@/, '');
    if (!HANDLE_RE.test(handle)) return bad(res, 404, 'Nutzer nicht gefunden.');
    const hdoc = await db.getDoc(`buddy_handles/${handle}`);
    if (!hdoc) return bad(res, 404, 'Nutzer nicht gefunden.');
    const f = await db.getDoc(`friendships/${pairKey(req.user.uid, hdoc.uid)}`);
    if (!f || f.status !== 'accepted') return bad(res, 403, 'Du kannst nur Code-Buddy-Freunde direkt hinzufügen. Alle anderen laden sich mit dem Einladungscode ein.');
    const curMembers = Array.isArray(s.memberUids) ? s.memberUids : [];
    if (curMembers.length >= LIMITS.members) return bad(res, 400, 'Der Server ist voll.');
    if (curMembers.includes(hdoc.uid)) return bad(res, 409, 'Ist schon dabei.');
    const role = req.body?.role === 'editor' ? 'editor' : 'viewer';
    await db.updateDoc(`servers/${s.id}`, { memberUids: [...curMembers, hdoc.uid] });
    await db.createDoc(`servers/${s.id}/members/${hdoc.uid}`, { server_id: s.id, uid: hdoc.uid, role, joined_at: db.nowIso() });
    res.json({ members: await membersOf(s.id, req.user.uid) });
  });

  r.patch('/:id/members/:handle', async (req, res) => {
    const s = await member(req, res, 'owner'); if (!s) return;
    const role = String(req.body?.role || '');
    if (!['editor', 'viewer'].includes(role)) return bad(res, 400, 'Rolle: Bearbeiter oder Zuschauer.');
    const hdoc = await db.getDoc(`buddy_handles/${String(req.params.handle).toLowerCase()}`);
    const t = hdoc ? await db.getDoc(`servers/${s.id}/members/${hdoc.uid}`) : null;
    if (!t) return bad(res, 404, 'Nicht auf diesem Server.');
    if (t.role === 'owner') return bad(res, 400, 'Die Rolle des Besitzers lässt sich nicht ändern.');
    await db.updateDoc(`servers/${s.id}/members/${t.uid}`, { role });
    res.json({ members: await membersOf(s.id, req.user.uid) });
  });

  r.delete('/:id/members/:handle', async (req, res) => {   // entfernen (Besitzer) oder selbst verlassen
    const s = await member(req, res); if (!s) return;
    const hdoc = await db.getDoc(`buddy_handles/${String(req.params.handle).toLowerCase()}`);
    const t = hdoc ? await db.getDoc(`servers/${s.id}/members/${hdoc.uid}`) : null;
    if (!t) return bad(res, 404, 'Nicht auf diesem Server.');
    if (t.role === 'owner') return bad(res, 400, 'Der Besitzer kann nicht gehen. Lösche den Server oder gib ihn nicht auf.');
    if (s.role !== 'owner' && t.uid !== req.user.uid) return bad(res, 403, 'Nur der Besitzer kann andere entfernen.');
    await db.deleteDoc(`servers/${s.id}/members/${t.uid}`);
    const nextUids = (s.memberUids || []).filter(u => u !== t.uid);
    await db.updateDoc(`servers/${s.id}`, { memberUids: nextUids });
    res.json({ ok: true });
  });

  // ---------- Kanäle & Nachrichten ----------
  r.post('/:id/channels', rateLimit('server-channel', 20, 600), async (req, res) => {
    const s = await member(req, res, 'editor'); if (!s) return;
    const name = chName(req.body?.name); if (!name) return bad(res, 400, 'Gib dem Kanal einen Namen.');
    const existing = await db.listDocs(`servers/${s.id}/channels`);
    if (existing.length >= LIMITS.channels) return bad(res, 400, `Höchstens ${LIMITS.channels} Kanäle.`);
    if (existing.some(c => c.name === name)) return bad(res, 409, 'Diesen Kanal gibt es schon.');
    const cid = db.nextId();
    await db.createDoc(`servers/${s.id}/channels/${cid}`, { id: cid, server_id: s.id, name, created_at: db.nowIso() });
    res.json({ channel: { id: Number(cid), name } });
  });

  r.delete('/:id/channels/:cid', async (req, res) => {
    const s = await member(req, res, 'owner'); if (!s) return;
    const existing = await db.listDocs(`servers/${s.id}/channels`);
    if (existing.length <= 1) return bad(res, 400, 'Ein Server braucht mindestens einen Kanal.');
    const cid = toInt(req.params.cid);
    const hit = existing.find(c => Number(c.id) === cid);
    if (!hit) return bad(res, 404, 'Kanal nicht gefunden.');
    await db.deleteTree(`servers/${s.id}/channels/${cid}`, ['messages']);
    res.json({ ok: true });
  });

  async function channel(req, res, s) {
    const cid = toInt(req.params.cid);
    const c = cid ? await db.getDoc(`servers/${s.id}/channels/${cid}`) : null;
    if (!c) { bad(res, 404, 'Kanal nicht gefunden.'); return null; }
    return c;
  }

  const msgOut = (m, uid, profMap) => m.sender === 'coden'
    ? { id: Number(m.id), body: m.body, ai: true, handle: 'coden', displayName: 'Coden', mine: false, createdAt: iso(m.created_at) }
    : (() => {
      const p = profMap.get(m.sender);
      return { id: Number(m.id), body: m.body, handle: p?.handle || null, displayName: p?.display_name || p?.handle || '?', mine: m.sender === uid, createdAt: iso(m.created_at) };
    })();

  r.get('/:id/channels/:cid/messages', async (req, res) => {
    const s = await member(req, res); if (!s) return;
    const c = await channel(req, res, s); if (!c) return;
    const after = toInt(req.query.after);
    const all = await db.listDocs(`servers/${s.id}/channels/${c.id}/messages`, { orderBy: 'id', limit: 300 });
    const rows = after ? all.filter(m => Number(m.id) > after).slice(0, 200) : all.slice(-100);
    const profMap = new Map();
    for (const uid of new Set(rows.map(m => m.sender).filter(x => x && x !== 'coden'))) {
      const p = await db.getDoc(`profiles/${uid}`).catch(() => null);
      if (p) profMap.set(uid, p);
    }
    res.json({ messages: rows.map(m => msgOut(m, req.user.uid, profMap)) });
  });

  r.post('/:id/channels/:cid/messages', rateLimit('server-msg', 60, 60), async (req, res) => {
    const s = await member(req, res); if (!s) return;
    const c = await channel(req, res, s); if (!c) return;
    const body = String(req.body?.body ?? '').trim();
    if (!body) return bad(res, 400, 'Leere Nachricht.');
    if (body.length > LIMITS.msg) return bad(res, 400, `Höchstens ${LIMITS.msg} Zeichen.`);
    const mid = db.nextId();
    const now = db.nowIso();
    await db.createDoc(`servers/${s.id}/channels/${c.id}/messages/${mid}`, {
      id: mid, server_id: s.id, channel_id: c.id, sender: req.user.uid, body, created_at: now
    });
    const out = { message: { id: Number(mid), body, handle: req.profile.handle, displayName: req.profile.display_name, mine: true, createdAt: now } };
    if (Coden.mentionsCoden(body)) {
      try {
        if (!(await Coden.canAsk(req.user.uid))) out.codenError = `Coden braucht eine Pause (höchstens ${Coden.LIMIT.perWindow} Fragen in ${Coden.LIMIT.windowMin} Minuten).`;
        else {
          const hist = (await db.listDocs(`servers/${s.id}/channels/${c.id}/messages`, { orderBy: 'id' })).slice(-14);
          const profMap = new Map();
          for (const uid of new Set(hist.map(m => m.sender).filter(x => x && x !== 'coden'))) {
            const p = await db.getDoc(`profiles/${uid}`).catch(() => null);
            if (p) profMap.set(uid, p);
          }
          const text = await Coden.ask({
            isOwner: req.user.isOwner,
            where: `Kanal #${c.name} auf dem Server „${s.name}“`,
            asker: req.profile.handle,
            history: hist.map(m => ({ who: m.sender === 'coden' ? 'coden' : (profMap.get(m.sender)?.handle || '?'), body: m.body }))
          });
          const cid2 = db.nextId();
          const now2 = db.nowIso();
          await db.createDoc(`servers/${s.id}/channels/${c.id}/messages/${cid2}`, {
            id: cid2, server_id: s.id, channel_id: c.id, sender: 'coden', ai_for: req.user.uid, body: text, created_at: now2
          });
          out.reply = { id: Number(cid2), body: text, ai: true, handle: 'coden', displayName: 'Coden', mine: false, createdAt: now2 };
        }
      } catch (e) { console.warn('[coden-chat]', e.message); out.codenError = 'Coden ist gerade überlastet. Versuch es gleich nochmal.'; }
    }
    res.json(out);
  });

  // ---------- Apps teilen ----------
  r.post('/:id/apps', rateLimit('server-share', 30, 600), async (req, res) => {
    const s = await member(req, res, 'editor'); if (!s) return;
    const appId = toInt(req.body?.appId);
    const a = appId ? await db.getDoc(`apps/${appId}`) : null;
    if (!a || a.owner !== req.user.uid) return bad(res, 403, 'Du kannst nur Apps teilen, die dir gehören.');
    const shares = await db.listDocs(`servers/${s.id}/shares`);
    if (shares.length >= LIMITS.shares) return bad(res, 400, `Höchstens ${LIMITS.shares} geteilte Apps.`);
    if (shares.some(x => Number(x.app_id) === appId)) return bad(res, 409, 'Diese App ist hier schon geteilt.');
    const now = db.nowIso();
    await db.createDoc(`servers/${s.id}/shares/${appId}`, {
      server_id: s.id,
      app_id: a.id,
      shared_by: req.user.uid,
      name: a.name,
      kind: a.kind,
      style: a.style || '',
      slug: a.slug,
      published: !!a.published,
      preview_token: a.preview_token,
      version: a.version,
      theme_color: a.theme_color,
      updated_at: a.updated_at || now,
      created_at: now
    });
    const nextServers = [...new Set([...(a.sharedServerIds || []), s.id])];
    await db.updateDoc(`apps/${a.id}`, { sharedServerIds: nextServers }).catch(() => {});
    res.json({ ok: true });
  });

  r.delete('/:id/apps/:appId', async (req, res) => {
    const s = await member(req, res); if (!s) return;
    const appId = toInt(req.params.appId);
    const x = appId ? await db.getDoc(`servers/${s.id}/shares/${appId}`) : null;
    if (!x) return bad(res, 404, 'Nicht geteilt.');
    if (s.role !== 'owner' && x.shared_by !== req.user.uid) return bad(res, 403, 'Nur der Besitzer oder wer die App geteilt hat, kann das aufheben.');
    await db.deleteDoc(`servers/${s.id}/shares/${appId}`);
    const a = await db.getDoc(`apps/${appId}`, { preferAdmin: true }).catch(() => null);
    if (a && Array.isArray(a.sharedServerIds)) {
      await db.updateDoc(`apps/${appId}`, { sharedServerIds: a.sharedServerIds.filter(id => Number(id) !== s.id) }, { preferAdmin: true }).catch(() => {});
    }
    res.json({ ok: true });
  });

  return r;
}
module.exports = { serversRouter, LIMITS };
