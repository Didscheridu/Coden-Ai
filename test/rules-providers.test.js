// Jeder BYOK-Anbieter muss auch in firestore.rules und firebase-blueprint.json erlaubt sein,
// sonst lehnt Firestore das Speichern des Keys ab (so war es bei OrcaRouter).
const fs = require('fs');
const path = require('path');
const { PROVIDERS } = require('../server/byok');

const root = path.join(__dirname, '..');
const ids = Object.keys(PROVIDERS).sort();
let bad = 0;
const ok = (name, cond) => { console.log(`${cond ? '✓' : '✗'} ${name}`); if (!cond) bad++; };

const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const lists = [...rules.matchAll(/provider in \[([^\]]+)\]/g)].map(m => m[1].match(/'([^']+)'/g).map(s => s.slice(1, -1)).sort()).filter(l => l.includes('openai'));
ok('firestore.rules hat zwei Anbieterlisten', lists.length === 2);
lists.forEach((l, i) => ok(`firestore.rules Liste ${i + 1} = PROVIDERS (${ids.join(', ')})`, JSON.stringify(l) === JSON.stringify(ids)));

const bp = fs.readFileSync(path.join(root, 'firebase-blueprint.json'), 'utf8');
const enums = [...bp.matchAll(/"provider": \{[^}]*"enum": (\[[^\]]+\])/g)].map(m => JSON.parse(m[1]).sort()).filter(e => e.includes('openai'));
ok('firebase-blueprint.json hat Anbieter-Enums', enums.length >= 2);
enums.forEach((e, i) => ok(`Blueprint Enum ${i + 1} = PROVIDERS`, JSON.stringify(e) === JSON.stringify(ids)));

if (bad) { console.error(`${bad} Fehler`); process.exit(1); }
console.log('Alle Anbieter-Regeln stimmen.');
