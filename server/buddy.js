// Code Buddy: Profile, Freunde, Direktnachrichten und gemeinsame Projekte (Firebase Firestore).
// Alle Rechte werden hier serverseitig geprüft; das Frontend bekommt nie fremde interne IDs (nur Handles).
const express = require('express');
const db = require('./db');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');
const Coden = require('./coden-chat');

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set(['coden', 'admin', 'support', 'system', 'owner', 'moderator']);
const FILE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.\- \/]{0,79}$/;
const LIMITS = { msg: 2000, file: 200_000, filesPerProject: 30, projectsPerUser: 20, membersPerProject: 8, pendingOut: 30, friends: 200 };

const bad = (res, status, error) => res.status(status).json({ error });
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const pairKey = (a, b) => [a, b].sort().join('__');
const fileDocKey = (name) => Buffer.from(String(name), 'utf8').toString('base64url');

function buddyRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);

  // Profil laden (und "zuletzt gesehen" höchstens einmal pro Minute aktualisieren)
  async function loadProfile(req) {
    const p = await db.getDoc(`profiles/${req.user.uid}`);
    if (p) {
      const last = p.last_seen ? new Date(p.last_seen).getTime() : 0;
      if (Date.now() - last > 60_000) {
        db.updateDoc(`profiles/${req.user.uid}`, { last_seen: db.nowIso() }).catch(() => {});
      }
    }
    return p;
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

    const uid = req.user.uid;
    const existing = await db.getDoc(`profiles/${uid}`);
    if (!existing || existing.handle !== handle) {
      const taken = await db.getDoc(`buddy_handles/${handle}`);
      if (taken && taken.uid !== uid) return bad(res, 409, 'Dieser Benutzername ist schon vergeben.');
      if (!taken) {
        try {
          await db.createDoc(`buddy_handles/${handle}`, { handle, uid });
        } catch (e) {
          if (e.code === 'ALREADY_EXISTS' || e.code === 'PERMISSION_DENIED') {
            return bad(res, 409, 'Dieser Benutzername ist schon vergeben.');
          }
          throw e;
        }
      }
      if (existing && existing.handle && existing.handle !== handle) {
        await db.deleteDoc(`buddy_handles/${existing.handle}`).catch(() => {});
      }
    }
    const now = db.nowIso();
    if (existing) {
      await db.updateDoc(`profiles/${uid}`, { handle, display_name: displayName, bio, last_seen: now });
    } else {
      await db.createDoc(`profiles/${uid}`, { uid, handle, display_name: displayName, bio, created_at: now, last_seen: now });
    }
    res.json({ profile: { handle, displayName, bio } });
  });

  // Kleine Übersicht für das Symbol in der Seitenleiste (ungelesene Nachrichten, offene Anfragen)
  r.get('/summary', async (req, res) => {
    const p = await loadProfile(req);
    if (!p) return res.json({ hasProfile: false, unread: 0, requests: 0 });
    const uid = req.user.uid;
    const [dms, frs] = await Promise.all([
      db.runQuery('dm_messages', { where: [['participants', 'ARRAY_CONTAINS', uid]] }),
      db.runQuery('friendships', { where: [['participants', 'ARRAY_CONTAINS', uid]] })
    ]);
    const unread = dms.filter(m => m.recipient === uid && !m.read_at && m.sender !== 'coden').length;
    const requests = frs.filter(f => f.addressee === uid && f.status === 'pending').length;
    res.json({ hasProfile: true, unread, requests });
  });

  // ---------- Freunde ----------
  async function findByHandle(handle) {
    handle = String(handle || '').trim().toLowerCase().replace(/^@/, '');
    if (!HANDLE_RE.test(handle)) return null;
    const h = await db.getDoc(`buddy_handles/${handle}`);
    if (!h) return null;
    return db.getDoc(`profiles/${h.uid}`);
  }
  async function pairRow(a, b) {
    return db.getDoc(`friendships/${pairKey(a, b)}`);
  }

  r.get('/search', rateLimit('buddy-search', 30, 60), needProfile, async (req, res) => {
    const p = await findByHandle(req.query.handle);
    if (!p) return res.json({ result: null });
    const uid = req.user.uid;
    let relation = 'none';
    if (p.uid === uid) relation = 'self';
    else {
      const f = await pairRow(uid, p.uid);
      if (f) relation = f.status === 'accepted' ? 'friend' : (f.requester === uid ? 'outgoing' : 'incoming');
    }
    res.json({ result: { ...publicProfile(p), relation } });
  });

  r.get('/friends', needProfile, async (req, res) => {
    const uid = req.user.uid;
    const [frs, dms] = await Promise.all([
      db.runQuery('friendships', { where: [['participants', 'ARRAY_CONTAINS', uid]] }),
      db.runQuery('dm_messages', { where: [['participants', 'ARRAY_CONTAINS', uid]] })
    ]);
    const unreadFrom = new Map();
    for (const m of dms) {
      if (m.recipient === uid && !m.read_at && m.sender !== 'coden') {
        unreadFrom.set(m.sender, (unreadFrom.get(m.sender) || 0) + 1);
      }
    }
    const items = (await Promise.all(frs.map(async (f) => {
      const otherUid = f.requester === uid ? f.addressee : f.requester;
      const p = await db.getDoc(`profiles/${otherUid}`).catch(() => null);
      if (!p) return null;
      return {
        uid: otherUid,
        handle: p.handle,
        displayName: p.display_name,
        bio: p.bio,
        last_seen: p.last_seen,
        status: f.status,
        i_requested: f.requester === uid,
        unread: unreadFrom.get(otherUid) || 0
      };
    }))).filter(Boolean).sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || '')));

    const now = Date.now();
    const base = (x) => ({ handle: x.handle, displayName: x.displayName, bio: x.bio });
    res.json({
      friends: items.filter(x => x.status === 'accepted').map(x => ({ ...base(x), unread: x.unread, online: x.last_seen ? now - new Date(x.last_seen).getTime() < 120_000 : false })),
      incoming: items.filter(x => x.status === 'pending' && !x.i_requested).map(base),
      outgoing: items.filter(x => x.status === 'pending' && x.i_requested).map(base)
    });
  });

  async function requireFriend(req, res, handle) {
    const other = await findByHandle(handle);
    if (!other) { bad(res, 404, 'Nutzer nicht gefunden.'); return null; }
    const f = await pairRow(req.user.uid, other.uid);
    if (!f || f.status !== 'accepted') { bad(res, 403, 'Ihr seid noch keine Freunde.'); return null; }
    return other;
  }

  r.post('/requests', rateLimit('buddy-request', 20, 300), needProfile, async (req, res) => {
    const uid = req.user.uid;
    const target = await findByHandle(req.body?.handle);
    if (!target) return bad(res, 404, 'Diesen Benutzer gibt es nicht.');
    if (target.uid === uid) return bad(res, 400, 'Du kannst dich nicht selbst hinzufügen.');
    const existing = await pairRow(uid, target.uid);
    if (existing) {
      if (existing.status === 'accepted') return bad(res, 409, 'Ihr seid schon befreundet.');
      if (existing.requester === uid) return bad(res, 409, 'Anfrage wurde schon gesendet.');
      await db.updateDoc(`friendships/${existing.id}`, { status: 'accepted' });
      return res.json({ status: 'accepted' });
    }
    const mine = await db.runQuery('friendships', { where: [['participants', 'ARRAY_CONTAINS', uid]] });
    if (mine.filter(f => f.requester === uid && f.status === 'pending').length >= LIMITS.pendingOut) {
      return bad(res, 429, 'Zu viele offene Anfragen.');
    }
    if (mine.filter(f => f.status === 'accepted').length >= LIMITS.friends) {
      return bad(res, 400, 'Freundesliste ist voll.');
    }
    const id = pairKey(uid, target.uid);
    await db.createDoc(`friendships/${id}`, {
      id,
      requester: uid,
      addressee: target.uid,
      participants: [uid, target.uid].sort(),
      status: 'pending',
      created_at: db.nowIso()
    });
    res.json({ status: 'pending' });
  });

  r.post('/requests/:handle/accept', needProfile, async (req, res) => {
    const other = await findByHandle(req.params.handle);
    if (!other) return bad(res, 404, 'Nutzer nicht gefunden.');
    const f = await pairRow(req.user.uid, other.uid);
    if (!f || f.requester !== other.uid || f.addressee !== req.user.uid || f.status !== 'pending') {
      return bad(res, 404, 'Keine offene Anfrage.');
    }
    await db.updateDoc(`friendships/${f.id}`, { status: 'accepted' });
    res.json({ ok: true });
  });

  r.post('/requests/:handle/decline', needProfile, async (req, res) => {
    const other = await findByHandle(req.params.handle);
    if (!other) return bad(res, 404, 'Nutzer nicht gefunden.');
    const f = await pairRow(req.user.uid, other.uid);
    if (f && f.requester === other.uid && f.addressee === req.user.uid && f.status === 'pending') {
      await db.deleteDoc(`friendships/${f.id}`);
    }
    res.json({ ok: true });
  });

  // Freund entfernen oder eigene Anfrage zurückziehen
  r.delete('/friends/:handle', needProfile, async (req, res) => {
    const other = await findByHandle(req.params.handle);
    if (!other) return bad(res, 404, 'Nutzer nicht gefunden.');
    await db.deleteDoc(`friendships/${pairKey(req.user.uid, other.uid)}`);
    res.json({ ok: true });
  });

  // ---------- Direktnachrichten ----------
  const msgOut = (m, uid) => m.sender === 'coden'
    ? { id: Number(m.id), mine: false, ai: true, handle: 'coden', displayName: 'Coden', body: m.body, createdAt: iso(m.created_at) }
    : { id: Number(m.id), mine: m.sender === uid, body: m.body, attachment: m.attachment || undefined, createdAt: iso(m.created_at) };

  const thread = async (uid, other, after) => {
    const all = await db.runQuery('dm_messages', { where: [['participants', 'ARRAY_CONTAINS', uid]] });
    const conv = all.filter(m => {
      const okPair = (m.sender === uid && m.recipient === other)
        || (m.sender === other && m.recipient === uid)
        || (m.sender === 'coden' && ((m.recipient === uid && m.peer === other) || (m.recipient === other && m.peer === uid)));
      if (!okPair) return false;
      return after ? Number(m.id) > after : true;
    }).sort((a, b) => Number(a.id) - Number(b.id));
    return after ? conv.slice(0, 200) : conv.slice(-60);
  };

  r.get('/messages/:handle', needProfile, async (req, res) => {
    const other = await requireFriend(req, res, req.params.handle); if (!other) return;
    const uid = req.user.uid; const after = toInt(req.query.after);
    const rows = await thread(uid, other.uid, after);
    const unread = rows.filter(m => m.sender === other.uid && m.recipient === uid && !m.read_at);
    if (unread.length) {
      const now = db.nowIso();
      Promise.all(unread.map(m => db.updateDoc(`dm_messages/${m.id}`, { read_at: now }).catch(() => {}))).catch(() => {});
    }
    res.json({ messages: rows.map(m => msgOut(m, uid)) });
  });

  // Anhang teilen: gibt dem Freund sofort Zugriff (App als Zuschauer/Bearbeiter, Projekt als Mitglied)
  async function shareAttachment(req, res, other, att) {
    const type = att?.type; const id = toInt(att?.id);
    if (type === 'app') {
      const role = att.role === 'editor' ? 'editor' : 'viewer';
      const a = id ? await db.getDoc(`apps/${id}`) : null;
      if (!a || a.owner !== req.user.uid) { bad(res, 403, 'Du kannst nur Apps teilen, die dir gehören.'); return null; }
      const nextUids = [...new Set([...(a.memberUids || []), other.uid])];
      if (nextUids.length > (a.memberUids || []).length) {
        await db.updateDoc(`apps/${a.id}`, { memberUids: nextUids });
      }
      if (other.uid !== a.owner) {
        await db.setDoc(`apps/${a.id}/members/${other.uid}`, { app_id: a.id, uid: other.uid, role, last_seen: db.nowIso() });
      }
      return { type: 'app', id: Number(a.id), name: a.name, role };
    }
    if (type === 'project') {
      const proj = await memberOf(req, res, id); if (!proj) return null;
      if (proj.role !== 'owner') { bad(res, 403, 'Nur der Besitzer kann ein Projekt teilen.'); return null; }
      const curMembers = Array.isArray(proj.memberUids) ? proj.memberUids : [];
      if (!curMembers.includes(other.uid)) {
        if (curMembers.length >= LIMITS.membersPerProject) { bad(res, 400, 'Das Projekt hat schon die maximale Mitgliederzahl.'); return null; }
        await db.updateDoc(`buddy_projects/${proj.id}`, { memberUids: [...curMembers, other.uid], updated_at: db.nowIso() });
        await db.createDoc(`buddy_projects/${proj.id}/members/${other.uid}`, { project_id: proj.id, uid: other.uid, role: 'editor' });
      }
      return { type: 'project', id: Number(proj.id), name: proj.title, role: 'editor' };
    }
    bad(res, 400, 'Unbekannter Anhang.'); return null;
  }

  r.post('/messages/:handle', rateLimit('buddy-msg', 40, 60), needProfile, async (req, res) => {
    const other = await requireFriend(req, res, req.params.handle); if (!other) return;
    let body = String(req.body?.body || '').trim();
    let attachment = null;
    if (req.body?.attachment) {
      attachment = await shareAttachment(req, res, other, req.body.attachment); if (!attachment) return;
      if (!body) body = `📎 ${attachment.type === 'app' ? 'App' : 'Projekt'} geteilt: ${attachment.name}`;
    }
    if (!body) return bad(res, 400, 'Leere Nachricht.');
    if (body.length > LIMITS.msg) return bad(res, 400, `Maximal ${LIMITS.msg} Zeichen.`);
    const mid = db.nextId();
    const now = db.nowIso();
    const m = await db.createDoc(`dm_messages/${mid}`, {
      id: mid,
      participants: [req.user.uid, other.uid].sort(),
      sender: req.user.uid,
      recipient: other.uid,
      body,
      attachment,
      created_at: now
    });
    const out = { message: msgOut(m, req.user.uid) };
    if (Coden.mentionsCoden(body)) {
      try {
        if (!(await Coden.canAsk(req.user.uid))) out.codenError = `Coden braucht eine Pause (höchstens ${Coden.LIMIT.perWindow} Fragen in ${Coden.LIMIT.windowMin} Minuten).`;
        else {
          const hist = (await thread(req.user.uid, other.uid)).slice(-14);
          const who = (m2) => m2.sender === 'coden' ? 'coden' : (m2.sender === req.user.uid ? req.profile.handle : other.handle);
          const text = await Coden.ask({ isOwner: req.user.isOwner, where: `Direktnachricht zwischen @${req.profile.handle} und @${other.handle}`, asker: req.profile.handle, history: hist.map(m2 => ({ who: who(m2), body: m2.body })) });
          const cid = db.nextId();
          const cnow = db.nowIso();
          const c = await db.createDoc(`dm_messages/${cid}`, {
            id: cid,
            participants: [req.user.uid, other.uid].sort(),
            sender: 'coden',
            recipient: req.user.uid,
            peer: other.uid,
            ai_for: req.user.uid,
            body: text,
            created_at: cnow,
            read_at: cnow
          });
          out.reply = msgOut(c, req.user.uid);
        }
      } catch (e) { console.warn('[coden-chat]', e.message); out.codenError = 'Coden ist gerade überlastet. Versuch es gleich nochmal.'; }
    }
    res.json(out);
  });

  // ---------- Gemeinsame Buddy-Projekte ----------
  async function memberOf(req, res, idRaw) {
    const id = toInt(idRaw);
    if (!id) { bad(res, 404, 'Projekt nicht gefunden.'); return null; }
    const [p, m] = await Promise.all([
      db.getDoc(`buddy_projects/${id}`),
      db.getDoc(`buddy_projects/${id}/members/${req.user.uid}`)
    ]);
    if (!p || !m) { bad(res, 404, 'Projekt nicht gefunden.'); return null; }
    return { ...p, role: m.role };
  }

  r.get('/projects', needProfile, async (req, res) => {
    const projs = await db.runQuery('buddy_projects', { where: [['memberUids', 'ARRAY_CONTAINS', req.user.uid]], orderBy: 'updated_at', desc: true });
    const rows = [];
    for (const p of projs) {
      const m = await db.getDoc(`buddy_projects/${p.id}/members/${req.user.uid}`);
      if (m) {
        rows.push({
          id: Number(p.id),
          title: p.title,
          description: p.description,
          role: m.role,
          members: Array.isArray(p.memberUids) ? p.memberUids.length : 1,
          updatedAt: iso(p.updated_at)
        });
      }
    }
    res.json({ projects: rows });
  });

  r.post('/projects', rateLimit('buddy-project', 10, 300), needProfile, async (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 80);
    const description = String(req.body?.description || '').trim().slice(0, 300);
    if (!title) return bad(res, 400, 'Bitte gib einen Projektnamen an.');
    const mine = await db.runQuery('buddy_projects', { where: [['memberUids', 'ARRAY_CONTAINS', req.user.uid]] });
    if (mine.filter(p => p.owner === req.user.uid).length >= LIMITS.projectsPerUser) {
      return bad(res, 400, 'Du hast schon zu viele Projekte.');
    }
    const id = db.nextId();
    const now = db.nowIso();
    await db.createDoc(`buddy_projects/${id}`, {
      id,
      owner: req.user.uid,
      memberUids: [req.user.uid],
      title,
      description,
      created_at: now,
      updated_at: now
    });
    await db.createDoc(`buddy_projects/${id}/members/${req.user.uid}`, { project_id: id, uid: req.user.uid, role: 'owner' });
    res.json({ id: Number(id) });
  });

  r.get('/projects/:id', needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    const [mDocs, fDocs] = await Promise.all([
      db.listDocs(`buddy_projects/${proj.id}/members`),
      db.listDocs(`buddy_projects/${proj.id}/files`)
    ]);
    const profMap = new Map();
    const needUids = new Set([
      ...mDocs.map(m => m.uid),
      ...fDocs.map(f => f.updated_by).filter(Boolean)
    ]);
    for (const u of needUids) {
      const pr = await db.getDoc(`profiles/${u}`).catch(() => null);
      if (pr) profMap.set(u, pr);
    }
    const members = mDocs.map(m => {
      const pr = profMap.get(m.uid);
      return {
        handle: pr?.handle || null,
        displayName: pr?.display_name || null,
        role: m.role,
        online: pr?.last_seen ? Date.now() - new Date(pr.last_seen).getTime() < 120_000 : false
      };
    }).sort((a, b) => String(b.role).localeCompare(String(a.role)) || String(a.handle || '').localeCompare(String(b.handle || '')));

    const files = fDocs.sort((a, b) => String(a.name).localeCompare(String(b.name))).map(f => ({
      name: f.name,
      version: f.version,
      size: String(f.content || '').length,
      updatedBy: profMap.get(f.updated_by)?.handle || null,
      updatedAt: iso(f.updated_at)
    }));

    res.json({
      project: { id: Number(proj.id), title: proj.title, description: proj.description, role: proj.role },
      members,
      files
    });
  });

  r.delete('/projects/:id', needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    if (proj.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann das Projekt löschen.');
    await db.deleteTree(`buddy_projects/${proj.id}`, ['members', 'files', 'messages']);
    res.json({ ok: true });
  });

  r.post('/projects/:id/members', rateLimit('buddy-member', 20, 300), needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    if (proj.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann Mitglieder einladen.');
    const friend = await requireFriend(req, res, req.body?.handle); if (!friend) return;
    const cur = Array.isArray(proj.memberUids) ? proj.memberUids : [];
    if (!cur.includes(friend.uid)) {
      if (cur.length >= LIMITS.membersPerProject) return bad(res, 400, 'Das Projekt hat schon die maximale Mitgliederzahl.');
      await db.updateDoc(`buddy_projects/${proj.id}`, { memberUids: [...cur, friend.uid], updated_at: db.nowIso() });
      await db.createDoc(`buddy_projects/${proj.id}/members/${friend.uid}`, { project_id: proj.id, uid: friend.uid, role: 'editor' });
    }
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
    await db.deleteDoc(`buddy_projects/${proj.id}/members/${other.uid}`);
    await db.updateDoc(`buddy_projects/${proj.id}`, {
      memberUids: (proj.memberUids || []).filter(u => u !== other.uid),
      updated_at: db.nowIso()
    });
    res.json({ ok: true });
  });

  // ---------- Projektdateien ----------
  const cleanName = (n) => { n = String(n || '').trim(); return FILE_NAME_RE.test(n) && !n.includes('..') && !n.includes('//') && !n.endsWith('/') ? n : null; };

  r.get('/projects/:id/file', needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    const name = cleanName(req.query.name); if (!name) return bad(res, 400, 'Ungültiger Dateiname.');
    const f = await db.getDoc(`buddy_projects/${proj.id}/files/${fileDocKey(name)}`);
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
    const uid = req.user.uid;
    const fpath = `buddy_projects/${proj.id}/files/${fileDocKey(name)}`;
    let version;
    if (base === 0) {
      const existingFiles = await db.listDocs(`buddy_projects/${proj.id}/files`);
      if (existingFiles.length >= LIMITS.filesPerProject) return bad(res, 400, `Maximal ${LIMITS.filesPerProject} Dateien pro Projekt.`);
      try {
        await db.createDoc(fpath, {
          project_id: proj.id,
          name,
          content,
          version: 1,
          updated_by: uid,
          updated_at: db.nowIso()
        });
        version = 1;
      } catch (e) {
        if (e.code === 'ALREADY_EXISTS') return res.status(409).json({ error: 'Diese Datei gibt es schon.', conflict: true });
        throw e;
      }
    } else {
      const cur = await db.getDoc(fpath);
      if (!cur || cur.version !== base) {
        const pr = cur?.updated_by ? await db.getDoc(`profiles/${cur.updated_by}`).catch(() => null) : null;
        return res.status(409).json({ error: cur ? `${pr?.handle || 'Jemand'} hat die Datei inzwischen geändert.` : 'Datei wurde gelöscht.', conflict: true, currentVersion: cur?.version || 0 });
      }
      try {
        const u = await db.updateDoc(fpath, {
          content,
          version: cur.version + 1,
          updated_by: uid,
          updated_at: db.nowIso()
        }, { updateTime: cur._updateTime, expect: { version: base } });
        version = u.version;
      } catch (e) {
        if (e.code === 'PRECONDITION_FAILED') {
          const fresh = await db.getDoc(fpath);
          const pr = fresh?.updated_by ? await db.getDoc(`profiles/${fresh.updated_by}`).catch(() => null) : null;
          return res.status(409).json({ error: fresh ? `${pr?.handle || 'Jemand'} hat die Datei inzwischen geändert.` : 'Datei wurde gelöscht.', conflict: true, currentVersion: fresh?.version || 0 });
        }
        throw e;
      }
    }
    db.updateDoc(`buddy_projects/${proj.id}`, { updated_at: db.nowIso() }).catch(() => {});
    res.json({ name, version });
  });

  r.delete('/projects/:id/file', needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    const name = cleanName(req.query.name); if (!name) return bad(res, 400, 'Ungültiger Dateiname.');
    await db.deleteDoc(`buddy_projects/${proj.id}/files/${fileDocKey(name)}`);
    res.json({ ok: true });
  });

  // ---------- Projekt-Chat ----------
  r.get('/projects/:id/messages', needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    const after = toInt(req.query.after);
    const all = await db.listDocs(`buddy_projects/${proj.id}/messages`, { orderBy: 'id' });
    const rows = after ? all.filter(m => Number(m.id) > after).slice(0, 200) : all.slice(-60);
    const profMap = new Map();
    for (const u of new Set(rows.map(m => m.sender))) {
      const pr = await db.getDoc(`profiles/${u}`).catch(() => null);
      if (pr) profMap.set(u, pr);
    }
    res.json({
      messages: rows.map(m => {
        const pr = profMap.get(m.sender);
        return { id: Number(m.id), mine: m.sender === req.user.uid, handle: pr?.handle || null, displayName: pr?.display_name || null, body: m.body, createdAt: iso(m.created_at) };
      })
    });
  });

  r.post('/projects/:id/messages', rateLimit('buddy-pmsg', 40, 60), needProfile, async (req, res) => {
    const proj = await memberOf(req, res, req.params.id); if (!proj) return;
    const body = String(req.body?.body || '').trim();
    if (!body) return bad(res, 400, 'Leere Nachricht.');
    if (body.length > LIMITS.msg) return bad(res, 400, `Maximal ${LIMITS.msg} Zeichen.`);
    const mid = db.nextId();
    const now = db.nowIso();
    await db.createDoc(`buddy_projects/${proj.id}/messages/${mid}`, {
      id: mid, project_id: proj.id, sender: req.user.uid, body, created_at: now
    });
    res.json({ message: { id: Number(mid), mine: true, handle: req.profile.handle, displayName: req.profile.display_name, body, createdAt: now } });
  });

  return r;
}

module.exports = { buddyRouter };
