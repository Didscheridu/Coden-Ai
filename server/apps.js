// App-Builder: Apps anlegen, Dateien speichern, gemeinsamer Agent-Chat, Mitglieder (Code Buddy), Veröffentlichen (Firebase Firestore).
// Plus die öffentliche Seite /a/<slug>/ – sie zeigt die App in einer Sandbox, damit fremder Code nie an Coden-Logins kommt.
const crypto = require('crypto');
const Byok = require('./byok');
const Usage = require('./usage');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { generateImage } = require('./images');
const db = require('./db');
const { rateLimit, byIp } = require('./rateLimit');
const { wrapRouter } = require('./util');
const { iconPng } = require('./icon');
const Bundle = require('../shared/app-bundle');
const Styles = require('../shared/app-styles');
const apk = require('./apk');
const { startRun, resumeRun, serveRun, _live: liveRuns } = require('./runs');
const { runAppAgent, historyFrom } = require('./agents');

const KINDS = ['web', 'ios', 'android', 'both', 'game'];
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(['api', 'admin', 'coden', 'www', 'app', 'apps', 'kit', 'shared', 'static', 'login', 'help', 'support', 'status', 'a', 'assets']);
const FILE_RE = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9_][A-Za-z0-9_.\-\/]{0,99}$/;
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const LIMITS = { images: 40, files: 60, file: 400_000, total: 1_500_000, apps: 40, members: 8, msg: 60_000, meta: 8_000 };
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const bad = (res, status, error, extra) => res.status(status).json({ error, ...extra });
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const token = () => crypto.randomBytes(12).toString('base64url');
const sameToken = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); };
const escHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pairKey = (a, b) => [a, b].sort().join('__');
const previewIdOf = (slug, tok) => `${slug}__${tok}`;

function slugify(s) {
  return String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28).replace(/-+$/, '') || 'app';
}
const randomSlug = (name) => { let b = slugify(name); if (b.length < 2) b = 'app'; return `${b}-${crypto.randomBytes(3).toString('hex').slice(0, 4)}`; };

function checkFiles(files) {
  const names = Object.keys(files);
  if (names.length > LIMITS.files) return `Höchstens ${LIMITS.files} Dateien pro App.`;
  let total = 0;
  for (const n of names) {
    if (!FILE_RE.test(n) || n.endsWith('/')) return `Ungültiger Dateiname: ${n.slice(0, 60)}`;
    if (typeof files[n] !== 'string') return `Datei ${n} ist kein Text.`;
    if (files[n].length > LIMITS.file) return `Datei ${n} ist zu groß (max. ${LIMITS.file / 1000} KB).`;
    total += files[n].length;
  }
  if (total > LIMITS.total) return `Die App ist zu groß (max. ${LIMITS.total / 1_000_000} MB Text).`;
  return null;
}

// ---------- Bundle (mit kleinem Zwischenspeicher pro Version) ----------
let KIT;
const kit = () => KIT || (KIT = { css: fs.readFileSync(path.join(__dirname, '..', 'kit', 'coden-kit.css'), 'utf8'), js: fs.readFileSync(path.join(__dirname, '..', 'kit', 'coden-kit.js'), 'utf8') });
const cache = new Map();
function bundleFor(app) {
  const key = `${app.app_id || app.id}:${app.version}`;
  if (cache.has(key)) return cache.get(key);
  const style = Styles.byId(app.style);
  const platform = app.kind === 'both' ? null : app.kind === 'game' ? 'web' : app.kind;
  const b = Bundle.build(app.files || {}, { kit: kit(), themeCss: Styles.themeCss(style), fontsHref: Styles.fontsHref(style), platform });
  cache.set(key, b); if (cache.size > 60) cache.delete(cache.keys().next().value);
  return b;
}

