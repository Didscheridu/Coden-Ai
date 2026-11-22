// Nutzungslimits (5 Stunden + Woche), /reset, Bilder auf dem Server, Etappen bei langen Chat-Antworten, Push.
const { setup } = require('./helpers');
(async () => {
  Object.assign(process.env, { GROQ_API_KEY: 'test', OPENROUTER_API_KEY: 'test', CODEN_LIMIT_5H: '20000', CODEN_LIMIT_WEEK: '100000',
    CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' });
  const realFetch = global.fetch;
  let chunks = ['Hallo'], delay = 0, calls = [];
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
    if (u.includes('api.cloudflare.com')) return new Response(JSON.stringify({ result: { image: PNG } }), { status: 200 });
    const body = JSON.parse(opts.body || '{}'); calls.push(body);
    const last = body.messages?.[body.messages.length - 1]?.content || '';
    const parts = /^Deine letzte Antwort wurde/.test(last) ? [' Teil zwei.', ' Ende.'] : chunks;
    const enc = new TextEncoder(); const signal = opts.signal;
    const stream = new ReadableStream({
      async start(c) {
        for (const v of parts) {
          if (delay) await new Promise(r => setTimeout(r, delay));
          if (signal?.aborted) { c.error(Object.assign(new Error('abgebrochen'), { name: 'AbortError' })); return; }
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: v } }] })}\n\n`));
        }
        c.enqueue(enc.encode('data: [DONE]\n\n')); c.close();
      }
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const { call, chk, finish, token, base, db } = await setup();
  const Usage = require('../server/usage'); const Push = require('../server/push');
  const anna = await token({ sub: 'uid-anna', email: 'Anna@X.de', email_verified: true });
  const admin = await token({ sub: 'uid-admin', email: 'admin@test.de', email_verified: true });
  const events = (txt) => txt.split('\n\n').filter(x => x.startsWith('data: ')).map(x => JSON.parse(x.slice(6)));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const run = (tier, ref, tok = anna, signal) => realFetch(base + '/runs/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ tier, ref, messages: [{ role: 'user', content: 'Hallo Coden' }], meta: { title: 'T', userText: 'Hallo Coden' } }) });
  const until = async (id, tok = anna) => { for (let i = 0; i < 80; i++) { const r = (await call('/runs/' + id, null, tok)).j; if (r.status !== 'running') return r; await wait(100); } return null; };

  // 1) Startzustand
  let u = (await call('/usage', null, anna)).j;
  chk('Start: nichts verbraucht', `${u.session.used} ${u.week.used} ${u.blocked} ${u.session.resetAt}`, '0 0 null null');
  chk('Start: Limits aus der Umgebung', `${u.session.limit} ${u.week.limit}`, '20000 100000');

  // 2) Eine Antwort zählt Tokens (Ausgabe + Eingabe zu einem Viertel, Gewicht des Modells)
  chunks = ['x'.repeat(4000)];
  let evs = events(await (await run('pro', 'c1')).text());
  chk('Antwort kommt durch', evs[evs.length - 1].t, 'done');
  await wait(100);
  u = (await call('/usage', null, anna)).j;
  chk('Verbrauch gezählt (Pro zählt 1,5-fach)', u.session.used >= 1500 && u.session.used < 1600, true);
  chk('5-Stunden-Fenster läuft jetzt', !!u.session.resetAt && Date.parse(u.session.resetAt) - Date.now() > 4.9 * 3600e3, true);
  chk('Wochenfenster läuft jetzt', Date.parse(u.week.resetAt) - Date.now() > 6.9 * 24 * 3600e3, true);
  const before = u.session.used;
  await run('flash', 'c2').then(r => r.text()); await wait(100);
  u = (await call('/usage', null, anna)).j;
  chk('Flash zählt nur halb', Math.round(u.session.used - before) >= 490 && u.session.used - before < 560, true);
  chk('E-Mail wird klein gespeichert', (await db.query(`SELECT email FROM usage_limits WHERE uid = 'uid-anna'`)).rows[0].email, 'anna@x.de');

  // 3) Limit voll: neue Anfragen werden abgelehnt (mit Rücksetz-Zeit)
  await Usage.add({ uid: 'uid-anna' }, 20000);
  const blocked = await run('flash', 'c3');
  const bj = await blocked.json();
  chk('Limit voll: Chat-Lauf abgelehnt', `${blocked.status} ${bj.code}`, '429 limit');
  chk('Limit voll: Meldung nennt Rücksetzung', /5-Stunden-Limit erreicht\. Es setzt sich in [45] Std\.( \d+ Min\.)? zurück/.test(bj.error), true);
  chk('Limit voll: Stand wird mitgeschickt', `${bj.usage.blocked} ${bj.usage.session.pct}`, 'session 100');
  chk('Limit voll: /chat/stream ebenso', (await call('/chat/stream', { tier: 'flash', messages: [{ role: 'user', content: 'x' }] }, anna)).s, 429);
  chk('Limit voll: /chat ebenso', (await call('/chat', { tier: 'flash', messages: [{ role: 'user', content: 'x' }] }, anna)).s, 429);
  const app = (await call('/apps', { name: 'Limit-App', kind: 'web' }, anna)).j;
  if (app.app?.id || app.id) {
    const aid = app.app?.id || app.id;
    await call(`/apps/${aid}/messages`, { role: 'user', body: 'Bau was' }, anna);
    const ag = await call(`/apps/${aid}/agent`, { tier: 'flash' }, anna);
    chk('Limit voll: App-Agent startet nicht', `${ag.s} ${ag.j.code}`, '429 limit');
  } else chk('App anlegen (für Agent-Test)', app, 'app');
  u = (await call('/usage', null, anna)).j;
  chk('/usage zeigt blockiert', u.blocked, 'session');

  // 4) Owner hat kein Limit
  await Usage.add({ uid: 'uid-admin', email: 'admin@test.de' }, 999999);
  const ou = (await call('/usage', null, admin)).j;
  chk('Owner: unbegrenzt, nie blockiert', `${ou.unlimited} ${ou.blocked}`, 'true null');
  chk('Owner: darf trotzdem fragen', events(await (await run('flash', 'o1', admin)).text()).pop().t, 'done');

  // 5) /reset <email> und /usage <email>
  chk('Reset: nur der Owner', (await call('/usage/reset', { email: 'anna@x.de' }, anna)).s, 403);
  chk('Admin-Übersicht: nur der Owner', (await call('/usage/admin', null, anna)).s, 403);
  const au = (await call('/usage/admin?email=ANNA@x.de', null, admin)).j;
  chk('/usage <email> zeigt den Nutzer', `${au.users.length} ${au.users[0].email} ${au.users[0].blocked}`, '1 anna@x.de session');
  chk('Reset: ungültige E-Mail', (await call('/usage/reset', { email: 'quatsch' }, admin)).s, 400);
  chk('Reset: unbekannte E-Mail', (await call('/usage/reset', { email: 'niemand@x.de' }, admin)).j.users, 0);
  const rs = (await call('/usage/reset', { email: 'Anna@x.de' }, admin)).j;
  chk('Reset: Anna zurückgesetzt', `${rs.ok} ${rs.users}`, 'true 1');
  u = (await call('/usage', null, anna)).j;
  chk('Nach Reset: volles Kontingent', `${u.session.used} ${u.week.used} ${u.blocked}`, '0 0 null');
  chk('Nach Reset: Gesamtverbrauch bleibt für die Statistik', u.total > 20000, true);
  chunks = ['Wieder da'];
  chk('Nach Reset: Anna darf wieder', events(await (await run('flash', 'c4')).text()).pop().t, 'done');

  // 6) Laufende Aufgabe darf übers Limit, wird aber bei sehr langer Überschreitung (Kulanz 125 %) gestoppt
  await call('/usage/reset', { email: 'anna@x.de' }, admin);
  await Usage.add({ uid: 'uid-anna' }, 19000);
  chunks = Array.from({ length: 40 }, () => 'y'.repeat(2000)); delay = 25;
  evs = events(await (await run('pro', 'g1')).text());
  delay = 0;
  const g = (await call('/runs/' + evs[0].id, null, anna)).j;
  const ys = (g.text.match(/y{2000}/g) || []).length;
  chk('Kulanz: lief über 100 % hinaus weiter', ys >= 4, true);
  chk('Kulanz: bei 125 % angehalten statt alles zu schreiben', ys < 40, true);
  chk('Kulanz: Hinweis am Ende', /⚠️ Dein 5-Stunden-Limit ist aufgebraucht, deshalb hat Coden hier angehalten/.test(g.text), true);
  chk('Kulanz: Lauf ist sauber fertig (Text bleibt)', g.status, 'done');
  chk('Danach: neue Anfrage abgelehnt', (await run('flash', 'g2')).status, 429);
  await call('/usage/reset', { email: 'anna@x.de' }, admin);

  // 7) Bilder erstellt der Server selbst (auch wenn die Seite zu ist)
  chunks = ['Hier ist dein Bild: ', '<generate_image prompt="Ein roter Hund"/>'];
  evs = events(await (await run('flash', 'img')).text());
  const x = evs.find(e => e.t === 'x');
  chk('Bild: Server meldet fertiges Bild', `${x?.x.images.length} ${x?.x.images[0].prompt}`, '1 Ein roter Hund');
  chk('Bild: Adresse zeigt auf das gespeicherte Bild', /\/api\/public\/img\/[0-9a-f]{18}$/.test(x?.x.images[0].url || ''), true);
  const ir = (await call('/runs/' + evs[0].id, null, anna)).j;
  chk('Bild: steht auch im Lauf (für später geöffnete Geräte)', ir.meta.extra.images[0].url, x?.x.images[0].url);
  chk('Bild: abrufbar', (await realFetch(x.x.images[0].url.replace(/^https?:\/\/[^/]+/, base.replace(/\/api$/, '')))).status, 200);

  // 8) Sehr lange Antwort: neue Etappe auf dem Server, nahtlos weitergeschrieben
  process.env.CODEN_CHAT_LEG_MS = '150';
  chunks = ['Teil ', 'eins ', 'ist ', 'lang', '…', '…', '…', '…']; delay = 60; calls = [];
  evs = events(await (await run('flash', 'leg')).text());
  chk('Etappe: Live-Verbindung meldet Fortsetzung', evs[evs.length - 1].t, 'cont');
  const lr = await until(evs[0].id);
  delete process.env.CODEN_CHAT_LEG_MS; delay = 0;
  chk('Etappe: fertig mit beiden Teilen', `${lr?.status} ${/^Teil eins/.test(lr?.text || '')} ${/ Teil zwei\. Ende\.$/.test(lr?.text || '')}`, 'done true true');
  chk('Etappe: zweite Etappe bekam die bisherige Antwort + Weiter-Bitte', calls.some(c => c.messages && c.messages.slice(-2)[0].role === 'assistant' && /^Teil eins/.test(c.messages.slice(-2)[0].content)), true);
  chk('Etappe: Schlüssel verbraucht', !!lr?.meta?.cont, false);
  chk('Etappe: ohne Schlüssel nicht fortsetzbar', (await call(`/runs/${evs[0].id}/continue`, { run: evs[0].id })).s, 400);
  chk('Etappe: falscher Schlüssel', (await realFetch(`${base}/runs/${evs[0].id}/continue`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coden-Leg': 'a'.repeat(48) }, body: '{}' })).status, 403);

  // 9) Push: Benachrichtigung, wenn niemand mehr zuschaut
  const sent = []; Push._setSender(async (sub, body) => { sent.push({ sub, body: JSON.parse(body) }); });
  const key = (await call('/push/key', null, anna)).j.key;
  chk('Push: öffentlicher Schlüssel', typeof key === 'string' && key.length > 60, true);
  chk('Push: gleicher Schlüssel beim zweiten Mal', (await call('/push/key', null, anna)).j.key, key);
  chk('Push: ungültiges Abo', (await call('/push/subscribe', { sub: { endpoint: 'http://x' } }, anna)).s, 400);
  const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } };
  chk('Push: Abo speichern', (await call('/push/subscribe', { sub }, anna)).j.ok, true);
  chk('Push: Test', (await call('/push/test', {}, anna)).j.sent, 1);
  sent.length = 0;
  chunks = ['Fertige ', 'Antwort ', 'für ', 'dich.']; delay = 80;
  const ac = new AbortController(); const res = await run('flash', 'p1', anna, ac.signal);
  const pid = events(new TextDecoder().decode((await res.body.getReader().read()).value))[0].id; ac.abort();
  await until(pid); await wait(200); delay = 0;
  chk('Push: kam an, als die Seite zu war', sent.length, 1);
  chk('Push: Titel + Vorschau', `${sent[0]?.body.title} | ${sent[0]?.body.body}`, 'Coden ist fertig: T | Fertige Antwort für dich.');
  sent.length = 0;
  await run('flash', 'p2').then(r => r.text()); await wait(100);
  chk('Push: nicht, wenn live zugeschaut wird', sent.length, 0);
  chk('Push: abmelden', (await call('/push/unsubscribe', { endpoint: sub.endpoint }, anna)).j.ok, true);
  chk('Push: danach keine Geräte', (await call('/push/test', {}, anna)).j.sent, 0);

  // 10) Hilfsfunktionen
  chk('until: Minuten', Usage.until(new Date(Date.now() + 42 * 60000).toISOString()), 'in 42 Min.');
  chk('until: Tage', Usage.until(new Date(Date.now() + (2 * 24 + 3) * 3600e3 + 30000).toISOString()), 'in 2 Tagen 3 Std.');
  await finish();
})();
