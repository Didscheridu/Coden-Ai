// Tests für Feature #4 (PDF-Export), Feature #6 (Formelsammlung & Rechner),
// Feature #10 (Anki-/Quizlet-Import & Schulbuch-Scanner) sowie Coden-Handschrift im Heft (<notebook_write>).
const path = require('path');
const { pathToFileURL } = require('url');

let fails = 0;
const chk = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : ` (bekam ${JSON.stringify(got)}, erwartet ${JSON.stringify(want)})`));
};

// Minimales synthetisches JPEG (SOI + SOF0 mit Breite/Höhe + EOI) zum Testen von jpegDimensions & buildPdfBytes
function makeSyntheticJpegDataUrl(w, h) {
  const bytes = Uint8Array.from([
    0xFF, 0xD8,             // SOI
    0xFF, 0xC0, 0x00, 0x0B, // SOF0, length 11
    0x08,                   // precision 8 bit
    (h >> 8) & 0xFF, h & 0xFF,
    (w >> 8) & 0xFF, w & 0xFF,
    0x03,                   // 3 components (RGB/YCbCr)
    0x01, 0x11, 0x00,
    0xFF, 0xD9              // EOI
  ]);
  return 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
}

(async () => {
  const Pdf = await import(pathToFileURL(path.join(__dirname, '../js/pdf-export.js')).href);
  const F = await import(pathToFileURL(path.join(__dirname, '../js/formula-helper.js')).href);
  const Imp = await import(pathToFileURL(path.join(__dirname, '../js/study-import-core.js')).href);
  const S = await import(pathToFileURL(path.join(__dirname, '../js/study-core.js')).href);

  // ---------- 1. PDF-Export (Feature #4) ----------
  const jpgPortrait = makeSyntheticJpegDataUrl(1240, 1754);
  const jpgLandscape = makeSyntheticJpegDataUrl(1600, 900);
  const rawPortrait = Uint8Array.from(Buffer.from(jpgPortrait.split(',')[1], 'base64'));
  chk('PDF: JPEG-Maße korrekt erkannt', Pdf.jpegDimensions(rawPortrait), { width: 1240, height: 1754 });
  chk('PDF: Ungültige JPEG-Bytes → null', Pdf.jpegDimensions(Uint8Array.from([1, 2, 3])), null);

  const pdfBytes = Pdf.buildPdfBytes([jpgPortrait, jpgLandscape]);
  const pdfText = Buffer.from(pdfBytes).toString('latin1');
  chk('PDF: Gültiger %PDF-1.4 Header, 2 Seiten, Querformat + Hochformat, xref und %%EOF', [
    pdfText.startsWith('%PDF-1.4\n'),
    pdfText.includes('/Type /Pages /Kids [3 0 R 6 0 R] /Count 2'),
    pdfText.includes('/MediaBox [0 0 595.28 841.89]'),
    pdfText.includes('/MediaBox [0 0 841.89 595.28]'),
    pdfText.includes('xref\n0 9\n'),
    pdfText.trimEnd().endsWith('%%EOF')
  ], [true, true, true, true, true, true]);

  let emptyThrew = false;
  try { Pdf.buildPdfBytes([]); } catch (_) { emptyThrew = true; }
  chk('PDF: Leere Seitenliste wirft Fehler', emptyThrew, true);
  chk('PDF: Dateiname sicher bereinigt', [
    Pdf.safePdfFilename('Mathe: Quadratik / 10a'),
    Pdf.safePdfFilename('Chemie.pdf'),
    Pdf.safePdfFilename('   ')
  ], ['Mathe Quadratik 10a.pdf', 'Chemie.pdf', 'Notizbuch.pdf']);

  // ---------- 2. Formelsammlung & Rechner (Feature #6) ----------
  chk('Formelsammlung: Mathe-Suche findet Satz des Pythagoras',
    F.filterFormulas('pythagoras', 'mathe').map(x => x.id),
    ['m_pyth']);
  chk('Formelsammlung: Fachfilter schließt andere Fächer aus',
    F.filterFormulas('energie', 'mathe').length,
    0);
  chk('Formelsammlung: Alle-Filter findet Physik-Energie',
    F.filterFormulas('energie', 'alle').some(x => x.id === 'p_e'),
    true);

  chk('Einheiten: km/h <-> m/s und °C <-> K <-> °F', [
    Math.round(F.convertUnit(36, 'geschwindigkeit', 'kmh', 'ms').value * 100) / 100,
    Math.round(F.convertUnit(25, 'geschwindigkeit', 'ms', 'kmh').value * 100) / 100,
    Math.round(F.convertUnit(20, 'temperatur', 'C', 'K').value * 100) / 100,
    Math.round(F.convertUnit(212, 'temperatur', 'F', 'C').value * 100) / 100,
    Math.round(F.convertUnit(2.5, 'laenge', 'km', 'm').value)
  ], [10, 90, 293.15, 100, 2500]);

  chk('Formel-Rechner: Punkt-vor-Strich, Klammern, Wurzel, Trigonometrie, Unicode', [
    F.evaluateMathExpr('2 + 3 · 4').value,
    F.evaluateMathExpr('(2 + 3) * 4 - 2²').value,
    F.evaluateMathExpr('√(9 + 16)').value,
    Math.round(F.evaluateMathExpr('sin(30)').value * 1000) / 1000,
    Math.round(F.evaluateMathExpr('2 · π · 5').value * 100) / 100,
    F.evaluateMathExpr('1,5 + 2,5').value
  ], [14, 16, 5, 0.5, 31.42, 4]);

  chk('Formel-Rechner: Division durch 0 und unsicherer Code abgelehnt', [
    F.evaluateMathExpr('5 / (3 - 3)').ok,
    F.evaluateMathExpr('process.exit(1)').ok,
    F.evaluateMathExpr('alert(1)').ok
  ], [false, false, false]);

  // ---------- 3. Anki-/Quizlet-Import & Schulbuch-Scanner (Feature #10) ----------
  const ankiRaw = [
    '#separator:tab',
    '#html:true',
    'photosynthesis\t<b>Fotosynthese</b><br>Umwandlung von Lichtenergie',
    'mitochondria\tKraftwerk &amp; Energiequelle der Zelle',
    'kaputtezeileohnetrenner'
  ].join('\n');
  const ankiRes = Imp.parseFlashcardsImport(ankiRaw);
  chk('Anki-Import: Header, HTML-Bereinigung & übersprungene Zeile', [
    ankiRes.detectedDelimiter,
    ankiRes.cards.length,
    ankiRes.skipped,
    ankiRes.cards[0].front,
    ankiRes.cards[0].back,
    ankiRes.cards[1].back
  ], [
    '\t',
    2,
    1,
    'photosynthesis',
    'Fotosynthese\nUmwandlung von Lichtenergie',
    'Kraftwerk & Energiequelle der Zelle'
  ]);

  const quizletCsv = [
    'Front,Back',
    '"Osmose, Diffusion",Stofftransport durch Membran',
    '"ATP","Adenosintriphosphat"'
  ].join('\n');
  const csvRes = Imp.parseFlashcardsImport(quizletCsv);
  chk('Quizlet-CSV: Kopfzeile übersprungen & Anführungszeichen korrekt', [
    csvRes.detectedDelimiter,
    csvRes.cards.length,
    csvRes.cards[0].front,
    csvRes.cards[0].back
  ], [',', 2, 'Osmose, Diffusion', 'Stofftransport durch Membran']);

  const quizletColon = Imp.parseFlashcardsImport('der Tisch :: the table\ndie Tür :: the door');
  chk('Quizlet Copy-Paste (::): beide Karten geparst', [
    quizletColon.detectedDelimiter,
    quizletColon.cards.map(c => [c.front, c.back])
  ], [' :: ', [['der Tisch', 'the table'], ['die Tür', 'the door']]]);

  const scanPromptsCards = Imp.textbookScanPrompts({ mode: 'cards', subject: 'Biologie' });
  chk('Schulbuch-Scan Prompts enthalten Fach & JSON-Format', [
    scanPromptsCards.system.includes('Biologie'),
    scanPromptsCards.user.includes('"cards"')
  ], [true, true]);

  const scanCards = Imp.parseTextbookScan('```json\n{"title":"Zellatmung","cards":[{"front":"Glykolyse","back":"Abbau von Glukose zu Pyruvat"}]}\n```', 'cards');
  chk('Schulbuch-Scan Parser: Karteikarten aus JSON-Codeblock', [
    scanCards.title,
    scanCards.cards.length,
    scanCards.cards[0].front
  ], ['Zellatmung', 1, 'Glykolyse']);

  const scanNote = Imp.parseTextbookScan('# Zellaufbau Überblick\n\n- Zellkern steuert Abläufe', 'notes');
  chk('Schulbuch-Scan Parser: Lernnotiz extrahiert Titel', scanNote.title, 'Zellaufbau Überblick');

  // ---------- 4. Coden-Handschrift direkt im Heft (<notebook_write>) ----------
  const chatReply = [
    'Ich schreibe dir die Lösung direkt auf die Seite:',
    '<notebook_write page="current" paper="karo" ink="#143f8c">',
    '# Aufgabe 1',
    '3x + 6 = 21 | -6',
    '3x = 15',
    '==x = 5==',
    '</notebook_write>',
    'Melde dich, wenn wir die nächste Aufgabe machen sollen.'
  ].join('\n');

  const writes = S.parseNotebookWrites(chatReply);
  chk('parseNotebookWrites erkennt Modus, Papier, Tinte und Inhalt', [
    writes.length,
    writes[0].mode,
    writes[0].paper,
    writes[0].ink,
    writes[0].text.includes('==x = 5==')
  ], [1, 'append', 'karo', '#143f8c', true]);

  const stripped = S.stripNotebookWriteTags(chatReply);
  chk('stripNotebookWriteTags ersetzt Block sauber ohne Rohtags', [
    stripped.includes('<notebook_write'),
    stripped.includes('In deiner Handschrift direkt ins Heft geschrieben'),
    stripped.includes('Melde dich')
  ], [false, true, true]);

  const streaming = 'Moment:\n<notebook_write page="new">\n# Merksatz';
  chk('stripNotebookWriteTags erkennt ungeschlossenes Streaming-Tag', [
    S.stripNotebookWriteTags(streaming).includes('<notebook_write'),
    S.stripNotebookWriteTags(streaming).includes('Schreibt in deiner Handschrift')
  ], [false, true]);

  console.log(fails ? `\n${fails} Fehler` : '\nAlle neuen Schüler-Feature-Tests grün');
  process.exit(fails ? 1 : 0);
})();
