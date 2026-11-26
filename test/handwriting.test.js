// Handschrift-Modell, Glyphen-Kompression, Fallback/Synthese, Papier-Layout und Prompt-Kontext (ohne DOM)
const path = require('path');
const { pathToFileURL } = require('url');

let fails = 0;
const chk = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fails++;
    console.log((ok ? '✅ ' : '❌ ') + name + (ok ? '' : `\n   erwartet: ${JSON.stringify(want)}\n   bekommen: ${JSON.stringify(got)}`));
};

(async () => {
    const H = await import(pathToFileURL(path.join(__dirname, '../js/handwriting-core.js')).href);

    // 1. Blank & Normalize
    const b = H.blankHandwriting();
    chk('Leeres Profil: genau 1 Standardprofil', [b.v, b.profiles.length, b.profiles[0].name, b.activeId === b.profiles[0].id], [1, 1, 'Meine Handschrift', true]);

    const rawProfiles = Array.from({ length: 9 }, (_, i) => ({
        id: 'p' + i,
        name: 'Stil ' + i,
        inkColor: i === 0 ? 'rot' : '#1b3b8b',
        paper: i === 1 ? 'liniert' : 'karo',
        strokeScale: 99,
        slantDeg: -99,
        glyphs: { a: H.encodeGlyphStrokes([[[20, 45, 0.5], [40, 70, 0.8]]]), '': '10,10,5', bad: 'keine_zahlen' }
    }));
    const norm = H.normalizeHandwriting({ activeId: 'p1', profiles: rawProfiles });
    chk('Normalisierung: max 6 Profile, ungültige Glyphen raus, Werte begrenzt', [
        norm.profiles.length,
        norm.activeId,
        norm.profiles[0].inkColor,
        norm.profiles[0].strokeScale,
        norm.profiles[0].slantDeg,
        Object.keys(norm.profiles[0].glyphs)
    ], [6, 'p1', '#c62828', 1.6, -14, ['a']]);

    // 2. Encoding / Decoding Round-Trip
    const rawStroke = [[[12.34, 45.67, 0.72], [20.11, 55.22, 0.8], [35.9, 68.4, 0.61]], [[45, 20, 0.5], [45, 72, 0.5]]];
    const enc = H.encodeGlyphStrokes(rawStroke);
    const dec = H.decodeGlyphStrokes(enc);
    chk('Glyphen-Roundtrip: 2 Striche mit 1/10-Genauigkeit erhalten', [
        dec.length,
        Math.round(dec[0][0][0] * 10),
        Math.round(dec[0][0][1] * 10),
        Math.round(dec[0][0][2] * 10),
        dec[1].length
    ], [2, 123, 457, 7, 2]);

    // 3. Auflösung trainierter Glyphen, Hoch-/Tiefstellung & Umlaut-Synthese
    const p = H.blankProfile('Test');
    p.glyphs['a'] = H.encodeGlyphStrokes([[[22, 50, 0.6], [42, 50, 0.6], [42, 72, 0.6], [22, 72, 0.6]]]);
    p.glyphs['2'] = H.encodeGlyphStrokes([[[24, 24, 0.6], [48, 24, 0.6], [24, 72, 0.6], [50, 72, 0.6]]]);

    const ga = H.resolveCharGlyph('a', p);
    const gSup2 = H.resolveCharGlyph('²', p);
    const gAuml = H.resolveCharGlyph('ä', p);
    const gZ = H.resolveCharGlyph('z', p);
    chk('Glyphen-Auflösung: trainiert, Hochzahl ² & Umlaut ä synthetisiert, Fallback für z', [
        ga.isTrained,
        gSup2.isTrained,
        gSup2.bounds.maxY < H.GUIDES.baseline,
        gAuml.isTrained,
        gAuml.strokes.length > 1,
        gZ.isTrained,
        gZ.strokes.length > 0
    ], [true, true, true, true, true, false, true]);

    // 4. Textbereinigung (LaTeX/Markdown-Reste raus)
    const cleaned = H.cleanHandwritingText('==grün:Ergebnis==: $\\frac{x^2 + 1}{2} \\cdot \\sqrt{9} \\approx 15$ **super**');
    chk('Textbereinigung: Marker, LaTeX-Bruch/Wurzel/Mal/Fett bereinigt', cleaned, 'Ergebnis: (x² + 1) / (2) · √(9) ≈ 15 super');

    // 5. Layout auf Karo / Liniert / Blanko inkl. Wortumbruch
    const lay = H.layoutHandwriting('a² + 2 = 4\nDas ist eine lange Zeile mit vielen Wörtern für den automatischen Umbruch auf dem Blatt.', p, { paper: 'liniert', width: 360 });
    chk('Layout: trainierte & Fallback-Zeichen gezählt, Liniert-Abstand & Umbruch aktiv', [
        lay.paper,
        lay.lineCount > 2,
        lay.usedTrained >= 3,
        lay.usedFallback > 10,
        lay.strokes.length > 10,
        lay.height >= 220
    ], ['liniert', true, true, true, true, true]);

    // 6. Parser & Systemprompt-Kontext
    const parsed = H.parseHandwriting('\n  x² = 9  \n', { title: 'Gleichung', paper: 'KARO', ink: 'blau', profile: 'Test' });
    chk('parseHandwriting liest Attribute sauber', parsed, { title: 'Gleichung', paper: 'karo', ink: 'blau', profile: 'Test', text: 'x² = 9' });

    const pr0 = H.handwritingPrompt(H.blankHandwriting());
    const pr1 = H.handwritingPrompt({ activeId: p.id, profiles: [p] });
    chk('Chat-Prompt: unterscheidet untrainiert vs. trainiert', [
        pr0.includes('0 Zeichen') && pr0.includes('<handwriting'),
        pr1.includes('2 trainierte Zeichen') && pr1.includes('<handwriting')
    ], [true, true]);

    // 7. Merge & Persistenz-Schutz bei Cloud-Abgleich
    const locHw = H.normalizeHandwriting({
        activeId: 'p1',
        profiles: [{ id: 'p1', name: 'Meine', glyphs: { a: p.glyphs['a'], e: H.encodeGlyphStrokes([[[25, 55, 0.5], [45, 55, 0.5]]]) }, updatedAt: '2026-11-26T10:00:00Z' }]
    });
    const remHw = H.normalizeHandwriting({
        activeId: 'p1',
        profiles: [{ id: 'p1', name: 'Meine', glyphs: { '2': p.glyphs['2'] }, updatedAt: '2026-11-26T09:00:00Z' }]
    });
    const mergedHw = H.mergeHandwriting(locHw, remHw);
    chk('mergeHandwriting erhält lokale und Cloud-Glyphen zusammen', [
        mergedHw.activeId,
        Object.keys(mergedHw.profiles[0].glyphs).sort(),
        H.trainedCount(mergedHw.profiles[0])
    ], ['p1', ['2', 'a', 'e'], 3]);

    // 8. Handschrift-Engine (wie der Skill meine-handschrift)
    const E = await import(pathToFileURL(path.join(__dirname, '../js/hand-engine.js')).href);
    chk('normalizeRich: falsches Format und leere Profile abgelehnt', [E.normalizeRich(null), E.normalizeRich({ format: 'x', g: {} }), E.normalizeRich({ format: 'coden-hand', g: { ab: [[1, 0, 1, [[0, 0, 1, 1]]]] } })], [null, null, null]);
    const stroke = (x0, x1) => [[x0, 0, (x0 + x1) / 2, 100, x1, 0]];
    const rich = E.normalizeRich({
        format: 'coden-hand', name: 'Test', style: { ink: '#1E1B1B', sw: 99 },
        g: { a: [[60, 0, 100, stroke(0, 60)], [62, 0, 100, stroke(5, 62)]], b: [[55, 0, 150, stroke(0, 55)]], A: [[70, 0, 150, stroke(0, 70)]], '-': [[40, 60, 62, [[0, 61, 40, 61]]]], '2': [[50, 0, 150, stroke(0, 50)]] },
        w: { ab: [[130, 0, 150, [[0, 0, 130, 150]]]], 'x1': [[1, 0, 1, [[0, 0]]]] }
    });
    chk('normalizeRich: Stil begrenzt, Farbe klein, ungültige Wörter raus', [rich.style.sw, rich.style.ink, Object.keys(rich.w), E.richVariantCount(rich)], [0.3, '#1e1b1b', ['ab'], 6]);

    const L1 = E.layoutRich('aaaa', rich, { width: 600, grid: 20, seed: 4, wordLib: 0 });
    const L2 = E.layoutRich('aaaa', rich, { width: 600, grid: 20, seed: 4, wordLib: 0 });
    const starts = L1.strokes.map(s => Math.round((s.p[0] - L1.strokes[0].p[0]) % 1000));
    chk('Layout: gleicher Seed = gleiches Bild, 4 Zeichen, Zeile 1 auf Karo-Linie', [JSON.stringify(L1.strokes) === JSON.stringify(L2.strokes), L1.strokes.length, L1.firstBase % 20, starts.length], [true, 4, 0, 4]);
    // zwei Varianten: Varianten wechseln sich ab (Startpunkt relativ zur Zeichenbreite unterschiedlich)
    const firstX = L1.strokes.map(s => s.p[0]);
    chk('Layout: Zeichen stehen nacheinander mit Abstand', firstX.every((x, i) => i === 0 || x > firstX[i - 1] + 10), true);
    const Lw = E.layoutRich('ab ab', rich, { width: 600, grid: 20, seed: 1, wordLib: 1 });
    chk('Layout: ganze gelernte Wörter werden genutzt', [Lw.usedWords, Lw.strokes.length], [2, 2]);
    const Lm = E.layoutRich('# Titel\n==ab== und Ä♫\n| A | b |\n|---|---|\n| 2 | a |', rich, { width: 600, grid: 20, seed: 1, fallback: H.fallbackRich() });
    chk('Layout: Titel-Marker, ==Marker==, Tabelle mit geraden Linien, Vorschau-Schrift für fehlende Zeichen', [
        Lm.marks.length >= 2, Lm.strokes.filter(s => s.straight).length >= 3, Lm.usedFallback > 0, Lm.missing.includes('♫')
    ], [true, true, true, true]);
    const Lwrap = E.layoutRich(Array(30).fill('ab').join(' '), rich, { width: 300, grid: 20, seed: 2, wordLib: 0 });
    chk('Layout: Umbruch hält die Breite ein, 3 Kästchen pro Zeile', [Lwrap.lineCount > 3, Math.max(...Lwrap.strokes.flatMap(s => s.p.filter((_, i) => i % 3 === 0))) <= 300, Lwrap.pitch], [true, true, 60]);
    const Lmath = E.layoutRich('3x+6=21 |-6\n3x=15 |:3\nx=5', rich, { width: 400, grid: 20, fallback: H.fallbackRich() });
    chk('Layout: reine Rechnung → Mathe-Modus mit 2 Kästchen pro Zeile', [Lmath.mathe, Lmath.pitch], [true, 40]);

    // gezeichnete Glyphe → feste Höhen (kleine Buchstaben 1 Kästchen, große 1,5)
    const vA = E.variantFromPad([[[20, 30, 0.5], [30, 72, 0.5]], [[30, 30, 0.5], [40, 72, 0.5]]], 'a'); // zu hoch gezeichnet
    const vT = E.variantFromPad([[[20, 20, 0.5], [20, 70, 0.5]]], 'T'); // leicht über der Grundlinie
    chk('variantFromPad: Höhe angeglichen (max. ±22 %) und auf die Grundlinie gesetzt', [vA[2] < 140 && vA[2] > 100, vT[1], vT[2] >= 140 && vT[2] <= 160], [true, 0, true]);

    // mehrere Varianten pro Zeichen im eigenen Profil
    const pv = H.blankProfile('Var');
    const one = H.encodeGlyphStrokes([[[22, 45, 0.5], [44, 72, 0.5]]]);
    pv.glyphs.a = Array(7).fill(one).join('#') + '#kaputt';
    const nv = H.normalizeHandwriting({ profiles: [pv] }).profiles[0];
    chk('Eigene Profile: bis zu 5 Varianten je Zeichen, kaputte raus, Engine-Profil daraus', [H.glyphVariants(nv, 'a').length, H.variantCount(nv), H.profileRich(nv).g.a.length], [5, 5, 5]);

    // 9. Kaydens: nur wenn der Server sie liefert (Admin-Mail)
    chk('Ohne Server-Daten gibt es kein Kaydens-Profil', [H.getMasterProfile(), H.allProfiles(H.blankHandwriting()).length], [null, 1]);
    const master = H.setMasterRich({ ...rich, name: 'Kaydens' });
    const hwM = H.normalizeHandwriting({ activeId: H.MASTER_ID, profiles: [pv] });
    const act = H.activeProfile(hwM);
    chk('Kaydens: wählbar, aktiv, zählt die Zeichen, Prompt nennt sie', [master.name, hwM.activeId, act.id, H.trainedCount(act), H.allProfiles(hwM).length, H.handwritingPrompt(hwM).includes('„Kaydens“')], ['Kaydens', 'kaydens', 'kaydens', 5, 2, true]);
    H.setMasterRich(null);
    chk('Kaydens weg (anderer Nutzer): fällt auf eigenes Profil zurück', [H.activeProfile(hwM).id === pv.id, H.allProfiles(hwM).length], [true, 1]);

    // 9b. Gewählte Handschrift bleibt nach dem Neuladen / Abgleich mit der Cloud
    const own = H.blankProfile('Kayden Schrift'); own.glyphs.a = one;
    const chosen = H.chooseHandwriting(H.normalizeHandwriting({ profiles: [own] }), H.MASTER_ID);
    const oldCloud = H.normalizeHandwriting({ activeId: own.id, profiles: [own] });
    chk('Abgleich: Kaydens bleibt gewählt, auch wenn die Cloud noch die alte Wahl hat', [H.mergeHandwriting(chosen, oldCloud).activeId, H.mergeHandwriting(oldCloud, chosen).activeId], ['kaydens', 'kaydens']);
    const later = { ...H.chooseHandwriting(oldCloud, own.id), activeAt: new Date(Date.now() + 5000).toISOString() };
    chk('Abgleich: die zuletzt aktiv gewählte Handschrift gewinnt', [H.mergeHandwriting(chosen, later).activeId, H.mergeHandwriting(later, chosen).activeId], [own.id, own.id]);
    const seen = H.normalizeHandwriting({ ...chosen, masterSeen: true });
    chk('Wahl und „Kaydens schon eingerichtet“ überstehen Speichern und Abgleich', [seen.activeId, !!seen.activeAt, seen.masterSeen, H.mergeHandwriting(oldCloud, seen).masterSeen], ['kaydens', true, true, true]);

    // 10. Im Chat: „schreib das auf Papier in meiner Handschrift“
    chk('Chat erkennt den Wunsch nach Handschrift', [
        'Löse Aufgabe 3 in meiner Handschrift', 'schreib mir das bitte auf papier', 'kannst du das handschriftlich machen?', 'Schreib die Zusammenfassung aufs Blatt', 'mach es in Kaydens Handschrift',
        'Wie kann ich meine Handschrift trainieren?', 'Was ist Papier?', 'Erkläre Photosynthese'
    ].map(H.handwritingRequested), [true, true, true, true, true, false, false, false]);
    chk('Erzwungene Handschrift-Antwort: Block + Hinweis aufs Arbeitsblatt nur mit Bild', [H.forceHandwritingPrompt().includes('<handwriting'), H.forceHandwritingPrompt().includes('Coden lösen lassen'), H.forceHandwritingPrompt({ withImage: true }).includes('Coden lösen lassen')], [true, false, true]);

    // 11. Kasten-Modus (Antwort in ein Feld auf dem Arbeitsblatt)
    const fitL = E.layoutRich('ab ab ab', rich, { fit: { k: 10, pitch: 22.5, firstBase: 15 }, width: 400, paper: 'blanko', wordLib: 0 });
    const fitN = E.layoutRich('ab ab ab ab ab ab', rich, { fit: { k: 10, pitch: 22.5, firstBase: 15 }, width: 60, paper: 'blanko', wordLib: 0 });
    chk('Kasten-Modus: kein Rand, eine Zeile, Höhe passt; schmaler Kasten bricht um', [Math.min(...fitL.strokes.map(s => s.p[0])) < 3, fitL.lineCount, fitL.height < 30, fitN.lineCount > 1], [true, 1, true, true]);

    // 12. Striche: Fineliner bleibt Fineliner, „von Coden“ bleibt markiert
    const IC = await import(pathToFileURL(path.join(__dirname, '../js/ink-core.js')).href);
    const round = IC.decodeStrokes(IC.encodeStrokes([{ t: 'pen', c: '#111111', w: 2, k: 'fineliner', p: [1, 2, 0.5, 3, 4, 0.5] }, { t: 'pen', c: '#111111', w: 2, k: 'fueller', o: 'coden', p: [1, 2, 0.5, 3, 4, 0.5] }, { t: 'pen', c: '#111111', w: 2, p: [1, 2, 0.5] }]));
    chk('Striche: fineliner, o=coden und normale Striche überstehen Speichern', round.map(s => [s.k, s.o || '']), [['fineliner', ''], ['fueller', 'coden'], ['fueller', '']]);

    // Coden-Striche werden im Heft exakt gezeichnet (kein Nachglätten, gleich dick, keine Spitzen)
    const corner = { t: 'pen', c: '#000', w: 2, k: 'kugel', o: 'coden', p: [0, 0, 0.5, 10, 0, 0.5, 10, 10, 0.5] };
    const ol = IC.strokeOutline(corner);
    const near = (x, y) => Math.min(...ol.map(([a, b]) => Math.hypot(a - x, b - y)));
    const olHand = IC.strokeOutline({ ...corner, o: undefined });
    const nearH = (x, y) => Math.min(...olHand.map(([a, b]) => Math.hypot(a - x, b - y)));
    chk('Heft: Coden-Striche behalten Ecke und Dicke (Nutzer-Striche werden weiter geglättet)', [near(10, 0) < 1.5, nearH(10, 0) > near(10, 0)], [true, true]);

    // 13. „Coden lösen lassen“: Prompt, Antwort lesen, Felder aufs Blatt umrechnen
    const SV = await import(pathToFileURL(path.join(__dirname, '../js/study-solve-core.js')).href);
    const sp = SV.solvePrompt({ subject: 'Mathe', title: 'AB Parabeln', desc: '', pages: 2 });
    chk('Lösen-Prompt: JSON, Felder als box_2d, keine Aufgabe auslassen', [sp.user.includes('box_2d'), sp.user.includes('2 Bilder'), sp.system.includes('Keine Aufgabe'), SV.solvePrompt({ desc: 'Löse 3x=9', pages: 0 }).user.includes('kein Arbeitsblatt')], [true, true, true, true]);
    const answer = 'Klar!\n```json\n{"aufgaben":[{"nr":"1a","seite":1,"antwort":"x=3","box_2d":[500,100,540,400],"rechnung":"3x=9 |:3\\nx=3"},{"nr":"2","seite":2,"antwort":"Scheitel S(1|2)","box_2d":[0,0,1000,1000]},{"nr":"3","seite":9,"antwort":"ja","box_2d":[10,10,40,200]},{"nr":"4","antwort":"","rechnung":""},{"nr":"5","seite":1,"antwort":"X","box_2d":[300,700,280,650]}]}\n```';
    const items = SV.parseSolve(answer, 2);
    chk('Antwort lesen: Felder geprüft, zu große/falsche Seiten → ins Heft, leere Aufgaben raus, vertauschte Ecken repariert', [
        items.length, items[0].page, items[0].box.y0, items[1].box, items[2].page, items[3].nr, items[3].box && Math.round(items[3].box.x0 * 1000)
    ], [4, 0, 0.5, null, null, '5', 650]);
    chk('Antwort lesen: kaputtes JSON → null', [SV.parseSolve('keine Ahnung', 1), SV.parseSolve('{"aufgaben": 5}', 1)], [null, null]);
    const rect = SV.boxToPage({ x0: 0.1, y0: 0.5, x1: 0.4, y1: 0.54 }, 1600, 1131, 1000, 1414);
    chk('Feld → Heft-Seite: Querformat-Blatt wird oben eingepasst', [Math.round(rect.x), Math.round(rect.y), Math.round(rect.w)], [102, 353, 296]);
    items[0].placed = true;
    const extraTxt = SV.extraPagesText(items, { title: 'Lösungen' });
    chk('Extra-Seiten: Rechenwege + alles, was nicht aufs Blatt passte', [extraTxt.startsWith('# Lösungen'), extraTxt.includes('Aufgabe 1 a)\n3x=9 |:3'), extraTxt.includes('Scheitel S(1|2)'), extraTxt.includes('x=3\n3x=9') ], [true, true, true, false]);
    chk('Extra-Seiten: nichts übrig → leer', SV.extraPagesText([{ nr: '1', answer: 'x', work: '', placed: true }]), '');

    console.log(fails ? `\n${fails} Fehler` : '\nAlle Handschrift-Tests grün');
    process.exit(fails ? 1 : 0);
})();