const baseUrl = (req) => (process.env.PUBLIC_APP_BASE || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');
function publicUrl(req, slug) { return `${baseUrl(req)}/a/${slug}/`; }

// Synchronisiert app_routes/{slug} und app_previews/{slug}__{token} für öffentlichen Zugriff ohne Service-Account
async function syncPublicDocs(app, { oldSlug, oldToken } = {}) {
  const now = app.updated_at || db.nowIso();
  const routePayload = {
    app_id: app.id,
    owner: app.owner,
    slug: app.slug,
    name: app.name,
    kind: app.kind,
    style: app.style || '',
    published: !!app.published,
    files: app.files || {},
    version: app.version,
    theme_color: app.theme_color,
    updated_at: now
  };
  const prevPayload = {
    app_id: app.id,
    owner: app.owner,
    slug: app.slug,
    name: app.name,
    kind: app.kind,
    style: app.style || '',
    files: app.files || {},
    version: app.version,
    theme_color: app.theme_color,
    updated_at: now
  };
  await db.setDoc(`app_routes/${app.slug}`, routePayload, { preferAdmin: true });
  await db.setDoc(`app_previews/${previewIdOf(app.slug, app.preview_token)}`, prevPayload, { preferAdmin: true });
  if (oldSlug && oldSlug !== app.slug) {
    await db.deleteDoc(`app_routes/${oldSlug}`, { preferAdmin: true }).catch(() => {});
  }
  if ((oldSlug && oldSlug !== app.slug) || (oldToken && oldToken !== app.preview_token)) {
    const stalePrev = previewIdOf(oldSlug || app.slug, oldToken || app.preview_token);
    if (stalePrev !== previewIdOf(app.slug, app.preview_token)) {
      await db.deleteDoc(`app_previews/${stalePrev}`, { preferAdmin: true }).catch(() => {});
    }
  }
}

// =====================================================================
// Geschützte API (/api/apps …)
// =====================================================================
function appsRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.post('/:id/agent/continue', (req, res, next) => continueLeg(req, res).catch(next));
  r.use(requireAuth);

  // Zugriff: direktes Mitglied, sonst über einen Server, in den die App geteilt wurde (Bearbeiter → editor, Zuschauer → viewer).
  async function memberOf(req, res, id, needWrite = false) {
    id = toInt(id); if (!id) { bad(res, 404, 'App nicht gefunden.'); return null; }
    let a = await db.getDoc(`apps/${id}`).catch(() => null);
    let role = null;
    if (a) {
      const m = await db.getDoc(`apps/${id}/members/${req.user.uid}`).catch(() => null);
      if (m) role = m.role;
      else if (a.owner === req.user.uid) role = 'owner';
    }
    if (!role) {
      const mySrvs = await db.runQuery('servers', { where: [['memberUids', 'ARRAY_CONTAINS', req.user.uid]] });
      let serverRole = null;
      for (const s of mySrvs) {
        const sh = await db.getDoc(`servers/${s.id}/shares/${id}`).catch(() => null);
        if (!sh) continue;
        const sm = await db.getDoc(`servers/${s.id}/members/${req.user.uid}`).catch(() => null);
        if (!sm) continue;
        if (sm.role === 'owner' || sm.role === 'editor') { serverRole = 'editor'; break; }
        if (!serverRole) serverRole = 'viewer';
      }
      if (serverRole) {
        if (!a) a = await db.getDoc(`apps/${id}`, { preferAdmin: true }).catch(() => null);
        if (a) role = serverRole;
      }
    }
    if (!a || !role) { bad(res, 404, 'App nicht gefunden.'); return null; }
    if (needWrite && role === 'viewer') { bad(res, 403, 'Du darfst diese App nur ansehen.'); return null; }
    return { ...a, role };
  }

  const meta = (a, req) => ({
    id: Number(a.id), name: a.name, kind: a.kind, style: a.style, slug: a.slug, published: a.published, version: a.version,
    themeColor: a.theme_color, role: a.role, previewToken: a.preview_token, integrations: a.integrations || {},
    url: publicUrl(req, a.slug), testUrl: publicUrl(req, a.slug) + '?t=' + a.preview_token,
    apk: apk.publicState(a.apk), updatedAt: iso(a.updated_at), publishedAt: iso(a.published_at)
  });

  async function membersOf(id, uid) {
    const rows = await db.listDocs(`apps/${id}/members`);
    const enriched = await Promise.all(rows.map(async (m) => {
      const p = await db.getDoc(`profiles/${m.uid}`).catch(() => null);
      return {
        uid: m.uid,
        role: m.role,
        last_seen: m.last_seen,
        handle: p?.handle || null,
        displayName: p?.display_name || (m.role === 'owner' ? 'Besitzer' : 'Mitglied')
      };
    }));
    enriched.sort((a, b) => (b.role === 'owner' ? 1 : 0) - (a.role === 'owner' ? 1 : 0) || String(a.handle || '').localeCompare(String(b.handle || '')));
    const now = Date.now();
    return enriched.map(m => ({
      handle: m.handle,
      displayName: m.displayName,
      role: m.role,
      me: m.uid === uid,
      online: m.last_seen ? now - new Date(m.last_seen).getTime() < 45_000 : false
    }));
  }

  const touch = (id, uid) => {
    db.getDoc(`apps/${id}/members/${uid}`).then((m) => {
      if (!m) return;
      const last = m.last_seen ? new Date(m.last_seen).getTime() : 0;
      if (Date.now() - last > 15_000) {
        return db.updateDoc(`apps/${id}/members/${uid}`, { last_seen: db.nowIso() });
      }
    }).catch(() => {});
  };

  // Liste: eigene und geteilte Apps
  r.get('/', async (req, res) => {
    const direct = await db.runQuery('apps', { where: [['memberUids', 'ARRAY_CONTAINS', req.user.uid]], orderBy: 'updated_at', desc: true, limit: 100 });
    const seenIds = new Set();
    const out = [];
    for (const a of direct) {
      const m = await db.getDoc(`apps/${a.id}/members/${req.user.uid}`).catch(() => null);
      const role = m?.role || (a.owner === req.user.uid ? 'owner' : 'viewer');
      seenIds.add(Number(a.id));
      out.push({
        id: Number(a.id), name: a.name, kind: a.kind, style: a.style, slug: a.slug, published: a.published, role,
        members: Array.isArray(a.memberUids) ? a.memberUids.length : 1,
        themeColor: a.theme_color, version: a.version, updatedAt: iso(a.updated_at),
        url: publicUrl(req, a.slug), testUrl: publicUrl(req, a.slug) + '?t=' + a.preview_token
      });
    }
    // Über Server geteilte Apps
    const mySrvs = await db.runQuery('servers', { where: [['memberUids', 'ARRAY_CONTAINS', req.user.uid]] });
    const srvRoles = new Map();
    for (const s of mySrvs) {
      const [sm, shares] = await Promise.all([
        db.getDoc(`servers/${s.id}/members/${req.user.uid}`).catch(() => null),
        db.listDocs(`servers/${s.id}/shares`).catch(() => [])
      ]);
      if (!sm) continue;
      const sRole = (sm.role === 'owner' || sm.role === 'editor') ? 'editor' : 'viewer';
      for (const sh of shares) {
        const aid = Number(sh.app_id);
        if (seenIds.has(aid)) continue;
        const prev = srvRoles.get(aid);
        if (!prev || (sRole === 'editor' && prev.role !== 'editor')) srvRoles.set(aid, { sh, role: sRole });
      }
    }
    for (const [aid, { sh, role }] of srvRoles.entries()) {
      const full = await db.getDoc(`apps/${aid}`, { preferAdmin: true }).catch(() => null);
      const src = full || sh;
      out.push({
        id: aid,
        name: src.name,
        kind: src.kind,
        style: src.style || '',
        slug: src.slug,
        published: !!src.published,
        role,
        members: Array.isArray(full?.memberUids) ? full.memberUids.length : 1,
        themeColor: src.theme_color,
        version: src.version || 1,
        updatedAt: iso(src.updated_at || sh.created_at),
        url: publicUrl(req, src.slug),
        testUrl: publicUrl(req, src.slug) + '?t=' + src.preview_token
      });
    }
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    res.json({ apps: out.slice(0, 100) });
  });

  r.post('/', rateLimit('apps-create', 15, 600), async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 60);
    const kind = String(req.body?.kind || '');
    const style = String(req.body?.style || '');
    const files = req.body?.files && typeof req.body.files === 'object' && !Array.isArray(req.body.files) ? req.body.files : {};
    const themeColor = COLOR_RE.test(req.body?.themeColor || '') ? req.body.themeColor : (Styles.byId(style)?.v.primary.match(COLOR_RE) ? Styles.byId(style).v.primary : '#8ab4f8');
    if (!name) return bad(res, 400, 'Bitte gib deiner App einen Namen.');
    if (!KINDS.includes(kind)) return bad(res, 400, 'Unbekannter App-Typ.');
    if (style && !Styles.byId(style)) return bad(res, 400, 'Unbekannter Stil.');
    const err = checkFiles(files); if (err) return bad(res, 400, err);
    const mine = await db.runQuery('apps', { where: [['memberUids', 'ARRAY_CONTAINS', req.user.uid]] });
    if (mine.filter(a => a.owner === req.user.uid).length >= LIMITS.apps && !req.user.isOwner) {
      return bad(res, 400, `Du hast schon ${LIMITS.apps} Apps. Lösche eine alte, um eine neue anzulegen.`);
    }
    let slug = null;
    for (let i = 0; i < 4; i++) {
      const candidate = randomSlug(name);
      const taken = await db.getDoc(`app_routes/${candidate}`, { preferAdmin: true }).catch(() => null);
      if (!taken) { slug = candidate; break; }
    }
    if (!slug) return bad(res, 500, 'Konnte keine Adresse vergeben.');
    const id = db.nextId();
    const now = db.nowIso();
    const previewTok = token();
    const doc = {
      id,
      owner: req.user.uid,
      memberUids: [req.user.uid],
      sharedServerIds: [],
      name,
      kind,
      style,
      slug,
      preview_token: previewTok,
      published: false,
      files,
      integrations: {},
      version: 1,
      theme_color: themeColor,
      apk: {},
      created_at: now,
      updated_at: now,
      published_at: null
    };
    await db.createDoc(`apps/${id}`, doc);
    await db.createDoc(`apps/${id}/members/${req.user.uid}`, { app_id: id, uid: req.user.uid, role: 'owner', last_seen: now });
    await syncPublicDocs(doc);
    doc.role = 'owner';
    res.json({ app: meta(doc, req), files: doc.files });
  });

  r.get('/:id', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    touch(a.id, req.user.uid);
    res.json({ app: meta(a, req), files: a.files, members: await membersOf(a.id, req.user.uid) });
  });

  r.patch('/:id', async (req, res) => {
    const a = await memberOf(req, res, req.params.id, true); if (!a) return;
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).trim().slice(0, 60) : a.name;
    const kind = b.kind !== undefined ? String(b.kind) : a.kind;
    const style = b.style !== undefined ? String(b.style) : a.style;
    const color = b.themeColor !== undefined ? String(b.themeColor) : a.theme_color;
    if (!name) return bad(res, 400, 'Der Name darf nicht leer sein.');
    if (!KINDS.includes(kind)) return bad(res, 400, 'Unbekannter App-Typ.');
    if (style && !Styles.byId(style)) return bad(res, 400, 'Unbekannter Stil.');
    if (!COLOR_RE.test(color)) return bad(res, 400, 'Farbe bitte als #RRGGBB.');
    let integ = a.integrations || {};
    if (b.integrations && typeof b.integrations === 'object') {
      integ = { ...integ, ...b.integrations }; for (const k of Object.keys(integ)) if (integ[k] === null) delete integ[k];
      if (JSON.stringify(integ).length > 10_000) return bad(res, 400, 'Zu viele Integrationsdaten.');
    }
    const u = await db.updateDoc(`apps/${a.id}`, {
      name, kind, style, theme_color: color, integrations: integ, version: (a.version || 1) + 1, updated_at: db.nowIso()
    }, { preferAdmin: a.owner !== req.user.uid });
    await syncPublicDocs(u).catch(() => {});
    u.role = a.role; res.json({ app: meta(u, req) });
  });

  r.delete('/:id', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann die App löschen.');
    const myRuns = await db.runQuery('ai_runs', { where: [['uid', '==', req.user.uid]] }).catch(() => []);
    for (const run of myRuns) {
      if (run.kind === 'app' && run.ref === String(a.id) && run.status === 'running') {
        await db.updateDoc(`ai_runs/${run.id}`, { stop: true, updated_at: db.nowIso() }).catch(() => {});
        liveRuns.get(Number(run.id))?.ac.abort();
      }
    }
    await db.deleteDoc(`app_routes/${a.slug}`, { preferAdmin: true }).catch(() => {});
    await db.deleteDoc(`app_previews/${previewIdOf(a.slug, a.preview_token)}`, { preferAdmin: true }).catch(() => {});
    for (const sid of a.sharedServerIds || []) {
      await db.deleteDoc(`servers/${sid}/shares/${a.id}`, { preferAdmin: true }).catch(() => {});
    }
    await db.deleteTree(`apps/${a.id}`, ['members', 'messages']);
    res.json({ ok: true });
  });

  // Eine geteilte App verlassen (Mitglieder; der Besitzer löscht stattdessen)
  r.post('/:id/leave', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role === 'owner') return bad(res, 400, 'Du bist der Besitzer – lösche die App stattdessen.');
    const m = await db.getDoc(`apps/${a.id}/members/${req.user.uid}`);
    if (!m) return bad(res, 400, 'Du siehst diese App über einen Server. Die Freigabe kann nur der Besitzer entfernen.');
    await db.deleteDoc(`apps/${a.id}/members/${req.user.uid}`);
    await db.updateDoc(`apps/${a.id}`, { memberUids: (a.memberUids || []).filter(u => u !== req.user.uid) }).catch(() => {});
    res.json({ ok: true });
  });

  // Dateien ändern: set = {pfad: inhalt}, remove = [pfad]. Optimistische Versionsprüfung.
  r.put('/:id/files', rateLimit('apps-files', 90, 60), async (req, res) => {
    const id = toInt(req.params.id);
    const set = req.body?.set && typeof req.body.set === 'object' && !Array.isArray(req.body.set) ? req.body.set : {};
    const remove = Array.isArray(req.body?.remove) ? req.body.remove.map(String) : [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const a = await memberOf(req, res, id, true); if (!a) return;
      const files = { ...(a.files || {}) };
      for (const n of remove) delete files[n];
      for (const [n, c] of Object.entries(set)) files[n] = c;
      const err = checkFiles(files); if (err) return bad(res, 400, err);
      try {
        const u = await db.updateDoc(`apps/${a.id}`, {
          files, version: (a.version || 1) + 1, updated_at: db.nowIso()
        }, { updateTime: a._updateTime, expect: { version: a.version }, preferAdmin: a.owner !== req.user.uid });
        if (u) {
          await syncPublicDocs(u).catch(() => {});
          return res.json({ version: u.version, files: Object.keys(files) });
        }
      } catch (e) {
        if (e.code === 'PRECONDITION_FAILED') continue;
        throw e;
      }
    }
    bad(res, 409, 'Gerade ändern zu viele gleichzeitig. Bitte nochmal versuchen.');
  });

  // Leichte Abfrage für Live-Zusammenarbeit (alle paar Sekunden)
  r.get('/:id/poll', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    touch(a.id, req.user.uid);
    const after = toInt(req.query.after);
    const messages = after ? await loadMessages(a.id, req.user.uid, after) : [];
    res.json({ version: a.version, name: a.name, published: a.published, apk: apk.publicState(a.apk), messages, members: await membersOf(a.id, req.user.uid), agentRun: await activeRun(a.id, req.user.uid) });
  });

  async function loadMessages(appId, uid, after = 0, limit = 120) {
    const all = await db.listDocs(`apps/${appId}/messages`, { orderBy: 'id' });
    const rows = after ? all.filter(m => Number(m.id) > after).slice(0, limit) : all.slice(-limit);
    const profMap = new Map();
    for (const s of new Set(rows.map(m => m.sender).filter(Boolean))) {
      const p = await db.getDoc(`profiles/${s}`).catch(() => null);
      if (p) profMap.set(s, p);
    }
    return rows.map(m => ({ id: Number(m.id), role: m.role, body: m.body, meta: m.meta || {}, handle: profMap.get(m.sender)?.handle || null, mine: m.sender === uid, createdAt: iso(m.created_at) }));
  }

  r.get('/:id/messages', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    res.json({ messages: await loadMessages(a.id, req.user.uid, toInt(req.query.after)) });
  });

  // KI-Bild erzeugen und als URL zurückgeben
  async function makeImage(a, uid, req, prompt) {
    const base = typeof req === 'string' ? req : baseUrl(req);
    prompt = String(prompt || '').trim().slice(0, 1500);
    if (prompt.length < 3) throw Object.assign(new Error('Beschreibe das Bild kurz.'), { status: 400 });
    const mine = await db.runQuery('app_images', { where: [['uid', '==', uid]] }).catch(() => []);
    if (mine.filter(x => Number(x.app_id) === Number(a.id)).length >= LIMITS.images) {
      throw Object.assign(new Error(`Höchstens ${LIMITS.images} Bilder pro App.`), { status: 400 });
    }
    const img = await generateImage(prompt);
    const key = crypto.randomBytes(9).toString('hex');
    await db.createDoc(`app_images/${key}`, {
      key,
      app_id: a.id,
      uid,
      prompt,
      mime: img.mime,
      data_b64: Buffer.from(img.data).toString('base64'),
      created_at: db.nowIso()
    });
    return { key, url: `${base}/api/public/img/${key}` };
  }

  r.post('/:id/images', rateLimit('apps-img', 12, 300), async (req, res) => {
    const a = await memberOf(req, res, req.params.id, true); if (!a) return;
    try { res.json(await makeImage(a, req.user.uid, req, req.body?.prompt)); } catch (e) { bad(res, e.status || 502, e.message); }
  });

  // ---------- Coden-Agententeam (läuft als Hintergrund-Lauf auf dem Server) ----------
  async function activeRun(appId, uid) {
    let rows = [];
    if (process.env.FIREBASE_SERVICE_ACCOUNT || db.isMemoryDb()) {
      rows = await db.runQuery('ai_runs', { where: [['ref', '==', String(appId)]], preferAdmin: true }).catch(() => []);
    } else if (uid) {
      rows = await db.runQuery('ai_runs', { where: [['uid', '==', uid]] }).catch(() => []);
    }
    const x = rows
      .filter(r => r.kind === 'app' && r.ref === String(appId) && r.status === 'running')
      .sort((a, b) => Number(b.id) - Number(a.id))[0];
    if (!x) return null;
    if (!liveRuns.has(Number(x.id)) && Date.now() - new Date(x.updated_at).getTime() > 120_000) {
      db.updateDoc(`ai_runs/${x.id}`, { status: 'error', error: 'Der Lauf wurde unterbrochen (Zeitlimit des Servers).', updated_at: db.nowIso() }, { preferAdmin: true }).catch(() => {});
      return null;
    }
    return Number(x.id);
  }

  async function locked(req, tier) {
    if (req.user.isOwner) return null;
    const st = await db.getDoc('system_state/global') || {};
    if (st.maintenance) return 'Wartungsarbeiten.';
    if (tier === 'ultra' && st.locks?.ultra !== false) return 'Coden Ultra ist gesperrt (nur der Owner).';
    if (tier === 'pro' && st.locks?.pro) return 'Coden Pro ist gesperrt.';
    if (tier === 'normal' && st.locks?.thinking) return 'Coden Thinking ist gesperrt.';
    return null;
  }

  r.post('/:id/agent', rateLimit('apps-agent', 30, 60), async (req, res) => {
    const a = await memberOf(req, res, req.params.id, true); if (!a) return;
    const wanted = req.body?.tier;
    const tier = ['flash', 'normal', 'pro', 'ultra'].includes(wanted) ? wanted : (Byok.isOwnTier(wanted) && await Byok.owns(req.user.uid, wanted) ? wanted : 'pro');
    const why = await locked(req, tier); if (why) return bad(res, 403, why);
    const busy = await activeRun(a.id, req.user.uid); if (busy) return bad(res, 409, 'Coden arbeitet gerade schon an dieser App.', { runId: busy });
    const free = await Byok.freeOfQuota(req.user.uid, tier);
    const lim = free ? { ok: true } : await Usage.check(req.user); if (!lim.ok) return bad(res, 429, lim.message, { code: 'limit', usage: lim.view });
    const effort = Byok.LEVELS.includes(req.body?.effort) ? req.body.effort : undefined;
    const mode = ['auto', 'single', 'team'].includes(req.body?.mode) ? req.body.mode : 'auto';
    const rows = await loadMessages(a.id, req.user.uid, 0, 40);
    const agentCfg = await Byok.getAgentConfig(req.user.uid);
    const opts = {
      uid: req.user.uid, email: req.user.email || null, isOwner: req.user.isOwner, tier, effort, mode, agentCfg, allowUltra: !(await locked(req, 'ultra')),
      trigger: rows.length && rows[rows.length - 1].role === 'user' ? 'user' : 'tool', lastMsgId: rows.length ? Number(rows[rows.length - 1].id) : 0,
      imgBase: baseUrl(req), selfBase: selfUrl(req)
    };
    const ctx = agentCtx(a, opts, historyFrom(rows));
    const { run, done } = await startRun({ uid: opts.uid, isOwner: opts.isOwner, kind: 'app', ref: String(a.id), meta: { tier, mode } }, (run) => { ctx.run = run; return runAppAgent(run, ctx); });
    await serveRun(res, run, done);
  });

  function selfUrl(req) { return `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`.replace(/\/$/, ''); }

  function agentCtx(a, o, history, state) {
    const appId = a.id; const uid = o.uid;
    const ctx = {
      app: { id: Number(a.id), name: a.name, kind: a.kind, style: a.style, integrations: a.integrations || {} },
      files: a.files || {}, history, uid, email: o.email || null, tier: o.tier, effort: o.effort, mode: o.mode, agentCfg: o.agentCfg, isOwner: o.isOwner, style: Styles.byId(a.style), allowUltra: o.allowUltra, trigger: o.trigger, state,
      async save(set, remove) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const cur = await db.getDoc(`apps/${appId}`);
          if (!cur) throw new Error('Die App wurde gelöscht.');
          const files = { ...(cur.files || {}) }; for (const n of remove) delete files[n]; for (const [n, c] of Object.entries(set)) files[n] = c;
          const err = checkFiles(files); if (err) throw new Error(err);
          try {
            const ok = await db.updateDoc(`apps/${appId}`, {
              files, version: (cur.version || 1) + 1, updated_at: db.nowIso()
            }, { updateTime: cur._updateTime, expect: { version: cur.version }, preferAdmin: cur.owner !== uid });
            if (ok) {
              await syncPublicDocs(ok).catch(() => {});
              return files;
            }
          } catch (e) {
            if (e.code === 'PRECONDITION_FAILED') continue;
            throw e;
          }
        }
        throw new Error('Dateien konnten nicht gespeichert werden (zu viele gleichzeitige Änderungen).');
      },
      async post(role, body, meta = {}) {
        const m = JSON.stringify(meta).length > LIMITS.meta ? { ...meta, changed: (meta.changed || []).slice(0, 20), agents: undefined } : meta;
        const mid = db.nextId();
        const now = db.nowIso();
        await db.createDoc(`apps/${appId}/messages/${mid}`, {
          id: mid, app_id: appId, sender: uid, role, body: String(body).slice(0, LIMITS.msg), meta: m, created_at: now
        });
        db.updateDoc(`apps/${appId}`, { updated_at: now }).catch(() => {});
      },
      image: async (prompt) => (await makeImage(a, uid, o.imgBase, prompt)).url,
      async continueLeg(state) {
        const run = ctx.run; if (!run) return false;
        const key = crypto.randomBytes(24).toString('hex');
        await run.pause();
        const ctxToken = db.getDbContext().token;
        const authTokenEnc = ctxToken ? await Byok.encrypt(ctxToken).catch(() => null) : null;
        const savedOpts = authTokenEnc ? { ...o, authTokenEnc } : o;
        await db.updateDoc(`ai_runs/${run.id}`, {
          meta: { ...run.meta, extra: run.extra, cont: { key, state, opts: savedOpts } },
          updated_at: db.nowIso()
        });
        const headers = { 'Content-Type': 'application/json', 'X-Coden-Leg': key };
        if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
        try {
          const r = await fetch(`${o.selfBase}/api/apps/${appId}/agent/continue`, { method: 'POST', headers, body: JSON.stringify({ run: run.id }), signal: AbortSignal.timeout(20000) });
          if (r.ok) return true;
          console.warn('[agent] Etappe abgelehnt:', r.status);
        } catch (e) { console.warn('[agent] Etappe nicht erreichbar:', e.message); }
        await db.updateDoc(`ai_runs/${run.id}`, { meta: { ...run.meta, extra: run.extra }, updated_at: db.nowIso() }).catch(() => {});
        run.unpause(); return false;
      }
    };
    return ctx;
  }

  async function continueLeg(req, res) {
    const appId = toInt(req.params.id); const runId = toInt(req.body?.run); const key = String(req.headers['x-coden-leg'] || '');
    if (!appId || !runId || key.length !== 48) return bad(res, 400, 'Ungültig.');
    const row = await db.getDoc(`ai_runs/${runId}`, { preferAdmin: true });
    const cont = row?.kind === 'app' && row?.ref === String(appId) && row?.status === 'running' ? row?.meta?.cont : null;
    if (!cont || typeof cont.key !== 'string' || cont.key.length !== key.length || !crypto.timingSafeEqual(Buffer.from(cont.key), Buffer.from(key))) {
      return bad(res, 403, 'Nicht erlaubt.');
    }
    const { cont: _c, ...restMeta } = row.meta || {};
    void _c;
    try {
      const took = await db.updateDoc(`ai_runs/${runId}`, { meta: restMeta, updated_at: db.nowIso() }, { updateTime: row._updateTime, preferAdmin: true });
      if (!took) return bad(res, 409, 'Diese Etappe läuft schon.');
    } catch (e) {
      if (e.code === 'PRECONDITION_FAILED') return bad(res, 409, 'Diese Etappe läuft schon.');
      throw e;
    }
    const rawOpts = cont.opts || {};
    let tokenStr = null;
    if (rawOpts.authTokenEnc) tokenStr = await Byok.decrypt(rawOpts.authTokenEnc).catch(() => null);
    const { authTokenEnc: _a, ...o } = rawOpts;
    void _a;
    const dbCtx = { token: tokenStr, uid: o.uid, isOwner: !!o.isOwner, email: o.email };
    return db.runWithDbContext(dbCtx, async () => {
      const a = await db.getDoc(`apps/${appId}`);
      if (!a) {
        await db.updateDoc(`ai_runs/${runId}`, { status: 'error', error: 'Die App wurde gelöscht.', updated_at: db.nowIso() });
        return bad(res, 404, 'App nicht gefunden.');
      }
      const rows = (await loadMessages(a.id, o.uid, 0, 60)).filter(m => Number(m.id) <= (o.lastMsgId || Infinity));
      const ctx = agentCtx(a, { ...o, selfBase: o.selfBase || selfUrl(req) }, historyFrom(rows), cont.state);
      const started = await resumeRun(runId, { isOwner: o.isOwner }, (run) => { ctx.run = run; return runAppAgent(run, ctx); });
      if (!started) return bad(res, 409, 'Der Lauf ist nicht mehr aktiv.');
      return res.status(202).json({ ok: true });
    });
  }

  r.get('/:id/agent', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    const id = toInt(req.query.run) || await activeRun(a.id, req.user.uid);
    if (!id) return res.json({ run: null });
    const x = await db.getDoc(`ai_runs/${id}`, { preferAdmin: true }).catch(() => null);
    if (!x || x.kind !== 'app' || x.ref !== String(a.id)) return res.json({ run: null });
    const from = Math.max(0, parseInt(req.query.from, 10) || 0); const text = x.text || '';
    const { cont: _cont, ...safeRunMeta } = (x.meta && typeof x.meta === 'object' ? x.meta : {});
    void _cont;
    res.json({ id: Number(x.id), status: x.status, from, len: text.length, text: text.slice(Math.min(from, text.length)), think: x.think || {}, agents: x.agents || [], model: req.user.isOwner ? x.model : undefined, error: x.error, meta: safeRunMeta, startedAt: iso(x.created_at), updatedAt: iso(x.updated_at) });
  });

  r.post('/:id/agent/stop', async (req, res) => {
    const a = await memberOf(req, res, req.params.id, true); if (!a) return;
    const runs = await db.runQuery('ai_runs', { where: [['uid', '==', req.user.uid]] }).catch(() => []);
    let stopped = 0;
    for (const x of runs) {
      if (x.kind === 'app' && x.ref === String(a.id) && x.status === 'running') {
        await db.updateDoc(`ai_runs/${x.id}`, { stop: true, updated_at: db.nowIso() }).catch(() => {});
        liveRuns.get(Number(x.id))?.ac.abort();
        stopped++;
      }
    }
    res.json({ ok: true, stopped });
  });

  r.post('/:id/messages', rateLimit('apps-msg', 90, 60), async (req, res) => {
    const a = await memberOf(req, res, req.params.id, true); if (!a) return;
    const role = String(req.body?.role || 'user'); const body = String(req.body?.body ?? '');
    const m = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
    if (!['user', 'assistant', 'tool', 'event'].includes(role)) return bad(res, 400, 'Ungültige Rolle.');
    if (!body.trim() && role === 'user') return bad(res, 400, 'Leere Nachricht.');
    if (body.length > LIMITS.msg) return bad(res, 400, 'Nachricht zu lang.');
    if (JSON.stringify(m).length > LIMITS.meta) return bad(res, 400, 'Zu viele Zusatzdaten.');
    const mid = db.nextId();
    const now = db.nowIso();
    await db.createDoc(`apps/${a.id}/messages/${mid}`, {
      id: mid, app_id: a.id, sender: req.user.uid, role, body, meta: m, created_at: now
    });
    db.updateDoc(`apps/${a.id}`, { updated_at: now }).catch(() => {});
    res.json({ message: { id: Number(mid), role, body, meta: m, mine: true, createdAt: now } });
  });

  r.delete('/:id/messages', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann den Verlauf leeren.');
    await db.deleteCollection(`apps/${a.id}/messages`);
    res.json({ ok: true });
  });

  // ---------- Mitglieder (nur Code-Buddy-Freunde) ----------
  r.post('/:id/members', rateLimit('apps-member', 20, 300), async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann einladen.');
    const handle = String(req.body?.handle || '').trim().toLowerCase().replace(/^@/, '');
    if (!HANDLE_RE.test(handle)) return bad(res, 404, 'Nutzer nicht gefunden.');
    const hdoc = await db.getDoc(`buddy_handles/${handle}`);
    if (!hdoc) return bad(res, 404, 'Nutzer nicht gefunden.');
    const f = await db.getDoc(`friendships/${pairKey(req.user.uid, hdoc.uid)}`);
    if (!f || f.status !== 'accepted') return bad(res, 403, 'Du kannst nur Code-Buddy-Freunde einladen.');
    const curMembers = Array.isArray(a.memberUids) ? a.memberUids : [];
    if (curMembers.length >= LIMITS.members) return bad(res, 400, `Höchstens ${LIMITS.members} Personen pro App.`);
    const existingMember = await db.getDoc(`apps/${a.id}/members/${hdoc.uid}`);
    if (existingMember) return bad(res, 409, 'Ist schon dabei.');
    await db.updateDoc(`apps/${a.id}`, { memberUids: [...new Set([...curMembers, hdoc.uid])] });
    await db.createDoc(`apps/${a.id}/members/${hdoc.uid}`, { app_id: a.id, uid: hdoc.uid, role: 'editor', last_seen: db.nowIso() });
    const mid = db.nextId();
    await db.createDoc(`apps/${a.id}/messages/${mid}`, {
      id: mid, app_id: a.id, sender: req.user.uid, role: 'event', body: `@${hdoc.handle} ist jetzt dabei.`, meta: { kind: 'member' }, created_at: db.nowIso()
    });
    res.json({ ok: true, members: await membersOf(a.id, req.user.uid) });
  });

  r.delete('/:id/members/:handle', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    const hdoc = await db.getDoc(`buddy_handles/${String(req.params.handle).toLowerCase()}`);
    const m = hdoc ? await db.getDoc(`apps/${a.id}/members/${hdoc.uid}`) : null;
    if (!m) return bad(res, 404, 'Nicht in dieser App.');
    if (m.role === 'owner') return bad(res, 400, 'Der Besitzer kann nicht entfernt werden.');
    if (a.role !== 'owner' && hdoc.uid !== req.user.uid) return bad(res, 403, 'Nur der Besitzer kann andere entfernen.');
    await db.deleteDoc(`apps/${a.id}/members/${hdoc.uid}`);
    await db.updateDoc(`apps/${a.id}`, { memberUids: (a.memberUids || []).filter(u => u !== hdoc.uid) });
    res.json({ ok: true });
  });

  // ---------- Veröffentlichen ----------
  r.post('/:id/publish', rateLimit('apps-publish', 20, 300), async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann veröffentlichen.');
    const slug = req.body?.slug !== undefined ? String(req.body.slug).trim().toLowerCase() : a.slug;
    if (!SLUG_RE.test(slug)) return bad(res, 400, 'Adresse: 3 bis 40 Zeichen, nur a-z, 0-9 und Bindestrich (nicht am Anfang/Ende).');
    if (RESERVED.has(slug)) return bad(res, 400, 'Diese Adresse ist reserviert.');
    if (slug !== a.slug) {
      const existingRoute = await db.getDoc(`app_routes/${slug}`, { preferAdmin: true }).catch(() => null);
      if (existingRoute && Number(existingRoute.app_id) !== Number(a.id)) {
        return bad(res, 409, 'Diese Adresse ist schon vergeben.');
      }
      // Falls fremder Besitzer (403 bei anderem Dokument): als vergeben melden
      if (!existingRoute && !db.isMemoryDb() && !process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
          await db.createDoc(`app_routes/${slug}`, { app_id: a.id, owner: a.owner, slug, published: true });
        } catch (e) {
          if (e.code === 'ALREADY_EXISTS' || e.code === 'PERMISSION_DENIED') {
            return bad(res, 409, 'Diese Adresse ist schon vergeben.');
          }
        }
      }
    }
    const now = db.nowIso();
    const u = await db.updateDoc(`apps/${a.id}`, {
      slug,
      published: true,
      published_at: a.published_at || now,
      updated_at: now
    });
    await syncPublicDocs(u, { oldSlug: a.slug, oldToken: a.preview_token });
    u.role = a.role; res.json({ app: meta(u, req) });
  });

  r.delete('/:id/publish', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann das ändern.');
    const u = await db.updateDoc(`apps/${a.id}`, { published: false, updated_at: db.nowIso() });
    await syncPublicDocs(u);
    u.role = a.role; res.json({ app: meta(u, req) });
  });

  r.post('/:id/token', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann den Testlink erneuern.');
    const nextTok = token();
    const u = await db.updateDoc(`apps/${a.id}`, { preview_token: nextTok, updated_at: db.nowIso() });
    await syncPublicDocs(u, { oldToken: a.preview_token });
    u.role = a.role; res.json({ app: meta(u, req) });
  });

  // ---------- Android-APK (über GitHub Actions) ----------
  r.post('/:id/apk', rateLimit('apps-apk', 6, 3600), async (req, res) => {
    const a = await memberOf(req, res, req.params.id, true); if (!a) return;
    if (!['android', 'both'].includes(a.kind)) return bad(res, 400, 'APKs gibt es nur für Android-Apps.');
    if (!a.published) return bad(res, 400, 'Veröffentliche die App zuerst – die APK öffnet deine Coden-Adresse.', { code: 'NOT_PUBLISHED' });
    if (!apk.configured()) return bad(res, 501, 'Der APK-Build ist auf diesem Server noch nicht eingerichtet (GH_APK_TOKEN fehlt).', { code: 'APK_NOT_CONFIGURED' });
    const st = apk.publicState(a.apk);
    if (st.status === 'building') return res.json({ apk: st });
    const next = await apk.dispatch({ slug: a.slug, name: a.name, url: publicUrl(req, a.slug), color: a.theme_color });
    await db.updateDoc(`apps/${a.id}`, { apk: next }, { preferAdmin: a.owner !== req.user.uid });
    res.json({ apk: apk.publicState(next) });
  });

  r.get('/:id/apk', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    let state = a.apk || {};
    if (state.status === 'building') {
      const next = await apk.check(a.slug, state).catch(() => state);
      if (JSON.stringify(next) !== JSON.stringify(state)) {
        await db.updateDoc(`apps/${a.id}`, { apk: next }, { preferAdmin: a.owner !== req.user.uid });
        state = next;
      }
    }
    res.json({ apk: apk.publicState(state), configured: apk.configured() });
  });

  return r;
}

