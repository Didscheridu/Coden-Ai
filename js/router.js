// js/router.js – Tabs über die Adresse (#/apps, #/artefakte, #/buddy …). Zurück-Taste und Links funktionieren dadurch.
// Der Chat ist die Startansicht; jede andere Ansicht wird in #view-host angezeigt.
const views = {}; let current = null; let currentKey = '';
const host = () => document.getElementById('view-host');
const chat = () => document.querySelector('.main-content');

export const Router = {
    register(name, view) { views[name] = view; },
    go(path) { const h = '#/' + String(path || '').replace(/^#?\/?/, ''); if (location.hash === h) Router.render(); else location.hash = h; },
    back(fallback = '') { if (history.length > 1 && document.referrer !== undefined && Router._depth > 0) history.back(); else Router.go(fallback); },
    _depth: 0,
    parse() { const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent); return { name: parts[0] || 'chat', params: parts.slice(1) }; },
    async render() {
        const { name, params } = Router.parse();
        const key = name + '/' + params.join('/');
        if (key === currentKey) return; currentKey = key;
        const view = views[name];
        if (current?.unmount) { try { current.unmount(); } catch (e) { console.error(e); } }
        current = null;
        document.querySelectorAll('.sb-nav [data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === (view ? name : 'chat')));
        if (!view) { host().classList.add('hidden'); host().replaceChildren(); chat().classList.remove('hidden'); document.body.dataset.view = 'chat'; return; }
        chat().classList.add('hidden'); const h = host(); h.classList.remove('hidden'); h.replaceChildren(); document.body.dataset.view = name;
        current = view; try { await view.mount(h, params); } catch (e) { console.error(e); }
        if (window.innerWidth <= 768) { document.getElementById('main-sidebar')?.classList.add('collapsed'); document.getElementById('open-sidebar-btn')?.classList.remove('hidden'); }
    },
    init() { window.addEventListener('hashchange', () => { Router._depth++; Router.render(); }); Router.render(); }
};
