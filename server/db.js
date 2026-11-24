// Postgres (Neon) über node-postgres, wie von Neon für Vercel empfohlen.
// Nutzung als Tagged Template: await sql`SELECT * FROM t WHERE id = ${id}`  -> Array von Zeilen
const { Pool } = require('pg');

let pool;

function createFallbackPool() {
  let dbPromise = null;
  const getDb = () => {
    if (!dbPromise) {
      dbPromise = import('@electric-sql/pglite')
        .then(({ PGlite }) => new PGlite())
        .catch((err) => {
          console.warn('[AI Studio] PGlite unavailable, using no-op DB mock:', err.message);
          return null;
        });
    }
    return dbPromise;
  };
  console.warn('[AI Studio] DATABASE_URL not set — using in-memory PGlite database');
  return {
    on() {},
    async query(text, values) {
      const db = await getDb();
      if (!db) return { rows: [] };
      if (values && values.length) return db.query(text, values);
      if (text.includes(';\n') || /;\s*\S/.test(text)) {
        await db.exec(text);
        return { rows: [] };
      }
      return db.query(text, values);
    }
  };
}

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      pool = createFallbackPool();
    } else {
      pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
      pool.on('error', (e) => console.error('pg pool', e.message));
      try { require('@vercel/functions').attachDatabasePool(pool); } catch (e) { /* lokal ohne Vercel */ }
    }
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
