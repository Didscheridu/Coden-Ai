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

## Neu: Hintergrund-Läufe, Agententeam, Spiele, neuer Systemprompt

- **Hintergrund-Läufe** (`server/runs.js`, Tabelle `ai_runs`): Chat-Antworten (`POST /api/runs/chat`) und der App-Agent (`POST /api/apps/:id/agent`) laufen auf dem Server zu Ende – auch wenn die Seite geschlossen, der Chat gewechselt oder das Handy gesperrt wird (`waitUntil` von `@vercel/functions`). Der Stand wird alle 0,7 s gespeichert. Beim Öffnen (und alle 30 s, beim Zurückkehren in den Tab) holt Coden laufende und fertige Antworten ab (`GET /api/runs`, `/runs/:id`, `/runs/:id/claim`, `/runs/:id/stop`). Nur ein Gerät übernimmt eine fertige Antwort, es gibt keine doppelten Nachrichten. Mehrere Chats können gleichzeitig arbeiten.
- **Denk-Anzeige wie bei Claude/ChatGPT**: Timer („Denkt nach · 12 s“ → „Hat 34 s nachgedacht“), Liste der Denk-Schritte, Hinweis „du kannst die Seite schließen“, Knopf „Benachrichtigen“ (Browser-Benachrichtigung + ✓ im Tab-Titel, wenn Coden fertig ist), Lade-Symbol und Ungelesen-Punkt in der Seitenleiste.
- **Systemprompt** (`js/system-prompt.js`): ein Element-Katalog für alle Modelle – genau welcher Block welches Element erzeugt (Markdown, Tabellen, Formeln mit KaTeX, Hinweis-Kästen `> [!TIP]`, aufklappbare Details, Artefakte, KI-Bilder, Rückfragen mit Antwort-Knöpfen `<choices>`, Folgefragen `<suggestions>`) plus Qualitätsregeln.
- **Neue Artefakttypen**: `react` (JSX + Hooks + Tailwind), `mermaid` (Abläufe, Mindmaps, Zeitleisten …), `chart` (Chart.js-JSON), `table` (CSV → sortierbare, durchsuchbare Tabelle), `slides` (Präsentation aus Markdown), `python` (läuft im Browser über Pyodide, inkl. matplotlib). Das Artefakt-Fenster öffnet sich beim Schreiben automatisch und lässt sich in der Breite ziehen (Doppelklick = Standard).
- **Main Agent + Sub-Agenten im App-Builder** (`server/agents.js`, `server/agent-tools.js`, `shared/agent-core.js`): Der Nutzer spricht mit dem Main Agent – einem Coding-Agenten wie Claude Code / Codex / Gemini CLI. Er arbeitet in Schritten (bis 12): Code schreiben (`<file>`, `<edit>`, `<delete>`) und Werkzeuge nutzen: `list` (Glob), `read` (mit Zeilennummern), `search` (grep), `check` (Syntax, fehlende Dateien/Elemente), `fetch` (Webseite/Doku lesen, SSRF-geschützt), `web_search`, `memory` (Projektgedächtnis `CODEN.md`), `image`, `spawn` (Sub-Agenten), `done`, sichtbarer `<plan>`. Mit `spawn` startet er Spezial-Sub-Agenten (Kits, Modell je Schwierigkeit) parallel, liest danach ihre Ergebnisse und integriert/prüft selbst. Nach Änderungen prüft der Server automatisch und gibt Fehler an den Main Agent zurück. Modus: Auto (entscheidet selbst) / Team (immer Sub-Agenten) / Solo (ohne). Ein Lauf = eine Nachricht mit Werkzeug-Zeilen und Ergebnissen.
- **Spezial-Agenten mit Kits & Modell je Aufgabe**: Der Planer gibt jeder Team-Aufgabe einen Spezial-Agenten (Layout-Designer, Komponenten, Logik, Spiel, Daten, Text, Grafik – Kits in `shared/agent-core.js`) und eine Schwierigkeit. Leicht → Flash, mittel → gewähltes Modell, schwer → stärkstes erlaubtes (Ultra nur, wenn freigegeben). Im Team-Modus arbeiten immer mehrere Agenten. Modell, Denkaufwand und Modus lassen sich schon im Assistenten vor dem Erstellen wählen.
- **Apps löschen/verlassen**: Auf jeder App-Karte ein Löschen-Knopf (Besitzer, mit Bestätigung; ein laufender Agent wird gestoppt) bzw. „Verlassen“ (Mitglieder, `POST /api/apps/:id/leave`).
- **Spiele**: neuer App-Typ „Spiel“ mit 8 fertigen Vorlagen (Leeres Spiel, Jump & Run, Weltraum-Shooter, Breakout, Flatter-Vogel, Snake, 2048, Memory) und `Coden.game` im Kit: Spielschleife mit Skalierung, Tastatur/Maus/Touch-Joystick, Wischgesten, Sound ohne Dateien, Partikel, Screen-Shake, Rekorde.
- **Layout**: Chat-Spalte mit festen Rändern statt Prozent, flüssige Schriftgröße, echte Handy-Höhe (`dvh`, Safe Areas), Seitenleiste auf dem Handy zu und per Tipp daneben schließbar, Artefakte auf dem Handy als Vollbild-Blatt.
- Nach dem Update legt das Backend `ai_runs` und den neuen App-Typ selbst an (`db/schema.sql`, idempotent).

## Streaming, Artefakte, Code Buddy

- **Live-Streaming**: `POST /api/chat/stream` (Server-Sent Events). Die Antwort erscheint beim Schreiben; der Senden-Button wird währenddessen zu „Stopp".
- **Artefakte**: Coden packt Webseiten, SVGs, Dokumente und größeren Code in `<artifact …>`-Blöcke. Sie öffnen sich rechts (Vorschau/Code, Kopieren, Download, Vollbild, Versionen). HTML läuft in einer Sandbox ohne Netzwerk und ohne Zugriff auf Login oder Daten.
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
