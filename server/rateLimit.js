// In-Memory-Rate-Limiting pro Zeitfenster (keine Postgres-Abhängigkeit)
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
const byIp = clientIp;

const buckets = new Map(); // `${name}:${subject}` -> { bucket, count }

function prune(nowBucketMap) {
  if (buckets.size <= 5000) return;
  for (const [k, v] of buckets.entries()) {
    if (v.expiresAt < Date.now()) buckets.delete(k);
  }
  void nowBucketMap;
}

function rateLimit(name, max, windowSec, keyFn = req => req.user.uid) {
  return (req, res, next) => {
    if (req.user?.isOwner) return next();
    try {
      const now = Date.now();
      const bucket = Math.floor(now / 1000 / windowSec);
      const key = `${name}:${keyFn(req)}`;
      const cur = buckets.get(key);
      let count = 1;
      if (cur && cur.bucket === bucket) {
        count = cur.count + 1;
        cur.count = count;
      } else {
        buckets.set(key, { bucket, count: 1, expiresAt: (bucket + 2) * windowSec * 1000 });
      }
      if (count > max) {
        return res.status(429).json({ error: 'Zu viele Anfragen. Bitte kurz warten.' });
      }
      if (Math.random() < 0.02) prune();
      next();
    } catch (e) {
      console.error('rateLimit', e);
      res.status(500).json({ error: 'Limit-Prüfung fehlgeschlagen.' });
    }
  };
}

function _clearRateLimits() {
  buckets.clear();
}

module.exports = { rateLimit, byIp, _clearRateLimits };
