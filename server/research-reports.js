// Research-Bibliothek: Jede Recherche wird als Bericht gespeichert (Firestore: research_reports/{id}).
// Start über die Research-Seite (eigener Hintergrund-Lauf), aus dem Chat (Deep Research) oder aus geplanten Aufgaben.
// Der Chat kann Berichte lesen (<research_read id="…"/>), Projekte bekommen sie als Wissensdatei.
const express = require('express');
const db = require('./db');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');
const Push = require('./push');
const { Meter } = require('./usage');
const { startRun } = require('./runs');
const PROJ = require('./projects').LIMITS;

const LIMITS = { reports: 200, text: 80_000, title: 120, question: 600, projects: 20 };
const DEPTHS = ['quick', 'normal', 'deep'];
const ORIGINS = ['page', 'chat', 'task'];
const fail = (status, message) => Object.assign(new Error(message), { status });
const str = (v, n) => String(v ?? '').replace(/\u0000/g, '').slice(0, n);
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const iso = (d) => (d instanceof Date ? d.toISOString() : d || null);

// Titel: erste Überschrift des Berichts, sonst die Frage
function titleFrom(question, text = '') {
  const head = String(text || '').match(/^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/m);
  const t = (head ? head[1] : String(question || '')).replace(/[*_`[\]]/g, '').replace(/\s+/g, ' ').trim();
  return (t || 'Recherche').slice(0, LIMITS.title);
}
// Anzahl Quellen = Einträge unter „**Quellen**“
function sourceCount(text = '') {
  const i = String(text).lastIndexOf('**Quellen**'); if (i < 0) return 0;
  return (String(text).slice(i).match(/^\d+\.\s+\[/gm) || []).length;
}
// Kurzfassung für Listen und den Systemprompt: erster richtiger Absatz
function summaryOf(text = '') {
  const body = String(text).split(/\n---\n/)[0];
  const para = body.split(/\n{2,}/).map(p => p.trim()).find(p => p && !/^#/.test(p) && p.length > 40) || '';
  return para.replace(/\[(\d+)\]/g, '').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

// ---------- Projekte: Bericht als Wissensdatei „Research <id> - <Titel>.md“ ----------
const dayDe = (v) => { try { return new Date(iso(v) || Date.now()).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }); } catch (_) { return ''; } };
function projectFileName(title, id) {
  const base = String(title || 'Bericht').replace(/[^A-Za-z0-9_À-ɏ.\- ]/g, ' ').replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').trim().slice(0, 60).trim() || 'Bericht';
  return `Research ${id} - ${base}.md`;
}
function projectFileContent(d) {
  const body = String(d.text || '').replace(/^\s*#\s+.+\n+/, '');
  return `# ${d.title}\n\n_Research-Bericht aus Coden vom ${dayDe(d.created_at)} · Frage: ${String(d.question || '').replace(/\s+/g, ' ').slice(0, 300)}_\n\n${body}`.slice(0, PROJ.file);
}
const isOwnFile = (name, id) => String(name).startsWith(`Research ${id} - `);
async function projectOf(uid, pid) {
  const p = await db.getDoc(`user_projects/${toInt(pid)}`);
  if (!p || p.uid !== uid) throw fail(404, 'Projekt nicht gefunden.');
  return p;
}
// Datei ins Projekt schreiben (ersetzt eine ältere Fassung desselben Berichts)
async function writeProjectFile(uid, d, pid) {
  const p = await projectOf(uid, pid);
  const files = { ...(p.files || {}) };
  for (const n of Object.keys(files)) if (isOwnFile(n, d.id)) delete files[n];
  files[projectFileName(d.title, d.id)] = projectFileContent(d);
  if (Object.keys(files).length > PROJ.files) throw fail(400, `Das Projekt hat schon ${PROJ.files} Dateien. Entferne dort erst eine.`);
  if (Object.values(files).reduce((n, t) => n + String(t).length, 0) > PROJ.total) throw fail(400, 'Das Projekt ist voll (zu viel Text). Entferne dort erst eine Datei.');
  await db.updateDoc(`user_projects/${p.id}`, { files, updated_at: db.nowIso() });
}
async function dropProjectFile(uid, id, pid) {
  const p = await db.getDoc(`user_projects/${toInt(pid)}`).catch(() => null);
  if (!p || p.uid !== uid) return; // Projekt gibt es nicht mehr – nur die Verknüpfung lösen
  const files = { ...(p.files || {}) }; let changed = false;
  for (const n of Object.keys(files)) if (isOwnFile(n, id)) { delete files[n]; changed = true; }
  if (changed) await db.updateDoc(`user_projects/${p.id}`, { files, updated_at: db.nowIso() });
}

function shape(d, full = false) {
  const out = {
    id: Number(d.id), title: d.title, question: d.question, depth: d.depth, status: d.status, origin: d.origin || 'page',
    error: d.error || null, runId: d.run_id ? Number(d.run_id) : null, projects: Array.isArray(d.projects) ? d.projects.map(Number) : [],
    sources: Number(d.sources) || 0, chars: String(d.text || '').length, summary: summaryOf(d.text),
    createdAt: iso(d.created_at), updatedAt: iso(d.updated_at)
  };
  if (full) out.text = d.text || '';
  return out;
}

async function mineList(uid) {
  return db.runQuery('research_reports', { where: [['uid', '==', uid]], orderBy: 'updated_at', desc: true, limit: LIMITS.reports });
}

// Neuen Bericht anlegen (status 'running' für laufende, 'done' für fertige aus Chat/Aufgaben)
async function createReport(user, { question, depth = 'normal', origin = 'page', status = 'running', text = '', runId = null, projects = [] }) {
  const id = db.nextId(); const now = db.nowIso();
  const body = str(text, LIMITS.text);
  return db.createDoc(`research_reports/${id}`, {
    id, uid: user.uid,
    title: titleFrom(question, body), question: str(question, LIMITS.question).trim(),
    depth: DEPTHS.includes(depth) ? depth : 'normal', status, origin: ORIGINS.includes(origin) ? origin : 'page',
    text: body, error: null, run_id: runId, projects: projects.map(Number).filter(Boolean).slice(0, LIMITS.projects),
    sources: sourceCount(body), created_at: now, updated_at: now
  });
}

async function finishReport(id, { text, error = null, question = '' }) {
  const body = str(text, LIMITS.text);
  const patch = error
    ? { status: 'error', error: str(error, 300), text: body, updated_at: db.nowIso() }
    : { status: 'done', error: null, text: body, title: titleFrom(question, body), sources: sourceCount(body), updated_at: db.nowIso() };
  return (await db.updateDoc(`research_reports/${id}`, patch)) || db.getDoc(`research_reports/${id}`);
}

// Fertige Recherche aus Chat oder Aufgabe in die Bibliothek legen – Fehler hier dürfen nie die Antwort kaputt machen
async function saveFinished(user, { question, depth, origin, text }) {
  try {
    if (!text || String(text).length < 80 || !/\*\*Quellen\*\*/.test(text)) return null; // nur echte Berichte (mit Quellen)
    const mine = await mineList(user.uid);
    if (mine.length >= LIMITS.reports) return null;
    return await createReport(user, { question, depth, origin, status: 'done', text });
  } catch (e) { console.warn('[research-reports] nicht gespeichert:', e.message); return null; }
}

// ---------- Lauf für die Research-Seite ----------
async function reportJob(run, state) {
  const { runResearch } = require('./research'); // spät laden (research.js lädt diese Datei ebenfalls)
  const { user, tier, question, depth, effort, reportId } = state; const meter = new Meter(user, tier);
  try {
    const text = await runResearch({
      user, tier, question, depth, effort, signal: run.signal, meter,
      onStep: (k) => run.thinkStep(k), onThink: (k) => run.thinkStep(k), onDelta: (v) => run.delta(v)
    });
    if (!run.signal.aborted && text !== run.text) run.setText(text);
    const done = await finishReport(reportId, run.signal.aborted ? { text: run.text, error: 'Abgebrochen.' } : { text, question });
    if (done?.status === 'done') {
      for (const pid of done.projects || []) await writeProjectFile(user.uid, done, pid).catch((e) => console.warn('[research-reports] Projekt', pid, e.message));
    }
  } catch (e) {
    await finishReport(reportId, { text: run.text, error: run.signal.aborted ? 'Abgebrochen.' : (e.message || 'Fehler') }).catch(() => {});
    if (!run.signal.aborted && !e.limit) throw e;
  } finally { await meter.close(); }
  if (!run.signal.aborted && run.subs.size === 0) {
    await Push.notify(user.uid, { title: 'Dein Research-Bericht ist fertig', body: titleFrom(question, run.text), url: `/#/research/${reportId}`, tag: 'research-' + reportId }).catch(() => {});
  }
}

// POST /api/research/reports  { question, depth, tier, effort, projects? } → { report } (läuft im Hintergrund weiter)
async function startReport(req, res) {
  const q = str(req.body?.question, LIMITS.question).replace(/\s+/g, ' ').trim();
  if (q.length < 3) throw fail(400, 'Gib ein Thema ein, das Coden recherchieren soll.');
  const depth = DEPTHS.includes(req.body?.depth) ? req.body.depth : 'normal';
  const tier = typeof req.body?.tier === 'string' ? req.body.tier : 'normal';
  const projects = Array.isArray(req.body?.projects) ? req.body.projects.map(toInt).filter(Boolean).slice(0, LIMITS.projects) : [];
  const user = { uid: req.user.uid, email: req.user.email, isOwner: req.user.isOwner };
  const mine = await mineList(user.uid);
  if (mine.length >= LIMITS.reports) throw fail(400, `Du hast schon ${LIMITS.reports} Berichte. Lösche ein paar alte, dann geht es weiter.`);
  if (mine.filter(r => r.status === 'running' && Date.now() - new Date(iso(r.updated_at)).getTime() < 10 * 60_000).length >= 3) throw fail(429, 'Es laufen schon drei Recherchen. Warte kurz, bis eine fertig ist.');
  for (const pid of projects) await projectOf(user.uid, pid); // nur eigene Projekte
  const report = await createReport(user, { question: q, depth, origin: 'page', projects });
  const state = { user, tier, question: q, depth, effort: req.body?.effort, reportId: Number(report.id) };
  const { run } = await startRun({ uid: user.uid, isOwner: user.isOwner, kind: 'research', ref: 'report-' + report.id, meta: { title: report.title, research: true, report: Number(report.id) } }, (r) => reportJob(r, state));
  const saved = await db.updateDoc(`research_reports/${report.id}`, { run_id: Number(run.id) }).catch(() => null);
  res.json({ report: shape(saved || { ...report, run_id: run.id }, true) });
}

// Alles Übrige (Liste, Lesen, Umbenennen, Projekte, Löschen) – hängt an researchRouter
function mountReports(r) {
  const mine = async (req) => {
    const id = toInt(req.params.id); if (!id) throw fail(404, 'Bericht nicht gefunden.');
    const d = await db.getDoc(`research_reports/${id}`);
    if (!d || d.uid !== req.user.uid) throw fail(404, 'Bericht nicht gefunden.');
    return d;
  };
  r.get('/reports', async (req, res) => {
    const list = await mineList(req.user.uid);
    const q = String(req.query.q || '').toLowerCase().trim().slice(0, 80);
    const pid = toInt(req.query.project);
    const hit = (d) => (!q || `${d.title} ${d.question} ${d.text}`.toLowerCase().includes(q)) && (!pid || (d.projects || []).map(Number).includes(pid));
    res.json({ reports: list.filter(hit).map(d => shape(d)) });
  });
  r.get('/reports/:id', async (req, res) => res.json({ report: shape(await mine(req), true) }));
  r.patch('/reports/:id', rateLimit('research-edit', 120, 60), async (req, res) => {
    const d = await mine(req);
    const t = str(req.body?.title, LIMITS.title).trim(); if (!t) throw fail(400, 'Der Titel darf nicht leer sein.');
    const u = await db.updateDoc(`research_reports/${d.id}`, { title: t, updated_at: db.nowIso() }) || { ...d, title: t };
    for (const pid of u.projects || []) await writeProjectFile(req.user.uid, u, pid).catch(() => {}); // Dateiname im Projekt mitziehen
    res.json({ report: shape(u) });
  });
  // Bericht zu Projekt: Wissensdatei schreiben + Verknüpfung merken
  r.post('/reports/:id/projects', rateLimit('research-edit', 120, 60), async (req, res) => {
    const d = await mine(req); const pid = toInt(req.body?.projectId);
    if (!pid) throw fail(400, 'Welches Projekt?');
    const projects = [...new Set([...(d.projects || []).map(Number), pid])];
    if (projects.length > LIMITS.projects) throw fail(400, `Höchstens ${LIMITS.projects} Projekte pro Bericht.`);
    if (d.status === 'done') await writeProjectFile(req.user.uid, d, pid); else await projectOf(req.user.uid, pid); // laufende Berichte kommen beim Fertigwerden dazu
    res.json({ report: shape(await db.updateDoc(`research_reports/${d.id}`, { projects, updated_at: db.nowIso() }) || { ...d, projects }) });
  });
  r.delete('/reports/:id/projects/:pid', async (req, res) => {
    const d = await mine(req); const pid = toInt(req.params.pid);
    await dropProjectFile(req.user.uid, d.id, pid);
    const projects = (d.projects || []).map(Number).filter(p => p !== pid);
    res.json({ report: shape(await db.updateDoc(`research_reports/${d.id}`, { projects, updated_at: db.nowIso() }) || { ...d, projects }) });
  });
  r.delete('/reports/:id', async (req, res) => {
    const d = await mine(req);
    for (const pid of d.projects || []) await dropProjectFile(req.user.uid, d.id, pid).catch(() => {});
    await db.deleteDoc(`research_reports/${d.id}`);
    res.json({ ok: true });
  });
}

module.exports = { startReport, mountReports, saveFinished, createReport, finishReport, titleFrom, sourceCount, summaryOf, projectFileName, LIMITS };
