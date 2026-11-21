// Prüft die Eingaben des APK-Builds, macht sie sicher für Gradle und erzeugt die App-Symbole.
// Läuft in GitHub Actions vor dem Build: node android-shell/prepare.js (liest IN_* und schreibt APP_* nach $GITHUB_ENV)
const fs = require('fs'); const path = require('path');
const { iconPng } = require('../server/icon');
const env = process.env;
const fail = (m) => { console.error('::error::' + m); process.exit(1); };

const slug = String(env.IN_SLUG || ''); if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) fail('Ungültige Adresse (slug).');
const pkg = String(env.IN_PKG || ''); if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(pkg)) fail('Ungültiger Paketname.');
const url = String(env.IN_URL || ''); if (!/^https:\/\/[A-Za-z0-9.\-:]+\/[A-Za-z0-9\-._~\/]*$/.test(url)) fail('Ungültige Adresse (URL).');
const color = /^#[0-9a-fA-F]{6}$/.test(env.IN_COLOR || '') ? env.IN_COLOR : '#8ab4f8';
const name = (String(env.IN_NAME || '').normalize('NFC').replace(/[^\p{L}\p{N} .!?\-_+]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 30)) || 'Coden App';
const full = url + (url.includes('?') ? '&' : '?') + 'shell=android';

const res = path.join(__dirname, 'app', 'src', 'main', 'res');
for (const [dir, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  fs.mkdirSync(path.join(res, 'mipmap-' + dir), { recursive: true });
  fs.writeFileSync(path.join(res, 'mipmap-' + dir, 'ic_launcher.png'), iconPng({ size, color, letter: name[0] }));
}
const out = { APP_ID: pkg, APP_NAME: name, APP_URL: full, APP_COLOR: color };
if (env.GITHUB_ENV) fs.appendFileSync(env.GITHUB_ENV, Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
console.log(out);
