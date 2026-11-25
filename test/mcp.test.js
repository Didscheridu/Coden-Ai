// MCP-Client + MCP-OAuth 2.1 (Discovery, DCR, PKCE, Refresh, Verschlüsselung) + Schutz vor internen Adressen
const http = require('http');
const crypto = require('crypto');
const { setup } = require('./helpers');

(async () => {
  const { call, chk, finish, token, base: appBase } = await setup();
  const T = await token({ sub: 'uid-mcp', email: 'mcp@x.de', email_verified: true });
  const T2 = await token({ sub: 'uid-mcp-2', email: 'mcp2@x.de', email_verified: true });
  const P = (p, b, t) => call(p, b, t, 'POST');
  const seen = [];

  // OAuth-Mock-Status für Discovery + DCR + PKCE + Refresh
  let currentAccessToken = 'tok-initial-1';
  const currentRefreshToken = 'ref-secret-1';
  let registeredClient = null;
  let pendingCode = null;
  let lastChallenge = null;

  let failAuthorizeRedirect = false;
  let failDcrRedirect = false;
  let asMode = 'dcr'; // 'dcr' | 'cimd' (nur Client-ID-Dokument) | 'dcr+cimd' | 'none'

  const srv = http.createServer((q, r) => {
    let body = '';
    q.on('data', c => body += c);
    q.on('end', () => {
      const urlObj = new URL(q.url, 'http://127.0.0.1');
      const p = urlObj.pathname;
      seen.push({ url: q.url, auth: q.headers.authorization, method: q.method, sid: q.headers['mcp-session-id'] });

      // RFC 9728 Protected Resource Metadata
      if (p === '/.well-known/oauth-protected-resource/oauth-mcp' || p === '/.well-known/oauth-protected-resource') {
        r.setHeader('Content-Type', 'application/json');
        return r.end(JSON.stringify({
          resource: `${base}/oauth-mcp`,
          authorization_servers: [base],
          scopes_supported: ['tools:read', 'tools:write']
        }));
      }
      // RFC 8414 Authorization Server Metadata
      if (p === '/.well-known/oauth-authorization-server') {
        r.setHeader('Content-Type', 'application/json');
        return r.end(JSON.stringify({
          issuer: base,
          authorization_endpoint: `${base}/oauth/authorize`,
          token_endpoint: `${base}/oauth/token`,
          ...(asMode === 'dcr' || asMode === 'dcr+cimd' ? { registration_endpoint: `${base}/oauth/register` } : {}),
          ...(asMode === 'cimd' || asMode === 'dcr+cimd' ? { client_id_metadata_document_supported: true } : {}),
          code_challenge_methods_supported: ['S256'],
          response_types_supported: ['code']
        }));
      }
      // RFC 7591 Dynamic Client Registration
      if (p === '/oauth/register' && q.method === 'POST') {
        if (failDcrRedirect) {
          r.statusCode = 400;
          r.setHeader('Content-Type', 'application/json');
          return r.end(JSON.stringify({ error: 'invalid_redirect_uri', error_description: 'Invalid redirect URI' }));
        }
        const reg = JSON.parse(body || '{}');
        registeredClient = {
          client_id: 'dyn-client-42',
          client_secret: 'dyn-secret-99',
          redirect_uris: reg.redirect_uris || [],
          token_endpoint_auth_method: 'client_secret_post'
        };
        r.statusCode = 201;
        r.setHeader('Content-Type', 'application/json');
        return r.end(JSON.stringify(registeredClient));
      }
      if (p === '/oauth/authorize' && q.method === 'GET') {
        if (failAuthorizeRedirect) {
          r.statusCode = 400;
          r.setHeader('Content-Type', 'text/plain');
          return r.end('Invalid redirect URI.');
        }
        r.statusCode = 200;
        r.setHeader('Content-Type', 'text/html');
        return r.end('<html>ok</html>');
      }
      // OAuth Token Endpoint (PKCE S256 + Refresh)
      if (p === '/oauth/token' && q.method === 'POST') {
        const form = new URLSearchParams(body);
        const grant = form.get('grant_type');
        r.setHeader('Content-Type', 'application/json');
        if (grant === 'authorization_code') {
          const code = form.get('code');
          const verifier = form.get('code_verifier');
          const challenge = crypto.createHash('sha256').update(String(verifier || '')).digest('base64url');
          if (code !== pendingCode || challenge !== lastChallenge || form.get('client_id') !== 'dyn-client-42') {
            r.statusCode = 400;
            return r.end(JSON.stringify({ error: 'invalid_grant' }));
          }
          pendingCode = null;
          return r.end(JSON.stringify({
            access_token: currentAccessToken,
            refresh_token: currentRefreshToken,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'tools:read tools:write'
          }));
        }
        if (grant === 'refresh_token') {
          if (form.get('refresh_token') !== currentRefreshToken) {
            r.statusCode = 400;
            return r.end(JSON.stringify({ error: 'invalid_grant' }));
          }
          currentAccessToken = 'tok-refreshed-2';
          return r.end(JSON.stringify({
            access_token: currentAccessToken,
            refresh_token: currentRefreshToken,
            token_type: 'Bearer',
            expires_in: 3600
          }));
        }
        r.statusCode = 400;
        return r.end(JSON.stringify({ error: 'unsupported_grant_type' }));
      }

      if (p === '/user/repos' && q.method === 'GET') {
        if (q.headers.authorization !== 'Bearer ghp-secret') {
          r.statusCode = 401;
          return r.end(JSON.stringify({ message: 'Bad credentials' }));
        }
        r.setHeader('Content-Type', 'application/json');
        return r.end(JSON.stringify([
          { full_name: 'anna/open-app', private: false, description: 'Freigegeben' },
          { full_name: 'anna/secret-app', private: true, description: 'Geheim' }
        ]));
      }

      if (q.method === 'DELETE') { r.statusCode = 200; return r.end(); }
      if (p.startsWith('/oauth-mcp') && q.headers.authorization !== `Bearer ${currentAccessToken}`) {
        r.statusCode = 401;
        r.setHeader('WWW-Authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/oauth-mcp", scope="tools:read tools:write"`);
        return r.end('unauthorized');
      }
      if (q.url.startsWith('/auth') && q.headers.authorization !== 'Bearer geheim') { r.statusCode = 401; return r.end('no'); }
      if (q.url === '/redirect') { r.statusCode = 302; r.setHeader('Location', 'http://169.254.169.254/'); return r.end(); }
      if (q.url === '/kaputt') { r.setHeader('Content-Type', 'text/html'); return r.end('<html>'); }

      const m = JSON.parse(body || '{}');
      const sse = q.url.startsWith('/sse');
      const send = (result) => {
        const msg = { jsonrpc: '2.0', id: m.id, result };
        if (sse) { r.setHeader('Content-Type', 'text/event-stream'); r.end(`event: message\ndata: ${JSON.stringify(msg)}\n\n`); }
        else { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify(msg)); }
      };
      if (m.method === 'initialize') { r.setHeader('Mcp-Session-Id', 'sess-1'); return send({ protocolVersion: '2025-03-26', serverInfo: { name: 'Test', version: '1' }, capabilities: { tools: {} } }); }
      if (m.method === 'notifications/initialized') { r.statusCode = 202; return r.end(); }
      if (m.method === 'tools/list') return send({ tools: [{ name: 'echo', description: 'Gibt Text zurück', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] });
      if (m.method === 'tools/call') {
        if (m.params?.name === 'search_repositories') {
          return send({ content: [{ type: 'text', text: JSON.stringify({ total_count: 2, items: [{ full_name: 'anna/open-app' }, { full_name: 'anna/secret-app' }] }) }] });
        }
        if (m.params?.name === 'search_code' || m.params?.name === 'get_file_contents') {
          return send({ content: [{ type: 'text', text: JSON.stringify(m.params.arguments || {}) }] });
        }
        return send({ content: [{ type: 'text', text: 'Echo: ' + (m.params.arguments?.text ?? '') }, { type: 'resource', uri: 'x' }] });
      }
      r.end('{}');
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  // --- Schutz (ohne Test-Ausnahme): nur öffentliche https-Adressen ---
  chk('ohne Login', (await P('/mcp/tools', { url: 'https://example.com/mcp' })).s, 401);
  for (const [n, u] of [['http', 'http://example.com/mcp'], ['localhost', 'https://localhost/mcp'], ['127.0.0.1', 'https://127.0.0.1/mcp'], ['Metadaten-IP', 'https://169.254.169.254/latest'], ['10.x', 'https://10.1.2.3/'], ['IPv6 lokal', 'https://[::1]/'], ['IPv4-in-IPv6', 'https://[::ffff:127.0.0.1]/'], ['intern', 'https://db.internal/'], ['ohne Punkt', 'https://intranet/'], ['Zugangsdaten', 'https://a:b@example.com/'], ['Müll', 'kein-link']])
    chk('blockiert: ' + n, (await P('/mcp/tools', { url: u }, T)).s, 400);
  chk('Header Host verboten', (await P('/mcp/tools', { url: 'https://example.com/m', headers: { Host: 'x' } }, T)).s, 400);
  chk('Header mit Zeilenumbruch', (await P('/mcp/tools', { url: 'https://example.com/m', headers: { Authorization: 'a\r\nX: y' } }, T)).s, 400);
  chk('OAuth Discovery SSRF blockiert', (await P('/mcp/oauth/start', { url: 'https://169.254.169.254/mcp', name: 'Evil', redirectUri: `${appBase}/mcp/oauth/callback` }, T)).s, 400);

  // --- Ablauf (Test-Ausnahme für 127.0.0.1) ---
  process.env.MCP_ALLOW_PRIVATE = '1';
  const tl = await P('/mcp/tools', { url: base + '/json' }, T);
  chk('Werkzeuge (JSON)', [tl.s, tl.j.tools.map(t => t.name), tl.j.server?.name], [200, ['echo'], 'Test']);
  chk('Werkzeuge (SSE)', (await P('/mcp/tools', { url: base + '/sse' }, T)).j.tools[0].name, 'echo');
  const cl = await P('/mcp/call', { url: base + '/json', tool: 'echo', args: { text: 'Hallo' } }, T);
  chk('Aufruf', [cl.s, cl.j.content[0].text, cl.j.content[1].text], [200, 'Echo: Hallo', '[resource – nicht darstellbar]']);
  chk('Sitzung wird weitergegeben', seen.some(x => x.sid === 'sess-1' && x.method === 'POST'), true);
  chk('ohne Token: 401', [(await P('/mcp/tools', { url: base + '/auth' }, T)).s], [401]);
  chk('mit Token', (await P('/mcp/tools', { url: base + '/auth', headers: { Authorization: 'Bearer geheim' } }, T)).s, 200);
  chk('Weiterleitung wird nicht verfolgt', (await P('/mcp/tools', { url: base + '/redirect' }, T)).s, 502);
  chk('keine MCP-Antwort', (await P('/mcp/tools', { url: base + '/kaputt' }, T)).s, 502);
  chk('Werkzeugname geprüft', (await P('/mcp/call', { url: base + '/json', tool: '../x y', args: {} }, T)).s, 400);
  chk('nichts erreichbar', (await P('/mcp/tools', { url: 'http://127.0.0.1:9/' }, T)).s, 502);

  // --- Vollständiger MCP-OAuth 2.1 + DCR + PKCE + Verschlüsselung + Auto-Refresh Ablauf ---
  const redirectUri = `${appBase}/mcp/oauth/callback`;
  const startRes = await P('/mcp/oauth/start', { url: `${base}/oauth-mcp`, name: 'TestApp', redirectUri }, T);
  chk('OAuth Start + DCR', [startRes.s, startRes.j.dcr, Boolean(registeredClient)], [200, true, true]);
  const authUrl = new URL(startRes.j.authUrl);
  lastChallenge = authUrl.searchParams.get('code_challenge');
  const state = authUrl.searchParams.get('state');
  chk('PKCE S256 gesetzt', [authUrl.searchParams.get('code_challenge_method'), Boolean(lastChallenge), Boolean(state)], ['S256', true, true]);

  // Callback HTML prüft XSS-Escape & postMessage ohne Login
  const cbRes = await fetch(`${appBase}/mcp/oauth/callback?code=c1&state=s1&error_description=%3Cscript%3E`);
  const cbHtml = await cbRes.text();
  chk('Callback HTML sicher', [cbRes.status, cbHtml.includes('<script>alert'), cbHtml.includes('\\u003cscript\\u003e')], [200, false, true]);

  pendingCode = 'auth-code-123';
  chk('Falscher Nutzer darf State nicht abschließen', (await P('/mcp/oauth/complete', { code: pendingCode, state }, T2)).s, 403);
  chk('Manipulierter State abgelehnt', (await P('/mcp/oauth/complete', { code: pendingCode, state: state + 'x' }, T)).s, 400);

  const doneRes = await P('/mcp/oauth/complete', { code: pendingCode, state }, T);
  chk('OAuth Complete speichert Verbindung', [doneRes.s, doneRes.j.connection?.authType, doneRes.j.connection?.tools?.length], [200, 'oauth', 1]);
  const connId = doneRes.j.connection.id;

  // Replay des gleichen State wird blockiert
  chk('State-Replay blockiert', (await P('/mcp/oauth/complete', { code: 'auth-code-123', state }, T)).s, 400);

  // Liste enthält keine geheimen Felder
  const listRes = await call('/mcp/connections', undefined, T, 'GET');
  const listed = listRes.j.connections.find(c => c.id === connId);
  chk('Verbindungsliste gibt keine Geheimnisse heraus', [listRes.s, Boolean(listed), listed.hasToken, 'oauth_enc' in listed, 'token_enc' in listed, 'accessToken' in listed], [200, true, true, false, false, false]);

  // Aufruf mit gespeicherter connectionId
  const callConn = await P('/mcp/call', { connectionId: connId, tool: 'echo', args: { text: 'OAuth!' } }, T);
  chk('Aufruf über connectionId', [callConn.s, callConn.j.content?.[0]?.text], [200, 'Echo: OAuth!']);

  // Fremder Nutzer darf Verbindung nicht nutzen oder löschen
  chk('Fremde Verbindung verweigert', (await P('/mcp/call', { connectionId: connId, tool: 'echo', args: {} }, T2)).s, 404);

  // Token läuft serverseitig ab -> Coden erneuert automatisch per refresh_token und wiederholt Aufruf
  currentAccessToken = 'tok-rotated-new';
  const callRefresh = await P('/mcp/call', { connectionId: connId, tool: 'echo', args: { text: 'Refreshed!' } }, T);
  chk('Auto-Refresh nach 401 erfolgreich', [callRefresh.s, callRefresh.j.content?.[0]?.text, currentAccessToken], [200, 'Echo: Refreshed!', 'tok-refreshed-2']);

  // Token-Verbindung direkt speichern, testen & löschen
  const saveKey = await P('/mcp/connections', { name: 'KeySrv', url: `${base}/auth`, token: 'geheim', authType: 'key' }, T);
  chk('Token-Verbindung gespeichert', [saveKey.s, saveKey.j.connection?.hasToken], [200, true]);
  const keyCall = await P('/mcp/call', { connectionId: saveKey.j.connection.id, tool: 'echo', args: { text: 'Key' } }, T);
  chk('Token-Verbindung Aufruf', [keyCall.s, keyCall.j.content?.[0]?.text], [200, 'Echo: Key']);
  const delRes = await call(`/mcp/connections/${saveKey.j.connection.id}`, undefined, T, 'DELETE');
  chk('Verbindung gelöscht', delRes.s, 200);

  // Canva-Style Pre-flight & DCR invalid_redirect_uri Erkennung
  failAuthorizeRedirect = true;
  const canvaLike = await P('/mcp/oauth/start', { url: `${base}/oauth-mcp`, name: 'CanvaLike', redirectUri }, T);
  chk('Authorize 400 Invalid redirect URI vorab abgefangen', [canvaLike.s, canvaLike.j.code], [400, 'REDIRECT_NOT_ALLOWED']);
  failAuthorizeRedirect = false;

  failDcrRedirect = true;
  const vercelLike = await P('/mcp/oauth/start', { url: `${base}/oauth-mcp`, name: 'VercelLike', redirectUri }, T);
  chk('DCR invalid_redirect_uri sauber klassifiziert', [vercelLike.s, vercelLike.j.code], [400, 'REDIRECT_NOT_ALLOWED']);
  failDcrRedirect = false;

  // --- Ein-Klick ohne Registrierung: Client-ID-Dokument (CIMD) ---
  const meta = await call('/mcp/oauth/client.json', undefined, undefined, 'GET');
  chk('Client-ID-Dokument ohne Login abrufbar', [meta.s, meta.j.client_name, meta.j.client_id.endsWith('/api/mcp/oauth/client.json'), meta.j.redirect_uris[0].endsWith('/api/mcp/oauth/callback'), meta.j.token_endpoint_auth_method], [200, 'Coden AI', true, true, 'none']);
  asMode = 'cimd';
  const cimdStart = await P('/mcp/oauth/start', { url: `${base}/oauth-mcp`, name: 'CimdApp', redirectUri }, T);
  const cimdClient = cimdStart.j.authUrl ? new URL(cimdStart.j.authUrl).searchParams.get('client_id') : '';
  chk('Ohne DCR: Anmeldung über Client-ID-Dokument', [cimdStart.s, cimdStart.j.method, cimdClient.endsWith('/api/mcp/oauth/client.json')], [200, 'cimd', true]);
  asMode = 'dcr+cimd'; failDcrRedirect = true;
  const fallback = await P('/mcp/oauth/start', { url: `${base}/oauth-mcp`, name: 'FallbackApp', redirectUri }, T);
  chk('DCR abgelehnt → Client-ID-Dokument als Ersatz', [fallback.s, fallback.j.method], [200, 'cimd']);
  failDcrRedirect = false;
  asMode = 'none';
  const none = await P('/mcp/oauth/start', { url: `${base}/oauth-mcp`, name: 'NoneApp', redirectUri }, T);
  chk('Weder DCR noch Client-ID-Dokument → verständlicher Fehler', [none.s, none.j.code], [400, 'NEEDS_CLIENT_ID']);

  // --- Coden-App (vom Owner hinterlegt) gilt nur für die Adresse aus dem Katalog ---
  process.env.MCP_OAUTH_GITHUB = 'coden-gh-id:coden-gh-secret';
  const evil = await P('/mcp/oauth/start', { url: `${base}/oauth-mcp`, name: 'EvilGitHub', catalogId: 'github', redirectUri }, T);
  chk('Coden-App nicht für fremde Adresse (Secret bleibt geheim)', [evil.s, evil.j.code], [400, 'NEEDS_CLIENT_ID']);
  const { codenApp } = require('../server/mcp');
  chk('Coden-App für die Katalog-Adresse', codenApp('github', 'https://api.githubcopilot.com/mcp/')?.clientId, 'coden-gh-id');
  chk('Coden-App: unbekannter Dienst', codenApp('gibtsnicht', 'https://api.githubcopilot.com/mcp/'), null);
  const st = await call('/mcp/catalog-status', undefined, T, 'GET');
  chk('Katalog-Status nennt Dienste mit Coden-App', [st.s, st.j.apps], [200, ['github']]);
  delete process.env.MCP_OAUTH_GITHUB;
  asMode = 'dcr';

  // Callback HTML enthält BroadcastChannel-Unterstützung
  chk('Callback HTML enthält BroadcastChannel', cbHtml.includes('BroadcastChannel'), true);

  // --- GitHub MCP Repository-Einschränkung (allowlist, Repo-Liste, Blockade & Filter) ---
  chk('Nicht-GitHub-Verbindung lehnt allowedRepos ab', (await call(`/mcp/connections/${connId}`, { allowedRepos: ['anna/open-app'] }, T, 'PATCH')).s, 400);
  const ghSave = await P('/mcp/connections', { name: 'GitHub', url: `${base}/json`, catalogId: 'github', token: 'ghp-secret', authType: 'key' }, T);
  const ghId = ghSave.j.connection.id;
  chk('GitHub-Verbindung startet uneingeschränkt', [ghSave.s, ghSave.j.connection.allowedRepos], [200, null]);

  process.env.MCP_GITHUB_API_BASE = base;
  const ghRepos = await call(`/mcp/connections/${ghId}/github-repos`, undefined, T, 'GET');
  delete process.env.MCP_GITHUB_API_BASE;
  chk('GitHub Repo-Liste für Verbindung geladen', [ghRepos.s, ghRepos.j.repos.map(r => r.fullName)], [200, ['anna/open-app', 'anna/secret-app']]);

  chk('Ungültiger Repo-Name in allowedRepos abgelehnt', (await call(`/mcp/connections/${ghId}`, { allowedRepos: ['../evil'] }, T, 'PATCH')).s, 400);
  const ghPatch = await call(`/mcp/connections/${ghId}`, { allowedRepos: ['Anna/Open-App'] }, T, 'PATCH');
  chk('allowedRepos normalisiert auf lowercase', [ghPatch.s, ghPatch.j.connection.allowedRepos], [200, ['anna/open-app']]);

  chk('Blockiert owner/repo für nicht freigegebenes Repo', [
    (await P('/mcp/call', { connectionId: ghId, tool: 'get_file_contents', args: { owner: 'anna', repo: 'secret-app', path: 'README.md' } }, T)).s,
    (await P('/mcp/call', { connectionId: ghId, tool: 'get_file_contents', args: { repository: 'anna/secret-app' } }, T)).s,
    (await P('/mcp/call', { connectionId: ghId, tool: 'search_code', args: { query: 'secret repo:anna/secret-app' } }, T)).s,
    (await P('/mcp/call', { connectionId: ghId, tool: 'create_repository', args: { name: 'neu' } }, T)).s
  ], [403, 403, 403, 403]);

  const ghAllowedCall = await P('/mcp/call', { connectionId: ghId, tool: 'get_file_contents', args: { owner: 'Anna', repo: 'Open-App', path: 'index.html' } }, T);
  chk('Freigegebenes Repo bleibt erreichbar', ghAllowedCall.s, 200);

  const ghSearchCode = await P('/mcp/call', { connectionId: ghId, tool: 'search_code', args: { query: 'init' } }, T);
  chk('search_code bekommt repo:-Filter automatisch injiziert', [ghSearchCode.s, JSON.parse(ghSearchCode.j.content[0].text).query], [200, 'init repo:anna/open-app']);

  const ghSearchRepos = await P('/mcp/call', { connectionId: ghId, tool: 'search_repositories', args: { query: 'app' } }, T);
  const filteredRepos = JSON.parse(ghSearchRepos.j.content[0].text);
  chk('search_repositories filtert nicht freigegebene Repos heraus', [ghSearchRepos.s, filteredRepos.total_count, filteredRepos.items.map(x => x.full_name)], [200, 1, ['anna/open-app']]);

  const ghUnrestrict = await call(`/mcp/connections/${ghId}`, { allowedRepos: null }, T, 'PATCH');
  chk('allowedRepos: null hebt Einschränkung auf', [ghUnrestrict.s, ghUnrestrict.j.connection.allowedRepos, (await P('/mcp/call', { connectionId: ghId, tool: 'get_file_contents', args: { owner: 'anna', repo: 'secret-app' } }, T)).s], [200, null, 200]);

  delete process.env.MCP_ALLOW_PRIVATE;
  chk('danach wieder gesperrt', (await P('/mcp/tools', { url: base + '/json' }, T)).s, 400);
  srv.close(); await finish();
})().catch(e => { console.error(e); process.exit(1); });
