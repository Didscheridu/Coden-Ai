// js/browser-ui.js – Integrierter Research-Browser für das rechte Split-Panel:
// URL/Suchleiste, Verlauf (Zurück/Vor/Neu laden), strukturierte Übersicht (Produktkarten & Lesetext),
// Links & Formulare mit Berechtigungsprüfung (Lesen automatisch, Klick/Ausfüllen mit Freigabe).

import { apiJson } from './backend.js';
import { Storage } from './storage.js';
import { toast } from './toast.js';
import { requestInlinePermission } from './inline-permission.js';
import { domainFromUrl } from './browser-core.js';

const DOMAIN_KEY = 'coden_browser_allowed_domains';

const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
};
const ic = (name) => h('span', { class: 'material-symbols-outlined', 'aria-hidden': 'true', text: name });

export function getAllowedBrowserDomains() {
    const out = new Set();
    try {
        const local = JSON.parse(localStorage.getItem(DOMAIN_KEY) || '[]');
        if (Array.isArray(local)) local.forEach(d => d && out.add(String(d).toLowerCase()));
    } catch (_) {}
    const fromSettings = Storage.getSettings().browserAllowedDomains;
    if (Array.isArray(fromSettings)) fromSettings.forEach(d => d && out.add(String(d).toLowerCase()));
    return [...out];
}

export function isDomainAlwaysAllowed(urlOrDomain) {
    const dom = String(urlOrDomain || '').includes('://') ? domainFromUrl(urlOrDomain) : String(urlOrDomain || '').toLowerCase();
    if (!dom) return false;
    return getAllowedBrowserDomains().includes(dom);
}

export function setDomainAlwaysAllowed(urlOrDomain, allow = true) {
    const dom = String(urlOrDomain || '').includes('://') ? domainFromUrl(urlOrDomain) : String(urlOrDomain || '').toLowerCase();
    if (!dom) return [];
    const set = new Set(getAllowedBrowserDomains());
    if (allow) set.add(dom); else set.delete(dom);
    const list = [...set].slice(0, 60);
    try { localStorage.setItem(DOMAIN_KEY, JSON.stringify(list)); } catch (_) {}
    const s = Storage.getSettings();
    s.browserAllowedDomains = list;
    Storage.saveSettings(s);
    return list;
}

const state = {
    host: null,
    history: [],
    histIdx: -1,
    page: null,
    subTab: 'overview', // overview | live | reader | interact
    loading: false,
    error: '',
    log: [] // Aktionsprotokoll: { at, kind, text, ok }
};

// Server antwortet { ok, page } – ältere Antworten waren die Seite selbst. Feldnamen vereinheitlichen.
function normalizePage(res) {
    const p = res && typeof res === 'object' ? (res.page && typeof res.page === 'object' ? res.page : res) : null;
    if (!p || !p.url) return null;
    return {
        ...p,
        excerpt: p.excerpt || p.textExcerpt || '',
        links: (Array.isArray(p.links) ? p.links : []).map(l => ({ ...l, url: l.url || l.href || '' })).filter(l => l.url),
        forms: (Array.isArray(p.forms) ? p.forms : []).map(f => ({ ...f, inputs: f.inputs || f.fields || [] })),
        products: Array.isArray(p.products) ? p.products : []
    };
}

function logAction(kind, text, ok = true) {
    state.log.unshift({ at: Date.now(), kind, text: String(text || '').slice(0, 140), ok });
    if (state.log.length > 30) state.log.length = 30;
}

export function browserLog() {
    return state.log.slice();
}

export function currentBrowserPage() {
    return state.page;
}

function pushHistory(page) {
    if (!page?.url) return;
    if (state.history[state.histIdx]?.url === page.url) {
        state.history[state.histIdx] = page;
        return;
    }
    state.history = state.history.slice(0, state.histIdx + 1);
    state.history.push(page);
    if (state.history.length > 25) state.history.shift();
    state.histIdx = state.history.length - 1;
}

