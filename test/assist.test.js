// Gedächtnis und eigene Assistenten: reine Logik aus shared/assist-core.js
const A = require('../shared/assist-core');
let n = 0, bad = 0;
const chk = (name, got, want) => { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) console.log('OK  ', name); else { bad++; console.log('FAIL', name, '\n   ist:  ', g, '\n   soll: ', w); } };

// --- Gedächtnis: altes Format wird übernommen ---
const old = A.memoryItems({ memory: ['Ich lerne Python.', '  ', 'Ich mag Katzen'] });
chk('Altes Format: leere Zeilen weg', old.map(m => m.t), ['Ich lerne Python.', 'Ich mag Katzen']);
chk('Altes Format: gilt überall', old.every(m => m.p === null), true);
chk('Neues Format hat Vorrang', A.memoryItems({ memory: ['alt'], memoryItems: [{ id: 'a', t: 'neu', at: 1, p: null }] }).map(m => m.t), ['neu']);
chk('Nichts gespeichert → leer', A.memoryItems({}), []);

// --- hinzufügen, doppelt, zu kurz, voll ---
let r = A.addMemory([], 'Ich heiße Kayden', { id: 'x1', now: 5 });
chk('Hinzufügen', r.added, { id: 'x1', t: 'Ich heiße Kayden', at: 5, p: null });
chk('Doppelt (egal ob groß/klein)', A.addMemory(r.items, 'ich heiße kayden').reason, 'schon da');
chk('Gleicher Satz in einem Projekt ist erlaubt', A.addMemory(r.items, 'Ich heiße Kayden', { p: 7 }).added?.p, 7);
chk('Zu kurz', A.addMemory([], 'ab').reason, 'zu kurz');
chk('Zeilenumbrüche werden zu Leerzeichen', A.addMemory([], 'Zeile eins\nZeile zwei').added.t, 'Zeile eins Zeile zwei');
chk('Auf 200 Zeichen gekürzt', A.addMemory([], 'a'.repeat(500)).added.t.length, 200);
const full = Array.from({ length: A.MEM.max }, (_, i) => ({ id: 'i' + i, t: 'Eintrag ' + i, at: 0, p: null }));
chk('Voll', A.addMemory(full, 'noch einer').reason, 'voll');
chk('Steuer-Tags werden entfernt', A.addMemory([], 'Mag <artifact type="html">Spiele</artifact> sehr').added.t, 'Mag Spiele sehr');

// --- ändern, löschen, suchen ---
const two = A.addMemory(r.items, 'Ich lerne Python', { id: 'x2' }).items;
chk('Löschen', A.removeMemory(two, 'x1').map(m => m.id), ['x2']);
chk('Ändern', A.editMemory(two, 'x2', 'Ich lerne JavaScript').find(m => m.id === 'x2').t, 'Ich lerne JavaScript');
chk('Ändern auf zu kurz wird ignoriert', A.editMemory(two, 'x2', 'a').find(m => m.id === 'x2').t, 'Ich lerne Python');
chk('Suchen', A.searchMemory(two, 'PYTH').map(m => m.id), ['x2']);
chk('Leere Suche zeigt alles', A.searchMemory(two, '').length, 2);

// --- pro Projekt getrennt ---
const mix = [{ id: 'g', t: 'Überall', at: 0, p: null }, { id: 'p7', t: 'Nur Projekt 7', at: 0, p: 7 }, { id: 'p8', t: 'Nur Projekt 8', at: 0, p: 8 }];
chk('Ohne Projekt nur Allgemeines', A.memoryFor(mix, null), ['Überall']);
chk('Projekt 7 sieht Allgemeines + eigenes', A.memoryFor(mix, 7), ['Überall', 'Nur Projekt 7']);
chk('Projekt-Id als Text geht auch', A.memoryFor(mix, '8'), ['Überall', 'Nur Projekt 8']);
chk('Spiegel fürs alte Feld enthält nur Allgemeines', A.legacyMirror(mix), ['Überall']);
chk('Prompt enthält Eintrag und Merk-Regel', /Nur Projekt 7/.test(A.memoryPrompt(mix, 7)) && /<remember>/.test(A.memoryPrompt(mix, 7)) && !/Projekt 8/.test(A.memoryPrompt(mix, 7)), true);
chk('Leeres Gedächtnis sagt „noch leer“', /noch leer/.test(A.memoryPrompt([], null)), true);

