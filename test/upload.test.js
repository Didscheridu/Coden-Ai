// Upload-Prüfung: nur Bilder und Text, nichts Ausführbares
const U = require('../shared/upload-check');
let ok = 0, bad = 0;
const chk = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { ok++; console.log('OK  ', n); } else { bad++; console.log('FAIL', n, `(bekam ${g}, erwartet ${w})`); } };
const B = (...a) => new Uint8Array(a.flat());
const T = (s) => new TextEncoder().encode(s);
const run = (name, bytes, type = '') => U.inspect({ name, size: bytes.length, bytes, type });
const PNG = B(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13), JPG = B(0xff, 0xd8, 0xff, 0xe0, 0, 16), GIF = T('GIF89a....'), WEBP = T('RIFF\0\0\0\0WEBPVP8 ');

chk('PNG ok', run('a.png', PNG, 'image/png').kind, 'image');
chk('JPG ok', run('a.jpeg', JPG, 'image/jpeg').mime, 'image/jpeg');
chk('GIF ok', run('a.gif', GIF).kind, 'image');
chk('WebP ok', run('a.webp', WEBP).kind, 'image');
chk('Code ok', run('app.js', T('console.log("hi")\n')).kind, 'text');
chk('JSON/Umlaute ok', run('daten.json', T('{"name":"Müller"}')).kind, 'text');
chk('Latin-1-Text ok', run('alt.txt', B(0x47, 0x72, 0xfc, 0xdf, 0x65)).kind, 'text');
chk('SVG als Text', run('logo.svg', T('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml').kind, 'text');
chk('exe an der Endung', run('setup.exe', T('hallo')).ok, false);
chk('exe am Inhalt (als .txt getarnt)', run('notiz.txt', B(0x4d, 0x5a, 0x90, 0, 3, 0)).ok, false);
chk('ELF am Inhalt', run('lauf', B(0x7f, 0x45, 0x4c, 0x46, 2, 1)).ok, false);
chk('ZIP am Inhalt (als .png getarnt)', run('bild.png', B(0x50, 0x4b, 0x03, 0x04, 0)).ok, false);
chk('Word-Dokument (docx = zip)', run('brief.docx', B(0x50, 0x4b, 0x03, 0x04)).ok, false);
chk('Makro-Excel', run('x.xlsm', T('a')).ok, false);
chk('PDF abgelehnt', run('r.pdf', T('%PDF-1.7')).ok, false);
chk('PDF im Textgewand', run('r.txt', T('%PDF-1.7 ...')).ok, false);
chk('bat', run('start.bat', T('echo hi')).ok, false);
chk('doppelte Endung', run('foto.exe.jpg', JPG).ok, false);
chk('Endung passt nicht zum Bild', run('foto.png', JPG).ok, false);
chk('Bild-Typ gelogen', run('a.png', T('<html>'), 'image/png').ok, false);
chk('versteckte Zeichen im Namen (RLO)', run('foto‮gpj.exe', PNG).ok, false);
chk('Binärdatei ohne Endung', run('blob', B(1, 2, 0, 3, 4, 0, 5)).ok, false);
chk('Virus-Testdatei', run('eicar.txt', T('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')).ok, false);
chk('leer', run('leer.txt', B()).ok, false);
chk('über 2 MB ok', U.inspect({ name: 'a.txt', size: 3 * 1024 * 1024, bytes: T('a') }).ok, true);
chk('zu groß (> 15 MB)', U.inspect({ name: 'a.txt', size: 16 * 1024 * 1024, bytes: T('a') }).ok, false);
chk('Pfad im Namen wird gekürzt', run('../../etc/x.txt', T('a')).name, 'x.txt');

const b64 = (u) => Buffer.from(u).toString('base64');
chk('Daten-URL PNG ok', U.inspectImageDataUrl('data:image/png;base64,' + b64(PNG)).ok, true);
chk('Daten-URL: falscher Inhalt', U.inspectImageDataUrl('data:image/png;base64,' + b64(T('<script>alert(1)</script>'))).ok, false);
chk('Daten-URL: SVG nicht erlaubt', U.inspectImageDataUrl('data:image/svg+xml;base64,' + b64(T('<svg/>'))).ok, false);
chk('Daten-URL: kein Base64', U.inspectImageDataUrl('data:image/png;base64,@@@').ok, false);
chk('Daten-URL: fremde URL', U.inspectImageDataUrl('https://evil.example/x.png').ok, false);

console.log(`\n${ok}/${ok + bad} bestanden`); if (bad) process.exit(1);
