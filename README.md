# Coden AI

Frontend: statisches HTML/JS. Backend: Express (`api/index.js`) auf Vercel. Datenbank: Neon Postgres. Login: Firebase Auth (Token wird im Backend geprüft).

## Einrichtung (einmalig)
1. **Neon**: Neues Projekt auf neon.tech anlegen (eigener Free Tier, getrennt von Supabase). In der SQL-Konsole `db/schema.sql` ausführen. Connection-String kopieren.
2. **Firebase**: Projekteinstellungen > Dienstkonten > "Neuen privaten Schlüssel generieren". Den JSON-Inhalt als `FIREBASE_SERVICE_ACCOUNT` hinterlegen. Firestore wird nicht mehr gebraucht.
3. **Vercel** > Settings > Environment Variables: alle Werte aus `.env.example` eintragen, dann neu deployen.
4. Optional, einmalig: bestehende Chats aus Firestore übernehmen (aktuell nicht automatisch, neue Nutzer starten leer).

## Sicherheit
- Alle API-Keys liegen nur in Vercel-Umgebungsvariablen. Das Frontend bekommt nie einen Key.
- Jeder API-Aufruf braucht ein gültiges Firebase-Login-Token. Limits werden in der Datenbank gezählt.
- Admin-Befehle prüft der Server (`ADMIN_EMAIL`, E-Mail muss verifiziert sein).
- E-Mail-Passwörter und eigene Keys werden nie in der Datenbank gespeichert.
- Live-Call nutzt kurzlebige Einmal-Tokens statt des echten Google-Keys.
