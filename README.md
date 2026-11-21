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

## Neu: Streaming, Artefakte, Code Buddy

- **Live-Streaming**: `POST /api/chat/stream` (Server-Sent Events). Die Antwort erscheint beim Schreiben; der Senden-Button wird währenddessen zu „Stopp".
- **Artefakte**: Coden packt Webseiten, SVGs, Dokumente und größeren Code in `<artifact …>`-Blöcke. Sie öffnen sich rechts (Vorschau/Code, Kopieren, Download, Vollbild, Versionen). HTML läuft in einer Sandbox ohne Netzwerk und ohne Zugriff auf Login oder Daten.
- **Kontingent**: `gemini-4-hydrogen` und `gemini-3.8-flash` stehen ganz hinten in der Kaskade (letzte Rettung). Pro Tag (Pacific-Zeit) maximal 20 Aufrufe, davon 10 für alle Nutzer, die übrigen 10 nur für den Owner. Einstellbar über `GEMINI_*`-Variablen (siehe `.env.example`).
- **Code Buddy**: Profil mit @Handle, Freundschaftsanfragen, Direktnachrichten und gemeinsame Projekte (Dateien mit Versionsprüfung, Projekt-Chat). Alle Rechte werden im Backend geprüft (`server/buddy.js`). Nach dem Update einmal `npm run db:migrate` ausführen.
- Tests: `npm test` (Backend, Kontingent, Streaming, Code Buddy gegen echtes Postgres in WASM).

## Neu: Apps (App-Builder)

Oben in der Seitenleiste gibt es den Tab **Apps** (`#/apps`). Dort baut man mit Coden echte Webseiten und Handy-Apps:

1. **Typ wählen**: Webseite, iPhone-App, Android-App oder iPhone + Android.
2. **Stil wählen** (optional): 20 Stile (Minimal, Glas, Cupertino, Material You, Retro 8-Bit, Neon Cyberpunk …) aus `shared/app-styles.js`.
3. **Bauen**: links der Chat mit dem Coden-Agenten, rechts die Live-Vorschau im iPhone-, Android- oder Browser-Rahmen, dazu Code-Ansicht und Konsole.

**Der Agent** (`js/apps/agent.js`) schreibt Dateien selbst (`<file>`, `<edit>`, `<delete>`), zeigt einen Plan und kann Werkzeuge aufrufen, die im Chat als Karte erscheinen:
`database` (Supabase, Firebase, Appwrite, PocketBase, MongoDB über API, Neon, InstantDB, eigene API oder nur lokal – geheime Schlüssel wie `service_role` werden abgelehnt), `ask` (Frage mit Antwortknöpfen), `secret` (öffentlicher API-Schlüssel) und `publish`. Nach jeder Änderung prüft Coden die Vorschau auf Fehler und korrigiert sich bis zu zweimal selbst.

**Grundgerüst**: Jede App baut auf dem Coden-Kit auf (`kit/coden-kit.css`, `kit/coden-kit.js`: Bildschirme, Tabbar, Sheets, Toasts, Speicher, Datenbank-Helfer). `shared/app-bundle.js` macht daraus eigenständige Seiten – im Browser für die Vorschau, im Backend für die veröffentlichte App.

**Adresse & Handy**:
- Jede App hat sofort einen geheimen **Testlink** (`/a/<adresse>/?t=…`) mit QR-Code. Auf dem Handy aktualisiert er sich live und lässt sich als App installieren (Manifest, Symbole, Service Worker).
- **Veröffentlichen** gibt der App eine öffentliche Coden-Adresse `/a/<adresse>/`, die jeder öffnen kann. Weiter bearbeiten geht jederzeit.
- Apps laufen in einer Sandbox (eigener, undurchsichtiger Ursprung) und kommen nie an Coden-Logins oder Daten.
- **Android-APK**: `.github/workflows/build-apk.yml` baut eine schlanke WebView-Hülle (`android-shell/`) mit Name, Symbol und Farbe der App und legt sie als GitHub-Release `apk-<adresse>` ab. Die APK lädt immer die neueste Fassung.

**Gemeinsam bauen**: Im Builder „Einladen“ – Code-Buddy-Freunde sehen Chat, Vorschau und Code und bauen mit (Abfrage alle 3 s).

**Artefakte** und **Code Buddy** sind jetzt richtige Tabs (`#/artefakte`, `#/buddy`) mit Zurück-Knopf, Esc und Browser-Zurück. Ein HTML-Artefakt lässt sich mit „Als App“ in den App-Builder übernehmen.

### Einrichtung
- Nach dem Update einmal `npm run db:migrate` (neue Tabellen `apps`, `app_members`, `app_messages`).
- Optional für APKs in Vercel: `GH_APK_TOKEN` (Fine-grained Token für dieses Repo mit *Actions: write* und *Contents: write*), optional `GH_APK_REPO` (Standard `Didscheridu/Coden-Ai`) und `GH_APK_REF` (Standard `main`). Für gleichbleibende Signaturen (Updates ohne Neuinstallation) in GitHub die Secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD` und optional `ANDROID_KEY_ALIAS` setzen.
- Optional `PUBLIC_APP_BASE` (z. B. `https://coden-ai.vercel.app`), falls die öffentliche Adresse anders lauten soll als die des Servers.
- Tests: `npm test` (jetzt auch `test/apps.test.js`).
