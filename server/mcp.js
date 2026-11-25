// MCP-Client + MCP-OAuth 2.1 Standard (RFC 9728 / RFC 8414 / RFC 7591 / PKCE S256)
// Transport: "Streamable HTTP". Gespeicherte Tokens & OAuth-Zugangsdaten liegen AES-256-GCM verschlüsselt in Firestore.
// Schutz vor SSRF: nur https, keine privaten/internen Adressen (auch nicht nach DNS-Auflösung), keine Weiterleitungen.
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const express = require('express');
const db = require('./db');
const byok = require('./byok');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');
const CATALOG = require('../shared/mcp-catalog');

const ALLOW_PRIVATE = () => process.env.MCP_ALLOW_PRIVATE === '1'; // nur für Tests
const MAX_BODY = 4 * 1024 * 1024, TIMEOUT = 30_000;
const MAX_CONNS = 40;
const STATE_TTL_MS = 10 * 60_000;
const consumedNonces = new Map(); // nonce -> expMs (Replay-Schutz)

function markNonceUsed(nonce, exp) {
  const now = Date.now();
  if (consumedNonces.size > 4000) {
    for (const [k, v] of consumedNonces) {
      if (v <= now) consumedNonces.delete(k);
    }
    if (consumedNonces.size > 4000) consumedNonces.clear();
  }
  consumedNonces.set(nonce, exp);
}

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
    return l === '::' || l.startsWith('::1') && l === '::1' || l.startsWith('fc') || l.startsWith('fd') || /^fe[89ab]/.test(l) || l.startsWith('ff') || l.startsWith('64:ff9b') || l.startsWith('2001:db8');
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

const httpErr = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

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

function request(u, { method = 'POST', headers = {}, body, redirects = false, maxBody = MAX_BODY, timeout = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method, headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, lookup: guardedLookup, timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); if (redirects) return resolve({ status: res.statusCode, headers: res.headers, text: '' }); return reject(httpErr(502, 'Der Server leitet weiter – das wird aus Sicherheitsgründen nicht verfolgt.')); }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > maxBody) { req.destroy(httpErr(502, 'Die Antwort ist zu groß.')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(httpErr(504, 'Der MCP-Server antwortet nicht (Zeitüberschreitung).')));
    req.on('error', (e) => reject(e.status ? e : e.code === 'EBLOCKED' ? httpErr(400, e.message) : httpErr(502, 'Keine Verbindung zum MCP-Server: ' + (e.code || e.message))));
    if (body) req.write(body); req.end();
  });
}

async function requestJson(urlStr, opts = {}) {
  const u = typeof urlStr === 'string' ? parseServerUrl(urlStr) : urlStr;
  const r = await request(u, opts);
  let json = null;
  try { json = r.text ? JSON.parse(r.text) : null; } catch (_) { json = null; }
  return { status: r.status, headers: r.headers, text: r.text, json };
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

// Führt eine Anfrage nach dem MCP-Ablauf aus: initialize -> initialized -> Anfrage
async function mcpRequest({ url, headers, method, params }) {
  const u = parseServerUrl(url); const extra = cleanHeaders(headers);
  const base = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': 'Coden-MCP/1.0', ...extra };
  const post = (payload, more = {}) => request(u, { headers: { ...base, ...more }, body: JSON.stringify(payload) });
  const fail = (r) => {
    if (r.status === 401 || r.status === 403) {
      throw httpErr(401, 'Der MCP-Server verlangt eine Anmeldung. Prüfe den Token bzw. die Header.', { wwwAuth: r.headers['www-authenticate'] || '' });
    }
    if (r.status === 404) throw httpErr(502, 'Unter dieser Adresse gibt es keinen MCP-Server (404).');
    if (r.status >= 400) throw httpErr(502, `Der MCP-Server meldet Fehler ${r.status}.`);
  };
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Coden', version: '1.0.0' } } });
  fail(init);
  const info = rpcFrom(init, 1);
  const more = {}; if (init.headers['mcp-session-id']) more['Mcp-Session-Id'] = String(init.headers['mcp-session-id']); more['MCP-Protocol-Version'] = info?.protocolVersion || '2025-03-26';
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, more).catch(() => {});
  const r = await post({ jsonrpc: '2.0', id: 2, method, params: params || {} }, more);
  fail(r);
  const result = rpcFrom(r, 2);
  if (more['Mcp-Session-Id']) request(u, { method: 'DELETE', headers: { ...base, ...more } }).catch(() => {});
  return { result, server: info?.serverInfo || null };
}

const trimTool = (t) => ({ name: String(t.name).slice(0, 80), description: String(t.description || '').slice(0, 400), inputSchema: t.inputSchema && JSON.stringify(t.inputSchema).length < 3200 ? t.inputSchema : { type: 'object' } });

