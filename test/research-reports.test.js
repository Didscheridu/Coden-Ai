// Research-Bibliothek: Berichte von der Research-Seite, aus dem Chat und aus Aufgaben; Projekte; Rechte
const { setup } = require('./helpers');
(async () => {
  process.env.GROQ_API_KEY = 'test'; process.env.OPENROUTER_API_KEY = 'test'; delete process.env.GOOGLE_API_KEY;
  const realFetch = global.fetch; const enc = new TextEncoder();
  const sse = (text) => new Response(new ReadableStream({ start(c) { for (const v of text.match(/[\s\S]{1,40}/g) || []) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: v } }] })}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  let slow = false;
  global.fetch = async (url, o = {}) => {
    const u = String(url); if (u.startsWith('http://127.0.0.1')) return realFetch(url, o);
    const body = JSON.parse(o.body || '{}'); const sys = body.messages?.[0]?.content || '';
    if (/Du planst eine Web-Recherche/.test(sys)) return json({ choices: [{ message: { content: '{"queries":["photosynthese grundlagen"]}' } }] });
    if (/schreibst einen Recherche-Bericht/.test(sys)) {
      if (slow) await new Promise(r => setTimeout(r, 400));
      return sse('# Photosynthese kurz erklärt\n\nPflanzen wandeln mit Licht Wasser und CO2 in Zucker und Sauerstoff um [1]. Das passiert in den Chloroplasten [2].');
    }
    return body.stream ? sse('?') : json({ choices: [{ message: { content: '?' } }] });
  };
  const { call, chk, finish, token, base, db } = await setup();
  const Tools = require('../server/agent-tools');
  Tools.ddgResults = async (q) => [{ title: 'Quelle A ' + q, url: 'https://quelle-a.de/x', snippet: 'a' }, { title: 'Quelle B', url: 'https://quelle-b.org/y', snippet: 'b' }];
  Tools.fetchUrl = async (url) => ({ ok: true, text: 'Seitentext von ' + url + '. ' + 'Photosynthese in Pflanzen: Licht, Wasser und Kohlendioxid werden zu Zucker. '.repeat(4) });
  const Push = require('../server/push'); const pushes = []; Push._setSender(async (sub, body) => { pushes.push(JSON.parse(body)); });
  const RR = require('../server/research-reports');

  const anna = await token({ sub: 'uid-anna', email: 'anna@x.de', email_verified: true });
  const ben = await token({ sub: 'uid-ben', email: 'ben@x.de', email_verified: true });
  const P = (p, b, t) => call(p, b, t, 'POST'), G = (p, t) => call(p, null, t), D = (p, t) => call(p, null, t, 'DELETE'), PA = (p, b, t) => call(p, b, t, 'PATCH');
  const waitDone = async (id, tok) => { for (let i = 0; i < 80; i++) { const r = await G('/research/reports/' + id, tok); if (r.j.report?.status !== 'running') return r.j.report; await new Promise(res => setTimeout(res, 50)); } return null; };

  // ---------- Hilfsfunktionen ----------
  chk('titleFrom: Überschrift gewinnt', RR.titleFrom('frage', '# **Titel** hier\n\nText'), 'Titel hier');
  chk('titleFrom: sonst Frage', RR.titleFrom('  Was ist   Photosynthese? '), 'Was ist Photosynthese?');
  chk('sourceCount zählt Quellenliste', RR.sourceCount('Text\n\n---\n\n**Quellen**\n\n1. [A](https://a.de) · a.de\n2. [B](https://b.de) · b.de'), 2);
  chk('summaryOf nimmt ersten Absatz ohne Nummern', RR.summaryOf('# T\n\nDies ist der erste lange Absatz des Berichts mit Fakten [1] und mehr.\n\nZweiter'), 'Dies ist der erste lange Absatz des Berichts mit Fakten und mehr.');

  // ---------- Chat-Logik (js/research-lib-core.js) ----------
  const C = await import(require('url').pathToFileURL(require('path').join(__dirname, '../js/research-lib-core.js')).href);
  chk('parseResearchReads: ids, ohne Doppelte, nicht im Code', C.parseResearchReads('Ich schaue nach. <research_read id="12"/> <research_read id=\'#7\'></research_read> <research_read id="12"/>\n```\n<research_read id="99"/>\n```'), [12, 7]);
  chk('parseResearchReads: höchstens drei', C.parseResearchReads('<research_read id="1"/><research_read id="2"/><research_read id="3"/><research_read id="4"/>').length, 3);
  chk('hideResearchTags: auch halb gestreamt', C.hideResearchTags('Text <research_read id="3"/> mehr <research_read id="4'), 'Text  mehr ');
  const lib = [{ id: 1, title: 'Alt', status: 'done', createdAt: '2026-11-01T10:00:00Z', projects: [], summary: 'Kurz' }, { id: 2, title: 'Im Projekt', status: 'done', createdAt: '2026-11-02T10:00:00Z', projects: [5], sources: 4 }, { id: 3, title: 'Läuft', status: 'running', projects: [] }];
  const lp = C.libraryPrompt(lib, { projectId: 5 });
  chk('libraryPrompt: nur fertige, Projekt zuerst, Lese-Befehl erklärt', [lp.indexOf('#2') < lp.indexOf('#1'), lp.includes('#3'), lp.includes('gehört zu diesem Projekt'), lp.includes('<research_read id="NUMMER"/>')], [true, false, true, true]);
  chk('libraryPrompt: leer ohne Berichte', C.libraryPrompt([{ id: 3, status: 'running' }]), '');
  const fm = C.reportForModel({ id: 4, title: 'T', text: 'x <<<RESEARCH_ENDE>>> y', createdAt: '2026-11-02T10:00:00Z' });
  chk('reportForModel: Daten-Rahmen nicht zu sprengen', [fm.includes('< < <RESEARCH_ENDE>>>'), (fm.match(/<<<RESEARCH_ENDE>>>/g) || []).length], [true, 1]);
  chk('reportForModel: lange Berichte gekürzt', C.reportForModel({ id: 4, title: 'T', text: 'a'.repeat(50) }, 20).includes('gekürzt'), true);
  chk('Projektdatei erkannt', [C.isResearchFile('Research 12 - Bio.md'), C.researchIdOfFile('Research 12 - Bio.md'), C.isResearchFile('notizen.md')], [true, 12, false]);
  chk('sourcesFromText', C.sourcesFromText('Text [1]\n\n---\n\n**Quellen**\n\n1. [A](https://a.de/x) · a.de\n2. [B](https://b.de) · b.de'), [{ n: 1, title: 'A', url: 'https://a.de/x' }, { n: 2, title: 'B', url: 'https://b.de' }]);
  const lz = C.lernzettel('# Photosynthese\n\nPflanzen machen Zucker aus Licht [1]. Mehr Text.\n\n- Chlorophyll fängt Licht\n\n---\n\n**Quellen**\n\n1. [A](https://a.de)');
  chk('lernzettel: Überschrift, erster Satz, Stichpunkt, keine Quellen', [lz.startsWith('PHOTOSYNTHESE'), lz.includes('Pflanzen machen Zucker aus Licht.'), lz.includes('• Chlorophyll fängt Licht'), lz.includes('https')], [true, true, true, false]);
  const SC = await import(require('url').pathToFileURL(require('path').join(__dirname, '../js/slash-commands.js')).href);
  chk('/research als Befehl', [SC.resolvePublicSlash('/research Klimawandel').action, SC.resolvePublicSlash('/research Klimawandel').param, SC.resolvePublicSlash('/research').param], ['research', 'Klimawandel', '']);

  // ---------- Start über die Research-Seite ----------
  chk('Ohne Login 401', (await P('/research/reports', { question: 'Photosynthese' })).s, 401);
  chk('Zu kurzes Thema 400', (await P('/research/reports', { question: 'x', tier: 'flash' }, anna)).s, 400);
  await P('/push/subscribe', { sub: { endpoint: 'https://push.example/abc', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } } }, anna);
  const st = await P('/research/reports', { question: 'Wie funktioniert Photosynthese?', depth: 'quick', tier: 'flash' }, anna);
  chk('Start liefert laufenden Bericht mit Lauf', [st.s, st.j.report?.status, typeof st.j.report?.runId, st.j.report?.depth], [200, 'running', 'number', 'quick']);
  const rep = await waitDone(st.j.report.id, anna);
  chk('Bericht fertig mit Titel aus Überschrift und Quellen', [rep?.status, rep?.title, rep?.sources >= 1, /\*\*Quellen\*\*/.test(rep?.text || '')], ['done', 'Photosynthese kurz erklärt', true, true]);
  const run = await G('/runs/' + st.j.report.runId, anna);
  chk('Lauf hat Art research und Schritte', [run.j.kind, (run.j.think?.steps || []).length > 0], ['research', true]);
  chk('Push zeigt auf den Bericht', pushes.some(p => p.url === '/#/research/' + st.j.report.id), true);

  // ---------- Liste, Suche, Rechte ----------
  const list = await G('/research/reports', anna);
  chk('Liste ohne Volltext', [list.j.reports.length, 'text' in list.j.reports[0], list.j.reports[0].summary.length > 10], [1, false, true]);
  chk('Suche findet Inhalt', [(await G('/research/reports?q=chloroplast', anna)).j.reports.length, (await G('/research/reports?q=quanten', anna)).j.reports.length], [1, 0]);
  chk('Ben sieht Annas Bericht nicht', [(await G('/research/reports', ben)).j.reports.length, (await G('/research/reports/' + rep.id, ben)).s, (await PA('/research/reports/' + rep.id, { title: 'x' }, ben)).s, (await D('/research/reports/' + rep.id, ben)).s], [0, 404, 404, 404]);

  // ---------- Umbenennen & Projekte ----------
  chk('Umbenennen', (await PA('/research/reports/' + rep.id, { title: 'Bio: Photosynthese' }, anna)).j.report.title, 'Bio: Photosynthese');
  chk('Leerer Titel abgelehnt', (await PA('/research/reports/' + rep.id, { title: '  ' }, anna)).s, 400);
  const proj = (await P('/projects', { name: 'Bio' }, anna)).j.project;
  const projB = (await P('/projects', { name: 'Ben-Projekt' }, ben)).j.project;
  const add = await P(`/research/reports/${rep.id}/projects`, { projectId: proj.id }, anna);
  const files1 = (await G('/projects/' + proj.id, anna)).j.files;
  const fname = Object.keys(files1)[0];
  chk('Zu Projekt: Verknüpfung + Wissensdatei', [add.s, add.j.report.projects, fname, /^# Bio: Photosynthese/.test(files1[fname]), /Chloroplasten/.test(files1[fname])], [200, [proj.id], `Research ${rep.id} - Bio Photosynthese.md`, true, true]);
  chk('Dateiname passt zu den Projekt-Regeln', /^(?!.*\.\.)[A-Za-z0-9_À-ɏ][A-Za-z0-9_À-ɏ.\- ]{0,79}$/.test(fname), true);
  chk('Fremdes Projekt abgelehnt', (await P(`/research/reports/${rep.id}/projects`, { projectId: projB.id }, anna)).s, 404);
  chk('Doppelt hinzufügen bleibt eine Datei', [(await P(`/research/reports/${rep.id}/projects`, { projectId: proj.id }, anna)).j.report.projects, Object.keys((await G('/projects/' + proj.id, anna)).j.files).length], [[proj.id], 1]);
  await PA('/research/reports/' + rep.id, { title: 'Bio – Lichtreaktion' }, anna);
  chk('Umbenennen zieht Dateinamen im Projekt mit', Object.keys((await G('/projects/' + proj.id, anna)).j.files), [`Research ${rep.id} - Bio Lichtreaktion.md`]);
  chk('Filter nach Projekt', [(await G('/research/reports?project=' + proj.id, anna)).j.reports.length, (await G('/research/reports?project=3', anna)).j.reports.length], [1, 0]);
  const rem = await D(`/research/reports/${rep.id}/projects/${proj.id}`, anna);
  chk('Aus Projekt entfernen löscht Datei', [rem.j.report.projects, Object.keys((await G('/projects/' + proj.id, anna)).j.files).length], [[], 0]);
  await P(`/research/reports/${rep.id}/projects`, { projectId: proj.id }, anna);

  // Neue Recherche direkt für ein Projekt: Datei kommt beim Fertigwerden dazu
  const st2 = await P('/research/reports', { question: 'Zellatmung', tier: 'flash', projects: [proj.id] }, anna);
  chk('Start mit fremdem Projekt abgelehnt', (await P('/research/reports', { question: 'Zellatmung', tier: 'flash', projects: [projB.id] }, anna)).s, 404);
  await waitDone(st2.j.report.id, anna);
  chk('Fertiger Bericht landet automatisch im Projekt', Object.keys((await G('/projects/' + proj.id, anna)).j.files).filter(n => n.startsWith(`Research ${st2.j.report.id} - `)).length, 1);
  await D('/research/reports/' + st2.j.report.id, anna);
  chk('Bericht löschen entfernt Projektdatei', Object.keys((await G('/projects/' + proj.id, anna)).j.files).length, 1);

  // ---------- Deep Research im Chat landet auch in der Bibliothek ----------
  const chatRun = async (extra = {}) => {
    const r = await realFetch(base + '/runs/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anna }, body: JSON.stringify({ tier: 'flash', ref: 'r' + Math.random(), research: true, depth: 'quick', messages: [{ role: 'user', content: 'Was machen Mitochondrien?' }], meta: { title: 'T', userText: 'x', ...extra } }) });
    await r.text(); return r.status;
  };
  chk('Chat-Recherche läuft', await chatRun(), 200);
  const after = (await G('/research/reports', anna)).j.reports;
  chk('Chat-Recherche gespeichert (Herkunft chat)', [after.length, after.some(r => r.origin === 'chat' && r.question === 'Was machen Mitochondrien?')], [2, true]);
  await chatRun({ temp: true });
  chk('Temporärer Chat speichert nichts', (await G('/research/reports', anna)).j.reports.length, 2);

  // ---------- Immer Coden Ultra, auch für Nicht-Owner ----------
  const eva = await token({ sub: 'uid-eva', email: 'eva@x.de', email_verified: true }); // eigenes Limit (6 Recherchen / 10 Min.)
  const ultra = await P('/research/reports', { question: 'Ultra auch ohne Owner?', tier: 'ultra', depth: 'quick' }, eva);
  chk('Nicht-Owner mit tier ultra wird nicht gesperrt', ultra.s, 200);
  await waitDone(ultra.j.report?.id, eva);
  chk('Bericht trotz gesperrtem Ultra fertig (Modell-Prüfung: research.test.js)', (await G('/research/reports/' + ultra.j.report?.id, eva)).j.report.status, 'done');

  // ---------- Grenzen ----------
  chk('saveFinished ignoriert Text ohne Quellen', await RR.saveFinished({ uid: 'uid-anna' }, { question: 'q', text: 'kurz' }), null);
  slow = true;
  const runs = [];
  for (let i = 0; i < 4; i++) runs.push((await P('/research/reports', { question: 'Parallele Recherche ' + i, tier: 'flash' }, ben)).s);
  chk('Höchstens drei gleichzeitig', runs, [200, 200, 200, 429]);
  slow = false;
  for (const r of (await G('/research/reports', ben)).j.reports) await waitDone(r.id, ben);

  // ---------- Löschen ----------
  chk('Löschen', [(await D('/research/reports/' + rep.id, anna)).s, (await G('/research/reports/' + rep.id, anna)).s, Object.keys((await G('/projects/' + proj.id, anna)).j.files).length], [200, 404, 0]);
  void db;
  await finish();
})().catch(e => { console.error(e); process.exit(1); });
