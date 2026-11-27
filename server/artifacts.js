// Artefakte wie bei Claude: veröffentlichen (öffentlicher Link /s/<id>), KI im Artefakt (window.coden.ask bzw. window.claude.complete)
// und Daten, die im Artefakt gespeichert bleiben (window.coden.storage bzw. window.storage, persönlich oder geteilt).
// Firestore: shared_artifacts/{id}, artifact_data/{uid}__{aid}__{k} (persönlich), artifact_shared/{aid}__{k} (geteilt, nur bei veröffentlichten).
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const { rateLimit, byIp } = require('./rateLimit');
const { wrapRouter } = require('./util');
const Usage = require('./usage');
const { generate } = require('./ai');

const LIMITS = { shared: 50, html: 700_000, body: 300_000, title: 80, value: 20_000, key: 200, keysPrivate: 200, keysShared: 500, prompt: 12_000, messages: 40 };
const TYPES = ['html', 'react', 'svg', 'mermaid', 'chart', 'table', 'slides', 'markdown', 'code', 'python'];
const fail = (status, message) => Object.assign(new Error(message), { status });
const ID_RE = /^[a-z0-9]{10}$/;
const AID_RE = /^[a-z0-9_-]{4,64}$/i;
const newId = () => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; for (const b of crypto.randomBytes(10)) s += a[b % a.length]; return s; };
const kHash = (k) => crypto.createHash('sha256').update(String(k)).digest('base64url').slice(0, 24);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeZone: 'Europe/Berlin' }).format(new Date());

const shareDoc = (id) => `shared_artifacts/${id}`;
async function loadShared(id) {
  if (!ID_RE.test(String(id || ''))) return null;
  const a = await db.getDoc(shareDoc(id)).catch(() => null);
  return a && a.published ? a : null;
}
const cleanKey = (k) => { const s = String(k ?? ''); if (!s || s.length > LIMITS.key || /[\u0000-\u001f]/.test(s)) throw fail(400, 'Ungültiger Schlüssel (1 bis 200 Zeichen).'); return s; };
const cleanValue = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v ?? null); if (s.length > LIMITS.value) throw fail(400, `Der Wert ist zu groß (höchstens ${LIMITS.value / 1000} KB).`); return s; };

// ---------- Speicher ----------
const privPath = (uid, aid, key) => `artifact_data/${uid}__${aid}__${kHash(key)}`;
const sharedPath = (aid, key) => `artifact_shared/${aid}__${kHash(key)}`;
async function storeGet({ uid, aid, key, shared }) {
  const d = await db.getDoc(shared ? sharedPath(aid, key) : privPath(uid, aid, key)).catch(() => null);
  return d && d.key === key ? { key, value: d.value, shared: !!shared } : null;
}
async function storeList({ uid, aid, prefix = '', shared }) {
  const rows = shared ? await db.runQuery('artifact_shared', { where: [['aid', '==', aid]], limit: 0 })
    : await db.runQuery('artifact_data', { where: [['uid', '==', uid]], limit: 0 }).then(r => r.filter(x => x.aid === aid));
  return { keys: rows.map(x => x.key).filter(k => k.startsWith(prefix)).sort().slice(0, 1000), prefix, shared: !!shared };
}
async function storeSet({ uid, aid, key, value, shared }) {
  const path = shared ? sharedPath(aid, key) : privPath(uid, aid, key);
  const exists = await db.getDoc(path).catch(() => null);
  if (!exists) {
    const n = (await storeList({ uid, aid, shared })).keys.length;
    if (n >= (shared ? LIMITS.keysShared : LIMITS.keysPrivate)) throw fail(400, 'Zu viele gespeicherte Einträge in diesem Artefakt.');
  }
  await db.setDoc(path, { aid, uid, key, value, scope: shared ? 'shared' : 'private', updated_at: db.nowIso() });
  return { key, value, shared: !!shared };
}
async function storeDelete({ uid, aid, key, shared }) {
  await db.deleteDoc(shared ? sharedPath(aid, key) : privPath(uid, aid, key));
  return { key, deleted: true, shared: !!shared };
}

