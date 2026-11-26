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

    console.log(fails ? `\n${fails} Fehler` : '\nAlle Handschrift-Tests grün');
    process.exit(fails ? 1 : 0);
})();
