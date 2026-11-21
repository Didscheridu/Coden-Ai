// Gemeinsame Testumgebung: echtes Postgres (PGlite) mit der echten schema.sql + lokale Firebase-Schlüssel
const Module = require('module'); const path = require('path'); const fs = require('fs'); const http = require('http');
const root = path.join(__dirname, '..');

async function setup({ withApp = true, schema = true } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  if (schema) await db.exec(fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8'));
  const orig = Module._load;
  Module._load = function (req, ...a) {
    if (req === 'pg') return { Pool: class { on() {} query(text, values) { return values && values.length ? db.query(text, values) : (text.includes(';\n') || /;\s*\S/.test(text) ? db.exec(text).then(r => ({ rows: [] })) : db.query(text, values)); } } };
    return orig.call(this, req, ...a);
  };
  const jose = await import('jose');
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const jwksServer = http.createServer((q, r) => { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise(r => jwksServer.listen(0, r));
  const PROJECT = 'coden-4561f';
  Object.assign(process.env, { DATABASE_URL: 'pglite', ADMIN_EMAIL: 'admin@test.de', FIREBASE_PROJECT_ID: PROJECT, FIREBASE_JWKS_URL: `http://127.0.0.1:${jwksServer.address().port}/jwks` });
  const token = (claims = {}) => new jose.SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setSubject(claims.sub)
    .setAudience(PROJECT).setIssuer(`https://securetoken.google.com/${PROJECT}`).setIssuedAt().setExpirationTime('1h').sign(privateKey);
  let srv, base;
  if (withApp) {
    const app = require(path.join(root, 'api/index.js'));
    srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    base = `http://127.0.0.1:${srv.address().port}/api`;
  }
  const call = async (p, body, tok, method) => {
    const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { s: r.status, j: await r.json().catch(() => ({})) };
  };
  const results = []; const chk = (n, got, want) => results.push([n, got, want]);
  const finish = async () => {
    let bad = 0; for (const [n, g, w] of results) { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) bad++; console.log(ok ? 'OK  ' : 'FAIL', n, ok ? '' : `(bekam ${JSON.stringify(g)}, erwartet ${JSON.stringify(w)})`); }
    console.log(`\n${results.length - bad}/${results.length} bestanden`);
    srv?.close(); jwksServer.close(); process.exit(bad ? 1 : 0);
  };
  return { db, token, call, chk, finish, base };
}
module.exports = { setup, root };