export async function openInBrowser({ url = '', site = '', query = '' } = {}) {
    state.loading = true;
    state.error = '';
    render();
    try {
        const res = await apiJson('/browser/open', {
            method: 'POST',
            body: JSON.stringify({ url, site, query })
        });
        const page = normalizePage(res);
        if (!page) throw new Error('Die Seite hat keine lesbaren Inhalte geliefert.');
        state.page = page;
        state.subTab = 'overview';
        pushHistory(page);
        logAction('read', `Gelesen: ${page.title || page.domain || page.url}`);
        return page;
    } catch (err) {
        state.error = err?.message || 'Seite konnte nicht geladen werden.';
        logAction('read', `Fehler: ${state.error}`, false);
        throw err;
    } finally {
        state.loading = false;
        render();
    }
}

export async function performBrowserAction({ url, action = 'click', target = '', value = '', formData = {}, hostEl = null, askIfNeeded = true } = {}) {
    const targetUrl = url || state.page?.url || '';
    const domain = domainFromUrl(targetUrl);

    if (askIfNeeded && !isDomainAlwaysAllowed(domain)) {
        const perm = await requestInlinePermission({
            hostEl,
            kind: 'browser',
            icon: 'public',
            domain,
            title: `Aktion auf „${domain || 'Webseite'}“ ausführen?`,
            subtitle: action === 'click' ? 'Link im Research-Browser öffnen' : 'Such- oder Formularaktion absenden',
            toolName: `browser_${action}`,
            args: {
                url: targetUrl,
                ...(target ? { Ziel: target } : {}),
                ...(value ? { Eingabe: value } : {}),
                ...(formData && Object.keys(formData).length ? formData : {})
            },
            confirmLabel: 'Einmal erlauben',
            cancelLabel: 'Ablehnen'
        });
        if (!perm) {
            logAction(action, `Abgelehnt: ${action}${target ? ' → ' + target : ''}`, false);
            render();
            return { denied: true };
        }
        if (perm === 'always-domain') setDomainAlwaysAllowed(domain, true);
    }

    state.loading = true;
    state.error = '';
    render();
    try {
        const res = await apiJson('/browser/action', {
            method: 'POST',
            body: JSON.stringify({ url: targetUrl, action, target, value, formData })
        });
        const page = normalizePage(res);
        if (page) {
            state.page = page;
            state.subTab = 'overview';
            pushHistory(page);
        }
        const what = action === 'click' ? 'Geklickt' : action === 'search' ? 'Gesucht' : 'Abgeschickt';
        logAction(action, `${what}: ${value || target || ''} → ${page?.title || page?.domain || 'fertig'}`);
        return { ...res, page };
    } catch (err) {
        state.error = err?.message || 'Browser-Aktion fehlgeschlagen.';
        logAction(action, `Fehler: ${state.error}`, false);
        throw err;
    } finally {
        state.loading = false;
        render();
    }
}

function renderQuickLaunch(box) {
    const quickSites = [
        ['Amazon Suche', 'shopping_cart', 'amazon.de', ''],
        ['Wikipedia', 'menu_book', 'de.wikipedia.org', ''],
        ['DuckDuckGo', 'travel_explore', 'html.duckduckgo.com', ''],
        ['GitHub', 'code', 'github.com', '']
    ];
    box.append(
        h('div', { class: 'br-empty' },
            ic('public'),
            h('h3', { text: 'Coden Research-Browser' }),
            h('p', { text: 'Öffne Webseiten direkt neben dem Chat, vergleiche Produkte oder übernimm Quellen ins Lernheft. Lesen klappt automatisch — Klicks & Formulare fragen dich kurz.' }),
            h('div', { class: 'br-quick-grid' },
                ...quickSites.map(([lbl, iconName, site]) =>
                    h('button', {
                        type: 'button',
                        class: 'br-quick-btn',
                        onclick: () => openInBrowser({ url: 'https://' + site }).catch(() => {})
                    }, ic(iconName), h('span', { text: lbl }))
                )
            )
        )
    );
}

