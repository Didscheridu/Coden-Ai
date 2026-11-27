// Tests für die Chat-Vorlesefunktion (js/speech.js + js/chat-tools.js)
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
  const S = await import(pathToFileURL(path.join(__dirname, '../js/speech.js')).href);

  // 1. Erklärung + Code bleiben beim Vorlesen erhalten
  const md = [
    '# Lösung',
    'Hier ist eine ==grün:wichtige== Funktion mit [Doku](https://example.com):',
    '',
    '```js',
    'function sum(a, b) {',
    '  return a + b;',
    '}',
    '```',
    '',
    '<suggestions>Nächste Frage</suggestions><remember>Merksatz</remember>'
  ].join('\n');

  const spoken = S.toSpeakableText(md);
  chk('toSpeakableText behält Erklärung und Code und entfernt interne Tags', [
    spoken.includes('Lösung.'),
    spoken.includes('Hier ist eine wichtige Funktion mit Doku:'),
    spoken.includes('Code (js):'),
    spoken.includes('function sum(a, b)'),
    spoken.includes('return a + b;'),
    spoken.includes('Nächste Frage'),
    spoken.includes('Merksatz')
  ], [true, true, true, true, true, false, false]);

  // 2. Artefakt-Inhalt wird ebenfalls vorgelesen
  const artSpoken = S.toSpeakableText('Ergebnis:\n<artifact type="code" title="Rechner">\nconst x = 42;\n</artifact>');
  chk('toSpeakableText liest Artefakt-Titel und Code', [
    artSpoken.includes('Artefakt Rechner:'),
    artSpoken.includes('const x = 42;')
  ], [true, true]);

  // 3. Spracherkennung (de-DE / en-US)
  chk('detectSpeechLang erkennt Deutsch und Englisch korrekt', [
    S.detectSpeechLang('Hier ist der Code:\n```js\nconst hello = "world";\n```'),
    S.detectSpeechLang('Here is a function that explains the result below.')
  ], ['de-DE', 'en-US']);

  // 4. Chunking langer Antworten
  const longText = Array.from({ length: 12 }, (_, i) => `Dies ist Satz Nummer ${i + 1} mit etwas Erklärung zum Code.`).join(' ');
  const chunks = S.splitSpeechChunks(longText, 120);
  chk('splitSpeechChunks teilt lange Antworten sauber unter maxLen', [
    chunks.length > 1,
    chunks.every(c => c.length <= 120),
    chunks.join(' ').includes('Nummer 12')
  ], [true, true, true]);

  // 5. SpeechController Playback, Sequenzierung, Toggle-Stop & Wechsel
  let unsupportedErr = null;
  const noSynth = S.createSpeechController({ getSynth: () => null, getUtterance: () => null });
  const okUnsupported = noSynth.speak('Hallo', { onError: (e) => { unsupportedErr = e; } });
  chk('Ohne SpeechSynthesis meldet Controller unsupported', [okUnsupported, unsupportedErr], [false, 'unsupported']);

  const spokenQueue = [];
  let cancelCount = 0;
  class FakeUtterance {
    constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.voice = null; this.onend = null; this.onerror = null; }
  }
  const fakeSynth = {
    getVoices: () => [{ lang: 'de-DE', name: 'Anna' }],
    cancel: () => { cancelCount++; },
    speak: (u) => { spokenQueue.push(u); }
  };

  const events = [];
  const ctrl = S.createSpeechController({ getSynth: () => fakeSynth, getUtterance: () => FakeUtterance, chunkSize: 50 });
  const rowA = { id: 'a' };
  const rowB = { id: 'b' };

  ctrl.speak('Erster Abschnitt zur Erklärung. Zweiter Abschnitt mit Details.', {
    key: rowA,
    onStart: () => events.push('startA'),
    onEnd: () => events.push('endA')
  });

  chk('Controller startet Chunk 1 mit passender Stimme', [
    ctrl.isSpeaking(),
    ctrl.currentKey() === rowA,
    spokenQueue.length,
    spokenQueue[0].voice?.name
  ], [true, true, 1, 'Anna']);

  // Zweiter Chunk nach onend
  spokenQueue[0].onend();
  chk('Nach Chunk 1 folgt Chunk 2', [spokenQueue.length, ctrl.isSpeaking()], [2, true]);

  // Ende von Chunk 2 beendet Playback sauber
  spokenQueue[1].onend();
  chk('Nach letztem Chunk wird onEnd aufgerufen', [ctrl.isSpeaking(), events], [false, ['startA', 'endA']]);

  // Toggle: zweiter Klick auf gleiche Zeile stoppt Wiedergabe
  ctrl.speak('Noch ein Text zum Vorlesen.', {
    key: rowA,
    onStart: () => events.push('startA2'),
    onEnd: () => events.push('endA2')
  });
  const resumed = ctrl.speak('Noch ein Text zum Vorlesen.', {
    key: rowA,
    onStart: () => events.push('shouldNotStart')
  });
  chk('Erneuter Klick auf dieselbe Zeile stoppt statt neu zu starten', [resumed, ctrl.isSpeaking(), cancelCount >= 2, events.includes('endA2'), events.includes('shouldNotStart')], [false, false, true, true, false]);

  // Wechsel zu rowB unterbricht rowA sauber
  ctrl.speak('Text A', { key: rowA, onEnd: () => events.push('stopA') });
  ctrl.speak('Text B', { key: rowB, onStart: () => events.push('startB'), onEnd: () => events.push('endB') });
  chk('Wechsel auf andere Chat-Blase setzt activeKey sauber', [ctrl.currentKey() === rowB, events.slice(-2)], [true, ['stopA', 'startB']]);

  // 6. Verdrahtung in chat-tools.js & x-theme.css prüfen
  const chatTools = fs.readFileSync(path.join(__dirname, '../js/chat-tools.js'), 'utf8');
  const xTheme = fs.readFileSync(path.join(__dirname, '../css/x-theme.css'), 'utf8');
  chk('chat-tools.js und x-theme.css enthalten Read-Aloud-Integration', [
    chatTools.includes("from './speech.js'"),
    chatTools.includes("speakBtn.dataset.act = 'read-aloud'"),
    chatTools.includes("aria-pressed"),
    chatTools.includes("stop_circle"),
    xTheme.includes('.ma-btn.ma-speak-btn.on')
  ], [true, true, true, true, true]);

  console.log(`\n${fails ? fails + ' Fehler' : 'Alle Sprachausgabe-Tests grün'}`);
  process.exit(fails ? 1 : 0);
})();
