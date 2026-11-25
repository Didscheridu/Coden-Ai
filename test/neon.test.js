// Neon als zweite Datenbank: OrcaRouter-Keys liegen in Neon (byok_keys), alle anderen weiter in Firestore.
// Läuft gegen echtes Postgres (PGlite) – gleiche SQL-Befehle wie bei Neon.
const path = require('path');
const { setup, root } = require('./helpers');
(async () => {
  delete process.env.DATABASE_URL; delete process.env.NEON_DATABASE_URL;
  const neon = require(path.join(root, 'server/neon'));
  const { PGlite } = require('@electric-sql/pglite');
  const realFetch = global.fetch;
  const { call, chk, finish, token, db, base } = await setup();
  const anna = await token({ sub: 'uid-anna', email: 'anna@x.de', email_verified: true });
  const ben = await token({ sub: 'uid-ben', email: 'ben@x.de', email_verified: true });
  const orca = (o) => o.providers.find(p => p.id === 'orcarouter');

  // 1) Ohne Neon: alles wie bisher in Firestore
  let o = (await call('/byok', null, anna)).j;
  chk('Ohne Neon: OrcaRouter-Key käme in Firestore', orca(o).store, 'firestore');
  chk('Ohne Neon: /api/health meldet Neon aus', (await call('/health')).j.neon, { configured: false });
  await call('/byok/keys/orcarouter', { key: 'sk-orca-alt-0000' }, anna, 'PUT');
  chk('Ohne Neon: Key liegt in Firestore', !!(await db.getDoc('user_provider_keys/uid-anna__orcarouter')), true);

  // 2) Neon an (echtes Postgres über PGlite): Tabelle entsteht von selbst
  const pg = new PGlite();
  neon.useClient(pg);
  o = (await call('/byok', null, anna)).j;
  chk('Mit Neon: alter Firestore-Key wird noch erkannt', [orca(o).hasKey, orca(o).store], [true, 'neon']);
  chk('Google bleibt in Firestore', o.providers.find(p => p.id === 'google').store, 'firestore');
  chk('/api/health meldet Neon ok', (await call('/health')).j.neon, { configured: true, ok: true });

  o = (await call('/byok/keys/orcarouter', { key: 'sk-orca-neu-4242' }, anna, 'PUT')).j;
  let rows = (await pg.query('select * from byok_keys')).rows;
  chk('OrcaRouter-Key liegt in Neon (verschlüsselt)', [rows.length, rows[0].uid, rows[0].provider, rows[0].hint, rows[0].key_enc.includes('sk-orca')], [1, 'uid-anna', 'orcarouter', '…4242', false]);
  chk('Alte Firestore-Kopie aufgeräumt', await db.getDoc('user_provider_keys/uid-anna__orcarouter'), null);
  chk('Übersicht zeigt Key aus Neon', [orca(o).hasKey, orca(o).hint], [true, '…4242']);

  await call('/byok/keys/orcarouter', { key: 'sk-orca-zwei-9999' }, anna, 'PUT');
  rows = (await pg.query('select hint from byok_keys')).rows;
  chk('Neu speichern ersetzt den Key (keine doppelte Zeile)', rows.map(r => r.hint), ['…9999']);

  await call('/byok/keys/google', { key: 'AIzaSyTESTKEY-1234567890abcd' }, anna, 'PUT');
  chk('Google-Key weiter in Firestore, nicht in Neon', [!!(await db.getDoc('user_provider_keys/uid-anna__google')), (await pg.query("select 1 from byok_keys where provider = 'google'")).rows.length], [true, 0]);

  // Key wird im Chat benutzt (entschlüsselt aus Neon)
  const seen = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
    seen.push({ url: u, headers: opts.headers || {} });
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hallo aus Neon' } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const added = await call('/byok/models', { provider: 'orcarouter', modelId: 'orcarouter/free', levels: ['low', 'high'] }, anna);
  const m = added.j.models.find(x => x.provider === 'orcarouter');
  const nRows = (await pg.query('select * from byok_models')).rows;
  chk('OrcaRouter-Modell liegt in Neon, nicht in Firestore', [added.s, nRows.length, nRows[0].model_id, nRows[0].levels, (await db.runQuery('user_models', { where: [['uid', '==', 'uid-anna']] })).length], [200, 1, 'orcarouter/free', ['low', 'high'], 0]);
  chk('Übersicht zeigt das Neon-Modell bereit', [m.tier, m.ready, m.providerName], ['byok:' + nRows[0].id, true, 'OrcaRouter']);
  const t = await realFetch(base + '/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anna }, body: JSON.stringify({ tier: m.tier, messages: [{ role: 'user', content: 'Hi' }] }) }).then(r => r.text());
  chk('Chat nutzt den Key aus Neon', [t.includes('Hallo aus Neon'), seen.at(-1)?.url, seen.at(-1)?.headers.Authorization], [true, 'https://api.orcarouter.ai/v1/chat/completions', 'Bearer sk-orca-zwei-9999']);
  global.fetch = realFetch;

  // Modell bearbeiten (gleiche Modell-ID) -> Neon-Zeile wird aktualisiert, nicht doppelt
  await call('/byok/models', { provider: 'orcarouter', modelId: 'orcarouter/free', levels: ['medium'], label: 'Orca Gratis' }, anna);
  const upd = (await pg.query('select label, levels from byok_models')).rows;
  chk('Neon-Modell bearbeitet', [upd.length, upd[0].label, upd[0].levels], [1, 'Orca Gratis', ['medium']]);
  // Google-Modell bleibt in Firestore, beide erscheinen zusammen
  const both = (await call('/byok/models', { provider: 'google', modelId: 'gemini-x', levels: ['low'] }, anna)).j.models;
  chk('Google-Modell in Firestore, beide in der Übersicht', [(await db.runQuery('user_models', { where: [['uid', '==', 'uid-anna']] })).length, both.map(x => x.provider).sort()], [1, ['google', 'orcarouter']]);
  // Kette mit Neon-Modell
  const ch = await call('/byok/chains', { name: 'Orca zuerst', members: [m.tier, 'flash'] }, anna);
  chk('Kette mit Neon-Modell möglich', [ch.s, ch.j.chains?.[0]?.members?.[0]?.label], [200, 'Orca Gratis']);
  // Ben darf das Neon-Modell nicht löschen
  await call('/byok/models/' + m.id, null, ben, 'DELETE');
  chk('Fremdes Neon-Modell nicht löschbar', (await pg.query('select 1 from byok_models')).rows.length, 1);
  await call('/byok/models/' + m.id, null, anna, 'DELETE');
  chk('Neon-Modell gelöscht und aus der Kette entfernt', [(await pg.query('select 1 from byok_models')).rows.length, (await call('/byok', null, anna)).j.chains[0].members.map(x => x.tier)], [0, ['flash']]);

  // Fremde sehen den Key nicht
  chk('Ben hat keinen OrcaRouter-Key', orca((await call('/byok', null, ben)).j).hasKey, false);

  // Löschen
  o = (await call('/byok/keys/orcarouter', null, anna, 'DELETE')).j;
  chk('Key gelöscht (Neon leer, Übersicht ohne Key)', [(await pg.query('select 1 from byok_keys')).rows.length, orca(o).hasKey], [0, false]);

  // NEON_BYOK_PROVIDERS=all -> auch Google in Neon
  process.env.NEON_BYOK_PROVIDERS = 'all';
  chk('"all" legt alle Keys in Neon', (await call('/byok', null, anna)).j.providers.every(p => p.store === 'neon'), true);
  delete process.env.NEON_BYOK_PROVIDERS;

  // Schutz: nur bekannte Tabellen/Spalten, kein Löschen ohne Filter
  let err = null; try { await neon.select('byok_keys', { 'uid; drop table byok_keys': 'x' }); } catch (e) { err = e.message; }
  chk('Unbekannte Spalte wird abgelehnt', /unbekannte Spalte/.test(err || ''), true);
  err = null; try { await neon.remove('byok_keys', {}); } catch (e) { err = e.message; }
  chk('Löschen ohne Filter wird abgelehnt', /ohne Filter/.test(err || ''), true);

  // Neon-Ausfall: verständlicher Fehler beim Speichern
  neon.useClient({ query: async () => { throw new Error('connection refused'); } });
  const r = await call('/byok/keys/orcarouter', { key: 'sk-orca-weg-1111' }, anna, 'PUT');
  chk('Neon nicht erreichbar: klare Meldung', [r.s, /Neon-Datenbank ist nicht erreichbar/.test(r.j.error || '')], [502, true]);

  // Ohne Neon und mit alten Firestore-Regeln: klare Meldung statt „Konnte keine ID vergeben“
  neon.useClient(null);
  const realCreate = db.createDoc;
  db.createDoc = async () => { throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'PERMISSION_DENIED' }); };
  const denied = await call('/byok/models', { provider: 'orcarouter', modelId: 'orcarouter/auto', levels: [] }, anna);
  db.createDoc = realCreate;
  chk('Firestore-Regeln lehnen ab: klare Meldung', [denied.s, /Firestore-Regeln/.test(denied.j.error || ''), /Neon/.test(denied.j.error || '')], [403, true, true]);

  // URL-Erkennung
  neon.useClient(null);
  chk('Ohne URL ist Neon aus', neon.isConfigured(), false);
  process.env.DATABASE_URL = 'postgresql://u:p@ep-cool-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';
  chk('DATABASE_URL schaltet Neon ein', neon.isConfigured(), true);
  delete process.env.DATABASE_URL;

  await finish();
})().catch(e => { console.error(e); process.exit(1); });