function renderOverviewPane(page) {
    const wrap = h('div', { class: 'br-pane' });
    wrap.append(
        h('div', { class: 'br-meta-card' },
            h('div', { class: 'br-meta-title' },
                h('strong', { text: page.title || page.domain || 'Webseite' }),
                h('small', { text: page.url })
            ),
            page.description ? h('p', { class: 'br-meta-desc', text: page.description }) : null
        ),
        page.fallbackNote ? h('p', { class: 'br-note', text: page.fallbackNote }) : null
    );

    if (Array.isArray(page.products) && page.products.length) {
        wrap.append(h('h4', { class: 'br-sec-h', text: `Gefundene Produkte / Treffer (${page.products.length})` }));
        const list = h('div', { class: 'br-products' });
        for (const p of page.products.slice(0, 12)) {
            list.append(
                h('div', { class: 'br-prod-card' },
                    h('div', { class: 'br-prod-info' },
                        h('strong', { text: p.title }),
                        h('div', { class: 'br-prod-meta' },
                            p.price ? h('span', { class: 'br-price', text: p.price }) : null,
                            p.rating ? h('span', { class: 'br-rating', text: p.rating }) : null
                        )
                    ),
                    h('div', { class: 'br-prod-actions' },
                        p.url ? h('button', {
                            type: 'button',
                            class: 'cd-btn sm',
                            onclick: () => openInBrowser({ url: p.url }).catch(e => toast(e.message, { type: 'error' }))
                        }, ic('open_in_browser'), ' Öffnen') : null,
                        h('button', {
                            type: 'button',
                            class: 'cd-btn sm',
                            onclick: () => document.dispatchEvent(new CustomEvent('coden:compose', {
                                detail: { text: `Bitte fasse dieses Ergebnis zusammen und bewerte es: ${p.title}${p.price ? ' (' + p.price + ')' : ''}${p.url ? ' – ' + p.url : ''}`, send: false }
                            }))
                        }, ic('chat'), ' Fragen')
                    )
                )
            );
        }
        wrap.append(list);
    }

    if (page.excerpt) {
        wrap.append(
            h('h4', { class: 'br-sec-h', text: 'Seiteninhalt' }),
            h('div', { class: 'br-excerpt', text: page.excerpt.slice(0, 2600) })
        );
    }
    return wrap;
}

function renderInteractPane(page) {
    const wrap = h('div', { class: 'br-pane' });
    if (Array.isArray(page.forms) && page.forms.length) {
        wrap.append(h('h4', { class: 'br-sec-h', text: 'Suchfelder & Formulare (mit Bestätigung)' }));
        page.forms.forEach((f) => {
            const firstField = (f.inputs || [])[0];
            const valIn = h('input', {
                class: 'cd-input',
                placeholder: firstField?.placeholder || firstField?.name || 'Eingabe …'
            });
            const formEl = h('form', {
                class: 'br-form-card',
                onsubmit: async (e) => {
                    e.preventDefault();
                    const v = valIn.value.trim();
                    if (!v) return;
                    const formData = {};
                    if (firstField?.name) formData[firstField.name] = v;
                    try {
                        await performBrowserAction({
                            url: page.url,
                            action: 'submit',
                            target: f.id,
                            value: v,
                            formData
                        });
                    } catch (err) {
                        toast(err.message, { type: 'error' });
                    }
                }
            },
            h('div', { class: 'br-form-head' }, h('code', { text: f.id }), h('small', { text: `${f.method} · ${f.action}` })),
            h('div', { class: 'br-form-row' }, valIn, h('button', { type: 'submit', class: 'cd-primary sm' }, 'Ausführen')));
            wrap.append(formEl);
        });
    }

    if (Array.isArray(page.links) && page.links.length) {
        wrap.append(h('h4', { class: 'br-sec-h', text: `Links auf dieser Seite (${page.links.length})` }));
        const links = h('div', { class: 'br-links-list' });
        page.links.forEach((l) => {
            links.append(
                h('button', {
                    type: 'button',
                    class: 'br-link-row',
                    onclick: async () => {
                        try {
                            await performBrowserAction({ url: page.url, action: 'click', target: l.url });
                        } catch (err) {
                            toast(err.message, { type: 'error' });
                        }
                    }
                }, h('code', { text: l.id }), h('span', { class: 'br-link-txt', text: l.text }), ic('arrow_forward'))
            );
        });
        wrap.append(links);
    }

    if (!page.forms?.length && !page.links?.length) {
        wrap.append(h('p', { class: 'cd-text', text: 'Keine Formulare oder Links auf dieser Seite erkannt.' }));
    }
    return wrap;
}

