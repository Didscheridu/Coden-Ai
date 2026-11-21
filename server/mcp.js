// MCP-Client: Coden verbindet sich (über das Backend) mit MCP-Servern anderer Apps und ruft deren Werkzeuge auf.
// Transport: "Streamable HTTP". Das Backend speichert keine Zugangsdaten – der Browser schickt sie bei jedem Aufruf mit.
// Schutz vor SSRF: nur https, keine privaten/internen Adressen (auch nicht nach DNS-Auflösung), keine Weiterleitungen.
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const express = require('express');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');

const ALLOW_PRIVATE = () => process.env.MCP_ALLOW_PRIVATE === '1'; // nur für Tests
const MAX_BODY = 4 * 1024 * 1024, TIMEOUT = 30_000;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return isPrivateIp(m[1]);
    const h = l.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/); if (h) { const x = parseInt(h[1], 16), y = parseInt(h[2], 16); return isPrivateIp(`${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`); }
    return l === '::' || l === '::1' || l.startsWith('fc') || l.startsWith('fd') || /^fe[89ab]/.test(l) || l.startsWith('ff') || l.startsWith('64:ff9b') || l.startsWith('2001:db8');
  }
  return true;
}

// Prüft die Adresse, mit der sich der Server WIRKLICH verbindet (schützt auch vor DNS-Rebinding)
function guardedLookup(hostname, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!ALLOW_PRIVATE() && addrs.some(a => isPrivateIp(a.address))) return cb(Object.assign(new Error('Diese Adresse ist nicht erlaubt.'), { code: 'EBLOCKED' }));
    if (opts.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

function parseServerUrl(raw) {
  let u; try { u = new URL(String(raw)); } catch (e) { throw httpErr(400, 'Die Adresse ist ungültig.'); }
  if (u.username || u.password) throw httpErr(400, 'Keine Zugangsdaten in der Adresse – nutze das Token-Feld.');
  if (u.protocol !== 'https:' && !(ALLOW_PRIVATE() && u.protocol === 'http:')) throw httpErr(400, 'Nur https-Adressen sind erlaubt.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!ALLOW_PRIVATE()) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !net.isIP(host)) throw httpErr(400, 'Interne Adressen sind nicht erlaubt.');
    if (net.isIP(host) && isPrivateIp(host)) throw httpErr(400, 'Interne Adressen sind nicht erlaubt.');
  }
  return u;
}
const httpErr = (status, message) => Object.assign(new Error(message), { status });

const BAD_HEADERS = new Set(['host', 'content-length', 'content-type', 'accept', 'connection', 'transfer-encoding', 'upgrade', 'cookie', 'mcp-session-id', 'mcp-protocol-version', 'x-forwarded-for', 'x-forwarded-host']);
function cleanHeaders(h) {
  const out = {}; if (!h || typeof h !== 'object' || Array.isArray(h)) return out;
  const entries = Object.entries(h); if (entries.length > 6) throw httpErr(400, 'Höchstens 6 Header.');
  for (const [k, v] of entries) {
    if (!/^[A-Za-z0-9-]{1,40}$/.test(k) || BAD_HEADERS.has(k.toLowerCase())) throw httpErr(400, `Header „${String(k).slice(0, 40)}“ ist nicht erlaubt.`);
    if (typeof v !== 'string' || v.length > 4000 || /[\r\n]/.test(v)) throw httpErr(400, 'Ungültiger Header-Wert.');
    out[k] = v;
  }
  return out;
}

function request(u, { method = 'POST', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method, headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, lookup: guardedLookup, timeout: TIMEOUT }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); return reject(httpErr(502, 'Der Server leitet weiter – das wird aus Sicherheitsgründen nicht verfolgt.')); }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(httpErr(502, 'Die Antwort ist zu groß.')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(httpErr(504, 'Der MCP-Server antwortet nicht (Zeitüberschreitung).')));
    req.on('error', (e) => reject(e.status ? e : e.code === 'EBLOCKED' ? httpErr(400, e.message) : httpErr(502, 'Keine Verbindung zum MCP-Server: ' + (e.code || e.message))));
    if (body) req.write(body); req.end();
  });
}

