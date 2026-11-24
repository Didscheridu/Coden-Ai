// Skills (wie Claude Skills): reine Logik aus shared/skills-core.js
const S = require('../shared/skills-core');
const zlib = require('zlib');
let n = 0, bad = 0;
const chk = (name, got, want) => { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) console.log('OK  ', name); else { bad++; console.log('FAIL', name, '\n   ist:  ', g, '\n   soll: ', w); } };
const inflate = async (u8) => new Uint8Array(zlib.inflateRawSync(Buffer.from(u8)));

(async () => {
// --- Namen ---
chk('slug: Umlaute und Leerzeichen', S.slug('Lern Zettel für Ärger!'), 'lern-zettel-fuer-aerger');
chk('slug: max. 64 Zeichen, kein Bindestrich am Ende', S.slug('a'.repeat(63) + ' b').length <= 64 && !S.slug('a'.repeat(63) + ' b').endsWith('-'), true);
chk('slug: leer', S.slug('!!!'), '');

// --- SKILL.md lesen ---
const md1 = '---\nname: pdf-tools\ndescription: Arbeitet mit PDF-Dateien. Use when the user mentions PDFs.\nlicense: MIT\n---\n\n# PDF\n\nSchritt 1: lesen.\n';
const p1 = S.parseSkillMd(md1);
chk('SKILL.md: Name', p1.name, 'pdf-tools');
chk('SKILL.md: Beschreibung', p1.desc, 'Arbeitet mit PDF-Dateien. Use when the user mentions PDFs.');
chk('SKILL.md: Inhalt ohne Kopf', p1.instructions, '# PDF\n\nSchritt 1: lesen.');
chk('SKILL.md: Lizenz', p1.license, 'MIT');
const md2 = '---\nname: "Mein Skill"\ndescription: >\n  Erste Zeile\n  zweite Zeile\nmetadata:\n  version: 2\n---\nText';
chk('Gefaltete Beschreibung (>)', S.parseSkillMd(md2).desc, 'Erste Zeile zweite Zeile');
chk('Name in Anführungszeichen → slug', S.parseSkillMd(md2).name, 'mein-skill');
chk('Unbekannte Schlüssel stören nicht', S.parseSkillMd(md2).instructions, 'Text');
chk('Mehrzeiliger Wert ohne Blockzeichen', S.parseSkillMd('---\nname: x-y\ndescription: eins\n  zwei\n---\nB').desc, 'eins zwei');
chk('Windows-Zeilenumbrüche', S.parseSkillMd('---\r\nname: win\r\ndescription: geht auch\r\n---\r\nInhalt').desc, 'geht auch');
chk('Ohne Kopf: Name aus Überschrift', S.parseSkillMd('# Tolle Sache\n\nmach was').name, 'tolle-sache');
chk('Steuer-Tags werden entfernt', S.parseSkillMd('---\nname: a\ndescription: b\n---\nHallo <remember>x</remember> <use_skill>y</use_skill>').instructions, 'Hallo x y');

// --- SKILL.md schreiben und wieder lesen ---
const sk = { name: 'test-skill', desc: 'Prüft: Dinge, die "wichtig" sind', instructions: '# T\n\nTu was.' };
const back = S.parseSkillMd(S.toSkillMd(sk));
chk('Hin und zurück: Name', back.name, 'test-skill');
chk('Hin und zurück: Beschreibung mit Doppelpunkt/Anführungszeichen', back.desc, sk.desc);
chk('Hin und zurück: Inhalt', back.instructions, sk.instructions);

// --- Speichern, Grenzen ---
let r = S.upsertSkill([], { name: 'Lernen', desc: 'Hilft beim Lernen für die Schule', instructions: 'Erkläre alles Schritt für Schritt.' }, { now: 5 });
chk('Neuer Skill', [r.error, r.skill.name, r.skill.on, r.skill.source, r.skill.at], [null, 'lernen', true, 'eigen', 5]);
chk('Name doppelt', S.upsertSkill(r.list, { name: 'lernen', desc: 'Noch ein Skill zum Lernen', instructions: 'Irgendwelche Anweisungen hier.' }).error, 'Es gibt schon einen Skill „lernen“.');
chk('Beschreibung zu kurz', /Beschreibung/.test(S.upsertSkill([], { name: 'x', desc: 'kurz', instructions: 'a'.repeat(30) }).error), true);
chk('Anweisungen zu kurz', /Anweisungen/.test(S.upsertSkill([], { name: 'x', desc: 'Eine lange Beschreibung', instructions: 'kurz' }).error), true);
chk('Ohne Namen', /Namen/.test(S.upsertSkill([], { name: '***', desc: 'Eine lange Beschreibung', instructions: 'a'.repeat(30) }).error), true);
const edit = S.upsertSkill(r.list, { ...r.skill, desc: 'Neue Beschreibung zum Lernen' });
chk('Bearbeiten behält Id', [edit.list.length, edit.list[0].id === r.skill.id, edit.list[0].desc], [1, true, 'Neue Beschreibung zum Lernen']);
const many = Array.from({ length: S.SK.max }, (_, i) => S.cleanSkill({ id: 'i' + i, name: 's' + i, desc: 'Beschreibung lang genug', instructions: 'a'.repeat(30) }));
chk('Höchstzahl', /Höchstens/.test(S.upsertSkill(many, { name: 'neu', desc: 'Beschreibung lang genug', instructions: 'a'.repeat(30) }).error), true);
const big = Array.from({ length: 10 }, (_, i) => S.cleanSkill({ id: 'b' + i, name: 'b' + i, desc: 'Beschreibung lang genug', instructions: 'x'.repeat(19990) }));
chk('Gesamtbudget', /Zu viel Text/.test(S.upsertSkill(big, { name: 'neu', desc: 'Beschreibung lang genug', instructions: 'y'.repeat(5000) }).error), true);
chk('Ausschalten', S.toggleSkill(r.list, r.skill.id, false)[0].on, false);
chk('Umschalten', S.toggleSkill(S.toggleSkill(r.list, r.skill.id), r.skill.id)[0].on, true);
chk('Löschen', S.removeSkill(r.list, r.skill.id).length, 0);
chk('Gespeicherte Liste wird bereinigt', S.skills({ skills: [null, { name: '', instructions: 'x'.repeat(30) }, { name: 'ok', desc: 'd', instructions: 'Inhalt hier' }] }).map(s => s.name), ['ok']);
chk('Finden per Id oder Name', [S.findSkill(r.list, r.skill.id)?.name, S.findSkill(r.list, 'Lernen')?.name, S.findSkill(r.list, 'zzz')], ['lernen', 'lernen', null]);
const files = S.cleanSkill({ name: 'f', files: [{ path: '../../etc/passwd', text: 'a' }, { path: 'a/SKILL.md', text: 'x' }, { path: 'ref.md', text: 'r' }, { path: 'ref.md', text: 'doppelt' }] }).files;
chk('Dateipfade bereinigt, SKILL.md und Doppelte raus', files.map(f => f.path), ['etc/passwd', 'ref.md']);

// --- Import aus Dateien ---
const imp = S.fromFiles([
    { path: 'pdf/SKILL.md', text: md1 },
    { path: 'pdf/reference/forms.md', text: 'Formulare' },
    { path: 'pdf/scripts/fill.py', text: 'print(1)' },
    { path: 'pdf/.hidden', text: 'geheim' },
    { path: 'anderes/x.md', text: 'gehört nicht dazu' }
], { from: 'pdf.zip' });
chk('Import: Name/Quelle', [imp.skill.name, imp.skill.source, imp.skill.from], ['pdf-tools', 'import', 'pdf.zip']);
chk('Import: nur Dateien aus dem Skill-Ordner, ohne versteckte', imp.skill.files.map(f => f.path), ['reference/forms.md', 'scripts/fill.py']);
chk('Import: einzelne .md ohne SKILL.md', S.fromFiles([{ path: 'notiz.md', text: '---\nname: notiz\ndescription: Eine Notiz als Skill\n---\nInhalt' }]).skill.name, 'notiz');
chk('Import: ohne Markdown → Fehler', /SKILL\.md/.test(S.fromFiles([{ path: 'a.py', text: 'x' }]).error), true);
chk('Import: Name aus Ordner, wenn Kopf fehlt', S.fromFiles([{ path: 'mein-ordner/SKILL.md', text: 'Nur Text ohne Kopf' }]).skill.name, 'mein-ordner');
const tooMany = S.fromFiles([{ path: 'SKILL.md', text: md1 }, ...Array.from({ length: 25 }, (_, i) => ({ path: `r${i}.md`, text: 'x' }))]);
chk('Import: zu viele Dateien → Rest übersprungen', [tooMany.skill.files.length, tooMany.skipped.length], [S.SK.files, 5]);

// --- ZIP: packen (ohne Kompression), entpacken, auch mit Deflate ---
const z = S.zip(S.exportFiles({ ...S.cleanSkill({ name: 'zip-test', desc: 'Ein Skill für den ZIP-Test', instructions: 'Größe ändern: äöü ✓' }), files: [{ path: 'ref/a.md', text: 'Anhang' }] }));
const un = await S.unzip(z, inflate);
chk('ZIP: Dateien', un.map(e => e.path), ['zip-test/SKILL.md', 'zip-test/ref/a.md']);
const fz = await S.fromZip(z, inflate, { from: 'zip-test.zip' });
chk('ZIP: wieder als Skill (Umlaute heil)', [fz.skill.name, fz.skill.instructions, fz.skill.files[0].text], ['zip-test', 'Größe ändern: äöü ✓', 'Anhang']);
chk('CRC32 bekannter Wert', S.crc32(new TextEncoder().encode('123456789')).toString(16), 'cbf43926');
// ZIP mit Deflate (wie von Claude/Finder/Windows) von Hand bauen
const deflZip = (entries) => {
    const parts = [], dir = []; let off = 0;
    const w16 = v => [v & 255, v >>> 8 & 255], w32 = v => [v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24 & 255];
    for (const e of entries) {
        const name = Buffer.from(e.path), raw = Buffer.from(e.data), c = zlib.deflateRawSync(raw), crc = S.crc32(raw);
        const common = [...w16(20), ...w16(0), ...w16(8), ...w16(0), ...w16(0x21), ...w32(crc), ...w32(c.length), ...w32(raw.length), ...w16(name.length), ...w16(0)];
        const loc = Buffer.from([...w32(0x04034b50), ...common]); parts.push(loc, name, c);
        dir.push(Buffer.from([...w32(0x02014b50), ...w16(20), ...common, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...w32(off)]), name);
        off += loc.length + name.length + c.length;
    }
    const dl = dir.reduce((n, x) => n + x.length, 0);
    return new Uint8Array(Buffer.concat([...parts, ...dir, Buffer.from([...w32(0x06054b50), 0, 0, 0, 0, ...w16(entries.length), ...w16(entries.length), ...w32(dl), ...w32(off), 0, 0])]));
};
const dz = deflZip([{ path: 'docs/', data: '' }, { path: 'docs/SKILL.md', data: md1.repeat(1) }, { path: 'docs/bild.png', data: '\x89PNG\x00\x00binär' }, { path: '__MACOSX/docs/._SKILL.md', data: '\x00\x05' }, { path: 'docs/scripts/run.sh', data: 'echo hallo' }]);
const fdz = await S.fromZip(dz, inflate);
chk('ZIP mit Deflate: Skill gelesen', [fdz.skill.name, fdz.skill.files.map(f => f.path)], ['pdf-tools', ['scripts/run.sh']]);
chk('ZIP mit Deflate: Bild als übersprungen gemeldet', fdz.skipped, ['docs/bild.png']);
let zerr = ''; try { await S.unzip(new Uint8Array([1, 2, 3, 4]), inflate); } catch (e) { zerr = e.message; }
chk('Kaputte ZIP → verständlicher Fehler', zerr, 'Das ist keine gültige ZIP-Datei.');

// --- GitHub-Links ---
chk('GitHub: Ordner', S.githubTarget('https://github.com/anthropics/skills/tree/main/skills/pdf'), { kind: 'dir', owner: 'anthropics', repo: 'skills', ref: 'main', path: 'skills/pdf' });
chk('GitHub: Datei', S.githubTarget('https://github.com/o/r/blob/dev/a/SKILL.md').kind, 'file');
chk('GitHub: raw', S.githubTarget('https://raw.githubusercontent.com/o/r/main/x/SKILL.md'), { kind: 'file', owner: 'o', repo: 'r', ref: 'main', path: 'x/SKILL.md' });
chk('GitHub: ganzes Repo', S.githubTarget('https://github.com/o/r.git'), { kind: 'dir', owner: 'o', repo: 'r', ref: '', path: '' });
chk('Kein GitHub-Link', [S.githubTarget('https://example.com/a'), S.githubTarget('kein link')], [null, null]);
chk('Raw-URL', S.rawUrl({ owner: 'o', repo: 'r', ref: '' }, 'a b/SKILL.md'), 'https://raw.githubusercontent.com/o/r/HEAD/a%20b/SKILL.md');

// --- Passende Skills finden ---
const list = [
    S.cleanSkill({ id: '1', name: 'lernzettel', desc: 'Erstellt Lernzettel und Zusammenfassungen zu einem Schulthema für die Arbeit', instructions: 'L'.repeat(30) }),
    S.cleanSkill({ id: '2', name: 'commit-nachricht', desc: 'Schreibt gute Git-Commit-Nachrichten aus einem Diff', instructions: 'C'.repeat(30) }),
    S.cleanSkill({ id: '3', name: 'aus', desc: 'Lernzettel Zusammenfassung Schulthema', instructions: 'A'.repeat(30), on: false })
];
chk('Passt: Lernzettel', S.matchSkills(list, 'Mach mir bitte einen Lernzettel zum Thema Photosynthese, ich schreibe morgen eine Arbeit').map(s => s.name), ['lernzettel']);
chk('Passt: Name genannt', S.matchSkills(list, 'nutze commit-nachricht').map(s => s.name), ['commit-nachricht']);
chk('Passt nicht: Smalltalk', S.matchSkills(list, 'Wie geht es dir heute?'), []);
chk('Ausgeschaltete Skills werden nie gewählt', S.matchSkills(list, 'Lernzettel Zusammenfassung Schulthema').map(s => s.name), ['lernzettel']);

// --- Slash ---
chk('Slash: /name Text', (({ skill, rest }) => [skill.name, rest])(S.parseSlash('/lernzettel Thema Zellen', list)), ['lernzettel', 'Thema Zellen']);
chk('Slash: nur /name', S.parseSlash('/commit-nachricht', list).rest, '');
chk('Slash: unbekannt', S.parseSlash('/lock pro', list), null);
chk('Slash-Vorschläge nur eingeschaltete', S.slashMatches(list, '/').map(s => s.name), ['lernzettel', 'commit-nachricht']);
chk('Slash-Vorschläge filtern', S.slashMatches(list, '/com').map(s => s.name), ['commit-nachricht']);

// --- Nachladen und Entwürfe ---
chk('use_skill erkennen', S.requested('Moment <use_skill>Lernzettel</use_skill>'), ['lernzettel']);
chk('use_skill ausblenden (auch halb gestreamt)', [S.stripRequests('a<use_skill>x</use_skill>b'), S.stripRequests('a<use_skill>lern')], ['ab', 'a']);
const draft = S.extractDraft('Hier ist er:\n<skill_draft>\n```markdown\n---\nname: Mathe Hilfe\ndescription: Hilft bei Mathe\n---\n# Mathe\nRechne vor.\n```\n</skill_draft>\nFertig.');
chk('Entwurf erkennen', [draft.skill.name, draft.skill.desc, draft.skill.instructions, draft.skill.source], ['mathe-hilfe', 'Hilft bei Mathe', '# Mathe\nRechne vor.', 'coden']);
chk('Kein Entwurf', S.extractDraft('nichts'), null);
chk('Anzeige: Entwurf als Code-Block', S.display('A <skill_draft>---\nname: x\n---\nB</skill_draft> C'), 'A \n```markdown\n---\nname: x\n---\nB\n```\n C');

// --- Prompt ---
const pr = S.skillsPrompt(list, { text: 'Lernzettel für die Arbeit über das Schulthema Zellen bitte' });
chk('Prompt: Katalog ohne ausgeschaltete', [/- lernzettel:/.test(pr.text), /- commit-nachricht:/.test(pr.text), /- aus:/.test(pr.text)], [true, true, false]);
chk('Prompt: passender Skill geladen', pr.loaded, ['lernzettel']);
chk('Prompt: Inhalt drin', pr.text.includes('=== SKILL: lernzettel ===') && pr.text.includes('L'.repeat(30)), true);
chk('Prompt: gewählter Skill (auch ausgeschaltet) wird geladen', S.skillsPrompt(list, { text: 'hallo', picked: ['3'] }).loaded, ['aus']);
chk('Prompt: ohne Treffer nichts geladen', S.skillsPrompt(list, { text: 'hallo' }).loaded, []);
chk('Prompt: ohne Skills Hinweis', /noch keine Skills/.test(S.skillsPrompt([], {}).text), true);
const huge = S.cleanSkill({ id: 'h', name: 'gross', desc: 'Sehr großer Skill', instructions: 'z'.repeat(19000), files: [{ path: 'a.md', text: 'q'.repeat(15000) }, { path: 'b.md', text: 'w'.repeat(15000) }] });
const hp = S.skillsPrompt([huge], { picked: ['h'], budget: 30000 });
chk('Prompt: Budget wird eingehalten, fehlende Dateien genannt', [hp.text.length < 33000, /nicht geladen: a\.md, b\.md/.test(hp.text)], [true, true]);
const lm = S.loadedMessage(list, ['commit-nachricht', 'gibtsnicht']);
chk('Nachgeladener Skill als Nachricht', [lm.names, lm.text.includes('=== SKILL: commit-nachricht ===')], [['commit-nachricht'], true]);
chk('Nachladen unbekannt → null', S.loadedMessage(list, ['nix']), null);

// --- Vorlagen sind gültig ---
let all = [];
for (const t of S.TEMPLATES) { const x = S.upsertSkill(all, { ...t, source: 'vorlage' }); if (x.error) console.log(t.name, x.error); all = x.list; }
chk('Alle Vorlagen lassen sich speichern', all.length, S.TEMPLATES.length);
chk('Vorlagen als ZIP exportierbar und wieder importierbar', (await Promise.all(all.map(async s => (await S.fromZip(S.zip(S.exportFiles(s)), inflate)).skill.name))), all.map(s => s.name));

console.log(`\n${n - bad}/${n} bestanden`); process.exit(bad ? 1 : 0);
})();
