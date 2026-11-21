// Legt fehlende Tabellen selbst an (db/schema.sql besteht nur aus CREATE ... IF NOT EXISTS, ist also gefahrlos wiederholbar).
// So funktionieren neue Funktionen auch dann, wenn "npm run db:migrate" nach einem Update noch nicht gelaufen ist.
const fs = require('fs');
const path = require('path');
const { getPool } = require('./db');

let done = null;
function ensureSchema() {
  if (!done) {
    done = getPool().query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'))
      .then(() => true)
      .catch((e) => { done = null; console.error('ensureSchema:', e.message); return false; });
  }
  return done;
}
module.exports = { ensureSchema };
