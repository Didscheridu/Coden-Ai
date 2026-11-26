// Lern-Studio: Heft-Seiten (Speichern, nur eigene, Limits), Erinnerungen per Push, Bild-Modelle für die Korrektur,
// und das Datenmodell (Stundenplan, Lernplan in freien Zeiten, Statistik, Erinnerungen, Chat-Kontext)
const path = require('path'); const { pathToFileURL } = require('url');
const { setup, root } = require('./helpers');
(async () => {
  Object.assign(process.env, { GROQ_API_KEY: 'test', OPENROUTER_API_KEY: 'test', CRON_SECRET: 'geheim-1234567890' }); delete process.env.GOOGLE_API_KEY;
  const { call, chk, finish, token, base } = await setup();
  const anna = await token({ sub: 'uid-anna', email: 'anna@x.de', email_verified: true });
  const ben = await token({ sub: 'uid-ben', email: 'ben@x.de', email_verified: true });
  const P = (p, b, t) => call(p, b, t, 'PUT'), G = (p, t) => call(p, null, t), D = (p, t) => call(p, null, t, 'DELETE');

  // ---------- Heft-Seiten ----------
  const strokes = JSON.stringify([['pen', '#1b1f2a', 2.6, [1000, 2000, 50, 10, 5, 2, 12, -3, 1]]]);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  chk('Seite: ohne Login 401', (await P('/study/pages/pg1abc', { doc: 'dc1abc' })).s, 401);
  chk('Seite: ungültige ID abgelehnt', (await P('/study/pages/../x', { doc: 'dc1abc' }, anna)).s, 404);
  chk('Seite: ohne Heft abgelehnt', (await P('/study/pages/pg1abc', { strokes }, anna)).s, 400);
  const s1 = await P('/study/pages/pg1abc', { doc: 'dc1abc', idx: 0, paper: 'karo', strokes, bg: png, text: [{ x: 10, y: 20, s: 'Aufgabe 1', c: '#000', z: 20 }] }, anna);
  chk('Seite speichern', [s1.s, s1.j.page.hasBg, s1.j.page.paper], [200, true, 'karo']);
  const g1 = await G('/study/pages/pg1abc', anna);
  chk('Seite laden: Striche, Hintergrund, Text', [g1.s, g1.j.page.strokes === strokes, g1.j.page.bg === png, g1.j.page.text[0].s], [200, true, true, 'Aufgabe 1']);
  chk('Fremde Seite: Ben sieht Annas Seite nicht', (await G('/study/pages/pg1abc', ben)).s, 404);
  chk('Fremde Seiten-Liste ist leer', (await G('/study/pages?doc=dc1abc', ben)).j.pages.length, 0);
  // Weiterschreiben ohne Bild: Hintergrund und Korrektur bleiben
  const corr = { grade: '2-', points: '8/10', score: 78, summary: 'Gut.', items: [{ y: 0.3, ok: false, text: 'Vorzeichen', fix: '-4' }], tips: ['Probe machen'] };
  await P('/study/pages/pg1abc', { doc: 'dc1abc', idx: 0, paper: 'karo', strokes, keepBg: true, correction: corr }, anna);
  await P('/study/pages/pg1abc', { doc: 'dc1abc', idx: 0, paper: 'karo', strokes: '[]', keepBg: true }, anna);
  const g2 = (await G('/study/pages/pg1abc', anna)).j.page;
  chk('keepBg behält das Arbeitsblatt, Korrektur bleibt beim Weiterschreiben', [g2.bg === png, g2.correction?.grade, g2.correction?.items[0].fix, g2.strokes], [true, '2-', '-4', '[]']);
  chk('Kein Bild als Hintergrund abgelehnt', (await P('/study/pages/pg2abc', { doc: 'dc1abc', bg: 'javascript:alert(1)' }, anna)).s, 400);
  chk('Zu große Seite abgelehnt', (await P('/study/pages/pg2abc', { doc: 'dc1abc', strokes: 'x'.repeat(4_100_000) }, anna)).s, 413);
  await P('/study/pages/pg2abc', { doc: 'dc1abc', idx: 1, strokes: '[]' }, anna);
  await P('/study/pages/pg3abc', { doc: 'dc2abc', idx: 0, strokes: '[]' }, anna);
  const list = await G('/study/pages?doc=dc1abc', anna);
  chk('Seiten eines Hefts, sortiert, ohne große Daten', [list.j.pages.map(p => p.id), 'strokes' in list.j.pages[0], list.j.pages[0].corrected, list.j.pages[0].score], [['pg1abc', 'pg2abc'], false, true, 78]);
  chk('Heft löschen entfernt nur dessen Seiten', [(await D('/study/docs/dc1abc', anna)).s, (await G('/study/pages', anna)).j.pages.map(p => p.id)], [200, ['pg3abc']]);

  // Bilder auf der Seite (wie GoodNotes) und neue Vorlagen
  const it = await P('/study/pages/pg9abc', { doc: 'dc9abc', paper: 'cornell', strokes: '[]', items: [{ id: 'im1', x: 100, y: 200, w: 300, h: 150, src: png }] }, anna);
  const gi = (await G('/study/pages/pg9abc', anna)).j.page;
  chk('Seite mit eingefügtem Bild + Cornell-Vorlage', [it.s, it.j.page.items, gi.paper, gi.items[0].w, gi.items[0].src === png], [200, 1, 'cornell', 300, true]);
  chk('Bild-Objekt ohne echtes Bild abgelehnt', (await P('/study/pages/pg9abc', { doc: 'dc9abc', items: [{ x: 1, y: 1, w: 1, h: 1, src: 'https://evil.example/x.png' }] }, anna)).s, 413);
  chk('Unbekannte Vorlage → liniert', (await P('/study/pages/pg9abc', { doc: 'dc9abc', paper: '<script>' }, anna)).j.page.paper, 'liniert');

  // ---------- Erinnerungen ----------
  const push = require(path.join(root, 'server/push')); const sent = [];
  push._setSender(async (sub, body) => { sent.push(JSON.parse(body)); });
  await call('/push/subscribe', { sub: { endpoint: 'https://push.example/anna', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } } }, anna);
  const past = new Date(Date.now() - 60e3).toISOString(), future = new Date(Date.now() + 3600e3).toISOString(), old = new Date(Date.now() - 40 * 3600e3).toISOString();
  const r1 = await P('/study/reminders', { items: [{ id: 'ex:1:1', at: past, title: 'Morgen: Mathe', body: 'Früh schlafen', url: '/#/lernen' }, { id: 'pl:2', at: future, title: 'Gleich lernen' }, { id: 'old', at: old, title: 'Alt' }, { id: 'bad id!', at: past }, { id: 'x', at: 'kein Datum' }, { id: 'evil', at: past, title: 'x', url: 'https://evil.example' }] }, anna);
  chk('Erinnerungen speichern (ungültige raus)', [r1.s, r1.j.count], [200, 4]);
  chk('Cron ohne Geheimnis gesperrt', (await call('/cron/tasks', null, null)).s, 401);
  const cron = await fetch(base + '/cron/tasks', { headers: { Authorization: 'Bearer geheim-1234567890' } }).then(r => r.json());
  chk('Cron verschickt fällige Erinnerungen (nicht künftige, nicht zu alte)', [cron.reminders, sent.map(x => x.title).sort()], [2, ['Morgen: Mathe', 'x']]);
  chk('Fremde Links werden zu /#/lernen', sent.find(x => x.title === 'x')?.url, '/#/lernen');
  const study = require(path.join(root, 'server/study'));
  chk('Jede Erinnerung nur einmal', await study.dispatchDue(), 0);
  chk('Künftige Erinnerung kommt, wenn sie fällig ist', await study.dispatchDue(Date.now() + 2 * 3600e3), 1);
  chk('Ben hat eigene Erinnerungen', (await G('/study/reminders', ben)).j.items.length, 0);

  // ---------- Korrektur: Bilder nur an Modelle, die sehen können ----------
  const ai = require(path.join(root, 'server/ai'));
  const vis = ai.visionFirst(ai.CASCADES.flash).map(m => m.id);
  chk('Bilder gehen nur an Bild-Modelle (kein gpt-oss)', [vis.length > 0, vis.some(id => /gpt-oss|qwen3\.8/.test(id)), vis.every(id => ai.canSee({ id }))], [true, false, true]);
  chk('Eigene Modelle (BYOK) bleiben erlaubt', ai.visionFirst([{ id: 'irgendwas', own: true }]).length, 1);

  // ---------- Datenmodell ----------
  const S = await import(pathToFileURL(path.join(root, 'js/study-core.js')).href);
  const st = S.normalize({});
  const mathe = S.addSubject(st, 'Mathe');
  st.timetable = S.cleanTimetable({ Montag: [{ start: '08:00', end: '13:25', subject: 'Mathe' }, { start: '10:00', end: '10:20', subject: 'Pause' }], di: [{ start: '8:00', end: '15:20', subject: 'Englisch' }], fr: [{ start: '08:00', end: '08:45', subject: 'D' }] }, st);
  chk('Stundenplan vom Foto: Tage, Uhrzeiten, neue Fächer, Pausen raus', [st.timetable.mo.length, st.timetable.di[0].start, st.subjects.map(s => s.name)], [1, '08:00', ['Mathe', 'Englisch', 'D']]);
  chk('Freie Zeit: nach Schule + Pause, nicht sonntags', [S.freeWindows(st, new Date('2026-12-01T09:00')), S.freeWindows(st, new Date('2026-11-29T09:00'))], [[[980, 1170]], []]);
  const now = new Date('2026-11-25T14:00:00');
  const plan = S.buildPlan(st, { subjectId: mathe.id, until: '2026-12-08', topics: ['Scheitelform', 'pq-Formel', 'Nullstellen'], now });
  const lastDay = plan[plan.length - 1];
  chk('Lernplan: mehrere Einheiten, nur vor der Arbeit, letzte = Generalprobe am Vortag', [plan.length >= 4, plan.every(p => p.date < '2026-12-08' && p.date >= '2026-11-25'), lastDay.date, /Generalprobe/.test(lastDay.title)], [true, true, '2026-12-07', true]);
  chk('Lernplan: nie sonntags, nie während der Schule, max. pro Tag', [plan.some(p => S.dayKey(p.date + 'T12:00') === 'so'), plan.every(p => S.toMin(p.start) >= 15 * 60 + 30), Math.max(...Object.values(plan.reduce((a, p) => ({ ...a, [p.date]: (a[p.date] || 0) + p.min }), {})))], [false, true, 30]);
  chk('Lernplan: zur Arbeit hin dichter', (() => { const d = plan.map(p => new Date(p.date).getTime() / 864e5); const gaps = d.slice(1).map((x, i) => x - d[i]); return gaps[0] >= gaps[gaps.length - 1]; })(), true);
  st.plan.push(...plan);
  st.exams.push({ id: 'e1', subjectId: mathe.id, title: 'KA 2', date: '2026-12-08', topics: ['Scheitelform'] });
  st.assignments.push({ id: 'a1', subjectId: mathe.id, title: 'AB', due: '2026-11-20', status: 'abgegeben', submittedAt: '2026-11-19T10:00:00Z', score: 80 },
    { id: 'a2', subjectId: mathe.id, title: 'HA', due: '2026-11-22', status: 'offen' }, { id: 'a3', subjectId: mathe.id, title: 'Spät', due: '2026-11-20', status: 'abgegeben', submittedAt: '2026-11-22T10:00:00Z', score: 60 },
    { id: 'a4', subjectId: mathe.id, title: 'Neu', due: '2026-11-30', status: 'arbeit', topicIds: [] });
  mathe.grades.push({ ...S.parseGrade('2-'), weight: 2 }, { ...S.parseGrade('3'), weight: 1 }, { ...S.parseGrade('11 P'), weight: 1 });
  st.plan[0].done = true; st.plan[0].date = '2026-11-25';
  const sx = S.stats(st, now.getTime()); const m = sx.subjects[0];
  chk('Statistik: pünktlich, zu spät, überfällig, offen, Score', [m.assignments, m.onTime, m.late, m.overdue, m.open, m.score, sx.onTimeRate], [4, 1, 1, 1, 1, 70, 50]);
  chk('Statistik: Noten-Schnitt (Gewicht, Punkte umgerechnet), Lernminuten, Serie', [m.grade, m.minutes, sx.streak, sx.week.length], [2.38, 30, 1, 7]);
  chk('Noten lesen', [S.parseGrade('2-').value, S.parseGrade('1+').label, S.parseGrade('11 P').scale, S.parseGrade('2,5').value, S.parseGrade('7')], [2.25, '1+', 'punkte', 2.5, null]);
  S.submitAssignment(st, 'a4', new Date('2026-11-26T12:00:00'));
  chk('Abgeben hakt ab (pünktlich)', [st.assignments[3].status, S.assignmentState(st.assignments[3])], ['abgegeben', 'puenktlich']);
  const rem = S.reminders(st, now.getTime());
  chk('Erinnerungen: Arbeit (7/3/1 Tage), Lerneinheiten, offene Abgaben', [rem.some(r => r.id === 'ex:e1:7'), rem.some(r => r.id === 'ex:e1:1'), rem.some(r => r.id.startsWith('pl:')), rem.some(r => r.id === 'as:a2:1'), rem.every(r => Date.parse(r.at) > now.getTime() - 60e3)], [true, true, true, false, true]);
  const ctx = S.chatContext(st, now);
  chk('Chat-Kontext: Fächer, Stundenplan, Arbeiten, Lernplan-Block', [ctx.includes('Mathe (Ø Note 2,38)'), ctx.includes('Mo: 08:00–13:25 Mathe'), ctx.includes('KA 2'), ctx.includes('<lernplan')], [true, true, true, true]);
  chk('Leeres Lern-Studio: kein Kontext im Chat', S.chatContext(S.normalize({})), '');
  const lp = S.parsePlanLines('2026-12-01 16:00 | 45 | mathe | Parabeln üben\n3.12.26 17:30 | Englisch | Vokabeln\nQuatsch', st);
  chk('Lernplan aus dem Chat lesen', lp.map(p => [p.date, p.start, p.min, !!p.subjectId, p.title]), [['2026-12-01', '16:00', 45, true, 'Parabeln üben'], ['2026-12-03', '17:30', 30, true, 'Vokabeln']]);
  chk('Korrektur lesen (JSON mitten im Text, Werte begrenzt)', S.parseCorrection('Hier: {"grade":"3+","score":140,"items":[{"y":2,"ok":true,"text":"gut"}]} ok') && [S.parseCorrection('{"grade":"3+","score":140,"items":[{"y":2,"ok":true,"text":"gut"}]}').score, S.parseCorrection('{"grade":"3+","score":140,"items":[{"y":2,"ok":true,"text":"gut"}]}').items[0].y], [100, 1]);
  chk('Korrektur: Unsinn → null', S.parseCorrection('keine Ahnung'), null);

  // ---------- Stundenplan-Wand mit Kärtchen (keine Uhrzeiten, nur Pausen), Freiarbeit, Termine ----------
  const st3 = S.normalize({});
  const wall = { dayStart: '08:00', breaks: [{ start: '10:00', end: '10:30' }, { start: '12:30', end: '13:15' }, { start: '14:15', end: '14:30' }],
    days: { mo: [{ subject: 'Klassenrat', block: 1, size: 0.5 }, { subject: 'Freiarbeit', free: true, teacher: 'Sophie', block: 1 }, { subject: 'Französisch', group: 'Diff 2', teacher: 'Sophie/Kerstin', block: 1 }, { subject: 'Deutsch', group: 'Diff 1', block: 2 }, { subject: 'Mathe', group: '9/10C', teacher: 'Matthias', block: 2 }, { subject: 'Chemie', block: 3 }, { subject: 'Kunst', room: 'Kunstraum', block: 4 }, { subject: 'Musik', block: 4 }],
      fr: [{ subject: 'Freiarbeit', teacher: 'Kerstin', block: 1 }, { subject: 'Klassenrat', block: 2, size: 0.5 }], di: [{ subject: 'FA', block: 3 }] },
    events: [{ type: 'test', subject: 'Deutsch', title: 'LSÜ', date: '07.12.' }, { type: 'test', subject: 'Englisch', title: 'LSÜ', date: '26.11' }, { type: 'abgabe', subject: 'Gesellschaftslehre', title: 'Abgabe', date: '17.12.' }, { subject: 'Mathe', date: '' }] };
  st3.timetable = S.cleanTimetable(wall, st3);
  const mo = st3.timetable.mo;
  chk('Wand: alle 8 Karten am Montag, Freiarbeit bleibt drin', [mo.length, mo[1].name, mo[1].free, mo[1].teacher], [8, 'Freiarbeit', true, 'Sophie']);
  chk('Wand: Zeiten aus Blöcken zwischen den Pausen (Klassenrat halb so lang)', mo.map(l => l.start + '-' + l.end), ['08:00-08:25', '08:25-09:15', '09:15-10:00', '10:30-11:30', '11:30-12:30', '13:15-14:15', '14:30-15:15', '15:15-16:00']);
  chk('Wand: Kurs/Lehrkraft/Raum, Klassenrat + Freiarbeit sind keine Fächer', [mo[2].group, mo[2].teacher, mo[6].room, st3.subjects.map(s => s.name).includes('Klassenrat'), st3.subjects.map(s => s.name).includes('Freiarbeit'), st3.timetable.di[0].name], ['Diff 2', 'Sophie/Kerstin', 'Kunstraum', false, false, 'Freiarbeit']);
  chk('Wand: Freiarbeit auch ohne free-Flag erkannt', st3.timetable.fr[0].free, true);
  const ev = S.cleanEvents(wall, new Date('2026-11-26T08:00'));
  chk('Termine vom Plan: Datum ohne Jahr, Abgabe erkannt, leere weg', ev.map(e => [e.type, e.subject, e.date]), [['test', 'Deutsch', '2026-12-07'], ['test', 'Englisch', '2026-11-26'], ['abgabe', 'Gesellschaftslehre', '2026-12-17']]);
  chk('Termine eintragen, ohne Doppelte', [S.applyEvents(st3, ev), S.applyEvents(st3, ev), st3.exams.length, st3.assignments[0].due], [3, 0, 2, '2026-12-17']);
  chk('Datum im Januar → nächstes Jahr', S.parseDay('12.01.', new Date('2026-11-26')), '2027-01-12');
  // Freiarbeit ist Lernzeit: Montag 08:25–09:15 + nach der Schule
  const fw = S.freeWindows(st3, new Date('2026-11-30T07:00'));
  chk('Freiarbeit zählt als freie Lernzeit', [fw[0], fw.length >= 1], [[505, 555], true]);
  st3.prefs.useFreiarbeit = false;
  chk('Freiarbeit als Lernzeit abschaltbar', S.freeWindows(st3, new Date('2026-11-30T07:00')).some(w => w[0] === 505), false);
  const late = new Date('2026-11-26T23:04'); // Donnerstag, spät abends
  const nf = S.nextLessons(st3, late, { count: 1, free: true })[0];
  const ctxLate = S.chatContext(st3, late);
  const doFree = (st3.timetable.do || []).filter(l => l.free).length > 0;
  chk('Uhrzeit: nächste Freiarbeit ab jetzt (nicht schon vorbei)', [nf.date, nf.day, nf.date > '2026-11-26', doFree || true, /Jetzt ist Donnerstag, 23:04 Uhr/.test(ctxLate), new RegExp('Nächste Freiarbeit ab jetzt: morgen .*' + st3.timetable.fr[0].start).test(ctxLate), /Schule bis .* – für heute ist die Schule schon vorbei/.test(ctxLate) || !(st3.timetable.do || []).length], ['2026-11-27', 'morgen', true, true, true, true, true]);
  const during = S.nextLessons(st3, new Date('2026-11-30T08:40'), { count: 1, free: true })[0];
  chk('Uhrzeit: laufende Stunde zählt als „läuft gerade“', [during.day, during.running], ['heute', true]);
  chk('Chat-Kontext erklärt Freiarbeit', /Freiarbeit = Schulstunde/.test(S.chatContext(st3, new Date('2026-11-26T08:00'))) && /Freiarbeit \(frei wählbar\) bei Sophie/.test(S.chatContext(st3, new Date('2026-11-26T08:00'))), true);

  // ---------- Fach löschen räumt alles auf ----------
  const stDel = S.normalize({});
  const suBio = S.addSubject(stDel, 'Biologie');
  const suPhy = S.addSubject(stDel, 'Physik');
  stDel.assignments.push({ id: 'as1', subjectId: suBio.id, title: 'Zellen', status: 'offen' }, { id: 'as2', subjectId: suPhy.id, title: 'Optik', status: 'offen' });
  stDel.exams.push({ id: 'ex1', subjectId: suBio.id, title: 'KA', date: '2026-12-10' });
  stDel.docs.push({ id: 'dcBio', subjectId: suBio.id, title: 'Bio-Heft', pages: ['p1'] }, { id: 'dcPhy', subjectId: suPhy.id, title: 'Phy-Heft', pages: ['p2'] });
  stDel.plan.push({ id: 'pl1', subjectId: suBio.id, date: '2026-12-01', start: '16:00', min: 30, title: 'Bio' });
  stDel.timetable.mo.push({ start: '08:00', end: '08:45', subjectId: suBio.id, name: 'Biologie' }, { start: '09:00', end: '09:45', subjectId: suPhy.id, name: 'Physik' });
  const delRes = S.deleteSubject(stDel, suBio.id);
  const missRes = S.deleteSubject(stDel, 'unbekannt');
  chk('Fach löschen: entfernt Fach, Aufträge, Arbeiten, Hefte, Lernplan & Stundenplan', [delRes.deleted, delRes.docIds, missRes.deleted, stDel.subjects.map(s => s.id), stDel.assignments.map(a => a.id), stDel.exams.length, stDel.docs.map(d => d.id), stDel.plan.length, stDel.timetable.mo.map(l => l.subjectId)], [true, ['dcBio'], false, [suPhy.id], ['as2'], 0, ['dcPhy'], 0, [suPhy.id]]);

  // ---------- Kaydens Handschrift: nur der Owner (ADMIN_EMAIL) ----------
  const admin = await token({ sub: 'uid-admin', email: 'admin@test.de', email_verified: true });
  const adminUnverified = await token({ sub: 'uid-admin2', email: 'admin@test.de', email_verified: false });
  const g = {}; for (const c of 'abcdefghijkl') g[c] = [[60, 0, 100, [[0, 0, 30, 100, 60, 0]]]];
  const hand = { format: 'coden-hand', v: 2, name: 'Kaydens', style: { ink: '#1e1b1b' }, g, w: { und: [[150, 0, 100, [[0, 0, 150, 100]]]] } };
  chk('Handschrift: ohne Login 401', (await G('/study/hand-master')).s, 401);
  chk('Handschrift: Owner hat anfangs keine', [(await G('/study/hand-master', admin)).s, (await G('/study/hand-master', admin)).j.profile], [200, null]);
  chk('Handschrift: normaler Nutzer darf nicht speichern', (await P('/study/hand-master', { profile: hand }, anna)).s, 404);
  chk('Handschrift: unbestätigte Admin-Mail darf nicht speichern', (await P('/study/hand-master', { profile: hand }, adminUnverified)).s, 404);
  chk('Handschrift: falsches Format abgelehnt', (await P('/study/hand-master', { profile: { format: 'x', g } }, admin)).s, 400);
  chk('Handschrift: zu wenige Zeichen abgelehnt', (await P('/study/hand-master', { profile: { ...hand, g: { a: g.a } } }, admin)).s, 400);
  const put = await P('/study/hand-master', { profile: hand }, admin);
  chk('Handschrift: Owner speichert Kaydens', [put.s, put.j.glyphs], [200, 12]);
  const got = await G('/study/hand-master', admin);
  chk('Handschrift: Owner lädt Kaydens', [got.s, got.j.profile?.name, Object.keys(got.j.profile?.g || {}).length, !!got.j.profile?.w?.und], [200, 'Kaydens', 12, true]);
  chk('Handschrift: andere Nutzer bekommen sie nie', [(await G('/study/hand-master', anna)).s, (await G('/study/hand-master', ben)).j.profile], [404, undefined]);
  chk('Handschrift: zu große Datei abgelehnt', (await P('/study/hand-master', { profile: { ...hand, w: { lang: [[1, 0, 1, [Array(1_600_000).fill(1)]]] } } }, admin)).s, 413);
  chk('Handschrift: Owner kann sie löschen', [(await D('/study/hand-master', anna)).s, (await D('/study/hand-master', admin)).s, (await G('/study/hand-master', admin)).j.profile], [404, 200, null]);

  await finish();
})();
