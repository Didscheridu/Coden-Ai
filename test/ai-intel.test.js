// Umfassende Tests für die 10 KI-Intelligenz-, Verifikations-, Gedächtnis-, PDF- & Lernfunktionen
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
let fails = 0;
const chk = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : ` (bekam ${JSON.stringify(got)}, erwartet ${JSON.stringify(want)})`));
};

// Hilfsfunktion: echte minimale PDFs (unkomprimiert & FlateDecode) erzeugen
function buildSyntheticPdf({ pages = ['Hallo Seite 1'], compressed = false } = {}) {
  const objects = [];
  const addObj = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObj(''); // 1
  const pagesId = addObj('');   // 2
  const pageIds = [];

  for (const text of pages) {
    const safe = String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const streamStr = `BT\n/F1 12 Tf\n72 720 Td\n(${safe}) Tj\nET\n`;
    const payload = compressed ? zlib.deflateSync(Buffer.from(streamStr, 'latin1')) : Buffer.from(streamStr, 'latin1');
    const dict = compressed ? `<< /Length ${payload.length} /Filter /FlateDecode >>` : `<< /Length ${payload.length} >>`;
    const contentId = addObj(Buffer.concat([
      Buffer.from(`${dict}\nstream\n`, 'latin1'),
      payload,
      Buffer.from('\nendstream', 'latin1')
    ]));
    const pageId = addObj(`<< /Type /Page /Parent ${pagesId} 0 R /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const chunks = [Buffer.from('%PDF-1.4\n', 'latin1')];
  objects.forEach((obj, idx) => {
    chunks.push(Buffer.from(`${idx + 1} 0 obj\n`, 'latin1'));
    chunks.push(Buffer.isBuffer(obj) ? obj : Buffer.from(obj, 'latin1'));
    chunks.push(Buffer.from('\nendobj\n', 'latin1'));
  });
  chunks.push(Buffer.from('%%EOF\n', 'latin1'));
  return new Uint8Array(Buffer.concat(chunks));
}

(async () => {
  const Sandbox = require(path.join(root, 'server/sandbox.js'));
  const Intel = await import(pathToFileURL(path.join(root, 'js/ai-intel.js')).href);
  const Pdf = await import(pathToFileURL(path.join(root, 'js/pdf-chunker.js')).href);

  // ---------- 1. Mathe- & Code-Sandbox ----------
  chk('Sandbox rechnet Klammern, Brüche & Prozent korrekt', [
    Sandbox.evalMathExpression('(3 * 14 + 8) / 5').value,
    Sandbox.evalMathExpression('\\frac{144}{12} + √(81)').value,
    Sandbox.evalMathExpression('200 * 15%').value,
    Sandbox.evalMathExpression('5!').value
  ], [10, 21, 30, 120]);

  chk('Sandbox lehnt Division durch 0 und Variablen sicher ab', [
    Sandbox.evalMathExpression('10 / 0').ok,
    Sandbox.evalMathExpression('2 * x + 3').ok
  ], [false, false]);

  const eqOk = Sandbox.verifyEquation('3 * 14 + 8 = 50');
  const eqBad = Sandbox.verifyEquation('12 * 12 = 140');
  chk('Sandbox erkennt richtige und falsche Gleichung', [eqOk.match, eqBad.match], [true, false]);

  const jsOk = Sandbox.verifyJsSnippet('const arr = [1,2,3,4]; console.log(arr.reduce((a,b)=>a+b,0)); arr.length * 2;');
  chk('Sandbox führt sicheren JS-Code aus & sammelt console.log', [jsOk.ok, jsOk.ran, jsOk.logs[0], jsOk.result], [true, true, '10', '8']);

  const jsSyntaxErr = Sandbox.verifyJsSnippet('const x = ;');
  chk('Sandbox erkennt JS-Syntaxfehler', [jsSyntaxErr.ok, jsSyntaxErr.syntaxOk], [false, false]);

  const jsTimeout = Sandbox.verifyJsSnippet('while (true) {}');
  chk('Sandbox bricht Endlosschleife per Timeout ab', jsTimeout.ok, false);

  const jsEscapeBlock = Sandbox.verifyJsSnippet('[].constructor.constructor("return process")()');
  chk('Sandbox führt potenziellen Escape-Code nicht aus (nur Syntax)', [jsEscapeBlock.syntaxOk, jsEscapeBlock.ran], [true, false]);

  const batchBad = Sandbox.verifyBatch({ equations: ['7 * 8 = 54'], codeBlocks: [{ code: 'console.log(42);' }] });
  chk('verifyBatch meldet Rechenabweichung', [batchBad.ok, batchBad.discrepancies.length], [false, 1]);

  // ---------- 2. Auto-Router ----------
  chk('Auto-Router wählt Flash bei Smalltalk', Intel.routeModelForPrompt({ text: 'Hallo Coden!' }).tier, 'flash');
  chk('Auto-Router wählt Thinking bei Mathe/Erklärung', Intel.routeModelForPrompt({ text: 'Berechne das Integral von x^2 von 0 bis 3 Schritt für Schritt' }).tier, 'normal');
  chk('Auto-Router wählt Pro bei komplexem Coding', Intel.routeModelForPrompt({ text: 'Baue mir ein komplettes React-Spiel mit Canvas und WebSocket' }).tier, 'pro');
  chk('Auto-Router beachtet Pro-Sperre und weicht auf Thinking aus', Intel.routeModelForPrompt({
    text: 'Baue mir eine Express API mit SQL Datenbank',
    isOwner: false,
    lockedModels: { pro: true, thinking: false }
  }).tier, 'normal');
  chk('Auto-Router fällt bei doppelter Sperre auf Flash zurück', Intel.routeModelForPrompt({
    text: 'Baue mir eine Express API mit SQL Datenbank',
    isOwner: false,
    lockedModels: { pro: true, thinking: true }
  }).tier, 'flash');
  chk('Auto-Router behält Pro für Owner trotz Sperre', Intel.routeModelForPrompt({
    text: 'Baue mir eine Express API mit SQL Datenbank',
    isOwner: true,
    lockedModels: { pro: true, thinking: true }
  }).tier, 'pro');
  chk('Manuelle Modellwahl überschreibt Auto-Router', Intel.routeModelForPrompt({
    text: 'Hallo',
    selectedTier: 'pro'
  }), { tier: 'pro', auto: false, reason: '' });

  // ---------- 3. Chat-übergreifendes Gedächtnis ----------
  const fakeSessions = [
    { id: 'cur', title: 'Aktuell', temp: false, updatedAt: new Date().toISOString(), messages: [{ isUser: true, text: 'Frage zu Photosynthese' }] },
    { id: 'old-bio', title: 'Biologie Chloroplasten', temp: false, updatedAt: new Date().toISOString(), messages: [{ isUser: true, text: 'Wie läuft Photosynthese und Lichtreaktion im Chloroplast ab?' }, { isUser: false, text: 'Bei der Photosynthese wird Lichtenergie in ATP umgewandelt.' }] },
    { id: 'temp-chat', title: 'Photosynthese Geheim', temp: true, updatedAt: new Date().toISOString(), messages: [{ isUser: true, text: 'Photosynthese Chloroplast Lichtreaktion' }] },
    { id: 'old-math', title: 'Quadratische Gleichungen', temp: false, updatedAt: new Date().toISOString(), messages: [{ isUser: true, text: 'Wie geht die pq-Formel?' }] }
  ];
  const pastHits = Intel.searchPastChats(fakeSessions, 'cur', 'Erkläre mir noch einmal Photosynthese und Chloroplast');
  chk('Past-Chat-Suche findet passenden früheren Chat & ignoriert Temp/Aktuell', [pastHits.length, pastHits[0]?.sessionId], [1, 'old-bio']);
  chk('formatPastChatsPrompt baut sauberen Kontextblock', Intel.formatPastChatsPrompt(pastHits).includes('Biologie Chloroplasten'), true);

  // ---------- 4. Lernprofil, Tutor-Modus, Fakten-Check & Selbstprüfung ----------
  const lpPrompt = Intel.learningProfilePrompt({ grade: '10. Klasse', subjects: 'Mathe, Physik', goal: 'MSA Vorbereitung', depth: 'einfach' });
  chk('Lernprofil-Prompt enthält Stufe, Fächer, Ziel & Tiefe', [
    lpPrompt.includes('10. Klasse'),
    lpPrompt.includes('Mathe, Physik'),
    lpPrompt.includes('MSA Vorbereitung'),
    lpPrompt.includes('einfach')
  ], [true, true, true, true]);

  chk('Tutor-Modus-Prompt nur aktiv wenn eingeschaltet', [
    Intel.tutorModePrompt(false),
    Intel.tutorModePrompt(true).includes('TUTOR-MODUS IST AKTIV')
  ], ['', true]);

  chk('Fakten-Unsicherheitshinweis umschaltbar', [
    Intel.factConfidencePrompt(false),
    Intel.factConfidencePrompt(true).includes('FAKTEN- & UNSICHERHEITS-KENNZEICHNUNG')
  ], ['', true]);

  chk('Selbstprüfung greift bei Mathe/Code und ignoriert Smalltalk', [
    Intel.needsAutoSelfCheck('Hallo!', 'Hi, wie kann ich helfen?'),
    Intel.needsAutoSelfCheck('Was ist 12 * 15?', 'Rechnen wir gemeinsam:\n12 * 15 = 180.\nFertig!'),
    Intel.needsAutoSelfCheck('Schreib mir eine Sortierfunktion', '```js\nfunction sortNums(a){ return [...a].sort((x,y)=>x-y); }\n```')
  ], [false, true, true]);

  // ---------- 5. Schwachstellen-Tracker ----------
  let weak = [];
  weak = Intel.recordLearningOutcome(weak, { kind: 'quiz', ok: false, topic: 'Quiz: Bruchrechnung', subject: 'Mathe', item: 'Kehrwert bilden' });
  weak = Intel.recordLearningOutcome(weak, { kind: 'flashcard', ok: false, topic: 'Vokabeln Unit 3', item: 'to persuade' });
  chk('Schwachstellen zeichnen Quiz- und Karteikarten-Lücken auf', [weak.length, weak.some(w => w.topic === 'Bruchrechnung'), weak.some(w => w.source === 'flashcard')], [2, true, true]);
  weak = Intel.recordLearningOutcome(weak, { kind: 'quiz', ok: true, topic: 'Bruchrechnung' });
  chk('Richtige Antwort baut Schwachstelle ab', weak.some(w => w.topic === 'Bruchrechnung'), false);

  // ---------- 6. PDF-Extraktion & Chunking ----------
  const rawPdf = buildSyntheticPdf({ pages: ['Kapitel 1 Grundlagen der Mechanik Kraft gleich Masse mal Beschleunigung.', 'Kapitel 2 Hebelgesetz und Drehmoment auf Seite zwei erklaert.'], compressed: false });
  const pages1 = await Pdf.extractPdfTextPages(rawPdf);
  chk('Unkomprimiertes PDF extrahiert beide Seiten sauber', [pages1.length, pages1[0].text.includes('Mechanik'), pages1[1].text.includes('Hebelgesetz')], [2, true, true]);

  const zipPdf = buildSyntheticPdf({ pages: ['Komprimierter FlateDecode Text ueber Mitose und Zellteilung.', 'Zweite Seite ueber Meiose und Vererbung.'], compressed: true });
  const pages2 = await Pdf.extractPdfTextPages(zipPdf);
  chk('FlateDecode-PDF wird ohne externe CDNs entpackt', [pages2.length, pages2[0].text.includes('Mitose'), pages2[1].text.includes('Meiose')], [2, true, true]);

  const doc = Pdf.chunkDocumentPages(pages2, { title: 'Biologie-Skript.pdf', maxChunkChars: 110, overlap: 10 });
  const ret = Pdf.retrieveDocumentChunks([doc], 'Erkläre Seite 2 Meiose');
  chk('Chunk-Retrieval findet Seite 2 zuerst', ret.selected[0]?.chunk.pageStart, 2);

  const reqs = Pdf.parseDocReadRequests('Ich schaue nach: <doc_read doc="Biologie" pages="2"/>');
  const full = Pdf.fulfillDocReads([doc], reqs);
  chk('doc_read lädt angeforderte Seiten nach', [reqs.length, full.includes('Meiose')], [1, true]);

  // ---------- 7. UI- & Sicherheitsverträge ----------
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const chatToolsJs = fs.readFileSync(path.join(root, 'js/chat-tools.js'), 'utf8');
  const richJs = fs.readFileSync(path.join(root, 'js/rich-elements.js'), 'utf8');
  const apiJs = fs.readFileSync(path.join(root, 'api/index.js'), 'utf8');
  const storageJs = fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8');
  chk('UI & Sync-Listen enthalten alle neuen Features ohne CDN-Verstöße', [
    html.includes('id="tutor-mode-btn"'),
    html.includes('id="auto-mode-option"'),
    html.includes('id="lp-grade"'),
    html.includes('id="weak-topics-ui"'),
    !html.includes('cdn.'),
    chatToolsJs.includes('ma-refine-row') && chatToolsJs.includes('Mehr Beispiele'),
    richJs.includes('codenLearningEvent'),
    apiJs.includes("'learningProfile', 'weakTopics', 'tutorMode', 'aiPrefs'"),
    storageJs.includes("'learningProfile', 'weakTopics', 'tutorMode', 'aiPrefs'")
  ], [true, true, true, true, true, true, true, true, true]);

  // ---------- 8. HTTP-Endpunkt /api/sandbox/verify ----------
  const firestore = require(path.join(root, 'server/firestore'));
  firestore.enableMemoryDb();
  firestore.clearMemoryDb();
  require(path.join(root, 'server/rateLimit'))._clearRateLimits();
  const jose = await import('jose');
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const jwksServer = require('http').createServer((q, r) => { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise(r => jwksServer.listen(0, r));
  const PROJECT = 'coden-4561f';
  const userTok = await new jose.SignJWT({ sub: 'u-sandbox', email: 's@test.de', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setAudience(PROJECT).setIssuer(`https://securetoken.google.com/${PROJECT}`).setIssuedAt().setExpirationTime('1h').sign(privateKey);
  Object.assign(process.env, { CODEN_TEST_DB: 'memory', ADMIN_EMAIL: 'admin@test.de', FIREBASE_PROJECT_ID: PROJECT, FIREBASE_JWKS_URL: `http://127.0.0.1:${jwksServer.address().port}/jwks` });
  const app = require(path.join(root, 'api/index.js'));
  await new Promise((resolve) => {
    const srv = app.listen(0, async () => {
      try {
        const url = `http://127.0.0.1:${srv.address().port}/api/sandbox/verify`;
        const unauth = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        chk('POST /api/sandbox/verify ohne Login -> 401', unauth.status, 401);

        const badBody = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + userTok }, body: '[]' });
        chk('POST /api/sandbox/verify mit Array-Body -> 400', badBody.status, 400);

        const good = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + userTok },
          body: JSON.stringify({ equations: ['15 * 4 = 60', '2 + 2 = 5'], codeBlocks: [{ code: 'console.log(3 + 4);' }] })
        });
        const j = await good.json();
        chk('POST /api/sandbox/verify prüft Gleichungen & Code', [
          good.status,
          j.ok,
          j.discrepancies.length,
          j.mathResults[0].match,
          j.codeResults[0].logs[0]
        ], [200, false, 1, true, '7']);
      } finally {
        srv.close();
        jwksServer.close();
        resolve();
      }
    });
  });

  if (fails) process.exit(1);
  console.log('\nAlle KI-Intelligenz-, Sandbox- & PDF-Tests bestanden.');
})().catch(e => { console.error(e); process.exit(1); });
