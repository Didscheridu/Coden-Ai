// Browser-Test für den Coden-Bundler (shared/coden-modules.js) in echtem Chrome über Playwright.
// Aufruf: npm run test:browser   (braucht Chrome + Playwright; ist nicht Teil von npm test)
// esm.sh, jsdelivr (Babel) und Tailwind werden lokal aus node_modules bedient – so läuft der Test auch offline.
// Wie auf esm.sh gibt es genau EINE React-Instanz für alle Pakete.
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..', '..');
const req = (m) => require(require.resolve(m, { paths: [root] }));
const esbuild = req('esbuild');
const pw = (() => { try { return req('playwright'); } catch (_) { return require('/opt/npm-tools/node_modules/playwright'); } })();
const Modules = require(path.join(root, 'shared/coden-modules.js'));
const Bundle = require(path.join(root, 'shared/app-bundle.js'));

let pass = 0, fail = 0;
const chk = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `\n     erwartet ${JSON.stringify(want)}\n     bekommen ${JSON.stringify(got)}`}`); };

// ---------- Ersatz für esm.sh ----------
const VENDOR = `
import * as React from 'react'; import * as ReactDOM from 'react-dom'; import * as ReactDOMClient from 'react-dom/client';
import * as JSX from 'react/jsx-runtime'; import * as Lucide from 'lucide-react'; import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export { React, ReactDOM, ReactDOMClient, JSX, Lucide, THREE }; export const OrbitAddon = { OrbitControls };`;
const KEYS = {
  React: Object.keys(req('react')), ReactDOM: Object.keys(req('react-dom')), ReactDOMClient: Object.keys(req('react-dom/client')),
  JSX: Object.keys(req('react/jsx-runtime')), Lucide: Object.keys(req('lucide-react')), THREE: Object.keys(req('three')), OrbitAddon: ['OrbitControls']
};
const ROUTES = [ // Pfad bei esm.sh (ohne Version/Query) -> Teil des Vendor-Bündels
  [/^\/react(@[^/]+)?\/jsx-runtime$/, 'JSX'], [/^\/react(@[^/]+)?\/jsx-dev-runtime$/, 'JSX'], [/^\/react(@[^/]+)?$/, 'React'],
  [/^\/react-dom(@[^/]+)?\/client$/, 'ReactDOMClient'], [/^\/react-dom(@[^/]+)?$/, 'ReactDOM'],
  [/^\/lucide-react(@[^/]+)?$/, 'Lucide'], [/^\/three(@[^/]+)?$/, 'THREE'], [/^\/three(@[^/]+)?\/examples\/jsm\/controls\/OrbitControls\.js$/, 'OrbitAddon']
];
const RESERVED = new Set(['default', 'delete', 'new', 'class', 'function', 'import', 'export']);
let vendorCode = null;
async function vendor() {
  if (vendorCode) return vendorCode;
  const r = await esbuild.build({ stdin: { contents: VENDOR, resolveDir: root }, bundle: true, format: 'esm', write: false, minify: true, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  return (vendorCode = r.outputFiles[0].text);
}
const esmRequests = [];
async function esmRoute(route) {
  const u = new URL(route.request().url()); esmRequests.push(u.pathname + u.search);
  if (u.pathname === '/__vendor.mjs') return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: await vendor() });
  const hit = ROUTES.find(([re]) => re.test(u.pathname));
  if (!hit) return route.fulfill({ status: 404, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'not found ' + u.pathname });
  const part = hit[1];
  const names = KEYS[part].filter(k => /^[A-Za-z_$][\w$]*$/.test(k) && !RESERVED.has(k));
  const body = `import { ${part} as M } from "https://esm.sh/__vendor.mjs";\nexport default (M.default ?? M);\n${names.length ? `export const { ${names.join(', ')} } = M;` : ''}`;
  return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
}

// ---------- Seiten ----------
// Wie in js/artifacts.js (page + CSP), damit die echten Regeln mitgetestet werden
const CSP = `default-src 'none'; img-src data: blob: https:; media-src data: blob: https:; style-src 'unsafe-inline' https:; font-src https: data:; script-src 'unsafe-inline' data: blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://esm.sh https://cdn.tailwindcss.com; connect-src https: data: blob:; worker-src blob: data:; form-action 'none'; base-uri 'none'`;
const artifactPage = (body) => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><script src="https://cdn.tailwindcss.com"></script></head><body>${body}</body></html>`;

(async () => {
  const browser = await pw.chromium.launch({ executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.route('https://esm.sh/**', esmRoute);
  const babelSrc = fs.readFileSync(path.join(root, 'node_modules/@babel/standalone/babel.min.js'));
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@babel\/standalone/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: babelSrc }).catch(() => {}));
  await ctx.route(/cdn\.tailwindcss\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind = { config: {} };' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   [Seite]', e.message));

  // Lädt ein Dokument in ein Sandbox-iframe (ohne allow-same-origin, wie in Coden) und wartet auf den Bundler
  async function run(doc, waitFor = '#root *', ms = 15000) {
    await page.setContent('<!doctype html><html><body><iframe id="f" sandbox="allow-scripts allow-modals allow-forms" style="width:800px;height:600px"></iframe></body></html>');
    await page.evaluate((d) => { window.msgs = []; window.addEventListener('message', (e) => window.msgs.push(e.data)); document.getElementById('f').srcdoc = d; }, doc);
    const frame = await (await page.waitForSelector('#f')).contentFrame();
    // Erst warten, bis das srcdoc-Dokument steht (nicht das leere about:blank davor), dann bis der Bundler fertig ist
    for (let i = 0; i < 3; i++) {
      try { await frame.waitForFunction(() => document.querySelector('script[data-coden="modules"]') ? !!window.__codenModules : document.readyState === 'complete' && !!document.body, null, { timeout: ms }); await frame.evaluate(() => window.__codenModules); break; } catch (_) { /* Kontext neu geladen: nochmal */ }
    }
    if (waitFor) { try { await frame.waitForSelector(waitFor, { timeout: ms }); } catch (_) { /* geprüft im Test */ } }
    const msgs = await page.evaluate(() => window.msgs);
    return { frame, msgs };
  }
  const errText = (f) => f.evaluate(() => [...document.querySelectorAll('[data-coden-error]')].map(d => d.textContent).join('\n'));

  // 1) Altes React-Artefakt: keine Importe, Hooks einfach benutzt, export default
  let r = await run(artifactPage(`<div id="root"></div>${Modules.reactArtifact(`export default function Zaehler() {
  const [n, setN] = useState(0);
  return <button id="b" onClick={() => setN(n + 1)}>Klicks: {n}</button>;
}`)}`), '#b');
  await r.frame.click('#b'); await r.frame.click('#b');
  chk('React ohne Importe: rendert und Hooks laufen', await r.frame.textContent('#b'), 'Klicks: 2');

  // 2) Wie Claude-Artefakte: TypeScript, lucide-react, shadcn/ui, recharts-artige Importe
  r = await run(artifactPage(`<div id="root"></div>${Modules.reactArtifact(`import React, { useState } from 'react';
import { Heart, Star } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
type Props = { start?: number };
interface Item { id: number; name: string }
const items: Item[] = [{ id: 1, name: 'Eins' }];
export default function App({ start = 3 }: Props) {
  const [likes, setLikes] = useState<number>(start);
  return (<Card className={cn('m-4', likes > 3 && 'liked')}>
    <CardHeader><CardTitle>Hallo</CardTitle></CardHeader>
    <CardContent>
      <Button id="like" variant="outline" onClick={() => setLikes(l => l + 1)}><Heart size={16} /> {likes}</Button>
      <Star id="star" />
      <Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b" id="tb">B</TabsTrigger></TabsList>
        <TabsContent value="a"><p id="pa">Inhalt A {items[0].name}</p></TabsContent><TabsContent value="b"><p id="pb">Inhalt B</p></TabsContent></Tabs>
    </CardContent></Card>);
}`)}`), '#like');
  await r.frame.click('#like');
  chk('TSX + lucide + shadcn: Button zählt', (await r.frame.textContent('#like')).trim(), '4');
  chk('lucide-Icon ist ein echtes SVG', await r.frame.evaluate(() => document.querySelector('#like svg')?.tagName.toLowerCase()), 'svg');
  chk('cn() und Card-Klassen', await r.frame.evaluate(() => document.querySelector('.liked')?.className.includes('rounded-xl')), true);
  await r.frame.click('#tb');
  chk('Tabs wechseln', [await r.frame.$('#pa') === null, await r.frame.textContent('#pb')], [true, 'Inhalt B']);
  chk('Nur eine React-Instanz (kein Hook-Fehler)', await errText(r.frame), '');

  // 3) Syntaxfehler: klare Meldung mit Datei + Zeile, an Coden gemeldet
  r = await run(artifactPage(`<div id="root"></div>${Modules.reactArtifact(`export default function App() {
  const x = ;
  return <div>kaputt</div>;
}`)}`), '[data-coden-error]');
  const e3 = await errText(r.frame);
  chk('Syntaxfehler zeigt Datei und Zeile', [/App\.tsx/.test(e3), /\(2:/.test(e3)], [true, true]);
  chk('Syntaxfehler geht an Coden (Reparieren)', r.msgs.some(m => m && m.codenArtifactError && /App\.tsx/.test(m.codenArtifactError)), true);

  // 4) Laufzeitfehler beim Rendern
  r = await run(artifactPage(`<div id="root"></div>${Modules.reactArtifact(`export default function App() { const a = undefined; return <div>{a.b}</div>; }`)}`), '[data-coden-error]');
  chk('Laufzeitfehler sichtbar', /undefined|reading 'b'/.test(await errText(r.frame)), true);

  // 5) HTML-Artefakt mit <script type="module"> und import von three + Addon
  const html5 = artifactPage(`<div id="root"></div><canvas id="c"></canvas><script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