// ---------- OAuth 2.1 + PKCE Discovery & DCR ----------
function parseWwwAuth(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  const re = /([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/g;
  let m;
  while ((m = re.exec(header))) {
    out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

async function fetchMetadataCandidate(urlStr) {
  try {
    const r = await requestJson(urlStr, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'Coden-MCP/1.0' },
      timeout: 10_000
    });
    if (r.status >= 200 && r.status < 300 && r.json && typeof r.json === 'object') return r.json;
  } catch (_) { /* nächster Kandidat */ }
  return null;
}

async function discoverOAuth(serverUrl, { authEndpoint: manualAuth, tokenEndpoint: manualToken } = {}) {
  const u = parseServerUrl(serverUrl);
  let wwwAuth = {};
  try {
    const probe = await request(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': 'Coden-MCP/1.0' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Coden', version: '1.0.0' } } }),
      timeout: 10_000
    });
    if (probe.headers['www-authenticate']) wwwAuth = parseWwwAuth(String(probe.headers['www-authenticate']));
  } catch (_) { /* Fallback über well-known */ }

  let prMeta = null;
  const prCandidates = [];
  if (wwwAuth.resource_metadata) prCandidates.push(wwwAuth.resource_metadata);
  const pathSuffix = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '';
  if (pathSuffix) prCandidates.push(`${u.origin}/.well-known/oauth-protected-resource${pathSuffix}`);
  prCandidates.push(`${u.origin}/.well-known/oauth-protected-resource`);

  for (const cand of [...new Set(prCandidates)]) {
    prMeta = await fetchMetadataCandidate(cand);
    if (prMeta && (Array.isArray(prMeta.authorization_servers) || prMeta.authorization_server)) break;
  }

  const issuerRaw = (Array.isArray(prMeta?.authorization_servers) && prMeta.authorization_servers[0])
    || prMeta?.authorization_server
    || u.origin;

  let asMeta = null;
  if (!(manualAuth && manualToken)) {
    let issUrl;
    try { issUrl = parseServerUrl(issuerRaw); } catch (_) { issUrl = u; }
    const issPath = issUrl.pathname && issUrl.pathname !== '/' ? issUrl.pathname.replace(/\/+$/, '') : '';
    const asCandidates = [];
    if (issPath) {
      asCandidates.push(`${issUrl.origin}/.well-known/oauth-authorization-server${issPath}`);
      asCandidates.push(`${issUrl.origin}/.well-known/openid-configuration${issPath}`);
      asCandidates.push(`${issUrl.origin}${issPath}/.well-known/openid-configuration`);
    }
    asCandidates.push(`${issUrl.origin}/.well-known/oauth-authorization-server`);
    asCandidates.push(`${issUrl.origin}/.well-known/openid-configuration`);

    for (const cand of [...new Set(asCandidates)]) {
      asMeta = await fetchMetadataCandidate(cand);
      if (asMeta && asMeta.authorization_endpoint && asMeta.token_endpoint) break;
    }
  }

  const authorizationEndpoint = manualAuth || asMeta?.authorization_endpoint || '';
  const tokenEndpoint = manualToken || asMeta?.token_endpoint || '';
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw httpErr(400, 'Dieser MCP-Server bietet keine automatische OAuth-Erkennung (.well-known). Nutze ein Zugriffstoken oder trage Authorization- & Token-URL ein.', { code: 'NO_OAUTH_DISCOVERY' });
  }
  parseServerUrl(authorizationEndpoint);
  parseServerUrl(tokenEndpoint);

  const scopesArr = (wwwAuth.scope ? [wwwAuth.scope] : [])
    .concat(Array.isArray(prMeta?.scopes_supported) ? prMeta.scopes_supported : [])
    .filter(Boolean);

  return {
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: asMeta?.registration_endpoint || null,
    cimd: asMeta?.client_id_metadata_document_supported === true,
    resource: prMeta?.resource || (prMeta ? u.toString() : ''),
    defaultScope: [...new Set(scopesArr.join(' ').split(/\s+/).filter(Boolean))].slice(0, 16).join(' '),
    codeChallengeMethods: Array.isArray(asMeta?.code_challenge_methods_supported) ? asMeta.code_challenge_methods_supported : ['S256']
  };
}

async function registerDynamicClient(registrationEndpoint, redirectUri, clientUri) {
  const regUrl = parseServerUrl(registrationEndpoint);
  const attempts = ['none', 'client_secret_post'];
  let lastErr = null;
  let redirectBlocked = false;
  for (const method of attempts) {
    const r = await requestJson(regUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Coden-MCP/1.0' },
      body: JSON.stringify({
        client_name: 'Coden AI',
        ...(clientUri ? { client_uri: clientUri } : {}),
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: method
      }),
      timeout: 12_000
    });
    if (r.status >= 200 && r.status < 300 && r.json?.client_id) {
      return {
        clientId: String(r.json.client_id),
        clientSecret: r.json.client_secret ? String(r.json.client_secret) : '',
        tokenAuthMethod: r.json.token_endpoint_auth_method || (r.json.client_secret ? 'client_secret_post' : 'none'),
        dcr: true
      };
    }
    const errCode = String(r.json?.error || '');
    const errDesc = String(r.json?.error_description || '');
    const rawSnippet = !errCode && !errDesc && r.text ? String(r.text).replace(/<[^>]+>/g, ' ').trim().slice(0, 140) : '';
    lastErr = errDesc || errCode || rawSnippet || `HTTP ${r.status}`;
    if (r.status === 403 || errCode === 'invalid_redirect_uri' || /redirect/i.test(lastErr)) {
      redirectBlocked = true;
    }
  }
  if (redirectBlocked) {
    throw httpErr(400, `Dieser Dienst akzeptiert die Web-Callback-Adresse nicht automatisch (${String(lastErr).slice(0, 120)}). Nutze eine eigene OAuth Client-ID oder ein persönliches Zugriffstoken.`, { code: 'REDIRECT_NOT_ALLOWED' });
  }
  throw httpErr(502, `Automatische App-Registrierung (DCR) fehlgeschlagen: ${String(lastErr).slice(0, 180)}`, { code: 'DCR_FAILED' });
}

async function tokenRequest(tokenEndpoint, paramsObj, { clientId, clientSecret, tokenAuthMethod } = {}) {
  const u = parseServerUrl(tokenEndpoint);
  const bodyParams = new URLSearchParams();
  for (const [k, v] of Object.entries(paramsObj)) {
    if (v !== undefined && v !== null && v !== '') bodyParams.set(k, String(v));
  }
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'User-Agent': 'Coden-MCP/1.0'
  };
  if (clientSecret) {
    if (tokenAuthMethod === 'client_secret_basic') {
      headers.Authorization = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    } else {
      bodyParams.set('client_id', clientId);
      bodyParams.set('client_secret', clientSecret);
    }
  } else if (clientId) {
    bodyParams.set('client_id', clientId);
  }

  const r = await requestJson(u, { method: 'POST', headers, body: bodyParams.toString(), timeout: 15_000 });
  if (r.status >= 400 || !r.json?.access_token) {
    const desc = r.json?.error_description || r.json?.error || `HTTP ${r.status}`;
    const errCode = r.json?.error === 'invalid_grant' ? 'INVALID_GRANT' : 'TOKEN_ERROR';
    throw httpErr(r.status === 401 || errCode === 'INVALID_GRANT' ? 401 : 502, `OAuth-Token-Fehler: ${String(desc).slice(0, 220)}`, { code: errCode });
  }
  return r.json;
}

