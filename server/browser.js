// server/browser.js – Integrierter Coden Research-Browser:
// Lädt echte Webseiten & Shop-/Suchergebnisse sicher auf dem Server (SSRF-Schutz, Redirect-Prüfung, HTML/Produkt-Parser).
// Lesen erfolgt automatisch; Klicks/Formular-Aktionen werden im Frontend zusätzlich durch die Inline-Freigabe geschützt.
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const express = require('express');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');
const { isPrivateIp } = require('./mcp');

const ALLOW_PRIVATE = () => process.env.BROWSER_ALLOW_PRIVATE === '1' || process.env.MCP_ALLOW_PRIVATE === '1';
const MAX_BODY = 2 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;

const httpErr = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// Cloud-Metadaten (169.254.x.x, fd00:ec2::254, metadata.google.internal …) sind IMMER gesperrt –
// auch wenn Tests private Adressen erlauben.
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata', 'metadata.azure.internal', 'instance-data', 'instance-data.ec2.internal']);
function isMetadataIp(ip) {
  const l = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = l.match(/^(?:::ffff:)?(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) return Number(v4[1]) === 169 && Number(v4[2]) === 254;
  return /^fe[89ab]/.test(l) || l === 'fd00:ec2::254';
}

function guardedLookup(hostname, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (addrs.some(a => isMetadataIp(a.address)) || (!ALLOW_PRIVATE() && addrs.some(a => isPrivateIp(a.address)))) {
      return cb(Object.assign(new Error('Interne oder private Adressen sind aus Sicherheitsgründen blockiert.'), { code: 'EBLOCKED' }));
    }
    if (opts.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

function validateBrowserUrl(raw) {
  let u;
  try {
    const s = String(raw || '').trim();
    const withProto = /^https?:\/\//i.test(s) ? s : (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s) ? 'https://' + s : s);
    u = new URL(withProto);
  } catch (_) {
    throw httpErr(400, 'Die angegebene Webadresse ist ungültig.');
  }
  if (u.username || u.password) throw httpErr(400, 'Zugangsdaten in der URL sind nicht erlaubt.');
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw httpErr(400, 'Nur http- und https-Adressen werden unterstützt.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (METADATA_HOSTS.has(host) || (net.isIP(host) && isMetadataIp(host))) {
    throw httpErr(400, 'Interne Cloud-Adressen sind im Research-Browser blockiert.');
  }
  if (!ALLOW_PRIVATE()) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || (!host.includes('.') && !net.isIP(host))) {
      throw httpErr(400, 'Lokale oder interne Adressen sind im Research-Browser blockiert.');
    }
    if (net.isIP(host) && isPrivateIp(host)) {
      throw httpErr(400, 'Private IP-Adressen sind im Research-Browser blockiert.');
    }
  }
  return u;
}

function fetchRaw(u, { method = 'GET', headers = {}, body = null, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
        ...headers,
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
      },
      lookup: guardedLookup,
      timeout
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: res.headers.location, status: res.statusCode, headers: res.headers, text: '' });
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { req.destroy(httpErr(502, 'Die Webseite ist zu groß zum Laden.')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(httpErr(504, 'Die Webseite antwortet nicht (Zeitüberschreitung).')));
    req.on('error', (e) => reject(e.status ? e : e.code === 'EBLOCKED' ? httpErr(400, e.message) : httpErr(502, 'Verbindung fehlgeschlagen: ' + (e.code || e.message))));
    if (body) req.write(body);
    req.end();
  });
}

