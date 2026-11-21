// Code Buddy: Profile, Freunde, Direktnachrichten und gemeinsame Projekte.
// Alle Rechte werden hier serverseitig geprüft; das Frontend bekommt nie fremde interne IDs (nur Handles).
const express = require('express');
const { getSql } = require('./db');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set(['coden', 'admin', 'support', 'system', 'owner', 'moderator']);
const FILE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.\- \/]{0,79}$/;
const LIMITS = { msg: 2000, file: 200_000, filesPerProject: 30, projectsPerUser: 20, membersPerProject: 8, pendingOut: 30, friends: 200 };

const bad = (res, status, error) => res.status(status).json({ error });
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const iso = (d) => (d instanceof Date ? d.toISOString() : d);

function buddyRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);

  // Profil laden (und "zuletzt gesehen" höchstens einmal pro Minute aktualisieren)
  async function loadProfile(req) {
    const sql = getSql();
    const rows = await sql`SELECT uid, handle, display_name, bio FROM profiles WHERE uid = ${req.user.uid}`;
    if (rows[0]) sql`UPDATE profiles SET last_seen = now() WHERE uid = ${req.user.uid} AND last_seen < now() - interval '60 seconds'`.catch(() => {});
    return rows[0] || null;
  }
  async function needProfile(req, res, next) {
    req.profile = await loadProfile(req);
    if (!req.profile) return bad(res, 409, 'Lege zuerst dein Code-Buddy-Profil an.');
    next();
  }
  const publicProfile = (p) => ({ handle: p.handle, displayName: p.display_name, bio: p.bio });

  // ---------- Profil ----------
  r.get('/me', async (req, res) => {
    const p = await loadProfile(req);
    res.json({ profile: p ? publicProfile(p) : null });
  });

  r.put('/me', rateLimit('buddy-profile', 10, 300), async (req, res) => {
    const handle = String(req.body?.handle || '').trim().toLowerCase();
    const displayName = String(req.body?.displayName || '').trim().slice(0, 40);
    const bio = String(req.body?.bio || '').trim().slice(0, 160);
    if (!HANDLE_RE.test(handle)) return bad(res, 400, 'Benutzername: 3 bis 20 Zeichen, nur a-z, 0-9 und _.');
    if (RESERVED.has(handle)) return bad(res, 400, 'Dieser Benutzername ist reserviert.');
    if (!displayName) return bad(res, 400, 'Bitte gib einen Anzeigenamen an.');
    try {
      await getSql()`
        INSERT INTO profiles (uid, handle, display_name, bio) VALUES (${req.user.uid}, ${handle}, ${displayName}, ${bio})
        ON CONFLICT (uid) DO UPDATE SET handle = EXCLUDED.handle, display_name = EXCLUDED.display_name, bio = EXCLUDED.bio`;
    } catch (e) {
      if (e.code === '23505') return bad(res, 409, 'Dieser Benutzername ist schon vergeben.');
      throw e;
    }
    res.json({ profile: { handle, displayName, bio } });
  });

  // Kleine Übersicht für das Symbol in der Seitenleiste (ungelesene Nachrichten, offene Anfragen)
  r.get('/summary', async (req, res) => {
    const p = await loadProfile(req);
    if (!p) return res.json({ hasProfile: false, unread: 0, requests: 0 });
    const sql = getSql(); const uid = req.user.uid;
    const [u] = await sql`SELECT count(*)::int AS n FROM dm_messages WHERE recipient = ${uid} AND read_at IS NULL`;
    const [q] = await sql`SELECT count(*)::int AS n FROM friendships WHERE addressee = ${uid} AND status = 'pending'`;
    res.json({ hasProfile: true, unread: u.n, requests: q.n });
  });

  // ---------- Freunde ----------
  r.get('/search', rateLimit('buddy-search', 30, 60), needProfile, async (req, res) => {
    const handle = String(req.query.handle || '').trim().toLowerCase().replace(/^@/, '');
    if (!HANDLE_RE.test(handle)) return res.json({ result: null });
    const sql = getSql(); const uid = req.user.uid;
    const [p] = await sql`SELECT uid, handle, display_name, bio FROM profiles WHERE handle = ${handle}`;
    if (!p) return res.json({ result: null });
    let relation = 'none';
    if (p.uid === uid) relation = 'self';
    else {
      const [f] = await sql`SELECT requester, status FROM friendships WHERE LEAST(requester, addressee) = LEAST(${uid}, ${p.uid}) AND GREATEST(requester, addressee) = GREATEST(${uid}, ${p.uid})`;
      if (f) relation = f.status === 'accepted' ? 'friend' : (f.requester === uid ? 'outgoing' : 'incoming');
    }
    res.json({ result: { ...publicProfile(p), relation } });
  });

  r.get('/friends', needProfile, async (req, res) => {
    const uid = req.user.uid;
    const rows = await getSql()`
      SELECT p.handle, p.display_name, p.bio, p.last_seen, f.status, (f.requester = ${uid}) AS i_requested,
        (SELECT count(*)::int FROM dm_messages m WHERE m.sender = p.uid AND m.recipient = ${uid} AND m.read_at IS NULL) AS unread
      FROM friendships f JOIN profiles p ON p.uid = CASE WHEN f.requester = ${uid} THEN f.addressee ELSE f.requester END
      WHERE f.requester = ${uid} OR f.addressee = ${uid}
      ORDER BY p.display_name`;
    const now = Date.now();
    const base = (x) => ({ handle: x.handle, displayName: x.display_name, bio: x.bio });
    res.json({
      friends: rows.filter(x => x.status === 'accepted').map(x => ({ ...base(x), unread: x.unread, online: now - new Date(x.last_seen).getTime() < 120_000 })),
      incoming: rows.filter(x => x.status === 'pending' && !x.i_requested).map(base),
      outgoing: rows.filter(x => x.status === 'pending' && x.i_requested).map(base)
    });
  });

  async function findByHandle(handle) {
    handle = String(handle || '').trim().toLowerCase().replace(/^@/, '');
    if (!HANDLE_RE.test(handle)) return null;
    const [p] = await getSql()`SELECT uid, handle, display_name, bio FROM profiles WHERE handle = ${handle}`;
    return p || null;
  }
  async function pairRow(a, b) {
    const [f] = await getSql()`SELECT id, requester, addressee, status FROM friendships WHERE LEAST(requester, addressee) = LEAST(${a}, ${b}) AND GREATEST(requester, addressee) = GREATEST(${a}, ${b})`;
    return f || null;
  }
  async function requireFriend(req, res, handle) {
    const other = await findByHandle(handle);
    if (!other) { bad(res, 404, 'Nutzer nicht gefunden.'); return null; }
    const f = await pairRow(req.user.uid, other.uid);
    if (!f || f.status !== 'accepted') { bad(res, 403, 'Ihr seid noch keine Freunde.'); return null; }
    return other;
  }

  r.post('/requests', rateLimit('buddy-request', 20, 300), needProfile, async (req, res) => {
    const uid = req.user.uid; const sql = getSql();
    const target = await findByHandle(req.body?.handle);
    if (!target) return bad(res, 404, 'Diesen Benutzer gibt es nicht.');
    if (target.uid === uid) return bad(res, 400, 'Du kannst dich nicht selbst hinzufügen.');
    const existing = await pairRow(uid, target.uid);
    if (existing) {
      if (existing.status === 'accepted') return bad(res, 409, 'Ihr seid schon befreundet.');
      if (existing.requester === uid) return bad(res, 409, 'Anfrage wurde schon gesendet.');
      await sql`UPDATE friendships SET status = 'accepted' WHERE id = ${existing.id}`; // er hatte dir schon geschrieben
      return res.json({ status: 'accepted' });
    }
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM friendships WHERE requester = ${uid} AND status = 'pending'`;
    if (n >= LIMITS.pendingOut) return bad(res, 429, 'Zu viele offene Anfragen.');
    const [{ c }] = await sql`SELECT count(*)::int AS c FROM friendships WHERE (requester = ${uid} OR addressee = ${uid}) AND status = 'accepted'`;
    if (c >= LIMITS.friends) return bad(res, 400, 'Freundesliste ist voll.');
    await sql`INSERT INTO friendships (requester, addressee, status) VALUES (${uid}, ${target.uid}, 'pending')`;
    res.json({ status: 'pending' });
  });

  r.post('/requests/:handle/accept', needProfile, async (req, res) => {
    const other = await findByHandle(req.params.handle);
    if (!other) return bad(res, 404, 'Nutzer nicht gefunden.');
    const rows = await getSql()`UPDATE friendships SET status = 'accepted' WHERE requester = ${other.uid} AND addressee = ${req.user.uid} AND status = 'pending' RETURNING id`;
    if (!rows.length) return bad(res, 404, 'Keine offene Anfrage.');
    res.json({ ok: true });
  });

  r.post('/requests/:handle/decline', needProfile, async (req, res) => {
    const other = await findByHandle(req.params.handle);
    if (!other) return bad(res, 404, 'Nutzer nicht gefunden.');
    await getSql()`DELETE FROM friendships WHERE requester = ${other.uid} AND addressee = ${req.user.uid} AND status = 'pending'`;
    res.json({ ok: true });
  });

  // Freund entfernen oder eigene Anfrage zurückziehen
  r.delete('/friends/:handle', needProfile, async (req, res) => {
    const other = await findByHandle(req.params.handle);
    if (!other) return bad(res, 404, 'Nutzer nicht gefunden.');
    await getSql()`DELETE FROM friendships WHERE LEAST(requester, addressee) = LEAST(${req.user.uid}, ${other.uid}) AND GREATEST(requester, addressee) = GREATEST(${req.user.uid}, ${other.uid})`;
    res.json({ ok: true });
  });

  // ---------- Direktnachrichten ----------
  const msgOut = (m, uid) => ({ id: Number(m.id), mine: m.sender === uid, body: m.body, createdAt: iso(m.created_at) });

  r.get('/messages/:handle', needProfile, async (req, res) => {
    const other = await requireFriend(req, res, req.params.handle); if (!other) return;
    const uid = req.user.uid; const sql = getSql(); const after = toInt(req.query.after);
    const rows = after
      ? await sql`SELECT id, sender, body, created_at FROM dm_messages WHERE id > ${after} AND ((sender = ${uid} AND recipient = ${other.uid}) OR (sender = ${other.uid} AND recipient = ${uid})) ORDER BY id LIMIT 200`
      : (await sql`SELECT id, sender, body, created_at FROM dm_messages WHERE (sender = ${uid} AND recipient = ${other.uid}) OR (sender = ${other.uid} AND recipient = ${uid}) ORDER BY id DESC LIMIT 60`).reverse();
    if (rows.some(m => m.sender !== uid)) sql`UPDATE dm_messages SET read_at = now() WHERE sender = ${other.uid} AND recipient = ${uid} AND read_at IS NULL`.catch(() => {});
    res.json({ messages: rows.map(m => msgOut(m, uid)) });
  });

  r.post('/messages/:handle', rateLimit('buddy-msg', 40, 60), needProfile, async (req, res) => {
    const other = await requireFriend(req, res, req.params.handle); if (!other) return;
    const body = String(req.body?.body || '').trim();
    if (!body) return bad(res, 400, 'Leere Nachricht.');
    if (body.length > LIMITS.msg) return bad(res, 400, `Maximal ${LIMITS.msg} Zeichen.`);
    const [m] = await getSql()`INSERT INTO dm_messages (sender, recipient, body) VALUES (${req.user.uid}, ${other.uid}, ${body}) RETURNING id, sender, body, created_at`;
    res.json({ message: msgOut(m, req.user.uid) });
  });

  // ---------- Projekte ----------
  async function memberOf(req, res, idRaw) {
    const id = toInt(idRaw);
    if (!id) { bad(res, 404, 'Projekt nicht gefunden.'); return null; }
    const [m] = await getSql()`
      SELECT p.id, p.owner, p.title, p.description, pm.role FROM projects p JOIN project_members pm ON pm.project_id = p.id
      WHERE p.id = ${id} AND pm.uid = ${req.user.uid}`;
    if (!m) { bad(res, 404, 'Projekt nicht gefunden.'); return null; }
    return m;
  }

  r.get('/projects', needProfile, async (req, res) => {
    const rows = await getSql()`
      SELECT p.id, p.title, p.description, pm.role, p.updated_at,
        (SELECT count(*)::int FROM project_members x WHERE x.project_id = p.id) AS members
      FROM projects p JOIN project_members pm ON pm.project_id = p.id WHERE pm.uid = ${req.user.uid} ORDER BY p.updated_at DESC`;
    res.json({ projects: rows.map(p => ({ id: Number(p.id), title: p.title, description: p.description, role: p.role, members: p.members, updatedAt: iso(p.updated_at) })) });
  });

  r.post('/projects', rateLimit('buddy-project', 10, 300), needProfile, async (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 80);
    const description = String(req.body?.description || '').trim().slice(0, 300);
    if (!title) return bad(res, 400, 'Bitte gib einen Projektnamen an.');
    const sql = getSql();
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM projects WHERE owner = ${req.user.uid}`;
    if (n >= LIMITS.projectsPerUser) return bad(res, 400, 'Du hast schon zu viele Projekte.');
    const [p] = await sql`INSERT INTO projects (owner, title, description) VALUES (${req.user.uid}, ${title}, ${description}) RETURNING id`;
    await sql`INSERT INTO project_members (project_id, uid, role) VALUES (${p.id}, ${req.user.uid}, 'owner')`;
    res.json({ id: Number(p.id) });
  });

  r.get('/projects/:id', needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    const sql = getSql();
    const members = await sql`SELECT pr.handle, pr.display_name, pm.role, pr.last_seen FROM project_members pm JOIN profiles pr ON pr.uid = pm.uid WHERE pm.project_id = ${proj.id} ORDER BY pm.role DESC, pr.handle`;
    const files = await sql`SELECT f.name, f.version, f.updated_at, length(f.content)::int AS size, pr.handle AS updated_by FROM project_files f LEFT JOIN profiles pr ON pr.uid = f.updated_by WHERE f.project_id = ${proj.id} ORDER BY f.name`;
    res.json({
      project: { id: Number(proj.id), title: proj.title, description: proj.description, role: proj.role },
      members: members.map(m => ({ handle: m.handle, displayName: m.display_name, role: m.role, online: Date.now() - new Date(m.last_seen).getTime() < 120_000 })),
      files: files.map(f => ({ name: f.name, version: f.version, size: f.size, updatedBy: f.updated_by, updatedAt: iso(f.updated_at) }))
    });
  });

  r.delete('/projects/:id', needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    if (proj.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann das Projekt löschen.');
    await getSql()`DELETE FROM projects WHERE id = ${proj.id}`;
    res.json({ ok: true });
  });

  r.post('/projects/:id/members', rateLimit('buddy-member', 20, 300), needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    if (proj.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann Mitglieder einladen.');
    const friend = await requireFriend(req, res, req.body?.handle); if (!friend) return;
    const sql = getSql();
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM project_members WHERE project_id = ${proj.id}`;
    if (n >= LIMITS.membersPerProject) return bad(res, 400, 'Das Projekt hat schon die maximale Mitgliederzahl.');
    await sql`INSERT INTO project_members (project_id, uid, role) VALUES (${proj.id}, ${friend.uid}, 'editor') ON CONFLICT DO NOTHING`;
    res.json({ ok: true });
  });

  // Mitglied entfernen (Besitzer) oder selbst verlassen
  r.delete('/projects/:id/members/:handle', needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    const other = await findByHandle(req.params.handle);
    if (!other) return bad(res, 404, 'Nutzer nicht gefunden.');
    const self = other.uid === req.user.uid;
    if (!self && proj.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann Mitglieder entfernen.');
    if (other.uid === proj.owner) return bad(res, 400, 'Der Besitzer kann nicht entfernt werden. Lösche stattdessen das Projekt.');
    await getSql()`DELETE FROM project_members WHERE project_id = ${proj.id} AND uid = ${other.uid}`;
    res.json({ ok: true });
  });

  // ---------- Projektdateien ----------
  const cleanName = (n) => { n = String(n || '').trim(); return FILE_NAME_RE.test(n) && !n.includes('..') && !n.includes('//') && !n.endsWith('/') ? n : null; };

  r.get('/projects/:id/file', needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    const name = cleanName(req.query.name); if (!name) return bad(res, 400, 'Ungültiger Dateiname.');
    const [f] = await getSql()`SELECT name, content, version FROM project_files WHERE project_id = ${proj.id} AND name = ${name}`;
    if (!f) return bad(res, 404, 'Datei nicht gefunden.');
    res.json({ name: f.name, content: f.content, version: f.version });
  });

  // baseVersion 0 = neue Datei. Sonst muss baseVersion zur aktuellen Version passen (sonst 409 = jemand war schneller).
  r.put('/projects/:id/file', rateLimit('buddy-file', 60, 60), needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    const name = cleanName(req.body?.name); if (!name) return bad(res, 400, 'Ungültiger Dateiname (nur Buchstaben, Zahlen, . _ - und /).');
    const content = String(req.body?.content ?? '');
    if (content.length > LIMITS.file) return bad(res, 413, `Datei ist zu groß (max. ${LIMITS.file / 1000} KB).`);
    const base = parseInt(req.body?.baseVersion, 10) || 0;
    const sql = getSql(); const uid = req.user.uid;
    let version;
    if (base === 0) {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM project_files WHERE project_id = ${proj.id}`;
      if (n >= LIMITS.filesPerProject) return bad(res, 400, `Maximal ${LIMITS.filesPerProject} Dateien pro Projekt.`);
      const rows = await sql`INSERT INTO project_files (project_id, name, content, version, updated_by) VALUES (${proj.id}, ${name}, ${content}, 1, ${uid}) ON CONFLICT (project_id, name) DO NOTHING RETURNING version`;
      if (!rows.length) return res.status(409).json({ error: 'Diese Datei gibt es schon.', conflict: true });
      version = rows[0].version;
    } else {
      const rows = await sql`UPDATE project_files SET content = ${content}, version = version + 1, updated_by = ${uid}, updated_at = now() WHERE project_id = ${proj.id} AND name = ${name} AND version = ${base} RETURNING version`;
      if (!rows.length) {
        const [cur] = await sql`SELECT f.version, pr.handle AS updated_by FROM project_files f LEFT JOIN profiles pr ON pr.uid = f.updated_by WHERE f.project_id = ${proj.id} AND f.name = ${name}`;
        return res.status(409).json({ error: cur ? `${cur.updated_by || 'Jemand'} hat die Datei inzwischen geändert.` : 'Datei wurde gelöscht.', conflict: true, currentVersion: cur?.version || 0 });
      }
      version = rows[0].version;
    }
    sql`UPDATE projects SET updated_at = now() WHERE id = ${proj.id}`.catch(() => {});
    res.json({ name, version });
  });

  r.delete('/projects/:id/file', needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    const name = cleanName(req.query.name); if (!name) return bad(res, 400, 'Ungültiger Dateiname.');
    await getSql()`DELETE FROM project_files WHERE project_id = ${proj.id} AND name = ${name}`;
    res.json({ ok: true });
  });

  // ---------- Projekt-Chat ----------
  r.get('/projects/:id/messages', needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    const after = toInt(req.query.after); const sql = getSql();
    const rows = after
      ? await sql`SELECT m.id, m.sender, m.body, m.created_at, pr.handle, pr.display_name FROM project_messages m LEFT JOIN profiles pr ON pr.uid = m.sender WHERE m.project_id = ${proj.id} AND m.id > ${after} ORDER BY m.id LIMIT 200`
      : (await sql`SELECT m.id, m.sender, m.body, m.created_at, pr.handle, pr.display_name FROM project_messages m LEFT JOIN profiles pr ON pr.uid = m.sender WHERE m.project_id = ${proj.id} ORDER BY m.id DESC LIMIT 60`).reverse();
    res.json({ messages: rows.map(m => ({ id: Number(m.id), mine: m.sender === req.user.uid, handle: m.handle, displayName: m.display_name, body: m.body, createdAt: iso(m.created_at) })) });
  });

  r.post('/projects/:id/messages', rateLimit('buddy-pmsg', 40, 60), needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    const body = String(req.body?.body || '').trim();
    if (!body) return bad(res, 400, 'Leere Nachricht.');
    if (body.length > LIMITS.msg) return bad(res, 400, `Maximal ${LIMITS.msg} Zeichen.`);
    const [m] = await getSql()`INSERT INTO project_messages (project_id, sender, body) VALUES (${proj.id}, ${req.user.uid}, ${body}) RETURNING id, created_at`;
    res.json({ message: { id: Number(m.id), mine: true, handle: req.profile.handle, displayName: req.profile.display_name, body, createdAt: iso(m.created_at) } });
  });

  return r;
}

module.exports = { buddyRouter };
