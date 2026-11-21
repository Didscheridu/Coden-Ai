// App-Builder: Apps anlegen, Dateien speichern, gemeinsamer Agent-Chat, Mitglieder (Code Buddy), Veröffentlichen.
// Plus die öffentliche Seite /a/<slug>/ – sie zeigt die App in einer Sandbox, damit fremder Code nie an Coden-Logins kommt.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { getSql } = require('./db');
const { rateLimit, byIp } = require('./rateLimit');
const { wrapRouter } = require('./util');
const { iconPng } = require('./icon');
const Bundle = require('../shared/app-bundle');
const Styles = require('../shared/app-styles');
const apk = require('./apk');

const KINDS = ['web', 'ios', 'android', 'both'];
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(['api', 'admin', 'coden', 'www', 'app', 'apps', 'kit', 'shared', 'static', 'login', 'help', 'support', 'status', 'a', 'assets']);
const FILE_RE = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9_][A-Za-z0-9_.\-\/]{0,99}$/;
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const LIMITS = { files: 60, file: 400_000, total: 1_500_000, apps: 40, members: 8, msg: 60_000, meta: 8_000 };
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const bad = (res, status, error, extra) => res.status(status).json({ error, ...extra });
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const token = () => crypto.randomBytes(12).toString('base64url');
const sameToken = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); };
const escHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  const key = `${app.id}:${app.version}`;
  if (cache.has(key)) return cache.get(key);
  const style = Styles.byId(app.style);
  const platform = app.kind === 'both' ? null : app.kind;
  const b = Bundle.build(app.files || {}, { kit: kit(), themeCss: Styles.themeCss(style), fontsHref: Styles.fontsHref(style), platform });
  cache.set(key, b); if (cache.size > 60) cache.delete(cache.keys().next().value);
  return b;
}

function publicUrl(req, slug) {
  const base = process.env.PUBLIC_APP_BASE || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  return `${base.replace(/\/$/, '')}/a/${slug}/`;
}

