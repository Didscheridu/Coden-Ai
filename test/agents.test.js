// Coden Main Agent + Sub-Agenten (simulierte Modelle): Schleife aus Denken → Werkzeug → Ergebnis,
// spawn mit Spezial-Kits und Modell je Schwierigkeit, automatische Prüfung, Gedächtnis, Hintergrund-Lauf.
const http = require('http');
const { setup } = require('./helpers');
(async () => {
  process.env.GROQ_API_KEY = 'test'; process.env.OPENROUTER_API_KEY = 'test'; process.env.GOOGLE_API_KEY = 'test';
  const realFetch = global.fetch; const seen = { main: [], subs: [], kits: [], results: [] }; let delay = 0;
  const sse = (text) => { const enc = new TextEncoder(); return new Response(new ReadableStream({ async start(c) { for (const part of text.match(/[\s\S]{1,40}/g) || []) { if (delay) await new Promise(r => setTimeout(r, delay)); c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`)); } c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); };
  const SPAWN = JSON.stringify({ contract: 'index.html hat <canvas id="game"> und #start; game.js startet das Spiel.', tasks: [{ title: 'Aufbau & Design', agent: 'layout', level: 'leicht', files: ['index.html', 'style.css'], goal: 'HTML und CSS' }, { title: 'Spiellogik', agent: 'game', level: 'schwer', files: ['game.js'], goal: 'Schleife' }] });
  const MAIN = {
    team: ['Ich plane und starte das Team.\n<plan>\n- [ ] Sub-Agenten bauen\n- [ ] Ergebnis prüfen\n</plan>\n<tool name="spawn">' + SPAWN + '</tool>',
      'Die Prüfung meldet einen Fehler. Ich schaue nach.\n<tool name="search" query="getElementById"/>\n<tool name="read" path="game.js" start="1" end="3"/>',
      'Ich behebe den Syntaxfehler.\n<file path="game.js">\ndocument.getElementById("start").onclick = () => { document.getElementById("game").width = 10; };\n</file>\n<tool name="check"/>',
      'Fertig! Das Spiel läuft.\n- Canvas-Spiel mit Start-Knopf\nNächster Schritt: Gegner einbauen?\n<tool name="done"/>'],
    dunkel: ['Ich mache es dunkel.\n<edit path="style.css">\n<find>body{margin:0}</find>\n<replace>body{margin:0;background:#111}</replace>\n</edit>\nFertig, jetzt ist es dunkel.'],
    kaputt: ['Ich baue eine Hilfsdatei.\n<file path="util.js">\nfunction ( {\n</file>\nErledigt.', 'Ups, Syntaxfehler – behoben.\n<file path="util.js">\nfunction hilfe() { return 1; }\n</file>\nJetzt passt alles.'],
    merk: ['Ich merke mir das.\n<tool name="memory">Spielfeld ist immer 960x540, Farben aus style.css</tool>', 'Gemerkt!'],
    solo: ['Ich versuche Sub-Agenten.\n<tool name="spawn">' + SPAWN + '</tool>', 'Dann mache ich es selbst. Fertig.']
  };
  global.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, opts);
    const body = JSON.parse(opts.body); const sys = body.messages[0].content;
    if (/TEAM-MODUS – du bist/.test(sys)) {
      const task = sys.match(/DEINE Aufgabe: (.*)/)[1]; seen.subs.push(task); seen.kits.push(((sys.match(/DU BIST DER ([^\n–]+)/) || [])[1] || '-').trim());
      if (/Aufbau/.test(task)) return sse('Ich baue den Aufbau.\n<file path="index.html">\n<!doctype html><html><head><link rel="stylesheet" href="coden-kit.css"><link rel="stylesheet" href="style.css"></head><body><canvas id="game"></canvas><button id="start">Start</button><script src="coden-kit.js"></script><script src="game.js"></script></body></html>\n</file>\n<file path="style.css">\nbody{margin:0}\n</file>\n<file path="app.js">\n// darf ich nicht\n</file>');
      return sse('Logik kommt.\n<file path="game.js">\ndocument.getElementById("start").onclick = () => {};\nif (true) {\n</file>');
    }
    if (/DU BIST DER MAIN AGENT/.test(sys)) {
      seen.main.push(sys);
      const users = body.messages.filter(m => m.role === 'user'); const results = users.filter(m => /^\[Werkzeug-Ergebnisse\]/.test(m.content)).length;
      const wish = [...body.messages].reverse().find(m => m.role === 'user' && !/^\[Werkzeug-Ergebnisse\]/.test(m.content)).content;
      const key = /Weltraum/.test(wish) ? 'team' : /dunkel/.test(wish) ? 'dunkel' : /Hilfsdatei/.test(wish) ? 'kaputt' : /merk/.test(wish) ? 'merk' : 'solo';
      seen.results.push(users[users.length - 1].content);
      return sse(MAIN[key][Math.min(results, MAIN[key].length - 1)]);
    }
    return sse('?');
  };
  const { call, chk, finish, token, base } = await setup();
  const anna = await token({ sub: 'uid-anna', email: 'anna@x.de', email_verified: true });
  const ben = await token({ sub: 'uid-ben', email: 'ben@x.de', email_verified: true });
  const P = (p, b, t) => call(p, b, t, 'POST'), G = (p, t) => call(p, null, t);
  const events = (txt) => txt.split('\n\n').filter(x => x.startsWith('data: ')).map(x => JSON.parse(x.slice(6)));
  const agent = async (id, body, tok = anna) => { const r = await realFetch(`${base}/apps/${id}/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) }); return { s: r.status, evs: r.status === 200 ? events(await r.text()) : [], j: r.status !== 200 ? await r.json() : null }; };
  const say = (id, text) => P(`/apps/${id}/messages`, { role: 'user', body: text }, anna);
  const lastAi = async (id) => (await G(`/apps/${id}/messages`, anna)).j.messages.filter(m => m.role === 'assistant').pop();
  const lastResult = () => seen.results[seen.results.length - 1];

  const app = (await P('/apps', { name: 'Weltraum', kind: 'game', files: { 'index.html': '<!doctype html><html><body><h1>Neues Spiel</h1></body></html>' } }, anna)).j.app;

  // --- Team: Main Agent startet Sub-Agenten, prüft, liest, behebt selbst ---
  await say(app.id, 'Bau mir ein Weltraum-Spiel mit Start-Knopf');
  const t1 = await agent(app.id, { tier: 'pro', mode: 'team' });
  const ag = t1.evs.filter(e => e.t === 'a').pop()?.agents || [];
  chk('Lauf: ID zuerst, done zuletzt', `${t1.evs[0].t} ${t1.evs[t1.evs.length - 1].t}`, 'run done');
  chk('Main Agent im Systemprompt, Team-Modus verlangt spawn', /TEAM-MODUS GEWÄHLT/.test(seen.main[0]) && /<tool name="spawn">/.test(seen.main[0]), true);
  chk('Main Agent hat 4 Schritte gemacht', seen.main.length, 4);
  chk('Agenten: Main + 2 Sub-Agenten (mit parent)', ag.map(a => a.role + (a.parent ? '>' + a.parent : '')).join(','), 'main,coder>main,coder>main');
  chk('Sub-Agenten mit Kit im Prompt', seen.kits.sort().join(' | '), 'LAYOUT-DESIGNER 🎨 | SPIEL-ENTWICKLER 🎮');
  chk('Modell je Schwierigkeit (leicht=Flash, schwer=Pro ohne Ultra-Freigabe)', ag.filter(a => a.parent).map(a => a.kit + ':' + a.tier).join(' '), 'layout:Flash game:Pro');
  chk('Ergebnis an den Main Agent: Sub-Agenten-Bericht mit Syntaxfehler', /\[Sub-Agenten\] 2 von 2 fertig[\s\S]*Syntaxfehler in game\.js/.test(seen.results[1]), true);
  chk('Ergebnis an den Main Agent: search mit Datei:Zeile, read mit Zeilennummern', /game\.js:1: document\.getElementById/.test(seen.results[2]) && /game\.js \(Zeilen 1–2 von 2\) ===\n   1\| document/.test(seen.results[2]), true);
  chk('Ergebnis an den Main Agent: check nach der Reparatur ok', /keine Syntaxfehler/.test(seen.results[3]), true);
  const f1 = (await G('/apps/' + app.id, anna)).j.files;
  chk('Dateien der Sub-Agenten gespeichert, fremde verworfen', Object.keys(f1).sort().join(','), 'game.js,index.html,style.css');
  chk('Main Agent hat den Fehler der Sub-Agenten selbst behoben', f1['game.js'].includes('if (true)'), false);
  const m1 = await lastAi(app.id);
  chk('Eine Nachricht für den ganzen Lauf (mit Werkzeug-Ergebnissen)', (m1.body.match(/<result name="(\w+)"/g) || []).map(x => x.slice(14, -1)).join(','), 'spawn,search,read,check');
  chk('Ergebnis spawn als Zeile', /<result name="spawn" ok="0">2\/2 Sub-Agenten fertig · 1 Problem gefunden<\/result>/.test(m1.body), true);
  chk('Nachricht gekürzt (keine Dateiinhalte), Abschluss da', !/getElementById\("start"\)\.onclick/.test(m1.body) && /Fertig! Das Spiel läuft/.test(m1.body), true);
  chk('Meta: Schritte und geänderte Dateien', `${m1.meta.steps} ${m1.meta.changed.map(c => c.path).sort().join(',')}`, '4 game.js,index.html,style.css');
  chk('Nur EINE Assistenten-Nachricht im Verlauf', (await G(`/apps/${app.id}/messages`, anna)).j.messages.filter(m => m.role !== 'user').length, 1);

  // --- Solo, kleine Änderung: ein Schritt, automatische Prüfung ok ---
  await call(`/apps/${app.id}/files`, { set: { 'style.css': 'body{margin:0}' } }, anna, 'PUT');
  seen.main = []; await say(app.id, 'Mach es dunkel');
  const s1 = await agent(app.id, { tier: 'flash', mode: 'single' });
  chk('Solo: Text kommt live', s1.evs.filter(e => e.t === 'd').map(e => e.v).join('').startsWith('Ich mache es dunkel.'), true);
  chk('Solo: ein Schritt, kein spawn im Prompt', `${seen.main.length} ${/<tool name="spawn">/.test(seen.main[0])}`, '1 false');
  chk('Solo: Änderung gespeichert', (await G('/apps/' + app.id, anna)).j.files['style.css'], 'body{margin:0;background:#111}');

  // --- Automatische Prüfung findet Fehler, Main Agent behebt ---
  seen.main = []; await say(app.id, 'Bau eine Hilfsdatei');
  await agent(app.id, { tier: 'pro', mode: 'auto' });
  chk('Auto-Prüfung: zweiter Schritt mit Fehlerbericht', `${seen.main.length} ${/Automatische Prüfung[\s\S]*Syntaxfehler in util\.js/.test(lastResult())}`, '2 true');
  chk('Auto-Prüfung: Datei repariert', (await G('/apps/' + app.id, anna)).j.files['util.js'], 'function hilfe() { return 1; }');

  // --- Solo: spawn nicht erlaubt ---
  seen.main = []; await say(app.id, 'Mach das alleine');
  await agent(app.id, { tier: 'pro', mode: 'single' });
  chk('Solo: spawn wird abgelehnt', /Solo-Modus/.test(lastResult()), true);

  // --- Gedächtnis CODEN.md ---
  seen.main = []; await say(app.id, 'Bitte merk dir das Spielfeld');
  await agent(app.id, { tier: 'pro', mode: 'auto' });
  chk('memory schreibt CODEN.md', /- Spielfeld ist immer 960x540/.test((await G('/apps/' + app.id, anna)).j.files['CODEN.md'] || ''), true);
  await call(`/apps/${app.id}/files`, { set: { 'style.css': 'body{margin:0}' } }, anna, 'PUT');
  seen.main = []; await say(app.id, 'Mach es dunkel'); await agent(app.id, { tier: 'flash', mode: 'single' });
  chk('CODEN.md steht im nächsten Prompt', /PROJEKT-GEDÄCHTNIS[\s\S]*960x540/.test(seen.main[0]), true);

  // --- Werkzeuge direkt: fetch (lokaler Server), Glob ---
  process.env.MCP_ALLOW_PRIVATE = '1';
  const T = require('../server/agent-tools');
  const srv = http.createServer((q, r) => { if (q.url === '/alt') { r.writeHead(302, { Location: '/doku' }); return r.end(); } r.setHeader('Content-Type', 'text/html'); r.end('<html><title>Doku</title><body><h1>API</h1><p>fetch(url) &amp; mehr</p><script>böse()</script></body></html>'); });
  await new Promise(r => srv.listen(0, r));
  const fr = await T.fetchUrl(`http://127.0.0.1:${srv.address().port}/alt`);
  chk('fetch: folgt Weiterleitung, liefert Text ohne Skripte', `${fr.ok} ${/# API/.test(fr.text)} ${/fetch\(url\) & mehr/.test(fr.text)} ${/böse/.test(fr.text)}`, 'true true true false');
  srv.close(); process.env.MCP_ALLOW_PRIVATE = '';
  chk('fetch: interne Adressen gesperrt', (await T.fetchUrl('http://127.0.0.1:1/')).ok, false);
  chk('Glob', T.list({ 'a.js': '1', 'b/c.js': '2', 'd.css': '' }, '**/*.js').summary, '2 Dateien für **/*.js');

  // --- Läuft weiter, auch wenn der Browser die Verbindung trennt; nur ein Lauf pro App ---
  await call(`/apps/${app.id}/files`, { set: { 'style.css': 'body{margin:0}' } }, anna, 'PUT');
  delay = 25; await say(app.id, 'Mach es dunkel');
  const ac = new AbortController();
  const r = await realFetch(`${base}/apps/${app.id}/agent`, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anna }, body: JSON.stringify({ tier: 'flash', mode: 'single' }) });
  const runId = events(new TextDecoder().decode((await r.body.getReader().read()).value))[0].id; ac.abort();
  chk('Zweiter Lauf gleichzeitig: 409', (await agent(app.id, { tier: 'flash' })).s, 409);
  chk('Poll zeigt den laufenden Agenten', (await G(`/apps/${app.id}/poll?after=1`, anna)).j.agentRun, runId);
  chk('Fremder darf den Lauf nicht sehen', (await G(`/apps/${app.id}/agent?run=${runId}`, ben)).s, 404);
  await new Promise(res => setTimeout(res, 1500));
  const st = (await G(`/apps/${app.id}/agent?run=${runId}`, anna)).j;
  chk('Getrennt: Agent hat trotzdem fertig gebaut', `${st.status} ${/Fertig, jetzt ist es dunkel/.test(st.text)}`, 'done true');
  chk('Getrennt: Antwort steht im Verlauf', /dunkel/.test((await lastAi(app.id)).body), true);
  chk('Nach dem Lauf: kein aktiver Agent', (await G(`/apps/${app.id}/poll?after=1`, anna)).j.agentRun, null);
  chk('Ungültige App', (await agent(99999, { tier: 'pro' })).s, 404);

  // --- Löschen und Verlassen ---
  const other = (await P('/apps', { name: 'Zum Löschen', kind: 'web' }, anna)).j.app;
  await call('/buddy/me', { handle: 'anna', displayName: 'Anna' }, anna, 'PUT'); await call('/buddy/me', { handle: 'ben', displayName: 'Ben' }, ben, 'PUT');
  await P('/buddy/requests', { handle: 'ben' }, anna); await P('/buddy/requests/anna/accept', {}, ben);
  chk('Freund eingeladen', (await P(`/apps/${other.id}/members`, { handle: 'ben' }, anna)).s, 200);
  chk('Mitglied darf nicht löschen', (await call('/apps/' + other.id, null, ben, 'DELETE')).s, 403);
  chk('Mitglied kann verlassen', (await P(`/apps/${other.id}/leave`, {}, ben)).s, 200);
  chk('Nach dem Verlassen: App weg für Mitglied', (await G('/apps/' + other.id, ben)).s, 404);
  chk('Besitzer kann nicht verlassen', (await P(`/apps/${other.id}/leave`, {}, anna)).s, 400);
  chk('Besitzer löscht', (await call('/apps/' + other.id, null, anna, 'DELETE')).s, 200);
  chk('Gelöscht: nicht mehr in der Liste', (await G('/apps', anna)).j.apps.some(a => a.id === other.id), false);
  await finish();
})();
