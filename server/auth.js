// Anmeldung läuft über Firebase Auth. Das Backend prüft nur das Firebase-ID-Token
// (Signatur über Googles öffentliche Schlüssel) - dafür ist kein geheimer Schlüssel nötig.
const { createRemoteJWKSet, jwtVerify } = require('jose');

const PROJECT_ID = () => process.env.FIREBASE_PROJECT_ID || 'coden-4561f';
const JWKS_URL = () => process.env.FIREBASE_JWKS_URL || 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let jwks;
const getJwks = () => (jwks ||= createRemoteJWKSet(new URL(JWKS_URL())));

const adminEmail = () => (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Nicht eingeloggt.' });
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://securetoken.google.com/${PROJECT_ID()}`,
      audience: PROJECT_ID(),
      algorithms: ['RS256']
    });
    if (!payload.sub) throw new Error('kein sub');
    const email = (payload.email || '').toLowerCase();
    req.user = {
      uid: payload.sub,
      email: payload.email || null,
      // Owner nur mit bestätigter E-Mail (Google-Login oder angeklickter Bestätigungslink)
      isOwner: !!adminEmail() && payload.email_verified === true && email === adminEmail()
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
