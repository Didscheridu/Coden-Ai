// App-Builder: Apps, Dateien, Agent-Chat, Mitglieder, Veröffentlichen und die öffentliche Hülle – gegen echtes Postgres.
const { setup } = require('./helpers');
(async () => {
  const { call, chk, finish, token, base } = await setup();
  const root = base.replace(/\/api$/, '');
  const T = {};
  for (const [k, email] of Object.entries({ anna: 'anna@x.de', ben: 'ben@x.de', cem: 'cem@x.de' })) T[k] = await token({ sub: 'uid-' + k, email, email_verified: true });
  const P = (p, b, t) => call(p, b, t, 'POST'), G = (p, t) => call(p, null, t), D = (p, t) => call(p, null, t, 'DELETE'), PUT = (p, b, t) => call(p, b, t, 'PUT'), PATCH = (p, b, t) => call(p, b, t, 'PATCH');
  const raw = async (p, opts) => { const r = await fetch(root + p, { redirect: 'manual', ...opts }); return { s: r.status, h: r.headers, t: await r.text().catch(() => '') }; };

  // --- Anlegen ---
  chk('ohne Login', (await G('/apps')).s, 401);
  chk('ohne Namen', (await P('/apps', { name: ' ', kind: 'web' }, T.anna)).s, 400);
  chk('falscher Typ', (await P('/apps', { name: 'X', kind: 'pc' }, T.anna)).s, 400);
  chk('falscher Stil', (await P('/apps', { name: 'X', kind: 'web', style: 'gibtsnicht' }, T.anna)).s, 400);
  chk('böser Dateiname', (await P('/apps', { name: 'X', kind: 'web', files: { '../x.html': 'a' } }, T.anna)).s, 400);
  const files = { 'index.html': '<!doctype html><html><head><title>Snake</title><link rel="stylesheet" href="coden-kit.css"><link rel="stylesheet" href="style.css"></head><body><div class="app"><h1>Hallo</h1></div><a href="about.html">Über</a><script src="app.js" defer></script></body></html>', 'style.css': 'h1{color:red}', 'app.js': 'console.log("hi")', 'about.html': '<h1>Über uns</h1>' };
  const cr = await P('/apps', { name: 'Snake <Spiel> & Co', kind: 'android', style: 'cyber', files }, T.anna);
  const app = cr.j.app; const id = app.id;
  chk('App anlegen', [cr.s, app.kind, app.style, app.role, app.published], [200, 'android', 'cyber', 'owner', false]);
  chk('Adresse aus dem Namen', /^snake-spiel-co-[0-9a-f]{4}$/.test(app.slug), true);
  chk('Testlink enthält Token', app.testUrl.endsWith('/a/' + app.slug + '/?t=' + app.previewToken), true);
  chk('Farbe aus dem Stil', app.themeColor, '#ff2bd6');
  chk('Liste', (await G('/apps', T.anna)).j.apps.map(a => a.id), [id]);
  chk('Fremder sieht die App nicht', (await G('/apps/' + id, T.ben)).s, 404);
  chk('Fremder kann nichts speichern', (await PUT(`/apps/${id}/files`, { set: { 'x.js': '1' } }, T.ben)).s, 404);

  // --- Dateien ---
  const v1 = (await G('/apps/' + id, T.anna)).j.app.version;
  const up = await PUT(`/apps/${id}/files`, { set: { 'app.js': 'console.log("neu")', 'data.json': '{"a":1}' }, remove: ['about.html'] }, T.anna);
  chk('Dateien ändern erhöht die Version', up.j.version, v1 + 1);
  chk('Dateiliste nach Änderung', up.j.files.sort(), ['app.js', 'data.json', 'index.html', 'style.css']);
  chk('zu große Datei', (await PUT(`/apps/${id}/files`, { set: { 'big.js': 'x'.repeat(400_001) } }, T.anna)).s, 400);
  chk('Pfad mit ..', (await PUT(`/apps/${id}/files`, { set: { 'a/../b.js': '1' } }, T.anna)).s, 400);
  chk('Dateien gespeichert', (await G('/apps/' + id, T.anna)).j.files['app.js'], 'console.log("neu")');
  chk('Umbenennen', (await PATCH('/apps/' + id, { name: 'Snake Pro', integrations: { database: { provider: 'supabase', url: 'https://x.supabase.co' } } }, T.anna)).j.app.name, 'Snake Pro');
  chk('Integrationen gemerkt', (await G('/apps/' + id, T.anna)).j.app.integrations.database.provider, 'supabase');

  // --- Agent-Chat ---
  const m1 = await P(`/apps/${id}/messages`, { role: 'user', body: 'Bau mir Snake' }, T.anna);
  chk('Nachricht speichern', [m1.s, m1.j.message.mine], [200, true]);
  await P(`/apps/${id}/messages`, { role: 'assistant', body: 'Mache ich!', meta: { files: ['app.js'] } }, T.anna);
  chk('ungültige Rolle', (await P(`/apps/${id}/messages`, { role: 'system', body: 'x' }, T.anna)).s, 400);
  chk('Poll liefert nur neue Nachrichten', (await G(`/apps/${id}/poll?after=${m1.j.message.id}`, T.anna)).j.messages.map(m => [m.role, m.body, m.meta.files?.[0]]), [['assistant', 'Mache ich!', 'app.js']]);

  // --- Code Buddy: nur Freunde einladen ---
  await PUT('/buddy/me', { handle: 'anna', displayName: 'Anna' }, T.anna); await PUT('/buddy/me', { handle: 'ben', displayName: 'Ben' }, T.ben); await PUT('/buddy/me', { handle: 'cem', displayName: 'Cem' }, T.cem);
  chk('Nicht-Freund einladen geht nicht', (await P(`/apps/${id}/members`, { handle: 'ben' }, T.anna)).s, 403);
  await P('/buddy/requests', { handle: 'ben' }, T.anna); await P('/buddy/requests/anna/accept', {}, T.ben);
  const inv = await P(`/apps/${id}/members`, { handle: '@ben' }, T.anna);
  chk('Freund einladen', [inv.s, inv.j.members.map(m => m.handle)], [200, ['anna', 'ben']]);
  chk('doppelt einladen', (await P(`/apps/${id}/members`, { handle: 'ben' }, T.anna)).s, 409);
  chk('Ben sieht die geteilte App', (await G('/apps', T.ben)).j.apps.map(a => [a.id, a.role]), [[id, 'editor']]);
  chk('Ben darf Dateien ändern', (await PUT(`/apps/${id}/files`, { set: { 'ben.js': '// ben' } }, T.ben)).s, 200);
  chk('Ben sieht Annas Nachrichten', (await G(`/apps/${id}/messages`, T.ben)).j.messages.filter(m => m.role !== 'event').map(m => [m.body, m.mine, m.handle]), [['Bau mir Snake', false, 'anna'], ['Mache ich!', false, 'anna']]);
  chk('Ben darf nicht löschen', (await D('/apps/' + id, T.ben)).s, 403);
  chk('Ben darf nicht veröffentlichen', (await P(`/apps/${id}/publish`, {}, T.ben)).s, 403);
  chk('Ben darf niemanden einladen', (await P(`/apps/${id}/members`, { handle: 'cem' }, T.ben)).s, 403);

  // --- Öffentlich & Testlink ---
  const slug = (await G('/apps/' + id, T.anna)).j.app.slug; const tok = app.previewToken;
  chk('unveröffentlicht: öffentlich unsichtbar', (await G('/public/apps/' + slug)).s, 404);
  chk('unveröffentlicht: falscher Token', (await G(`/public/apps/${slug}?t=falsch`)).s, 404);
  const pv = await G(`/public/apps/${slug}?t=${tok}`);
  chk('Testlink mit Token', [pv.s, pv.j.preview, pv.j.entry], [200, true, 'index.html']);
  const page = pv.j.pages['index.html'];
  chk('Bundle: CSS/JS/Kit eingebettet', [page.includes('h1{color:red}'), page.includes('console.log("neu")'), page.includes('Coden-Kit 1.0'), page.includes('data-platform="android"'), page.includes('--c-primary:#ff2bd6')], [true, true, true, true, true]);
  chk('Bundle: defer-Skript am Ende', page.indexOf('data-src="app.js"') > page.indexOf('<div class="app">'), true);
  chk('Version für Live-Updates', typeof (await G(`/public/apps/${slug}/version?t=${tok}`)).j.version, 'number');
  const w = await raw(`/a/${slug}/?t=${tok}`);
  chk('Hülle: Testlink lädt', [w.s, w.t.includes('sandbox="allow-scripts'), w.t.includes('allow-same-origin')], [200, true, false]);
  chk('Hülle: Name escaped', [w.t.includes('<title>Snake Pro</title>'), w.t.includes('<Spiel>')], [true, false]);
  chk('Hülle ohne Token: 404', (await raw(`/a/${slug}/`)).s, 404);
  { const a = await raw(`/a/${slug}?t=${tok}`); chk('Adresse ohne Schrägstrich funktioniert direkt (keine Weiterleitung)', [a.s, a.t.includes('__CODEN_APP__')], [200, true]); }
  const ic = await fetch(`${root}/a/${slug}/icon-192.png`); const buf = Buffer.from(await ic.arrayBuffer());
  chk('Symbol ist ein PNG', [ic.status, ic.headers.get('content-type'), buf.slice(1, 4).toString()], [200, 'image/png', 'PNG']);
  const mf = await raw(`/a/${slug}/manifest.webmanifest?t=${tok}`); const mj = JSON.parse(mf.t);
  chk('Manifest', [mf.s, mj.scope, mj.start_url, mj.display, mj.icons.length], [200, `/a/${slug}/`, `/a/${slug}/?t=${tok}`, 'standalone', 3]);
  chk('Service Worker', [(await raw(`/a/${slug}/sw.js`)).s, (await raw(`/a/${slug}/sw.js`)).h.get('service-worker-allowed')], [200, `/a/${slug}/`]);

  // --- Veröffentlichen ---
  chk('reservierte Adresse', (await P(`/apps/${id}/publish`, { slug: 'api' }, T.anna)).s, 400);
  chk('ungültige Adresse', (await P(`/apps/${id}/publish`, { slug: '-x' }, T.anna)).s, 400);
  const other = (await P('/apps', { name: 'Andere', kind: 'web' }, T.cem)).j.app;
  await P(`/apps/${other.id}/publish`, { slug: 'meine-seite' }, T.cem);
  chk('vergebene Adresse', (await P(`/apps/${id}/publish`, { slug: 'meine-seite' }, T.anna)).s, 409);
  const pub = await P(`/apps/${id}/publish`, { slug: 'snake' }, T.anna);
  chk('Veröffentlichen mit eigener Adresse', [pub.s, pub.j.app.published, pub.j.app.url.endsWith('/a/snake/')], [200, true, true]);
  chk('jetzt öffentlich', [(await G('/public/apps/snake')).s, (await G('/public/apps/snake')).j.preview], [200, false]);
  chk('Hülle öffentlich, Unterseite', (await raw('/a/snake/about.html')).s, 200);
  chk('alter Testlink nach Adresswechsel weg', (await G(`/public/apps/${slug}?t=${tok}`)).s, 404);
  chk('Testlink erneuern', (await P(`/apps/${id}/token`, {}, T.anna)).j.app.previewToken !== tok, true);
  await D(`/apps/${id}/publish`, T.anna);
  chk('zurückgezogen', (await G('/public/apps/snake')).s, 404);

  // --- KI-Bilder (Cloudflare wird nachgestellt) ---
  {
    chk('Bild ohne Schlüssel: sauber abgelehnt', [(await P(`/apps/${id}/images`, { prompt: 'ein Café' }, T.anna)).s], [503]);
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc'; process.env.CLOUDFLARE_API_TOKEN = 'tok';
    const realFetch = global.fetch; const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    global.fetch = async (u, o) => String(u).startsWith('https://api.cloudflare.com/') ? new Response(JSON.stringify({ success: true, result: { image: jpg.toString('base64') } }), { status: 200 }) : realFetch(u, o);
    try {
      chk('Bild ohne Beschreibung', (await P(`/apps/${id}/images`, { prompt: '' }, T.anna)).s, 400);
      chk('Fremder darf keine Bilder erzeugen', (await P(`/apps/${id}/images`, { prompt: 'ein Café' }, T.cem)).s, 404);
      const im = await P(`/apps/${id}/images`, { prompt: 'a cozy cafe, illustration' }, T.anna);
      chk('Bild erzeugt', [im.s, /\/api\/public\/img\/[a-f0-9]{18}$/.test(im.j.url)], [200, true]);
      const got = await fetch(im.j.url.replace(/^https?:\/\/[^/]+/, root));
      chk('Bild öffentlich abrufbar', [got.status, got.headers.get('content-type'), Buffer.from(await got.arrayBuffer()).equals(jpg)], [200, 'image/jpeg', true]);
      chk('Chat-Bild ohne Login', (await P('/image', { prompt: 'a cat' })).s, 401);
      chk('Chat-Bild ohne Beschreibung', (await P('/image', { prompt: '' }, T.anna)).s, 400);
      const cb = await P('/image', { prompt: 'a cat on a sofa' }, T.anna);
      chk('Chat-Bild erzeugt und abrufbar', [cb.s, (await fetch(cb.j.url.replace(/^https?:\/\/[^/]+/, root))).status], [200, 200]);
      chk('unbekanntes Bild', (await raw('/api/public/img/000000000000000000')).s, 404);
    } finally { global.fetch = realFetch; delete process.env.CLOUDFLARE_ACCOUNT_ID; delete process.env.CLOUDFLARE_API_TOKEN; }
  }

  // --- APK ---
  chk('APK: Web-App abgelehnt', (await P(`/apps/${other.id}/apk`, {}, T.cem)).s, 400);
  chk('APK: erst veröffentlichen', (await P(`/apps/${id}/apk`, {}, T.anna)).j.code, 'NOT_PUBLISHED');
  await P(`/apps/${id}/publish`, {}, T.anna);
  chk('APK: ohne GitHub-Token sauber abgelehnt', (await P(`/apps/${id}/apk`, {}, T.anna)).j.code, 'APK_NOT_CONFIGURED');
  chk('APK-Status', (await G(`/apps/${id}/apk`, T.anna)).j, { apk: { status: 'none' }, configured: false });
  chk('Paketname gültig', [require('../server/apk').packageId('3d-for'), require('../server/apk').packageId('new')], ['app.coden.a3d_for', 'app.coden.new_app']);

  // --- Verlassen / Löschen ---
  chk('Ben verlässt die App', (await D(`/apps/${id}/members/ben`, T.ben)).s, 200);
  chk('danach kein Zugriff', (await G('/apps/' + id, T.ben)).s, 404);
  chk('Anna löscht', (await D('/apps/' + id, T.anna)).s, 200);
  chk('gelöscht', [(await G('/apps', T.anna)).j.apps.length, (await G('/public/apps/snake')).s], [0, 404]);
  await finish();
})().catch(e => { console.error(e); process.exit(1); });
