// Code Buddy (Profile, Freunde, DMs, Projekte) und der Streaming-Endpunkt, Ende-zu-Ende gegen echtes Postgres.
const { setup } = require('./helpers');
(async () => {
  const { call, chk, finish, token, base, db } = await setup();
  const T = {};
  for (const [k, email] of Object.entries({ anna: 'anna@x.de', ben: 'ben@x.de', cem: 'cem@x.de', admin: 'admin@test.de' }))
    T[k] = await token({ sub: 'uid-' + k, email, email_verified: true });
  const P = (path, body, tok) => call(path, body, tok, 'POST'); const D = (path, tok) => call(path, null, tok, 'DELETE'); const G = (path, tok) => call(path, null, tok);
  const PUT = (path, body, tok) => call(path, body, tok, 'PUT');

  // --- Profil ---
  chk('ohne Login', (await G('/buddy/me')).s, 401);
  chk('ohne Profil: Freunde gesperrt', (await G('/buddy/friends', T.anna)).s, 409);
  chk('Profil: ungültiger Name', (await PUT('/buddy/me', { handle: 'A!', displayName: 'A' }, T.anna)).s, 400);
  chk('Profil: reservierter Name', (await PUT('/buddy/me', { handle: 'coden', displayName: 'A' }, T.anna)).s, 400);
  chk('Profil: anlegen', (await PUT('/buddy/me', { handle: 'Anna_01', displayName: 'Anna', bio: 'Python' }, T.anna)).j.profile.handle, 'anna_01');
  chk('Profil: Name schon vergeben', (await PUT('/buddy/me', { handle: 'anna_01', displayName: 'Ben' }, T.ben)).s, 409);
  await PUT('/buddy/me', { handle: 'ben', displayName: 'Ben' }, T.ben); await PUT('/buddy/me', { handle: 'cem', displayName: 'Cem' }, T.cem);

  // --- Freunde ---
  chk('Suche: Treffer', (await G('/buddy/search?handle=ben', T.anna)).j.result.relation, 'none');
  chk('Suche: unbekannt', (await G('/buddy/search?handle=niemand', T.anna)).j.result, null);
  chk('Suche gibt keine interne ID heraus', Object.keys((await G('/buddy/search?handle=ben', T.anna)).j.result).sort(), ['bio', 'displayName', 'handle', 'relation']);
  chk('Anfrage an sich selbst', (await P('/buddy/requests', { handle: 'anna_01' }, T.anna)).s, 400);
  chk('Anfrage an Unbekannten', (await P('/buddy/requests', { handle: 'gibtsnicht' }, T.anna)).s, 404);
  chk('Anfrage senden', (await P('/buddy/requests', { handle: 'ben' }, T.anna)).j.status, 'pending');
  chk('Anfrage doppelt', (await P('/buddy/requests', { handle: 'ben' }, T.anna)).s, 409);
  chk('Ben sieht eingehende Anfrage', (await G('/buddy/friends', T.ben)).j.incoming.map(x => x.handle), ['anna_01']);
  chk('Ben: Zähler in der Übersicht', (await G('/buddy/summary', T.ben)).j.requests, 1);
  chk('Anna kann ihre eigene Anfrage nicht annehmen', (await P('/buddy/requests/ben/accept', {}, T.anna)).s, 404);
  chk('Vor der Annahme: keine DMs', (await P('/buddy/messages/ben', { body: 'hi' }, T.anna)).s, 403);
  chk('Ben nimmt an', (await P('/buddy/requests/anna_01/accept', {}, T.ben)).s, 200);
  chk('Beide sind Freunde', [(await G('/buddy/friends', T.anna)).j.friends.length, (await G('/buddy/friends', T.ben)).j.friends.length], [1, 1]);
  // gegenseitige Anfrage = sofort Freunde
  await P('/buddy/requests', { handle: 'cem' }, T.anna);
  chk('Gegenseitige Anfrage wird automatisch angenommen', (await P('/buddy/requests', { handle: 'anna_01' }, T.cem)).j.status, 'accepted');
  await P('/buddy/requests', { handle: 'cem' }, T.ben);
  chk('Ablehnen', (await P('/buddy/requests/ben/decline', {}, T.cem)).s, 200);
  chk('Nach Ablehnen keine Freunde', (await P('/buddy/messages/cem', { body: 'x' }, T.ben)).s, 403);

  // --- Nachrichten ---
  chk('DM senden', (await P('/buddy/messages/ben', { body: 'Hallo Ben <b>fett</b>' }, T.anna)).j.message.mine, true);
  chk('DM: leer abgelehnt', (await P('/buddy/messages/ben', { body: '   ' }, T.anna)).s, 400);
  chk('DM: zu lang abgelehnt', (await P('/buddy/messages/ben', { body: 'x'.repeat(2001) }, T.anna)).s, 400);
  chk('Ben: 1 ungelesen', (await G('/buddy/friends', T.ben)).j.friends[0].unread, 1);
  const msgs = (await G('/buddy/messages/anna_01', T.ben)).j.messages;
  chk('Ben liest: Text unverändert (Escape macht das Frontend)', [msgs.length, msgs[0].body, msgs[0].mine], [1, 'Hallo Ben <b>fett</b>', false]);
  await new Promise(r => setTimeout(r, 50));
  chk('Danach gelesen', (await G('/buddy/friends', T.ben)).j.friends[0].unread, 0);
  await P('/buddy/messages/anna_01', { body: 'Hi Anna' }, T.ben);
  chk('Polling: nur neue Nachrichten (after)', (await G(`/buddy/messages/ben?after=${msgs[0].id}`, T.anna)).j.messages.map(m => m.body), ['Hi Anna']);
  chk('Fremder (Cem) kann den Chat Anna-Ben nicht lesen', (await G('/buddy/messages/ben', T.cem)).s, 403);

  // --- Projekte ---
  const pr = await P('/buddy/projects', { title: 'Snake-Spiel', description: 'zusammen bauen' }, T.anna); const pid = pr.j.id;
  chk('Projekt anlegen', typeof pid, 'number');
  chk('Projekt ohne Titel', (await P('/buddy/projects', { title: ' ' }, T.anna)).s, 400);
  chk('Nicht-Mitglied sieht Projekt nicht', (await G(`/buddy/projects/${pid}`, T.ben)).s, 404);
  chk('Einladen: Nicht-Freund abgelehnt', (await P(`/buddy/projects/${pid}/members`, { handle: 'ben' }, T.cem)).s, 404); // Cem ist nicht Mitglied
  await P('/buddy/requests', { handle: 'ben' }, T.cem); // Cem->Ben offen, nicht angenommen
  chk('Einladen: Freund ok', (await P(`/buddy/projects/${pid}/members`, { handle: 'ben' }, T.anna)).s, 200);
  chk('Einladen: kein Freund (Anna-Cem sind Freunde, Admin nicht)', (await P(`/buddy/projects/${pid}/members`, { handle: 'gibtsnicht' }, T.anna)).s, 404);
  chk('Ben darf nicht einladen', (await P(`/buddy/projects/${pid}/members`, { handle: 'cem' }, T.ben)).s, 403);
  chk('Ben sieht das Projekt', (await G(`/buddy/projects/${pid}`, T.ben)).j.members.map(m => m.handle).sort(), ['anna_01', 'ben']);
  chk('Projektliste von Ben', (await G('/buddy/projects', T.ben)).j.projects[0].role, 'editor');

  chk('Datei anlegen', (await PUT(`/buddy/projects/${pid}/file`, { name: 'main.py', content: 'print(1)', baseVersion: 0 }, T.anna)).j.version, 1);
  chk('Datei doppelt anlegen = Konflikt', (await PUT(`/buddy/projects/${pid}/file`, { name: 'main.py', content: 'x', baseVersion: 0 }, T.ben)).s, 409);
  chk('Ben ändert (Version 1 -> 2)', (await PUT(`/buddy/projects/${pid}/file`, { name: 'main.py', content: 'print(2)', baseVersion: 1 }, T.ben)).j.version, 2);
  const conflict = await PUT(`/buddy/projects/${pid}/file`, { name: 'main.py', content: 'print(3)', baseVersion: 1 }, T.anna);
  chk('Anna mit veralteter Version: Konflikt, nichts überschrieben', [conflict.s, conflict.j.conflict, conflict.j.currentVersion, (await G(`/buddy/projects/${pid}/file?name=main.py`, T.anna)).j.content], [409, true, 2, 'print(2)']);
  chk('Dateiliste zeigt Autor', (await G(`/buddy/projects/${pid}`, T.anna)).j.files[0].updatedBy, 'ben');
  for (const bad of ['../geheim', '/etc/passwd', 'a//b', 'x'.repeat(90), '']) chk(`Dateiname "${bad.slice(0, 12)}" abgelehnt`, (await PUT(`/buddy/projects/${pid}/file`, { name: bad, content: '', baseVersion: 0 }, T.anna)).s, 400);
  chk('Zu große Datei', (await PUT(`/buddy/projects/${pid}/file`, { name: 'big.txt', content: 'x'.repeat(200_001), baseVersion: 0 }, T.anna)).s, 413);
  chk('Nicht-Mitglied kann nicht schreiben', (await PUT(`/buddy/projects/${pid}/file`, { name: 'hack.js', content: '1', baseVersion: 0 }, T.cem)).s, 404);
  chk('Nicht-Mitglied kann nicht lesen', (await G(`/buddy/projects/${pid}/file?name=main.py`, T.cem)).s, 404);
  for (let i = 0; i < 29; i++) await PUT(`/buddy/projects/${pid}/file`, { name: `f${i}.txt`, content: '', baseVersion: 0 }, T.anna);
  chk('Maximal 30 Dateien', (await PUT(`/buddy/projects/${pid}/file`, { name: 'zu-viel.txt', content: '', baseVersion: 0 }, T.anna)).s, 400);
  chk('Datei löschen', (await D(`/buddy/projects/${pid}/file?name=f0.txt`, T.ben)).s, 200);

  chk('Projekt-Chat senden', (await P(`/buddy/projects/${pid}/messages`, { body: 'Ich baue die Logik' }, T.ben)).j.message.handle, 'ben');
  chk('Projekt-Chat lesen', (await G(`/buddy/projects/${pid}/messages`, T.anna)).j.messages.map(m => [m.handle, m.mine]), [['ben', false]]);
  chk('Projekt-Chat: Nicht-Mitglied', (await G(`/buddy/projects/${pid}/messages`, T.cem)).s, 404);

  chk('Besitzer kann nicht entfernt werden', (await D(`/buddy/projects/${pid}/members/anna_01`, T.anna)).s, 400);
  chk('Ben darf Anna nicht entfernen', (await D(`/buddy/projects/${pid}/members/anna_01`, T.ben)).s, 403);
  chk('Ben darf Projekt nicht löschen', (await D(`/buddy/projects/${pid}`, T.ben)).s, 403);
  chk('Ben verlässt das Projekt', (await D(`/buddy/projects/${pid}/members/ben`, T.ben)).s, 200);
  chk('Danach kein Zugriff mehr', (await G(`/buddy/projects/${pid}`, T.ben)).s, 404);
  chk('Anna löscht das Projekt', (await D(`/buddy/projects/${pid}`, T.anna)).s, 200);
  chk('Dateien und Nachrichten mit gelöscht (Cascade)', [(await db.query('SELECT count(*)::int n FROM project_files')).rows[0].n, (await db.query('SELECT count(*)::int n FROM project_messages')).rows[0].n], [0, 0]);

  // Freund entfernen
  chk('Freund entfernen', (await D('/buddy/friends/ben', T.anna)).s, 200);
  chk('Danach keine DMs mehr', (await P('/buddy/messages/ben', { body: 'x' }, T.anna)).s, 403);

  // --- Streaming-Endpunkt (HTTP/SSE) ---
  const realFetch = global.fetch;
  Object.assign(process.env, { GROQ_API_KEY: 'x', OPENROUTER_API_KEY: 'x', GOOGLE_API_KEY: 'x' });
  global.fetch = async (url, o) => {
    if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, o);
    const body = JSON.parse(o.body); const enc = new TextEncoder();
    if (body.model !== 'openai/gpt-oss-20b' && !String(url).includes('googleapis')) return new Response('{}', { status: 500 });
    if (String(url).includes('googleapis')) return new Response('{}', { status: 500 });
    return new Response(new ReadableStream({ async start(c) { for (const t of ['Hall', 'o ', 'Stream']) { c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`)); await new Promise(r => setTimeout(r, 5)); } c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200 });
  };
  const r401 = await realFetch(base + '/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  chk('Stream ohne Login', r401.status, 401);
  const rBad = await realFetch(base + '/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T.anna }, body: JSON.stringify({ tier: 'flash', messages: [{ role: 'hacker', content: 'x' }] }) });
  chk('Stream: ungültige Nachricht', rBad.status, 400);
  const rs = await realFetch(base + '/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T.anna }, body: JSON.stringify({ tier: 'flash', messages: [{ role: 'user', content: 'hi' }] }) });
  const text = await rs.text(); const events = text.split('\n\n').filter(x => x.startsWith('data: ')).map(x => JSON.parse(x.slice(6)));
  chk('Stream: Content-Type', rs.headers.get('content-type').startsWith('text/event-stream'), true);
  chk('Stream: Ereignisse (Fortschritt, 3 Stücke, fertig; Modellname nur für Owner)', events.map(e => e.t).filter(t => t !== 'k'), ['d', 'd', 'd', 'done']);
  chk('Stream: Text zusammengesetzt', events.filter(e => e.t === 'd').map(e => e.v).join(''), 'Hallo Stream');
  global.fetch = realFetch;
  await finish();
})();
