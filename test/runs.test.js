// Hintergrund-Läufe: Antwort läuft auf dem Server weiter, auch wenn der Client die Verbindung trennt.
const { setup } = require('./helpers');
(async () => {
  process.env.GROQ_API_KEY = 'test'; process.env.OPENROUTER_API_KEY = 'test'; process.env.GOOGLE_API_KEY = 'test';
  const realFetch = global.fetch;
  let chunks = ['Hallo ', 'aus ', 'dem ', 'Hinter', 'grund!'], delay = 0;
  global.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, opts);
    const enc = new TextEncoder(); const signal = opts.signal;
    const body = new ReadableStream({
      async start(c) {
        for (const v of chunks) {
          if (delay) await new Promise(r => setTimeout(r, delay));
          if (signal?.aborted) { c.error(Object.assign(new Error('abgebrochen'), { name: 'AbortError' })); return; }
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: v } }] })}\n\n`));
        }
        c.enqueue(enc.encode('data: [DONE]\n\n')); c.close();
      }
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const { call, chk, finish, token, base } = await setup();
  const anna = await token({ sub: 'uid-anna', email: 'anna@x.de', email_verified: true });
  const ben = await token({ sub: 'uid-ben', email: 'ben@x.de', email_verified: true });
  const body = (ref) => JSON.stringify({ tier: 'pro', ref, messages: [{ role: 'user', content: 'Hi' }], meta: { title: 'Test', userText: 'Hi' } });
  const start = (ref, signal) => realFetch(base + '/runs/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anna }, body: body(ref) });
  const events = (txt) => txt.split('\n\n').filter(x => x.startsWith('data: ')).map(x => JSON.parse(x.slice(6)));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // 1) Live zuschauen bis zum Ende
  const evs = events(await (await start('s1')).text());
  chk('Lauf: erst die ID, dann Text, dann done', `${evs[0].t} ${evs.filter(e => e.t === 'd').map(e => e.v).join('')} ${evs[evs.length - 1].t}`, 'run Hallo aus dem Hintergrund! done');
  const id1 = evs[0].id;
  chk('Lauf: gespeicherter Text', (await call('/runs/' + id1, null, anna)).j.text, 'Hallo aus dem Hintergrund!');
  chk('Lauf: live abgeholt -> nicht mehr offen', (await call('/runs?kind=chat', null, anna)).j.runs.some(r => r.id === id1), false);

  // 2) Verbindung trennen: der Server schreibt trotzdem fertig
  delay = 120;
  const ac = new AbortController(); const res = await start('s2', ac.signal);
  const reader = res.body.getReader(); const first = new TextDecoder().decode((await reader.read()).value);
  const id2 = events(first)[0].id; ac.abort();
  await wait(300);
  const mid = (await call('/runs/' + id2, null, anna)).j;
  chk('Getrennt: läuft noch', mid.status, 'running');
  chk('Getrennt: taucht in offenen Läufen auf', (await call('/runs?kind=chat', null, anna)).j.runs.some(r => r.id === id2 && r.ref === 's2'), true);
  await wait(1200);
  const end = (await call('/runs/' + id2, null, anna)).j;
  chk('Getrennt: trotzdem fertig geschrieben', `${end.status} ${end.text}`, 'done Hallo aus dem Hintergrund!');
  chk('Teil-Abfrage ab Position', (await call('/runs/' + id2 + '?from=6', null, anna)).j.text, 'aus dem Hintergrund!');
  chk('Meta (Titel, Nutzertext)', `${end.meta.title} ${end.meta.userText}`, 'Test Hi');
  chk('Fremder sieht den Lauf nicht', (await call('/runs/' + id2, null, ben)).s, 404);
  chk('Fremder kann nicht abholen', (await call('/runs/' + id2 + '/claim', {}, ben)).j.ok, false);
  const c1 = await call('/runs/' + id2 + '/claim', {}, anna);
  chk('Abholen: erstes Gerät bekommt die Antwort', `${c1.j.ok} ${c1.j.run.text}`, 'true Hallo aus dem Hintergrund!');
  chk('Abholen: zweites Gerät nicht (keine doppelte Nachricht)', (await call('/runs/' + id2 + '/claim', {}, anna)).j.ok, false);
  chk('Nach dem Abholen nicht mehr offen', (await call('/runs?kind=chat', null, anna)).j.runs.some(r => r.id === id2), false);

  // 3) Stoppen von einem anderen Gerät
  const ac3 = new AbortController(); const res3 = await start('s3', ac3.signal);
  const id3 = events(new TextDecoder().decode((await res3.body.getReader().read()).value))[0].id; ac3.abort();
  chk('Stopp: Fremder darf nicht', (await call('/runs/' + id3 + '/stop', {}, ben)).s, 404);
  chk('Stopp', (await call('/runs/' + id3 + '/stop', {}, anna)).s, 200);
  await wait(800);
  const st3 = (await call('/runs/' + id3, null, anna)).j;
  chk('Stopp: Status gestoppt, Teiltext bleibt', st3.status === 'stopped' && st3.text.length < 'Hallo aus dem Hintergrund!'.length, true);

  chk('Ungültige Anfrage', (await call('/runs/chat', { tier: 'pro', messages: [] }, anna)).s, 400);
  chk('Ohne Login', (await call('/runs?kind=chat')).s, 401);
  await finish();
})();
