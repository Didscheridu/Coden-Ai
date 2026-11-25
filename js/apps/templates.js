// js/apps/templates.js – Minimales leeres Startgerüst (From Scratch). Die KI baut das Design und den gesamten Inhalt komplett neu.
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const KINDS = {
    web: { label: 'Webseite', icon: 'language', desc: 'Läuft im Browser, mit eigener Coden-Adresse', devices: ['desktop', 'tablet', 'phone'] },
    ios: { label: 'iPhone-App', icon: 'phone_iphone', desc: 'Sieht aus und fühlt sich an wie eine iOS-App', devices: ['ios'] },
    android: { label: 'Android-App', icon: 'android', desc: 'Material-Look, als APK installierbar', devices: ['android'] },
    both: { label: 'iPhone + Android', icon: 'devices', desc: 'Eine App, passt sich jedem Handy an', devices: ['ios', 'android'] },
    game: { label: 'Spiel', icon: 'sports_esports', desc: 'Für PC und Handy, mit Touch-Steuerung und Sound', devices: ['desktop', 'landscape', 'phone'] }
};

function scratchWeb(name) {
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
  <main id="app" data-scratch="1"></main>
  <script src="coden-kit.js"></script>
  <script src="app.js"></script>
</body>
</html>
`,
        'style.css': `/* Leeres Start-Stylesheet – die KI gestaltet alles von Grund auf neu. */\n`,
        'app.js': `// Leeres Start-Skript – die KI baut die gesamte App von Grund auf neu.\n`
    };
}

function scratchMobile(name) {
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
  <div class="app" id="app" data-scratch="1"></div>
  <script src="coden-kit.js"></script>
  <script src="app.js"></script>
</body>
</html>
`,
        'style.css': `/* Leeres Start-Stylesheet – die KI gestaltet alles von Grund auf neu. */\n`,
        'app.js': `// Leeres Start-Skript – die KI baut die gesamte Mobile-App von Grund auf neu.\n`
    };
}

function scratchGame(name) {
    const n = esc(name);
    return {
        'index.html': `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <title>${n}</title>
  <link rel="stylesheet" href="coden-kit.css">
  <link rel="stylesheet" href="style.css">
</head>
<body class="game" data-scratch="1">
  <canvas id="game"></canvas>
  <script src="coden-kit.js"></script>
  <script src="game.js"></script>
</body>
</html>
`,
        'style.css': `html, body { height: 100%; margin: 0; overflow: hidden; touch-action: none; }\n`,
        'game.js': `// Leeres Spiel-Skript – die KI baut das gesamte Spiel von Grund auf neu.\n`
    };
}

export function scaffold(kind, name) {
    if (kind === 'game') return scratchGame(name);
    if (kind === 'web') return scratchWeb(name);
    return scratchMobile(name);
}

// Aus einem HTML-Artefakt eine Webseite machen
export function fromArtifact(title, html) {
    return { 'index.html': html.includes('<html') ? html : `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head><body>\n${html}\n</body></html>` };
}
