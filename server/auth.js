const admin = require('firebase-admin');

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT fehlt');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

// Prüft das Firebase-ID-Token aus "Authorization: Bearer <token>"
async function requireAuth(req, res, next) {
  try {
    init();
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Nicht eingeloggt.' });
    const decoded = await admin.auth().verifyIdToken(token);
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      // Owner nur mit verifizierter E-Mail, serverseitig entschieden
      isOwner: !!adminEmail && decoded.email_verified === true && (decoded.email || '').toLowerCase() === adminEmail
    };
    next();
  } catch (e) {
    res.status(401).json({ error: 'Ungültiges oder abgelaufenes Login.' });
  }
}

function requireOwner(req, res, next) {
  if (!req.user?.isOwner) return res.status(403).json({ error: 'Zugriff verweigert.' });
  next();
}

module.exports = { requireAuth, requireOwner };
