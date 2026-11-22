// Code-Buddy-Server: Rollen, Einladungen, Kanäle, Nachrichten und geteilte Apps (Ansehen vs. Bearbeiten)
const { setup } = require('./helpers');
(async () => {
  const { call, chk, finish, token } = await setup();
  const mk = async (n) => ({ n, t: await token({ sub: 'uid-' + n, email: n + '@x.de', email_verified: true }) });
  const [O, E, V, X] = await Promise.all(['owner', 'editr', 'viewr', 'xtern'].map(mk));
  const P = (p, b, t) => call(p, b, t, 'POST'), PA = (p, b, t) => call(p, b, t, 'PATCH'), PU = (p, b, t) => call(p, b, t, 'PUT'), D = (p, t) => call(p, null, t, 'DELETE');
  for (const u of [O, E, V, X]) chk('Profil ' + u.n, (await PU('/buddy/me', { handle: u.n + '_h', displayName: u.n }, u.t)).s, 200);
  const hO = 'owner_h', hE = 'editr_h', hV = 'viewr_h';

  // ohne Profil / Login
  chk('ohne Login', (await call('/servers')).s, 401);
  const Z = await token({ sub: 'uid-noprofil', email: 'z@x.de', email_verified: true });
  chk('ohne Profil', (await call('/servers', null, Z)).s, 409);

  // Server anlegen
  chk('Name nötig', (await P('/servers', { name: ' ' }, O.t)).s, 400);
  const c = await P('/servers', { name: 'Lerngruppe', color: '#ff0000' }, O.t);
  chk('anlegen', [c.s, c.j.server.role, c.j.server.color], [200, 'owner', '#ff0000']);
  const sid = c.j.server.id;
  const det = await call('/servers/' + sid, null, O.t);
  chk('Standardkanal + Einladungscode für Besitzer', [det.j.channels.map(x => x.name), /^[a-z0-9]{10}$/.test(det.j.server.inviteCode), det.j.members.length], [['allgemein'], true, 1]);
  chk('Fremde sehen den Server nicht', [(await call('/servers/' + sid, null, X.t)).s, (await call('/servers', null, X.t)).j.servers.length], [404, 0]);

  // Beitritt
  chk('falscher Code', (await P('/servers/join', { code: 'abcdefghij' }, X.t)).s, 404);
  chk('Code ungültig', (await P('/servers/join', { code: "x'; drop" }, X.t)).s, 404);
  const code = det.j.server.inviteCode;
  const jv = await P('/servers/join', { code }, V.t);
  chk('Beitritt als Zuschauer', [jv.s, jv.j.server.role], [200, 'viewer']);
  chk('doppelter Beitritt', (await P('/servers/join', { code }, V.t)).j.already, true);
  const dv = await call('/servers/' + sid, null, V.t);
  chk('Zuschauer sieht keinen Einladungscode', dv.j.server.inviteCode, undefined);

  // Freund direkt hinzufügen: nur Freunde
  chk('Nicht-Freund hinzufügen', (await P(`/servers/${sid}/members`, { handle: hE }, O.t)).s, 403);
  await P('/buddy/requests', { handle: hE }, O.t); await P(`/buddy/requests/${hO}/accept`, null, E.t);
  const ad = await P(`/servers/${sid}/members`, { handle: hE, role: 'editor' }, O.t);
  chk('Freund als Bearbeiter', ad.j.members.find(m => m.handle === hE).role, 'editor');
  chk('Zuschauer kann niemanden hinzufügen', (await P(`/servers/${sid}/members`, { handle: hE }, V.t)).s, 403);

  // Rollen ändern
  chk('Zuschauer ändert keine Rollen', (await PA(`/servers/${sid}/members/${hE}`, { role: 'viewer' }, V.t)).s, 403);
  chk('Bearbeiter ändert keine Rollen', (await PA(`/servers/${sid}/members/${hV}`, { role: 'editor' }, E.t)).s, 403);
  chk('Besitzerrolle fix', (await PA(`/servers/${sid}/members/${hO}`, { role: 'viewer' }, O.t)).s, 400);
  chk('ungültige Rolle', (await PA(`/servers/${sid}/members/${hV}`, { role: 'owner' }, O.t)).s, 400);

  // Kanäle
  chk('Zuschauer legt keinen Kanal an', (await P(`/servers/${sid}/channels`, { name: 'x' }, V.t)).s, 403);
  const ch = await P(`/servers/${sid}/channels`, { name: 'Hausaufgaben Mathe!' }, E.t);
  chk('Bearbeiter legt Kanal an (Name bereinigt)', [ch.s, ch.j.channel.name], [200, 'hausaufgaben-mathe']);
  chk('Kanal doppelt', (await P(`/servers/${sid}/channels`, { name: 'hausaufgaben mathe' }, E.t)).s, 409);
  chk('Bearbeiter löscht keinen Kanal', (await D(`/servers/${sid}/channels/${ch.j.channel.id}`, E.t)).s, 403);
  const general = det.j.channels[0].id, cid = ch.j.channel.id;

  // Nachrichten (Zuschauer dürfen schreiben)
  const m1 = await P(`/servers/${sid}/channels/${general}/messages`, { body: 'Hallo zusammen' }, V.t);
  chk('Zuschauer schreibt', [m1.s, m1.j.message.handle], [200, hV]);
  chk('leere Nachricht', (await P(`/servers/${sid}/channels/${general}/messages`, { body: '  ' }, V.t)).s, 400);
  chk('zu lange Nachricht', (await P(`/servers/${sid}/channels/${general}/messages`, { body: 'x'.repeat(2001) }, V.t)).s, 400);
  chk('Fremde schreiben nicht', (await P(`/servers/${sid}/channels/${general}/messages`, { body: 'hi' }, X.t)).s, 404);
  chk('Fremde lesen nicht', (await call(`/servers/${sid}/channels/${general}/messages`, null, X.t)).s, 404);
  const rd = await call(`/servers/${sid}/channels/${general}/messages`, null, O.t);
  chk('Besitzer liest', [rd.j.messages.length, rd.j.messages[0].body, rd.j.messages[0].mine], [1, 'Hallo zusammen', false]);
  chk('Kanal gehört zu anderem Server → 404', (await call(`/servers/${sid}/channels/999999/messages`, null, O.t)).s, 404);
  await P(`/servers/${sid}/channels/${general}/messages`, { body: 'zweite' }, O.t);
  chk('after-Parameter', (await call(`/servers/${sid}/channels/${general}/messages?after=${rd.j.messages[0].id}`, null, V.t)).j.messages.map(m => m.body), ['zweite']);

  // Apps teilen
  const app = await P('/apps', { name: 'Quiz', kind: 'web', style: '', files: { 'index.html': '<h1>Quiz</h1>' } }, O.t);
  const aid = app.j.app.id;
  chk('vor dem Teilen: Zuschauer sieht App nicht', (await call('/apps/' + aid, null, V.t)).s, 404);
  chk('Zuschauer kann nicht teilen', (await P(`/servers/${sid}/apps`, { appId: aid }, V.t)).s, 403);
  const eApp = await P('/apps', { name: 'Fremde', kind: 'web', style: '', files: { 'index.html': 'x' } }, E.t);
  chk('fremde App nicht teilbar (nicht Besitzer)', (await P(`/servers/${sid}/apps`, { appId: eApp.j.app.id }, O.t)).s, 403);
  chk('Bearbeiter teilt keine App, die ihm nicht gehört', (await P(`/servers/${sid}/apps`, { appId: aid }, E.t)).s, 403);
  chk('Besitzer teilt', (await P(`/servers/${sid}/apps`, { appId: aid }, O.t)).s, 200);
  chk('doppelt teilen', (await P(`/servers/${sid}/apps`, { appId: aid }, O.t)).s, 409);
  chk('Server zeigt geteilte App', (await call('/servers/' + sid, null, V.t)).j.apps.map(a => a.name), ['Quiz']);

  const vv = await call('/apps/' + aid, null, V.t);
  chk('Zuschauer sieht App + Dateien', [vv.s, vv.j.app.role, vv.j.files['index.html']], [200, 'viewer', '<h1>Quiz</h1>']);
  chk('Zuschauer: Dateien ändern verboten', (await PU(`/apps/${aid}/files`, { set: { 'index.html': 'hack' } }, V.t)).s, 403);
  chk('Zuschauer: App ändern verboten', (await PA('/apps/' + aid, { name: 'Hack' }, V.t)).s, 403);
  chk('Zuschauer: Chat mit Coden verboten', (await P(`/apps/${aid}/messages`, { role: 'user', body: 'mach was' }, V.t)).s, 403);
  chk('Zuschauer: Bild verboten', (await P(`/apps/${aid}/images`, { prompt: 'ein Hund' }, V.t)).s, 403);
  chk('Zuschauer: löschen verboten', (await D('/apps/' + aid, V.t)).s, 403);
  chk('Zuschauer: veröffentlichen verboten', (await P(`/apps/${aid}/publish`, { slug: 'quiz-xx' }, V.t)).s, 403);
  chk('Zuschauer: Verlauf lesen erlaubt', (await call(`/apps/${aid}/messages`, null, V.t)).s, 200);
  chk('Datei blieb unverändert', (await call('/apps/' + aid, null, O.t)).j.files['index.html'], '<h1>Quiz</h1>');
  const ev = await PU(`/apps/${aid}/files`, { set: { 'index.html': '<h1>Neu</h1>' } }, E.t);
  chk('Bearbeiter darf Dateien ändern', ev.s, 200);
  chk('Bearbeiter darf nicht löschen/veröffentlichen', [(await D('/apps/' + aid, E.t)).s, (await P(`/apps/${aid}/publish`, { slug: 'quiz-yy' }, E.t)).s], [403, 403]);
  chk('Fremde sehen die App nicht', (await call('/apps/' + aid, null, X.t)).s, 404);
  const lv = await call('/apps', null, V.t);
  chk('App-Liste enthält geteilte App mit Rolle', lv.j.apps.map(a => [a.name, a.role]), [['Quiz', 'viewer']]);

  // Rolle hochstufen → App-Rechte folgen sofort
  chk('Zuschauer zum Bearbeiter', (await PA(`/servers/${sid}/members/${hV}`, { role: 'editor' }, O.t)).s, 200);
  chk('jetzt darf er ändern', (await PU(`/apps/${aid}/files`, { set: { 'b.txt': 'ok' } }, V.t)).s, 200);
  await PA(`/servers/${sid}/members/${hV}`, { role: 'viewer' }, O.t);
  chk('zurückgestuft → wieder gesperrt', (await PU(`/apps/${aid}/files`, { set: { 'c.txt': 'no' } }, V.t)).s, 403);

  // Teilen aufheben / verlassen / entfernen / löschen
  chk('Zuschauer hebt Teilen nicht auf', (await D(`/servers/${sid}/apps/${aid}`, V.t)).s, 403);
  chk('Besitzer hebt Teilen auf', (await D(`/servers/${sid}/apps/${aid}`, O.t)).s, 200);
  chk('danach kein Zugriff mehr', (await call('/apps/' + aid, null, V.t)).s, 404);
  chk('Zuschauer entfernt niemand', (await D(`/servers/${sid}/members/${hE}`, V.t)).s, 403);
  chk('Besitzer kann nicht gehen', (await D(`/servers/${sid}/members/${hO}`, O.t)).s, 400);
  chk('Zuschauer verlässt Server', (await D(`/servers/${sid}/members/${hV}`, V.t)).s, 200);
  chk('verlassen → kein Zugriff', (await call('/servers/' + sid, null, V.t)).s, 404);
  chk('Besitzer entfernt Bearbeiter', (await D(`/servers/${sid}/members/${hE}`, O.t)).s, 200);
  chk('Einladungscode erneuern', (await P(`/servers/${sid}/invite/reset`, null, O.t)).j.inviteCode !== code, true);
  chk('alter Code ungültig', (await P('/servers/join', { code }, X.t)).s, 404);
  chk('Nur Besitzer löscht Server', [(await D('/servers/' + sid, E.t)).s, (await D('/servers/' + sid, O.t)).s], [404, 200]);
  chk('Server weg', (await call('/servers/' + sid, null, O.t)).s, 404);

  // ===== @coden in Kanälen und Direktnachrichten =====
  const realFetch = global.fetch; let aiCalls = 0, aiFail = false, lastPrompt = '';
  Object.assign(process.env, { GROQ_API_KEY: 'x' });
  global.fetch = async (url, o) => {
    if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, o);
    aiCalls++; lastPrompt = o?.body || '';
    if (aiFail) return new Response(JSON.stringify({ error: { message: 'down' } }), { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Hallo vom Test-Coden' } }] }), { status: 200 });
  };
  const s2 = (await P('/servers', { name: 'Codeclub' }, O.t)).j.server.id;
  const gen2 = (await call('/servers/' + s2, null, O.t)).j.channels[0].id;
  await P(`/servers/${s2}/members`, { handle: hE, role: 'viewer' }, O.t);
  chk('Kanal: ohne @coden keine KI', [(await P(`/servers/${s2}/channels/${gen2}/messages`, { body: 'nur Menschen hier' }, O.t)).j.reply, aiCalls], [undefined, 0]);
  chk('Kanal: E-Mail-Adresse oder @codenxyz löst Coden nicht aus', [(await P(`/servers/${s2}/channels/${gen2}/messages`, { body: 'mail an a@coden.de und @codenfan' }, O.t)).j.reply, aiCalls], [undefined, 0]);
  const cm = await P(`/servers/${s2}/channels/${gen2}/messages`, { body: '@coden was ist eine Schleife?' }, E.t);
  chk('Kanal: @coden → Coden antwortet', [cm.j.reply?.body, cm.j.reply?.ai, cm.j.reply?.handle, aiCalls], ['Hallo vom Test-Coden', true, 'coden', 1]);
  chk('Kanal: Prompt trennt Chat als Daten', /CHAT_START/.test(lastPrompt) && /was ist eine Schleife/.test(lastPrompt), true);
  const seen = await call(`/servers/${s2}/channels/${gen2}/messages`, null, O.t);
  chk('Kanal: alle sehen Codens Antwort', seen.j.messages.filter(m => m.ai).map(m => m.displayName + ':' + m.body), ['Coden:Hallo vom Test-Coden']);
  aiFail = true; const cf = await P(`/servers/${s2}/channels/${gen2}/messages`, { body: '@coden hilf' }, E.t);
  chk('Kanal: KI-Fehler → Nachricht bleibt, Hinweis kommt', [cf.s, !!cf.j.message, !!cf.j.codenError, cf.j.reply], [200, true, true, undefined]);
  aiFail = false;
  let lim; for (let i = 0; i < 12; i++) { lim = await P(`/servers/${s2}/channels/${gen2}/messages`, { body: '@coden nochmal ' + i }, E.t); if (lim.j.codenError && !/überlastet/.test(lim.j.codenError)) break; }
  chk('Kanal: höchstens 10 Fragen pro 10 Minuten', /Pause/.test(lim.j.codenError || ''), true);

  // Direktnachrichten: @coden + Teilen
  const d1 = await P(`/buddy/messages/${hE}`, { body: 'Hey' }, O.t);
  chk('DM: normal', [d1.s, d1.j.reply], [200, undefined]);
  const dc = await P(`/buddy/messages/${hE}`, { body: 'Kannst du @coden fragen?' }, O.t);   // O hat sein Limit nicht erreicht (Owner-Pfad egal)
  chk('DM: @coden antwortet oder nennt Pause (Limit gehört zum Fragesteller)', !!dc.j.reply || /Pause/.test(dc.j.codenError || ''), true);
  const dmE = await call(`/buddy/messages/${hO}`, null, E.t);
  chk('DM: Gegenüber sieht Codens Antwort ebenfalls (falls gegeben)', dc.j.reply ? dmE.j.messages.some(m => m.ai && m.body === 'Hallo vom Test-Coden') : true, true);
  const dmX = await call(`/buddy/messages/${hO}`, null, X.t);
  chk('DM: Fremde sehen das Gespräch nicht', dmX.s, 403);

  const qa = await P('/apps', { name: 'Teilbar', kind: 'web', style: '', files: { 'index.html': '<h1>x</h1>' } }, O.t); const qid = qa.j.app.id;
  chk('DM-Teilen: App an Nicht-Freund verboten', (await P(`/buddy/messages/${'xtern_h'}`, { attachment: { type: 'app', id: qid } }, O.t)).s, 403);
  const sh = await P(`/buddy/messages/${hE}`, { attachment: { type: 'app', id: qid, role: 'viewer' } }, O.t);
  chk('DM-Teilen: App als Zuschauer', [sh.s, sh.j.message.attachment.role, sh.j.message.attachment.name, /geteilt/.test(sh.j.message.body)], [200, 'viewer', 'Teilbar', true]);
  chk('DM-Teilen: Empfänger sieht App', (await call('/apps/' + qid, null, E.t)).j.app.role, 'viewer');
  chk('DM-Teilen: Zuschauer darf nicht ändern', (await PU(`/apps/${qid}/files`, { set: { 'a.txt': 'x' } }, E.t)).s, 403);
  chk('DM-Teilen: Empfänger sieht Karte im Verlauf', (await call(`/buddy/messages/${hO}`, null, E.t)).j.messages.some(m => m.attachment?.id === qid), true);
  chk('DM-Teilen: auf Bearbeiter hochstufen', [(await P(`/buddy/messages/${hE}`, { attachment: { type: 'app', id: qid, role: 'editor' } }, O.t)).s, (await PU(`/apps/${qid}/files`, { set: { 'a.txt': 'ok' } }, E.t)).s], [200, 200]);
  chk('DM-Teilen: nur Besitzer darf teilen', (await P(`/buddy/messages/${hO}`, { attachment: { type: 'app', id: qid, role: 'editor' } }, E.t)).s, 403);
  const eapp = (await P('/apps', { name: 'EApp', kind: 'web', style: '', files: { 'index.html': 'e' } }, E.t)).j.app.id;
  chk('DM-Teilen: Freund teilt zurück, Besitzer behält Besitzerrolle', [(await P(`/buddy/messages/${hO}`, { attachment: { type: 'app', id: eapp, role: 'viewer' } }, E.t)).s, (await call('/apps/' + eapp, null, O.t)).j.app.role, (await call('/apps/' + eapp, null, E.t)).j.app.role], [200, 'viewer', 'owner']);
  chk('DM-Teilen: unbekannter Typ', (await P(`/buddy/messages/${hE}`, { attachment: { type: 'virus', id: 1 } }, O.t)).s, 400);
  const bp = await P('/buddy/projects', { title: 'Zusammen' }, O.t);
  const shp = await P(`/buddy/messages/${hE}`, { attachment: { type: 'project', id: bp.j.id } }, O.t);
  chk('DM-Teilen: Buddy-Projekt', [shp.s, shp.j.message.attachment.type], [200, 'project']);
  chk('DM-Teilen: Empfänger ist Mitglied', (await call('/buddy/projects/' + bp.j.id, null, E.t)).s, 200);
  global.fetch = realFetch;

  // Grenzen
  let last; for (let i = 0; i < 12; i++) { last = await P('/servers', { name: 'S' + i }, X.t); if (last.s !== 200) break; }
  chk('Servergrenze', last.s, 400);
  finish();
})();
