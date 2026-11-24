// Artefakte wie bei Claude: veröffentlichen (/s/<id>), KI im Artefakt, gespeicherte Daten (persönlich und geteilt)
const { setup } = require('./helpers');
(async () => {
  Object.assign(process.env, { GROQ_API_KEY: 'test', OPENROUTER_API_KEY: 'test' }); delete process.env.GOOGLE_API_KEY;
  const realFetch = global.fetch; const asked = [];
  global.fetch = async (url, o = {}) => {
    const u = String(url); if (u.startsWith('http://127.0.0.1')) return realFetch(url, o);
    const body = JSON.parse(o.body || '{}'); asked.push(body.messages);
    const last = body.messages[body.messages.length - 1].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'KI sagt: ' + last } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const { call, chk, finish, token, base, db } = await setup();
  const root = base.replace(/\/api$/, '');
  const anna = await token({ sub: 'uid-anna', email: 'anna@x.de', email_verified: true });
  const ben = await token({ sub: 'uid-ben', email: 'ben@x.de', email_verified: true });
  const P = (p, b, t) => call(p, b, t, 'POST'), G = (p, t) => call(p, null, t), D = (p, t) => call(p, null, t, 'DELETE'), U = (p, b, t) => call(p, b, t, 'PUT');
  const page = async (p) => { const r = await realFetch(root + p, { redirect: 'manual' }); return { s: r.status, csp: r.headers.get('content-security-policy') || '', xfo: r.headers.get('x-frame-options') || '', text: await r.text() }; };

  // ---------- Veröffentlichen ----------
  const html = '<!doctype html><html><body><h1>Zähler</h1><script>document.title="x"</script></body></html>';
  chk('Teilen: nur angemeldet', (await call('/artifacts/share', { title: 'T', html })).s, 401);
  chk('Teilen: leeres Dokument abgelehnt', (await P('/artifacts/share', { title: 'T', html: '' }, anna)).s, 400);
  const s1 = await P('/artifacts/share', { title: 'Zähler <b>', type: 'html', body: '<h1>Zähler</h1>', html, srcKey: 'chat1|Zähler', author: 'Anna' }, anna);
  chk('Teilen: Link und Version 1', [s1.s, /^[a-z0-9]{10}$/.test(s1.j.id), s1.j.url, s1.j.version, s1.j.updated], [200, true, `/s/${s1.j.id}`, 1, false]);
  const id = s1.j.id;
  const w = await page(`/s/${id}`);
  chk('Seite: Hülle mit Titel (escaped), Rahmen auf /frame, eigene CSP', [w.s, w.text.includes('Zähler &lt;b&gt;'), w.text.includes(`src="/s/${id}/frame"`), /script-src 'nonce-/.test(w.csp), w.xfo], [200, true, true, true, 'DENY']);
  chk('Seite: Link „In Coden öffnen“', w.text.includes(`href="/#/s/${id}"`), true);
  const fr = await page(`/s/${id}/frame`);
  chk('Rahmen: gespeichertes Dokument, abgeschottet (sandbox ohne same-origin)', [fr.s, fr.text, /^sandbox allow-scripts/.test(fr.csp), /allow-same-origin/.test(fr.csp), fr.xfo], [200, html, true, false, 'SAMEORIGIN']);
  chk('Seite: unbekannt → 404', [(await page('/s/zzzzzzzzzz')).s, (await page('/s/../etc')).s === 404 || (await page('/s/../etc')).s === 301], [404, true]);
  const pub = await G(`/public/artifacts/${id}`);
  chk('Öffentlich: Titel, Autor und Dokument für die Ansicht in Coden', [pub.s, pub.j.title, pub.j.author, pub.j.html === html], [200, 'Zähler <b>', 'Anna', true]);
  const s2 = await P('/artifacts/share', { title: 'Zähler', type: 'html', body: 'neu', html: html.replace('Zähler', 'Zähler 2'), srcKey: 'chat1|Zähler' }, anna);
  chk('Neue Fassung: gleicher Link, Version 2', [s2.j.id, s2.j.version, s2.j.updated, (await page(`/s/${id}/frame`)).text.includes('Zähler 2')], [id, 2, true, true]);
  const list = await G('/artifacts/shared', anna);
  chk('Liste: eigene Veröffentlichungen', [list.j.items.length, list.j.items[0].srcKey, (await G('/artifacts/shared', ben)).j.items.length], [1, 'chat1|Zähler', 0]);
  chk('Beenden: fremde nicht', (await D(`/artifacts/shared/${id}`, ben)).s, 404);
  chk('Zu groß: abgelehnt', (await P('/artifacts/share', { title: 'Groß', html: 'x'.repeat(700_001) }, anna)).s, 400);

  // ---------- Gespeicherte Daten ----------
  const st = (aid) => `/artifacts/store/${aid}`;
  chk('Speicher: nur angemeldet', (await G(st('cabc123') + '?key=a')).s, 401);
  chk('Speicher: leer → null', (await G(st('cabc123') + '?key=stand', anna)).j.item, null);
  const set1 = await U(st('cabc123'), { key: 'stand', value: '{"punkte":5}' }, anna);
  chk('Speicher: setzen', [set1.s, set1.j], [200, { key: 'stand', value: '{"punkte":5}', shared: false }]);
  chk('Speicher: lesen', (await G(st('cabc123') + '?key=stand', anna)).j.item.value, '{"punkte":5}');
  chk('Speicher: Objekt wird als JSON gespeichert', (await U(st('cabc123'), { key: 'obj', value: { a: 1 } }, anna)).j.value, '{"a":1}');
  chk('Speicher: Liste mit Präfix', [(await G(st('cabc123') + '?prefix=', anna)).j.keys, (await G(st('cabc123') + '?prefix=st', anna)).j.keys], [['obj', 'stand'], ['stand']]);
  chk('Speicher: Ben sieht Annas Daten nicht', [(await G(st('cabc123') + '?key=stand', ben)).j.item, (await G(st('cabc123') + '?prefix=', ben)).j.keys], [null, []]);
  chk('Speicher: anderes Artefakt getrennt', (await G(st('cother99') + '?key=stand', anna)).j.item, null);
  chk('Speicher: löschen', [(await D(st('cabc123') + '?key=stand', anna)).j.deleted, (await G(st('cabc123') + '?key=stand', anna)).j.item], [true, null]);
  chk('Speicher: Wert zu groß', (await U(st('cabc123'), { key: 'big', value: 'x'.repeat(20_001) }, anna)).s, 400);
  chk('Speicher: leerer Schlüssel', (await U(st('cabc123'), { key: '', value: '1' }, anna)).s, 400);
  chk('Speicher: ungültige Artefakt-Id', (await G('/artifacts/store/a%2Fb?key=x', anna)).s, 400);
  chk('Geteilt: nur bei veröffentlichten Artefakten', (await U(st('cabc123'), { key: 'k', value: '1', shared: true }, anna)).s, 400);
  const sh = await U(st(id), { key: 'bestenliste', value: '[{"n":"Anna","p":12}]', shared: true }, anna);
  chk('Geteilt: Anna schreibt in ihr veröffentlichtes Artefakt', [sh.s, sh.j.shared], [200, true]);
  chk('Geteilt: Ben liest und schreibt dieselben Daten', [(await G(st(id) + '?key=bestenliste&shared=1', ben)).j.item.value, (await U(st(id), { key: 'bestenliste', value: '[{"n":"Ben","p":20}]', shared: true }, ben)).s, (await G(st(id) + '?key=bestenliste&shared=1', anna)).j.item.value], ['[{"n":"Anna","p":12}]', 200, '[{"n":"Ben","p":20}]']);
  chk('Geteilt: getrennt von den persönlichen Daten', (await G(st(id) + '?key=bestenliste', ben)).j.item, null);
  chk('Geteilt: ohne Login lesbar (eine Zeile)', (await G(`/public/artifacts/${id}/store?key=bestenliste`)).j.item.value, '[{"n":"Ben","p":20}]');
  chk('Geteilt: Liste', (await G(st(id) + '?prefix=&shared=1', ben)).j.keys, ['bestenliste']);

  // ---------- KI im Artefakt ----------
  chk('KI: nur angemeldet', (await call('/artifacts/ask', { prompt: 'hi' })).s, 401);
  chk('KI: leere Frage', (await P('/artifacts/ask', { prompt: '  ' }, anna)).s, 400);
  const a1 = await P('/artifacts/ask', { prompt: 'Nenne eine Farbe' }, anna);
  chk('KI: Antwort', [a1.s, a1.j.text], [200, 'KI sagt: Nenne eine Farbe']);
  chk('KI: eigener Systemprompt für Artefakte', /KI in einer kleinen App/.test(asked[asked.length - 1][0].content), true);
  const a2 = await P('/artifacts/ask', { messages: [{ role: 'user', content: 'eins' }, { role: 'assistant', content: 'zwei' }, { role: 'user', content: 'drei' }] }, anna);
  chk('KI: Verlauf als Liste', [a2.j.text, asked[asked.length - 1].length], ['KI sagt: drei', 4]);
  chk('KI: zu lang', (await P('/artifacts/ask', { prompt: 'x'.repeat(12_001) }, anna)).s, 400);
  await db.setDoc('usage_limits/uid-ben', { uid: 'uid-ben', email: 'ben@x.de', s_start: db.nowIso(), s_tokens: 999999999, w_start: db.nowIso(), w_tokens: 999999999, total: 999999999 });
  const lim = await P('/artifacts/ask', { prompt: 'hallo' }, ben);
  chk('KI: Nutzungslimit gilt', [lim.s, lim.j.code], [429, 'limit']);

  // ---------- Veröffentlichung beenden ----------
  chk('Beenden', (await D(`/artifacts/shared/${id}`, anna)).j.ok, true);
  chk('Beendet: Seite, Rahmen und Daten weg', [(await page(`/s/${id}`)).s, (await page(`/s/${id}/frame`)).s, (await G(`/public/artifacts/${id}`)).s, (await U(st(id), { key: 'x', value: '1', shared: true }, anna)).s], [404, 404, 404, 400]);

  await finish();
})();