// Antwort lesen: normales JSON oder Server-Sent-Events. Liefert die JSON-RPC-Nachricht mit der gesuchten id.
function rpcFrom(res, id) {
  const ct = String(res.headers['content-type'] || '');
  const msgs = [];
  if (ct.includes('text/event-stream')) {
    for (const block of res.text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
      if (data) { try { msgs.push(JSON.parse(data)); } catch (e) { /* ignorieren */ } }
    }
  } else { try { const j = JSON.parse(res.text); Array.isArray(j) ? msgs.push(...j) : msgs.push(j); } catch (e) { throw httpErr(502, 'Der Server hat keine gültige MCP-Antwort geschickt.'); } }
  const m = msgs.find(x => x && x.id === id);
  if (!m) throw httpErr(502, 'Keine Antwort auf die Anfrage erhalten.');
  if (m.error) throw httpErr(502, 'MCP-Fehler: ' + String(m.error.message || m.error.code || 'unbekannt').slice(0, 300));
  return m.result;
}

// Führt eine Anfrage nach dem MCP-Ablauf aus: initialize -> initialized -> Anfrage (alles in einem Aufruf, ohne Zustand im Backend)
async function mcpRequest({ url, headers, method, params }) {
  const u = parseServerUrl(url); const extra = cleanHeaders(headers);
  const base = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': 'Coden-MCP/1.0', ...extra };
  const post = (payload, more = {}) => request(u, { headers: { ...base, ...more }, body: JSON.stringify(payload) });
  const fail = (r) => { if (r.status === 401 || r.status === 403) throw httpErr(401, 'Der MCP-Server verlangt eine Anmeldung. Prüfe den Token bzw. die Header.'); if (r.status === 404) throw httpErr(502, 'Unter dieser Adresse gibt es keinen MCP-Server (404).'); if (r.status >= 400) throw httpErr(502, `Der MCP-Server meldet Fehler ${r.status}.`); };
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Coden', version: '1.0.0' } } });
  fail(init);
  const info = rpcFrom(init, 1);
  const more = {}; if (init.headers['mcp-session-id']) more['Mcp-Session-Id'] = String(init.headers['mcp-session-id']); more['MCP-Protocol-Version'] = info?.protocolVersion || '2025-03-26';
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, more).catch(() => {});
  const r = await post({ jsonrpc: '2.0', id: 2, method, params: params || {} }, more);
  fail(r);
  const result = rpcFrom(r, 2);
  if (more['Mcp-Session-Id']) request(u, { method: 'DELETE', headers: { ...base, ...more } }).catch(() => {}); // Sitzung höflich beenden
  return { result, server: info?.serverInfo || null };
}

const trimTool = (t) => ({ name: String(t.name).slice(0, 80), description: String(t.description || '').slice(0, 600), inputSchema: t.inputSchema && JSON.stringify(t.inputSchema).length < 6000 ? t.inputSchema : { type: 'object' } });

function mcpRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);
  const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 502).json({ error: e.message || 'MCP-Fehler.' }); } };
  r.post('/tools', rateLimit('mcp-tools', 30, 60), guard(async (req, res) => {
    const { result, server } = await mcpRequest({ url: req.body?.url, headers: req.body?.headers, method: 'tools/list' });
    res.json({ server, tools: (result?.tools || []).filter(t => t && typeof t.name === 'string').slice(0, 80).map(trimTool) });
  }));
  r.post('/call', rateLimit('mcp-call', 60, 60), guard(async (req, res) => {
    const tool = String(req.body?.tool || ''); if (!/^[\w.\-:/]{1,80}$/.test(tool)) throw httpErr(400, 'Ungültiger Werkzeugname.');
    const args = req.body?.args && typeof req.body.args === 'object' && !Array.isArray(req.body.args) ? req.body.args : {};
    if (JSON.stringify(args).length > 50_000) throw httpErr(400, 'Die Eingaben sind zu groß.');
    const { result } = await mcpRequest({ url: req.body?.url, headers: req.body?.headers, method: 'tools/call', params: { name: tool, arguments: args } });
    // Nur Text und Bilder durchreichen, gekürzt
    const content = (result?.content || []).slice(0, 20).map(c => c.type === 'text' ? { type: 'text', text: String(c.text || '').slice(0, 20_000) } : c.type === 'image' && /^image\/(png|jpeg|gif|webp)$/.test(c.mimeType) && String(c.data || '').length < 3_000_000 ? { type: 'image', mimeType: c.mimeType, data: c.data } : { type: 'text', text: `[${c.type || 'Inhalt'} – nicht darstellbar]` });
    res.json({ isError: !!result?.isError, content, structured: result?.structuredContent && JSON.stringify(result.structuredContent).length < 20_000 ? result.structuredContent : undefined });
  }));
  return r;
}

module.exports = { mcpRouter, mcpRequest, isPrivateIp, parseServerUrl };
