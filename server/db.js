// Postgres (Neon) über node-postgres, wie von Neon für Vercel empfohlen.
// Nutzung als Tagged Template: await sql`SELECT * FROM t WHERE id = ${id}`  -> Array von Zeilen
const { Pool } = require('pg');

let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL fehlt');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    pool.on('error', (e) => console.error('pg pool', e.message));
    try { require('@vercel/functions').attachDatabasePool(pool); } catch (e) { /* lokal ohne Vercel */ }
  }
  return pool;
}

function getSql() {
  return async (strings, ...values) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
    const res = await getPool().query(text, values);
    return res.rows;
  };
}

module.exports = { getSql, getPool };
