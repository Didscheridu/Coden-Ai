// Coden Main Agent + Sub-Agenten (simulierte Modelle): Schleife aus Denken → Werkzeug → Ergebnis,
// spawn mit Spezial-Kits und Modell je Schwierigkeit, automatische Prüfung, Gedächtnis, Hintergrund-Lauf.
const http = require('http');
const { setup } = require('./helpers');
(async () => {
  process.env.GROQ_API_KEY = 'test'; process.env.OPENROUTER_API_KEY = 'test'; process.env.GOOGLE_API_KEY = 'test';
  const realFetch = global.fetch; const seen = { main: [], subs: [], kits: [], results: [], conts: [], active: 0, maxActive: 0 }; let delay = 0;
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
    solo: ['Ich versuche Sub-Agenten.\n<tool name="spawn">' + SPAWN + '</tool>', 'Dann mache ich es selbst. Fertig.'],
    ankuendigung: ['Ich sehe das Problem: die Initialisierung ist falsch. Let me fix the initialization order.', 'Hier die Korrektur.\n<file path="init.js">\nwindow.bereit = true;\n</file>\nBehoben – die App startet jetzt richtig.'],
    rennen: ['Ich teile das Rennspiel auf.\n' + ['A', 'B', 'C'].map(t => '<tool name="spawn">' + JSON.stringify({ contract: 'Jede Datei setzt ihre window-Variablen.', tasks: [{ title: 'Teil ' + t, agent: 'game', level: 'leicht', files: [t.toLowerCase() + '.js'], goal: 'Teil ' + t }] }) + '</tool>').join('\n'),
      'Alle Teile sind da und passen zusammen. Fertig!\n<tool name="done"/>'],
    etappen: ['Schritt eins: Grundgerüst.\n<file path="etappe.js">\nwindow.e = 1;\n</file>\n<tool name="check"/>', 'Schritt zwei: erweitert.\n<file path="etappe.js">\nwindow.e = 2;\n</file>\n<tool name="check"/>', 'Alles fertig und geprüft.\n<tool name="done"/>'],
    werkzeuge: ['<tool name="tree"/>\n<tool name="outline" path="index.html"/>\n<tool name="copy" from="etappe.js" to="kopie.js"/>\n<tool name="move" from="kopie.js" to="js/neu.js"/>\n<tool name="insert" path="js/neu.js" line="1">// header</tool>',
      'Geändert: js/neu.js erstellt.\n<tool name="done"/>'],
    donebug: [
      'Ich baue die App.\n<file path="index.html">\n<!doctype html><html><body><button id="btn" type="button">Klick</button><script src="app.js"></script></body></html>\n</file>\n<file path="app.js">\nfunction boom(){ return nichtVorhanden.wert; }\ndocument.getElementById("btn").onclick = boom;\n</file>\nFertig!\n<tool name="done"/>',
      'Ich behebe den Laufzeitfehler.\n<file path="app.js">\nfunction boom(){ return "ok"; }\ndocument.getElementById("btn").onclick = boom;\n</file>\nJetzt ohne Fehler.\n<tool name="done"/>'
    ]
  };
  global.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, opts);
    const body = JSON.parse(opts.body); const sys = body.messages[0].content;
    if (/TEAM-MODUS – du bist/.test(sys)) {
      const task = sys.match(/DEINE Aufgabe: (.*)/)[1];
      const teil = (task.match(/Teil ([ABC])/) || [])[1];
      if (teil) { // Rennspiel-Test: lange Dateien, die über eine Etappe hinausgehen; Fortsetzung schreibt nahtlos weiter
        const x = teil.toLowerCase(); const full = `Teil ${teil}.\n<file path="${x}.js">\n` + Array.from({ length: 30 }, (_, k) => `window.${x}${k} = ${k};`).join('\n') + '\n</file>';
        const msgs = body.messages; const cont = /abgeschnitten/.test(msgs[msgs.length - 1].content);
        const before = cont ? msgs[msgs.length - 2].content : '';
        if (cont) seen.conts.push(teil);
        seen.active++; seen.maxActive = Math.max(seen.maxActive, seen.active);
        const res = sse(full.slice(before.length)); const rd = res.body.getReader();
        return new Response(new ReadableStream({ async pull(c) { const { value, done } = await rd.read(); if (opts.signal?.aborted) { seen.active--; c.error(Object.assign(new Error('abgebrochen'), { name: 'AbortError' })); return; } if (done) { seen.active--; c.close(); } else c.enqueue(value); }, cancel() { seen.active--; } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      } seen.subs.push(task); seen.kits.push(((sys.match(/DU BIST DER ([^\n–]+)/) || [])[1] || '-').trim());
      if (/Aufbau/.test(task)) return sse('Ich baue den Aufbau.\n<file path="index.html">\n<!doctype html><html><head><link rel="stylesheet" href="coden-kit.css"><link rel="stylesheet" href="style.css"></head><body><canvas id="game"></canvas><button id="start">Start</button><script src="coden-kit.js"></script><script src="game.js"></script></body></html>\n</file>\n<file path="style.css">\nbody{margin:0}\n</file>\n<file path="app.js">\n// darf ich nicht\n</file>');
      return sse('Logik kommt.\n<file path="game.js">\ndocument.getElementById("start").onclick = () => {};\nif (true) {\n</file>');
    }
    if (/DU BIST DER MAIN AGENT/.test(sys)) {
      seen.main.push(sys);
      const users = body.messages.filter(m => m.role === 'user'); const results = users.filter(m => /^\[Werkzeug-Ergebnisse\]/.test(m.content)).length;
      const wish = [...body.messages].reverse().find(m => m.role === 'user' && !/^\[Werkzeug-Ergebnisse\]/.test(m.content)).content;
      const key = /Weltraum/.test(wish) ? 'team' : /dunkel/.test(wish) ? 'dunkel' : /Hilfsdatei/.test(wish) ? 'kaputt' : /merk/.test(wish) ? 'merk' : /Repariere/.test(wish) ? 'ankuendigung' : /Etappen/.test(wish) ? 'etappen' : /Rennspiel/.test(wish) ? 'rennen' : /Werkzeugkette/.test(wish) ? 'werkzeuge' : /Bugfix/.test(wish) ? 'donebug' : 'solo';
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
  chk('Main Agent: 4 Arbeitsschritte + Abnahme', seen.main.length, 5);
  chk('Abnahme: Bitte des Nutzers wird Punkt für Punkt geprüft', /\[Abnahme\][\s\S]*Weltraum-Spiel mit Start-Knopf/.test(seen.results[4]), true);
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
  chk('Eine Nachricht für den ganzen Lauf (mit Werkzeug-Ergebnissen)', (m1.body.match(/<result name="(\w+)"/g) || []).map(x => x.slice(14, -1)).join(','), 'spawn,search,read,check,review');
  chk('Ergebnis spawn als Zeile', /<result name="spawn" ok="0">2\/2 Sub-Agenten fertig · 1 Problem gefunden<\/result>/.test(m1.body), true);
  chk('Nachricht gekürzt (keine Dateiinhalte), Abschluss da', !/getElementById\("start"\)\.onclick/.test(m1.body) && /Fertig! Das Spiel läuft/.test(m1.body), true);
  chk('Meta: Schritte und geänderte Dateien', `${m1.meta.steps} ${m1.meta.changed.map(c => c.path).sort().join(',')}`, '5 game.js,index.html,style.css');
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
  chk('Solo: spawn wird abgelehnt', seen.results.some(r => /Solo-Modus/.test(r)), true);

  // --- Nur angekündigt statt gehandelt: Coden hakt nach, statt aufzuhören ---
  seen.main = []; seen.results = []; await say(app.id, 'Repariere die Initialisierung');
  await agent(app.id, { tier: 'pro', mode: 'auto' });
  chk('Nachhaken: zweiter Schritt mit Aufforderung', `${seen.main.length} ${/\[System\] Du hast nur angekündigt/.test(seen.results[1])}`, '2 true');
  chk('Nachhaken: Änderung kam danach wirklich', (await G('/apps/' + app.id, anna)).j.files['init.js'], 'window.bereit = true;');
  chk('Nachhaken als Zeile in der Antwort', /<result name="nudge"/.test((await lastAi(app.id)).body), true);
  chk('Main-Prompt: Deutsch, handeln statt ankündigen, Kit ist geladen', /IMMER auf Deutsch/.test(seen.main[0]) && /HANDELN statt ankündigen/.test(seen.main[0]) && /coden-kit\.js wird IMMER vor deinen Skripten geladen/.test(seen.main[0]), true);

  // --- Etappen: Zeit einer Server-Ausführung reicht nicht -> der Agent setzt sich selbst fort ---
  process.env.CODEN_LEG_STEPS = '1'; // jede Etappe macht genau einen Schritt
  seen.main = []; await say(app.id, 'Bau es in Etappen');
  const e1 = await agent(app.id, { tier: 'pro', mode: 'single' });
  chk('Etappe 1 endet mit "cont" statt "done"', e1.evs[e1.evs.length - 1].t, 'cont');
  const runE = e1.evs[0].id; let stE;
  for (let i = 0; i < 60; i++) { stE = (await G(`/apps/${app.id}/agent?run=${runE}`, anna)).j; if (stE.status !== 'running') break; await new Promise(r => setTimeout(r, 150)); }
  process.env.CODEN_LEG_STEPS = '';
  chk('Etappen: Lauf am Ende fertig', stE.status, 'done');
  chk('Etappen: 3 Arbeitsschritte + Abnahme in 4 Etappen, Verlauf bleibt erhalten', `${seen.main.length} ${(stE.text.match(/<result name="leg"/g) || []).length} ${/<result name="review"/.test(stE.text)}`, '4 3 true');
  chk('Etappen: Ergebnis gespeichert', (await G('/apps/' + app.id, anna)).j.files['etappe.js'], 'window.e = 2;');
  const mE = await lastAi(app.id);
  chk('Etappen: genau eine Antwort mit Meta', `${mE.meta.legs} ${mE.meta.steps} ${/Alles fertig und geprüft/.test(mE.body)}`, '4 4 true');
  chk('Etappen-Schlüssel ist verbraucht (kein zweites Fortsetzen)', (await realFetch(`${base}/apps/${app.id}/agent/continue`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coden-Leg': 'x'.repeat(48) }, body: JSON.stringify({ run: runE }) })).status, 403);

  // --- Viele spawn-Aufrufe: ein gemeinsamer Auftrag, alle Sub-Agenten gleichzeitig; zu wenig Zeit -> nächste Etappe;
  //     Sub-Agenten, die bis zum Etappen-Ende nicht fertig sind, schreiben in der nächsten Etappe nahtlos weiter ---
  Object.assign(process.env, { CODEN_SPAWN_MIN_MS: '999999999', CODEN_SUB_RESERVE_MS: '999999999', CODEN_SUB_MIN_MS: '250' });
  delay = 40; seen.main = []; seen.subs = []; seen.conts = []; seen.maxActive = 0;
  await say(app.id, 'Bau mir ein 3D-Rennspiel');
  const r1 = await agent(app.id, { tier: 'pro', mode: 'team' });
  const runR = r1.evs[0].id; let stR;
  for (let i = 0; i < 120; i++) { stR = (await G(`/apps/${app.id}/agent?run=${runR}`, anna)).j; if (stR.status !== 'running') break; await new Promise(r => setTimeout(r, 150)); }
  delay = 0; for (const k of ['CODEN_SPAWN_MIN_MS', 'CODEN_SUB_RESERVE_MS', 'CODEN_SUB_MIN_MS']) delete process.env[k];
  chk('Rennspiel: Lauf fertig', stR.status, 'done');
  chk('Rennspiel: 3 spawn-Aufrufe → EIN Auftrag, nie „zu wenig Zeit“', `${(stR.text.match(/<result name="spawn"/g) || []).length > 0} ${/zu wenig Zeit|Sub-Agenten-Limit/.test(stR.text)}`, 'true false');
  chk('Rennspiel: alle 3 Sub-Agenten liefen gleichzeitig', seen.maxActive, 3);
  chk('Rennspiel: Sub-Agenten wurden pausiert und schrieben weiter (nicht abgebrochen)', seen.conts.length >= 3 && /schreiben in der nächsten Etappe weiter/.test(stR.text), true);
  const fR = (await G('/apps/' + app.id, anna)).j.files;
  const full = (x) => Array.from({ length: 30 }, (_, k) => `window.${x}${k} = ${k};`).join('\n');
  chk('Rennspiel: alle Dateien vollständig und ohne Lücke/Doppelung', ['a', 'b', 'c'].map(x => fR[x + '.js'] === full(x)).join(','), 'true,true,true');
  chk('Rennspiel: Endbericht 3/3', /3\/3 Sub-Agenten fertig/.test(stR.text), true);
  const agR = stR.agents.filter(a => a.parent);
  chk('Rennspiel: 3 Sub-Agenten im Baum, alle fertig', agR.map(a => a.status).join(','), 'done,done,done');

  // --- 3D-Kit: Spezial-Agent three kennt Coden.three, Spiele bekommen die 3D-Doku ---
  const AC = require('../shared/agent-core');
  chk('3D: Spezial-Agent three mit Kit', `${AC.KIT_IDS.includes('three')} ${/Coden\.three\.car\(/.test(AC.kitFor('three').kit)} ${/three@0\.149\.0/.test(AC.kitFor('three').kit)}`, 'true true true');
  chk('3D: Spiel-Prompt enthält 3D-Kit, Web-Prompt nur Hinweis', `${/Coden\.three\.track/.test(AC.systemPrompt({ app: { name: 'x', kind: 'game' }, files: {}, main: { maxSteps: 40, spawn: true } }))} ${/Coden\.three\.track/.test(AC.systemPrompt({ app: { name: 'x', kind: 'web' }, files: {}, main: { maxSteps: 40, spawn: true } }))}`, 'true false');
  chk('3D: Web-App mit three.js bekommt das 3D-Kit', /Coden\.three\.track/.test(AC.systemPrompt({ app: { name: 'x', kind: 'web' }, files: { 'app.js': 'const s = new THREE.Scene();' }, main: { maxSteps: 40, spawn: true } })), true);

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

  // --- Neue Werkzeuge direkt: tree, outline, search (pattern/context), domMap, move, copy, insert, check JSON, cdnSearch ---
  const tf = {
    'index.html': '<html><head><title>TestApp</title><script src="app.js"></script></head><body><section id="hero"><button id="go" data-go="home"></button></section></body></html>',
    'style.css': ':root { --bg: #000; }\n.hero { color: #fff; }',
    'app.js': 'function initApp() {\n  document.getElementById("go");\n  document.getElementById("fehlt");\n}',
    'bad.json': '{ broken }'
  };
  chk('tree: zählt Dateien und Zeilen', /4 Dateien · 8 Zeilen/.test(T.tree(tf).summary) && /\[Startseite\]/.test(T.tree(tf).text), true);
  chk('outline: findet HTML/CSS/JS Symbole', /function initApp/.test(T.outline(tf, 'app.js').text) && /<section #hero>/.test(T.outline(tf, 'index.html').text) && /\.hero/.test(T.outline(tf, 'style.css').text), true);
  chk('search: pattern & context', /app\.js:2:/.test(T.search(tf, 'getElementById', false, '*.js', 1).text) && !/index\.html/.test(T.search(tf, 'getElementById', false, '*.js', 1).text), true);
  const dm = T.domMap(tf);
  chk('domMap: findet fehlende ID und data-go', `${dm.ok} ${/app\.js → #fehlt/.test(dm.text)} ${/data-go Ziele: home/.test(dm.text)}`, 'false true true');
  chk('check: erkennt JSON-Syntaxfehler', T.check(tf).issues.some(x => /JSON-Fehler in bad\.json/.test(x)), true);
  const cp = T.copy(tf, 'app.js', 'js/app2.js');
  chk('copy: dupliziert Datei', `${cp.ok} ${cp.set['js/app2.js'] === tf['app.js']}`, 'true true');
  const mv = T.move(tf, 'app.js', 'js/main.js');
  chk('move: verschiebt und schützt kit', `${mv.ok} ${mv.remove[0]} ${'js/main.js' in mv.set} ${T.move({ 'coden-kit.js': '1' }, 'coden-kit.js', 'x.js').ok}`, 'true app.js true false');
  const ins = T.insert(tf, 'app.js', { line: '2', content: '  const x = 1;' });
  chk('insert: fügt an Zeile ein', `${ins.ok} ${ins.set['app.js'].split('\n')[1]}`, 'true   const x = 1;');
  const origCdn = T.cdnQuery;
  T.cdnQuery = async () => [{ name: 'chart.js', latest: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js', description: 'Charts' }];
  const cs = await T.cdnSearch('chart');
  T.cdnQuery = origCdn;
  chk('cdnSearch: liefert CDN-URL', `${cs.ok} ${/chart\.umd\.min\.js/.test(cs.text)}`, 'true true');

  // --- Neue Werkzeuge im echten Agenten-Lauf (copy, move, insert, tree, outline) ---
  seen.main = []; await say(app.id, 'Teste die Werkzeugkette');
  await agent(app.id, { tier: 'pro', mode: 'single' });
  const fW = (await G('/apps/' + app.id, anna)).j.files;
  chk('Agent-Werkzeugkette: kopiert, verschoben, eingefügt', `${'js/neu.js' in fW} ${'kopie.js' in fW} ${/^\/\/ header\nwindow\.e = 2;/.test(fW['js/neu.js'] || '')}`, 'true false true');

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

  // --- Regression: ungeschlossenes <result>, geleakte Kommentare, Scratch-Prompt, durationMs, Kit-Autoinjektion ---
  chk('Meta enthält durationMs', typeof m1.meta.durationMs === 'number' && m1.meta.durationMs >= 0, true);
  const broken = 'Vorlauf <result name="x" ok="1">unvollständig <plan>\n- [x] Punkt A\n</plan> <!-- (frühere Antwort: Datei app.js geschrieben, Inhalt hier gekürzt) --> <tool name="check"/> </tool> <result name="check" ok="1">keine Probleme</result>\nFertig!';
  const parsed = AC.parse(broken);
  const txt = parsed.segs.filter(s => s.kind === 'text').map(s => s.text).join(' ');
  chk('Parser: <plan> & <tool> werden nicht von ungeschlossenem <result> geschluckt', `${!!parsed.plan} ${parsed.tools.some(t => t.name === 'check')} ${parsed.segs.filter(s => s.kind === 'result').length}`, 'true true 2');
  chk('Parser: geleakter Kommentar & </tool> entfernt, Schlusstext da', `${!/frühere Antwort|<\/tool>/.test(txt)} ${/Fertig!/.test(txt)}`, 'true true');
  const spScratch = AC.systemPrompt({ app: { name: 'Neu', kind: 'web' }, files: { 'index.html': '<main id="app" data-scratch="1"></main>' }, main: { maxSteps: 40, spawn: true } });
  chk('Prompt: Scratch & Autoscaling erklärt', /START VON GRUND AUF/.test(spScratch) && /Responsive Autoscaling ist automatisch aktiv/.test(spScratch), true);
  const Bundle = require('../shared/app-bundle');
  const bundled = Bundle.build({ 'index.html': '<!doctype html><html><head><title>X</title></head><body><h1>Hi</h1><script src="app.js"></script></body></html>', 'app.js': 'console.log(1);' }, { kit: { css: '/*KITCSS*/', js: '/*KITJS*/' }, platform: 'web' });
  chk('Bundle: coden-kit.css und coden-kit.js automatisch injiziert', /\/\*KITCSS\*\//.test(bundled.pages['index.html']) && /\/\*KITJS\*\//.test(bundled.pages['index.html']), true);

  // --- Anti-Bug statische Checks + Headless Runtime Smoke-Test + Done-Gate ---
  const bugCheck = T.check({
    'index.html': '<!doctype html><html><head><script src="head.js"></script></head><body><div id="dup">1</div><div id="dup">2</div><form><button>Absenden</button></form><button data-go="gibtsnicht" type="button">Go</button><script src="a.js"></script><script src="b.js"></script></body></html>',
    'head.js': 'const el = document.getElementById("dup"); el.textContent = "x";',
    'a.js': 'import x from "./b.js";\nconst shared = 1;\nfetch("daten.json");',
    'b.js': 'const shared = 2;',
    'style.css': 'body { color: red;'
  });
  const bugJoined = bugCheck.issues.join('\n');
  chk('Anti-Bug: doppelte HTML-ID erkannt', /Doppelte id="dup"/.test(bugJoined), true);
  chk('Anti-Bug: <head>-Skript ohne defer erkannt', /im <head> ohne defer/.test(bugJoined), true);
  chk('Anti-Bug: ES-Module import/export erkannt', /ES-Module \(import\/export\)/.test(bugJoined), true);
  chk('Anti-Bug: doppelte globale Deklaration erkannt', /Doppelte globale Deklaration "shared"/.test(bugJoined), true);
  chk('Anti-Bug: Button in <form> ohne type erkannt', /<button> innerhalb <form>/.test(bugJoined), true);
  chk('Anti-Bug: data-go auf fehlende ID erkannt', /data-go="gibtsnicht"/.test(bugJoined), true);
  chk('Anti-Bug: fehlendes lokales fetch erkannt', /fetch\("daten\.json"\)/.test(bugJoined), true);
  chk('Anti-Bug: unausgeglichene CSS-Klammern erkannt', /CSS-Fehler in style\.css/.test(bugJoined), true);

  const clickCrash = T.check({
    'index.html': '<!doctype html><html><body><button id="go" type="button">Go</button><script src="app.js"></script></body></html>',
    'app.js': 'document.getElementById("go").addEventListener("click", () => { return kaputteVariable.prop; });'
  });
  chk('SmokeTest: Laufzeitfehler im Button-Click abgefangen', clickCrash.ok === false && clickCrash.issues.some(x => /Laufzeitfehler[\s\S]*#go/.test(x)), true);

  const cleanCdn = T.check({
    'index.html': '<!doctype html><html><head><script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script></head><body><button id="ok" type="button">Start</button><script src="app.js" defer></script></body></html>',
    'app.js': 'const scene = new THREE.Scene(); document.getElementById("ok").onclick = () => { localStorage.setItem("k", "1"); };'
  });
  chk('SmokeTest: saubere App mit CDN-Global (THREE) besteht ohne Fehler', cleanCdn.ok, true);

  const bugApp = (await P('/apps', { name: 'BugGate', kind: 'web', files: { 'index.html': '<!doctype html><html><body></body></html>' } }, anna)).j.app;
  seen.main = []; seen.results = [];
  await say(bugApp.id, 'Bugfix Gate testen');
  await agent(bugApp.id, { tier: 'pro', mode: 'auto' });
  chk('Done-Gate: <tool name="done"/> wird blockiert bis Laufzeitfehler behoben ist', seen.main.length >= 2 && seen.results.some(r => /Automatische Prüfung[\s\S]*Laufzeitfehler/.test(r)), true);
  chk('Done-Gate: finaler Code ist fehlerfrei', T.check((await G('/apps/' + bugApp.id, anna)).j.files).ok, true);

  await finish();
})();
