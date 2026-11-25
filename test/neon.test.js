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
  const m = (await call('/byok/models', { provider: 'orcarouter', modelId: 'orcarouter/free', levels: ['low'] }, anna)).j.models.find(x => x.provider === 'orcarouter');
  const t = await realFetch(base + '/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anna }, body: JSON.stringify({ tier: m.tier, messages: [{ role: 'user', content: 'Hi' }] }) }).then(r => r.text());
  chk('Chat nutzt den Key aus Neon', [t.includes('Hallo aus Neon'), seen.at(-1)?.url, seen.at(-1)?.headers.Authorization], [true, 'https://api.orcarouter.ai/v1/chat/completions', 'Bearer sk-orca-zwei-9999']);
  global.fetch = realFetch;

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

  // URL-Erkennung
  neon.useClient(null);
  chk('Ohne URL ist Neon aus', neon.isConfigured(), false);
  process.env.DATABASE_URL = 'postgresql://u:p@ep-cool-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';
  chk('DATABASE_URL schaltet Neon ein', neon.isConfigured(), true);
  delete process.env.DATABASE_URL;

  await finish();
})().catch(e => { console.error(e); process.exit(1); });
