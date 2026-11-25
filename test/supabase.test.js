// Supabase als zweite Datenbank: OrcaRouter-Keys liegen in Supabase (byok_keys), alle anderen weiter in Firestore.
const path = require('path');
const { setup, root } = require('./helpers');
(async () => {
  const supa = require(path.join(root, 'server/supabase'));
  const realFetch = global.fetch;
  const { call, chk, finish, token, db, base } = await setup();
  const anna = await token({ sub: 'uid-anna', email: 'anna@x.de', email_verified: true });
  const ben = await token({ sub: 'uid-ben', email: 'ben@x.de', email_verified: true });

  // 1) Ohne Supabase: alles wie bisher in Firestore
  let o = (await call('/byok', null, anna)).j;
  chk('Ohne Supabase: OrcaRouter-Key käme in Firestore', o.providers.find(p => p.id === 'orcarouter').store, 'firestore');
  await call('/byok/keys/orcarouter', { key: 'sk-orca-alt-0000' }, anna, 'PUT');
  chk('Ohne Supabase: Key liegt in Firestore', !!(await db.getDoc('user_provider_keys/uid-anna__orcarouter')), true);

  // 2) Supabase an (Speicher-Modus): OrcaRouter -> Supabase, Google -> Firestore
  supa.enableMemory(); supa.clearMemory();
  o = (await call('/byok', null, anna)).j;
  chk('Mit Supabase: alter Firestore-Key wird noch erkannt', [o.providers.find(p => p.id === 'orcarouter').hasKey, o.providers.find(p => p.id === 'orcarouter').store], [true, 'supabase']);
  chk('Google bleibt in Firestore', o.providers.find(p => p.id === 'google').store, 'firestore');

  o = (await call('/byok/keys/orcarouter', { key: 'sk-orca-neu-4242' }, anna, 'PUT')).j;
  const rows = await supa.select('byok_keys', { uid: 'uid-anna' });
  chk('OrcaRouter-Key liegt in Supabase (verschlüsselt)', [rows.length, rows[0].provider, rows[0].hint, rows[0].key_enc.includes('sk-orca')], [1, 'orcarouter', '…4242', false]);
  chk('Alte Firestore-Kopie aufgeräumt', await db.getDoc('user_provider_keys/uid-anna__orcarouter'), null);
  chk('Übersicht zeigt Key aus Supabase', [o.providers.find(p => p.id === 'orcarouter').hasKey, o.providers.find(p => p.id === 'orcarouter').hint], [true, '…4242']);

  await call('/byok/keys/google', { key: 'AIzaSyTESTKEY-1234567890abcd' }, anna, 'PUT');
  chk('Google-Key weiter in Firestore, nicht in Supabase', [!!(await db.getDoc('user_provider_keys/uid-anna__google')), (await supa.select('byok_keys', { uid: 'uid-anna', provider: 'google' })).length], [true, 0]);

  // Key wird im Chat benutzt (entschlüsselt aus Supabase)
  const seen = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
    seen.push({ url: u, headers: opts.headers || {} });
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hallo aus Supabase' } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const m = (await call('/byok/models', { provider: 'orcarouter', modelId: 'orcarouter/free', levels: ['low'] }, anna)).j.models.find(x => x.provider === 'orcarouter');
  const t = await realFetch(base + '/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anna }, body: JSON.stringify({ tier: m.tier, messages: [{ role: 'user', content: 'Hi' }] }) }).then(r => r.text());
  chk('Chat nutzt den Key aus Supabase', [t.includes('Hallo aus Supabase'), seen.at(-1)?.url, seen.at(-1)?.headers.Authorization], [true, 'https://api.orcarouter.ai/v1/chat/completions', 'Bearer sk-orca-neu-4242']);
  global.fetch = realFetch;

  // Fremde sehen den Key nicht
  chk('Ben hat keinen OrcaRouter-Key', (await call('/byok', null, ben)).j.providers.find(p => p.id === 'orcarouter').hasKey, false);

  // Löschen
  o = (await call('/byok/keys/orcarouter', null, anna, 'DELETE')).j;
  chk('Key gelöscht (Supabase leer, Übersicht ohne Key)', [(await supa.select('byok_keys', { uid: 'uid-anna', provider: 'orcarouter' })).length, o.providers.find(p => p.id === 'orcarouter').hasKey], [0, false]);

  // SUPABASE_BYOK_PROVIDERS=all -> auch Google in Supabase
  process.env.SUPABASE_BYOK_PROVIDERS = 'all';
  chk('"all" legt alle Keys in Supabase', (await call('/byok', null, anna)).j.providers.every(p => p.store === 'supabase'), true);
  delete process.env.SUPABASE_BYOK_PROVIDERS;

  // 3) Echter REST-Weg: richtige Adresse, Header, Upsert
  supa.disableMemory();
  Object.assign(process.env, { SUPABASE_URL: 'https://abcd.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.service-role-test-key' });
  const req = [];
  global.fetch = async (url, opts = {}) => { req.push({ url: String(url), method: opts.method, headers: opts.headers, body: opts.body }); return new Response(opts.method === 'GET' ? '[{"uid":"u1","provider":"orcarouter","key_enc":"x.y.z"}]' : '[]', { status: 200 }); };
  await supa.upsert('byok_keys', { uid: 'u1', provider: 'orcarouter', key_enc: 'a.b.c' }, ['uid', 'provider']);
  chk('REST: Upsert an die richtige Adresse', [req[0].url, req[0].method, req[0].headers.Prefer, req[0].headers.apikey, req[0].headers.Authorization], ['https://abcd.supabase.co/rest/v1/byok_keys?on_conflict=uid,provider', 'POST', 'resolution=merge-duplicates,return=representation', 'eyJhbGciOiJIUzI1NiJ9.service-role-test-key', 'Bearer eyJhbGciOiJIUzI1NiJ9.service-role-test-key']);
  const got = await supa.select('byok_keys', { uid: 'u1', provider: 'orcarouter' });
  chk('REST: Lesen mit Filter', [req[1].url, got[0].key_enc], ['https://abcd.supabase.co/rest/v1/byok_keys?select=*&uid=eq.u1&provider=eq.orcarouter', 'x.y.z']);
  process.env.SUPABASE_SERVICE_ROLE_KEY = ''; process.env.SUPABASE_SECRET_KEY = 'sb_secret_abcdefghijklmnopqrstuvwxyz';
  await supa.remove('byok_keys', { uid: 'u1', provider: 'orcarouter' });
  chk('REST: neuer Secret-Key nur als apikey (kein Bearer)', [req[2].method, req[2].headers.apikey, req[2].headers.Authorization], ['DELETE', 'sb_secret_abcdefghijklmnopqrstuvwxyz', undefined]);
  global.fetch = async () => new Response('{"message":"relation \\"public.byok_keys\\" does not exist","code":"42P01"}', { status: 404 });
  let err = null; try { await supa.select('byok_keys', {}); } catch (e) { err = e; }
  chk('REST: verständlicher Fehler, wenn die Tabelle fehlt', [err?.status, /does not exist/.test(err?.message)], [404, true]);
  global.fetch = realFetch;
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  chk('Ohne Env ist Supabase aus', supa.isConfigured(), false);

  await finish();
})().catch(e => { console.error(e); process.exit(1); });