const scene = new THREE.Scene(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
document.getElementById('root').innerHTML = '<p id="ok">three ' + THREE.REVISION + ' ' + typeof OrbitControls + ' ' + scene.children.length + '</p>';
</script>`);
  r = await run(Modules.bundlePage(html5, {}, { report: 'artifact' }).html, '#ok');
  chk('HTML-Modul mit three + Addon', await r.frame.textContent('#ok').catch(() => null), 'three 149 function 1');

  // 6) Import-Map in der Seite wird beachtet
  const html6 = artifactPage(`<div id="root"></div><script type="importmap">{"imports":{"lib":"https://esm.sh/react@18.3.1"}}</script><script type="module">import { version } from 'lib'; document.getElementById('root').innerHTML = '<p id="v">' + version + '</p>';</script>`);
  r = await run(Modules.bundlePage(html6, {}, { report: 'artifact' }).html, '#v');
  chk('Import-Map aus der Seite', /^18\./.test(await r.frame.textContent('#v').catch(() => '')), true);

  // 7) App im Builder: mehrere Dateien, TypeScript, JSON, CSS, Unterordner, klassisches Kit-Skript davor
  const app = {
    'index.html': '<!doctype html><html><head><title>App</title><link rel="stylesheet" href="style.css"></head><body><div id="out"></div><script src="old.js"></script><script type="module" src="src/main.ts"></script></body></html>',
    'style.css': 'body{margin:0}',
    'old.js': 'window.CLASSIC = 41;',
    'src/main.ts': "import { add } from './lib/math';\nimport daten from '../daten.json';\nimport './theme.css';\nconst out = document.getElementById('out') as HTMLElement;\nout.innerHTML = `<p id=\"r\">${add((window as any).CLASSIC, 1)} ${daten.name}</p>`;",
    'src/lib/math.ts': 'export const add = (a: number, b: number): number => a + b;',
    'src/theme.css': '#r{color:rgb(1, 2, 3)}',
    'daten.json': '{"name":"Coden"}'
  };
  let built = Bundle.build(app, {}).pages['index.html'];
  r = await run(built, '#r');
  chk('App: Module, TS, JSON, CSS-Import', await r.frame.textContent('#r').catch(() => null), '42 Coden');
  chk('App: CSS aus import wirkt', await r.frame.evaluate(() => getComputedStyle(document.getElementById('r')).color).catch(() => null), 'rgb(1, 2, 3)');

  // 8) App: fehlende Datei -> Meldung im Builder-Format
  built = Bundle.build({ 'index.html': '<body><script type="module">import { x } from "./fehlt.js"; console.log(x);</script></body>' }, {}).pages['index.html'];
  r = await run(built, '[data-coden-error]');
  chk('App: fehlende Datei wird gemeldet', r.msgs.some(m => m && m.__coden === 1 && m.t === 'error' && /fehlt\.js" gibt es nicht/.test(m.message)), true);

  // 9) Spiele: Coden.three (klassisches window.THREE) + import from 'three' = dieselben Klassen
  built = Bundle.build({ 'index.html': '<body><script>window.THREE = { REVISION: "149", Vector3: function V(){ this.x = 7; } };</script><div id="g"></div><script type="module" src="game.js"></script></body>', 'game.js': "import { Vector3 } from 'three';\nimport * as T from 'three';\ndocument.getElementById('g').innerHTML = '<p id=\"s\">' + (Vector3 === window.THREE.Vector3) + ' ' + new T.Vector3().x + '</p>';" }, {}).pages['index.html'];
  r = await run(built, '#s');
  chk('Spiele: import "three" nutzt das Kit-THREE', await r.frame.textContent('#s').catch(() => null), 'true 7');

  // 10) React-App im Builder (JSX in .jsx-Datei, mehrere Komponenten)
  built = Bundle.build({ 'index.html': '<body><div id="root"></div><script type="module" src="main.jsx"></script></body>', 'main.jsx': "import { createRoot } from 'react-dom/client';\nimport Liste from './Liste.jsx';\ncreateRoot(document.getElementById('root')).render(<Liste items={['a','b','c']} />);", 'Liste.jsx': "export default function Liste({ items }) { return <ul id=\"l\">{items.map(i => <li key={i}>{i}</li>)}</ul>; }" }, {}).pages['index.html'];
  r = await run(built, '#l li');
  const li = await r.frame.evaluate(() => document.querySelectorAll('#l li').length).catch((e) => 'Fehler: ' + e.message);
  if (li !== 3) console.log('   Debug:', await errText(r.frame).catch(e => e.message), JSON.stringify(r.msgs).slice(0, 300), await r.frame.evaluate(() => document.body.innerHTML.slice(0, 200)).catch(e => e.message));
  chk('App: React mit mehreren .jsx-Dateien', li, 3);

  // 11) Ohne Module bleibt eine App unverändert (kein Bundler, kein Babel)
  built = Bundle.build({ 'index.html': '<body><p id="p">x</p><script>document.getElementById("p").textContent = "klassisch"</script></body>' }, {}).pages['index.html'];
  chk('Klassische App ohne Bundler', built.includes('data-coden="modules"'), false);
  r = await run(built, null);
  chk('Klassische App läuft', await r.frame.textContent('#p'), 'klassisch');

  // 12) Echte Chat-Integration: previewDoc() aus js/artifacts.js (mit echter CSP und SHIM), Repo über http://coden.test/
  const STUBS = { '/js/backend.js': 'export const apiJson = async () => ({});', '/js/toast.js': 'export const toast = () => {};', '/js/apps/dialogs.js': 'export const confirmBox = async () => true;' };
  await ctx.route('http://coden.test/**', (rt) => {
    const p = new URL(rt.request().url()).pathname;
    if (STUBS[p]) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[p] });
    const f = path.join(root, p === '/' ? 'test/browser/blank.html' : p);
    if (!fs.existsSync(f)) return rt.fulfill({ status: p === '/' ? 200 : 404, contentType: 'text/html', body: '<!doctype html><title>t</title>' });
    return rt.fulfill({ status: 200, contentType: /\.js$/.test(p) ? 'text/javascript' : 'text/html', body: fs.readFileSync(f, 'utf8') });
  });
  await page.goto('http://coden.test/');
  await page.addScriptTag({ url: 'http://coden.test/shared/vendor/es-module-lexer.js' });
  await page.addScriptTag({ url: 'http://coden.test/shared/coden-modules.js' });
  const docFor = async (item) => page.evaluate(async (it) => (await import('http://coden.test/js/artifacts.js')).previewDoc(it), item);
  async function runDoc(doc, waitFor) {
    await page.evaluate((d) => { document.body.innerHTML = '<iframe id="f" sandbox="allow-scripts allow-modals allow-forms allow-pointer-lock" style="width:800px;height:600px"></iframe>'; window.msgs = []; window.onmessage = (e) => window.msgs.push(e.data); document.getElementById('f').srcdoc = d; }, doc);
    const frame = await (await page.waitForSelector('#f')).contentFrame();
    try { await frame.waitForSelector(waitFor, { timeout: 15000 }); } catch (_) { /* geprüft im Test */ }
    return { frame, msgs: await page.evaluate(() => window.msgs) };
  }
  r = await runDoc(await docFor({ type: 'react', title: 'T', body: "import { Sun } from 'lucide-react';\nexport default function App() { const [d, setD] = useState(false); return <div id=\"w\" onClick={() => setD(!d)}><Sun /> {d ? 'dunkel' : 'hell'}</div>; }", closed: true }), '#w svg');
  await r.frame.click('#w');
  chk('Chat: React-Artefakt mit Icon läuft (echte CSP)', (await r.frame.textContent('#w').catch(() => '')).trim(), 'dunkel');
  r = await runDoc(await docFor({ type: 'react', title: 'T', body: 'export default function App() { return <div>{undefinedThing.x}</div>; }', closed: true }), '[data-coden-error]');
  chk('Chat: Laufzeitfehler geht an „Reparieren“', r.msgs.some(m => m && /undefinedThing/.test(m.codenArtifactError || '')), true);
  r = await runDoc(await docFor({ type: 'html', title: 'H', body: '<!doctype html><html><head><title>x</title></head><body><p id="o">…</p><script type="module">import * as THREE from "three"; document.getElementById("o").textContent = "rev " + THREE.REVISION; localStorage.setItem("a", "1");</script></body></html>', closed: true }), 'body');
  await r.frame.waitForFunction(() => /rev/.test(document.getElementById('o').textContent), null, { timeout: 15000 }).catch(() => {});
  const htmlOk = await r.frame.textContent('#o');
  if (htmlOk !== 'rev 149') console.log('   Debug:', await errText(r.frame), JSON.stringify(r.msgs).slice(0, 400));
  chk('Chat: HTML-Artefakt mit import "three" (echte CSP)', htmlOk, 'rev 149');

  chk('Babel nur einmal pro Seite, esm.sh mit festen React-Versionen', esmRequests.filter(u => /^\/react@18\.3\.1(\?|$)/.test(u)).length > 0, true);

  await browser.close();
  console.log(`\n${pass}/${pass + fail} bestanden`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
