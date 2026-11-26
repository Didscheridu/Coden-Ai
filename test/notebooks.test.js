// Notizbücher wie GoodNotes: Formen-Erkennung, Radierer, Lasso, Verschieben/Skalieren, Speicherformat (ink-core)
// und die Bibliothek (Ordner beliebig tief, Verschieben ohne Zyklen, Löschen, Suche, Sortierung) in study-core.
const path = require('path'); const { pathToFileURL } = require('url');
let fails = 0;
const chk = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : ` (bekam ${JSON.stringify(got)}, erwartet ${JSON.stringify(want)})`)); };
(async () => {
  const I = await import(pathToFileURL(path.join(__dirname, '../js/ink-core.js')).href);
  const S = await import(pathToFileURL(path.join(__dirname, '../js/study-core.js')).href);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const noisy = (fn, n = 90) => { const p = []; for (let i = 0; i <= n; i++) { const [x, y] = fn(i / n); p.push(x + (rnd() - .5) * 4, y + (rnd() - .5) * 4, .5); } return p; };
  const poly = (P) => (t) => { const k = t * (P.length - 1); const i = Math.min(P.length - 2, Math.floor(k)); const f = k - i; return [P[i][0] + (P[i + 1][0] - P[i][0]) * f, P[i][1] + (P[i + 1][1] - P[i][1]) * f]; };
  const kinds = (gen) => { const c = {}; for (let i = 0; i < 15; i++) { const r = I.recognizeShape(gen()); c[r?.kind || 'nichts'] = (c[r?.kind || 'nichts'] || 0) + 1; } return Object.keys(c); };

  // ---------- Formen ----------
  chk('Form: Kreis', kinds(() => noisy(t => [300 + 100 * Math.cos(t * 6.4), 300 + 100 * Math.sin(t * 6.4)])), ['kreis']);
  chk('Form: Ellipse', kinds(() => noisy(t => [300 + 160 * Math.cos(t * 6.35), 300 + 70 * Math.sin(t * 6.35)])), ['ellipse']);
  chk('Form: Rechteck', kinds(() => noisy(poly([[100, 100], [400, 100], [400, 300], [100, 300], [100, 104]]), 120)), ['rechteck']);
  chk('Form: Dreieck', kinds(() => noisy(poly([[200, 100], [350, 350], [50, 350], [198, 104]]))), ['dreieck']);
  chk('Form: Linie', kinds(() => noisy(t => [100 + 300 * t, 200 + 3 * t])), ['linie']);
  chk('Gekritzel bleibt Gekritzel', kinds(() => noisy(t => [100 + 300 * t, 200 + 40 * Math.sin(t * 40)], 200)), ['nichts']);
  const line = I.recognizeShape(noisy(t => [100 + 300 * t, 200 + 4 * t])).p;
  chk('Linie rastet waagrecht ein', Math.abs(line[1] - line[line.length - 2]) < 0.001, true);
  const rect = I.recognizeShape(noisy(poly([[100, 100], [400, 100], [400, 300], [100, 300], [100, 104]]), 120)).p; const rb = I.bbox(rect);
  chk('Rechteck wird achsparallel', [Math.round(rb.w / 10), Math.round(rb.h / 10)], [30, 20]);
  chk('Zu kleine Striche werden nicht umgeformt', I.recognizeShape([0, 0, .5, 5, 5, .5, 10, 0, .5, 3, 3, .5, 1, 1, .5, 2, 2, .5]), null);

  // ---------- Radierer ----------
  const s = { t: 'pen', c: '#000', w: 2, k: 'fueller', p: noisy(t => [100 + 300 * t, 200]) };
  const parts = I.eraseFrom([s], 250, 200, 10);
  chk('Teil-Radierer teilt den Strich', [parts.length, parts.every(x => x.p.every((v, i) => i % 3 !== 0 || Math.abs(v - 250) > 9))], [2, true]);
  chk('Ganzer-Strich-Radierer löscht ihn', I.eraseWhole([s], 250, 200, 10).length, 0);
  chk('Daneben radieren ändert nichts (gleiches Array)', I.eraseFrom([s], 250, 400, 10)[0] === s, true);

  // ---------- Speicherformat ----------
  const enc = I.encodeStrokes([{ ...s, k: 'pinsel' }, { t: 'hl', c: '#ffe94d', w: 22, k: 'fueller', p: [1, 2, .5, 3, 4, .5] }]);
  const dec = I.decodeStrokes(enc);
  chk('Striche speichern/laden (Stiftart, Textmarker, Punkte)', [dec[0].k, dec[1].t, dec[0].p.length === s.p.length, Math.abs(dec[0].p[0] - s.p[0]) < 0.06], ['pinsel', 'hl', true, true]);
  chk('Alte Striche ohne Stiftart → Füller', I.decodeStrokes(JSON.stringify([['pen', '#000', 2, [10, 10, 50, 5, 5, 0]]]))[0].k, 'fueller');
  chk('Kaputte Daten → leer', I.decodeStrokes('{kaputt'), []);
  chk('Strichbreite je Stiftart', [I.widthAt({ t: 'pen', w: 2, k: 'kugel' }, 1), I.widthAt({ t: 'pen', w: 2, k: 'fueller' }, 1) > I.widthAt({ t: 'pen', w: 2, k: 'fueller' }, 0.1), I.widthAt({ t: 'hl', w: 22 }, 0.1)], [1.7, true, 22]);

  // ---------- Lasso ----------
  const page = { strokes: [s, { ...s, p: noisy(t => [600 + 50 * t, 800]) }], text: [{ x: 120, y: 190, s: 'Hallo', z: 20 }], items: [{ x: 700, y: 700, w: 100, h: 80, src: 'x' }] };
  const sel = I.lassoSelect(page, [[90, 150], [420, 150], [420, 260], [90, 260]]);
  chk('Lasso wählt Striche und Text darin, nicht außerhalb', sel, { si: [0], ti: [0], ii: [] });
  chk('Lasso wählt Bilder', I.lassoSelect(page, [[650, 650], [900, 650], [900, 850], [650, 850]]).ii, [0]);
  const box = I.selectionBox(page, sel);
  chk('Auswahlrahmen umschließt alles', [box.x < 101, box.y <= 190, box.x + box.w > 399], [true, true, true]);
  const moved = I.transformSelection(page, sel, { dx: 50, dy: 10 });
  chk('Verschieben: nur Ausgewähltes, Rest unverändert', [Math.round(moved.strokes[0].p[0] - s.p[0]), moved.text[0].x, moved.strokes[1] === page.strokes[1], page.text[0].x], [50, 170, true, 120]);
  const scaled = I.transformSelection(page, { si: [], ti: [0], ii: [0] }, { f: 2, ax: 0, ay: 0 });
  chk('Skalieren: Text größer, Bild doppelt so groß', [scaled.text[0].z, scaled.items[0].w, scaled.items[0].x], [40, 200, 1400]);
  chk('Punkt im Vieleck', [I.pointInPoly(5, 5, [[0, 0], [10, 0], [10, 10], [0, 10]]), I.pointInPoly(15, 5, [[0, 0], [10, 0], [10, 10], [0, 10]])], [true, false]);

  // ---------- Tinte, Drehen, Handballen ----------
  const wave = []; for (let i = 0; i <= 60; i++) wave.push(100 + i * 4, 200 + Math.sin(i / 5) * 20, i / 60);
  const o1 = I.strokeOutline({ t: 'pen', w: 2.8, k: 'fueller', p: wave });
  const ob = (o) => { const xs = o.map(q => q[0]), ys = o.map(q => q[1]); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
  chk('Tinte: geschlossener Umriss, nur endliche Punkte, umschließt den Strich', [o1.length > 100, o1.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), ob(o1)[0] < 101, ob(o1)[1] > 339], [true, true, true, true]);
  const thick = (k, pr) => { const pts = []; for (let i = 0; i <= 30; i++) pts.push(i * 5, 0, pr); const b = ob(I.strokeOutline({ w: 3, k, p: pts })); return b[3] - b[2]; };
  chk('Druck macht den Füller dicker, Kugelschreiber bleibt gleich', [thick('fueller', 1) > thick('fueller', 0.1) * 1.5, Math.abs(thick('kugel', 1) - thick('kugel', 0.1)) < 0.4], [true, true]);
  chk('Ein einzelner Punkt wird ein Kreis', I.strokeOutline({ w: 3, k: 'fueller', p: [10, 10, .5] }).length, 12);
  const rot = I.rotateSelection({ strokes: [{ p: [10, 0, .5] }, { p: [5, 5, .5] }], text: [], items: [] }, { si: [0] }, Math.PI / 2, 0, 0);
  chk('Drehen: nur Ausgewähltes, 90° um den Mittelpunkt', [rot.strokes[0].p.map(v => Math.round(v * 100) / 100), rot.strokes[1].p], [[0, 10, 0.5], [5, 5, 0.5]]);
  const T = 1e9;
  chk('Handballen: große Fläche oder kurz nach dem Stift = Hand, Stift nie', [I.isPalm({ pointerType: 'touch', width: 70, height: 60 }, 0, T), I.isPalm({ pointerType: 'touch', width: 12 }, T - 400, T), I.isPalm({ pointerType: 'touch', width: 12 }, T - 5000, T), I.isPalm({ pointerType: 'pen', width: 1 }, T, T)], [true, true, false, false]);
  const m1 = I.stageMetrics({ stageW: 800, stageH: 900, cssW: 768, zoom: 1 });
  const mOut = I.stageMetrics({ stageW: 800, stageH: 900, cssW: 500, zoom: 0.65 });
  const mIn = I.stageMetrics({ stageW: 800, stageH: 900, cssW: 1500, zoom: 2 });
  const mStepA = I.stageMetrics({ stageW: 800, stageH: 900, cssW: 752, zoom: 0.98 });
  const mStepB = I.stageMetrics({ stageW: 800, stageH: 900, cssW: 760, zoom: 0.99 });
  chk('Arbeitsfläche-Ränder: weicher Übergang und Platz zum Verschieben bei Rein/Rauszoom', [
    m1.padx === 16 && m1.padyTop === 22,
    mOut.padx > 200 && mOut.padyTop > 200,
    mIn.padx > 150 && mIn.padyTop > 200 && mIn.padyBottom > 300,
    Math.abs(mStepA.padx - mStepB.padx) < 40 && Math.abs(mStepA.padyTop - mStepB.padyTop) < 30
  ], [true, true, true, true]);

  // ---------- Bibliothek ----------
  const st = S.normalize({});
  const schule = S.addFolder(st, 'Schule'); const k10 = S.addFolder(st, '10. Klasse', schule.id); const mathe = S.addFolder(st, 'Mathe', k10.id); const privat = S.addFolder(st, 'Privat');
  chk('Ordner beliebig tief, Pfad', S.folderPath(st, mathe.id).map(f => f.name), ['Schule', '10. Klasse', 'Mathe']);
  chk('Unterordner sortiert', S.childFolders(st, null).map(f => f.name), ['Privat', 'Schule']);
  const d1 = S.newDoc(st, { title: 'Parabeln', folderId: mathe.id }); const d2 = S.newDoc(st, { title: 'Tagebuch', folderId: privat.id }); const d3 = S.newDoc(st, { title: 'Ideen' });
  chk('Notizbuch ohne Fach, mit Cover und Seitenliste', [d3.subjectId, d3.folderId, !!d3.cover.color, d3.pages, d3.bookmarks], [null, null, true, [], []]);
  chk('Anzahl inkl. Unterordner', [S.countIn(st, schule.id), S.countIn(st, mathe.id), S.countIn(st, privat.id)], [1, 1, 1]);
  chk('Ordner nicht in sich selbst/eigenen Unterordner verschieben', [S.moveFolder(st, schule.id, mathe.id), S.moveFolder(st, schule.id, schule.id), S.moveFolder(st, mathe.id, privat.id), S.folderPath(st, mathe.id).map(f => f.name)], [false, false, true, ['Privat', 'Mathe']]);
  S.deleteFolder(st, privat.id);
  chk('Ordner löschen: Inhalt wandert nach oben, nichts geht verloren', [st.folders.map(f => f.name).sort(), S.folderOf(st, mathe.id).parentId, d2.folderId, st.docs.length], [['10. Klasse', 'Mathe', 'Schule'], null, null, 3]);
  chk('Suche nach Titel und Ordnername', [S.searchDocs(st, 'parab').map(d => d.title), S.searchDocs(st, 'mathe').map(d => d.title), S.searchDocs(st, '').length], [['Parabeln'], ['Parabeln'], 0]);
  d1.updatedAt = '2026-11-20T10:00:00Z'; d2.updatedAt = '2026-11-25T10:00:00Z'; d3.updatedAt = '2026-11-22T10:00:00Z';
  chk('Sortierung', [S.sortDocs(st.docs, 'bearbeitet').map(d => d.title), S.sortDocs(st.docs, 'name').map(d => d.title)], [['Tagebuch', 'Ideen', 'Parabeln'], ['Ideen', 'Parabeln', 'Tagebuch']]);
  const n = S.normalize({ docs: [{ id: 'x', title: 'Alt', folderId: 'gibtsnicht' }] });
  chk('Alte/verwaiste Daten werden repariert', [n.folders, n.docs[0].folderId, n.docs[0].pages, n.docs[0].bookmarks], [[], null, [], []]);

  // ---------- Notizbuch-Zugriff für Coden Chats ----------
  chk('Leere Notizbücher erzeugen keinen Katalog-Prompt', S.notebooksPrompt(S.normalize({})), '');
  d1.pages = ['p1', 'p2', 'p3', 'p4']; d1.bookmarks = ['p2'];
  const nbP = S.notebooksPrompt(st, { currentDocId: d1.id, currentPage: 2 });
  chk('Notizbuch-Katalog enthält ID, Titel, Ordner, Lesezeichen und aktuellen Status', [
    nbP.includes(`[${d1.id}] "Parabeln"`),
    nbP.includes('Ordner: Mathe'),
    nbP.includes('4 Seiten'),
    nbP.includes('Lesezeichen: S. 2'),
    nbP.includes('AKTUELL GEÖFFNET (Seite 2)')
  ], [true, true, true, true, true]);
  chk('Seitenbereich wird korrekt geparst und auf max. 3 begrenzt', [
    S.expandPageSpec('2', 5),
    S.expandPageSpec('1-4', 5),
    S.expandPageSpec('5-3', 5),
    S.expandPageSpec('99', 4),
    S.expandPageSpec('', 4)
  ], [[2], [1, 2, 3], [3, 4, 5], [4], [1]]);
  chk('parseNotebookReads erkennt vollständige und gestreamte Tags', [
    S.parseNotebookReads('Moment <notebook_read id="dc1" page="2"/> und <notebook_read title="Mathe" pages="1-3"/>'),
    S.parseNotebookReads('Gleich <notebook_read id="dc2" page="1', { allowUnclosed: true })
  ], [
    [{ ref: 'dc1', pageSpec: '2' }, { ref: 'Mathe', pageSpec: '1-3' }],
    [{ ref: 'dc2', pageSpec: '1' }]
  ]);
  chk('hideNotebookTags entfernt fertige und offene Tags sauber',
    S.hideNotebookTags('Ich schaue rein: <notebook_read id="dc1" page="2"/>Fertig.<notebook_read id="dc2"'),
    'Ich schaue rein: Fertig.');

  console.log(fails ? `\n${fails} Fehler` : '\nAlle Notizbuch-Tests grün');
  process.exit(fails ? 1 : 0);
})();
