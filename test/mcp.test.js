// MCP-Client: Ablauf gegen einen Test-Server (JSON und SSE) + Schutz vor internen Adressen
const http = require('http');
const { setup } = require('./helpers');
(async () => {
  const { call, chk, finish, token } = await setup();
  const T = await token({ sub: 'uid-mcp', email: 'mcp@x.de', email_verified: true });
  const P = (p, b, t) => call(p, b, t, 'POST');
  const seen = [];
  // Mini-MCP-Server: /json antwortet mit JSON, /sse mit Event-Stream, /auth verlangt einen Token
  const srv = http.createServer((q, r) => {
    let body = ''; q.on('data', c => body += c); q.on('end', () => {
      seen.push({ url: q.url, auth: q.headers.authorization, method: q.method, sid: q.headers['mcp-session-id'] });
      if (q.method === 'DELETE') { r.statusCode = 200; return r.end(); }
      if (q.url.startsWith('/auth') && q.headers.authorization !== 'Bearer geheim') { r.statusCode = 401; return r.end('no'); }
      if (q.url === '/redirect') { r.statusCode = 302; r.setHeader('Location', 'http://169.254.169.254/'); return r.end(); }
      if (q.url === '/kaputt') { r.setHeader('Content-Type', 'text/html'); return r.end('<html>'); }
      const m = JSON.parse(body || '{}'); const sse = q.url.startsWith('/sse');
      const send = (result) => { const msg = { jsonrpc: '2.0', id: m.id, result };
        if (sse) { r.setHeader('Content-Type', 'text/event-stream'); r.end(`event: message\ndata: ${JSON.stringify(msg)}\n\n`); } else { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify(msg)); } };
      if (m.method === 'initialize') { r.setHeader('Mcp-Session-Id', 'sess-1'); return send({ protocolVersion: '2025-03-26', serverInfo: { name: 'Test', version: '1' }, capabilities: { tools: {} } }); }
      if (m.method === 'notifications/initialized') { r.statusCode = 202; return r.end(); }
      if (m.method === 'tools/list') return send({ tools: [{ name: 'echo', description: 'Gibt Text zurück', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] });
      if (m.method === 'tools/call') return send({ content: [{ type: 'text', text: 'Echo: ' + m.params.arguments.text }, { type: 'resource', uri: 'x' }] });
      r.end('{}');
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`;

  // --- Schutz (ohne Test-Ausnahme): nur öffentliche https-Adressen ---
  chk('ohne Login', (await P('/mcp/tools', { url: 'https://example.com/mcp' })).s, 401);
  for (const [n, u] of [['http', 'http://example.com/mcp'], ['localhost', 'https://localhost/mcp'], ['127.0.0.1', 'https://127.0.0.1/mcp'], ['Metadaten-IP', 'https://169.254.169.254/latest'], ['10.x', 'https://10.1.2.3/'], ['IPv6 lokal', 'https://[::1]/'], ['IPv4-in-IPv6', 'https://[::ffff:127.0.0.1]/'], ['intern', 'https://db.internal/'], ['ohne Punkt', 'https://intranet/'], ['Zugangsdaten', 'https://a:b@example.com/'], ['Müll', 'kein-link']])
    chk('blockiert: ' + n, (await P('/mcp/tools', { url: u }, T)).s, 400);
  chk('Header Host verboten', (await P('/mcp/tools', { url: 'https://example.com/m', headers: { Host: 'x' } }, T)).s, 400);
  chk('Header mit Zeilenumbruch', (await P('/mcp/tools', { url: 'https://example.com/m', headers: { Authorization: 'a\r\nX: y' } }, T)).s, 400);

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
  delete process.env.MCP_ALLOW_PRIVATE;
  chk('danach wieder gesperrt', (await P('/mcp/tools', { url: base + '/json' }, T)).s, 400);
  srv.close(); await finish();
})().catch(e => { console.error(e); process.exit(1); });
