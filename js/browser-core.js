// js/browser-core.js – Parser & Hilfsfunktionen für den Research-Browser im Chat (<browser_open>, <browser_action>, <browser>).
// Reine Logik (ohne DOM) – voll testbar.

const decodeEnt = (s) => String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function parseAttrs(s) {
    const out = {};
    String(s || '').replace(/([a-zA-Z_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/g, (_, k, a, b, c) => {
        out[k.toLowerCase()] = decodeEnt(a ?? b ?? c ?? '').trim();
    });
    return out;
}

const OPEN_TAG = /<browser_open\b([^>]*?)(?:\/>|>([\s\S]*?)<\/browser_open>)/i;
const ACTION_TAG = /<browser_action\b([^>]*?)(?:\/>|>([\s\S]*?)<\/browser_action>)/i;

/**
 * Sucht nach dem nächsten ausführbaren Browser-Werkzeugtag (<browser_open> oder <browser_action>)
 * außerhalb von Codeblöcken.
 */
export function parseBrowserCommand(text) {
    const raw = String(text || '');
    const mOpen = raw.match(OPEN_TAG);
    const mAct = raw.match(ACTION_TAG);

    if (!mOpen && !mAct) return null;
    // Was zuerst kommt
    const pickAction = mAct && (!mOpen || mAct.index < mOpen.index);
    if (!pickAction && mOpen) {
        const attrs = parseAttrs(mOpen[1]);
        const body = decodeEnt(mOpen[2] || '').trim();
        let url = attrs.url || '';
        let site = attrs.site || '';
        let query = attrs.query || attrs.q || body || '';
        if (!url && !site && /^https?:\/\//i.test(body)) {
            url = body;
            query = '';
        }
        return { kind: 'open', url, site, query };
    }

    if (mAct) {
        const attrs = parseAttrs(mAct[1]);
        const body = decodeEnt(mAct[2] || '').trim();
        let extra = {};
        if (body && body.startsWith('{')) {
            try { extra = JSON.parse(body); } catch (_) {}
        }
        return {
            kind: 'action',
            url: attrs.url || extra.url || '',
            action: (attrs.action || extra.action || 'click').toLowerCase(),
            target: attrs.target || attrs.selector || attrs.id || extra.target || '',
            value: attrs.value || extra.value || (!body.startsWith('{') ? body : ''),
            formData: extra.formData && typeof extra.formData === 'object' ? extra.formData : {}
        };
    }
    return null;
}

/**
 * Entfernt Browser-Werkzeug-Befehle (<browser_open>, <browser_action>) während des Streamings,
 * lässt aber <browser ...> Vorschaukarten für rich-elements.js stehen!
 */
export function hideBrowserToolTags(text) {
    return String(text || '')
        .replace(/<browser_open\b[\s\S]*?(?:\/>|<\/browser_open>)/gi, '')
        .replace(/<browser_action\b[\s\S]*?(?:\/>|<\/browser_action>)/gi, '')
        .replace(/<browser_(?:open|action)\b[\s\S]*$/i, '');
}

/**
 * Parst den Inhalt einer <browser url="..." title="..." domain="..." query="..."> Vorschaukarte im Chat.
 */
export function parseBrowserPreview(body, attrs = {}) {
    const url = String(attrs.url || '').trim();
    let domain = String(attrs.domain || '').trim();
    if (!domain && url) {
        try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
    }
    const title = String(attrs.title || domain || 'Webseite').trim();
    const query = String(attrs.query || '').trim();

    const raw = String(body || '').trim();
    let products = [];
    let snippet = '';
    let links = [];

    if (raw) {
        try {
            const j = JSON.parse(raw);
            if (Array.isArray(j)) {
                products = j.slice(0, 6);
            } else if (j && typeof j === 'object') {
                if (Array.isArray(j.products)) products = j.products.slice(0, 6);
                if (Array.isArray(j.links)) links = j.links.slice(0, 6);
                if (typeof j.snippet === 'string') snippet = j.snippet;
                else if (typeof j.excerpt === 'string') snippet = j.excerpt;
            }
        } catch (_) {
            const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
            for (const l of lines) {
                const pm = l.match(/^[-*]?\s*(.+?)\s*\|\s*([€$]?\s*\d[\d.,]*\s*[€$]?)\s*(?:\|\s*(https?:\/\/\S+))?$/);
                if (pm) {
                    products.push({ title: pm[1].trim(), price: pm[2].trim(), url: pm[3] || '' });
                } else {
                    snippet = snippet ? `${snippet} ${l}` : l;
                }
            }
        }
    }
    return { url, domain, title, query, products, links, snippet: snippet.slice(0, 360) };
}

/**
 * Kompakte Text-Repräsentation einer abgerufenen Seite als Kontext für das Modell.
 */
export function formatBrowserForModel(page) {
    if (!page) return 'Seite konnte nicht geladen werden.';
    const parts = [
        `URL: ${page.url}`,
        `Domain: ${page.domain || ''}`,
        `Titel: ${page.title || ''}`
    ];
    if (page.description) parts.push(`Beschreibung: ${page.description}`);
    if (Array.isArray(page.products) && page.products.length) {
        parts.push('Gefundene Produkte:\n' + page.products.slice(0, 8).map((p, i) =>
            `${i + 1}. ${p.title}${p.price ? ` · Preis: ${p.price}` : ''}${p.rating ? ` · ${p.rating}` : ''}${p.url ? ` · Link: ${p.url}` : ''}`
        ).join('\n'));
    }
    if (Array.isArray(page.links) && page.links.length) {
        parts.push('Klickbare Links (für <browser_action action="click" target="...">):\n' + page.links.slice(0, 14).map(l =>
            `- [${l.id}] ${l.text} -> ${l.url}`
        ).join('\n'));
    }
    if (Array.isArray(page.forms) && page.forms.length) {
        parts.push('Formulare / Suchfelder:\n' + page.forms.slice(0, 4).map(f =>
            `- [${f.id}] ${f.method} ${f.action} · Felder: ${(f.inputs || []).map(x => `${x.name}${x.placeholder ? ` (${x.placeholder})` : ''}`).join(', ')}`
        ).join('\n'));
    }
    if (page.excerpt) {
        parts.push('Sichtbarer Seitentext (Auszug):\n' + String(page.excerpt).slice(0, 4500));
    }
    return parts.join('\n\n');
}

export function domainFromUrl(url) {
    try { return new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase(); }
    catch (_) { return ''; }
}