// Live-Ansicht: echte Seite im abgeschotteten iframe – nur wenn die Seite Einbetten erlaubt.
// Sonst ehrlicher Hinweis + Lese-Ansicht, damit das Panel nie leer bleibt.
function renderLivePane(page) {
    const wrap = h('div', { class: 'br-pane br-live' });
    if (page.embeddable) {
        wrap.append(
            h('iframe', {
                class: 'br-live-frame',
                src: page.url,
                title: page.title || page.domain || 'Webseite',
                sandbox: 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
                referrerpolicy: 'no-referrer',
                loading: 'lazy'
            }),
            h('p', { class: 'br-live-note', text: 'Live-Ansicht: Was du hier anklickst, passiert direkt auf der Seite – Coden liest dabei nicht mit.' })
        );
    } else {
        wrap.append(h('div', { class: 'br-live-blocked' },
            ic('shield'),
            h('p', { text: `${page.domain || 'Diese Seite'} erlaubt keine Einbettung in andere Apps. Coden zeigt dir deshalb die gelesene Fassung – oder öffne die Seite extern.` }),
            h('div', { class: 'br-live-actions' },
                h('button', { type: 'button', class: 'cd-btn sm', onclick: () => { state.subTab = 'reader'; render(); } }, ic('article'), ' Lesetext'),
                h('a', { class: 'cd-btn sm', href: page.url, target: '_blank', rel: 'noopener noreferrer' }, ic('open_in_new'), ' Extern öffnen')
            )
        ));
    }
    return wrap;
}

