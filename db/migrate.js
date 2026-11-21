// Spielt db/schema.sql ein. Nutzt die DIREKTE Verbindung (ohne Pooler), wie von Neon für Migrationen empfohlen.
// Start:  npm run db:migrate   (liest .env.local, siehe package.json)
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL_UNPOOLED / DATABASE_URL fehlt (neon env pull ausgeführt?)'); process.exit(1); }
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const { rows } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1");
  console.log('Schema ok. Tabellen:', rows.map(r => r.table_name).join(', '));
  await client.end();
})().catch(e => { console.error('Migration fehlgeschlagen:', e.message); process.exit(1); });
