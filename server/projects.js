// Projekte: eigener Arbeitsbereich mit Anweisungen und Wissensdateien. Gehört genau einem Nutzer (Firestore).
const express = require('express');
const db = require('./db');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');

const LIMITS = { projects: 30, files: 20, file: 150_000, total: 600_000, name: 60, desc: 300, instr: 8_000 };
const FILE_RE = /^(?!.*\.\.)[A-Za-z0-9_À-ɏ][A-Za-z0-9_À-ɏ.\- ]{0,79}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const bad = (res, status, error) => res.status(status).json({ error });
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const str = (v, n) => String(v ?? '').replace(/\u0000/g, '').slice(0, n);

function projectsRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);

  const mine = async (req, res) => {
    const id = toInt(req.params.id); if (!id) { bad(res, 404, 'Projekt nicht gefunden.'); return null; }
    const p = await db.getDoc(`user_projects/${id}`);
    if (!p || p.uid !== req.user.uid) { bad(res, 404, 'Projekt nicht gefunden.'); return null; }
    return p;
  };
  const meta = (p) => ({ id: Number(p.id), name: p.name, description: p.description, color: p.color, instructions: p.instructions, fileCount: Object.keys(p.files || {}).length, updatedAt: p.updated_at instanceof Date ? p.updated_at.toISOString() : p.updated_at });
  const checkFiles = (files) => {
    const names = Object.keys(files);
    if (names.length > LIMITS.files) return `Höchstens ${LIMITS.files} Dateien pro Projekt.`;
    let total = 0;
    for (const n of names) {
      if (!FILE_RE.test(n)) return `Ungültiger Dateiname: ${n.slice(0, 40)}`;
      if (typeof files[n] !== 'string') return 'Dateien müssen Text sein.';
      if (files[n].length > LIMITS.file) return `„${n}“ ist zu groß (max. ${LIMITS.file / 1000} KB Text).`;
      total += files[n].length;
    }
    if (total > LIMITS.total) return `Alle Dateien zusammen dürfen höchstens ${LIMITS.total / 1000} KB Text haben.`;
    return null;
  };

  r.get('/', async (req, res) => {
    const rows = await db.runQuery('user_projects', { where: [['uid', '==', req.user.uid]], orderBy: 'updated_at', desc: true, limit: 100 });
    res.json({ projects: rows.map(p => { const m = meta(p); delete m.instructions; return m; }) });
  });

  r.post('/', rateLimit('projects-create', 60, 600), async (req, res) => {
    const name = str(req.body?.name, LIMITS.name).trim();
    if (!name) return bad(res, 400, 'Gib dem Projekt einen Namen.');
    const existing = await db.runQuery('user_projects', { where: [['uid', '==', req.user.uid]] });
    if (existing.length >= LIMITS.projects) return bad(res, 400, `Du hast schon ${LIMITS.projects} Projekte.`);
    const color = COLOR_RE.test(req.body?.color || '') ? req.body.color : '#8ab4f8';
    const id = db.nextId();
    const now = db.nowIso();
    const p = await db.createDoc(`user_projects/${id}`, {
      id,
      uid: req.user.uid,
      name,
      description: str(req.body?.description, LIMITS.desc),
      instructions: str(req.body?.instructions, LIMITS.instr),
      files: {},
      color,
      created_at: now,
      updated_at: now
    });
    res.json({ project: meta(p), files: {} });
  });

  r.get('/:id', async (req, res) => {
    const p = await mine(req, res); if (!p) return;
    res.json({ project: meta(p), files: p.files || {} });
  });

  r.patch('/:id', rateLimit('projects-edit', 120, 60), async (req, res) => {
    const p = await mine(req, res); if (!p) return;
    const b = req.body || {};
    const name = 'name' in b ? str(b.name, LIMITS.name).trim() : p.name;
    if (!name) return bad(res, 400, 'Der Name darf nicht leer sein.');
    const desc = 'description' in b ? str(b.description, LIMITS.desc) : p.description;
    const instr = 'instructions' in b ? str(b.instructions, LIMITS.instr) : p.instructions;
    const color = 'color' in b ? (COLOR_RE.test(b.color || '') ? b.color : p.color) : p.color;
    const u = await db.updateDoc(`user_projects/${p.id}`, { name, description: desc, instructions: instr, color, updated_at: db.nowIso() });
    res.json({ project: meta(u || p) });
  });

  r.delete('/:id', async (req, res) => {
    const p = await mine(req, res); if (!p) return;
    await db.deleteDoc(`user_projects/${p.id}`);
    res.json({ ok: true });
  });

  r.put('/:id/files', rateLimit('projects-files', 60, 60), async (req, res) => {
    const p = await mine(req, res); if (!p) return;
    const set = req.body?.set && typeof req.body.set === 'object' && !Array.isArray(req.body.set) ? req.body.set : {};
    const remove = Array.isArray(req.body?.remove) ? req.body.remove.map(String) : [];
    const files = { ...(p.files || {}) };
    for (const n of remove) delete files[n];
    for (const [n, c] of Object.entries(set)) files[String(n)] = typeof c === 'string' ? c.replace(/\u0000/g, '') : c;
    const err = checkFiles(files); if (err) return bad(res, 400, err);
    await db.updateDoc(`user_projects/${p.id}`, { files, updated_at: db.nowIso() });
    res.json({ files: Object.keys(files) });
  });

  return r;
}
module.exports = { projectsRouter, LIMITS };
