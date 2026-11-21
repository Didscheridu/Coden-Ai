# Coden AI

Frontend: statisches HTML/JS. Backend: Express (`api/index.js`) auf Vercel. **Alle Daten liegen in Neon Postgres.** Firebase wird nur für das Login (E-Mail/Passwort und Google) genutzt.

## Einrichtung (einmalig)
1. **Neon**: `neon login`, dann `neon deploy` (schreibt `DATABASE_URL` und `DATABASE_URL_UNPOOLED` in `.env.local`). Danach `npm install` und `npm run db:migrate`. Tests: `npm test` (echtes Postgres über PGlite).
2. **Vercel** > Settings > Environment Variables: alle Werte aus `.env.example` eintragen, danach neu deployen.
3. **Admin**: Mit `ADMIN_EMAIL` per Google anmelden (oder per E-Mail registrieren und den Bestätigungslink anklicken). Ohne bestätigte E-Mail gilt niemand als Admin.

Das Backend braucht keinen Firebase-Schlüssel: Es prüft die Login-Tokens über Googles öffentliche Schlüssel.

## Sicherheit
- Alle API-Keys liegen nur in Vercel-Umgebungsvariablen, das Frontend bekommt nie einen Key.
- Jeder API-Aufruf braucht ein gültiges Firebase-Login-Token. Limits werden in Neon gezählt.
- Admin-Befehle prüft der Server (`ADMIN_EMAIL` plus bestätigte Adresse).
- E-Mail-Passwörter und eigene Keys werden nie in der Datenbank gespeichert.
- Live-Call nutzt kurzlebige Einmal-Tokens statt des echten Google-Keys.