function validRedirectUri(raw, req) {
  if (!raw || typeof raw !== 'string') return null;
  let u;
  try { u = new URL(raw); } catch (_) { return null; }
  const cleanPath = u.pathname.replace(/\/+$/, '');
  if (cleanPath !== '/api/mcp/oauth/callback') return null;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const selfOrigin = `${proto}://${host}`.replace(/\/$/, '').toLowerCase();
  const allowed = new Set([selfOrigin]);
  for (const envUrl of [process.env.PUBLIC_APP_BASE, process.env.APP_URL]) {
    if (envUrl) {
      try { allowed.add(new URL(envUrl).origin.toLowerCase()); } catch (_) { /* ignorieren */ }
    }
  }
  const reqOrigin = u.origin.toLowerCase();
  if (allowed.has(reqOrigin)) return `${u.origin}${cleanPath}`;
  if (ALLOW_PRIVATE() && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return `${u.origin}${cleanPath}`;
  return null;
}

// ---------- GitHub Repository-Einschränkung (MCP) ----------
const REPO_FULL_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const isGithubConn = (doc) => doc?.catalog_id === 'github' || /^https:\/\/api\.github(?:copilot)?\.com(?:\/|$)/i.test(String(doc?.url || ''));

function normalizeAllowedRepos(raw) {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) throw httpErr(400, 'allowedRepos muss eine Liste oder null sein.');
  if (raw.length > 100) throw httpErr(400, 'Höchstens 100 Repositories erlaubt.');
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const clean = String(item || '').trim().toLowerCase();
    if (!clean) continue;
    if (!REPO_FULL_RE.test(clean) || clean.includes('..')) {
      throw httpErr(400, `Ungültiger Repository-Name: „${String(item).slice(0, 80)}“ (erwartet owner/repo).`);
    }
    if (!seen.has(clean)) { seen.add(clean); out.push(clean); }
  }
  return out;
}

function applyGithubScope(doc, params) {
  if (!isGithubConn(doc) || !Array.isArray(doc.allowed_repos)) return params;
  const allowed = new Set(doc.allowed_repos.map(x => String(x).toLowerCase()));
  const toolName = String(params?.name || '');
  const args = params?.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
    ? { ...params.arguments }
    : {};

  if (/^(create|fork|delete)_repo/i.test(toolName) || toolName === 'create_repository') {
    throw httpErr(403, 'Zugriff blockiert: Bei eingeschränktem Repository-Zugriff dürfen keine Repositories erstellt oder gelöscht werden.', { code: 'REPO_RESTRICTED' });
  }

  const targets = [];
  if (typeof args.owner === 'string' && args.owner.trim() && typeof args.repo === 'string' && args.repo.trim()) {
    targets.push(`${args.owner.trim()}/${args.repo.trim()}`);
  }
  for (const k of ['repository', 'full_name', 'repo_name', 'repository_full_name']) {
    if (typeof args[k] === 'string' && args[k].includes('/')) {
      targets.push(args[k].trim().replace(/\.git$/i, ''));
    }
  }
  let hasRepoQualifier = false;
  for (const qk of ['q', 'query']) {
    if (typeof args[qk] === 'string') {
      const re = /\brepo:([^\s]+)/gi;
      let m;
      while ((m = re.exec(args[qk]))) {
        hasRepoQualifier = true;
        targets.push(m[1].trim());
      }
    }
  }

  for (const t of targets) {
    if (!allowed.has(t.toLowerCase())) {
      throw httpErr(403, `Zugriff blockiert: Repository „${t}“ ist in dieser GitHub-Verbindung nicht freigegeben.`, { code: 'REPO_RESTRICTED' });
    }
  }

  const isRepoSearchTool = /^search_(code|issues|pull_requests|commits)$/i.test(toolName)
    || (/search/i.test(toolName) && !/user|repo/i.test(toolName) && (typeof args.query === 'string' || typeof args.q === 'string'));
  if (isRepoSearchTool && !hasRepoQualifier && !targets.length) {
    if (!allowed.size) {
      throw httpErr(403, 'Zugriff blockiert: In dieser GitHub-Verbindung sind keine Repositories freigegeben.', { code: 'REPO_RESTRICTED' });
    }
    if (allowed.size > 15) {
      throw httpErr(403, 'Zugriff blockiert: Bitte gib eines der freigegebenen Repositories (repo:owner/name) in der Suche an.', { code: 'REPO_RESTRICTED' });
    }
    const qualifiers = [...allowed].map(r => `repo:${r}`).join(' ');
    if (typeof args.query === 'string') args.query = `${args.query} ${qualifiers}`.trim();
    else if (typeof args.q === 'string') args.q = `${args.q} ${qualifiers}`.trim();
  }

  return { ...params, arguments: args };
}

function filterGithubResult(doc, toolName, result) {
  if (!isGithubConn(doc) || !Array.isArray(doc.allowed_repos) || !result) return result;
  if (!/^(search_repositories|list_repositories|get_repositories|list_user_repos)$/i.test(String(toolName || ''))) return result;
  const allowed = new Set(doc.allowed_repos.map(x => String(x).toLowerCase()));
  const pickName = (x) => String(x?.full_name || x?.nameWithOwner || x?.fullName || '').toLowerCase();
  const filterArr = (arr) => arr.filter(x => x && allowed.has(pickName(x)));
  const out = { ...result };
  if (Array.isArray(result.content)) {
    out.content = result.content.map(c => {
      if (c?.type !== 'text' || typeof c.text !== 'string') return c;
      try {
        const parsed = JSON.parse(c.text);
        if (Array.isArray(parsed)) return { ...c, text: JSON.stringify(filterArr(parsed)) };
        if (parsed && Array.isArray(parsed.items)) {
          const items = filterArr(parsed.items);
          return { ...c, text: JSON.stringify({ ...parsed, total_count: items.length, items }) };
        }
        if (parsed && Array.isArray(parsed.repositories)) {
          return { ...c, text: JSON.stringify({ ...parsed, repositories: filterArr(parsed.repositories) }) };
        }
      } catch (_) {}
      return c;
    });
  }
  return out;
}

