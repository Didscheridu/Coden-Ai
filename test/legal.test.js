// Rechtliche & DSGVO-Compliance-Tests:
// 1) Self-Hosting von Fonts & Vendor-Bibliotheken (keine IP-Leaks beim Laden)
// 2) DSGVO-Datenexport (/api/account/export) ohne Geheimnis-Leaks & Kontolöschung (DELETE /api/account)
// 3) Öffentliche Seiten (/a/, /s/, /api/public/img/) mit Impressum, Datenschutz, Melden & KI-Kennzeichnung
const fs = require('fs');
const path = require('path');
const { setup } = require('./helpers');

const root = path.join(__dirname, '..');

(async () => {
  const { call, chk, finish, token, base, db } = await setup();
  const origin = base.replace(/\/api$/, '');

  // --- 1. Statische Self-Hosting- & HTML-Prüfung ---
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  chk('index.html lädt keine Google Fonts direkt', /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html), false);
  chk('index.html lädt keine CDN-Skripte direkt beim Start', /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|code\.jquery\.com/.test(html), false);
  chk('index.html bindet lokale Schriftarten & Vendor-Skripte ein', [
    html.includes('css/vendor/fonts.css'),
    html.includes('js/vendor/marked.min.js'),
    html.includes('js/vendor/purify.min.js'),
    html.includes('css/vendor/katex/katex.min.css'),
    html.includes('js/vendor/katex.min.js'),
    html.includes('js/vendor/highlight.min.js')
  ], [true, true, true, true, true, true]);
  chk('index.html hat Pflichtlinks vor Login', [
    html.includes('data-legal="impressum"'),
    html.includes('data-legal="kontakt"'),
    html.includes('data-legal="datenschutz"'),
    html.includes('data-legal="agb"'),
    html.includes('data-legal="ki"')
  ], [true, true, true, true, true]);
  chk('index.html weist sichtbar auf kostenlose KI-Modelle & mögliches Training hin', [
    html.includes('kostenlose KI-Modelle') && html.includes('Training'),
    html.includes('keine Geheimnisse senden')
  ], [true, true]);

  const legalJs = fs.readFileSync(path.join(root, 'js/legal.js'), 'utf8');
  chk('legal.js enthält Hausnummer 67, Kontaktformular & keine alten Platzhalter', [
    legalJs.includes('Lerchesflurweg 67'),
    legalJs.includes('[Hausnummer'),
    legalJs.includes('[Telefonnummer'),
    legalJs.includes('id="contact-form"'),
    legalJs.includes('Free-Tier-APIs'),
    legalJs.includes('zum Training bzw. zur Verbesserung ihrer KI-Modelle verwendet werden'),
    legalJs.includes('keine vertraulichen Informationen'),
    legalJs.includes('Einstellungen → Modelle &amp; Keys (BYOK)')
  ], [true, false, false, true, true, true, true, true]);

  // Alle in fonts.css und katex.min.css referenzierten Dateien existieren lokal
  const fontsCss = fs.readFileSync(path.join(root, 'css/vendor/fonts.css'), 'utf8');
  const fontRefs = [...fontsCss.matchAll(/url\(([^)]+)\)/g)].map(m => m[1].replace(/['"]/g, ''));
  chk('fonts.css enthält lokale Schriftdateien ohne http(s)-URLs', fontRefs.length > 0 && fontRefs.every(u => !/^https?:/i.test(u) && fs.existsSync(path.join(root, 'css/vendor', u))), true);

  const katexCss = fs.readFileSync(path.join(root, 'css/vendor/katex/katex.min.css'), 'utf8');
  const katexRefs = [...katexCss.matchAll(/url\(([^)]+)\)/g)].map(m => m[1].replace(/['"]/g, ''));
  chk('katex.min.css referenziert nur vorhandene lokale Dateien', katexRefs.length > 0 && katexRefs.every(u => !/^https?:/i.test(u) && fs.existsSync(path.join(root, 'css/vendor/katex', u))), true);

  // --- 2. DSGVO Export & Kontolöschung ---
  const alice = await token({ sub: 'uid-alice', email: 'alice@example.de', email_verified: true });
  const bob = await token({ sub: 'uid-bob', email: 'bob@example.de', email_verified: true });

  chk('Export ohne Login abgelehnt', (await call('/account/export')).s, 401);
  chk('Löschen ohne Login abgelehnt', (await call('/account', null, null, 'DELETE')).s, 401);

  await call('/data', {
    sessions: [{ id: 's1', title: 'Mein Chat', messages: [{ text: 'Hallo', isUser: true }] }],
    settings: { userName: 'Alice', fontSize: 16, apiKey: 'GEHEIM_API', emailConfig: { provider: 'gmail', address: 'alice@gmail.com', password: 'GEHEIM_MAIL_PW' } }
  }, alice, 'PUT');
  await call('/data', {
    sessions: [{ id: 'b1', title: 'Bobs Chat', messages: [] }],
    settings: { userName: 'Bob' }
  }, bob, 'PUT');

  await db.setDoc('user_provider_keys/uid-alice__openai', { uid: 'uid-alice', provider: 'openai', key_enc: 'enc_secret_xyz', hint: 'sk-...123', created_at: db.nowIso() });
  await db.setDoc('mcp_connections/101', { id: 101, uid: 'uid-alice', name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', auth_type: 'oauth', enabled: true, token_enc: 'secret_tok', oauth_enc: 'secret_oauth' });
  await db.setDoc('profiles/uid-alice', { uid: 'uid-alice', handle: 'alice99', display_name: 'Alice' });
  await db.setDoc('buddy_handles/alice99', { uid: 'uid-alice', handle: 'alice99' });
  await db.setDoc('user_projects/55', { id: 55, uid: 'uid-alice', name: 'Projekt A', description: '', instructions: '', files: {}, color: '#111111' });
  await db.setDoc('study/uid-alice/pages/page1', { id: 'page1', doc: 'heft1', idx: 0, paper: 'karo', strokes: '[]' });

  const appRes = await call('/apps', { name: 'LegalTestApp', kind: 'web', files: { 'index.html': '<!doctype html><html><body>Hi</body></html>' } }, alice, 'POST');
  const appId = appRes.j.app.id;
  await call(`/apps/${appId}/publish`, { slug: 'legal-test-app' }, alice, 'POST');
  const artRes = await call('/artifacts/share', { title: 'TestArtefakt', type: 'html', html: '<!doctype html><html><body>Art</body></html>' }, alice, 'POST');
  const artId = artRes.j.id;

  // Öffentliche Wrapper prüfen
  const pubAppHtml = await (await fetch(`${origin}/a/legal-test-app/`)).text();
  chk('Öffentliche App enthält Impressum, Datenschutz, Melden & KI-Hinweis', [
    pubAppHtml.includes('href="/?legal=impressum"'),
    pubAppHtml.includes('href="/?legal=datenschutz"'),
    pubAppHtml.includes('mailto:kayden.schunack@gmail.com'),
    pubAppHtml.includes('Mit Coden (KI) gebaut')
  ], [true, true, true, true]);

  const pubArtHtml = await (await fetch(`${origin}/s/${artId}`)).text();
  chk('Öffentliches Artefakt enthält Impressum, Datenschutz, Melden & KI-Hinweis', [
    pubArtHtml.includes('href="/?legal=impressum"'),
    pubArtHtml.includes('href="/?legal=datenschutz"'),
    pubArtHtml.includes('mailto:kayden.schunack@gmail.com'),
    pubArtHtml.includes('Mit Coden (KI) erstellt')
  ], [true, true, true, true]);

  // Öffentliches KI-Bild liefert X-AI-Generated Header
  await db.setDoc('app_images/aabbccddeeff001122', {
    key: 'aabbccddeeff001122', uid: 'uid-alice', prompt: 'sunset', mime: 'image/png', data_b64: Buffer.from([137, 80, 78, 71]).toString('base64')
  });
  const imgResp = await fetch(`${origin}/api/public/img/aabbccddeeff001122`);
  chk('KI-Bild trägt X-AI-Generated Header', [imgResp.status, imgResp.headers.get('x-ai-generated')], [200, 'true']);

  // --- 4. Kontaktformular-API (/api/contact) ---
  const owner = await token({ sub: 'uid-owner', email: 'admin@test.de', email_verified: true });
  chk('Kontakt ohne Login Liste abgelehnt', (await call('/contact')).s, 401);
  chk('Kontakt lehnt fehlende Datenschutz-Bestätigung ab', (await call('/contact', {
    name: 'Alice', email: 'alice@example.de', topic: 'allgemein', subject: 'Test Betreff', message: 'Hallo liebes Coden Team!'
  })).s, 400);
  chk('Kontakt lehnt NoSQL-Operator-Objekt im Feld ab', (await call('/contact', {
    name: { $gt: '' }, email: 'alice@example.de', subject: 'Test', message: 'Nachricht lang genug', privacyAccepted: true
  })).s, 400);
  const botRes = await call('/contact', {
    name: 'SpamBot', email: 'bot@spam.de', subject: 'Spam', message: 'Spam Text hier', website: 'https://spam.example', privacyAccepted: true
  });
  chk('Kontakt Honeypot filtert Bots ohne DB-Eintrag', [botRes.s, botRes.j.delivered], [200, 'filtered']);

  const cAlice = await call('/contact', {
    name: 'Alice', email: 'alice@example.de', topic: 'bug', subject: 'Feedback zum Editor', message: 'Hallo Kayden, der Editor gefällt mir sehr gut!', privacyAccepted: true
  }, alice);
  const cBob = await call('/contact', {
    name: 'Bob', email: 'bob@example.de', topic: 'allgemein', subject: 'Frage zu Modellen', message: 'Hallo, wie kann ich eigene Keys nutzen?', privacyAccepted: true
  }, bob);
  chk('Kontaktformular speichert Anfragen sauber', [cAlice.s, cAlice.j.ok, cBob.s, cBob.j.ok], [201, true, 201, true]);

  const aliceInbox = await call('/contact', null, alice);
  const ownerInbox = await call('/contact', null, owner);
  chk('Nutzer sieht nur eigene Kontaktanfragen, Owner sieht alle', [
    aliceInbox.j.items?.length,
    aliceInbox.j.items?.[0]?.subject,
    ownerInbox.j.items?.length >= 2
  ], [1, 'Feedback zum Editor', true]);

  chk('Normaler Nutzer darf fremde Anfrage nicht ändern oder löschen', [
    (await call(`/contact/${cBob.j.id}`, { status: 'done' }, alice, 'PATCH')).s,
    (await call(`/contact/${cBob.j.id}`, null, alice, 'DELETE')).s
  ], [403, 403]);
  chk('Owner darf Anfrage auf erledigt setzen', (await call(`/contact/${cBob.j.id}`, { status: 'done' }, owner, 'PATCH')).j.status, 'done');

  // Export prüfen (Art. 20 DSGVO)
  const exp = await call('/account/export', null, alice);
  const expText = JSON.stringify(exp.j);
  chk('Export liefert Nutzerdaten ohne Geheimnisse', [
    exp.s,
    exp.j.account?.uid,
    exp.j.chats?.[0]?.title,
    exp.j.projects?.length,
    exp.j.apps?.length,
    exp.j.sharedArtifacts?.length,
    exp.j.byok?.providers?.[0]?.hint,
    exp.j.contactMessages?.length,
    expText.includes('GEHEIM_MAIL_PW'),
    expText.includes('enc_secret_xyz'),
    expText.includes('secret_tok'),
    expText.includes('secret_oauth')
  ], [200, 'uid-alice', 'Mein Chat', 1, 1, 1, 'sk-...123', 1, false, false, false, false]);

  // Löschung prüfen (Art. 17 DSGVO)
  const del = await call('/account', null, alice, 'DELETE');
  chk('Konto-Löschung erfolgreich', [del.s, del.j.ok], [200, true]);
  chk('Nach Löschung: Daten, App, Artefakt, Profil, Handle & Kontaktanfrage weg', [
    (await call('/data', null, alice)).j.exists,
    (await fetch(`${origin}/a/legal-test-app/`)).status,
    (await fetch(`${origin}/s/${artId}`)).status,
    await db.getDoc('profiles/uid-alice'),
    await db.getDoc('buddy_handles/alice99'),
    await db.getDoc('user_provider_keys/uid-alice__openai'),
    await db.getDoc('study/uid-alice/pages/page1'),
    await db.getDoc(`contact_messages/${cAlice.j.id}`)
  ], [false, 404, 404, null, null, null, null, null]);

  // Bobs Daten bleiben unangetastet!
  const bobAfter = await call('/data', null, bob);
  chk('Fremde Nutzerdaten bleiben nach Löschung erhalten', [bobAfter.s, bobAfter.j.exists, bobAfter.j.sessions?.[0]?.title], [200, true, 'Bobs Chat']);

  await finish();
})();
