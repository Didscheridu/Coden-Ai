// Frische, leere Firestore-Datenbank: Apps, Code Buddy und Daten müssen sofort ohne Vorab-Migration funktionieren.
const { setup } = require('./helpers');
const { ensureSchema } = require('../server/schema');
(async () => {
  const { call, chk, finish, token, db } = await setup();
  const t = await token({ sub: 'uid-x', email: 'x@x.de', email_verified: true });
  chk('Leere DB beim Start', db.memoryStore().size, 0);
  chk('ensureSchema ist ohne Fehler ausführbar', await ensureSchema(), true);
  const r = await call('/apps', null, t);
  chk('GET /apps auf leerer DB: kein Fehler', [r.s, Array.isArray(r.j.apps)], [200, true]);
  chk('Code Buddy läuft', (await call('/buddy/me', null, t)).s, 200);
  chk('Daten laden läuft', (await call('/data', null, t)).s, 200);
  await finish();
})();