// ---------- Verschlüsselte Speicherung in Firestore (mcp_connections) ----------
function sanitizeConn(doc) {
  if (!doc) return null;
  return {
    id: String(doc.id || doc._id),
    name: doc.name || '',
    url: doc.url || '',
    catalogId: doc.catalog_id || null,
    authType: doc.auth_type || 'none',
    enabled: doc.enabled !== false,
    headerName: doc.header_name || 'Authorization',
    hasToken: Boolean(doc.token_enc || doc.oauth_enc),
    tokenExpiresAt: doc.token_expires_at || null,
    scopes: doc.scopes || '',
    serverName: doc.server_name || '',
    tools: Array.isArray(doc.tools) ? doc.tools : [],
    allowedRepos: Array.isArray(doc.allowed_repos) ? doc.allowed_repos : null,
    status: doc.status || 'connected',
    lastError: doc.last_error || null,
    createdAt: doc.created_at || null,
    updatedAt: doc.updated_at || null
  };
}

async function resolveConnectionHeaders(doc) {
  if (doc.auth_type === 'key' && doc.token_enc) {
    const tok = await byok.decrypt(doc.token_enc);
    const hdr = doc.header_name || 'Authorization';
    return {
      headers: { [hdr]: hdr === 'Authorization' && !/^bearer\s/i.test(tok) ? 'Bearer ' + tok : tok },
      oauth: null
    };
  }
  if (doc.auth_type === 'oauth' && doc.oauth_enc) {
    const oauth = JSON.parse(await byok.decrypt(doc.oauth_enc));
    const expMs = doc.token_expires_at ? Date.parse(doc.token_expires_at) : 0;
    if (oauth.refreshToken && expMs && expMs - Date.now() < 60_000) {
      await refreshAndSave(doc, oauth);
    }
    return {
      headers: { Authorization: `${oauth.tokenType || 'Bearer'} ${oauth.accessToken}` },
      oauth
    };
  }
  return { headers: {}, oauth: null };
}

async function refreshAndSave(doc, oauth) {
  if (!oauth?.refreshToken || !oauth?.tokenEndpoint) {
    throw httpErr(401, 'Anmeldung abgelaufen – bitte erneut verbinden.', { code: 'NEEDS_REAUTH' });
  }
  try {
    const tok = await tokenRequest(oauth.tokenEndpoint, {
      grant_type: 'refresh_token',
      refresh_token: oauth.refreshToken,
      ...(oauth.resource ? { resource: oauth.resource } : {})
    }, { clientId: oauth.clientId, clientSecret: oauth.clientSecret, tokenAuthMethod: oauth.tokenAuthMethod });

    oauth.accessToken = tok.access_token;
    if (tok.refresh_token) oauth.refreshToken = tok.refresh_token;
    if (tok.token_type) oauth.tokenType = tok.token_type;
    if (tok.scope) oauth.scope = tok.scope;

    const expSec = Number(tok.expires_in);
    const nextExp = Number.isFinite(expSec) && expSec > 0 ? new Date(Date.now() + expSec * 1000).toISOString() : null;
    const oauth_enc = await byok.encrypt(JSON.stringify(oauth));
    const now = db.nowIso();
    await db.updateDoc(`mcp_connections/${doc.id}`, {
      oauth_enc,
      token_expires_at: nextExp,
      scopes: String(oauth.scope || doc.scopes || '').slice(0, 500),
      status: 'connected',
      last_error: null,
      updated_at: now
    });
    doc.oauth_enc = oauth_enc;
    doc.token_expires_at = nextExp;
    return oauth;
  } catch (e) {
    await db.updateDoc(`mcp_connections/${doc.id}`, {
      status: 'needs_reauth',
      last_error: 'Anmeldung abgelaufen – bitte erneut verbinden.',
      updated_at: db.nowIso()
    }).catch(() => {});
    throw httpErr(401, 'Anmeldung abgelaufen – bitte erneut mit dieser App anmelden.', { code: 'NEEDS_REAUTH' });
  }
}

async function runConnectionRequest(uid, connId, { method, params }) {
  const id = parseInt(connId, 10);
  if (!Number.isInteger(id) || id <= 0) throw httpErr(400, 'Ungültige Verbindungs-ID.');
  const doc = await db.getDoc(`mcp_connections/${id}`);
  if (!doc || doc.uid !== uid) throw httpErr(404, 'Verbindung nicht gefunden.');

  const effectiveParams = method === 'tools/call' ? applyGithubScope(doc, params) : params;
  const finish = (res) => method === 'tools/call'
    ? { ...res, result: filterGithubResult(doc, effectiveParams?.name, res.result) }
    : res;

  let { headers, oauth } = await resolveConnectionHeaders(doc);
  try {
    return { doc, ...finish(await mcpRequest({ url: doc.url, headers, method, params: effectiveParams })) };
  } catch (e) {
    if (e.status === 401 && doc.auth_type === 'oauth') {
      if (oauth?.refreshToken) {
        const renewed = await refreshAndSave(doc, oauth);
        headers = { Authorization: `${renewed.tokenType || 'Bearer'} ${renewed.accessToken}` };
        return { doc, ...finish(await mcpRequest({ url: doc.url, headers, method, params: effectiveParams })) };
      }
      await db.updateDoc(`mcp_connections/${doc.id}`, {
        status: 'needs_reauth',
        last_error: 'Anmeldung abgelaufen – bitte erneut verbinden.',
        updated_at: db.nowIso()
      }).catch(() => {});
      throw httpErr(401, 'Anmeldung abgelaufen – bitte erneut mit dieser App anmelden.', { code: 'NEEDS_REAUTH' });
    }
    throw e;
  }
}

async function allocConnDoc(buildDoc) {
  for (let i = 0; i < 8; i++) {
    const id = 10_000_000 + crypto.randomInt(0, 900_000_000);
    const doc = buildDoc(id);
    try {
      return await db.createDoc(`mcp_connections/${id}`, doc);
    } catch (e) {
      if (e.code === 'ALREADY_EXISTS') continue;
      throw e;
    }
  }
  throw httpErr(500, 'Konnte keine ID vergeben.');
}

