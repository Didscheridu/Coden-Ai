// Tests für den Coden Humanizer (js/humanizer-core.js + Verdrahtung in Chat, Lernheften, Lern-Studio & Mehr)
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
  const H = await import(pathToFileURL(path.join(__dirname, '../js/humanizer-core.js')).href);
  const SolveCore = await import(pathToFileURL(path.join(__dirname, '../js/study-solve-core.js')).href);

  // 1. Einstellungen & Stärke-Stufen
  const defPrefs = H.normalizeHumanizerPrefs(null);
  chk('Standard-Einstellungen aktivieren alle Bereiche schülerfreundlich', defPrefs, {
    chat: true,
    notebooks: true,
    study: true,
    strength: 'balanced',
    keepTerms: true,
    shortSentences: true,
    duTone: true
  });

  chk('normalizeHumanizerPrefs korrigiert ungültige Werte und übernimmt false-Flags', H.normalizeHumanizerPrefs({
    chat: false,
    notebooks: true,
    study: false,
    strength: 'ungueltig',
    keepTerms: false,
    duTone: false
  }), {
    chat: false,
    notebooks: true,
    study: false,
    strength: 'balanced',
    keepTerms: false,
    shortSentences: true,
    duTone: false
  });

  chk('Stärke-Regler Mapping hin und zurück', [
    H.strengthFromStep(1), H.strengthFromStep(2), H.strengthFromStep(3),
    H.stepFromStrength('gentle'), H.stepFromStrength('balanced'), H.stepFromStrength('strong')
  ], ['gentle', 'balanced', 'strong', 1, 2, 3]);

  // 2. Schutz von Code, LaTeX und Coden-Tags
  const rawWithProtected = [
    'Text davor.',
    '```js\n// Darüber hinaus — Code darf bleiben\nconst x = 1;\n```',
    'Inline `darüber hinaus` und Formel $a^2 + b^2 = c^2$ sowie $$\\frac{1}{2}$$.',
    '<handwriting>Zusammenfassend lässt sich sagen</handwriting>',
    '<artifact type="html" title="Test">Darüber hinaus</artifact>'
  ].join('\n');

  const prot = H.protectSegments(rawWithProtected);
  chk('protectSegments maskiert Code, LaTeX und Coden-Tags vollständig', [
    prot.tokens.length,
    prot.text.includes('const x = 1;'),
    prot.text.includes('$a^2 + b^2 = c^2$'),
    prot.text.includes('<handwriting>'),
    prot.text.includes('<artifact')
  ], [6, false, false, false, false]);

  chk('restoreSegments stellt alles exakt wieder her', H.restoreSegments(prot.text, prot.tokens), rawWithProtected);

  // 3. Systemprompt-Direktiven je Bereich
  const chatDir = H.humanizerPromptDirective({ scope: 'chat', strength: 'balanced', duTone: true });
  const nbDir = H.humanizerPromptDirective({ scope: 'notebooks', strength: 'gentle', duTone: true });
  const studyDir = H.humanizerPromptDirective({ scope: 'study', strength: 'strong', duTone: true });
  chk('Direktiven enthalten Bereichskontext, Verbotene Floskeln und Coden-Element-Schutz', [
    chatDir.includes('Chat') && chatDir.includes('du'),
    nbDir.includes('Lernheft') && !nbDir.includes('mit „du“ an'),
    studyDir.includes('Lernmaterial') && studyDir.includes('alltagsnah'),
    chatDir.includes('<handwriting>') && chatDir.includes('Gedankenstriche')
  ], [true, true, true, true]);

  // 4. buildHumanizeRequest schützt Code/Formeln im User-Prompt
  const req = H.buildHumanizeRequest({
    text: 'Es ist wichtig zu beachten, dass `foo()` hilft.\n```py\nprint("hi")\n```',
    strength: 'strong',
    keepTerms: true,
    shortSentences: true,
    duTone: false
  });
  chk('buildHumanizeRequest enthält System-Regeln, Platzhalter und Tokens', [
    req.system.includes('Stufe 3 (Stark & locker)'),
    req.system.includes('Behalte die Perspektive'),
    req.tokens.length === 2,
    req.user.includes('@@HZKEEP0@@') && req.user.includes('@@HZKEEP1@@') && !req.user.includes('print("hi")')
  ], [true, true, true, true]);

  // 5. Deterministische Nachglättung (deAiText)
  const aiSample = [
    'Hier ist deine Übersicht:',
    '',
    'Zusammenfassend lässt sich sagen, dass Photosynthese wichtig ist — besonders für Pflanzen.',
    'Darüber hinaus hilft Licht – wenn genug Wasser da ist – beim Wachsen.',
    '- **Energie:** Licht wird genutzt. Im Zeitraum 10–15 Uhr oder bei -6 Grad.',
    '```js\n// Darüber hinaus — nicht anfassen!\nconst span = "10–15";\n```'
  ].join('\n');

  const cleaned = H.deAiText(aiSample, { forNotebook: true, stripIntro: true });
  const proseBeforeCode = cleaned.split('```')[0];
  chk('deAiText glättet Floskeln/Gedankenstriche und schützt Code sowie Zahlenspannen', [
    cleaned.startsWith('Photosynthese'),
    cleaned.includes('Außerdem hilft Licht, wenn genug Wasser da ist, beim Wachsen.'),
    proseBeforeCode.includes('—'),
    cleaned.includes('- Energie: Licht wird genutzt.'),
    cleaned.includes('10–15'),
    cleaned.includes('-6'),
    cleaned.includes('// Darüber hinaus — nicht anfassen!')
  ], [true, true, false, true, true, true, true]);

  // 6. KI-Muster-Analyse (inkl. Code-Ausschluss und Überlappungsauflösung)
  const analyzeSample = [
    'Es ist wichtig zu beachten, dass dieses Thema — obwohl es auf den ersten Blick sehr einfach aussieht — darüber hinaus eine maßgebliche Rolle spielt und deshalb in fast jedem Unterrichtsfach vorkommt.',
    '- **Fokus:** Kurzer Punkt.',
    '```js\n// Es ist wichtig zu beachten — maßgeblich darüber hinaus\n```'
  ].join('\n');

  const analysis = H.analyzeAiPatterns(analyzeSample);
  chk('analyzeAiPatterns erkennt alle Kategorien und ignoriert Codeblöcke', [
    analysis.total >= 5,
    analysis.countsByCategory.cliche >= 1,
    analysis.countsByCategory.dash >= 1,
    analysis.countsByCategory.transition >= 1,
    analysis.countsByCategory.buzzword >= 1,
    analysis.countsByCategory.structure >= 1,
    analysis.items.every(it => !it.match.includes('// Es ist wichtig'))
  ], [true, true, true, true, true, true, true]);

  // Keine überlappenden Markierungsbereiche
  let hasOverlap = false;
  for (let i = 1; i < analysis.items.length; i++) {
    if (analysis.items[i].start < analysis.items[i - 1].end) hasOverlap = true;
  }
  chk('analyzeAiPatterns liefert überlappungsfreie, sortierte Bereiche', hasOverlap, false);

  // 7. Wort-Diff & Wortzähler
  const diff = H.computeTextDiff('Darüber hinaus ist das wichtig.', 'Außerdem ist das sehr wichtig.');
  chk('computeTextDiff erkennt Änderungen auf Wortebene', [
    diff.some(d => d.type === 'del' && d.text.includes('Darüber hinaus')),
    diff.some(d => d.type === 'add' && d.text.includes('Außerdem')),
    diff.some(d => d.type === 'same' && d.text.includes('ist das')),
    H.wordCount('Hallo Welt zwei drei')
  ], [true, true, true, 4]);

  // 8. solvePrompt integriert humanizeDirective
  const sp = SolveCore.solvePrompt({
    subject: 'Biologie',
    title: 'Zellatmung',
    humanizeDirective: H.humanizerPromptDirective({ scope: 'notebooks', strength: 'balanced' })
  });
  chk('solvePrompt übernimmt Humanizer-Direktive für Lernheft-Lösungen', sp.system.includes('SCHREIBSTIL: NATÜRLICH & SCHÜLERFREUNDLICH'), true);

  // 9. Verdrahtung über alle App-Teile prüfen
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const html = read('index.html');
  const css = read('css/humanizer.css');
  const layout = read('js/layout.js');
  const app = read('js/app.js');
  const chatTools = read('js/chat-tools.js');
  const ink = read('js/ink.js');
  const study = read('js/study.js');
  const studio = read('js/study-studio.js');
  const solve = read('js/study-solve.js');
  const storage = read('js/storage.js');
  const hzView = read('js/humanizer.js');

  chk('index.html & css/humanizer.css enthalten Mehr-Eintrag, Composer-Toggle und Settings', [
    html.includes('href="css/humanizer.css"'),
    html.includes('id="open-humanizer-btn"') && html.includes('data-route="humanizer"'),
    html.includes('id="ct-humanize"'),
    html.includes('id="hz-pref-notebooks"') && html.includes('id="hz-pref-study"') && html.includes('id="hz-pref-chat"') && html.includes('id="hz-pref-strength"'),
    css.includes('.hz-page') && css.includes('.hz-hit-cliche') && css.includes('.hz-diff-add')
  ], [true, true, true, true, true]);

  chk('Router, Chat, Lernhefte, Lern-Studio, Lösen und Speicher sind verdrahtet', [
    layout.includes("Router.register('humanizer', HumanizerView)") && layout.includes('open-humanizer-btn'),
    app.includes("getAutoHumanizerPrompt('chat')") && app.includes("hz-pref-notebooks") && app.includes("ct-humanize"),
    chatTools.includes("ma-humanize-btn") && chatTools.includes("openHumanizerWith"),
    ink.includes("getAutoHumanizerPrompt('notebooks')") && ink.includes("deAiText(") && ink.includes("Schülerfreundlich") && ink.includes("openHumanizerWith"),
    study.includes("getAutoHumanizerPrompt('study')") && study.includes("st-hz-toggle") && study.includes("deAiText("),
    studio.includes("st-hz-toggle") && studio.includes("updateHumanizerPrefs({ notebooks:") && studio.includes("getAutoHumanizerPrompt('study')"),
    solve.includes("getAutoHumanizerPrompt('notebooks')") && solve.includes("deAiText("),
    storage.includes("'humanizer'"),
    hzView.includes('openNotebookTransferDialog') && hzView.includes("coden:compose")
  ], [true, true, true, true, true, true, true, true, true]);

  console.log(`\n${fails ? fails + ' Fehler' : 'Alle Humanizer-Tests grün'}`);
  process.exit(fails ? 1 : 0);
})();
