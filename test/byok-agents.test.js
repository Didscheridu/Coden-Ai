// Bring your own Key im App-Modus: Main Agent und Sub-Agenten mit eigenem Modell/eigener Kette,
// höchstens N Sub-Agenten gleichzeitig über den Key (Rest wartet oder läuft über Coden), Ausweich-Ketten.
const { setup } = require('./helpers');
(async () => {
  Object.assign(process.env, { GROQ_API_KEY: 'coden-key', OPENROUTER_API_KEY: 'coden-key', GOOGLE_API_KEY: 'coden-key', CODEN_LIMIT_5H: '1000000', CODEN_LIMIT_WEEK: '10000000' });
  const realFetch = global.fetch; const MINE = 'sk-or-mine-1234';
  const st = { own: { active: 0, max: 0, calls: 0 }, coden: { active: 0, max: 0, calls: 0 }, subs: [], failFirst: false, urls: [] };
  const enc = new TextEncoder();
  const stream = (text, kind, delay) => new Response(new ReadableStream({
    async start(c) {
      const s = st[kind]; s.active++; s.max = Math.max(s.max, s.active);
      try { for (const part of text.match(/[\s\S]{1,60}/g) || []) { if (delay) await new Promise(r => setTimeout(r, delay)); c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`)); } c.enqueue(enc.encode('data: [DONE]\n\n')); }
      finally { s.active--; c.close(); }
    }
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  const SPAWN = JSON.stringify({ contract: 'Jede Datei setzt window.<name>.', tasks: ['A', 'B', 'C', 'D'].map(t => ({ title: 'Teil ' + t, agent: 'logic', level: 'mittel', files: [t.toLowerCase() + '.js'], goal: 'Teil ' + t })) });
  global.fetch = async (url, o = {}) => {
    if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, o);
    const body = JSON.parse(o.body); const sys = body.messages[0].content;
    const kind = String(o.headers?.Authorization || '').endsWith(MINE) ? 'own' : 'coden';
    st.urls.push(`${kind}:${body.model}`); st[kind].calls++;
    if (kind === 'own' && st.failFirst && body.model === 'bad/model') return new Response(JSON.stringify({ error: { message: 'kaputt' } }), { status: 500 });
    if (/TEAM-MODUS – du bist/.test(sys)) {
      const teil = (sys.match(/DEINE Aufgabe: (.*)/)[1].match(/Teil ([A-D])/) || [])[1]; st.subs.push(`${teil}:${kind}`);
      return stream(`Teil ${teil}.\n<file path="${teil.toLowerCase()}.js">\nwindow.${teil.toLowerCase()} = 1;\n</file>`, kind, 50);
    }
    if (/DU BIST DER MAIN AGENT/.test(sys)) {
      const results = body.messages.filter(m => m.role === 'user' && /^\[Werkzeug-Ergebnisse\]/.test(m.content)).length;
      return stream(results === 0 ? 'Ich starte das Team.\n<tool name="spawn">' + SPAWN + '</tool>' : 'Alles fertig und geprüft.\n<tool name="done"/>', kind, 0);
    }
    return stream('?', kind, 0);
  };
  const { call, chk, finish, token, base } = await setup();
  const anna = await token({ sub: 'uid-anna', email: 'anna@x.de', email_verified: true });
  const ben = await token({ sub: 'uid-ben', email: 'ben@x.de', email_verified: true });
  const P = (p, b, t, m) => call(p, b, t, m || 'POST'), G = (p, t) => call(p, null, t);
  const events = (txt) => txt.split('\n\n').filter(x => x.startsWith('data: ')).map(x => JSON.parse(x.slice(6)));
  const agent = async (id, body, tok = anna) => { const r = await realFetch(`${base}/apps/${id}/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) }); return { s: r.status, evs: r.status === 200 ? events(await r.text()) : [], j: r.status !== 200 ? await r.json() : null }; };
  const reset = () => { st.own.max = st.coden.max = st.own.calls = st.coden.calls = 0; st.subs = []; st.urls = []; };
  const mkApp = async (name) => { const a = (await P('/apps', { name, kind: 'game', files: { 'index.html': '<!doctype html><html><body>x</body></html>' } }, anna)).j.app; await P(`/apps/${a.id}/messages`, { role: 'user', body: 'Bau ein Spiel' }, anna); return a; };

  await P('/byok/keys/openrouter', { key: MINE }, anna, 'PUT');
  let o = (await P('/byok/models', { provider: 'openrouter', modelId: 'good/model', label: 'Gut', levels: ['low', 'high'] }, anna)).j;
  const good = o.models[0];
  o = (await P('/byok/models', { provider: 'openrouter', modelId: 'bad/model', label: 'Kaputt', levels: [] }, anna)).j;
  const bad = o.models.find(m => m.modelId === 'bad/model');

  // 1) Ketten: anlegen, prüfen, Reihenfolge, fremde/ungültige Mitglieder
  chk('Kette ohne Namen abgelehnt', (await P('/byok/chains', { name: '', members: [good.tier] }, anna)).s, 400);
  chk('Kette ohne Mitglieder abgelehnt', (await P('/byok/chains', { name: 'X', members: [] }, anna)).s, 400);
  chk('Kette mit fremdem Modell abgelehnt', (await P('/byok/chains', { name: 'X', members: ['byok:99999'] }, anna)).s, 400);
  o = (await P('/byok/chains', { name: 'Sicher', members: [bad.tier, good.tier, 'flash', 'flash', 'nonsense'] }, anna)).j;
  const chain = o.chains[0];
  chk('Kette gespeichert: Reihenfolge, ohne Doppelte und Unsinn', chain.members.map(m => m.tier), [bad.tier, good.tier, 'flash']);
  chk('Kette ist bereit, Namen aufgelöst', `${chain.ready} ${chain.members.map(m => m.label).join('/')}`, 'true Kaputt/Gut/Coden Flash');
  chk('Fremde sehen die Kette nicht', (await G('/byok', ben)).j.chains.length, 0);

  // 2) Chat über die Kette: erstes Modell fällt aus -> zweites antwortet; Limit zählt nicht
  st.failFirst = true; reset();
  const chat = await realFetch(base + '/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anna }, body: JSON.stringify({ tier: chain.tier, messages: [{ role: 'user', content: 'Hi' }] }) }).then(r => r.text());
  chk('Kette: Ausweichen auf das zweite Modell', `${events(chat).filter(e => e.t === 'd').map(e => e.v).join('')} ${st.urls.join(',')}`, '? own:bad/model,own:good/model');
  // Kette mit Coden-Stufe zuletzt: beide eigenen fallen aus -> Coden-Modell antwortet (zählt dann gegen das Limit)
  o = (await P('/byok/chains', { id: chain.id, name: 'Sicher', members: [bad.tier, 'flash'] }, anna)).j;
  reset(); const chat2 = await realFetch(base + '/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anna }, body: JSON.stringify({ tier: chain.tier, messages: [{ role: 'user', content: 'Hi' }] }) }).then(r => r.text());
  chk('Kette: fällt auf Coden-Modell zurück', `${events(chat2).some(e => e.t === 'done')} ${st.urls[0]} ${st.coden.calls > 0}`, 'true own:bad/model true');
  // Alle fallen aus -> klare Meldung mit Kettennamen
  o = (await P('/byok/chains', { id: chain.id, name: 'Sicher', members: [bad.tier] }, anna)).j; reset();
  const chat3 = await realFetch(base + '/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anna }, body: JSON.stringify({ tier: chain.tier, messages: [{ role: 'user', content: 'Hi' }] }) }).then(r => r.text());
  chk('Kette: alle ausgefallen -> Meldung mit Kettennamen', /Kette „Sicher“ sind ausgefallen.*kaputt/.test(events(chat3).find(e => e.t === 'e')?.error || ''), true);
  st.failFirst = false;
  o = (await P('/byok/chains', { id: chain.id, name: 'Sicher', members: [good.tier, 'flash'] }, anna)).j;
  // Modell löschen -> verschwindet aus der Kette
  o = (await P('/byok/models/' + bad.id, null, anna, 'DELETE')).j;
  chk('Gelöschtes Modell fliegt aus Ketten', o.chains[0].members.map(m => m.tier), [good.tier, 'flash']);

  // 3) App-Modus: Einstellungen für Sub-Agenten
  const cfg0 = (await G('/byok', anna)).j.agentConfig;
  chk('Standard: 3 Key-Plätze, Rest wartet', `${cfg0.keyMax} ${cfg0.overflow} ${cfg0.sub}`, '3 wait auto');
  let cfg = (await P('/byok/agent-config', { sub: 'byok:424242', levels: { easy: 'flash', medium: chain.tier, hard: 'bogus' }, keyMax: 99, overflow: 'coden', overflowTier: 'ultra' }, anna, 'PUT')).j.agentConfig;
  chk('Einstellung wird geprüft (unbekannte Modelle -> auto, keyMax 1–8, Overflow nur flash/normal/pro)', `${cfg.sub} ${cfg.levels.easy} ${cfg.levels.medium} ${cfg.levels.hard} ${cfg.keyMax} ${cfg.overflowTier}`, `auto flash ${chain.tier} auto 8 flash`);
  chk('Fremde Einstellungen unberührt', (await G('/byok', ben)).j.agentConfig.keyMax, 3);

  // 4) Fremdes eigenes Modell als Main-Agent-Modell wird abgelehnt (fällt auf Pro zurück)
  const app0 = await mkApp('Fremd'); reset();
  await agent(app0.id, { tier: good.tier, mode: 'single' }, ben);
  chk('Fremdes Modell nicht nutzbar im App-Modus', st.own.calls, 0);

  // 5) Team über den eigenen Key, 2 Plätze, Rest wartet
  await P('/byok/agent-config', { sub: 'auto', keyMax: 2, overflow: 'wait' }, anna, 'PUT');
  const app1 = await mkApp('Warten'); reset();
  const t1 = await agent(app1.id, { tier: good.tier, mode: 'team', effort: 'high' });
  const ag1 = t1.evs.filter(e => e.t === 'a').pop()?.agents || [];
  chk('Lauf fertig', t1.evs[t1.evs.length - 1].t, 'done');
  chk('Main Agent und Sub-Agenten nutzen den eigenen Key, kein Coden-Modell', `${st.coden.calls} ${st.subs.sort().join(',')}`, '0 A:own,B:own,C:own,D:own');
  chk('Höchstens 2 Sub-Agenten gleichzeitig über den Key', st.own.max, 2);
  chk('Anzeige: eigener Modellname statt Stufe', ag1.map(a => a.tier).join(','), 'Gut,Gut,Gut,Gut,Gut');
  chk('Alle 4 Dateien gespeichert', Object.keys((await G('/apps/' + app1.id, anna)).j.files).sort().join(','), 'a.js,b.js,c.js,d.js,index.html');
  const u1 = (await G('/usage', anna)).j; chk('Zählt nicht gegen das Coden-Limit', u1.session.used, 0);

  // 6) 1 Platz + Overflow über Coden: 1 Sub-Agent über den Key, 3 über Coden (Flash)
  await P('/byok/agent-config', { sub: 'auto', keyMax: 1, overflow: 'coden', overflowTier: 'flash' }, anna, 'PUT');
  const app2 = await mkApp('Overflow'); reset();
  const t2 = await agent(app2.id, { tier: good.tier, mode: 'team' });
  chk('Overflow: 1 Sub-Agent über den Key, 3 über Coden', `${st.subs.filter(x => x.endsWith('own')).length} ${st.subs.filter(x => x.endsWith('coden')).length}`, '1 3');
  chk('Overflow: Anzeige nennt Flash und den eigenen Namen', t2.evs.filter(e => e.t === 'a').pop().agents.filter(a => a.parent).map(a => a.tier).sort().join(','), 'Flash,Flash,Flash,Gut');
  chk('Overflow: Coden-Anteil zählt gegen das Limit', (await G('/usage', anna)).j.session.used > 0, true);

  // 7) Sub-Modell pro Schwierigkeit: mittel -> Kette
  await P('/byok/agent-config', { sub: 'auto', levels: { easy: 'auto', medium: chain.tier, hard: 'auto' }, keyMax: 4, overflow: 'wait' }, anna, 'PUT');
  const app3 = await mkApp('Pro Stufe'); reset();
  const t3 = await agent(app3.id, { tier: 'flash', mode: 'team' });
  chk('Mittel-Aufgaben laufen über die Kette (Main bleibt Coden Flash)', `${st.subs.filter(x => x.endsWith('own')).length} ${t3.evs.filter(e => e.t === 'a').pop().agents.filter(a => a.parent).map(a => a.tier).join(',')}`, '4 Sicher,Sicher,Sicher,Sicher');
  await finish();
})().catch(e => { console.error(e); process.exit(1); });
