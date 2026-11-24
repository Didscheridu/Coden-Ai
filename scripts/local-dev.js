// Local / AI Studio dev server only (ignored by Vercel via .vercelignore).
const path = require('path');
const express = require('express');
const apiApp = require('../api/index.js');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Mount existing Express API (/api/*) and hosted apps (/a/*)
app.use(apiApp);

// Serve only public frontend directories and root web assets
const root = path.join(__dirname, '..');
for (const dir of ['css', 'js', 'images', 'kit', 'shared']) {
  app.use(`/${dir}`, express.static(path.join(root, dir)));
}

app.get('/manifest.webmanifest', (req, res) => {
  res.sendFile(path.join(root, 'manifest.webmanifest'));
});
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(root, 'sw.js'));
});
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(root, 'index.html'));
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Coden AI server listening on http://0.0.0.0:${PORT}`);
});
