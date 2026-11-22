// Schutz vor „HTTP 500 überall“: Das Backend lädt alles per require(). Reine ES-Module (package.json "type": "module"
// ohne CommonJS-Einstieg) stürzen auf älteren Node-Versionen bei Vercel schon beim Start ab (ERR_REQUIRE_ESM).
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const deps = Object.keys(require(path.join(root, 'package.json')).dependencies || {});
let bad = 0;
const hasRequireEntry = (p) => { const e = p.exports; if (!e) return false; const s = JSON.stringify(e); return /"require"|"node"\s*:\s*"\.\/[^"]*\.c?js"|\.cjs"/.test(s); };
const seen = new Set();
function check(name, from) {
  let dir; try { dir = path.dirname(require.resolve(name + '/package.json', { paths: [from] })); } catch (_) { return; }
  if (seen.has(dir)) return; seen.add(dir);
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (p.type === 'module' && !hasRequireEntry(p)) { bad++; console.log(`FAIL ${name}@${p.version} ist ein reines ES-Modul (bricht require() auf Node < 20.19)`); }
  else console.log(`OK   ${name}@${p.version}`);
}
for (const d of ['web-push', 'pg', 'express', 'jose', 'nodemailer', '@vercel/functions']) if (deps.includes(d)) check(d, root);
// Abhängigkeiten von web-push ebenfalls (die werden mit geladen)
try { const wp = path.dirname(require.resolve('web-push/package.json', { paths: [root] })); for (const d of Object.keys(require(path.join(wp, 'package.json')).dependencies || {})) check(d, wp); } catch (_) {}
console.log(`\n${seen.size - bad}/${seen.size} bestanden`); process.exit(bad ? 1 : 0);
