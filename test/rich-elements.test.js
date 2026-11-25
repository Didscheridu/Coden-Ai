// Markierungen, Textfarben und interaktive Chat-Elemente (Quiz, Karteikarten, Schritte …): nur die reinen Parser
const path = require('path');
const { pathToFileURL } = require('url');
let fails = 0;
const chk = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? '✅ ' : '❌ ') + name + (ok ? '' : `\n   erwartet: ${JSON.stringify(want)}\n   bekommen: ${JSON.stringify(got)}`)); };
(async () => {
  const R = await import(pathToFileURL(path.join(__dirname, '../js/rich-elements.js')).href);

  // ---------- Markieren & Färben ----------
  chk('==Text== wird gelb markiert', R.colorize('Die Antwort ist ==42== genau.'), 'Die Antwort ist <mark class="hl hl-yellow">42</mark> genau.');
  chk('==grün:Text== mit Farbe', R.colorize('==grün:richtig== und ==rot:falsch=='), '<mark class="hl hl-green">richtig</mark> und <mark class="hl hl-red">falsch</mark>');
  chk('unbekannte Farbe bleibt Text', R.colorize('==Uhr:12 Uhr=='), '<mark class="hl hl-yellow">Uhr:12 Uhr</mark>');
  chk('{{blau:Begriff}} färbt die Schrift', R.colorize('ein {{blau:Atom}} und {{Türkis: Wert }}'), 'ein <span class="ctx ctx-blue">Atom</span> und <span class="ctx ctx-cyan">Wert</span>');
  chk('{{unbekannt:x}} bleibt unverändert', R.colorize('{{name:x}}'), '{{name:x}}');
  chk('a == b (Vergleich) wird nicht markiert', R.colorize('wenn a == b und c == d'), 'wenn a == b und c == d');
  chk('Setext-Überschrift bleibt', R.colorize('Titel\n====='), 'Titel\n=====');
  chk('stripMarks für Kopieren/Vorlesen', R.stripMarks('==grün:ja==, {{rot:nein}} und `==code==`'), 'ja, nein und `==code==`');

  // ---------- Blöcke finden ----------
  const ex = R.extractWidgets('Hallo\n<quiz title="Test">\n? Frage\n+ A\n- B\n</quiz>\nDanach');
  chk('Quiz-Block wird Platzhalter', [ex.widgets.length, ex.widgets[0].type, ex.widgets[0].attrs.title, ex.widgets[0].closed, ex.text.includes('data-cw="0"'), ex.text.includes('Danach')], [1, 'quiz', 'Test', true, true, true]);
  const open = R.extractWidgets('Los geht\'s\n<flashcards>\nHund :: dog');
  chk('offener Block beim Streamen', [open.widgets[0].type, open.widgets[0].closed, open.text.includes('Hund')], ['flashcards', false, false]);
  chk('halber Anfangs-Tag wird versteckt', R.extractWidgets('Text <qui').text, 'Text ');
  chk('Blöcke in ```Code``` bleiben Code', R.extractWidgets('```html\n<steps>\na\n</steps>\n```').widgets.length, 0);
  chk('mehrere Blöcke', R.extractWidgets('<steps>\na: b\n</steps>\nx\n<stats>\n1 | eins\n</stats>').widgets.map(w => w.type), ['steps', 'stats']);

  // ---------- Quiz ----------
  const q = R.parseQuiz('? Wo findet die Photosynthese statt?\n- Mitochondrien\n+ Chloroplasten\n- Zellkern\n! Denk an Grün.\n> Chlorophyll.\n? 2+2?\n- 3\n+ 4');
  chk('Quiz im Zeilenformat', q.questions.map(x => [x.q, x.options.length, x.answer, x.hint, x.explanation]), [['Wo findet die Photosynthese statt?', 3, 1, 'Denk an Grün.', 'Chlorophyll.'], ['2+2?', 2, 1, '', '']]);
  const qj = R.parseQuiz('{"title":"T","questions":[{"q":"A?","options":["x","y"],"answer":1,"explanation":"weil"},{"question":"B?","options":["p","q"],"answer":"p"}]}');
  chk('Quiz als JSON (Index oder Text als Lösung)', [qj.title, qj.questions.map(x => x.answer)], ['T', [1, 0]]);
  chk('Fragen ohne richtige Antwort fallen weg', R.parseQuiz('? Frage\n- a\n- b').questions.length, 0);
  chk('(richtig)-Markierung', R.parseQuiz('1. Frage?\nA) eins\nB) zwei (richtig)').questions[0].answer, 1);

  // ---------- Weitere Elemente ----------
  chk('Karteikarten', R.parseCards('Hund :: dog\n- Katze -> cat\nohne Trenner'), [{ front: 'Hund', back: 'dog' }, { front: 'Katze', back: 'cat' }]);
  chk('Karteikarten als JSON', R.parseCards('[{"front":"a","back":"b"}]'), [{ front: 'a', back: 'b' }]);
  chk('Schritte', R.parseSteps('1. Installieren: npm i\n- Einfach weiter'), [{ title: 'Installieren', text: 'npm i' }, { title: '', text: 'Einfach weiter' }]);
  chk('Pro & Contra', R.parseProsCons('+ schnell\n- teuer\n✓ leise'), { pro: ['schnell', 'leise'], con: ['teuer'] });
  chk('Zeilen mit |', R.parseRows('8 Mrd | Menschen | blau'), [['8 Mrd', 'Menschen', 'blau']]);
  chk('Tabs', R.parseTabs('## Einfach\nkurz\n## Profi\nlang\nmehr').map(t => [t.title, t.body.trim()]), [['Einfach', 'kurz'], ['Profi', 'lang\nmehr']]);

  // ---------- Systemprompt kennt alles ----------
  const P = await import(pathToFileURL(path.join(__dirname, '../js/system-prompt.js')).href);
  const prompt = P.buildChatPrompt();
  chk('Systemprompt erklärt Markieren, Farben und alle Elemente', ['==grün:', '{{rot:', ...R.WIDGETS.map(w => '<' + w)].every(x => prompt.includes(x)), true);

  console.log(fails ? `\n${fails} Fehler` : '\nAlle Rich-Element-Tests grün');
  process.exit(fails ? 1 : 0);
})();