// ---------- OAuth Callback HTML (unauthentifiziert, läuft im Popup auf demselben Origin) ----------
function safeJsJson(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function mcpOAuthCallbackHandler(req, res) {
  const payload = {
    type: 'CODEN_MCP_OAUTH_CALLBACK',
    code: typeof req.query.code === 'string' ? req.query.code : '',
    state: typeof req.query.state === 'string' ? req.query.state : '',
    error: typeof req.query.error === 'string' ? req.query.error : '',
    errorDescription: typeof req.query.error_description === 'string' ? req.query.error_description : ''
  };
  const ok = Boolean(payload.code && payload.state && !payload.error);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coden AI – Anmeldung</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #131314; color: #e3e3e3; font-family: system-ui, -apple-system, sans-serif; padding: 20px; }
  .box { max-width: 420px; width: 100%; background: #1e1f20; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; padding: 24px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
  p { margin: 0 0 16px; font-size: 14px; color: #b4b7bc; line-height: 1.5; }
  button { border: 0; border-radius: 999px; background: #a8c7fa; color: #0b192e; padding: 9px 18px; font: 600 13.5px inherit; cursor: pointer; }
</style>
</head>
<body>
<div class="box">
  <h1 id="t">${ok ? 'Anmeldung erfolgreich' : 'Anmeldung fehlgeschlagen'}</h1>
  <p id="m">${ok ? 'Die Verbindung wird jetzt in Coden abgeschlossen. Dieses Fenster schließt sich gleich.' : 'Es wurden keine gültigen Anmeldedaten übergeben.'}</p>
  <button type="button" onclick="window.close()">Fenster schließen</button>
</div>
<script>
(function () {
  var data = ${safeJsJson(payload)};
  if (data.error) {
    document.getElementById('m').textContent = data.errorDescription || data.error;
  }
  var sent = false;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      var ch = new BroadcastChannel('coden_mcp_oauth');
      ch.postMessage(data);
      setTimeout(function () { try { ch.close(); } catch (e) {} }, 250);
      sent = true;
    }
  } catch (e) {}
  try {
    localStorage.setItem('coden_mcp_oauth_bc', JSON.stringify({ data: data, ts: Date.now() }));
    setTimeout(function () { try { localStorage.removeItem('coden_mcp_oauth_bc'); } catch (e) {} }, 1500);
    sent = true;
  } catch (e) {}
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(data, window.location.origin);
      sent = true;
    }
  } catch (e) {}
  try {
    sessionStorage.setItem('coden_mcp_oauth_pending', JSON.stringify(data));
  } catch (e) {}
  if (sent) {
    setTimeout(function () { try { window.close(); } catch (e) {} }, 450);
  }
})();
</script>
</body>
</html>`);
}

// ---------- Ein-Klick-Anmeldung: Coden-Apps und Client-ID-Dokument ----------
// Coden-App: vom Owner einmal bei einem Dienst registriert (MCP_OAUTH_<ID>=clientId:clientSecret). Nur für die Adresse aus dem Katalog,
// damit niemand das Client-Secret an einen fremden Server schicken lässt.
function codenApp(catalogId, url) {
  const item = catalogId ? CATALOG.byId(String(catalogId)) : null;
  if (!item || !CATALOG.sameServer(item, url)) return null;
  const raw = String(process.env[CATALOG.envName(item.id)] || '').trim();
  if (!raw) return null;
  const i = raw.indexOf(':');
  const clientId = (i < 0 ? raw : raw.slice(0, i)).trim();
  const clientSecret = i < 0 ? '' : raw.slice(i + 1).trim();
  if (!clientId) return null;
  return { clientId, clientSecret, tokenAuthMethod: clientSecret ? 'client_secret_post' : 'none', dcr: false, app: true, scope: item.scope || '' };
}
const configuredApps = () => CATALOG.LIBRARY.filter(x => String(process.env[CATALOG.envName(x.id)] || '').trim()).map(x => x.id);

// Client-ID-Dokument (MCP-Standard „Client ID Metadata Document“): Die Client-ID ist eine https-Adresse von Coden,
// der Anmeldeserver liest dort Name und Callback-Adresse. Keine Registrierung nötig.
const cimdUrl = (redirectUri) => new URL(redirectUri).origin + '/api/mcp/oauth/client.json';
const cimdAllowed = (redirectUri) => { try { const u = new URL(redirectUri); return u.protocol === 'https:' || ALLOW_PRIVATE(); } catch (_) { return false; } };
function clientMetadataHandler(req, res) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const origin = `${proto}://${host}`;
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    client_id: `${origin}/api/mcp/oauth/client.json`,
    client_name: 'Coden AI',
    client_uri: origin,
    logo_uri: `${origin}/images/coden_logo.jpg`,
    redirect_uris: [`${origin}/api/mcp/oauth/callback`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none'
  });
}

