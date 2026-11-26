// test/context.test.js – Chatverlauf komprimieren (~10.000 Eingabe-Tokens, letzte Nutzer-Nachricht bleibt ganz)
const { compressMessages, lighten, tok } = require('../server/context');
const { historyFrom } = require('../server/agents');

let fails = 0;
const chk = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fails++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` (bekam ${JSON.stringify(got)}, erwartet ${JSON.stringify(want)})`}`);
};
const total = (msgs) => msgs.reduce((a, m) => a + tok(m.content), 0);
const words = (n, w = 'wort') => Array(n).fill(w).join(' ');

// 1) Kurze Chats bleiben unverändert
const short = [{ role: 'system', content: 'Du bist Coden.' }, { role: 'user', content: 'Hallo' }, { role: 'assistant', content: 'Hi!' }, { role: 'user', content: 'Wie geht es?' }];
const r1 = compressMessages(short, { budget: 10000 });
chk('Kurzer Chat: unverändert', [r1.compressed, JSON.stringify(r1.messages) === JSON.stringify(short)], [false, true]);

// 2) Langer Chat: unter dem Budget, System + letzte Frage bleiben, Rest zusammengefasst
const long = [{ role: 'system', content: 'SYSTEM ' + words(2000, 'regel') }];
for (let i = 0; i < 40; i++) {
    long.push({ role: 'user', content: `Frage ${i}: ` + words(300, 'frage') });
    long.push({ role: 'assistant', content: `Antwort ${i}: ` + words(200, 'text') + '\n```js\n' + Array(60).fill('const x = 1;').join('\n') + '\n```' });
}
long.push({ role: 'user', content: 'LETZTE FRAGE ' + words(50, 'jetzt') });
const r2 = compressMessages(long, { budget: 10000 });
const out2 = r2.messages;
chk('Langer Chat: komprimiert und ≤ 10.000 Tokens', [r2.compressed, r2.before > 30000, r2.after <= 10000, total(out2) === r2.after], [true, true, true, true]);
chk('Systemprompt bleibt vorne, letzte Frage ganz am Ende und vollständig', [out2[0].role, out2[0].content.startsWith('SYSTEM'), out2[out2.length - 1].content === long[long.length - 1].content], ['system', true, true]);
chk('Früherer Verlauf als Zusammenfassung, neueste Runde bleibt', [out2[0].content.includes('Früherer Verlauf'), out2.some(m => m.content.startsWith('Antwort 39'))], [true, true]);
chk('Verlauf nach dem System beginnt mit dem Nutzer und wechselt sauber', [out2[1].role, out2.slice(1).every((m, i, a) => i === 0 || m.role !== a[i - 1].role)], ['user', true]);
chk('Alte Antworten ohne langen Code', out2.slice(1, -3).every(m => !/const x = 1;\nconst x = 1;\nconst x = 1;\nconst x = 1;\nconst x = 1;\nconst x = 1;\nconst x = 1;/.test(m.content)), true);

// 3) Ausnahme: sehr lange Nutzer-Nachricht bleibt vollständig (auch über dem Budget)
const huge = 'TEXT ' + words(12000, 'lang');
const r3 = compressMessages([{ role: 'system', content: 'S' }, { role: 'user', content: 'alt ' + words(500) }, { role: 'assistant', content: 'alt ' + words(500) }, { role: 'user', content: huge }], { budget: 10000 });
chk('Lange Nutzer-Nachricht bleibt ganz, Verlauf davor fällt weg', [r3.messages[r3.messages.length - 1].content === huge, r3.messages.length <= 3], [true, true]);

// 4) Riesiger Systemprompt wird auf 60 % gekürzt, Bilder der letzten Nachricht bleiben
const r4 = compressMessages([{ role: 'system', content: words(20000, 'projekt') }, { role: 'user', content: 'Was ist auf dem Bild?', images: ['data:image/png;base64,AAAA'] }], { budget: 10000 });
chk('Systemprompt ≤ 6.000 Tokens, Bild bleibt', [tok(r4.messages[0].content) <= 6000, r4.messages[0].content.includes('gekürzt'), r4.messages[1].images.length], [true, true, 1]);

// 5) Fortsetzung (Antwort in Etappen): alles ab der letzten Nutzer-Nachricht bleibt ganz
const partial = 'TEIL ' + words(9000, 'html');
const r5 = compressMessages([{ role: 'system', content: 'S' }, { role: 'user', content: 'Bau eine Seite' }, { role: 'assistant', content: partial }, { role: 'user', content: require('../server/ai').CONTINUE || 'CONTINUE' }], { budget: 10000 });
chk('Letzte Runde (Fortsetzung) wird nicht zerstört', r5.messages.some(m => m.content === partial) || !r5.compressed, true);

// 6) lighten: Code-Blöcke und Elemente werden zu Platzhaltern, kurzer Code bleibt
chk('lighten: langer Code → Platzhalter, kurzer bleibt', [lighten('a\n```py\n' + 'x\n'.repeat(20) + '```').includes('[Code (py), 21 Zeilen – gekürzt]'), lighten('```\nx=1\n```').includes('x=1')], [true, true]);

// 7) Apps: nur der Chatverlauf wird komprimiert (die Dateien stehen im Systemprompt des Agenten)
const rows = [];
for (let i = 0; i < 18; i++) rows.push({ role: i % 2 ? 'assistant' : 'user', body: (i % 2 ? 'Antwort ' : 'Wunsch ') + i + ' ' + words(1500, 'app') });
const hist = historyFrom(rows);
chk('Apps: Verlauf ≤ 10.000 Tokens, letzter Wunsch vollständig', [total(hist) <= 10000, hist[hist.length - 1].content === rows[rows.length - 2].body || hist[hist.length - 1].content.includes('Antwort 17')], [true, true]);

console.log(fails ? `\n${fails} Fehler` : '\nAlle Kontext-Tests grün');
process.exit(fails ? 1 : 0);
