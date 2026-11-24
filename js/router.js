// js/router.js – Tabs über die Adresse (#/apps, #/artefakte, #/buddy …). Zurück-Taste und Links funktionieren dadurch.
// Der Chat ist die Startansicht; jede andere Ansicht wird in #view-host angezeigt.
const views = {};
let current = null;
let currentKey = '';
let renderSeq = 0;
let initialized = false;

const host = () => document.getElementById('view-host');
const chat = () => document.querySelector('.main-content');

function safeDecode(part) {
    try { return decodeURIComponent(part); } catch (_) { return part; }
}

export function parseHash(hash) {
    const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
    return { name: parts[0] || 'chat', params: parts.slice(1) };
}

function showRouteError(container, err, onRetry) {
    container.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'ap-page';
    const box = document.createElement('div');
    box.className = 'ap-empty';
    const ic = document.createElement('span');
    ic.className = 'material-symbols-outlined';
    ic.setAttribute('aria-hidden', 'true');
    ic.textContent = 'error_outline';
    const h2 = document.createElement('h2');
    h2.textContent = 'Ansicht konnte nicht geladen werden';
    const p = document.createElement('p');
    p.textContent = err?.message || 'Ein unerwarteter Fehler ist aufgetreten.';
    const row = document.createElement('div');
    row.className = 'cd-row';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'ap-new';
    retry.textContent = 'Erneut versuchen';
    retry.addEventListener('click', onRetry);
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'bl-btn';
    back.textContent = 'Zurück zum Chat';
    back.addEventListener('click', () => Router.go('chat'));
    row.append(retry, back);
    box.append(ic, h2, p, row);
    wrap.append(box);
    container.append(wrap);
}

export const Router = {
    register(name, view) { views[name] = view; },
    go(path) {
        const h = '#/' + String(path || '').replace(/^#?\/?/, '');
        if (location.hash === h) Router.render(true);
        else location.hash = h;
    },
    back(fallback = '') {
        if (history.length > 1 && document.referrer !== undefined && Router._depth > 0) history.back();
        else Router.go(fallback);
    },
    _depth: 0,
    parse() { return parseHash(location.hash); },
    async render(force = false) {
        const { name, params } = Router.parse();
        const key = name + '/' + params.join('/');
        if (!force && key === currentKey) return;
        const seq = ++renderSeq;
        currentKey = key;

        if (current?.unmount) {
            try { current.unmount(); } catch (e) { console.error('[router unmount]', e); }
        }
        current = null;

        const view = views[name];
        const h = host();
        const c = chat();

        document.querySelectorAll('.sb-nav [data-route]').forEach(a =>
            a.classList.toggle('active', a.dataset.route === (view ? name : 'chat'))
        );

        if (window.innerWidth <= 768) {
            document.getElementById('main-sidebar')?.classList.add('collapsed');
            document.getElementById('open-sidebar-btn')?.classList.remove('hidden');
        }

        if (!view || !h) {
            if (h) { h.classList.add('hidden'); h.replaceChildren(); }
            c?.classList.remove('hidden');
            document.body.dataset.view = 'chat';
            return;
        }

        c?.classList.add('hidden');
        h.classList.remove('hidden');
        h.replaceChildren();
        document.body.dataset.view = name;
        current = view;

        try {
            await view.mount(h, params);
            if (seq !== renderSeq) return;
        } catch (e) {
            console.error('[router mount]', name, e);
            if (seq !== renderSeq) return;
            currentKey = '';
            showRouteError(h, e, () => Router.render(true));
        }
    },
    init() {
        if (!initialized) {
            initialized = true;
            window.addEventListener('hashchange', () => { Router._depth++; Router.render(); });
        }
        Router.render(true);
    }
};