function renderLogPane() {
    const wrap = h('div', { class: 'br-pane' });
    wrap.append(h('h4', { class: 'br-sec-h', text: 'Aktionsprotokoll' }));
    if (!state.log.length) {
        wrap.append(h('p', { class: 'cd-text', text: 'Noch keine Aktionen. Lesen läuft automatisch, Klicks und Eingaben fragen dich vorher.' }));
        return wrap;
    }
    const list = h('div', { class: 'br-log' });
    for (const e of state.log) {
        const t = new Date(e.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        list.append(h('div', { class: 'br-log-row' + (e.ok ? '' : ' bad') },
            ic(e.ok ? (e.kind === 'read' ? 'visibility' : 'touch_app') : 'block'),
            h('span', { class: 'br-log-txt', text: e.text }),
            h('small', { text: t })
        ));
    }
    wrap.append(list);
    return wrap;
}

function render() {
    if (!state.host) return;
    const page = state.page;
    const domain = page?.domain || (page?.url ? domainFromUrl(page.url) : '');
    const domainAllowed = domain && isDomainAlwaysAllowed(domain);

    const urlInput = h('input', {
        class: 'br-url-input',
        type: 'text',
        placeholder: 'Webadresse oder Suche (z. B. amazon.de Kopfhörer) …',
        value: page?.url || ''
    });

    const addressForm = h('form', {
        class: 'br-nav-bar',
        onsubmit: (e) => {
            e.preventDefault();
            const raw = urlInput.value.trim();
            if (!raw) return;
            const isUrlLike = /^https?:\/\//i.test(raw) || (/^[^\s]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw) && !/\s/.test(raw));
            if (isUrlLike) {
                openInBrowser({ url: /^https?:\/\//i.test(raw) ? raw : 'https://' + raw }).catch(() => {});
            } else {
                openInBrowser({ query: raw }).catch(() => {});
            }
        }
    },
    h('button', {
        type: 'button',
        class: 'br-nav-btn',
        disabled: state.histIdx <= 0 || state.loading,
        title: 'Zurück',
        onclick: () => {
            if (state.histIdx > 0) {
                state.histIdx--;
                state.page = state.history[state.histIdx];
                state.error = '';
                render();
            }
        }
    }, ic('arrow_back')),
    h('button', {
        type: 'button',
        class: 'br-nav-btn',
        disabled: state.histIdx >= state.history.length - 1 || state.loading,
        title: 'Vorwärts',
        onclick: () => {
            if (state.histIdx < state.history.length - 1) {
                state.histIdx++;
                state.page = state.history[state.histIdx];
                state.error = '';
                render();
            }
        }
    }, ic('arrow_forward')),
    h('button', {
        type: 'button',
        class: 'br-nav-btn',
        disabled: !page?.url || state.loading,
        title: 'Neu laden',
        onclick: () => page?.url && openInBrowser({ url: page.url }).catch(() => {})
    }, ic(state.loading ? 'progress_activity' : 'refresh')),
    urlInput,
    page?.url ? h('a', {
        class: 'br-nav-btn',
        href: page.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: 'Im externen Browser-Tab öffnen'
    }, ic('open_in_new')) : null
    );

    const toolbar = page ? h('div', { class: 'br-subbar' },
        h('div', { class: 'br-tabs' },
            ...[['overview', 'Übersicht'], ['live', 'Live'], ['reader', 'Lesetext'], ['interact', 'Links & Formulare'], ['log', 'Protokoll']].map(([id, lbl]) =>
                h('button', {
                    type: 'button',
                    class: state.subTab === id ? 'active' : '',
                    onclick: () => { state.subTab = id; render(); }
                }, lbl)
            )
        ),
        h('div', { class: 'br-sub-actions' },
            domain ? h('button', {
                type: 'button',
                class: 'br-perm-chip' + (domainAllowed ? ' on' : ''),
                title: domainAllowed ? `Klick-Freigabe für ${domain} zurücknehmen` : `Aktionen auf ${domain} immer erlauben`,
                onclick: () => {
                    setDomainAlwaysAllowed(domain, !domainAllowed);
                    toast(!domainAllowed ? `${domain} dauerhaft für Aktionen erlaubt.` : `Freigabe für ${domain} entfernt.`, { type: 'ok' });
                    render();
                }
            }, ic(domainAllowed ? 'verified_user' : 'shield'), h('span', { text: domainAllowed ? 'Immer erlaubt' : 'Lesen auto' })) : null,
            h('button', {
                type: 'button',
                class: 'cd-btn sm',
                title: 'Aktuelle Seite im Chat zusammenfassen',
                onclick: () => document.dispatchEvent(new CustomEvent('coden:compose', {
                    detail: {
                        text: `Fasse bitte diese Webseite aus dem Research-Browser zusammen (${page.url}):\nTitel: ${page.title}\n\n${(page.excerpt || '').slice(0, 1500)}`,
                        send: true
                    }
                }))
            }, ic('summarize'), ' Zusammenfassen')
        )
    ) : null;

    const body = h('div', { class: 'br-body' });
    if (state.loading) {
        body.append(h('div', { class: 'br-loading' }, ic('progress_activity'), h('span', { text: 'Lade Webseite …' })));
    } else if (state.error) {
        body.append(h('div', { class: 'br-error' }, ic('error'), h('p', { text: state.error })));
    } else if (!page) {
        renderQuickLaunch(body);
    } else if (state.subTab === 'live') {
        body.append(renderLivePane(page));
    } else if (state.subTab === 'log') {
        body.append(renderLogPane());
    } else if (state.subTab === 'reader') {
        body.append(h('div', { class: 'br-pane' }, h('h3', { text: page.title || page.domain }), h('pre', { class: 'br-reader-txt', text: page.excerpt || '(Kein Lesetext)' })));
    } else if (state.subTab === 'interact') {
        body.append(renderInteractPane(page));
    } else {
        body.append(renderOverviewPane(page));
    }

    state.host.replaceChildren(h('div', { class: 'br-root' }, addressForm, toolbar, body));
}

export function mountBrowserPane(host) {
    state.host = host;
    render();
}
