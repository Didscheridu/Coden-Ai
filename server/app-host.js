// Hülle für veröffentlichte Apps (läuft im Browser auf /a/<slug>/). Lädt die Seiten der App und zeigt sie in einem
// Sandbox-iframe (eigener, undurchsichtiger Ursprung). Speichert localStorage der App getrennt unter "codenapp:<slug>:".
// Das Backend bettet diese Funktion als Text in die Seite ein (module.exports unten).
function codenHost() {
  var C = window.__CODEN_APP__, f = document.getElementById('f'), ld = document.getElementById('ld'), er = document.getElementById('er'), lv = document.getElementById('lv');
  var THUMB = /[?&]thumb=1/.test(location.search), NS = 'codenapp:' + C.slug + ':', MARK = '{/*__CODEN_STORE__*/}', data = null, page = C.page || '', version = 0, lvTimer = 0;
  function snapshot() { var o = {}; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(NS) === 0) o[k.slice(NS.length)] = localStorage.getItem(k); } } catch (e) {} return o; }
  function api(p) { var q = C.t ? (p.indexOf('?') > -1 ? '&' : '?') + 't=' + encodeURIComponent(C.t) : ''; return fetch('/api/public/apps/' + C.slug + p + q, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); }); }
  function urlFor(p) { return '/a/' + C.slug + '/' + (p && p !== data.entry ? p : '') + (C.t ? '?t=' + encodeURIComponent(C.t) : '') + (/[?&]shell=android/.test(location.search) ? (C.t ? '&' : '?') + 'shell=android' : ''); }
  function render(p) {
    if (!data) return; var name = p && data.pages[p] ? p : data.entry; page = name;
    f.srcdoc = data.pages[name].replace(MARK, function () { return JSON.stringify(snapshot()).replace(/</g, '\\u003c'); });
  }
  function flash(t, ms) { lv.textContent = t; lv.style.display = 'block'; clearTimeout(lvTimer); lvTimer = setTimeout(function () { lv.style.display = 'none'; }, ms || 2200); }
  window.addEventListener('message', function (e) {
    if (e.source !== f.contentWindow || !e.data || e.data.__coden !== 1) return; var m = e.data;
    if (m.t === 'store') { try { if (m.v === null) localStorage.removeItem(NS + m.k); else if (String(m.k).length < 300 && String(m.v).length < 600000) localStorage.setItem(NS + m.k, String(m.v)); } catch (x) {} }
    else if (m.t === 'store-clear') { Object.keys(snapshot()).forEach(function (k) { try { localStorage.removeItem(NS + k); } catch (x) {} }); }
    else if (m.t === 'nav' && data) { var p = String(m.page || '').replace(/^\.?\//, ''); if (!data.pages[p]) p = data.entry; history.pushState({ p: p }, '', urlFor(p)); render(p); }
    else if (m.t === 'ready') { ld.style.display = 'none'; if (m.title) document.title = m.title; }
  });
  f.addEventListener('load', function () { ld.style.display = 'none'; });
  window.addEventListener('popstate', function (e) { render((e.state && e.state.p) || ''); });
  function load(first) {
    return api('').then(function (d) {
      data = d; version = d.version;
      if (first) { var p = page && d.pages[page] ? page : d.entry; if (!THUMB) history.replaceState({ p: p }, '', urlFor(p)); page = p; }
      render(page);
    });
  }
  load(true).catch(function () { ld.style.display = 'none'; er.style.display = 'flex'; er.textContent = 'Die App konnte nicht geladen werden. Prüfe deine Internetverbindung und lade neu.'; });
  if (C.preview && !THUMB) {
    setTimeout(function () { flash('Testversion · Änderungen aus Coden erscheinen live', 3500); }, 800);
    setInterval(function () { if (document.hidden) return; api('/version').then(function (v) { if (v.version !== version) load(false).then(function () { flash('Aktualisiert ✨'); }); }).catch(function () {}); }, 2500);
  }
  if (!THUMB && 'serviceWorker' in navigator) navigator.serviceWorker.register('/a/' + C.slug + '/sw.js', { scope: '/a/' + C.slug + '/' }).catch(function () {});
  setTimeout(function () { var cb = document.getElementById('cb'); if (cb) cb.className = 'fade'; }, 6000);
  if (THUMB || /[?&]shell=/.test(location.search)) { var cb = document.getElementById('cb'); if (cb) cb.remove(); }
}
module.exports = '(' + codenHost.toString() + ')();';
