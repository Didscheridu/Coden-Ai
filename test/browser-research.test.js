// Tests für Research-Browser Backend (server/browser.js) & Chat-Parser (js/browser-core.js)
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const { setup } = require('./helpers');

(async () => {
  const { call, chk, finish, token } = await setup();
  const T = await token({ sub: 'uid-browser', email: 'br@x.de', email_verified: true });
  const P = (p, b, t) => call(p, b, t, 'POST');
  const BC = await import(pathToFileURL(path.join(__dirname, '../js/browser-core.js')).href);

  // Lokaler Test-Server mit Produktkarten, Suchformular, Links und Weiterleitung auf interne IP
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://127.0.0.1');
    if (u.pathname === '/redir-ssrf') {
      r.statusCode = 302;
      r.setHeader('Location', 'http://169.254.169.254/latest');
      return r.end();
    }
    if (u.pathname === '/s') {
      const k = u.searchParams.get('k') || '';
      r.setHeader('Content-Type', 'text/html; charset=utf-8');
      return r.end(`<!doctype html><html><head><title>Suche: ${k}</title><meta name="description" content="Trefferliste für ${k}"></head><body>
        <main>
          <div data-component-type="s-search-result">
            <h2><a href="/dp/B001"><span>Bluetooth Kopfhörer Studio</span></a></h2>
            <span class="a-price"><span class="a-offscreen">49,99 €</span></span>
            <span class="a-icon-alt">4,6 von 5 Sternen</span>
          </div>
          <div data-component-type="s-search-result">
            <h2><a href="/dp/B002"><span>Kabel-Kopfhörer Pro</span></a></h2>
            <span class="a-price"><span class="a-offscreen">29,00 €</span></span>
          </div>
        </main>
      </body></html>`);
    }
    if (u.pathname === '/dp/B001') {
      r.setHeader('Content-Type', 'text/html; charset=utf-8');
      return r.end('<!doctype html><html><head><title>Bluetooth Kopfhörer Studio</title></head><body><h1>Bluetooth Kopfhörer Studio</h1><p>Guter Klang für unterwegs, 30h Akku.</p></body></html>');
    }
    r.setHeader('Content-Type', 'text/html; charset=utf-8');
    r.end(`<!doctype html><html><head><title>Test Shop Startseite</title><meta name="description" content="Online-Testseite"></head><body>
      <form action="/s" method="GET"><input type="text" name="k" placeholder="Produkt suchen"></form>
      <a href="/dp/B001">Zum Kopfhörer</a>
      <p>Willkommen auf der Testseite für den Research-Browser.</p>
    </body></html>`);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  // 1. Auth & SSRF-Schutz
  chk('Ohne Login 401', (await P('/browser/open', { url: 'https://example.com' })).s, 401);
  for (const [label, url] of [
    ['localhost', 'http://localhost/'],
    ['127.0.0.1', 'https://127.0.0.1/'],
    ['Metadaten-IP', 'https://169.254.169.254/latest'],
    ['file://', 'file:///etc/passwd']
  ]) {
    chk('SSRF blockiert: ' + label, (await P('/browser/open', { url }, T)).s, 400);
  }

  // 2. Seite öffnen & parsen (mit lokaler Test-Ausnahme)
  process.env.MCP_ALLOW_PRIVATE = '1';
  const opened = await P('/browser/open', { url: base + '/' }, T);
  chk('Seite geladen mit Titel, Link & Suchformular', [
    opened.s,
    opened.j.title,
    opened.j.links?.length >= 1,
    opened.j.forms?.length >= 1
  ], [200, 'Test Shop Startseite', true, true]);

  chk('SSRF-Redirect wird nicht verfolgt', (await P('/browser/open', { url: base + '/redir-ssrf' }, T)).s, 400);

  // 3. Interaktive Browser-Aktion (Formular absenden -> Produktkarten extrahiert)
  const searched = await P('/browser/action', {
    url: base + '/',
    action: 'submit',
    target: 'form-1',
    value: 'Kopfhörer',
    formData: { k: 'Kopfhörer' }
  }, T);
  chk('Browser-Aktion submit liefert Produkte & Preise', [
    searched.s,
    searched.j.page?.title,
    searched.j.page?.products?.length,
    searched.j.page?.products?.[0]?.price
  ], [200, 'Suche: Kopfhörer', 2, '49,99 €']);

  // 4. Interaktive Browser-Aktion click
  const clicked = await P('/browser/action', {
    url: base + '/',
    action: 'click',
    target: base + '/dp/B001'
  }, T);
  chk('Browser-Aktion click öffnet Produktseite', [
    clicked.s,
    clicked.j.page?.title,
    clicked.j.page?.excerpt?.includes('30h Akku')
  ], [200, 'Bluetooth Kopfhörer Studio', true]);

  // 5. js/browser-core.js Parser-Tests
  const cmdOpen = BC.parseBrowserCommand('Ich schaue nach.\n<browser_open site="amazon.de" query="Kopfhörer" />');
  chk('parseBrowserCommand erkennt browser_open', cmdOpen, { kind: 'open', url: '', site: 'amazon.de', query: 'Kopfhörer' });

  const cmdAct = BC.parseBrowserCommand('<browser_action url="https://amazon.de" action="click" target="https://amazon.de/dp/B001" />');
  chk('parseBrowserCommand erkennt browser_action', cmdAct, {
    kind: 'action',
    url: 'https://amazon.de',
    action: 'click',
    target: 'https://amazon.de/dp/B001',
    value: '',
    formData: {}
  });

  const hidden = BC.hideBrowserToolTags('Vorher <browser_open url="https://x.de"/> Nachher <browser url="https://x.de">ok</browser>');
  chk('hideBrowserToolTags entfernt Werkzeugtags aber behält Vorschaukarte', hidden, 'Vorher  Nachher <browser url="https://x.de">ok</browser>');

  const prev = BC.parseBrowserPreview('Kopfhörer A | 49,99 € | https://amazon.de/dp/1', { url: 'https://amazon.de/s?k=x', title: 'Amazon' });
  chk('parseBrowserPreview extrahiert Produkt & Domain', [
    prev.domain,
    prev.products.length,
    prev.products[0].price
  ], ['amazon.de', 1, '49,99 €']);

  delete process.env.MCP_ALLOW_PRIVATE;
  srv.close();
  await finish();
})().catch(e => { console.error(e); process.exit(1); });
