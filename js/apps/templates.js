// js/apps/templates.js – Startgerüst je App-Typ. Sieht mit jedem Stil sofort gut aus; Coden baut darauf auf.
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const KINDS = {
    web: { label: 'Webseite', icon: 'language', desc: 'Läuft im Browser, mit eigener Coden-Adresse', devices: ['desktop', 'tablet', 'phone'] },
    ios: { label: 'iPhone-App', icon: 'phone_iphone', desc: 'Sieht aus und fühlt sich an wie eine iOS-App', devices: ['ios'] },
    android: { label: 'Android-App', icon: 'android', desc: 'Material-Look, als APK installierbar', devices: ['android'] },
    both: { label: 'iPhone + Android', icon: 'devices', desc: 'Eine App, passt sich jedem Handy an', devices: ['ios', 'android'] }
};

function mobile(name) {
    const n = esc(name);
    return {
        'index.html': `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${n}</title>
  <link rel="stylesheet" href="coden-kit.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="app">
    <header class="appbar">
      <button class="appbar-btn hidden" data-back aria-label="Zurück"><span class="ms">arrow_back_ios_new</span></button>
      <h1 class="appbar-title">${n}</h1>
      <button class="appbar-btn" data-open-sheet="info" aria-label="Info"><span class="ms">info</span></button>
    </header>

    <main class="screens">
      <section class="screen active" id="home" data-title="${n}">
        <h2 class="large-title">Hallo 👋</h2>
        <div class="card stack fade-in">
          <div class="row"><span class="avatar"><span class="ms">auto_awesome</span></span><div class="grow"><b>Deine neue App</b><div class="small muted">Sag Coden im Chat, was sie können soll.</div></div></div>
          <button class="btn btn-primary btn-block" id="hello"><span class="ms">celebration</span>Ausprobieren</button>
        </div>
        <p class="section-title">Schnellzugriff</p>
        <div class="list">
          <button class="item tap" data-go="detail"><span class="ms">bolt</span><span class="grow"><b>Erste Funktion</b><small>Öffnet eine Unterseite</small></span><span class="ms muted">chevron_right</span></button>
          <button class="item tap" data-go="explore"><span class="ms">explore</span><span class="grow"><b>Entdecken</b><small>Zweiter Tab</small></span><span class="ms muted">chevron_right</span></button>
        </div>
      </section>

      <section class="screen" id="explore" data-title="Entdecken">
        <div class="chips"><span class="chip active">Alle</span><span class="chip">Neu</span><span class="chip">Beliebt</span></div>
        <div class="grid" style="--min:150px;margin-top:14px">
          <div class="card tap"><span class="ms">star</span><h3>Idee 1</h3><p class="small muted">Kurze Beschreibung</p></div>
          <div class="card tap"><span class="ms">favorite</span><h3>Idee 2</h3><p class="small muted">Kurze Beschreibung</p></div>
        </div>
      </section>

      <section class="screen" id="settings" data-title="Einstellungen">
        <p class="section-title">Allgemein</p>
        <div class="list">
          <label class="item"><span class="ms">notifications</span><span class="grow"><b>Mitteilungen</b></span><input type="checkbox" class="switch" id="opt-notify"></label>
          <label class="item"><span class="ms">vibration</span><span class="grow"><b>Vibration</b></span><input type="checkbox" class="switch" id="opt-haptic" checked></label>
        </div>
      </section>

      <section class="screen" id="detail" data-title="Details">
        <div class="empty"><span class="ms">construction</span>Hier entsteht deine erste Funktion.</div>
      </section>
    </main>

    <nav class="tabbar">
      <button class="tab active" data-go="home"><span class="ms">home</span>Start</button>
      <button class="tab" data-go="explore"><span class="ms">explore</span>Entdecken</button>
      <button class="tab" data-go="settings"><span class="ms">settings</span>Einstellungen</button>
    </nav>
  </div>

  <div class="sheet" id="info">
    <h3>${n}</h3>
    <p class="muted">Gebaut mit Coden.</p>
    <button class="btn btn-block" data-close-sheet>Schließen</button>
  </div>

  <script src="coden-kit.js"></script>
  <script src="app.js"></script>
</body>
</html>
`,
        'style.css': `/* Eigene Anpassungen. Farben und Schrift kommen aus dem Stil (z. B. var(--c-primary)). */
.list .item > .ms:first-child { color: var(--c-primary); }
`,
        'app.js': `// Logik der App. Coden-Kit: Coden.go('id'), Coden.toast('…'), Coden.store.get/set, Coden.sheet.open('id')
const settings = Coden.store.get('settings', { notify: false, haptic: true });
document.getElementById('opt-notify').checked = settings.notify;
document.getElementById('opt-haptic').checked = settings.haptic;
document.getElementById('opt-notify').addEventListener('change', (e) => { settings.notify = e.target.checked; Coden.store.set('settings', settings); });
document.getElementById('opt-haptic').addEventListener('change', (e) => { settings.haptic = e.target.checked; Coden.store.set('settings', settings); });

document.getElementById('hello').addEventListener('click', () => {
  if (settings.haptic) Coden.haptic();
  Coden.toast('Es funktioniert! 🎉');
});
`
    };
}