// ---------- KI im Artefakt ----------
function askMessages(b) {
  const sys = { role: 'system', content: `Du bist die KI in einer kleinen App (einem Artefakt), die mit Coden gebaut wurde. Heute ist ${today()}. Antworte genau im Format, das die Anfrage verlangt (z. B. nur JSON, wenn JSON verlangt ist), ohne Einleitung. Sonst auf Deutsch, knapp und hilfreich.` };
  if (Array.isArray(b.messages)) {
    const msgs = b.messages.slice(-LIMITS.messages).map(m => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: String(m?.content ?? '').slice(0, LIMITS.prompt) })).filter(m => m.content);
    if (!msgs.length) throw fail(400, 'Leere Anfrage.');
    if (msgs.reduce((n, m) => n + m.content.length, 0) > LIMITS.prompt * 4) throw fail(400, 'Die Anfrage ist zu lang.');
    return [sys, ...msgs];
  }
  const p = String(b.prompt ?? '').trim();
  if (!p) throw fail(400, 'Leere Anfrage.');
  if (p.length > LIMITS.prompt) throw fail(400, `Die Anfrage ist zu lang (höchstens ${LIMITS.prompt} Zeichen).`);
  return [sys, { role: 'user', content: p }];
}
async function ask(user, body) {
  const messages = askMessages(body || {});
  const c = await Usage.check(user);
  if (!c.ok) throw Object.assign(fail(429, c.message), { code: 'limit' });
  const meter = new Usage.Meter(user, 'flash');
  try {
    const text = await generate('flash', messages, { uid: user.uid, isOwner: user.isOwner, meter, maxTokens: 4000, signal: AbortSignal.timeout(90_000) });
    return { text: String(typeof text === 'string' ? text : text?.text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim() };
  } finally { await meter.close().catch(() => {}); }
}

// ---------- API mit Login ----------
function artifactsRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);
  const aidOf = (req) => { const a = String(req.params.aid || ''); if (!AID_RE.test(a)) throw fail(400, 'Ungültiges Artefakt.'); return a; };
  // geteilter Speicher nur für veröffentlichte Artefakte (sonst wäre „geteilt“ niemand anders)
  const sharedOk = async (aid, shared) => { if (!shared) return false; if (!ID_RE.test(aid) || !(await loadShared(aid))) throw fail(400, 'Geteilte Daten gibt es nur in veröffentlichten Artefakten.'); return true; };

  r.post('/ask', rateLimit('artifact-ask', 30, 600), async (req, res) => res.json(await ask(req.user, req.body)));

  r.get('/store/:aid', rateLimit('artifact-store', 600, 600), async (req, res) => {
    const aid = aidOf(req); const shared = await sharedOk(aid, req.query.shared === '1');
    if (req.query.key != null) return res.json({ item: await storeGet({ uid: req.user.uid, aid, key: cleanKey(req.query.key), shared }) });
    res.json(await storeList({ uid: req.user.uid, aid, prefix: String(req.query.prefix || ''), shared }));
  });
  r.put('/store/:aid', rateLimit('artifact-store-w', 300, 600), async (req, res) => {
    const aid = aidOf(req); const shared = await sharedOk(aid, req.body?.shared === true);
    res.json(await storeSet({ uid: req.user.uid, aid, key: cleanKey(req.body?.key), value: cleanValue(req.body?.value), shared }));
  });
  r.delete('/store/:aid', rateLimit('artifact-store-w', 300, 600), async (req, res) => {
    const aid = aidOf(req); const shared = await sharedOk(aid, req.query.shared === '1');
    res.json(await storeDelete({ uid: req.user.uid, aid, key: cleanKey(req.query.key), shared }));
  });

  // Veröffentlichen: gleiche Quelle (srcKey) → gleicher Link, neue Fassung
  r.post('/share', rateLimit('artifact-share', 30, 600), async (req, res) => {
    const b = req.body || {};
    const type = TYPES.includes(b.type) ? b.type : 'html';
    const title = String(b.title || 'Artefakt').replace(/\s+/g, ' ').trim().slice(0, LIMITS.title) || 'Artefakt';
    const html = String(b.html || ''); const body = String(b.body || '');
    if (!html || html.length > LIMITS.html) throw fail(400, 'Das Artefakt ist zu groß zum Veröffentlichen.');
    if (body.length > LIMITS.body) throw fail(400, 'Der Quelltext ist zu groß zum Veröffentlichen.');
    const srcKey = String(b.srcKey || '').slice(0, 200);
    const mine = await db.runQuery('shared_artifacts', { where: [['uid', '==', req.user.uid]], limit: 0 });
    const prev = srcKey ? mine.find(x => x.src_key === srcKey) : null;
    if (!prev && mine.length >= LIMITS.shared) throw fail(400, `Du kannst höchstens ${LIMITS.shared} Artefakte veröffentlichen. Beende zuerst eine Veröffentlichung.`);
    const id = prev ? prev.id : newId();
    const doc = { id, uid: req.user.uid, author: String(b.author || '').replace(/\s+/g, ' ').trim().slice(0, 60), title, type, html, body, src_key: srcKey, published: true, created_at: prev?.created_at || db.nowIso(), updated_at: db.nowIso(), version: (prev?.version || 0) + 1 };
    await db.setDoc(shareDoc(id), doc);
    res.json({ id, url: `/s/${id}`, version: doc.version, updated: !!prev });
  });
  r.get('/shared', async (req, res) => {
    const mine = await db.runQuery('shared_artifacts', { where: [['uid', '==', req.user.uid]], limit: 0 });
    mine.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    res.json({ items: mine.map(x => ({ id: x.id, title: x.title, type: x.type, srcKey: x.src_key || '', url: `/s/${x.id}`, version: x.version || 1, at: x.updated_at })), limit: LIMITS.shared });
  });
  r.delete('/shared/:id', async (req, res) => {
    const a = ID_RE.test(req.params.id) ? await db.getDoc(shareDoc(req.params.id)).catch(() => null) : null;
    if (!a || a.uid !== req.user.uid) throw fail(404, 'Diese Veröffentlichung gibt es nicht (mehr).');
    await db.deleteDoc(shareDoc(a.id));
    res.json({ ok: true });
  });
  r.use((err, req, res, next) => { if (err.status) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) }); next(err); });
  return r;
}

