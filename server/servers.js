// Code-Buddy-Server (wie Discord): Server mit Kanälen, Mitgliedern und Rollen. Apps lassen sich in einen Server teilen.
// Rollen: owner (alles), editor (schreiben + geteilte Apps bearbeiten + Kanäle anlegen), viewer (lesen, im Chat schreiben, Apps ansehen).
// Alle Rechte werden hier geprüft; das Frontend bekommt nur Handles, nie fremde interne IDs.
const crypto = require('crypto');
const express = require('express');
const { getSql } = require('./db');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');

const LIMITS = { servers: 10, members: 50, channels: 10, msg: 2000, shares: 30 };
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CODE_RE = /^[a-z0-9]{10}$/;
const ROLES = ['owner', 'editor', 'viewer'];
const bad = (res, status, error) => res.status(status).json({ error });
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const code = () => crypto.randomBytes(8).toString('hex').replace(/[^a-z0-9]/g, '').slice(0, 10).padEnd(10, 'x');
const chName = (v) => String(v ?? '').toLowerCase().trim().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

function serversRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);
  const sql = () => getSql();

  async function needProfile(req, res, next) {
    const [p] = await sql()`SELECT uid, handle, display_name FROM profiles WHERE uid = ${req.user.uid}`;
    if (!p) return bad(res, 409, 'Lege zuerst dein Code-Buddy-Profil an.');
    req.profile = p; next();
  }
  r.use(needProfile);

  // Mitgliedschaft prüfen (404 statt 403, damit Server nicht erraten werden können)
  async function member(req, res, need) {
    const id = toInt(req.params.id); if (!id) { bad(res, 404, 'Server nicht gefunden.'); return null; }
    const [s] = await sql()`SELECT s.*, m.role FROM servers s JOIN server_members m ON m.server_id = s.id AND m.uid = ${req.user.uid} WHERE s.id = ${id}`;
    if (!s) { bad(res, 404, 'Server nicht gefunden.'); return null; }
    if (need === 'owner' && s.role !== 'owner') { bad(res, 403, 'Das darf nur der Besitzer.'); return null; }
    if (need === 'editor' && s.role === 'viewer') { bad(res, 403, 'Dafür brauchst du die Rolle „Bearbeiter“.'); return null; }
    return s;
  }
  const info = (s) => ({ id: Number(s.id), name: s.name, color: s.color, role: s.role });
  async function membersOf(serverId, uid) {
    const rows = await sql()`SELECT m.uid, m.role, p.handle, p.display_name, p.last_seen FROM server_members m LEFT JOIN profiles p ON p.uid = m.uid WHERE m.server_id = ${serverId}
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, p.handle`;
    return rows.map(m => ({ handle: m.handle, displayName: m.display_name || m.handle, role: m.role, me: m.uid === uid, online: m.last_seen ? Date.now() - new Date(m.last_seen).getTime() < 120000 : false }));
  }

  r.get('/', async (req, res) => {
    const rows = await sql()`SELECT s.id, s.name, s.color, m.role FROM servers s JOIN server_members m ON m.server_id = s.id AND m.uid = ${req.user.uid} ORDER BY s.id`;
    res.json({ servers: rows.map(info) });
  });

  r.post('/', rateLimit('server-create', 30, 600), async (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 40);
    if (!name) return bad(res, 400, 'Gib dem Server einen Namen.');
    const [{ n }] = await sql()`SELECT count(*)::int AS n FROM server_members WHERE uid = ${req.user.uid}`;
    if (n >= LIMITS.servers) return bad(res, 400, `Du bist schon in ${LIMITS.servers} Servern.`);
    const color = COLOR_RE.test(req.body?.color || '') ? req.body.color : '#8ab4f8';
    const [s] = await sql()`INSERT INTO servers (name, color, owner, invite_code) VALUES (${name}, ${color}, ${req.user.uid}, ${code()}) RETURNING *`;
    await sql()`INSERT INTO server_members (server_id, uid, role) VALUES (${s.id}, ${req.user.uid}, 'owner')`;
    await sql()`INSERT INTO server_channels (server_id, name) VALUES (${s.id}, 'allgemein')`;
    s.role = 'owner'; res.json({ server: info(s) });
  });

  // Einladungscode einlösen (landet als Zuschauer; der Besitzer kann die Rolle ändern)
  r.post('/join', rateLimit('server-join', 20, 600), async (req, res) => {
    const c = String(req.body?.code ?? '').trim().toLowerCase();
    if (!CODE_RE.test(c)) return bad(res, 404, 'Diesen Einladungscode gibt es nicht.');
    const [s] = await sql()`SELECT * FROM servers WHERE invite_code = ${c}`;
    if (!s) return bad(res, 404, 'Diesen Einladungscode gibt es nicht.');
    const [{ n }] = await sql()`SELECT count(*)::int AS n FROM server_members WHERE server_id = ${s.id}`;
    const [{ mine }] = await sql()`SELECT count(*)::int AS mine FROM server_members WHERE uid = ${req.user.uid}`;
    const [already] = await sql()`SELECT 1 FROM server_members WHERE server_id = ${s.id} AND uid = ${req.user.uid}`;
    if (already) return res.json({ server: info({ ...s, role: (await sql()`SELECT role FROM server_members WHERE server_id = ${s.id} AND uid = ${req.user.uid}`)[0].role }), already: true });
    if (n >= LIMITS.members) return bad(res, 400, 'Der Server ist voll.');
    if (mine >= LIMITS.servers) return bad(res, 400, `Du bist schon in ${LIMITS.servers} Servern.`);
    await sql()`INSERT INTO server_members (server_id, uid, role) VALUES (${s.id}, ${req.user.uid}, 'viewer')`;
    res.json({ server: info({ ...s, role: 'viewer' }) });
  });

  r.get('/:id', async (req, res) => {
    const s = await member(req, res); if (!s) return;
    const channels = await sql()`SELECT id, name FROM server_channels WHERE server_id = ${s.id} ORDER BY id`;
    const shares = await sql()`SELECT a.id, a.name, a.kind, a.theme_color, p.handle AS by, a.published FROM server_shares x JOIN apps a ON a.id = x.app_id LEFT JOIN profiles p ON p.uid = x.shared_by WHERE x.server_id = ${s.id} ORDER BY x.created_at DESC`;
    res.json({
      server: { ...info(s), inviteCode: s.role === 'owner' ? s.invite_code : undefined },
      channels: channels.map(c => ({ id: Number(c.id), name: c.name })),
      members: await membersOf(s.id, req.user.uid),
      apps: shares.map(a => ({ id: Number(a.id), name: a.name, kind: a.kind, themeColor: a.theme_color, by: a.by, published: a.published }))
    });
  });

  r.patch('/:id', async (req, res) => {
    const s = await member(req, res, 'owner'); if (!s) return;
    const name = 'name' in (req.body || {}) ? String(req.body.name).trim().slice(0, 40) : s.name;
    if (!name) return bad(res, 400, 'Der Name darf nicht leer sein.');
    const color = COLOR_RE.test(req.body?.color || '') ? req.body.color : s.color;
    const [u] = await sql()`UPDATE servers SET name = ${name}, color = ${color} WHERE id = ${s.id} RETURNING *`;
    u.role = s.role; res.json({ server: info(u) });
  });
  r.delete('/:id', async (req, res) => {
    const s = await member(req, res, 'owner'); if (!s) return;
    await sql()`DELETE FROM servers WHERE id = ${s.id}`; res.json({ ok: true });
  });
  r.post('/:id/invite/reset', async (req, res) => {
    const s = await member(req, res, 'owner'); if (!s) return;
    const c = code(); await sql()`UPDATE servers SET invite_code = ${c} WHERE id = ${s.id}`; res.json({ inviteCode: c });
  });

  // ---------- Mitglieder & Rollen ----------
  r.post('/:id/members', rateLimit('server-add', 30, 600), async (req, res) => {   // Freund direkt hinzufügen
    const s = await member(req, res, 'owner'); if (!s) return;
    const handle = String(req.body?.handle || '').trim().toLowerCase().replace(/^@/, '');
    if (!HANDLE_RE.test(handle)) return bad(res, 404, 'Nutzer nicht gefunden.');
    const [o] = await sql()`SELECT uid, handle FROM profiles WHERE handle = ${handle}`;
    if (!o) return bad(res, 404, 'Nutzer nicht gefunden.');
    const [f] = await sql()`SELECT status FROM friendships WHERE LEAST(requester, addressee) = LEAST(${req.user.uid}, ${o.uid}) AND GREATEST(requester, addressee) = GREATEST(${req.user.uid}, ${o.uid})`;
    if (!f || f.status !== 'accepted') return bad(res, 403, 'Du kannst nur Code-Buddy-Freunde direkt hinzufügen. Alle anderen laden sich mit dem Einladungscode ein.');
    const [{ n }] = await sql()`SELECT count(*)::int AS n FROM server_members WHERE server_id = ${s.id}`;
    if (n >= LIMITS.members) return bad(res, 400, 'Der Server ist voll.');
    const role = req.body?.role === 'editor' ? 'editor' : 'viewer';
    const ins = await sql()`INSERT INTO server_members (server_id, uid, role) VALUES (${s.id}, ${o.uid}, ${role}) ON CONFLICT DO NOTHING RETURNING uid`;
    if (!ins.length) return bad(res, 409, 'Ist schon dabei.');
    res.json({ members: await membersOf(s.id, req.user.uid) });
  });
  r.patch('/:id/members/:handle', async (req, res) => {
    const s = await member(req, res, 'owner'); if (!s) return;
    const role = String(req.body?.role || '');
    if (!['editor', 'viewer'].includes(role)) return bad(res, 400, 'Rolle: Bearbeiter oder Zuschauer.');
    const [t] = await sql()`SELECT m.uid, m.role FROM server_members m JOIN profiles p ON p.uid = m.uid WHERE m.server_id = ${s.id} AND p.handle = ${String(req.params.handle).toLowerCase()}`;
    if (!t) return bad(res, 404, 'Nicht auf diesem Server.');
    if (t.role === 'owner') return bad(res, 400, 'Die Rolle des Besitzers lässt sich nicht ändern.');
    await sql()`UPDATE server_members SET role = ${role} WHERE server_id = ${s.id} AND uid = ${t.uid}`;
    res.json({ members: await membersOf(s.id, req.user.uid) });
  });
  r.delete('/:id/members/:handle', async (req, res) => {   // entfernen (Besitzer) oder selbst verlassen
    const s = await member(req, res); if (!s) return;
    const [t] = await sql()`SELECT m.uid, m.role FROM server_members m JOIN profiles p ON p.uid = m.uid WHERE m.server_id = ${s.id} AND p.handle = ${String(req.params.handle).toLowerCase()}`;
    if (!t) return bad(res, 404, 'Nicht auf diesem Server.');
    if (t.role === 'owner') return bad(res, 400, 'Der Besitzer kann nicht gehen. Lösche den Server oder gib ihn nicht auf.');
    if (s.role !== 'owner' && t.uid !== req.user.uid) return bad(res, 403, 'Nur der Besitzer kann andere entfernen.');
    await sql()`DELETE FROM server_members WHERE server_id = ${s.id} AND uid = ${t.uid}`;
    res.json({ ok: true });
  });

  // ---------- Kanäle & Nachrichten ----------
  r.post('/:id/channels', rateLimit('server-channel', 20, 600), async (req, res) => {
    const s = await member(req, res, 'editor'); if (!s) return;
    const name = chName(req.body?.name); if (!name) return bad(res, 400, 'Gib dem Kanal einen Namen.');
    const [{ n }] = await sql()`SELECT count(*)::int AS n FROM server_channels WHERE server_id = ${s.id}`;
    if (n >= LIMITS.channels) return bad(res, 400, `Höchstens ${LIMITS.channels} Kanäle.`);
    const dup = await sql()`SELECT 1 FROM server_channels WHERE server_id = ${s.id} AND name = ${name}`;
    if (dup.length) return bad(res, 409, 'Diesen Kanal gibt es schon.');
    const [c] = await sql()`INSERT INTO server_channels (server_id, name) VALUES (${s.id}, ${name}) RETURNING id, name`;
    res.json({ channel: { id: Number(c.id), name: c.name } });
  });
  r.delete('/:id/channels/:cid', async (req, res) => {
    const s = await member(req, res, 'owner'); if (!s) return;
    const [{ n }] = await sql()`SELECT count(*)::int AS n FROM server_channels WHERE server_id = ${s.id}`;
    if (n <= 1) return bad(res, 400, 'Ein Server braucht mindestens einen Kanal.');
    const d = await sql()`DELETE FROM server_channels WHERE id = ${toInt(req.params.cid)} AND server_id = ${s.id} RETURNING id`;
    if (!d.length) return bad(res, 404, 'Kanal nicht gefunden.');
    res.json({ ok: true });
  });
  async function channel(req, res, s) {
    const [c] = await sql()`SELECT id, name FROM server_channels WHERE id = ${toInt(req.params.cid)} AND server_id = ${s.id}`;
    if (!c) { bad(res, 404, 'Kanal nicht gefunden.'); return null; }
    return c;
  }
  r.get('/:id/channels/:cid/messages', async (req, res) => {
    const s = await member(req, res); if (!s) return;
    const c = await channel(req, res, s); if (!c) return;
    const after = toInt(req.query.after);
    const rows = after
      ? await sql()`SELECT m.id, m.sender, m.body, m.created_at, p.handle, p.display_name FROM server_messages m LEFT JOIN profiles p ON p.uid = m.sender WHERE m.channel_id = ${c.id} AND m.id > ${after} ORDER BY m.id LIMIT 200`
      : await sql()`SELECT * FROM (SELECT m.id, m.sender, m.body, m.created_at, p.handle, p.display_name FROM server_messages m LEFT JOIN profiles p ON p.uid = m.sender WHERE m.channel_id = ${c.id} ORDER BY m.id DESC LIMIT 100) x ORDER BY id`;
    res.json({ messages: rows.map(m => ({ id: Number(m.id), body: m.body, handle: m.handle, displayName: m.display_name || m.handle || '?', mine: m.sender === req.user.uid, createdAt: iso(m.created_at) })) });
  });
  r.post('/:id/channels/:cid/messages', rateLimit('server-msg', 60, 60), async (req, res) => {
    const s = await member(req, res); if (!s) return;
    const c = await channel(req, res, s); if (!c) return;
    const body = String(req.body?.body ?? '').trim();
    if (!body) return bad(res, 400, 'Leere Nachricht.');
    if (body.length > LIMITS.msg) return bad(res, 400, `Höchstens ${LIMITS.msg} Zeichen.`);
    const [row] = await sql()`INSERT INTO server_messages (channel_id, sender, body) VALUES (${c.id}, ${req.user.uid}, ${body}) RETURNING id, created_at`;
    res.json({ message: { id: Number(row.id), body, handle: req.profile.handle, displayName: req.profile.display_name, mine: true, createdAt: iso(row.created_at) } });
  });

  // ---------- Apps teilen ----------
  r.post('/:id/apps', rateLimit('server-share', 30, 600), async (req, res) => {
    const s = await member(req, res, 'editor'); if (!s) return;
    const appId = toInt(req.body?.appId);
    const [a] = await sql()`SELECT a.id, a.name FROM apps a JOIN app_members m ON m.app_id = a.id AND m.uid = ${req.user.uid} AND m.role = 'owner' WHERE a.id = ${appId}`;
    if (!a) return bad(res, 403, 'Du kannst nur Apps teilen, die dir gehören.');
    const [{ n }] = await sql()`SELECT count(*)::int AS n FROM server_shares WHERE server_id = ${s.id}`;
    if (n >= LIMITS.shares) return bad(res, 400, `Höchstens ${LIMITS.shares} geteilte Apps.`);
    const ins = await sql()`INSERT INTO server_shares (server_id, app_id, shared_by) VALUES (${s.id}, ${a.id}, ${req.user.uid}) ON CONFLICT DO NOTHING RETURNING app_id`;
    if (!ins.length) return bad(res, 409, 'Diese App ist hier schon geteilt.');
    res.json({ ok: true });
  });
  r.delete('/:id/apps/:appId', async (req, res) => {
    const s = await member(req, res); if (!s) return;
    const [x] = await sql()`SELECT shared_by FROM server_shares WHERE server_id = ${s.id} AND app_id = ${toInt(req.params.appId)}`;
    if (!x) return bad(res, 404, 'Nicht geteilt.');
    if (s.role !== 'owner' && x.shared_by !== req.user.uid) return bad(res, 403, 'Nur der Besitzer oder wer die App geteilt hat, kann das aufheben.');
    await sql()`DELETE FROM server_shares WHERE server_id = ${s.id} AND app_id = ${toInt(req.params.appId)}`;
    res.json({ ok: true });
  });

  return r;
}
module.exports = { serversRouter, LIMITS };
