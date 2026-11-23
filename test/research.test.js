// Deep Research (Server), Such-Keys und geplante Aufgaben
const { setup } = require('./helpers');
(async () => {
  process.env.GROQ_API_KEY = 'test'; process.env.OPENROUTER_API_KEY = 'test'; process.env.GOOGLE_API_KEY = 'test';
  const realFetch = global.fetch; const enc = new TextEncoder();
  const seen = { brave: [], tavily: [], plans: 0, reports: [], tasks: [], reportUser: '' }; let braveOk = true, braveEmpty = false;
  const sse = (text) => new Response(new ReadableStream({ start(c) { for (const v of text.match(/[\s\S]{1,40}/g) || []) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: v } }] })}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  global.fetch = async (url, o = {}) => {
    const u = String(url); if (u.startsWith('http://127.0.0.1')) return realFetch(url, o);
    if (u.startsWith('https://api.search.brave.com/')) {
      seen.brave.push({ q: new URL(u).searchParams.get('q'), token: o.headers['X-Subscription-Token'] });
      if (!braveOk || o.headers['X-Subscription-Token'] === 'BSA-schlecht-1234') return json({}, 401);
      return json({ web: { results: braveEmpty ? [] : [{ title: 'Brave Treffer', url: 'https://brave-treffer.de/a', description: 'Beschreibung <b>eins</b>' }, { title: 'Zweiter', url: 'https://zweiter.org/b', description: 'zwei' }] } });
    }
    if (u.startsWith('https://api.tavily.com/')) { seen.tavily.push(JSON.parse(o.body).query); return json({ results: [{ title: 'Tavily Treffer', url: 'https://tavily-treffer.com/x', content: 'Inhalt' }] }); }
    const body = JSON.parse(o.body || '{}'); const sys = body.messages?.[0]?.content || '';
    if (/Du planst eine Web-Recherche/.test(sys)) { seen.plans++; return json({ choices: [{ message: { content: '{"queries":["erste suche","zweite suche"]}' } }] }); }
    if (/schreibst einen Recherche-Bericht/.test(sys)) { seen.reports.push(body.messages[1].content); return sse('## Ergebnis\n\nEs gibt Neuigkeiten [1], die sich bestätigen [2]. Erfunden ist [9].'); }
    if (/geplante Aufgabe/.test(sys)) { seen.tasks.push(body.messages[1].content); return body.stream ? sse('Erledigt: ' + body.messages[1].content) : json({ choices: [{ message: { content: 'Erledigt: ' + body.messages[1].content } }] }); }
    return body.stream ? sse('?') : json({ choices: [{ message: { content: '?' } }] });
  };
  const { call, chk, finish, token, base, db } = await setup();
  // Gratis-Suche und Seiten-Lesen nachbilden (laufen nicht über fetch)
  const Tools = require('../server/agent-tools'); let ddgCalls = 0;
  Tools.ddgResults = async (q) => { ddgCalls++; return [{ title: 'DDG ' + q, url: 'https://ddg-treffer.de/' + encodeURIComponent(q), snippet: 'ddg' }]; };
  Tools.fetchUrl = async (url) => (/faulenzer/.test(url) ? { ok: false, text: 'Fehler' } : { ok: true, text: `Inhalt von ${url} – Seite:\nSeitentext von ${url}` });
  const Push = require('../server/push'); const pushes = []; Push._setSender(async (sub, body) => { pushes.push(JSON.parse(body)); });

  const anna = await token({ sub: 'uid-anna', email: 'anna@x.de', email_verified: true });
  const ben = await token({ sub: 'uid-ben', email: 'ben@x.de', email_verified: true });
  const P = (p, b, t) => call(p, b, t, 'POST'), G = (p, t) => call(p, null, t), D = (p, t) => call(p, null, t, 'DELETE'), U = (p, b, t) => call(p, b, t, 'PUT');
  const events = (txt) => txt.split('\n\n').filter(x => x.startsWith('data: ')).map(x => JSON.parse(x.slice(6)));
  const research = async (tok, question, extra = {}) => {
    const r = await realFetch(base + '/runs/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ tier: 'pro', ref: 'r' + Math.random(), research: true, messages: [{ role: 'user', content: question }], meta: { title: 'T', userText: question }, ...extra }) });
    const evs = r.status === 200 ? events(await r.text()) : []; return { s: r.status, evs, j: r.status !== 200 ? await r.json() : null };
  };
  const finalText = (evs) => { let t = ''; for (const e of evs) { if (e.t === 'd') t += e.v; else if (e.t === 'r') t = e.v; } return t; };

  // ---------- Such-Keys ----------
  chk('Keys: ohne Login nicht erreichbar', (await G('/research')).s, 401);
  const o0 = (await G('/research', anna)).j;
  chk('Keys: ohne Key läuft die Gratis-Suche', [o0.engine, o0.providers.map(p => p.id)], ['ddg', ['brave', 'tavily']]);
  chk('Keys: zu kurz abgelehnt', (await U('/research/keys/brave', { key: 'x' }, anna)).s, 400);
  chk('Keys: unbekannter Anbieter', (await U('/research/keys/google', { key: 'BSA-12345678' }, anna)).s, 400);
  const bad = await U('/research/keys/brave', { key: 'BSA-schlecht-1234' }, anna);
  chk('Keys: abgelehnter Key wird nicht gespeichert', [bad.s, /lehnt diesen Key ab/.test(bad.j.error), (await G('/research', anna)).j.engine], [400, true, 'ddg']);
  const good = await U('/research/keys/brave', { key: 'BSA-gut-abcd1234' }, anna);
  chk('Keys: guter Key gespeichert, nur Hinweis sichtbar', [good.s, good.j.engine, good.j.providers.find(p => p.id === 'brave').hint, JSON.stringify(good.j).includes('abcd1234')], [200, 'brave', '…1234', false]);
  chk('Keys: gehört nur Anna', (await G('/research', ben)).j.engine, 'ddg');
  const stored = (await db.query("SELECT key_enc FROM user_provider_keys WHERE uid = 'uid-anna' AND provider = 'brave'")).rows[0].key_enc;
  chk('Keys: verschlüsselt in der Datenbank', stored.includes('BSA-gut'), false);

  // ---------- Deep Research mit Brave-Key ----------
  const r1 = await research(anna, 'Was gibt es Neues zu Solarstrom?');
  const t1 = finalText(r1.evs);
  chk('Recherche: läuft durch', [r1.s, r1.evs[r1.evs.length - 1].t], [200, 'done']);
  const searches = seen.brave.filter(b => b.q !== 'Test'); // „Test“ = Prüfung beim Speichern des Keys
  chk('Recherche: Plan + beide Suchen über Brave mit Token', [seen.plans, searches.map(b => b.token).every(t => t === 'BSA-gut-abcd1234'), searches.map(b => b.q).sort()], [1, true, ['Was gibt es Neues zu Solarstrom?', 'erste suche', 'zweite suche']]);
  const steps = (await G('/runs/' + r1.evs[0].id, anna)).j.think.steps || [];
  chk('Recherche: Denk-Schritte sichtbar (Planen, Suchen, Lesen, Schreiben)', ['Plane die Recherche …', 'Suche im Web …'].every(h => steps.includes(h)) && steps.some(h => /^Lese Quellen/.test(h)) && r1.evs.some(e => e.t === 'k' && e.h === 'Schreibe den Bericht …'), true);
  chk('Recherche: Bericht bekommt nummerierte Quellen mit Seitentext', /\[1\] Brave Treffer[\s\S]*Seitentext von https:\/\/brave-treffer\.de\/a/.test(seen.reports[0]), true);
  chk('Recherche: Beschreibung ohne HTML', /Beschreibung eins/.test(seen.reports[0]) === false && !/<b>/.test(seen.reports[0]), true);
  chk('Recherche: erfundene Nummer [9] entfernt', /\[9\]/.test(t1), false);
  chk('Recherche: Quellenliste vom Server angehängt', /\*\*Quellen\*\*\n\n1\. \[Brave Treffer\]\(https:\/\/brave-treffer\.de\/a\)/.test(t1), true);
  chk('Recherche: Text bleibt gespeichert', (await G('/runs/' + r1.evs[0].id, anna)).j.text, t1);
  chk('Recherche: Meta-Markierung', (await G('/runs/' + r1.evs[0].id, anna)).j.meta.research, true);

  // Brave fällt aus -> Gratis-Suche, mit Hinweis
  braveOk = false; const before = ddgCalls;
  const r2 = await research(anna, 'Noch eine Frage zum Wetter');
  chk('Fallback: Brave kaputt → Gratis-Suche', [ddgCalls > before, r2.evs.some(e => e.t === 'k' && e.h === 'Hinweis zur Suche' && /Key abgelehnt/.test(e.v)), /\*\*Quellen\*\*/.test(finalText(r2.evs))], [true, true, true]);
  braveOk = true;

  // Gar nichts gefunden
  braveEmpty = true; Tools.ddgResults = async () => [];
  const r3 = await research(anna, 'Eine Frage ohne Treffer');
  chk('Keine Treffer: ehrliche Antwort statt Erfindung', [/nichts zu \*\*Eine Frage ohne Treffer\*\* finden/.test(finalText(r3.evs)), r3.evs[r3.evs.length - 1].t], [true, 'done']);
  braveEmpty = false; Tools.ddgResults = async (q) => [{ title: 'DDG ' + q, url: 'https://ddg-treffer.de/' + encodeURIComponent(q), snippet: 'ddg' }];

  // Ohne Key, Tavily als zweite Wahl
  await P('/x', null, anna).catch(() => {});
  await D('/research/keys/brave', anna);
  chk('Keys: gelöscht → wieder Gratis', (await G('/research', anna)).j.engine, 'ddg');
  await U('/research/keys/tavily', { key: 'tvly-abcdefgh' }, anna);
  const r4 = await research(anna, 'Frage per Tavily'); await finalText(r4.evs);
  chk('Tavily: wird benutzt', seen.tavily.includes('Frage per Tavily'), true);
  await D('/research/keys/tavily', anna);

  // Leere/zu kurze Frage
  const r5 = await research(anna, '  ');
  chk('Leere Frage: Fehler statt Lauf', r5.s === 400 || r5.evs.some(e => e.t === 'e'), true);
  // Recherche-Tiefe wird übernommen (schnell = weniger Seiten)
  const lines0 = seen.reports.length; await research(anna, 'Kurze Frage', { depth: 'quick' });
  chk('Tiefe schnell: höchstens 3 Seiten gelesen', (seen.reports[lines0].match(/Auszug:/g) || []).length <= 3, true);

  // ---------- Aufgaben ----------
  chk('Aufgaben: ohne Login nicht erreichbar', (await G('/tasks')).s, 401);
  chk('Aufgaben: anfangs leer', (await G('/tasks', anna)).j, { tasks: [], unseen: 0, limits: { tasks: 10, research: 3, title: 60, prompt: 2000, results: 100, resultChars: 60000 }, cron: false });
  chk('Aufgaben: zu kurzer Text abgelehnt', (await P('/tasks', { prompt: 'hi', schedule: { kind: 'daily', time: '07:00' } }, anna)).s, 400);
  chk('Aufgaben: Zeitplan ohne Uhrzeit abgelehnt', (await P('/tasks', { prompt: 'Fasse die Nachrichten zusammen', schedule: { kind: 'daily' } }, anna)).s, 400);
  const mk = await P('/tasks', { title: 'Morgens', prompt: 'Fasse die Nachrichten zusammen', schedule: { kind: 'daily', time: '07:00' }, tier: 'pro', tz: 'Europe/Berlin' }, anna);
  const T1 = mk.j.task;
  chk('Aufgaben: angelegt mit nächstem Termin', [mk.s, T1.title, T1.when, !!T1.next && new Date(T1.next) > new Date(), T1.enabled], [200, 'Morgens', 'Täglich um 07:00 Uhr', true, true]);
  chk('Aufgaben: Ben sieht sie nicht', [(await G('/tasks', ben)).j.tasks.length, (await U('/tasks/' + T1.id, { enabled: false }, ben)).s, (await D('/tasks/' + T1.id, ben)).s], [0, 404, 404]);
  chk('Aufgaben: fremdes eigenes Modell abgelehnt', (await P('/tasks', { prompt: 'Fasse die Nachrichten zusammen', schedule: { kind: 'daily', time: '07:00' }, tier: 'byok:999' }, anna)).s, 400);
  chk('Aufgaben: Ultra wird zu Flash', (await P('/tasks', { prompt: 'Eine zweite Aufgabe hier', schedule: { kind: 'weekly', time: '18:30', days: [5] }, tier: 'ultra' }, anna)).j.task.tier, 'flash');

  // jetzt ausführen
  const run = await P(`/tasks/${T1.id}/run`, null, anna);
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 60)); } };
  const res1 = await waitFor(async () => { const l = (await G('/tasks/results', anna)).j.results; return l.length ? l : null; });
  chk('Jetzt ausführen: 202 und Ergebnis da', [run.s, res1 && res1[0].title, res1 && res1[0].ok, res1 && res1[0].seen], [202, 'Morgens', true, false]);
  const full1 = (await G('/tasks/results/' + res1[0].id, anna)).j;
  chk('Ergebnis: Text vom Modell, danach gelesen', [full1.text, (await G('/tasks', anna)).j.unseen], ['Erledigt: Fasse die Nachrichten zusammen', 0]);
  chk('Ergebnis: Push kam an', pushes.length === 0, true); // noch kein Abo -> kein Versand

  // Push-Abo, dann fällige Aufgabe über tick
  await P('/push/subscribe', { sub: { endpoint: 'https://push.example/abc', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } } }, anna);
  await db.query("UPDATE scheduled_tasks SET next_run = now() - interval '1 minute' WHERE id = $1", [T1.id]);
  const tk = await P('/tasks/tick', null, anna);
  chk('Tick: eine fällige Aufgabe gestartet', tk.j.started, 1);
  chk('Tick: zweiter Aufruf startet nichts doppelt', (await P('/tasks/tick', null, anna)).j.started, 0);
  const res2 = await waitFor(async () => { const l = (await G('/tasks/results', anna)).j.results; return l.length >= 2 ? l : null; });
  chk('Tick: zweites Ergebnis, ungelesen', [res2.length, res2[0].seen, (await G('/tasks', anna)).j.unseen], [2, false, 1]);
  chk('Tick: Push „Aufgabe erledigt“', await waitFor(async () => pushes.some(p => /Aufgabe erledigt: Morgens/.test(p.title))), true);
  const after = (await G('/tasks', anna)).j.tasks.find(t => t.id === T1.id);
  chk('Tick: nächster Termin liegt wieder in der Zukunft', [new Date(after.next) > new Date(), after.lastStatus], [true, 'ok']);
  chk('Tick: Ben bekommt Annas Aufgaben nie', (await P('/tasks/tick', null, ben)).j.started, 0);

  // einmalig: läuft einmal und schaltet sich ab
  const once = (await P('/tasks', { title: 'Einmal', prompt: 'Sag einmal kurz Hallo', schedule: { kind: 'once', at: new Date(Date.now() + 3600e3).toISOString() } }, anna)).j.task;
  await db.query("UPDATE scheduled_tasks SET next_run = now() - interval '1 minute', schedule = jsonb_build_object('kind', 'once', 'at', $2::text) WHERE id = $1", [once.id, new Date(Date.now() - 60000).toISOString()]);
  await P('/tasks/tick', null, anna);
  await waitFor(async () => (await G('/tasks/results', anna)).j.results.some(r => r.title === 'Einmal'));
  const onceAfter = (await G('/tasks', anna)).j.tasks.find(t => t.id === once.id);
  chk('Einmalig: danach aus, kein neuer Termin', [onceAfter.enabled, onceAfter.next], [false, null]);
  chk('Einmalig: vorbei → nicht wieder einschaltbar', (await U('/tasks/' + once.id, { enabled: true }, anna)).s, 400);

  // an/aus und bearbeiten
  const off = await U('/tasks/' + T1.id, { enabled: false }, anna);
  chk('Ausschalten', [off.j.task.enabled], [false]);
  await db.query("UPDATE scheduled_tasks SET next_run = now() - interval '1 minute' WHERE id = $1", [T1.id]);
  chk('Ausgeschaltete laufen nie', (await P('/tasks/tick', null, anna)).j.started, 0);
  const on = await U('/tasks/' + T1.id, { enabled: true }, anna);
  chk('Einschalten: neuer Termin in der Zukunft', new Date(on.j.task.next) > new Date(), true);
  const ed = await U('/tasks/' + T1.id, { title: 'Abends', prompt: 'Fasse den Tag in drei Sätzen zusammen', schedule: { kind: 'weekly', time: '21:00', days: [1, 2, 3, 4, 5] }, tz: 'Europe/Berlin', tier: 'flash' }, anna);
  chk('Bearbeiten', [ed.j.task.title, ed.j.task.when, ed.j.task.tier], ['Abends', 'Werktags um 21:00 Uhr', 'flash']);

  // Recherche-Aufgabe: Limit 3
  const rsk = (n) => P('/tasks', { title: 'R' + n, prompt: 'Recherchiere Neues zu KI-Chips', schedule: { kind: 'daily', time: '06:00' }, research: true, depth: 'quick' }, anna);
  for (let i = 0; i < 3; i++) await rsk(i);
  const fourth = await rsk(4);
  chk('Recherche-Aufgaben: höchstens 3', [fourth.s, /höchstens 3 Aufgaben mit Recherche/.test(fourth.j.error)], [400, true]);
  const rid = (await G('/tasks', anna)).j.tasks.find(t => t.title === 'R0').id;
  await P(`/tasks/${rid}/run`, null, anna);
  const rres = await waitFor(async () => (await G('/tasks/results', anna)).j.results.find(r => r.title === 'R0'));
  const rfull = (await G('/tasks/results/' + rres.id, anna)).j;
  chk('Recherche-Aufgabe: Bericht mit Quellen im Ergebnis', [rres.ok, /\*\*Quellen\*\*/.test(rfull.text)], [true, true]);

  // Obergrenze 10 Aufgaben
  const have = (await G('/tasks', anna)).j.tasks.length;
  for (let i = have; i < 10; i++) await P('/tasks', { prompt: 'Fülle die Liste auf ' + i, schedule: { kind: 'daily', time: '05:00' } }, anna);
  chk('Aufgaben: höchstens 10', (await P('/tasks', { prompt: 'Eine zu viel hier', schedule: { kind: 'daily', time: '05:00' } }, anna)).s, 400);

  // Ergebnisse verwalten
  await P('/tasks/results-seen', null, anna);
  chk('Ergebnisse: alle als gelesen markieren', (await G('/tasks', anna)).j.unseen, 0);
  chk('Ergebnisse: fremde nicht lesbar/löschbar', [(await G('/tasks/results/' + res1[0].id, ben)).s, (await D('/tasks/results/' + res1[0].id, ben)).s, (await G('/tasks/results/' + res1[0].id, anna)).s], [404, 200, 200]);
  await D('/tasks/results/' + res1[0].id, anna);
  chk('Ergebnisse: löschen', (await G('/tasks/results/' + res1[0].id, anna)).s, 404);
  const gone = await D('/tasks/' + T1.id, anna);
  chk('Aufgabe löschen: Ergebnisse bleiben', [gone.s, (await G('/tasks/results', anna)).j.results.some(r => r.taskId === T1.id)], [200, true]);

  // Limit erreicht: keine KI-Aufrufe, Ergebnis erklärt es
  await db.query("INSERT INTO usage_limits (uid, s_start, s_tokens, w_start, w_tokens) VALUES ('uid-ben', now(), 999999999, now(), 999999999) ON CONFLICT (uid) DO NOTHING");
  const bt = (await P('/tasks', { title: 'Limit', prompt: 'Das darf nicht laufen', schedule: { kind: 'daily', time: '06:00' }, tier: 'pro' }, ben)).j.task;
  const callsBefore = seen.tasks.length; await P(`/tasks/${bt.id}/run`, null, ben);
  const lim = await waitFor(async () => (await G('/tasks/results', ben)).j.results[0]);
  chk('Limit: Aufgabe läuft nicht, Ergebnis erklärt warum', [lim.ok, /limit/i.test(lim.preview), seen.tasks.length], [false, true, callsBefore]);

  // ---------- Cron-Eingang ----------
  delete process.env.CRON_SECRET;
  chk('Cron: ohne CRON_SECRET nicht eingerichtet', (await realFetch(base + '/cron/tasks')).status, 503);
  process.env.CRON_SECRET = 'geheim-geheim-geheim';
  chk('Cron: falsches Geheimnis', (await realFetch(base + '/cron/tasks', { headers: { Authorization: 'Bearer falsch' } })).status, 401);
  chk('Cron: ohne Geheimnis', (await realFetch(base + '/cron/tasks')).status, 401);
  await db.query("UPDATE scheduled_tasks SET next_run = now() - interval '1 minute' WHERE uid = 'uid-anna' AND id = (SELECT id FROM scheduled_tasks WHERE uid = 'uid-anna' ORDER BY id LIMIT 1)");
  await db.query("UPDATE scheduled_tasks SET next_run = now() - interval '1 minute' WHERE id = $1", [bt.id]);
  const cr = await realFetch(base + '/cron/tasks', { headers: { Authorization: 'Bearer geheim-geheim-geheim' } });
  chk('Cron: mit Geheimnis (Bearer) läuft für alle Nutzer', [cr.status, (await cr.json()).ran], [200, 2]);
  await db.query("UPDATE scheduled_tasks SET next_run = now() - interval '1 minute' WHERE id = $1", [bt.id]);
  const cr2 = await realFetch(base + '/cron/tasks?key=geheim-geheim-geheim', { method: 'POST' });
  chk('Cron: Geheimnis auch als ?key= (für Pinger)', [cr2.status, (await cr2.json()).ran], [200, 1]);

  await finish();
})();
