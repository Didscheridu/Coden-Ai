// Projekte: anlegen, ändern, Dateien, Grenzen und Trennung zwischen Nutzern
const { setup } = require('./helpers');
(async () => {
  const { call, chk, finish, token } = await setup();
  const A = await token({ sub: 'uid-pa', email: 'pa@x.de', email_verified: true });
  const B = await token({ sub: 'uid-pb', email: 'pb@x.de', email_verified: true });
  const P = (p, b, t) => call(p, b, t, 'POST'), PA = (p, b, t) => call(p, b, t, 'PATCH'), PU = (p, b, t) => call(p, b, t, 'PUT'), D = (p, t) => call(p, null, t, 'DELETE');

  chk('ohne Login', (await call('/projects')).s, 401);
  chk('Name nötig', (await P('/projects', { name: '  ' }, A)).s, 400);
  const c = await P('/projects', { name: 'Mathe', description: 'Lernen', instructions: 'Erkläre einfach.', color: '#ff0000' }, A);
  chk('anlegen', [c.s, c.j.project.name, c.j.project.color, c.j.project.instructions], [200, 'Mathe', '#ff0000', 'Erkläre einfach.']);
  const id = c.j.project.id;
  chk('ungültige Farbe wird ersetzt', (await P('/projects', { name: 'X', color: 'rot; evil' }, A)).j.project.color, '#8ab4f8');
  const list = await call('/projects', null, A);
  chk('Liste ohne Anweisungen (leicht)', [list.j.projects.length, 'instructions' in list.j.projects[0]], [2, false]);
  chk('Detail', (await call('/projects/' + id, null, A)).j.project.instructions, 'Erkläre einfach.');
  chk('fremder Nutzer sieht nichts', [(await call('/projects/' + id, null, B)).s, (await call('/projects', null, B)).j.projects.length], [404, 0]);
  chk('fremder Nutzer kann nicht ändern', (await PA('/projects/' + id, { name: 'Hack' }, B)).s, 404);
  chk('fremder Nutzer kann nicht löschen', (await D('/projects/' + id, B)).s, 404);
  chk('fremder Nutzer kann keine Dateien setzen', (await PU(`/projects/${id}/files`, { set: { 'a.txt': 'x' } }, B)).s, 404);
  chk('ändern', (await PA('/projects/' + id, { name: 'Mathe 2', instructions: 'Kurz.' }, A)).j.project, { ...(await call('/projects/' + id, null, A)).j.project });
  chk('leerer Name beim Ändern', (await PA('/projects/' + id, { name: '' }, A)).s, 400);

  // Dateien
  const f = await PU(`/projects/${id}/files`, { set: { 'notizen.md': '# Hallo', 'Übung 1.txt': 'a' } }, A);
  chk('Dateien setzen', [f.s, f.j.files.sort()], [200, ['notizen.md', 'Übung 1.txt']]);
  chk('Dateiinhalt', (await call('/projects/' + id, null, A)).j.files['notizen.md'], '# Hallo');
  chk('Dateiname mit ..', (await PU(`/projects/${id}/files`, { set: { '../x': 'a' } }, A)).s, 400);
  chk('Dateiname mit /', (await PU(`/projects/${id}/files`, { set: { 'a/b.txt': 'a' } }, A)).s, 400);
  chk('Datei zu groß', (await PU(`/projects/${id}/files`, { set: { 'gross.txt': 'x'.repeat(150001) } }, A)).s, 400);
  chk('Datei kein Text', (await PU(`/projects/${id}/files`, { set: { 'zahl.txt': 5 } }, A)).s, 400);
  const many = {}; for (let i = 0; i < 25; i++) many['f' + i + '.txt'] = 'x';
  chk('zu viele Dateien', (await PU(`/projects/${id}/files`, { set: many }, A)).s, 400);
  const big = {}; for (let i = 0; i < 5; i++) big['b' + i + '.txt'] = 'y'.repeat(140000);
  chk('Gesamtgröße', (await PU(`/projects/${id}/files`, { set: big }, A)).s, 400);
  chk('Datei entfernen', (await PU(`/projects/${id}/files`, { remove: ['notizen.md'] }, A)).j.files, ['Übung 1.txt']);
  chk('Dateianzahl in Liste', (await call('/projects', null, A)).j.projects.find(p => p.id === id).fileCount, 1);

  // Grenze Projektanzahl
  let last; for (let i = 0; i < 40; i++) { last = await P('/projects', { name: 'P' + i }, B); if (last.s !== 200) break; }
  chk('Projektgrenze', [last.s, (await call('/projects', null, B)).j.projects.length], [400, 30]);

  chk('löschen', [(await D('/projects/' + id, A)).s, (await call('/projects/' + id, null, A)).s], [200, 404]);
  finish();
})();