// =====================================================================
// Öffentlich: Daten für die Hülle (/api/public/apps/<slug>) und die Hülle selbst (/a/<slug>/)
// =====================================================================
async function loadPublic(slug, t) {
  slug = String(slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return null;
  if (t && typeof t === 'string' && t.length >= 8 && t.length <= 64) {
    const prev = await db.getDoc(`app_previews/${previewIdOf(slug, String(t))}`).catch(() => null);
    if (prev) return { a: prev, preview: true };
  }
  const route = await db.getDoc(`app_routes/${slug}`).catch(() => null);
  if (route && route.published) return { a: route, preview: false };
  // Fallback (z. B. falls Service-Account aktiv oder Memory-DB)
  if (db.isMemoryDb() || process.env.FIREBASE_SERVICE_ACCOUNT) {
    const [a] = await db.runQuery('apps', { where: [['slug', '==', slug]], limit: 1, preferAdmin: true }).catch(() => []);
    if (!a) return null;
    const preview = !!t && sameToken(String(t), a.preview_token);
    if (!a.published && !preview) return null;
    return { a, preview };
  }
  return null;
}

function publicApiRouter() {
  const r = wrapRouter(express.Router());
  r.get('/apps/:slug', rateLimit('pub-app', 240, 60, byIp), async (req, res) => {
    const x = await loadPublic(req.params.slug, req.query.t); if (!x) return bad(res, 404, 'Diese App gibt es nicht oder sie ist nicht öffentlich.');
    const b = bundleFor(x.a);
    res.json({ name: x.a.name, kind: x.a.kind, version: x.a.version, themeColor: x.a.theme_color, entry: b.entry, pages: b.pages, preview: x.preview });
  });
  r.get('/img/:key', rateLimit('pub-img', 600, 60, byIp), async (req, res) => {
    if (!/^[a-f0-9]{18}$/.test(req.params.key)) return res.status(404).end();
    const im = await db.getDoc(`app_images/${req.params.key}`).catch(() => null);
    if (!im) return res.status(404).end();
    const buf = im.data_b64 ? Buffer.from(im.data_b64, 'base64') : Buffer.from(im.data || '');
    res.setHeader('Content-Type', im.mime); res.set('Cache-Control', 'public, max-age=31536000, immutable').set('Access-Control-Allow-Origin', '*').end(buf);
  });
  r.get('/apps/:slug/version', rateLimit('pub-ver', 120, 60, byIp), async (req, res) => {
    const x = await loadPublic(req.params.slug, req.query.t); if (!x) return bad(res, 404, 'Nicht gefunden.');
    res.json({ version: x.a.version });
  });
  return r;
}

const HOST_SCRIPT = require('./app-host');
function wrapperHtml({ a, preview, slug, page, t }) {
  const style = Styles.byId(a.style); const bg = style ? style.v.bg : '#ffffff';
  const q = preview ? `?t=${encodeURIComponent(t)}` : '';
  const cfg = { slug, page, t: preview ? t : '', preview, name: a.name, kind: a.kind, bg };
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escHtml(a.name)}</title><meta name="theme-color" content="${escHtml(a.theme_color)}">
<link rel="manifest" href="/a/${slug}/manifest.webmanifest${q}"><link rel="icon" type="image/png" href="/a/${slug}/icon-192.png${q}"><link rel="apple-touch-icon" href="/a/${slug}/icon-180.png${q}">
<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="${escHtml(a.name.slice(0, 30))}"><meta name="apple-mobile-web-app-status-bar-style" content="default">
${preview ? '<meta name="robots" content="noindex">' : ''}
<style>html,body{margin:0;height:100%;background:${escHtml(bg)};overflow:hidden}#f{position:fixed;inset:0;width:100%;height:100%;border:0;background:${escHtml(bg)}}
#ld{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}#ld i{width:34px;height:34px;border-radius:50%;border:3px solid rgba(128,128,128,.25);border-top-color:${escHtml(a.theme_color)};animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
#cb{position:fixed;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:5;display:flex;align-items:center;gap:6px;padding:5px 10px 5px 6px;border-radius:999px;background:rgba(20,20,24,.72);color:#fff;font:600 11px system-ui,sans-serif;text-decoration:none;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:.85}
#cb.fade{opacity:0;pointer-events:none;transition:opacity .6s}#cb b{width:16px;height:16px;border-radius:5px;background:linear-gradient(135deg,#8ab4f8,#c58af9,#f28b82);display:inline-block}#cb button{all:unset;cursor:pointer;margin-left:2px;opacity:.7}
#lv{position:fixed;left:50%;top:calc(8px + env(safe-area-inset-top));transform:translateX(-50%);z-index:6;padding:6px 12px;border-radius:999px;background:rgba(20,20,24,.8);color:#fff;font:600 12px system-ui,sans-serif;display:none}
#er{position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:8px;font:15px system-ui,sans-serif;color:#555;text-align:center;padding:24px}
@media (display-mode: standalone){#cb{display:none}}</style>
</head><body><div id="ld"><i></i></div><div id="er"></div><div id="lv"></div>
<iframe id="f" title="${escHtml(a.name)}" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock" allow="geolocation; camera; microphone; clipboard-write; fullscreen; autoplay; web-share"></iframe>
<a id="cb" href="/" target="_blank" rel="noopener"><b></b>Mit Coden gebaut<button type="button" aria-label="Ausblenden" onclick="event.preventDefault();this.parentNode.remove()">✕</button></a>
<script>window.__CODEN_APP__=${JSON.stringify(cfg).replace(/</g, '\\u003c')};</script>
<script>${HOST_SCRIPT}</script>
</body></html>`;
}

function notFoundHtml() {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nicht gefunden · Coden</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#131314;color:#e3e3e3;font:16px system-ui,sans-serif;text-align:center;padding:24px}a{color:#a8c7fa}h1{font-size:22px}</style></head>
<body><div><h1>Diese App gibt es nicht (mehr)</h1><p>Oder sie ist noch nicht veröffentlicht. Testlinks funktionieren nur mit dem vollständigen Link aus Coden.</p><p><a href="/">Zu Coden</a></p></div></body></html>`;
}

function hostedRouter() {
  const r = wrapRouter(express.Router({ strict: true }));
  const limiter = rateLimit('pub-host', 240, 60, byIp);
  r.get('/:slug/manifest.webmanifest', limiter, async (req, res) => {
    const x = await loadPublic(req.params.slug, req.query.t); if (!x) return res.status(404).json({});
    const { a, preview } = x; const base = `/a/${a.slug}/`; const style = Styles.byId(a.style);
    const q = preview ? `?t=${encodeURIComponent(req.query.t)}` : '';
    res.set('Content-Type', 'application/manifest+json; charset=utf-8').set('Cache-Control', 'public, max-age=300');
    res.send(JSON.stringify({
      id: base, name: a.name, short_name: a.name.slice(0, 12), start_url: base + q, scope: base,
      display: 'standalone', orientation: a.kind === 'web' || a.kind === 'game' ? 'any' : 'portrait', background_color: style ? style.v.bg.match(/^#/) ? style.v.bg : '#ffffff' : '#ffffff', theme_color: a.theme_color, lang: 'de',
      icons: [{ src: base + 'icon-192.png' + q, sizes: '192x192', type: 'image/png' }, { src: base + 'icon-512.png' + q, sizes: '512x512', type: 'image/png' }, { src: base + 'icon-maskable.png' + q, sizes: '512x512', type: 'image/png', purpose: 'maskable' }]
    }));
  });
  r.get(/^\/([a-z0-9-]+)\/icon-(180|192|512|maskable)\.png$/, limiter, async (req, res) => {
    const slug = req.params[0]; const kind = req.params[1];
    let a = (await loadPublic(slug, req.query.t))?.a || null;
    if (!a && SLUG_RE.test(slug) && (db.isMemoryDb() || process.env.FIREBASE_SERVICE_ACCOUNT)) {
      a = await db.getDoc(`app_routes/${slug}`, { preferAdmin: true }).catch(() => null);
    }
    if (!a) return res.status(404).end();
    const png = iconPng({ size: kind === 'maskable' ? 512 : +kind, color: a.theme_color, letter: a.name.trim()[0] || 'C', maskable: kind === 'maskable' });
    res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=3600').send(png);
  });
  r.get('/:slug/sw.js', (req, res) => {
    const slug = String(req.params.slug); if (!SLUG_RE.test(slug)) return res.status(404).end();
    res.set('Content-Type', 'text/javascript; charset=utf-8').set('Cache-Control', 'no-cache').set('Service-Worker-Allowed', `/a/${slug}/`);
    res.send(`// Coden: offline-Fähigkeit für installierte Apps (erst Netz, sonst letzte bekannte Fassung)
const C='coden-${slug}';self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
if(!(u.pathname.startsWith('/a/${slug}/')||u.pathname.startsWith('/api/public/apps/${slug}'))||u.pathname.endsWith('/version'))return;
e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request,{ignoreSearch:u.pathname.startsWith('/a/')}).then(r=>r||Response.error())))});`);
  });
  // Die Hülle: /a/<slug>/ und /a/<slug>/<seite>.html
  r.get(/^\/([a-z0-9-]+)(?:\/([A-Za-z0-9_\-\/.]*))?$/, limiter, async (req, res) => {
    const slug = req.params[0]; const page = req.params[1] || '';
    const x = await loadPublic(slug, req.query.t);
    res.set('X-Frame-Options', 'SAMEORIGIN').set('Referrer-Policy', 'no-referrer');
    if (!x) return res.status(404).type('html').send(notFoundHtml());
    res.type('html').send(wrapperHtml({ a: x.a, preview: x.preview, slug: x.a.slug, page: page && /\.html?$/.test(page) ? page : '', t: req.query.t }));
  });
  return r;
}

module.exports = { baseUrl, appsRouter, publicApiRouter, hostedRouter, slugify, randomSlug, checkFiles, bundleFor, wrapperHtml, LIMITS };