function web(name) {
    const n = esc(name);
    return {
        'index.html': `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${n}</title>
  <meta name="description" content="${n} – gebaut mit Coden">
  <link rel="stylesheet" href="coden-kit.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <nav class="site-nav">
    <div class="container">
      <a class="brand" href="index.html"><span class="avatar" style="width:32px;height:32px"><span class="ms">bolt</span></span>${n}</a>
      <button class="btn btn-ghost btn-icon nav-toggle" aria-label="Menü"><span class="ms">menu</span></button>
      <div class="nav-links">
        <a href="#features">Funktionen</a>
        <a href="#about">Über uns</a>
        <a class="btn btn-primary btn-sm" href="#kontakt">Kontakt</a>
      </div>
    </div>
  </nav>

  <header class="hero">
    <div class="container">
      <span class="eyebrow">Willkommen</span>
      <h1>${n} – <span class="gradient-text">einfach gut.</span></h1>
      <p class="lead">Das ist das Grundgerüst deiner Webseite. Sag Coden im Chat, worum es gehen soll – Texte, Bilder und Seiten kommen dann von selbst.</p>
      <div class="row wrap" style="margin-top:26px">
        <a class="btn btn-primary btn-lg" href="#kontakt">Jetzt starten</a>
        <a class="btn btn-outline btn-lg" href="#features">Mehr erfahren</a>
      </div>
    </div>
  </header>

  <section class="section alt" id="features">
    <div class="container">
      <div class="section-head"><span class="eyebrow">Funktionen</span><h2>Was dich erwartet</h2></div>
      <div class="grid" style="--min:240px">
        <div class="card feature"><span class="ms">rocket_launch</span><h3>Schnell</h3><p class="muted">Lädt in einem Augenblick, auf jedem Gerät.</p></div>
        <div class="card feature"><span class="ms">palette</span><h3>Schön</h3><p class="muted">Ein Stil, der zu dir passt.</p></div>
        <div class="card feature"><span class="ms">favorite</span><h3>Persönlich</h3><p class="muted">Inhalte, die genau zu dir passen.</p></div>
      </div>
    </div>
  </section>

  <section class="section" id="about">
    <div class="container grid-2" style="align-items:center">
      <div><span class="eyebrow">Über uns</span><h2>Eine kurze Geschichte</h2><p class="muted">Erzähl hier, wer du bist und was dich antreibt.</p></div>
      <div class="card" style="min-height:220px;background:var(--c-gradient)"></div>
    </div>
  </section>

  <section class="section" id="kontakt">
    <div class="container">
      <div class="cta">
        <h2>Lust auf mehr?</h2>
        <p>Schreib uns – wir melden uns schnell.</p>
        <a class="btn btn-lg" id="contact-btn" href="#kontakt">Kontakt aufnehmen</a>
      </div>
    </div>
  </section>

  <footer class="site-footer">
    <div class="container"><span>© <span id="year"></span> ${n}</span><span>Gebaut mit Coden</span></div>
  </footer>

  <script src="coden-kit.js"></script>
  <script src="app.js"></script>
</body>
</html>
`,
        'style.css': `/* Eigene Anpassungen. Farben und Schrift kommen aus dem Stil (z. B. var(--c-primary)). */
html { scroll-behavior: smooth; }
`,
        'app.js': `// Logik der Webseite. Coden-Kit: Coden.toast('…'), Coden.store.get/set, Coden.fmt.date(…)
document.getElementById('year').textContent = new Date().getFullYear();
document.getElementById('contact-btn').addEventListener('click', (e) => {
  e.preventDefault();
  Coden.toast('Danke! Wir melden uns. ✉️');
});
`
    };
}

export function scaffold(kind, name) { return kind === 'web' ? web(name) : mobile(name); }

// Aus einem HTML-Artefakt eine Webseite machen
export function fromArtifact(title, html) {
    return { 'index.html': html.includes('<html') ? html : `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head><body>\n${html}\n</body></html>` };
}