// ---------- Öffentlich (ohne Login) ----------
function publicArtifactsRouter() {
  const r = wrapRouter(express.Router());
  const lim = rateLimit('pub-artifact', 240, 60, byIp);
  // für die Ansicht in Coden (#/s/<id>): Titel und fertiges Dokument
  r.get('/:id', lim, async (req, res) => {
    const a = await loadShared(req.params.id); if (!a) return res.status(404).json({ error: 'Dieses Artefakt gibt es nicht (mehr).' });
    res.set('Cache-Control', 'no-store').json({ id: a.id, title: a.title, type: a.type, author: a.author || '', html: a.html, body: a.body, version: a.version || 1 });
  });
  // geteilte Daten lesen (ein Schlüssel) – schreiben geht nur angemeldet
  r.get('/:id/store', lim, async (req, res) => {
    const a = await loadShared(req.params.id); if (!a) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.json({ item: await storeGet({ aid: a.id, key: cleanKey(req.query.key), shared: true }) });
  });
  r.use((err, req, res, next) => { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); });
  return r;
}

// /s/<id>: Hülle mit Kopfzeile und dem Artefakt in einem abgeschotteten Rahmen; /s/<id>/frame: das Artefakt selbst
const BRIDGE_PUBLIC = `(function(){var f=document.getElementById('art');var ID=f.dataset.id;var P='coden_art_'+ID+'_';
function reply(s,id,ok,v,e){s.postMessage({codenReply:id,ok:ok,value:v,error:e},'*')}
addEventListener('message',function(e){var d=e.data;if(!d||d.codenCall==null||e.source!==f.contentWindow)return;var a=d.args||{};var s=e.source;
try{if(d.op==='ask'){reply(s,d.codenCall,false,null,'KI-Funktionen gehen nur angemeldet. Öffne das Artefakt in Coden.');document.getElementById('open').classList.add('pulse');return}
if(a.shared){if(d.op==='get'){fetch('/api/public/artifacts/'+ID+'/store?key='+encodeURIComponent(a.key)).then(function(r){return r.json()}).then(function(j){reply(s,d.codenCall,true,j.item||null)}).catch(function(){reply(s,d.codenCall,false,null,'Nicht erreichbar')});return}
reply(s,d.codenCall,false,null,'Geteilte Daten ändern geht nur angemeldet. Öffne das Artefakt in Coden.');return}
var ls;try{ls=window.localStorage}catch(_){ls=null}
var m=ls||{_d:{},getItem:function(k){return k in this._d?this._d[k]:null},setItem:function(k,v){this._d[k]=String(v)},removeItem:function(k){delete this._d[k]},key:function(i){return Object.keys(this._d)[i]},get length(){return Object.keys(this._d).length}};
if(d.op==='get'){var v=m.getItem(P+a.key);reply(s,d.codenCall,true,v==null?null:{key:a.key,value:v,shared:false})}
else if(d.op==='set'){var val=typeof a.value==='string'?a.value:JSON.stringify(a.value);m.setItem(P+a.key,val);reply(s,d.codenCall,true,{key:a.key,value:val,shared:false})}
else if(d.op==='delete'){m.removeItem(P+a.key);reply(s,d.codenCall,true,{key:a.key,deleted:true,shared:false})}
else if(d.op==='list'){var k=[];for(var i=0;i<m.length;i++){var x=m.key(i);if(x&&x.indexOf(P+(a.prefix||''))===0)k.push(x.slice(P.length))}reply(s,d.codenCall,true,{keys:k.sort(),prefix:a.prefix||'',shared:false})}
else reply(s,d.codenCall,false,null,'Unbekannt')}catch(err){reply(s,d.codenCall,false,null,String(err&&err.message||err))}})})();`;
function wrapperPage(a) {
  const nonce = crypto.randomBytes(12).toString('base64');
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(a.title)} · Coden</title><meta property="og:title" content="${esc(a.title)}"><meta property="og:description" content="Mit Coden erstellt">
<link rel="icon" href="/images/coden_logo.jpg">
<style nonce="${nonce}">*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0f1115;color:#eceff4;font:14px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.bar{height:48px;display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid rgba(255,255,255,.08)}
.bar b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}.bar small{color:#8a93a3;white-space:nowrap}
.bar .legal-links{display:flex;align-items:center;gap:8px;font-size:12px;color:#8a93a3;white-space:nowrap}
.bar .legal-links a{color:#8a93a3;background:none;padding:0;border-radius:0;font-weight:500;font-size:12px}
.bar .legal-links a:hover{color:#eceff4;text-decoration:underline}
.bar a.cta{color:#0f1115;background:#eceff4;text-decoration:none;border-radius:999px;padding:6px 12px;font-weight:600;font-size:13px;white-space:nowrap}
.bar a.cta.pulse{animation:p 1s ease 3}@keyframes p{50%{background:#7cb3ff}}
iframe{display:block;width:100%;height:calc(100% - 48px);border:0;background:#fff}@media(max-width:680px){.bar small,.bar .legal-links .hide-sm{display:none}}</style></head>
<body><div class="bar"><b>${esc(a.title)}</b><small>Mit Coden (KI) erstellt${a.author ? ' von ' + esc(a.author) : ''}</small><nav class="legal-links" aria-label="Rechtliches"><a href="/?legal=impressum" target="_blank" rel="noopener">Impressum</a><a class="hide-sm" href="/?legal=datenschutz" target="_blank" rel="noopener">Datenschutz</a><a href="mailto:kayden.schunack@gmail.com?subject=${encodeURIComponent('Inhalt melden (Artefakt: ' + a.id + ')')}">Melden</a></nav><a id="open" class="cta" href="/#/s/${a.id}">In Coden öffnen</a></div>
<iframe id="art" data-id="${a.id}" src="/s/${a.id}/frame" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-pointer-lock" allow="fullscreen; autoplay" referrerpolicy="no-referrer" title="${esc(a.title)}"></iframe>
<script nonce="${nonce}">${BRIDGE_PUBLIC}</script></body></html>`;
  return { html, csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'` };
}
function sharedPageRouter() {
  const r = wrapRouter(express.Router({ strict: true }));
  const lim = rateLimit('pub-artifact-page', 240, 60, byIp);
  const notFound = (res) => res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Nicht gefunden · Coden</title><body style="font:16px system-ui;background:#0f1115;color:#eceff4;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-weight:600">Dieses Artefakt gibt es nicht (mehr).</h1><p><a style="color:#7cb3ff" href="/">Zu Coden</a></p></div>');
  r.get('/:id/frame', lim, async (req, res) => {
    const a = await loadShared(req.params.id); if (!a) return notFound(res);
    // eigener Ursprung (sandbox ohne allow-same-origin): das Artefakt kommt nie an Coden-Daten, auch direkt geöffnet nicht
    res.set('Content-Security-Policy', "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-pointer-lock; frame-ancestors 'self'")
      .set('X-Frame-Options', 'SAMEORIGIN').set('Referrer-Policy', 'no-referrer').set('Cache-Control', 'no-store').type('html').send(a.html);
  });
  r.get('/:id', lim, async (req, res) => {
    const a = await loadShared(req.params.id); if (!a) return notFound(res);
    const p = wrapperPage(a);
    res.set('Content-Security-Policy', p.csp).set('X-Frame-Options', 'DENY').set('Referrer-Policy', 'no-referrer').set('Cache-Control', 'no-store').type('html').send(p.html);
  });
  r.get('/:id/', (req, res) => res.redirect(301, `/s/${encodeURIComponent(req.params.id)}`));
  return r;
}

module.exports = { artifactsRouter, publicArtifactsRouter, sharedPageRouter, ask, LIMITS, _store: { storeGet, storeSet, storeList, storeDelete } };