// --- <remember> lesen und verstecken ---
chk('Remember lesen (max. 3)', A.extractRemember('Ok! <remember>Mag Pizza</remember> <remember>Wohnt in Köln</remember><remember>a</remember><remember>Spielt Gitarre</remember><remember>Vierter Eintrag</remember>'), ['Mag Pizza', 'Wohnt in Köln', 'Spielt Gitarre']);
chk('Remember verstecken', A.stripRemember('Hallo <remember>Mag Pizza</remember> Welt'), 'Hallo  Welt');
chk('Unfertiges Remember beim Streamen verstecken', A.stripRemember('Hallo <remember>Mag Piz'), 'Hallo ');

// --- Assistenten ---
chk('Vorlagen sind vollständig', A.TEMPLATES.every(t => t.name && t.emoji && t.desc && t.instructions.length > 80), true);
chk('Vorlagen sind gültige Assistenten', A.TEMPLATES.every(t => A.upsertAssistant([], t).error === null), true);
let list = A.upsertAssistant([], { name: 'Mathe-Hilfe', emoji: '🧮', instructions: 'Erkläre Mathe in kleinen Schritten.' });
chk('Assistent anlegen', [list.error, list.list.length, list.assistant.emoji], [null, 1, '🧮']);
chk('Ohne Namen abgelehnt', A.upsertAssistant([], { name: ' ', instructions: 'Etwas Längeres hier.' }).error, 'Gib dem Assistenten einen Namen.');
chk('Zu kurze Anweisungen abgelehnt', /ein paar Sätze/.test(A.upsertAssistant([], { name: 'A', instructions: 'kurz' }).error), true);
chk('Doppelter Name abgelehnt', /gibt es schon/.test(A.upsertAssistant(list.list, { name: 'mathe-hilfe', instructions: 'Eine andere Anweisung.' }).error), true);
const edit = A.upsertAssistant(list.list, { ...list.assistant, name: 'Mathe-Profi' });
chk('Bearbeiten ersetzt statt zu verdoppeln', [edit.list.length, edit.list[0].name], [1, 'Mathe-Profi']);
chk('Standard-Emoji', A.cleanAssistant({ name: 'X', instructions: 'Irgendwas Langes.' }).emoji, '🤖');
chk('Nur zwei Emoji-Zeichen', [...A.cleanAssistant({ emoji: '😀😀😀😀' }).emoji].length, 2);
chk('Steuer-Tags in Anweisungen werden entfernt', A.cleanAssistant({ name: 'X', instructions: 'Sei nett. <remember>böse</remember>' }).instructions, 'Sei nett. böse');
const many = Array.from({ length: A.AS.max }, (_, i) => ({ id: 'a' + i, name: 'A' + i, emoji: '🤖', desc: '', instructions: 'Anweisung ' + i + ' hier.' }));
chk('Höchstens 20 Assistenten', /Mehr als 20/.test(A.upsertAssistant(many, { name: 'Neu', instructions: 'Noch eine Anweisung.' }).error), true);
chk('Löschen', A.removeAssistant(many, 'a0').length, 19);
chk('Finden', A.findAssistant(many, 'a3').name, 'A3');
chk('Unbekannter Assistent → null', A.findAssistant(many, 'zzz'), null);
chk('Gespeicherte Liste wird bereinigt', A.assistants({ assistants: [{ name: '', instructions: 'x'.repeat(20) }, { name: 'Gut', instructions: 'Gute Anweisung.' }, null] }).map(a => a.name), ['Gut']);
chk('Prompt nennt Namen und Anweisung', /„Mathe-Profi“/.test(A.assistantPrompt(edit.assistant)) && /kleinen Schritten/.test(A.assistantPrompt(edit.assistant)), true);
chk('Ohne Assistent kein Prompt', A.assistantPrompt(null), '');

console.log(`\n${n - bad}/${n} bestanden`); process.exit(bad ? 1 : 0);