function mcpRouter(requireAuth) {
  const r = wrapRouter(express.Router());

  // Unauthentifizierte Callback-Endpunkte (Browser-Redirect vom OAuth-Anbieter)
  r.get('/oauth/callback', mcpOAuthCallbackHandler);
  r.get('/oauth/callback/', mcpOAuthCallbackHandler);
  r.get('/oauth/client.json', clientMetadataHandler);

  r.use(requireAuth);
  const guard = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { res.status(e.status || 502).json({ error: e.message || 'MCP-Fehler.', ...(e.code ? { code: e.code } : {}) }); }
  };

  // Liste aller gespeicherten Verbindungen (ohne Geheimnisse/Tokens)
  r.get('/connections', guard(async (req, res) => {
    const rows = await db.runQuery('mcp_connections', { where: [['uid', '==', req.user.uid]] });
    rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    res.json({ connections: rows.map(sanitizeConn) });
  }));

  // Token- oder Ohne-Anmeldung-Verbindung speichern & Werkzeuge laden
  r.post('/connections', rateLimit('mcp-save', 30, 60), guard(async (req, res) => {
    const b = req.body || {};
    const u = parseServerUrl(b.url);
    const name = String(b.name || u.hostname).trim().slice(0, 40);
    if (!name) throw httpErr(400, 'Bitte gib einen Namen ein.');
    const authType = ['key', 'none'].includes(b.authType) ? b.authType : (b.token ? 'key' : 'none');
    const headerName = String(b.headerName || 'Authorization').trim().slice(0, 40) || 'Authorization';
    const tokenVal = typeof b.token === 'string' ? b.token.trim() : '';
    const hdrs = {};
    if (authType === 'key' && tokenVal) {
      hdrs[headerName] = headerName === 'Authorization' && !/^bearer\s/i.test(tokenVal) ? 'Bearer ' + tokenVal : tokenVal;
    }
    cleanHeaders(hdrs);

    const existing = await db.runQuery('mcp_connections', { where: [['uid', '==', req.user.uid]] });
    if (existing.length >= MAX_CONNS) throw httpErr(400, `Höchstens ${MAX_CONNS} Verbindungen möglich.`);
    if (existing.some(x => x.name.toLowerCase() === name.toLowerCase())) throw httpErr(409, 'Diesen Verbindungsnamen gibt es schon.');

    const { result, server } = await mcpRequest({ url: u.toString(), headers: hdrs, method: 'tools/list' });
    const tools = (result?.tools || []).filter(t => t && typeof t.name === 'string').slice(0, 80).map(trimTool);
    const token_enc = tokenVal ? await byok.encrypt(tokenVal) : null;
    const now = db.nowIso();

    const doc = await allocConnDoc((id) => ({
      id,
      uid: req.user.uid,
      name,
      url: u.toString().slice(0, 500),
      catalog_id: b.catalogId ? String(b.catalogId).slice(0, 64) : null,
      auth_type: authType,
      enabled: true,
      header_name: headerName,
      token_enc,
      oauth_enc: null,
      token_expires_at: null,
      scopes: '',
      server_name: String(server?.name || '').slice(0, 120),
      tools,
      status: 'connected',
      last_error: null,
      created_at: now,
      updated_at: now
    }));
    res.json({ connection: sanitizeConn(doc), server, tools });
  }));

  r.patch('/connections/:id', guard(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw httpErr(400, 'Ungültige ID.');
    const doc = await db.getDoc(`mcp_connections/${id}`);
    if (!doc || doc.uid !== req.user.uid) throw httpErr(404, 'Verbindung nicht gefunden.');
    const patch = { updated_at: db.nowIso() };
    if (typeof req.body?.enabled === 'boolean') patch.enabled = req.body.enabled;
    if (typeof req.body?.name === 'string' && req.body.name.trim()) patch.name = req.body.name.trim().slice(0, 40);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'allowedRepos')) {
      if (!isGithubConn(doc)) throw httpErr(400, 'Repository-Einschränkung wird nur für GitHub-Verbindungen unterstützt.');
      patch.allowed_repos = normalizeAllowedRepos(req.body.allowedRepos);
    }
    const next = await db.updateDoc(`mcp_connections/${id}`, patch);
    res.json({ connection: sanitizeConn(next) });
  }));

  r.get('/connections/:id/github-repos', rateLimit('mcp-gh-repos', 30, 60), guard(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw httpErr(400, 'Ungültige ID.');
    const doc = await db.getDoc(`mcp_connections/${id}`);
    if (!doc || doc.uid !== req.user.uid) throw httpErr(404, 'Verbindung nicht gefunden.');
    if (!isGithubConn(doc)) throw httpErr(400, 'Diese Verbindung ist keine GitHub-Verbindung.');

    const { headers } = await resolveConnectionHeaders(doc);
    const authHdr = headers.Authorization || Object.values(headers)[0] || '';
    if (!authHdr) throw httpErr(401, 'Keine GitHub-Anmeldedaten hinterlegt.', { code: 'NEEDS_REAUTH' });

    const ghBase = (ALLOW_PRIVATE() && process.env.MCP_GITHUB_API_BASE) || 'https://api.github.com';
    const r = await requestJson(`${ghBase}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator`, {
      method: 'GET',
      headers: {
        Authorization: authHdr,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Coden-MCP/1.0'
      },
      timeout: 12_000
    });
    if (r.status === 401 || r.status === 403) {
      throw httpErr(403, 'GitHub erlaubt mit diesem Token kein Auflisten deiner Repositories. Du kannst Repositories aber direkt als owner/repo eintragen.', { code: 'GITHUB_LIST_FORBIDDEN' });
    }
    if (r.status >= 400 || !Array.isArray(r.json)) {
      throw httpErr(502, `GitHub-Repositories konnten nicht geladen werden (HTTP ${r.status}).`);
    }
    res.json({
      repos: r.json
        .map(x => ({
          fullName: String(x?.full_name || ''),
          private: Boolean(x?.private),
          description: String(x?.description || '').slice(0, 140)
        }))
        .filter(x => x.fullName)
    });
  }));

  r.delete('/connections/:id', guard(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw httpErr(400, 'Ungültige ID.');
    const doc = await db.getDoc(`mcp_connections/${id}`);
    if (doc && doc.uid === req.user.uid) {
      await db.deleteDoc(`mcp_connections/${id}`);
    }
    res.json({ ok: true });
  }));

  // Welche Dienste haben eine Coden-App (Ein-Klick auch ohne automatische Registrierung)?
  r.get('/catalog-status', guard(async (req, res) => {
    res.json({ apps: configuredApps(), ...(req.user.isOwner ? { envNames: Object.fromEntries(CATALOG.LIBRARY.filter(x => x.app).map(x => [x.id, CATALOG.envName(x.id)])) } : {}) });
  }));

  // ---------- OAuth 2.1 + PKCE Start ----------
  r.post('/oauth/start', rateLimit('mcp-oauth', 20, 60), guard(async (req, res) => {
    const b = req.body || {};
    const u = parseServerUrl(b.url);
    const redirectUri = validRedirectUri(b.redirectUri, req);
    if (!redirectUri) throw httpErr(400, 'Ungültige Callback-Adresse.');
    const name = String(b.name || u.hostname).trim().slice(0, 40);
    if (!name) throw httpErr(400, 'Bitte gib einen Namen ein.');

    const existing = await db.runQuery('mcp_connections', { where: [['uid', '==', req.user.uid]] });
    const connId = b.connectionId ? parseInt(b.connectionId, 10) : null;
    if (!connId && existing.length >= MAX_CONNS) throw httpErr(400, `Höchstens ${MAX_CONNS} Verbindungen möglich.`);
    if (!connId && existing.some(x => x.name.toLowerCase() === name.toLowerCase())) throw httpErr(409, 'Diesen Verbindungsnamen gibt es schon.');
    if (connId) {
      const target = existing.find(x => Number(x.id) === connId);
      if (!target) throw httpErr(404, 'Verbindung nicht gefunden.');
    }

    const disc = await discoverOAuth(u.toString(), {
      authEndpoint: typeof b.authEndpoint === 'string' && b.authEndpoint.trim() ? b.authEndpoint.trim() : undefined,
      tokenEndpoint: typeof b.tokenEndpoint === 'string' && b.tokenEndpoint.trim() ? b.tokenEndpoint.trim() : undefined
    });

    const userClientId = typeof b.clientId === 'string' ? b.clientId.trim() : '';
    const userClientSecret = typeof b.clientSecret === 'string' ? b.clientSecret.trim() : '';
    const catalogId = b.catalogId ? String(b.catalogId).slice(0, 64) : null;
    const app = userClientId ? null : codenApp(catalogId, u.toString());
    const scope = (typeof b.scope === 'string' && b.scope.trim() ? b.scope.trim() : app?.scope || disc.defaultScope || '').slice(0, 500);
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const buildAuthUrl = async (client) => {
      const statePayload = {
        v: 1,
        uid: req.user.uid,
        nonce: crypto.randomBytes(16).toString('hex'),
        exp: Date.now() + STATE_TTL_MS,
        codeVerifier,
        tokenEndpoint: disc.tokenEndpoint,
        authEndpoint: disc.authorizationEndpoint,
        clientId: client.clientId,
        clientSecret: client.clientSecret || '',
        tokenAuthMethod: client.tokenAuthMethod || 'none',
        redirectUri,
        scope,
        serverUrl: u.toString().slice(0, 500),
        resource: disc.resource || '',
        name,
        catalogId,
        connectionId: connId || null
      };
      const state = await byok.encrypt(JSON.stringify(statePayload));
      const authUrl = new URL(disc.authorizationEndpoint);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', client.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', state);
      if (scope) authUrl.searchParams.set('scope', scope);
      if (disc.resource) authUrl.searchParams.set('resource', disc.resource);
      return authUrl;
    };
    // Vorab-Check (fängt Anbieter ab, die zwar registrieren, /authorize aber mit „Invalid redirect URI“ ablehnen)
    const precheck = async (authUrl) => {
      try {
        const pre = await request(parseServerUrl(authUrl.toString()), {
          method: 'GET',
          headers: { Accept: 'text/html,application/json', 'User-Agent': 'Coden-MCP/1.0' },
          redirects: true,
          maxBody: 16384,
          timeout: 4500
        });
        if (pre.status === 400 || pre.status === 403) {
          const msg = String(pre.text || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 140);
          if (/redirect|client/i.test(msg) || (pre.status === 400 && msg.length > 0)) {
            throw httpErr(400, `${name} lässt die Anmeldung im Moment nur für freigegebene Apps zu (${msg || 'HTTP ' + pre.status}). Verbinde dich mit einem Zugangsschlüssel.`, { code: 'REDIRECT_NOT_ALLOWED' });
          }
        }
      } catch (e) {
        if (e.code === 'REDIRECT_NOT_ALLOWED') throw e;
      }
    };

    // Reihenfolge: eigene Client-ID → Coden-App → automatische Registrierung (DCR) → Client-ID-Dokument (CIMD)
    let chosen = null, lastErr = null;
    if (userClientId) {
      chosen = { clientId: userClientId.slice(0, 300), clientSecret: userClientSecret.slice(0, 500), tokenAuthMethod: userClientSecret ? 'client_secret_post' : 'none', dcr: false };
    } else if (app) {
      chosen = app;
    } else {
      const candidates = [];
      if (disc.registrationEndpoint) candidates.push(async () => registerDynamicClient(disc.registrationEndpoint, redirectUri, new URL(redirectUri).origin));
      if (disc.cimd && cimdAllowed(redirectUri)) candidates.push(async () => ({ clientId: cimdUrl(redirectUri), clientSecret: '', tokenAuthMethod: 'none', dcr: true, cimd: true }));
      for (const make of candidates) {
        try {
          const c = await make();
          await precheck(await buildAuthUrl(c));
          chosen = c; break;
        } catch (e) { lastErr = e; }
      }
      if (!chosen) {
        if (lastErr) throw lastErr;
        throw httpErr(400, `${name} erlaubt keine automatische Anmeldung für Coden. Verbinde dich mit einem Zugangsschlüssel${CATALOG.byId(catalogId || '')?.app ? ' oder hinterlege als Owner eine Coden-App' : ''}.`, { code: 'NEEDS_CLIENT_ID' });
      }
    }
    const authUrl = await buildAuthUrl(chosen);

    res.json({
      authUrl: authUrl.toString(),
      dcr: !!chosen.dcr,
      method: chosen.app ? 'app' : chosen.cimd ? 'cimd' : chosen.dcr ? 'dcr' : 'client',
      scopes: scope
    });
  }));

  // ---------- OAuth 2.1 + PKCE Abschluss (Code -> Token Exchange + Persistenz) ----------
  r.post('/oauth/complete', rateLimit('mcp-oauth-done', 20, 60), guard(async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const state = typeof req.body?.state === 'string' ? req.body.state.trim() : '';
    if (!code || code.length > 4096 || !state || state.length > 16000) {
      throw httpErr(400, 'Ungültige OAuth-Antwortdaten.');
    }

    let st;
    try {
      const parts = state.split('.');
      if (parts.length !== 3 || parts.some(p => !p || Buffer.from(p, 'base64').toString('base64') !== p)) {
        throw new Error('non-canonical state');
      }
      st = JSON.parse(await byok.decrypt(state));
    } catch (_) {
      throw httpErr(400, 'OAuth-Status ungültig oder manipuliert.');
    }
    if (!st || st.v !== 1 || st.uid !== req.user.uid) throw httpErr(403, 'OAuth-Status gehört nicht zu diesem Konto.');
    if (!st.exp || Date.now() > st.exp) throw httpErr(400, 'Die Anmeldung ist abgelaufen. Bitte erneut versuchen.');
    if (!st.nonce || consumedNonces.has(st.nonce)) throw httpErr(400, 'Dieser Anmelde-Code wurde bereits verwendet.');
    markNonceUsed(st.nonce, st.exp);

    const tok = await tokenRequest(st.tokenEndpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: st.redirectUri,
      code_verifier: st.codeVerifier,
      ...(st.resource ? { resource: st.resource } : {})
    }, {
      clientId: st.clientId,
      clientSecret: st.clientSecret,
      tokenAuthMethod: st.tokenAuthMethod
    });

    const accessToken = String(tok.access_token);
    const tokenType = String(tok.token_type || 'Bearer');
    const expSec = Number(tok.expires_in);
    const tokenExpiresAt = Number.isFinite(expSec) && expSec > 0 ? new Date(Date.now() + expSec * 1000).toISOString() : null;

    let tools = [];
    let serverName = '';
    let status = 'connected';
    let lastError = null;
    try {
      const rTools = await mcpRequest({
        url: st.serverUrl,
        headers: { Authorization: `${tokenType} ${accessToken}` },
        method: 'tools/list'
      });
      tools = (rTools.result?.tools || []).filter(t => t && typeof t.name === 'string').slice(0, 80).map(trimTool);
      serverName = String(rTools.server?.name || '').slice(0, 120);
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw e;
      status = 'error';
      lastError = String(e.message || 'Werkzeuge konnten nicht geladen werden.').slice(0, 500);
    }

    const oauthPayload = {
      accessToken,
      refreshToken: tok.refresh_token ? String(tok.refresh_token) : '',
      tokenType,
      clientId: st.clientId,
      clientSecret: st.clientSecret || '',
      tokenAuthMethod: st.tokenAuthMethod || 'none',
      tokenEndpoint: st.tokenEndpoint,
      authEndpoint: st.authEndpoint,
      resource: st.resource || '',
      scope: String(tok.scope || st.scope || '').slice(0, 500)
    };
    const oauth_enc = await byok.encrypt(JSON.stringify(oauthPayload));
    const now = db.nowIso();

    let saved;
    if (st.connectionId) {
      const existing = await db.getDoc(`mcp_connections/${st.connectionId}`);
      if (!existing || existing.uid !== req.user.uid) throw httpErr(404, 'Verbindung nicht gefunden.');
      saved = await db.updateDoc(`mcp_connections/${st.connectionId}`, {
        auth_type: 'oauth',
        oauth_enc,
        token_enc: null,
        token_expires_at: tokenExpiresAt,
        scopes: oauthPayload.scope,
        server_name: serverName || existing.server_name || '',
        tools: tools.length ? tools : (existing.tools || []),
        status,
        last_error: lastError,
        enabled: true,
        updated_at: now
      });
    } else {
      const mine = await db.runQuery('mcp_connections', { where: [['uid', '==', req.user.uid]] });
      if (mine.length >= MAX_CONNS) throw httpErr(400, `Höchstens ${MAX_CONNS} Verbindungen möglich.`);
      let finalName = st.name;
      if (mine.some(x => x.name.toLowerCase() === finalName.toLowerCase())) {
        finalName = `${finalName.slice(0, 34)} (${mine.length + 1})`;
      }
      saved = await allocConnDoc((id) => ({
        id,
        uid: req.user.uid,
        name: finalName,
        url: st.serverUrl,
        catalog_id: st.catalogId || null,
        auth_type: 'oauth',
        enabled: true,
        header_name: 'Authorization',
        token_enc: null,
        oauth_enc,
        token_expires_at: tokenExpiresAt,
        scopes: oauthPayload.scope,
        server_name: serverName,
        tools,
        status,
        last_error: lastError,
        created_at: now,
        updated_at: now
      }));
    }

    res.json({ connection: sanitizeConn(saved), tools });
  }));

  // ---------- Tools & Call (unterstützt gespeicherte connectionId ODER direkte { url, headers }) ----------
  r.post('/tools', rateLimit('mcp-tools', 30, 60), guard(async (req, res) => {
    if (req.body?.connectionId) {
      const { doc, result, server } = await runConnectionRequest(req.user.uid, req.body.connectionId, { method: 'tools/list' });
      const tools = (result?.tools || []).filter(t => t && typeof t.name === 'string').slice(0, 80).map(trimTool);
      const updated = await db.updateDoc(`mcp_connections/${doc.id}`, {
        tools,
        server_name: String(server?.name || doc.server_name || '').slice(0, 120),
        status: 'connected',
        last_error: null,
        updated_at: db.nowIso()
      }).catch(() => doc);
      return res.json({ server, tools, connection: sanitizeConn(updated) });
    }
    const { result, server } = await mcpRequest({ url: req.body?.url, headers: req.body?.headers, method: 'tools/list' });
    res.json({ server, tools: (result?.tools || []).filter(t => t && typeof t.name === 'string').slice(0, 80).map(trimTool) });
  }));

  r.post('/call', rateLimit('mcp-call', 60, 60), guard(async (req, res) => {
    const tool = String(req.body?.tool || ''); if (!/^[\w.\-:/]{1,80}$/.test(tool)) throw httpErr(400, 'Ungültiger Werkzeugname.');
    const args = req.body?.args && typeof req.body.args === 'object' && !Array.isArray(req.body.args) ? req.body.args : {};
    if (JSON.stringify(args).length > 50_000) throw httpErr(400, 'Die Eingaben sind zu groß.');

    const { result } = req.body?.connectionId
      ? await runConnectionRequest(req.user.uid, req.body.connectionId, { method: 'tools/call', params: { name: tool, arguments: args } })
      : await mcpRequest({ url: req.body?.url, headers: req.body?.headers, method: 'tools/call', params: { name: tool, arguments: args } });

    const content = (result?.content || []).slice(0, 20).map(c => c.type === 'text' ? { type: 'text', text: String(c.text || '').slice(0, 20_000) } : c.type === 'image' && /^image\/(png|jpeg|gif|webp)$/.test(c.mimeType) && String(c.data || '').length < 3_000_000 ? { type: 'image', mimeType: c.mimeType, data: c.data } : { type: 'text', text: `[${c.type || 'Inhalt'} – nicht darstellbar]` });
    res.json({ isError: !!result?.isError, content, structured: result?.structuredContent && JSON.stringify(result.structuredContent).length < 20_000 ? result.structuredContent : undefined });
  }));

  return r;
}

module.exports = {
  mcpRouter,
  codenApp,
  mcpRequest,
  mcpOAuthCallbackHandler,
  discoverOAuth,
  isPrivateIp,
  parseServerUrl,
  request
};
