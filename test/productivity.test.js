// Tests für Schüler-Produktivität: Slash-Befehle, Word(.docx)/Folien/Zitate-Export & Smart-Diktat
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let fails = 0;
const chk = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : ` (bekam ${JSON.stringify(got)}, erwartet ${JSON.stringify(want)})`));
};

(async () => {
  const SC = await import(pathToFileURL(path.join(__dirname, '../js/slash-commands.js')).href);
  const DE = await import(pathToFileURL(path.join(__dirname, '../js/doc-export.js')).href);
  const DS = await import(pathToFileURL(path.join(__dirname, '../js/dictation-smart.js')).href);

  // 1. Slash-Befehle (für alle Nutzer + Owner-Trennung)
  const normUserMatches = SC.matchSlashCommands('/z', { isOwner: false });
  chk('Normaler Nutzer sieht /zusammenfassen & /zitate', normUserMatches.items.map(i => i.name), ['/zusammenfassen', '/zitate']);

  const ownerLockHidden = SC.matchSlashCommands('/lock', { ownerCommands: [{ name: '/lock', desc: 'Lock' }], isOwner: false });
  chk('Owner-Befehl bleibt für normale Nutzer unsichtbar', ownerLockHidden.items.length, 0);

  const ownerLockShown = SC.matchSlashCommands('/lock', { ownerCommands: [{ name: '/lock', desc: 'Lock' }], isOwner: true });
  chk('Owner sieht Owner-Befehle im Popup', ownerLockShown.items.map(i => i.name), ['/lock']);

  const resZus = SC.resolvePublicSlash('/zusammenfassen Fotosynthese');
  chk('resolvePublicSlash für /zusammenfassen liefert Prompt', [resZus.kind, resZus.prompt.includes('Fotosynthese')], ['prompt', true]);

  const resBrUrl = SC.resolvePublicSlash('/browser wikipedia.org');
  chk('/browser mit URL startet direkte Aktion', resBrUrl, { kind: 'action', action: 'open-browser', param: 'wikipedia.org' });

  const resBrQuery = SC.resolvePublicSlash('/browser amazon.de Bluetooth Kopfhörer');
  chk('/browser mit Suchbegriff liefert Prompt + openBrowserQuery', [resBrQuery.kind, resBrQuery.openBrowserQuery], ['prompt', 'amazon.de Bluetooth Kopfhörer']);

  // 2. Word (.docx) OOXML + Stored ZIP Generator
  const docx = DE.generateDocxBytes({
    title: 'Referat Klimawandel',
    markdown: '# Ursachen\n\nTreibhausgase wie **CO2** erwärmen die Erde.\n\n- Verkehr\n- Energie\n\n> Merksatz: Sparen hilft.'
  });
  const decoder = new TextDecoder('utf-8');
  const rawDocxStr = decoder.decode(docx);
  chk('Word-Export erzeugt gültigen ZIP/OOXML Header & Inhalt', [
    docx[0] === 0x50 && docx[1] === 0x4b && docx[2] === 0x03 && docx[3] === 0x04,
    rawDocxStr.includes('[Content_Types].xml'),
    rawDocxStr.includes('word/document.xml'),
    rawDocxStr.includes('word/styles.xml'),
    rawDocxStr.includes('Referat Klimawandel'),
    rawDocxStr.includes('CO2')
  ], [true, true, true, true, true, true]);

  // 3. Präsentations-Folien Konverter
  const slides = DE.markdownToSlides('Solaranlage', '# Funktion\n\nSonnenlicht wird zu Strom.\n\n# Vorteile\n\n- Sauber\n- Günstig');
  chk('markdownToSlides trennt Folien mit ---', [slides.includes('---'), slides.includes('# Funktion'), slides.includes('# Vorteile')], [true, true, true]);

  // 4. Zitier- & Quellenverzeichnis-Formatierung
  const srcText = 'Mehr auf [Wikipedia Solar](https://de.wikipedia.org/wiki/Photovoltaik) und https://www.umweltbundesamt.de/energie.';
  const cites = DE.extractCitations(srcText);
  chk('extractCitations findet Markdown-Link und nackte URL', [cites.length, cites[0].title, cites[1].domain], [2, 'Wikipedia Solar', 'umweltbundesamt.de']);

  const apa = DE.formatBibliography(srcText, 'apa');
  const harvard = DE.formatBibliography(srcText, 'harvard');
  const schule = DE.formatBibliography(srcText, 'schule');
  chk('Quellenverzeichnis unterstützt Schule, APA & Harvard', [
    schule.includes('[1] Wikipedia Solar'),
    apa.includes('Literaturverzeichnis (APA)'),
    harvard.includes('Quellenverzeichnis (Harvard)')
  ], [true, true, true]);

  // 5. Smart-Diktat
  const tasksOut = DS.smartStructureDictation('Mathe Seite 42 Nummer 3 bis morgen außerdem Englisch Vokabeln lernen', 'smart');
  chk('Smart-Diktat erkennt Aufgaben und gliedert Checkliste', [
    tasksOut.startsWith('### Aufgaben'),
    tasksOut.includes('- [ ] **Mathe:**'),
    tasksOut.includes('- [ ] **Englisch:**')
  ], [true, true, true]);

  const notesOut = DS.smartStructureDictation('Erstens Wasser kocht bei 100 Grad zweitens Eis schmilzt bei 0 Grad drittens Dampf ist unsichtbar', 'smart');
  chk('Smart-Diktat formatiert mehrere Punkte als Notizen', [notesOut.startsWith('### Notizen'), notesOut.includes('- Wasser kocht')], [true, true]);

  chk('Normales Diktat lässt Text unverändert', DS.smartStructureDictation('hallo welt', 'normal'), 'hallo welt');

  // 6. Schutz bestehender Verträge (shortcuts.test.js & legal.test.js & kein Pomodoro-Timer)
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const accJs = fs.readFileSync(path.join(__dirname, '../js/account-menu.js'), 'utf8');
  chk('index.html behält exaktes #main-input Markup & keine externen CDNs', [
    html.includes('id="main-input" rows="1" placeholder="Nachricht an Coden … (\'/\' für Befehle)" title="Eingabefeld fokussieren (Strg+/)"'),
    !html.includes('cdn.'),
    !accJs.includes("document.addEventListener('keydown'")
  ], [true, true, true]);

  if (fails) process.exit(1);
  console.log('\nAlle Produktivitäts-Tests bestanden.');
})().catch(e => { console.error(e); process.exit(1); });
