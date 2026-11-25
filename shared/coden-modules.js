// Coden-Bundler: echte ES-Module in Artefakten und Apps – wie ein richtiger Code-Editor, aber ganz im Browser.
// - import/export zwischen Dateien (./utils.js, ../lib/x.ts, @/components/…)
// - npm-Pakete per import (react, lucide-react, recharts, framer-motion, three, …) über esm.sh
// - TypeScript, JSX und TSX (Babel wird nur geladen, wenn eine Datei es braucht)
// - import './style.css', import daten from './daten.json'
// - shadcn/ui-Bausteine (@/components/ui/…) und cn() aus @/lib/utils als eingebaute Nachbauten
// - Fehler mit Dateiname und Zeile als Hinweis in der Seite + Meldung an Coden (Reparieren/Auto-Fix)
// Läuft im Browser (window.CodenModules) und im Backend (require) – das Backend baut nur das HTML, ausgeführt wird
// alles im iframe der App bzw. des Artefakts. Module werden als data:-URLs geladen, das klappt auch in Sandbox-iframes
// ohne eigenen Ursprung (srcdoc, sandbox ohne allow-same-origin) und in Safari.
(function (root, factory) {
    const lexer = (typeof module === 'object' && module.exports) ? require('./vendor/es-module-lexer.js') : root.CodenLexerSrc;
    const api = factory(lexer);
    if (typeof module === 'object' && module.exports) module.exports = api; else root.CodenModules = api;
})(typeof self !== 'undefined' ? self : this, function (LEXER_SRC) {
    const BABEL_URL = 'https://cdn.jsdelivr.net/npm/@babel/standalone@7.29.15/babel.min.js';
    const ESM_URL = 'https://esm.sh/';
    const TAILWIND_URL = 'https://cdn.tailwindcss.com';

    // ---------- Laufzeit (wird als Text in die Seite eingebettet) ----------
    const RUNTIME = function (FILES, ENTRIES, OPT, LEXER, UI) {
        var ESM = OPT.esm, BABEL = OPT.babel, MAP = OPT.importMap || {};
        var V = { react: '18.3.1', 'react-dom': '18.3.1' }, k;
        for (k in OPT.versions || {}) V[k] = OPT.versions[k];
        var P = window.parent !== window ? window.parent : null;
        var cache = {}, names = {}, lexer = null, babel = null, shown = 0;
        var has = function (o, p) { return Object.prototype.hasOwnProperty.call(o, p); };
        if (UI) FILES['__coden/ui.js'] = UI;
        var J = function (v) { return JSON.stringify(v); };

        function modUrl(code, name) {
            var u = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(code + '\n//# sourceURL=coden:///' + name);
            names[u] = name; return u;
        }
        function clean(t) {
            t = String(t);
            for (var u in names) if (t.indexOf(u) > -1) t = t.split(u).join(names[u]);
            return t.replace(/data:text\/javascript[^\s)'"]{30,}/g, '[Modul]').replace(/coden:\/\/\//g, '');
        }
        function show(msg) {
            if (shown++ >= 3 || OPT.overlay === false) return;
            var d = document.createElement('div'); d.setAttribute('data-coden-error', '');
            d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;max-height:45vh;overflow:auto;padding:12px 14px;border-radius:12px;background:#fff1f0;color:#a8071a;border:1px solid #ffa39e;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;box-shadow:0 8px 30px rgba(0,0,0,.18);cursor:pointer';
            d.title = 'Antippen zum Schließen'; d.textContent = '⚠ ' + msg; d.onclick = function () { d.remove(); };
            (document.body || document.documentElement).appendChild(d);
        }
        function report(e) {
            var msg = clean(e && e.message ? e.message : e);
            show(msg);
            try { if (P) P.postMessage(OPT.report === 'app' ? { __coden: 1, t: 'error', message: msg } : { codenArtifactError: msg }, '*'); } catch (x) { /* ignorieren */ }
            try { console.error('[Coden] ' + msg); } catch (x) { /* ignorieren */ }
        }
        // Laufzeitfehler später (Klick-Handler usw.): nur anzeigen, gemeldet werden sie schon von Coden
        window.addEventListener('error', function (e) { if (e && e.message && !(e.target && e.target !== window)) show(clean(e.message) + (e.lineno ? ' (Zeile ' + e.lineno + ')' : '')); });
        window.addEventListener('unhandledrejection', function (e) { var r = e.reason; show('Promise: ' + clean((r && (r.message || r)) || 'abgelehnt')); });

        function dirOf(p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); }
        function join(base, rel) {
            var parts = (rel.charAt(0) === '/' ? '' : base).split('/').concat(rel.split('/')), out = [];
            for (var i = 0; i < parts.length; i++) { var s = parts[i]; if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
            return out.join('/');
        }
        var EXTS = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json', '.css', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];
        function findLocal(p) { for (var i = 0; i < EXTS.length; i++) if (has(FILES, p + EXTS[i])) return p + EXTS[i]; return null; }
        function pkgOf(s) { var a = s.split('/'); return s.charAt(0) === '@' ? a.slice(0, 2).join('/') : a[0]; }
        function esm(spec) {
            if (has(MAP, spec)) return MAP[spec];
            for (var key in MAP) if (key.slice(-1) === '/' && spec.indexOf(key) === 0) return MAP[key] + spec.slice(key.length);
            spec = spec.replace(/^npm:/, '');
            var name = pkgOf(spec), rest = spec.slice(name.length), ver = /@/.test(name.slice(1)) ? '' : V[name];
            if (name === 'three' && !ver && window.THREE && window.THREE.REVISION) ver = '0.' + parseInt(window.THREE.REVISION, 10) + '.0';
            var q = name === 'react' ? '' : (name === 'react-dom' ? '?deps=react@' + V.react : '?deps=react@' + V.react + ',react-dom@' + V['react-dom']);
            return ESM + name + (ver ? '@' + ver : '') + rest + q;
        }
        function loadScript(src, tries) {
            return new Promise(function (res, rej) {
                var s = document.createElement('script'); s.src = src; s.onload = res;
                s.onerror = function () { s.remove(); rej(new Error(src + ' konnte nicht geladen werden (Internet?)')); };
                document.head.appendChild(s);
            }).catch(function (e) { // kurzer Netz-Aussetzer: einmal nachladen
                if ((tries || 0) >= 1) throw e;
                return new Promise(function (r) { setTimeout(r, 700); }).then(function () { return loadScript(src, (tries || 0) + 1); });
            });
        }
        function getBabel() {
            if (window.Babel && window.Babel.transform) return Promise.resolve(window.Babel);
            return babel || (babel = loadScript(BABEL).then(function () { return window.Babel; }, function (e) { babel = null; throw e; }));
        }
        function getLexer() { return lexer || (lexer = import(modUrl(LEXER, 'es-module-lexer.js'))); }
        // .js mit JSX nur, wenn React importiert wird (sonst stecken "<div>" meist nur in Template-Strings)
        var JSXISH = /<\/[A-Za-z][\w.:-]*\s*>|<[A-Z][\w.]*[\s/>]|<>/;
        function needsBabel(path, code) {
            if (/\.(jsx|tsx|ts|mts|cts)$/i.test(path)) return true;
            return /\.m?js$/i.test(path) && /from\s*['"](react|preact)['"]/.test(code) && JSXISH.test(code);
        }
        function transform(path, code) {
            return getBabel().then(function (B) {
                var presets = [];
                if (/\.(tsx?|mts|cts)$/i.test(path)) presets.push(['typescript', { isTSX: /\.tsx$/i.test(path), allExtensions: true, onlyRemoveTypeImports: true }]);
                presets.push(['react', { runtime: 'automatic' }]);
                try { return B.transform(code, { filename: path, presets: presets, sourceType: 'module', retainLines: true, compact: false }).code; }
                catch (e) { throw new Error(String(e.message || e).replace(/^\/?/, '')); }
            });
        }
        function names_(stmt) {
            var m = /\{([\s\S]*?)\}/.exec(stmt || ''); if (!m) return [];
            return m[1].split(',').map(function (s) { return s.trim().split(/\s+as\s+/)[0].trim(); }).filter(function (s) { return /^[A-Za-z_$][\w$]*$/.test(s) && s !== 'default'; });
        }
        function uiModule(file, stmt, stack) {
            return load('__coden/ui.js', stack).then(function (u) {
                var code = 'import * as U from ' + J(u) + ';\n', list = names_(stmt);
                list.forEach(function (n) { code += 'export const ' + n + ' = U.' + n + ' || U.generic(' + J(n) + ');\n'; });
                var base = file.split('/').pop().replace(/(^|-)(\w)/g, function (a, b, c) { return c.toUpperCase(); });
                code += 'export default U.' + base + ' || U.generic(' + J(base) + ');\n';
                return modUrl(code, '@/components/ui/' + file);
            });
        }
        var RESERVED = /^(do|if|in|for|let|new|try|var|case|else|enum|eval|null|this|true|void|with|await|break|catch|class|const|false|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$/;
        function globalShim(obj, name) {
            var code = 'const T = window.' + name + ';\nexport default T;\n';
            Object.keys(obj).forEach(function (n) { if (/^[A-Za-z_$][\w$]*$/.test(n) && !RESERVED.test(n)) code += 'export const ' + n + ' = T.' + n + ';\n'; });
            return modUrl(code, name.toLowerCase() + ' (global)');
        }
        function resolve(spec, from, stack, stmt) {
            if (/^(https?:|data:|blob:)/i.test(spec)) return spec;
            if (spec.indexOf('//') === 0) return 'https:' + spec;
            var local = null;
            if (spec.charAt(0) === '.' || spec.charAt(0) === '/') local = findLocal(join(dirOf(from), spec));
            else if (/^[@~]\//.test(spec)) {
                var r = spec.slice(2);
                local = findLocal(r) || findLocal('src/' + r);
                if (!local && UI && /^components\/ui\//.test(r)) return uiModule(r.slice(14), stmt, stack);
                if (!local && UI && /^lib\/utils$/.test(r)) return load('__coden/ui.js', stack);
            }
            if (local) return load(local, stack);
            if (spec.charAt(0) === '.' || spec.charAt(0) === '/' || /^[@~]\//.test(spec)) throw new Error(from + ': Die Datei "' + spec + '" gibt es nicht.');
            if (spec === 'three' && window.THREE && !has(MAP, spec)) return globalShim(window.THREE, 'THREE');
            return esm(spec);
        }
        function rewrite(code, from, stack) {
            return getLexer().then(function (L) {
                var imps;
                try { imps = L.parse(code, from)[0]; } catch (e) { throw new Error(from + ': Syntaxfehler – ' + e.message); }
                return Promise.all(imps.map(function (im) {
                    if (im.d === -2 || im.n == null) return null; // import.meta oder import(variable)
                    return Promise.resolve().then(function () { return resolve(im.n, from, stack, code.slice(im.ss, im.se)); });
                })).then(function (res) {
                    var out = code;
                    for (var i = imps.length - 1; i >= 0; i--) {
                        var im = imps[i], u = res[i]; if (u == null) continue;
                        out = out.slice(0, im.s) + (im.d > -1 ? J(u) : u) + out.slice(im.e);
                    }
                    return out;
                });
            });
        }
        function load(path, stack) {
            if (stack.indexOf(path) > -1) return Promise.reject(new Error('Zirkulärer Import: ' + stack.concat(path).join(' → ')));
            if (cache[path]) return cache[path];
            var src = String(FILES[path]), next = stack.concat(path), p;
            if (/\.css$/i.test(path)) p = Promise.resolve(modUrl('const s = document.createElement("style"); s.setAttribute("data-src", ' + J(path) + '); s.textContent = ' + J(src) + '; document.head.appendChild(s);\nexport default ' + J(src) + ';', path));
            else if (/\.json$/i.test(path)) p = Promise.resolve().then(function () { try { JSON.parse(src); } catch (e) { throw new Error(path + ': kein gültiges JSON – ' + e.message); } return modUrl('export default ' + src + ';', path); });
            else if (/\.(svg|txt|md|csv|html?|xml)$/i.test(path)) p = Promise.resolve(modUrl('export default ' + J(src) + ';', path));
            else p = (needsBabel(path, src) ? transform(path, src) : Promise.resolve(src))
                .then(function (code) { return rewrite(code, path, next); })
                .then(function (code) { return modUrl(code, path); });
            return (cache[path] = p);
        }
        function autoRender(mod) {
            var root = document.getElementById('root'); if (!root || root.childNodes.length) return;
            var C = mod.default || mod.App, n;
            if (!C) for (n in mod) if (typeof mod[n] === 'function' && /^[A-Z]/.test(n)) { C = mod[n]; break; }
            if (!C) return;
            return Promise.all([import(esm('react')), import(esm('react-dom/client'))]).then(function (m) {
                var R = m[0].createElement ? m[0] : m[0].default, D = m[1].createRoot ? m[1] : m[1].default;
                if (!root.childNodes.length) D.createRoot(root).render(R.createElement(C));
            });
        }
        function run() {
            var chain = UI && OPT.tailwind !== false && !window.tailwind ? loadScript(OPT.tailwindUrl).catch(function () {}) : Promise.resolve();
            ENTRIES.forEach(function (e) {
                chain = chain.then(function () { return load(e, []); })
                    .then(function (u) { return import(u); })
                    .then(function (mod) { if (OPT.autoRender) return autoRender(mod); })
                    .catch(report);
            });
            window.__codenModules = chain.then(function () { return { files: Object.keys(cache) }; });
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
    };

    // ---------- Eingebaute shadcn/ui-Nachbauten (Tailwind-Klassen, ohne Radix) ----------
    const UI_SRC = `import * as React from "react";
const h = React.createElement;
export function cn(...a) { const out = []; const add = (v) => { if (!v) return; if (typeof v === "string" || typeof v === "number") out.push(String(v)); else if (Array.isArray(v)) v.forEach(add); else if (typeof v === "object") for (const k in v) if (v[k]) out.push(k); }; a.forEach(add); return out.join(" "); }
const mk = (tag, base, name) => { const C = React.forwardRef(({ className, asChild, children, ...p }, ref) => asChild && React.isValidElement(children) ? React.cloneElement(children, { ...p, ref, className: cn(base, className, children.props.className) }) : h(tag, { ...p, ref, className: cn(base, className) }, children)); C.displayName = name; return C; };
const BV = { default: "bg-slate-900 text-white hover:bg-slate-800", destructive: "bg-red-600 text-white hover:bg-red-700", outline: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-100", secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200", ghost: "text-slate-900 hover:bg-slate-100", link: "text-slate-900 underline-offset-4 hover:underline" };
const BS = { default: "h-10 px-4 py-2", sm: "h-9 rounded-md px-3", lg: "h-11 rounded-md px-8", icon: "h-10 w-10" };
export const buttonVariants = ({ variant = "default", size = "default", className } = {}) => cn("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:pointer-events-none disabled:opacity-50", BV[variant] || BV.default, BS[size] || BS.default, className);
export const Button = React.forwardRef(({ className, variant, size, asChild, children, ...p }, ref) => { const cls = buttonVariants({ variant, size, className }); return asChild && React.isValidElement(children) ? React.cloneElement(children, { ...p, ref, className: cn(cls, children.props.className) }) : h("button", { ...p, ref, className: cls }, children); });
export const Card = mk("div", "rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm", "Card");
export const CardHeader = mk("div", "flex flex-col space-y-1.5 p-6", "CardHeader");
export const CardTitle = mk("h3", "text-2xl font-semibold leading-none tracking-tight", "CardTitle");
export const CardDescription = mk("p", "text-sm text-slate-500", "CardDescription");
export const CardContent = mk("div", "p-6 pt-0", "CardContent");
export const CardFooter = mk("div", "flex items-center p-6 pt-0", "CardFooter");
export const Input = mk("input", "flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50", "Input");
export const Textarea = mk("textarea", "flex min-h-[80px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400", "Textarea");
export const Label = mk("label", "text-sm font-medium leading-none", "Label");
const BADGE = { default: "bg-slate-900 text-white", secondary: "bg-slate-100 text-slate-900", destructive: "bg-red-600 text-white", outline: "border border-slate-300 text-slate-900" };
export const Badge = ({ className, variant = "default", ...p }) => h("span", { ...p, className: cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", BADGE[variant] || BADGE.default, className) });
export const Alert = ({ className, variant, ...p }) => h("div", { role: "alert", ...p, className: cn("relative w-full rounded-lg border p-4", variant === "destructive" ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 bg-white", className) });
export const AlertTitle = mk("h5", "mb-1 font-medium leading-none tracking-tight", "AlertTitle");
export const AlertDescription = mk("div", "text-sm opacity-90", "AlertDescription");
export const Separator = ({ className, orientation = "horizontal", ...p }) => h("div", { role: "separator", ...p, className: cn("shrink-0 bg-slate-200", orientation === "vertical" ? "h-full w-px" : "h-px w-full", className) });
export const Progress = ({ className, value = 0, ...p }) => h("div", { ...p, className: cn("relative h-4 w-full overflow-hidden rounded-full bg-slate-200", className) }, h("div", { className: "h-full bg-slate-900 transition-all", style: { width: Math.max(0, Math.min(100, Number(value) || 0)) + "%" } }));
export const Switch = ({ className, checked, defaultChecked, onCheckedChange, disabled, ...p }) => { const [on, setOn] = React.useState(!!defaultChecked); const v = checked !== undefined ? !!checked : on; return h("button", { type: "button", role: "switch", "aria-checked": v, disabled, ...p, onClick: () => { setOn(!v); onCheckedChange && onCheckedChange(!v); }, className: cn("inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", v ? "bg-slate-900" : "bg-slate-300", className) }, h("span", { className: cn("block h-5 w-5 rounded-full bg-white shadow transition-transform", v ? "translate-x-5" : "translate-x-0.5") })); };
export const Checkbox = ({ className, onCheckedChange, ...p }) => h("input", { type: "checkbox", ...p, onChange: (e) => { onCheckedChange && onCheckedChange(e.target.checked); p.onChange && p.onChange(e); }, className: cn("h-4 w-4 rounded border-slate-300 accent-slate-900", className) });
export const Slider = ({ className, value, defaultValue, min = 0, max = 100, step = 1, onValueChange, onValueCommit, ...p }) => h("input", { type: "range", min, max, step, ...p, value: value ? value[0] : undefined, defaultValue: defaultValue ? defaultValue[0] : undefined, onChange: (e) => onValueChange && onValueChange([Number(e.target.value)]), onPointerUp: (e) => onValueCommit && onValueCommit([Number(e.target.value)]), className: cn("w-full accent-slate-900", className) });
const TabsCtx = React.createContext({});
export const Tabs = ({ value, defaultValue, onValueChange, className, children, ...p }) => { const [v, setV] = React.useState(defaultValue); const cur = value !== undefined ? value : v; return h(TabsCtx.Provider, { value: { v: cur, set: (x) => { setV(x); onValueChange && onValueChange(x); } } }, h("div", { ...p, className }, children)); };
export const TabsList = mk("div", "inline-flex h-10 items-center justify-center rounded-md bg-slate-100 p-1 text-slate-500", "TabsList");
export const TabsTrigger = ({ value, className, ...p }) => { const c = React.useContext(TabsCtx); const on = c.v === value; return h("button", { type: "button", role: "tab", "aria-selected": on, ...p, onClick: () => c.set && c.set(value), className: cn("inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all", on ? "bg-white text-slate-950 shadow-sm" : "", className) }); };
export const TabsContent = ({ value, className, ...p }) => { const c = React.useContext(TabsCtx); return c.v === value ? h("div", { role: "tabpanel", ...p, className: cn("mt-2", className) }) : null; };
const SelCtx = React.createContext({ labels: {} });
export const Select = ({ value, defaultValue, onValueChange, children }) => { const [v, setV] = React.useState(defaultValue); const [open, setOpen] = React.useState(false); const [labels, setLabels] = React.useState({}); const cur = value !== undefined ? value : v; return h(SelCtx.Provider, { value: { v: cur, open, setOpen, labels, setLabel: (k, t) => setLabels((l) => (l[k] === t ? l : { ...l, [k]: t })), set: (x) => { setV(x); setOpen(false); onValueChange && onValueChange(x); } } }, h("div", { className: "relative w-full" }, children)); };
export const SelectTrigger = ({ className, children, ...p }) => { const c = React.useContext(SelCtx); return h("button", { type: "button", ...p, onClick: () => c.setOpen(!c.open), className: cn("flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-sm", className) }, children, h("span", { className: "ml-2 opacity-50" }, "▾")); };
export const SelectValue = ({ placeholder }) => { const c = React.useContext(SelCtx); return h("span", null, c.v != null && c.v !== "" ? (c.labels[c.v] || String(c.v)) : (placeholder || "")); };
export const SelectContent = ({ className, children, ...p }) => { const c = React.useContext(SelCtx); return h("div", { ...p, style: { display: c.open ? "block" : "none" }, className: cn("absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-md", className) }, children); };
export const SelectItem = ({ value, className, children, ...p }) => { const c = React.useContext(SelCtx); const label = typeof children === "string" || typeof children === "number" ? String(children) : String(value); React.useEffect(() => { c.setLabel && c.setLabel(value, label); }, [value, label]); return h("div", { role: "option", "aria-selected": c.v === value, ...p, onClick: () => c.set(value), className: cn("cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-slate-100", c.v === value ? "font-medium" : "", className) }, children); };
export const SelectGroup = mk("div", "", "SelectGroup");
export const SelectLabel = mk("div", "px-2 py-1.5 text-sm font-semibold", "SelectLabel");
export const Avatar = mk("span", "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", "Avatar");
export const AvatarImage = mk("img", "aspect-square h-full w-full object-cover", "AvatarImage");
export const AvatarFallback = mk("span", "flex h-full w-full items-center justify-center rounded-full bg-slate-100 text-sm", "AvatarFallback");
export const ScrollArea = mk("div", "relative overflow-auto", "ScrollArea");
const DlgCtx = React.createContext({});
export const Dialog = ({ open, defaultOpen, onOpenChange, children }) => { const [o, setO] = React.useState(!!defaultOpen); const cur = open !== undefined ? !!open : o; return h(DlgCtx.Provider, { value: { open: cur, set: (x) => { setO(x); onOpenChange && onOpenChange(x); } } }, children); };
const trig = (val) => ({ asChild, children, ...p }) => { const c = React.useContext(DlgCtx); const onClick = () => c.set && c.set(val); return asChild && React.isValidElement(children) ? React.cloneElement(children, { onClick }) : h("button", { type: "button", ...p, onClick }, children); };
export const DialogTrigger = trig(true);
export const DialogClose = trig(false);
export const DialogContent = ({ className, children, ...p }) => { const c = React.useContext(DlgCtx); if (!c.open) return null; return h("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4", onClick: () => c.set(false) }, h("div", { ...p, onClick: (e) => e.stopPropagation(), className: cn("relative w-full max-w-lg rounded-lg bg-white p-6 shadow-lg", className) }, children, h("button", { type: "button", "aria-label": "Schließen", onClick: () => c.set(false), className: "absolute right-4 top-4 opacity-60 hover:opacity-100" }, "✕"))); };
export const DialogHeader = mk("div", "flex flex-col space-y-1.5 text-center sm:text-left", "DialogHeader");
export const DialogFooter = mk("div", "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", "DialogFooter");
export const DialogTitle = mk("h2", "text-lg font-semibold", "DialogTitle");
export const DialogDescription = mk("p", "text-sm text-slate-500", "DialogDescription");
const TAGS = { Table: ["table", "w-full caption-bottom text-sm"], TableHeader: ["thead", ""], TableBody: ["tbody", ""], TableFooter: ["tfoot", "font-medium"], TableRow: ["tr", "border-b border-slate-200"], TableHead: ["th", "h-10 px-2 text-left align-middle font-medium text-slate-500"], TableCell: ["td", "p-2 align-middle"], TableCaption: ["caption", "mt-4 text-sm text-slate-500"] };
const made = {};
export function generic(name) { if (made[name]) return made[name]; const t = TAGS[name]; const tag = t ? t[0] : /Title|Heading/.test(name) ? "h3" : /Description|Text/.test(name) ? "p" : /Button|Trigger|Close|Action/.test(name) ? "button" : /Image/.test(name) ? "img" : "div"; return (made[name] = mk(tag, t ? t[1] : "", name)); }
export const Table = generic("Table"), TableHeader = generic("TableHeader"), TableBody = generic("TableBody"), TableFooter = generic("TableFooter"), TableRow = generic("TableRow"), TableHead = generic("TableHead"), TableCell = generic("TableCell"), TableCaption = generic("TableCaption");
`;

    // ---------- Aufbau ----------
    const J = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const attr = (tag, name) => { const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null; };
    const norm = (p) => String(p || '').trim().replace(/^\.?\//, '').replace(/^\/+/, '').split(/[?#]/)[0];
    const joinPath = (dir, rel) => { const out = []; for (const s of (rel.startsWith('/') ? '' : dir).split('/').concat(rel.split('/'))) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return out.join('/'); };
    const MODULE_FILE = /\.(m?js|jsx|tsx?|mts|cts|css|json|svg|txt|md|csv|xml)$/i;
    const usesUi = (files) => Object.values(files).some(s => /['"][@~]\/(components\/ui\/|lib\/utils['"])/.test(String(s)));

    // <script>-Tag mit der Laufzeit. files: { pfad: quelltext }, entries: Pfade in Ausführungsreihenfolge.
    // opt: { autoRender, report: 'app' | 'artifact', importMap, versions, tailwind, overlay }
    function loaderTag(files, entries, opt = {}) {
        const ui = usesUi(files);
        const o = { esm: ESM_URL, babel: BABEL_URL, tailwindUrl: TAILWIND_URL, ...opt };
        const code = `(${RUNTIME.toString()})(${J(files)},${J(entries)},${J(o)},${J(LEXER_SRC || '')},${J(ui ? UI_SRC : '')});`;
        return `<script data-coden="modules">${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;
    }

    // Holt Modul-Skripte aus einer HTML-Seite: <script type="module"> (inline oder lokale Datei), <script src="x.tsx|.jsx|.ts">,
    // <script type="text/jsx|text/tsx|text/typescript"> und <script type="importmap">. text/babel bleibt unangetastet
    // (das übersetzt Babel-Standalone in der Seite selbst).
    function extract(html, files, page = 'index.html') {
        const dir = page.includes('/') ? page.slice(0, page.lastIndexOf('/') + 1) : '';
        const entries = []; const virtual = {}; let importMap = null; let n = 0;
        const has = (p) => Object.prototype.hasOwnProperty.call(files || {}, p);
        const out = String(html).replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrs, body) => {
            const tag = '<s ' + attrs + '>';
            const type = (attr(tag, 'type') || '').toLowerCase().trim();
            const src = attr(tag, 'src');
            if (type === 'importmap') { try { importMap = { ...(importMap || {}), ...(JSON.parse(body).imports || {}) }; } catch (e) { /* kaputte Import-Map ignorieren */ } return ''; }
            const typed = /^text\/(jsx|tsx|typescript)$/.test(type);
            const tsSrc = !type && src != null && /\.(jsx|tsx|ts|mts)$/i.test(norm(src));
            if (type !== 'module' && !typed && !tsSrc) return m;
            if (src != null) {
                if (/^([a-z]+:)?\/\//i.test(src)) return m; // externes Modul lädt der Browser selbst
                const p = joinPath(dir, norm(src));
                if (!has(p)) return m;
                entries.push(p); return '';
            }
            if (!body.trim()) return '';
            const vp = `${dir}__inline_${++n}${type === 'text/tsx' || type === 'text/typescript' ? '.tsx' : type === 'text/jsx' ? '.jsx' : '.js'}`;
            virtual[vp] = body; entries.push(vp); return '';
        });
        return { html: out, entries, virtual, importMap };
    }

    // Komplette Seite: Modul-Skripte durch den Coden-Bundler ersetzen. Gibt das HTML unverändert zurück, wenn es keine gibt.
    function bundlePage(html, files = {}, opt = {}) {
        const page = opt.page || 'index.html';
        const ex = extract(html, files, page);
        if (!ex.entries.length) return { html: String(html), modules: false };
        const all = {};
        for (const [p, c] of Object.entries(files || {})) if (MODULE_FILE.test(p)) all[p] = String(c);
        Object.assign(all, ex.virtual);
        const tag = loaderTag(all, ex.entries, { ...opt, page: undefined, importMap: ex.importMap || undefined });
        let out = ex.html;
        out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => tag + '\n</body>') : out + tag;
        return { html: out, modules: true, entries: ex.entries };
    }

    // React-Artefakt: fehlende React-Importe ergänzen (Modelle lassen sie oft weg), dann als App.tsx laden und anzeigen
    const REACT_NAMES = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useReducer', 'useContext', 'createContext', 'useLayoutEffect', 'useId', 'useTransition', 'useDeferredValue', 'useImperativeHandle', 'useSyncExternalStore', 'Fragment', 'forwardRef', 'memo', 'lazy', 'Suspense', 'startTransition', 'createElement', 'cloneElement', 'Children', 'isValidElement'];
    function fixReact(src) {
        const code = String(src);
        const imported = new Set(); let hasReactNs = false;
        code.replace(/import\s+([\s\S]+?)\s+from\s+['"]react['"]/g, (m, what) => {
            const def = what.match(/^\s*([A-Za-z_$][\w$]*)/); if (def && def[1] !== 'type') { imported.add(def[1]); if (def[1] === 'React') hasReactNs = true; }
            const ns = what.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/); if (ns) { imported.add(ns[1]); if (ns[1] === 'React') hasReactNs = true; }
            const br = what.match(/\{([\s\S]*?)\}/); if (br) br[1].split(',').forEach(s => { const n = s.trim().split(/\s+as\s+/).pop().trim(); if (n) imported.add(n); });
            return m;
        });
        const declared = (n) => new RegExp(`(function\\s+${n}\\b|(const|let|var|class)\\s+${n}\\b|import\\s+[^;]*\\b${n}\\b[^;]*from)`).test(code);
        const missing = REACT_NAMES.filter(n => !imported.has(n) && new RegExp(`(^|[^.\\w$])${n}\\b`).test(code) && !declared(n));
        let pre = '';
        if (!hasReactNs && /(^|[^.\w$])React\./.test(code) && !declared('React')) pre += "import * as React from 'react'; ";
        if (missing.length) pre += `import { ${missing.join(', ')} } from 'react'; `;
        if (/(^|[^.\w$])ReactDOM\./.test(code) && !declared('ReactDOM')) pre += "import * as ReactDOM from 'react-dom'; ";
        // Vor den Code in dieselbe erste Zeile, damit die Zeilennummern in Fehlern stimmen
        return pre + code;
    }
    function reactArtifact(src, opt = {}) {
        return loaderTag({ 'App.tsx': fixReact(src) }, ['App.tsx'], { autoRender: true, report: 'artifact', ...opt });
    }

    return { loaderTag, extract, bundlePage, reactArtifact, fixReact, usesUi, BABEL_URL, ESM_URL, TAILWIND_URL, RUNTIME, UI_SRC };
});
