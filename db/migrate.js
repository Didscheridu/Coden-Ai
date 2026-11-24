// Prüft Firebase-Konfiguration & Firestore-Verbindung (ersetzt das frühere Neon/Postgres-Schema-Skript).
// Start: npm run db:migrate
const fs = require('fs');
const path = require('path');
const { getConfig, ping } = require('../server/firestore');

(async () => {
  const cfg = getConfig();
  if (!cfg.projectId) {
    console.error('FIREBASE_PROJECT_ID / firebase-applet-config.json fehlt.');
    process.exit(1);
  }
  const rulesPath = path.join(__dirname, '..', 'firestore.rules');
  const hasRules = fs.existsSync(rulesPath);
  await ping();
  console.log(`Firebase Firestore ok (Projekt: ${cfg.projectId}, DB: ${cfg.databaseId}, Rules: ${hasRules ? 'vorhanden' : 'fehlen'}).`);
})().catch((e) => {
  console.error('Firebase-Prüfung fehlgeschlagen:', e.message);
  process.exit(1);
});