// =====================================================================
// Geschützte API (/api/apps …)
// =====================================================================
function appsRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);

  async function memberOf(req, res, id) {
    id = toInt(id); if (!id) { bad(res, 404, 'App nicht gefunden.'); return null; }
    const [a] = await getSql()`SELECT a.*, m.role FROM apps a JOIN app_members m ON m.app_id = a.id AND m.uid = ${req.user.uid} WHERE a.id = ${id}`;
    if (!a) { bad(res, 404, 'App nicht gefunden.'); return null; }
    return a;
  }
  const meta = (a, req) => ({
    id: Number(a.id), name: a.name, kind: a.kind, style: a.style, slug: a.slug, published: a.published, version: a.version,
    themeColor: a.theme_color, role: a.role, previewToken: a.preview_token, integrations: a.integrations || {},
    url: publicUrl(req, a.slug), testUrl: publicUrl(req, a.slug) + '?t=' + a.preview_token,
    apk: apk.publicState(a.apk), updatedAt: iso(a.updated_at), publishedAt: iso(a.published_at)
  });
  async function membersOf(id, uid) {
    const rows = await getSql()`SELECT m.uid, m.role, m.last_seen, p.handle, p.display_name FROM app_members m LEFT JOIN profiles p ON p.uid = m.uid WHERE m.app_id = ${id} ORDER BY (m.role = 'owner') DESC, p.handle`;
    const now = Date.now();
    return rows.map(m => ({ handle: m.handle || null, displayName: m.display_name || (m.role === 'owner' ? 'Besitzer' : 'Mitglied'), role: m.role, me: m.uid === uid, online: now - new Date(m.last_seen).getTime() < 45_000 }));
  }
  const touch = (id, uid) => getSql()`UPDATE app_members SET last_seen = now() WHERE app_id = ${id} AND uid = ${uid} AND last_seen < now() - interval '15 seconds'`.catch(() => {});

  // Liste: eigene und geteilte Apps
  r.get('/', async (req, res) => {
    const rows = await getSql()`
      SELECT a.id, a.name, a.kind, a.style, a.slug, a.published, a.updated_at, a.theme_color, a.preview_token, a.version, m.role,
        (SELECT count(*)::int FROM app_members x WHERE x.app_id = a.id) AS members
      FROM apps a JOIN app_members m ON m.app_id = a.id AND m.uid = ${req.user.uid} ORDER BY a.updated_at DESC LIMIT 100`;
    res.json({ apps: rows.map(a => ({ id: Number(a.id), name: a.name, kind: a.kind, style: a.style, slug: a.slug, published: a.published, role: a.role, members: a.members, themeColor: a.theme_color, version: a.version, updatedAt: iso(a.updated_at), url: publicUrl(req, a.slug), testUrl: publicUrl(req, a.slug) + '?t=' + a.preview_token })) });
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
    const sql = getSql();
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM apps WHERE owner = ${req.user.uid}`;
    if (n >= LIMITS.apps && !req.user.isOwner) return bad(res, 400, `Du hast schon ${LIMITS.apps} Apps. Lösche eine alte, um eine neue anzulegen.`);
    let a;
    for (let i = 0; i < 4 && !a; i++) {
      try { [a] = await sql`INSERT INTO apps (owner, name, kind, style, slug, preview_token, files, theme_color) VALUES (${req.user.uid}, ${name}, ${kind}, ${style}, ${randomSlug(name)}, ${token()}, ${JSON.stringify(files)}::jsonb, ${themeColor}) RETURNING *`; }
      catch (e) { if (e.code !== '23505') throw e; }
    }
    if (!a) return bad(res, 500, 'Konnte keine Adresse vergeben.');
    await sql`INSERT INTO app_members (app_id, uid, role) VALUES (${a.id}, ${req.user.uid}, 'owner')`;
    a.role = 'owner';
    res.json({ app: meta(a, req), files: a.files });
  });

  r.get('/:id', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    touch(a.id, req.user.uid);
    res.json({ app: meta(a, req), files: a.files, members: await membersOf(a.id, req.user.uid) });
  });

  r.patch('/:id', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    const b = req.body || {}; const sql = getSql();
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
    const [u] = await sql`UPDATE apps SET name = ${name}, kind = ${kind}, style = ${style}, theme_color = ${color}, integrations = ${JSON.stringify(integ)}::jsonb, version = version + 1, updated_at = now() WHERE id = ${a.id} RETURNING *`;
    u.role = a.role; res.json({ app: meta(u, req) });
  });

  r.delete('/:id', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann die App löschen.');
    await getSql()`DELETE FROM apps WHERE id = ${a.id}`;
    res.json({ ok: true });
  });

  // Dateien ändern: set = {pfad: inhalt}, remove = [pfad]. Verschiedene Dateien kollidieren nie; gleiche Datei: zuletzt gewinnt.
  r.put('/:id/files', rateLimit('apps-files', 90, 60), async (req, res) => {
    const id = toInt(req.params.id); const sql = getSql();
    const set = req.body?.set && typeof req.body.set === 'object' && !Array.isArray(req.body.set) ? req.body.set : {};
    const remove = Array.isArray(req.body?.remove) ? req.body.remove.map(String) : [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const a = await memberOf(req, res, id); if (!a) return;
      const files = { ...(a.files || {}) };
      for (const n of remove) delete files[n];
      for (const [n, c] of Object.entries(set)) files[n] = c;
      const err = checkFiles(files); if (err) return bad(res, 400, err);
      const rows = await sql`UPDATE apps SET files = ${JSON.stringify(files)}::jsonb, version = version + 1, updated_at = now() WHERE id = ${a.id} AND version = ${a.version} RETURNING version`;
      if (rows.length) return res.json({ version: rows[0].version, files: Object.keys(files) });
    }
    bad(res, 409, 'Gerade ändern zu viele gleichzeitig. Bitte nochmal versuchen.');
  });

  // Leichte Abfrage für Live-Zusammenarbeit (alle paar Sekunden)
  r.get('/:id/poll', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    touch(a.id, req.user.uid);
    const after = toInt(req.query.after);
    const messages = after ? await loadMessages(a.id, req.user.uid, after) : [];
    res.json({ version: a.version, name: a.name, published: a.published, apk: apk.publicState(a.apk), messages, members: await membersOf(a.id, req.user.uid) });
  });

  async function loadMessages(appId, uid, after = 0, limit = 120) {
    const rows = after
      ? await getSql()`SELECT m.id, m.sender, m.role, m.body, m.meta, m.created_at, p.handle FROM app_messages m LEFT JOIN profiles p ON p.uid = m.sender WHERE m.app_id = ${appId} AND m.id > ${after} ORDER BY m.id LIMIT ${limit}`
      : await getSql()`SELECT * FROM (SELECT m.id, m.sender, m.role, m.body, m.meta, m.created_at, p.handle FROM app_messages m LEFT JOIN profiles p ON p.uid = m.sender WHERE m.app_id = ${appId} ORDER BY m.id DESC LIMIT ${limit}) x ORDER BY id`;
    return rows.map(m => ({ id: Number(m.id), role: m.role, body: m.body, meta: m.meta || {}, handle: m.handle || null, mine: m.sender === uid, createdAt: iso(m.created_at) }));
  }
  r.get('/:id/messages', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    res.json({ messages: await loadMessages(a.id, req.user.uid, toInt(req.query.after)) });
  });
  r.post('/:id/messages', rateLimit('apps-msg', 90, 60), async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    const role = String(req.body?.role || 'user'); const body = String(req.body?.body ?? '');
    const m = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
    if (!['user', 'assistant', 'tool', 'event'].includes(role)) return bad(res, 400, 'Ungültige Rolle.');
    if (!body.trim() && role === 'user') return bad(res, 400, 'Leere Nachricht.');
    if (body.length > LIMITS.msg) return bad(res, 400, 'Nachricht zu lang.');
    if (JSON.stringify(m).length > LIMITS.meta) return bad(res, 400, 'Zu viele Zusatzdaten.');
    const [row] = await getSql()`INSERT INTO app_messages (app_id, sender, role, body, meta) VALUES (${a.id}, ${req.user.uid}, ${role}, ${body}, ${JSON.stringify(m)}::jsonb) RETURNING id, created_at`;
    getSql()`UPDATE apps SET updated_at = now() WHERE id = ${a.id}`.catch(() => {});
    res.json({ message: { id: Number(row.id), role, body, meta: m, mine: true, createdAt: iso(row.created_at) } });
  });
  r.delete('/:id/messages', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann den Verlauf leeren.');
    await getSql()`DELETE FROM app_messages WHERE app_id = ${a.id}`;
    res.json({ ok: true });
  });

  // ---------- Mitglieder (nur Code-Buddy-Freunde) ----------
  r.post('/:id/members', rateLimit('apps-member', 20, 300), async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann einladen.');
    const sql = getSql();
    const handle = String(req.body?.handle || '').trim().toLowerCase().replace(/^@/, '');
    if (!HANDLE_RE.test(handle)) return bad(res, 404, 'Nutzer nicht gefunden.');
    const [other] = await sql`SELECT uid, handle FROM profiles WHERE handle = ${handle}`;
    if (!other) return bad(res, 404, 'Nutzer nicht gefunden.');
    const [f] = await sql`SELECT status FROM friendships WHERE LEAST(requester, addressee) = LEAST(${req.user.uid}, ${other.uid}) AND GREATEST(requester, addressee) = GREATEST(${req.user.uid}, ${other.uid})`;
    if (!f || f.status !== 'accepted') return bad(res, 403, 'Du kannst nur Code-Buddy-Freunde einladen.');
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM app_members WHERE app_id = ${a.id}`;
    if (n >= LIMITS.members) return bad(res, 400, `Höchstens ${LIMITS.members} Personen pro App.`);
    const ins = await sql`INSERT INTO app_members (app_id, uid, role) VALUES (${a.id}, ${other.uid}, 'editor') ON CONFLICT DO NOTHING RETURNING uid`;
    if (!ins.length) return bad(res, 409, 'Ist schon dabei.');
    await sql`INSERT INTO app_messages (app_id, sender, role, body, meta) VALUES (${a.id}, ${req.user.uid}, 'event', ${'@' + other.handle + ' ist jetzt dabei.'}, '{"kind":"member"}'::jsonb)`;
    res.json({ ok: true, members: await membersOf(a.id, req.user.uid) });
  });
  r.delete('/:id/members/:handle', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    const sql = getSql();
    const [other] = await sql`SELECT p.uid, m.role FROM profiles p JOIN app_members m ON m.uid = p.uid AND m.app_id = ${a.id} WHERE p.handle = ${String(req.params.handle).toLowerCase()}`;
    if (!other) return bad(res, 404, 'Nicht in dieser App.');
    if (other.role === 'owner') return bad(res, 400, 'Der Besitzer kann nicht entfernt werden.');
    if (a.role !== 'owner' && other.uid !== req.user.uid) return bad(res, 403, 'Nur der Besitzer kann andere entfernen.');
    await sql`DELETE FROM app_members WHERE app_id = ${a.id} AND uid = ${other.uid}`;
    res.json({ ok: true });
  });

  // ---------- Veröffentlichen ----------
  r.post('/:id/publish', rateLimit('apps-publish', 20, 300), async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann veröffentlichen.');
    let slug = req.body?.slug !== undefined ? String(req.body.slug).trim().toLowerCase() : a.slug;
    if (!SLUG_RE.test(slug)) return bad(res, 400, 'Adresse: 3 bis 40 Zeichen, nur a-z, 0-9 und Bindestrich (nicht am Anfang/Ende).');
    if (RESERVED.has(slug)) return bad(res, 400, 'Diese Adresse ist reserviert.');
    let u;
    try { [u] = await getSql()`UPDATE apps SET slug = ${slug}, published = true, published_at = COALESCE(published_at, now()), updated_at = now() WHERE id = ${a.id} RETURNING *`; }
    catch (e) { if (e.code === '23505') return bad(res, 409, 'Diese Adresse ist schon vergeben.'); throw e; }
    u.role = a.role; res.json({ app: meta(u, req) });
  });
  r.delete('/:id/publish', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann das ändern.');
    const [u] = await getSql()`UPDATE apps SET published = false, updated_at = now() WHERE id = ${a.id} RETURNING *`;
    u.role = a.role; res.json({ app: meta(u, req) });
  });
  r.post('/:id/token', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (a.role !== 'owner') return bad(res, 403, 'Nur der Besitzer kann den Testlink erneuern.');
    const [u] = await getSql()`UPDATE apps SET preview_token = ${token()} WHERE id = ${a.id} RETURNING *`;
    u.role = a.role; res.json({ app: meta(u, req) });
  });

  // ---------- Android-APK (über GitHub Actions) ----------
  r.post('/:id/apk', rateLimit('apps-apk', 6, 3600), async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    if (!['android', 'both'].includes(a.kind)) return bad(res, 400, 'APKs gibt es nur für Android-Apps.');
    if (!a.published) return bad(res, 400, 'Veröffentliche die App zuerst – die APK öffnet deine Coden-Adresse.', { code: 'NOT_PUBLISHED' });
    if (!apk.configured()) return bad(res, 501, 'Der APK-Build ist auf diesem Server noch nicht eingerichtet (GH_APK_TOKEN fehlt).', { code: 'APK_NOT_CONFIGURED' });
    const st = apk.publicState(a.apk);
    if (st.status === 'building') return res.json({ apk: st });
    const next = await apk.dispatch({ slug: a.slug, name: a.name, url: publicUrl(req, a.slug), color: a.theme_color });
    await getSql()`UPDATE apps SET apk = ${JSON.stringify(next)}::jsonb WHERE id = ${a.id}`;
    res.json({ apk: apk.publicState(next) });
  });
  r.get('/:id/apk', async (req, res) => {
    const a = await memberOf(req, res, req.params.id); if (!a) return;
    let state = a.apk || {};
    if (state.status === 'building') {
      const next = await apk.check(a.slug, state).catch(() => state);
      if (JSON.stringify(next) !== JSON.stringify(state)) { await getSql()`UPDATE apps SET apk = ${JSON.stringify(next)}::jsonb WHERE id = ${a.id}`; state = next; }
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
  const [a] = await getSql()`SELECT id, name, kind, style, slug, published, preview_token, files, version, theme_color FROM apps WHERE slug = ${slug}`;
  if (!a) return null;
  const preview = !!t && sameToken(String(t), a.preview_token);
  if (!a.published && !preview) return null;
  return { a, preview };
}

function publicApiRouter() {
  const r = wrapRouter(express.Router());
  r.get('/apps/:slug', rateLimit('pub-app', 240, 60, byIp), async (req, res) => {
    const x = await loadPublic(req.params.slug, req.query.t); if (!x) return bad(res, 404, 'Diese App gibt es nicht oder sie ist nicht öffentlich.');
    const b = bundleFor(x.a);
    res.json({ name: x.a.name, kind: x.a.kind, version: x.a.version, themeColor: x.a.theme_color, entry: b.entry, pages: b.pages, preview: x.preview });
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
<link rel="manifest" href="/a/${slug}/manifest.webmanifest${q}"><link rel="icon" type="image/png" href="/a/${slug}/icon-192.png"><link rel="apple-touch-icon" href="/a/${slug}/icon-180.png">
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
    res.set('Content-Type', 'application/manifest+json; charset=utf-8').set('Cache-Control', 'public, max-age=300');
    res.send(JSON.stringify({
      id: base, name: a.name, short_name: a.name.slice(0, 12), start_url: base + (preview ? `?t=${encodeURIComponent(req.query.t)}` : ''), scope: base,
      display: 'standalone', orientation: a.kind === 'web' ? 'any' : 'portrait', background_color: style ? style.v.bg.match(/^#/) ? style.v.bg : '#ffffff' : '#ffffff', theme_color: a.theme_color, lang: 'de',
      icons: [{ src: base + 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: base + 'icon-512.png', sizes: '512x512', type: 'image/png' }, { src: base + 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }]
    }));
  });
  r.get(/^\/([a-z0-9-]+)\/icon-(180|192|512|maskable)\.png$/, limiter, async (req, res) => {
    const slug = req.params[0]; const kind = req.params[1];
    const [a] = SLUG_RE.test(slug) ? await getSql()`SELECT name, theme_color FROM apps WHERE slug = ${slug}` : [];
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

module.exports = { appsRouter, publicApiRouter, hostedRouter, slugify, randomSlug, checkFiles, bundleFor, wrapperHtml, LIMITS };
