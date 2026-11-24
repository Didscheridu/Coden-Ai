// Datenbank nicht erreichbar (z. B. Firestore-Tageskontingent aufgebraucht): Chat läuft trotzdem,
// Systemzustand wird zwischengespeichert, alte Läufe werden aufgeräumt.
const { setup } = require('./helpers');
(async () => {
  process.env.GROQ_API_KEY = 'test'; process.env.OPENROUTER_API_KEY = 'test'; process.env.GOOGLE_API_KEY = 'test';
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, opts);
    const enc = new TextEncoder();
    const body = new ReadableStream({ start(c) { for (const v of ['Läuft ', 'auch ', 'ohne DB']) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: v } }] })}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const { db, call, chk, finish, token, base } = await setup();
  const anna = await token({ sub: 'uid-anna', email: 'anna@x.de', email_verified: true });
  const events = (txt) => txt.split('\n\n').filter(x => x.startsWith('data: ')).map(x => JSON.parse(x.slice(6)));

  // Lesezugriffe auf den Systemzustand zählen
  let sysReads = 0; const getDoc0 = db.getDoc;
  db.getDoc = (p, ...a) => { if (p === 'system_state/global') sysReads++; return getDoc0(p, ...a); };
  for (let i = 0; i < 5; i++) await call('/system/state', null, anna);
  chk('Systemzustand: 5 Abfragen, höchstens 1 Lesezugriff', sysReads <= 1, true);

  // Kontingent aufgebraucht: Läufe können nicht angelegt werden
  const quota = () => Promise.reject(Object.assign(new Error('Quota exceeded: Free daily read units per project'), { status: 429 }));
  const createDoc0 = db.createDoc; const updateDoc0 = db.updateDoc;
  db.createDoc = (p, ...a) => (String(p).startsWith('ai_runs/') ? quota() : createDoc0(p, ...a));
  db.updateDoc = (p, ...a) => (String(p).startsWith('ai_runs/') ? quota() : updateDoc0(p, ...a));
  const r = await realFetch(base + '/runs/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anna }, body: JSON.stringify({ tier: 'pro', ref: 'x1', messages: [{ role: 'user', content: 'Hi' }], meta: { title: 'T', userText: 'Hi' } }) });
  const ev = events(await r.text());
  chk('Chat ohne Datenbank: Status', r.status, 200);
  chk('Chat ohne Datenbank: Antwort kommt an', ev.filter(e => e.t === 'd').map(e => e.v).join(''), 'Läuft auch ohne DB');
  chk('Chat ohne Datenbank: sauber beendet', ev.some(e => e.t === 'done'), true);
  db.createDoc = createDoc0; db.updateDoc = updateDoc0;

  // Aufräumen: abgeholte, fertige Läufe älter als 15 Minuten verschwinden beim Abfragen
  const old = new Date(Date.now() - 3600_000).toISOString();
  await db.createDoc('ai_runs/9001', { id: 9001, uid: 'uid-anna', kind: 'chat', ref: 'a', status: 'done', claimed: true, text: 'alt', created_at: old, updated_at: old });
  await db.createDoc('ai_runs/9002', { id: 9002, uid: 'uid-anna', kind: 'chat', ref: 'b', status: 'done', claimed: false, text: 'offen', created_at: old, updated_at: old });
  const list = await call('/runs?kind=chat', null, anna);
  await new Promise(res => setTimeout(res, 100));
  chk('Nicht abgeholter Lauf wird noch angeboten', list.j.runs.map(x => x.id).includes(9002), true);
  chk('Abgeholter alter Lauf gelöscht', await db.getDoc('ai_runs/9001'), null);
  chk('Nicht abgeholter Lauf bleibt', !!(await db.getDoc('ai_runs/9002')), true);
  await finish();
})();