async function fetchWithRedirects(rawUrl, opts = {}) {
  let cur = validateBrowserUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchRaw(cur, hop === 0 ? opts : { method: 'GET', timeout: opts.timeout });
    if (res.redirect) {
      if (hop === MAX_REDIRECTS) throw httpErr(502, 'Zu viele Weiterleitungen.');
      cur = validateBrowserUrl(new URL(res.redirect, cur).toString());
      continue;
    }
    return { ...res, finalUrl: cur.toString() };
  }
  throw httpErr(502, 'Zu viele Weiterleitungen.');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', euro: '€', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', ndash: '–', mdash: '—' };
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (_) { return ''; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch (_) { return ''; } })
    .replace(/&([a-zA-Z0-9#]+);/g, (m, k) => (Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m));
}
const stripTags = (html) => decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attrOf = (attrs, name) => {
  const m = String(attrs || '').match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeEntities(m ? (m[1] ?? m[2] ?? m[3] ?? '') : '').trim();
};

function safeResolveHref(href, baseUrl) {
  const raw = String(href || '').trim();
  if (!raw || raw.startsWith('#') || /^(?:javascript|data|vbscript|mailto|tel):/i.test(raw)) return '';
  try {
    const u = new URL(raw, baseUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.toString();
  } catch (_) {
    return '';
  }
}

function extractProducts(html, baseUrl) {
  const products = [];
  const seen = new Set();
  const push = (p) => {
    const title = String(p.title || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    if (!title || title.length < 3) return;
    const url = p.url ? safeResolveHref(p.url, baseUrl) : '';
    const key = title.toLowerCase() + '|' + url;
    if (seen.has(key)) return;
    seen.add(key);
    products.push({
      title,
      price: String(p.price || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      rating: String(p.rating || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      url: url || baseUrl,
      image: p.image ? safeResolveHref(p.image, baseUrl) : ''
    });
  };

  // 1) JSON-LD Product / ItemList
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.itemListElement) ? parsed.itemListElement.map(x => x.item || x) : [parsed]);
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const type = String(item['@type'] || '').toLowerCase();
        if (type.includes('product') || item.offers) {
          const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          const priceVal = offer?.price != null ? `${offer.price}${offer.priceCurrency === 'EUR' ? ' €' : offer.priceCurrency ? ' ' + offer.priceCurrency : ''}` : '';
          const img = Array.isArray(item.image) ? item.image[0] : (item.image?.url || item.image || '');
          const rating = item.aggregateRating?.ratingValue ? `${item.aggregateRating.ratingValue} ★` : '';
          push({ title: item.name, price: priceVal, rating, url: item.url, image: typeof img === 'string' ? img : '' });
        }
      }
    } catch (_) {}
  }

  // 2) Amazon Search Result Cards (s-search-result / data-asin)
  const cards = html.split(/data-component-type=["']s-search-result["']/i);
  if (cards.length > 1) {
    for (let i = 1; i < Math.min(cards.length, 15); i++) {
      const chunk = cards[i].slice(0, 14_000);
      const titleMatch = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      const linkMatch = chunk.match(/<a\b[^>]*href=["']([^"']*\/dp\/[^"']+|[^"']+)["'][^>]*>/i);
      const priceMatch = chunk.match(/class=["'][^"']*a-offscreen[^"']*["'][^>]*>([^<]+)</i)
        || chunk.match(/class=["'][^"']*a-price-whole[^"']*["'][^>]*>([^<]+)<[\s\S]{0,200}?a-price-fraction[^>]*>([^<]+)</i);
      const price = priceMatch ? (priceMatch[2] ? `${priceMatch[1]},${priceMatch[2]} €` : stripTags(priceMatch[1])) : '';
      const rateMatch = chunk.match(/([0-9],[0-9]|[0-9]\.[0-9])\s*(?:von 5 Sternen|out of 5 stars)/i);
      const imgMatch = chunk.match(/<img\b[^>]*class=["'][^"']*s-image[^"']*["'][^>]*src=["']([^"']+)["']/i);
      push({
        title: titleMatch ? stripTags(titleMatch[1]) : '',
        price,
        rating: rateMatch ? `${rateMatch[1]} ★` : '',
        url: linkMatch ? decodeEntities(linkMatch[1]) : '',
        image: imgMatch ? decodeEntities(imgMatch[1]) : ''
      });
    }
  }

  // 3) DuckDuckGo HTML Ergebnis-Fallback (falls Suchabfrage über DDG lief)
  if (!products.length && /duckduckgo\.com/i.test(baseUrl)) {
    for (const m of html.matchAll(/<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      let href = decodeEntities(m[1]);
      const uddg = href.match(/[?&]uddg=([^&]+)/);
      if (uddg) { try { href = decodeURIComponent(uddg[1]); } catch (_) {} }
      push({ title: stripTags(m[2]), price: '', rating: '', url: href });
      if (products.length >= 8) break;
    }
  }

  return products.slice(0, 12);
}

// Darf die Seite in einem iframe gezeigt werden? (X-Frame-Options / CSP frame-ancestors)
function isEmbeddable(headers = {}) {
  const xfo = String(headers['x-frame-options'] || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return false;
  const csp = String(headers['content-security-policy'] || '').toLowerCase();
  const fa = csp.match(/frame-ancestors([^;]*)/);
  if (fa && !/(^|\s)\*(\s|$)/.test(fa[1])) return false;
  return true;
}

function parseHtmlPage(rawHtml, finalUrl, status = 200, headers = {}) {
  const html = String(rawHtml || '');
  const u = new URL(finalUrl);
  const domain = u.hostname.replace(/^www\./i, '');

  const meta = {};
  for (const m of html.matchAll(/<meta\b([^>]+)>/gi)) {
    const key = (attrOf(m[1], 'property') || attrOf(m[1], 'name')).toLowerCase();
    const val = attrOf(m[1], 'content');
    if (key && val) meta[key] = val;
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (meta['og:title'] || (titleMatch ? stripTags(titleMatch[1]) : '') || domain).slice(0, 180);
  const description = (meta['og:description'] || meta.description || '').slice(0, 400);

  const headings = [];
  for (const m of html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const t = stripTags(m[2]);
    if (t && t.length >= 2 && !headings.includes(t)) headings.push(t.slice(0, 140));
    if (headings.length >= 12) break;
  }

  const cleanedBody = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

  const links = [];
  const seenHref = new Set();
  for (const m of cleanedBody.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = safeResolveHref(attrOf(m[1], 'href'), finalUrl);
    const text = stripTags(m[2]).slice(0, 110);
    if (!href || !text || text.length < 2 || seenHref.has(href)) continue;
    seenHref.add(href);
    links.push({ id: `link_${links.length + 1}`, text, url: href, href });
    if (links.length >= 24) break;
  }

  const forms = [];
  for (const fm of cleanedBody.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const action = safeResolveHref(attrOf(fm[1], 'action') || finalUrl, finalUrl) || finalUrl;
    const method = (attrOf(fm[1], 'method') || 'GET').toUpperCase();
    const fields = [];
    for (const im of fm[2].matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) {
      const name = attrOf(im[2], 'name');
      const type = (attrOf(im[2], 'type') || im[1]).toLowerCase();
      if (!name || type === 'hidden' || type === 'submit') continue;
      fields.push({
        selectorId: `form_${forms.length + 1}_${fields.length + 1}`,
        name,
        type,
        placeholder: attrOf(im[2], 'placeholder') || attrOf(im[2], 'aria-label') || name
      });
      if (fields.length >= 6) break;
    }
    if (fields.length) forms.push({ id: `form_${forms.length + 1}`, action, method, inputs: fields, fields });
    if (forms.length >= 5) break;
  }

  const paraMatches = [...cleanedBody.matchAll(/<(p|li|article|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(m => stripTags(m[2]))
    .filter(t => t.length >= 28);
  const textExcerpt = (paraMatches.length ? paraMatches.slice(0, 14).join('\n\n') : stripTags(cleanedBody)).slice(0, 4500);
  const products = extractProducts(html, finalUrl);
  const blocked = status === 403 || status === 429 || status === 503 || /robot check|captcha|bitte bestätigen sie, dass sie kein roboter/i.test(html.slice(0, 20000));

  return {
    url: finalUrl,
    finalUrl,
    domain,
    status,
    title,
    description,
    headings,
    excerpt: textExcerpt,
    textExcerpt,
    products,
    links,
    forms,
    interactiveCount: links.length + forms.length,
    blocked,
    embeddable: !blocked && isEmbeddable(headers),
    fetchedAt: new Date().toISOString(),
    favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
  };
}

function buildSearchUrl(query, site = '') {
  const q = String(query || '').trim();
  const s = String(site || '').trim().toLowerCase();
  if (s.includes('amazon')) return `https://www.amazon.de/s?k=${encodeURIComponent(q)}`;
  if (s.includes('wikipedia')) return `https://de.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`;
  if (s.includes('ebay')) return `https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(q)}`;
  if (s.includes('github')) return `https://github.com/search?q=${encodeURIComponent(q)}`;
  if (/^https?:\/\//i.test(q)) return q;
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(s ? `site:${s} ${q}` : q)}`;
}

async function openTarget({ url, query, site }) {
  const targetUrl = url ? String(url).trim() : buildSearchUrl(query, site);
  const rawRes = await fetchWithRedirects(targetUrl);
  const page = parseHtmlPage(rawRes.text, rawRes.finalUrl, rawRes.status, rawRes.headers);

  if (page.blocked && (query || page.domain.includes('amazon'))) {
    const qText = query || new URL(page.finalUrl).searchParams.get('k') || page.title;
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:${page.domain} ${qText}`)}`;
    try {
      const fbRes = await fetchWithRedirects(ddgUrl);
      const fbPage = parseHtmlPage(fbRes.text, fbRes.finalUrl, fbRes.status);
      if (fbPage.products.length || fbPage.links.length) {
        page.products = fbPage.products.length ? fbPage.products : fbPage.links.slice(0, 8).map(l => ({ title: l.text, price: '', rating: '', url: l.href, image: '' }));
        page.links = fbPage.links.slice(0, 12);
        page.textExcerpt = fbPage.textExcerpt || page.textExcerpt;
        page.excerpt = page.textExcerpt;
        page.embeddable = false;
        page.fallbackNote = `${page.domain} blockiert automatisches Laden – Treffer wurden über die Web-Suche geladen. „Extern öffnen“ zeigt die Live-Shopseite.`;
        page.blocked = false;
      }
    } catch (_) { /* bei Fehlschlag Hinweis belassen */ }
  }
  return page;
}

function browserRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);

  const guard = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { res.status(e.status || 502).json({ error: e.message || 'Webseite konnte nicht geladen werden.' }); }
  };

  r.post('/open', rateLimit('browser-open', 40, 60), guard(async (req, res) => {
    const { url, query, site } = req.body || {};
    if (!url && !query) throw httpErr(400, 'Bitte gib eine Webadresse oder einen Suchbegriff ein.');
    const page = await openTarget({ url, query, site });
    res.json({ ok: true, page });
  }));

  r.post('/action', rateLimit('browser-action', 30, 60), guard(async (req, res) => {
    const { url, action, target, value, formData } = req.body || {};
    if (!url) throw httpErr(400, 'Aktuelle URL fehlt.');
    const cur = validateBrowserUrl(url);
    const act = String(action || '').toLowerCase();
    if (!['click', 'type', 'fill', 'submit', 'search'].includes(act)) {
      throw httpErr(400, 'Unbekannte Browser-Aktion.');
    }

    if (act === 'click') {
      const nextUrl = target ? safeResolveHref(target, cur.toString()) : cur.toString();
      if (!nextUrl) throw httpErr(400, 'Ungültiges Link-Ziel.');
      const page = await openTarget({ url: nextUrl });
      return res.json({ ok: true, action: act, page });
    }

    if (act === 'search') {
      const page = await openTarget({ query: value || '', site: cur.hostname });
      return res.json({ ok: true, action: act, page });
    }

    // type / fill / submit über Formular-ID der aktuellen Seite, Formular-Ziel oder Query-Parameter
    let targetUrl;
    const formRef = String(target || '').match(/^form[_-](\d{1,2})$/i);
    if (formRef) {
      const curRes = await fetchWithRedirects(cur.toString());
      const curPage = parseHtmlPage(curRes.text, curRes.finalUrl, curRes.status, curRes.headers);
      const form = curPage.forms.find(f => f.id === `form_${formRef[1]}`);
      if (!form) throw httpErr(404, 'Dieses Formular gibt es auf der Seite nicht (mehr).');
      if (form.method !== 'GET') throw httpErr(400, 'Formulare, die Daten absenden (POST, z. B. Anmeldungen), schickt Coden aus Sicherheitsgründen nicht ab. Öffne die Seite dafür extern.');
      targetUrl = validateBrowserUrl(form.action);
      if (!formData || typeof formData !== 'object' || !Object.keys(formData).length) {
        const first = form.inputs[0];
        if (first && value != null) targetUrl.searchParams.set(first.name, String(value).slice(0, 300));
      }
    } else {
      targetUrl = target ? validateBrowserUrl(safeResolveHref(target, cur.toString()) || cur.toString()) : new URL(cur.toString());
    }
    if (formData && typeof formData === 'object' && !Array.isArray(formData)) {
      for (const [k, v] of Object.entries(formData).slice(0, 12)) {
        if (typeof k === 'string' && k) targetUrl.searchParams.set(k, String(v ?? '').slice(0, 300));
      }
    } else if (value != null && !formRef) {
      const qKey = targetUrl.hostname.includes('amazon') ? 'k' : 'q';
      targetUrl.searchParams.set(qKey, String(value).slice(0, 300));
    }
    const page = await openTarget({ url: targetUrl.toString() });
    res.json({ ok: true, action: act, page });
  }));

  return r;
}

module.exports = {
  browserRouter,
  isMetadataIp,
  isEmbeddable,
  validateBrowserUrl,
  parseHtmlPage,
  buildSearchUrl,
  openTarget
};
