// Coden-Bundler (shared/coden-modules.js): Aufbau der Seiten ohne Browser. Der Browser-Test ist test/browser/modules.browser.js.
const path = require('path');
const M = require(path.join(__dirname, '..', 'shared/coden-modules.js'));
const Bundle = require(path.join(__dirname, '..', 'shared/app-bundle.js'));
let pass = 0, fail = 0;
const chk = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${ok ? '' : ` (bekam ${JSON.stringify(got)}, erwartet ${JSON.stringify(want)})`}`); };

// extract
let ex = M.extract('<head><script type="importmap">{"imports":{"x":"https://a/x.js"}}</script></head><body><script src="kit.js"></script><script type="module" src="./src/main.ts"></script><script type="module">import a from "./a.js"</script><script type="text/babel">const A = <b/>;</script><script src="app.tsx"></script><script type="module" src="https://cdn/x.js"></script></body>', { 'src/main.ts': '', 'app.tsx': '' });
chk('extract: Einstiege in Reihenfolge', ex.entries, ['src/main.ts', '__inline_1.js', 'app.tsx']);
chk('extract: Import-Map übernommen und entfernt', [ex.importMap, /importmap/.test(ex.html)], [{ x: 'https://a/x.js' }, false]);
chk('extract: klassisch, text/babel und externe Module bleiben', [/kit\.js/.test(ex.html), /text\/babel/.test(ex.html), /https:\/\/cdn\/x\.js/.test(ex.html)], [true, true, true]);
ex = M.extract('<script type="module" src="fehlt.js"></script>', {});
chk('extract: fehlende Datei bleibt stehen (Browser meldet 404)', ex.entries, []);
ex = M.extract('<script type="module">x()</script>', {}, 'sub/seite.html');
chk('extract: Inline-Modul in Unterordner', Object.keys(ex.virtual), ['sub/__inline_1.js']);

// bundlePage
chk('bundlePage: ohne Module unverändert', M.bundlePage('<p>hi</p><script>x()</script>').modules, false);
const bp = M.bundlePage('<body><script type="module">import * as T from "three"</script></body>', {}, { report: 'artifact' });
chk('bundlePage: Laufzeit vor </body>, kein </script> im Code', [bp.modules, /<script data-coden="modules">[\s\S]*<\/script>\n<\/body>/.test(bp.html), (bp.html.match(/<\/script>/g) || []).length], [true, true, 1]);

// fixReact
chk('fixReact: fehlende Hooks ergänzt', M.fixReact('export default function A(){ const [a] = useState(1); useEffect(() => {}, []); return null }').split('\n')[0].startsWith("import { useState, useEffect } from 'react'; "), true);
chk('fixReact: vorhandene Importe bleiben, nur fehlende dazu', M.fixReact("import { useState } from 'react';\nfunction A(){ useState(); useMemo(() => 1, []) }").split('\n')[0], "import { useMemo } from 'react'; import { useState } from 'react';");
chk('fixReact: React. ohne Import', M.fixReact('const x = React.useState(0);').startsWith("import * as React from 'react';"), true);
chk('fixReact: nichts zu tun', M.fixReact("import React, { useState } from 'react';\nexport default () => useState(1);"), "import React, { useState } from 'react';\nexport default () => useState(1);");
chk('fixReact: eigene gleichnamige Funktion nicht importieren', /import \{/.test(M.fixReact('function useState(){}; useState();')), false);

// loaderTag
const tag = M.loaderTag({ 'a.js': 'const s = "</script><script>alert(1)</script>";' }, ['a.js']);
chk('loaderTag: </script> im Code sicher eingebettet', (tag.match(/<\/script>/gi) || []).length, 1);
chk('loaderTag: shadcn nur bei Bedarf', [M.loaderTag({ 'a.js': 'x' }, ['a.js']).includes('buttonVariants'), M.loaderTag({ 'a.tsx': "import { Button } from '@/components/ui/button'" }, ['a.tsx']).includes('buttonVariants')], [false, true]);
chk('Laufzeit ist gültiges JavaScript', (() => { try { new Function('return ' + M.RUNTIME.toString()); return true; } catch (e) { return e.message; } })(), true);

// App-Bundle
const page = Bundle.build({ 'index.html': '<html><head></head><body><script type="module" src="main.js"></script></body></html>', 'main.js': 'import "./x.css"', 'x.css': 'p{}', 'bild.png': 'x' }, { kit: { css: '', js: '/*KIT*/' } }).pages['index.html'];
chk('App: Kit vor dem Bundler, Bundler mit Dateien', [page.indexOf('/*KIT*/') < page.indexOf('data-coden="modules"'), page.includes('main.js'), page.includes('bild.png')], [true, true, false]);

console.log(`\n${pass}/${pass + fail} bestanden`);
process.exit(fail ? 1 : 0);
