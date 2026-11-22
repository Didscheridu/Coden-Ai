// Coden-Agententeam: Planer -> parallele Coder -> Prüfer -> Fixer, komplett auf dem Server (simulierte Modelle).
const { setup } = require('./helpers');
(async () => {
  process.env.GROQ_API_KEY = 'test'; process.env.OPENROUTER_API_KEY = 'test'; process.env.GOOGLE_API_KEY = 'test';
  const realFetch = global.fetch; const seen = { planner: 0, team: [], single: 0, reviewer: 0, fixer: 0 };
  let planReply = null, delay = 0;
  const sse = (text) => { const enc = new TextEncoder(); return new Response(new ReadableStream({ async start(c) { for (const part of text.match(/[\s\S]{1,40}/g) || []) { if (delay) await new Promise(r => setTimeout(r, delay)); c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`)); } c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); };
  const json = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  global.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, opts);
    const body = JSON.parse(opts.body); const sys = body.messages[0].content; const last = body.messages[body.messages.length - 1].content;
    if (/Du bist der Planer/.test(sys)) { seen.planner++; return json(planReply); }
    if (/Du bist der Prüfer/.test(sys)) { seen.reviewer++; return json('{"issues":[]}'); }
    if (/TEAM-MODUS/.test(sys)) {
      const task = sys.match(/DEINE Aufgabe: (.*)/)[1]; seen.team.push(task);
      if (/Aufbau/.test(task)) return sse('Ich baue den Aufbau.\n<file path="index.html">\n<!doctype html><html><head><link rel="stylesheet" href="coden-kit.css"><link rel="stylesheet" href="style.css"></head><body><canvas id="game"></canvas><button id="start">Start</button><script src="coden-kit.js"></script><script src="game.js"></script></body></html>\n</file>\n<file path="style.css">\nbody{margin:0}\n</file>\n<file path="app.js">\n// darf ich nicht\n</file>');
      return sse('Logik kommt.\n<file path="game.js">\ndocument.getElementById("start").onclick = () => { const c = document.getElementById("game"); c.width = 10; };\nif (true) {\n</file>');
    }
    if (/\[Automatische Prüfung\]/.test(last)) { seen.fixer++; return sse('Behoben.\n<file path="game.js">\ndocument.getElementById("start").onclick = () => { const c = document.getElementById("game"); c.width = 10; };\n</file>\nJetzt läuft alles.'); }
    seen.single++;
    return sse('Ich ändere die Farbe.\n<edit path="style.css">\n<find>body{margin:0}</find>\n<replace>body{margin:0;background:#111}</replace>\n</edit>\nFertig, jetzt ist es dunkel.');
  };
  const { call, chk, finish, token, base } = await setup();
  const anna = await token({ sub: 'uid-anna', email: 'anna@x.de', email_verified: true });
  const ben = await token({ sub: 'uid-ben', email: 'ben@x.de', email_verified: true });
  const P = (p, b, t) => call(p, b, t, 'POST'), G = (p, t) => call(p, null, t);
  const events = (txt) => txt.split('\n\n').filter(x => x.startsWith('data: ')).map(x => JSON.parse(x.slice(6)));
  const agent = async (id, body, tok = anna) => { const r = await realFetch(`${base}/apps/${id}/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) }); return { s: r.status, evs: r.status === 200 ? events(await r.text()) : [], j: r.status !== 200 ? await r.json() : null }; };

  const app = (await P('/apps', { name: 'Weltraum', kind: 'game', files: { 'index.html': '<!doctype html><html><body><h1>Neues Spiel</h1><p>Sag Coden im Chat, was es werden soll.</p></body></html>' } }, anna)).j.app;
  chk('Spiel-Typ wird akzeptiert', app.kind, 'game');
  await P(`/apps/${app.id}/messages`, { role: 'user', body: 'Bau mir ein Weltraum-Shooter-Spiel mit Punkten, Leben, Gegnern und Startbildschirm' }, anna);

  // --- Team-Modus ---
  planReply = JSON.stringify({ mode: 'team', summary: 'Ein Weltraum-Shooter mit Canvas.', contract: 'index.html hat <canvas id="game"> und #start; game.js startet das Spiel.', tasks: [{ title: 'Aufbau & Design', files: ['index.html', 'style.css'], goal: 'HTML und CSS' }, { title: 'Spiellogik', files: ['game.js'], goal: 'Schleife, Gegner' }], next: 'Sound einbauen?' });
  const t1 = await agent(app.id, { tier: 'pro' });
  const agentsEv = t1.evs.filter(e => e.t === 'a').pop()?.agents || [];
  chk('Team: Lauf startet mit ID und endet mit done', `${t1.evs[0].t} ${t1.evs[t1.evs.length - 1].t}`, 'run done');
  chk('Team: Planer wurde gefragt', seen.planner, 1);
  chk('Team: zwei Coder liefen (je eine Aufgabe)', seen.team.sort().join(' | '), 'Aufbau & Design | Spiellogik');
  chk('Team: Agentenliste mit Planer, 2 Codern, Prüfer, Fixer', agentsEv.map(a => a.role).join(','), 'planner,coder,coder,fixer,reviewer');
  const f1 = (await G('/apps/' + app.id, anna)).j.files;
  chk('Team: Dateien beider Coder gespeichert', Object.keys(f1).sort().join(','), 'game.js,index.html,style.css');
  chk('Team: fremde Datei (app.js) des Coders wurde NICHT übernommen', 'app.js' in f1, false);
  chk('Prüfer fand den Syntaxfehler, Fixer hat ihn behoben', `${seen.fixer} ${f1['game.js'].includes('if (true)')}`, '1 false');
  const msgs = (await G(`/apps/${app.id}/messages`, anna)).j.messages;
  chk('Verlauf: Team-Antwort, Prüfmeldung, Fixer-Antwort', msgs.slice(1).map(m => m.role).join(','), 'assistant,tool,assistant');
  chk('Team-Antwort enthält Plan und ist gekürzt (keine Dateiinhalte)', /<plan>[\s\S]*\[x\] Aufbau/.test(msgs[1].body) && /\[Datei geschrieben: game\.js\]/.test(msgs[1].body) && !/getElementById/.test(msgs[1].body), true);
  chk('Team-Antwort: Meta mit geänderten Dateien', msgs[1].meta.changed.map(c => c.path).sort().join(','), 'game.js,index.html,style.css');
  chk('Prüfmeldung ist automatisch', msgs[2].meta.auto, true);

  // --- Kleine Änderung: kein Planer, ein Agent ---
  await P(`/apps/${app.id}/messages`, { role: 'user', body: 'Mach es dunkel' }, anna);
  const s1 = await agent(app.id, { tier: 'flash' });
  chk('Einzeln: Text kommt live', s1.evs.filter(e => e.t === 'd').map(e => e.v).join('').startsWith('Ich ändere die Farbe.'), true);
  chk('Einzeln: kurzer Wunsch ohne Planer', seen.planner, 1);
  chk('Einzeln: Änderung gespeichert', (await G('/apps/' + app.id, anna)).j.files['style.css'], 'body{margin:0;background:#111}');

  // --- Läuft weiter, auch wenn der Browser die Verbindung trennt; nur ein Lauf pro App ---
  await call(`/apps/${app.id}/files`, { set: { 'style.css': 'body{margin:0}' } }, anna, 'PUT');
  delay = 25; await P(`/apps/${app.id}/messages`, { role: 'user', body: 'Mach es dunkel' }, anna);
  const ac = new AbortController();
  const r = await realFetch(`${base}/apps/${app.id}/agent`, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anna }, body: JSON.stringify({ tier: 'flash' }) });
  const runId = events(new TextDecoder().decode((await r.body.getReader().read()).value))[0].id; ac.abort();
  chk('Zweiter Lauf gleichzeitig: 409', (await agent(app.id, { tier: 'flash' })).s, 409);
  chk('Poll zeigt den laufenden Agenten', (await G(`/apps/${app.id}/poll?after=1`, anna)).j.agentRun, runId);
  chk('Fremder darf den Lauf nicht sehen', (await G(`/apps/${app.id}/agent?run=${runId}`, ben)).s, 404);
  await new Promise(res => setTimeout(res, 1500));
  const st = (await G(`/apps/${app.id}/agent?run=${runId}`, anna)).j;
  chk('Getrennt: Agent hat trotzdem fertig gebaut', `${st.status} ${/Fertig, jetzt ist es dunkel/.test(st.text)}`, 'done true');
  const last = (await G(`/apps/${app.id}/messages`, anna)).j.messages.pop();
  chk('Getrennt: Antwort steht im Verlauf', last.role === 'assistant' && /dunkel/.test(last.body), true);
  chk('Nach dem Lauf: kein aktiver Agent', (await G(`/apps/${app.id}/poll?after=1`, anna)).j.agentRun, null);
  chk('Ungültige App', (await agent(99999, { tier: 'pro' })).s, 404);
  await finish();
})();
