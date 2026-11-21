const { getSql } = require('./db');

// Festes Zeitfenster, in der Datenbank gezählt (funktioniert über alle Serverless-Instanzen hinweg)
function rateLimit(name, max, windowSec) {
  return async (req, res, next) => {
    if (req.user?.isOwner) return next();
    try {
      const sql = getSql();
      const bucket = Math.floor(Date.now() / 1000 / windowSec);
      const key = `${name}:${req.user.uid}`;
      const rows = await sql`
        INSERT INTO rate_limits (key, bucket, count) VALUES (${key}, ${bucket}, 1)
        ON CONFLICT (key, bucket) DO UPDATE SET count = rate_limits.count + 1
        RETURNING count`;
      if (rows[0].count > max) {
        return res.status(429).json({ error: `Zu viele Anfragen. Bitte kurz warten.` });
      }
      // alte Einträge gelegentlich aufräumen
      if (Math.random() < 0.02) sql`DELETE FROM rate_limits WHERE bucket < ${bucket - 5}`.catch(() => {});
      next();
    } catch (e) {
      console.error('rateLimit', e);
      res.status(500).json({ error: 'Limit-Prüfung fehlgeschlagen.' });
    }
  };
}
module.exports = { rateLimit };
