# Coden AI

Frontend: statisches HTML/JS. Backend: Express (`api/index.js`) auf Vercel. Datenbank und Benutzerkonten: Neon Postgres. Kein Firebase mehr.

## Einrichtung (einmalig)
1. **Neon**: `neon login`, dann `neon deploy` (schreibt `DATABASE_URL` und `DATABASE_URL_UNPOOLED` in `.env.local`). Danach `npm install` und `npm run db:migrate` (spielt `db/schema.sql` über die direkte Verbindung ein). Tests: `npm test` (echtes Postgres über PGlite).
2. **Vercel** > Settings > Environment Variables: alle Werte aus `.env.example` eintragen (`DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_SETUP_CODE`, die KI-Keys), danach neu deployen.
3. **Admin-Konto**: Mit `ADMIN_EMAIL` registrieren. Die App fragt dabei nach dem `ADMIN_SETUP_CODE`.
4. Optional **Google-Login**: In der Google Cloud Console eine OAuth-Client-ID (Webanwendung) mit deiner Vercel-Domain als "Autorisierte JavaScript-Quelle" anlegen und als `GOOGLE_CLIENT_ID` eintragen. Ohne die Variable wird der Google-Button nicht angezeigt.

## Sicherheit
- Alle API-Keys liegen nur in Vercel-Umgebungsvariablen, das Frontend bekommt nie einen Key.
- Passwörter werden mit bcrypt gehasht. Die Sitzung ist ein httpOnly-Cookie (kein Zugriff per JavaScript).
- Login, Registrierung und alle KI-Routen haben Limits, die in der Datenbank gezählt werden.
- Admin-Befehle prüft der Server (`ADMIN_EMAIL` plus bestätigte Adresse).
- E-Mail-Passwörter und eigene Keys werden nie in der Datenbank gespeichert.
- Live-Call nutzt kurzlebige Einmal-Tokens statt des echten Google-Keys.
