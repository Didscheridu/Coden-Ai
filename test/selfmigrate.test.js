// Frische, leere Datenbank (Migration nie gelaufen): Apps, Code Buddy und Daten müssen trotzdem sofort funktionieren.
const { setup } = require('./helpers');
(async () => {
  const { call, chk, finish, token, db } = await setup({ schema: false });
  const t = await token({ sub: 'uid-x', email: 'x@x.de', email_verified: true });
  chk('Tabelle apps existiert vorher nicht', (await db.query("select to_regclass('public.apps') r")).rows[0].r, null);
  const r = await call('/apps', null, t);
  chk('GET /apps auf leerer DB: kein Fehler', [r.s, Array.isArray(r.j.apps)], [200, true]);
  chk('Tabelle apps wurde angelegt', (await db.query("select to_regclass('public.apps') r")).rows[0].r, 'apps');
  chk('Code Buddy läuft', (await call('/buddy/me', null, t)).s, 200);
  chk('Daten laden läuft', (await call('/data', null, t)).s, 200);
  await finish();
})();
