// Baut aus den Dateien einer App (index.html, style.css, app.js, …) fertige, eigenständige HTML-Seiten.
// Läuft im Browser (window.CodenBundle, für die Live-Vorschau) und im Backend (require, für die veröffentlichte App).
// Die Seiten laufen später in einem iframe mit sandbox OHNE allow-same-origin: kein Zugriff auf Coden, Login oder Daten.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api; else root.CodenBundle = api;
})(typeof self !== 'undefined' ? self : this, function () {
    const STORE_MARK = '{/*__CODEN_STORE__*/}';
    const MAX_DATA = 400000; // eingebettete Datendateien (json, csv, …) für fetch('daten.json')
    const ICONS_HREF = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400,0..1,0&display=block';

    // Läuft als erstes Skript in jeder Seite: Speicher-Brücke, Fehler/Konsole an Coden, Links zwischen Seiten, lokale Dateien für fetch
    const SHIM = function (SNAP, FILES, PAGE) {
        var P = window.parent !== window ? window.parent : null, sent = 0;
        function send(m) { try { if (P && sent < 400) { sent++; m.__coden = 1; P.postMessage(m, '*'); } } catch (e) {} }
        function mk(persist) {
            var d = {}; if (persist) for (var k in SNAP) d[k] = String(SNAP[k]);
            return { getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
                setItem: function (k, v) { k = String(k); v = String(v); d[k] = v; if (persist) send({ t: 'store', k: k, v: v }); },
                removeItem: function (k) { k = String(k); delete d[k]; if (persist) send({ t: 'store', k: k, v: null }); },
                clear: function () { d = {}; if (persist) send({ t: 'store-clear' }); },
                key: function (i) { return Object.keys(d)[i] || null; }, get length() { return Object.keys(d).length; } };
        }
        var ok = true; try { window.localStorage.getItem('x'); } catch (e) { ok = false; }
        if (!ok) { try { Object.defineProperty(window, 'localStorage', { value: mk(true), configurable: true }); Object.defineProperty(window, 'sessionStorage', { value: mk(false), configurable: true }); } catch (e) {} }
        try { void document.cookie; } catch (e) { var jar = {}; try { Object.defineProperty(document, 'cookie', { configurable: true, get: function () { return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; '); }, set: function (v) { var p = String(v).split(';')[0].split('='); if (p[0]) jar[p[0].trim()] = (p[1] || '').trim(); } }); } catch (_) {} }
        window.addEventListener('error', function (e) {
            if (e && e.target && e.target !== window && e.target.tagName) {
                var tag = String(e.target.tagName).toLowerCase();
                var src = e.target.getAttribute && (e.target.getAttribute('src') || e.target.getAttribute('href') || '');
                if ((tag === 'img' || tag === 'script') && src && !/^https?:\/\//i.test(src)) {
                    send({ t: 'error', message: '<' + tag + '> konnte nicht geladen werden: ' + src });
                }
                return;
            }
            send({ t: 'error', message: String(e.message || 'Fehler'), line: e.lineno || 0, col: e.colno || 0 });
        }, true);
        window.addEventListener('unhandledrejection', function (e) { var r = e.reason; send({ t: 'error', message: 'Promise: ' + String((r && (r.message || r)) || 'abgelehnt') }); });
        ['log', 'info', 'warn', 'error'].forEach(function (lv) {
            var orig = console[lv]; console[lv] = function () {
                try { send({ t: 'console', level: lv, text: Array.prototype.map.call(arguments, function (a) { try { return typeof a === 'string' ? a : (a instanceof Error ? a.message : JSON.stringify(a)); } catch (e) { return String(a); } }).join(' ').slice(0, 600) }); } catch (e) {}
                return orig.apply(console, arguments);
            };
        });
        // fetch('daten.json') auf eingebettete Projektdateien umleiten
        var of = window.fetch;
        function local(u) { if (typeof u !== 'string' || /^[a-z]+:|^\/\//i.test(u)) return null; var n = u.replace(/^\.?\//, '').split(/[?#]/)[0]; return Object.prototype.hasOwnProperty.call(FILES, n) ? n : null; }
        if (of) window.fetch = function (u, o) { var n = local(typeof u === 'string' ? u : (u && u.url)); if (n) { var t = /\.json$/.test(n) ? 'application/json' : /\.svg$/.test(n) ? 'image/svg+xml' : 'text/plain'; return Promise.resolve(new Response(FILES[n], { status: 200, headers: { 'Content-Type': t } })); } return of.apply(this, arguments); };
        window.__codenNav = function (p) { send({ t: 'nav', page: String(p) }); };
        document.addEventListener('click', function (e) {
            var a = e.target && e.target.closest && e.target.closest('a[href]'); if (!a || e.defaultPrevented) return;
            var h = a.getAttribute('href') || ''; if (a.target === '_blank' || /^(#|[a-z]+:|\/\/)/i.test(h)) return;
            var page = h.replace(/^\.?\//, '').split('#')[0].split('?')[0] || 'index.html';
            if (/\.html?$/i.test(page) || h === '/' || h === './') { e.preventDefault(); send({ t: 'nav', page: page, hash: h.split('#')[1] || '' }); }
        }, true);
        window.addEventListener('load', function () { send({ t: 'ready', page: PAGE, title: document.title }); });
    };

    const norm = (p) => String(p || '').trim().replace(/^\.?\//, '').replace(/^\/+/, '').split(/[?#]/)[0];
    const escInline = (s, tag) => String(s).replace(new RegExp('</' + tag, 'gi'), '<\\/' + tag);
    const svgData = (s) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const attr = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null; };
    const hasAttr = (tag, name) => new RegExp('\\s' + name + '(\\s|=|>|/)', 'i').test(tag);

    function build(files, opts = {}) {
        files = files || {}; const kit = opts.kit || { css: '', js: '' };
        const has = (p) => Object.prototype.hasOwnProperty.call(files, p);
        const pages = Object.keys(files).filter(p => /\.html?$/i.test(p)).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
        const entry = pages.includes('index.html') ? 'index.html' : (pages[0] || 'index.html');
        const data = {}; let dataSize = 0;
        for (const p of Object.keys(files)) if (/\.(json|txt|md|csv|svg|xml|tsv)$/i.test(p) && dataSize + files[p].length <= MAX_DATA) { data[p] = files[p]; dataSize += files[p].length; }
        const svgUrl = (ref) => { const n = norm(ref); return /\.svg$/i.test(n) && has(n) ? svgData(files[n]) : null; };
        const fixCssUrls = (css) => String(css).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => { const d = svgUrl(u); return d ? `url("${d}")` : m; });
        const theme = opts.themeCss || ''; const fonts = opts.fontsHref || null;
        const out = {};
        const list = pages.length ? pages : ['index.html'];
        for (const page of list) {
            let html = pages.length ? String(files[page]) : '<!doctype html><html><head><title>Neue App</title></head><body><p style="font:16px system-ui;padding:24px">Noch keine index.html.</p></body></html>';
            const moved = [];
            let hasKitCss = false, hasKitJs = false;
            // Stylesheets einbetten
            html = html.replace(/<link\b[^>]*>/gi, (tag) => {
                const rel = (attr(tag, 'rel') || '').toLowerCase(); const href = norm(attr(tag, 'href'));
                if (rel.includes('stylesheet')) {
                    if (/(^|\/)coden-kit\.css$/.test(href)) { hasKitCss = true; return `<style data-src="coden-kit.css">${escInline(kit.css, 'style')}</style>`; }
                    if (has(href)) return `<style data-src="${esc(href)}">${escInline(fixCssUrls(files[href]), 'style')}</style>`;
                }
                if (rel.includes('icon') && svgUrl(href)) return tag.replace(attr(tag, 'href'), () => svgUrl(href));
                return tag;
            });
            // Skripte einbetten; defer/async/module wandern ans Ende (Inline-Skripte kennen kein defer)
            html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrs, body) => {
                const src = attr('<s ' + attrs + '>', 'src'); if (src == null) return m;
                const n = norm(src); let code = null;
                if (/(^|\/)coden-kit\.js$/.test(n)) { hasKitJs = true; code = kit.js; } else if (has(n)) code = files[n];
                if (code == null) return m;
                const rest = attrs.replace(/\s(src|defer|async)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
                const tag = `<script${rest} data-src="${esc(n)}">${escInline(code, 'script')}\n</script>`;
                if (hasAttr('<s ' + attrs + '>', 'defer') || hasAttr('<s ' + attrs + '>', 'async') || /type\s*=\s*["']?module/i.test(attrs)) { moved.push(tag); return ''; }
                return tag;
            });
            // Lokale SVG-Bilder als data-URL
            html = html.replace(/(\s(?:src|poster)\s*=\s*)(["'])([^"']+)\2/gi, (m, pre, q, u) => { const d = svgUrl(u); return d ? `${pre}${q}${d}${q}` : m; });
            html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, a, css) => `<style${a}>${fixCssUrls(css)}</style>`);
            if (moved.length) html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => moved.join('\n') + '\n</body>') : html + moved.join('\n');
            // Kopf ergänzen
            const shim = `<script data-coden="runtime">(${SHIM.toString()})(${STORE_MARK},${JSON.stringify(data).replace(/</g, '\\u003c')},${JSON.stringify(page)});</script>`;
            const usesIcons = /class\s*=\s*["'][^"']*\bms\b/.test(html);
            let head = shim;
            if (!/<meta[^>]+charset/i.test(html)) head = '<meta charset="utf-8">' + head;
            if (!/<meta[^>]+name\s*=\s*["']?viewport/i.test(html)) head += '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
            if (!hasKitCss && kit.css) head += `<style data-src="coden-kit.css">${escInline(kit.css, 'style')}</style>`;
            if (fonts) head += `<link rel="stylesheet" href="${esc(fonts)}">`;
            if (usesIcons) head += `<link rel="stylesheet" href="${ICONS_HREF}">`;
            if (theme) head += `<style id="coden-theme">${escInline(theme, 'style')}</style>`;
            if (!hasKitJs && kit.js) {
                const kitTag = `<script data-src="coden-kit.js">${escInline(kit.js, 'script')}\n</script>`;
                if (/<body\b[^>]*>/i.test(html)) html = html.replace(/<body\b[^>]*>/i, (b) => b + kitTag);
                else head += kitTag;
            }
            if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, (h) => h + head);
            else if (/<html\b[^>]*>/i.test(html)) html = html.replace(/<html\b[^>]*>/i, (h) => h + '<head>' + head + '</head>');
            else html = '<!doctype html><html><head>' + head + '</head><body>' + html + '</body></html>';
            if (opts.platform) html = html.replace(/<html\b([^>]*)>/i, (h, a) => /data-platform/.test(a) ? h : `<html${a} data-platform="${esc(opts.platform)}">`);
            out[page] = html;
        }
        return { entry, pages: out };
    }

    // Gespeicherte Werte der App (localStorage) in die Seite einsetzen, kurz bevor sie angezeigt wird
    function withStore(html, snapshot) { return String(html).replace(STORE_MARK, () => JSON.stringify(snapshot || {}).replace(/</g, '\\u003c')); }
    function titleOf(html) { const m = String(html || '').match(/<title[^>]*>([^<]*)<\/title>/i); return m ? m[1].trim() : ''; }
    return { build, withStore, titleOf, norm };
});
