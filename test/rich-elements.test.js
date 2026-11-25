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
  chk('Tags mitten in echtem ```Code``` bleiben Code', R.extractWidgets('```js\nconst t = "<steps>a</steps>";\n```').widgets.length, 0);
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

  // ---------- Streaming: nie rohe Tags, Code-Zäune auspacken ----------
  const half = R.extractWidgets('Los\n<quiz title="Photo');
  chk('halb geschriebener Tag mit Attributen → Platzhalter "Erstellt Quiz"', [half.text.includes('<quiz'), half.widgets.map(w => [w.type, w.closed])], [false, [['quiz', false]]]);
  const fenced = R.extractWidgets('Hier:\n```xml\n<quiz>\n? A\n+ b\n- c\n</quiz>\n```\nEnde');
  chk('Quiz in ```-Zaun wird trotzdem ein Quiz', [fenced.widgets.length, fenced.widgets[0]?.closed, fenced.text.includes('Ende')], [1, true, true]);
  chk('halber Schluss-Tag wird nicht angezeigt', R.extractWidgets('<quiz>\n? A\n+ b\n</qu').widgets[0].body, '? A\n+ b');
  chk('Fortschritt beim Streamen', [R.progressOf({ type: 'quiz', body: '? a\n+ b\n? c' }), R.progressOf({ type: 'flashcards', body: 'a :: b' }), R.progressOf({ type: 'quiz', body: '' })], ['2 Fragen', '1 Karte', '']);

  // ---------- Mathe ----------
  const f = (e, x) => R.compileExpr(e)(x);
  chk('Formeln: Potenz, implizites Mal, Klammern, Komma', [f('2x^2-3', 2), f('-x^2', 3), f('3(x+1)', 1), f('x²+2x+1', 1), f('0,5x', 4), f('2^x', 3)], [5, -9, 6, 4, 2, 8]);
  chk('Formeln: Funktionen und Konstanten', [f('sin(pi/2)', 0), f('√(x)', 9), f('|x-5|', 1), f('e^x', 0), +f('2 sin(x) cos(x)', 1).toFixed(6)], [1, 3, 4, 1, +Math.sin(2).toFixed(6)]);
  let bad = 0; for (const e of ['x +', 'alert(1)', 'x)(', 'constructor']) { try { R.compileExpr(e)(1); } catch (_) { bad++; } }
  chk('ungültige/gefährliche Formeln werden abgelehnt (kein eval)', bad, 4);
  const pl = R.parsePlot('f(x) = x^2 - 2 | blau\ny = 2x+1\nP(1|2) | grün\nS(0,5|-1,75)\nx = 2 | rot', { x: '-5..5', y: '-3;10' });
  chk('Plot: Funktionen, Punkte, Linien, Bereiche', [pl.fns.map(x => [x.name, x.expr, x.color]), pl.pts.map(p => [p.name, p.x, p.y, p.color]), pl.vlines, pl.x, pl.y], [[['f', 'x^2 - 2', 'blue'], ['y', '2x+1', null]], [['P', 1, 2, 'green'], ['S', 0.5, -1.75, null]], [{ x: 2, color: 'red' }], [-5, 5], [-3, 10]]);
  chk('Kreisdiagramm', R.parsePie('Ja | 60 % | grün\nNein | 30\nkaputt | x'), [{ l: 'Ja', v: 60, c: 'green' }, { l: 'Nein', v: 30, c: null }]);

  // ---------- Merkzettel ----------
  const M = await import(pathToFileURL(path.join(__dirname, '../js/merkzettel-core.js')).href);
  const clean = M.cleanMerkzettel('Hier ist dein Merkzettel:\n# Zellatmung 🧬\n## Ablauf\n- **Wichtig:** Glykolyse\n## Fazit\n- alles toll\n## Formel\n- $C_6H_{12}O_6$');
  chk('Merkzettel: KI-Spuren raus (Einleitung, Emojis, Fazit, Fett-Etiketten)', [clean.includes('Hier ist'), /🧬/.test(clean), clean.includes('Fazit'), clean.includes('**Wichtig:**'), clean.includes('- Wichtig: Glykolyse'), clean.includes('## Formel')], [false, false, false, false, true, true]);
  chk('Merkzettel: Titel und Papier', [M.titleOf('# ==Zell==atmung\n- a'), M.defaultPaper('Mathe'), M.defaultPaper('Geschichte')], ['Zellatmung', 'karo', 'liniert']);
  const mp = M.merkzettelPrompt({ src: 'Stoff', subject: 'Bio' });
  chk('Merkzettel-Prompt verbietet KI-Floskeln und verlangt Stichpunkte', [/VERBOTEN/.test(mp.sys), /Stichpunkte/.test(mp.sys), mp.user.includes('Stoff')], [true, true, true]);

  // ---------- Systemprompt kennt alles ----------
  const P = await import(pathToFileURL(path.join(__dirname, '../js/system-prompt.js')).href);
  const prompt = P.buildChatPrompt();
  chk('Systemprompt erklärt Markieren, Farben und alle Elemente', ['==grün:', '{{rot:', ...R.WIDGETS.map(w => '<' + w)].every(x => prompt.includes(x)), true);

  console.log(fails ? `\n${fails} Fehler` : '\nAlle Rich-Element-Tests grün');
  process.exit(fails ? 1 : 0);
})();
