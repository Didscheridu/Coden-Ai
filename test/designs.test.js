// Design: speichern, Rechte, Grenzen, Bild-KI (ohne Text), eigene Bilder hochladen; Logik in js/design-core.js
const path = require('path');
const { pathToFileURL } = require('url');
const { setup } = require('./helpers');
(async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = 'acc'; process.env.CLOUDFLARE_API_TOKEN = 'tok';
  const realFetch = global.fetch; const prompts = [];
  const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  global.fetch = async (url, o = {}) => {
    const u = String(url); if (u.startsWith('http://127.0.0.1')) return realFetch(url, o);
    if (u.includes('api.cloudflare.com')) { prompts.push(JSON.parse(o.body).prompt); return new Response(JSON.stringify({ result: { image: PNG1.toString('base64') } }), { status: 200 }); }
    return new Response('{}', { status: 404 });
  };
  const { call, chk, finish, token, base } = await setup();
  const A = await token({ sub: 'uid-da', email: 'da@x.de', email_verified: true });
  const B = await token({ sub: 'uid-db', email: 'db@x.de', email_verified: true });
  const P = (p, b, t) => call(p, b, t, 'POST'), PA = (p, b, t) => call(p, b, t, 'PATCH'), G = (p, t) => call(p, null, t), D = (p, t) => call(p, null, t, 'DELETE');

  // ---------- Speichern ----------
  chk('Ohne Login 401', (await G('/designs')).s, 401);
  const c = await P('/designs', { title: 'Sommer-Sale', format: 'carousel', slides: 5, head: '<style>.x{}</style>', body: '<section data-slide>Hi</section>', messages: [{ role: 'user', text: 'Mach einen Sale-Post' }] }, A);
  chk('Design anlegen', [c.s, c.j.design.title, c.j.design.format, c.j.design.slides, c.j.design.messages.length], [200, 'Sommer-Sale', 'carousel', 5, 1]);
  const id = c.j.design.id;
  chk('Unbekanntes Format abgelehnt', (await P('/designs', { format: 'tiktok' }, A)).s, 400);
  chk('Slides begrenzt', (await P('/designs', { format: 'carousel', slides: 40 }, A)).j.design.slides, 10);
  chk('Eingebettete data:-Bilder abgelehnt', (await PA('/designs/' + id, { body: '<img src="data:image/png;base64,AAAA">' }, A)).s, 400);
  chk('Zu großes Design abgelehnt', (await PA('/designs/' + id, { body: 'x'.repeat(300_001) }, A)).s, 400);
  const up = await PA('/designs/' + id, { body: '<section data-slide><h1>Neu</h1></section>', title: '' }, A);
  chk('Ändern (leerer Titel → Standard)', [up.s, up.j.design.title], [200, 'Neues Design']);
  chk('Lesen liefert HTML', (await G('/designs/' + id, A)).j.design.body, '<section data-slide><h1>Neu</h1></section>');
  const list = await G('/designs', A);
  chk('Liste ohne HTML (leicht)', [list.j.designs.length, 'body' in list.j.designs[0]], [2, false]);
  chk('Fremde sehen nichts', [(await G('/designs/' + id, B)).s, (await G('/designs', B)).j.designs.length, (await PA('/designs/' + id, { title: 'x' }, B)).s, (await D('/designs/' + id, B)).s], [404, 0, 404, 404]);

  // ---------- Bild-KI ----------
  const img = await P('/designs/image', { prompt: 'sunny beach with palm trees' }, A);
  chk('Bild erzeugt, öffentlich abrufbar mit CORS', [img.s, /\/api\/public\/img\/[a-f0-9]{18}$/.test(img.j.url)], [200, true]);
  const pub = await realFetch(base.replace(/\/api$/, '') + '/api/public/img/' + img.j.key);
  chk('Öffentliches Bild: PNG + CORS', [pub.status, pub.headers.get('access-control-allow-origin')], [200, '*']);
  chk('Bild-KI bekommt „kein Text“', /No text, no letters/.test(prompts[0]), true);
  chk('Leerer Prompt abgelehnt', (await P('/designs/image', { prompt: ' ' }, A)).s, 400);

  // ---------- Hochladen ----------
  const ok = await P('/designs/upload', { dataUrl: 'data:image/png;base64,' + Buffer.concat([PNG1, Buffer.alloc(80)]).toString('base64') }, A);
  chk('Upload PNG', [ok.s, /\/api\/public\/img\//.test(ok.j.url)], [200, true]);
  chk('Upload: falscher Typ', (await P('/designs/upload', { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }, A)).s, 400);
  chk('Upload: Inhalt passt nicht zum Typ', (await P('/designs/upload', { dataUrl: 'data:image/png;base64,' + Buffer.alloc(200, 7).toString('base64') }, A)).s, 400);
  chk('Upload: zu groß', (await P('/designs/upload', { dataUrl: 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(700_001)]).toString('base64') }, A)).s, 400);

  chk('Löschen', [(await D('/designs/' + id, A)).s, (await G('/designs/' + id, A)).s], [200, 404]);

  // ---------- Logik (js/design-core.js) ----------
  const DC = await import(pathToFileURL(path.join(__dirname, '../js/design-core.js')).href);
  chk('Formate', Object.values(DC.FORMATS).map(f => `${f.w}x${f.h}`), ['1080x1080', '1080x1350', '1080x1920', '1080x1350']);
  const sp = DC.designSystemPrompt({ format: 'story', slides: 1, brand: { primary: '#ff0055', secondary: '#111111', font: 'Montserrat', logo: 'https://x.de/logo.png' } });
  chk('System-Prompt: Maße, Platzhalter, Brand Kit', [/1080 × 1920/.test(sp), /data-ai-image-prompt/.test(sp), /#ff0055/.test(sp), /Montserrat/.test(sp), /https:\/\/x\.de\/logo\.png/.test(sp), /keine? JavaScript|KEIN JavaScript/i.test(sp)], [true, true, true, true, true, true]);
  chk('System-Prompt Karussell: genau N Slides', /genau 4 <section data-slide>/.test(DC.designSystemPrompt({ format: 'carousel', slides: 4 })), true);
  chk('extractHtml: aus ```html-Block', DC.extractHtml('Hier:\n```html\n<!DOCTYPE html><html><head></head><body><section data-slide>A</section></body></html>\n```\nFertig'), '<!DOCTYPE html><html><head></head><body><section data-slide>A</section></body></html>');
  chk('extractHtml: nackte Sections werden eingepackt', /<body><section data-slide>B<\/section><\/body>/.test(DC.extractHtml('<section data-slide>B</section>')), true);
  chk('extractHtml: nichts → leer', DC.extractHtml('Ich kann das nicht.'), '');
  chk('splitDoc', DC.splitDoc('<html><head><link href="x"></head><body class="a"><p>Hi</p></body></html>'), { head: '<link href="x">', body: '<p>Hi</p>' });
  chk('safeFontLink nur Google Fonts', [DC.safeFontLink('https://fonts.googleapis.com/css2?family=Inter'), DC.safeFontLink('https://evil.com/x.css'), DC.safeFontLink('javascript:alert(1)')], [true, false, false]);
  const doc = DC.frameDoc({ head: '<style>h1{}</style>', body: '<section data-slide>X</section>', format: 'square', lib: 'LIB', mode: 'edit' });
  chk('Frame: CSP, Tailwind, Größe, Brücke', [/Content-Security-Policy/.test(doc), /cdn\.tailwindcss\.com/.test(doc), /"w":1080,"h":1080/.test(doc), /codenDesign/.test(doc), doc.includes('LIB')], [true, true, true, true, true]);
  chk('Frame: CSP erlaubt keine fremden Skripte außer Tailwind', /script-src 'unsafe-inline' https:\/\/cdn\.tailwindcss\.com;/.test(doc), true);
  chk('Dateinamen für Export', [DC.exportName('Sommer: Sale!', 2, 5), DC.exportName('', 1, 1)], ['Sommer-Sale-2-von-5.png', 'Coden-Design.png']);
  chk('Bild-Prompt kürzen/säubern', DC.cleanImagePrompt('  "a cat"\n\nwith <b>tags</b> '), 'a cat with tags');

  global.fetch = realFetch;
  await finish();
})().catch(e => { console.error(e); process.exit(1); });
