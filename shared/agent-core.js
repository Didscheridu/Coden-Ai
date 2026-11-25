// shared/agent-core.js – das Gehirn des App-Agenten: Systemprompt, Antwort zerlegen (Dateien, Änderungen, Werkzeuge),
// Änderungen anwenden, statische Prüfung. Läuft im Browser (window.CodenAgent) UND auf dem Server (require),
// damit der Agent auch dann weiterbaut, wenn die Seite geschlossen ist.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api; else root.CodenAgent = api;
})(typeof self !== 'undefined' ? self : this, function () {
const GAME_KIT = `
- SPIELE (Coden.game, schon eingebunden):
  const g = Coden.game.create({ canvas: '#game', width: 960, height: 540, fit: 'contain', background: '#0b1020' }) → passt sich jedem Bildschirm an (g.ctx, g.w, g.h, g.scale).
  g.loop((dt, t) => { update(dt); draw(g.ctx); }) · g.pause() · g.resume() · g.paused · dt in Sekunden (max. 0,05).
  Eingabe: Coden.game.keys (Set mit 'ArrowLeft', 'KeyA', 'Space' …) · Coden.game.pressed('Space') (einmal pro Druck) · Coden.game.axis() → {x, y} aus Pfeilen/WASD/Joystick · Coden.game.pointer {x, y, down} in Spielkoordinaten.
  Touch: Coden.game.touchControls({ joystick: true, buttons: [{ key: 'Space', label: 'A' }] }) blendet auf Handys Joystick + Knöpfe ein.
  Sound ohne Dateien: Coden.game.sfx('jump' | 'coin' | 'hit' | 'shoot' | 'boom' | 'win' | 'lose' | 'click'), Coden.game.music(true/false).
  Hilfen: Coden.game.hit(a, b) (Rechtecke {x,y,w,h}), Coden.game.dist(a, b), Coden.game.rand(min, max), Coden.game.clamp(v, a, b), Coden.game.lerp(a, b, t), Coden.game.particles(ctx) → .burst(x, y, {color, n}) / .update(dt) / .draw().
  Highscore: Coden.game.best('key', punkte) speichert und liefert den Rekord. Screens: Coden.game.overlay('#menu').show()/.hide().
  Spiele-Qualität: Startbildschirm, Pause (Taste P / Knopf), Game Over mit Punkten und Rekord, Neustart, steigende Schwierigkeit, Partikel/Screen-Shake als Feedback, klare Farben, 60 FPS, kein Lag.`;

const THREE_KIT = `
- 3D (Coden.three, schon im Kit – baut fertige, schöne 3D-Modelle; du musst KEINE Modelle aus einzelnen Würfeln zusammenbasteln):
  three.js im <head> oder VOR deinen Skripten einbinden: <script src="https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"></script> (genau diese Version, klassisches Skript, KEIN import/type="module"; danach gibt es die globale Variable THREE). Sicherheitsnetz: Coden.three.ready(() => { …ganzes Spiel… }) lädt three.js notfalls nach.
  Welt: const w = Coden.three.world({ canvas: '#scene' (optional, sonst Vollbild), skyTop, skyBottom, fogFar: 500, ground: true, groundColor, shadows: true }) → w.scene, w.camera, w.renderer, w.sun, w.add(obj), w.remove(obj), w.loop((dt, t) => …), w.pause()/resume(), w.follow(obj, { distance: 9, height: 3.6, lookAhead: 6 }) (Verfolger-Kamera), w.orbit({ distance: 30 }) (Drehen/Zoomen per Maus/Touch), w.sunFollow(obj) (Schatten folgen dem Spieler).
  Modelle (Meter, vorne = -Z, alles mit Schatten): Coden.three.car({ type: 'sport'|'muscle'|'suv'|'hatch'|'truck'|'police'|'taxi'|'kart'|'f1', color: 0xd62828, number: 7 }), tree({ type: 'pine'|'round'|'palm'|'autumn', height }), rock({ size }), cloud({ x, y, z }), building({ width, depth, height, night }), house({ color, roof }), lamp(), cone(), barrier({ length }), coin() (dreht sich mit Coden.three.animate(liste, t)), checkpoint({ radius, color }), character({ color, skin }) + Coden.three.walk(figur, t, speed).
  Strecken & Welten: const trk = Coden.three.track({ preset: 'circuit'|'oval'|'figure8'|'city', width: 16 } oder { points: [[x,z], …] }); w.add(trk); trk.decorate(w, 0.6) (Bäume/Lampen am Rand); trk.grid(6) → Startplätze [{ position, rotationY }]; trk.nearest(pos, hint) → { u (Fortschritt 0..1), dist }; trk.onTrack(pos); trk.pointAt(u); trk.checkpoints(8); trk.length.
  Stadt: const c = Coden.three.city({ blocks: 5, night: false }); w.add(c); c.spawn() → { position, rotationY }; c.boxes (Gebäude für Kollision); c.onRoad(pos). Gelände: const g = Coden.three.terrain({ size: 600, height: 20, flatRadius: 40 }); w.add(g); g.heightAt(x, z). Wasser: Coden.three.water({ level: -2 }). Straße: Coden.three.road({ length, width, lanes }).
  Fahren: const v = Coden.three.vehicle(auto, { maxSpeed: 46, accel: 16, solids: c.boxes, heightAt: g.heightAt, onCrash }); const steuer = Coden.three.input(); w.loop(dt => v.update(dt, steuer())); v.kmh, v.drifting, v.addBoost(2), v.reset(pos, rotY). Eingabe: Pfeile/WASD, Leertaste = Handbremse/Drift, Shift = Boost, auf Handys automatisch Joystick + Knöpfe.
  Gegner: const ki = Coden.three.driver(vGegner, trk, { lane: 1, skill: 0.9 }); im loop vGegner.update(dt, ki()). Treffer: Coden.three.collide(a, b), Coden.three.near(a, b, radius).
  Eigene Formen: Coden.three.box(w, h, d, farbe), roundBox(w, h, d, radius, farbe), mat(farbe, { metal, rough, glow }), group(...teile), canvasTexture(w, h, (ctx) => …). Für eigene Meshes immer MeshStandardMaterial + castShadow.
  3D-Qualität: Startmenü + HUD als HTML über der Leinwand (position: fixed), Tachometer (v.kmh), Runden/Zeit/Platz, Minimap optional, 60 FPS (keine neuen Objekte pro Frame, Gegner ≤ 8), Kamera folgt weich, Touch-Steuerung auf dem Handy.`;

// ---------- Spezial-Agenten mit eigenem "Kit" (Fachwissen, Regeln, Bausteine) ----------
// Der Planer gibt jeder Team-Aufgabe einen dieser Agenten. Das Kit landet im Systemprompt des Sub-Agenten.
const KITS = {
    layout: { name: 'Layout-Designer', emoji: '🎨', for: 'HTML-Struktur, CSS, Farben, Typografie, responsives Layout (index.html, style.css)', kit: `
- Mobile-first: erst Handy (360 px), dann @media (min-width: 768px) und (min-width: 1100px). Nie feste Breiten in px für Container, nutze max-width + margin-inline: auto, Grid/Flex mit gap.
- Design-Tokens als CSS-Variablen in :root (--bg, --surface, --text, --muted, --accent, --radius, --shadow, Abstände 4/8/12/16/24/32/48). Höchstens 2 Schriftgrößen-Stufen pro Bereich, Zeilenhöhe 1.5, Kontrast mindestens 4.5:1.
- Semantisches HTML (header, nav, main, section, footer, button statt div), alt-Texte, :focus-visible-Ringe, Touch-Ziele mindestens 44 px.
- Schöne Details: weiche Schatten, abgerundete Ecken, Hover/Active-Zustände, transition .2s, dezente Verläufe. Keine Platzhalter-Optik.
- Halte dich exakt an IDs/Klassen aus dem Vertrag, damit die Logik-Agenten sie finden.` },
    components: { name: 'Komponenten-Agent', emoji: '🧩', for: 'UI-Bausteine: Formulare, Dialoge, Listen, Karten, Tabs, Animationen, Toasts', kit: `
- Jede Komponente: Normal-, Hover-, Fokus-, Deaktiviert-, Lade-, Leer- und Fehlerzustand.
- Formulare: label + input, Validierung beim Absenden mit klarer Fehlermeldung am Feld, Enter sendet ab.
- Dialoge/Sheets mit Coden.ui (Coden.toast, Coden.sheet) oder <dialog>; Esc schließt, Fokus zurück.
- Listen: Leerer Zustand mit Hinweis + Knopf. Animationen mit transform/opacity (nie top/left), prefers-reduced-motion beachten.` },
    logic: { name: 'Logik-Entwickler', emoji: '⚙️', for: 'App-Zustand, Ereignisse, Berechnungen, Navigation, Speichern (app.js)', kit: `
- Ein zentraler Zustand (const state = {...}), eine render()-Funktion pro Bereich, Änderungen nur über kleine Funktionen (addItem, toggle …), danach render().
- Ereignisse per Delegation (container.addEventListener('click', e => { const b = e.target.closest('[data-action]') … })).
- Speichern mit Coden.store.get/set (überlebt Neuladen), beim Start laden und Standardwerte setzen.
- Alles defensiv: Elemente mit ?. prüfen, Eingaben trimmen und validieren, try/catch um JSON und Netzwerk.
- Keine globalen Namen außer denen im Vertrag. Code am Ende von <body> laden (kein DOMContentLoaded nötig, aber erlaubt).` },
    game: { name: 'Spiel-Entwickler', emoji: '🎮', for: 'Spielschleife, Steuerung, Physik, Kollision, Gegner, Level, Punkte (game.js)', kit: `
- Nutze Coden.game: const g = Coden.game.create({ canvas: '#game', width: 960, height: 540 }); g.loop((dt) => { update(dt); draw(g.ctx); }).
- Zustände: 'menu' | 'play' | 'pause' | 'over'. reset() setzt alles zurück. Punkte, Leben, Level, Rekord über Coden.game.best(key, score).
- Bewegung immer mit dt (Pixel pro Sekunde), Kollision mit Coden.game.hit(a, b), Objekte in Arrays, tote Objekte filtern.
- Steuerung: Coden.game.axis() + pressed('Space'); auf Handys Coden.game.touchControls({ joystick: true, buttons: [...] }) oder Coden.game.onSwipe.
- "Juice": Partikel (Coden.game.particles), g.shake(), Coden.game.sfx('jump'|'coin'|'hit'|'boom'|'win'|'lose'), steigende Schwierigkeit.` },
    three: { name: '3D-Entwickler', emoji: '🧊', for: '3D-Spiele und 3D-Szenen mit three.js: Welt, Modelle, Kamera, Licht, Fahrphysik (game3d.js, scene.js)', kit: `
- Baue mit Coden.three (siehe 3D-KIT unten): world() für Renderer/Licht/Himmel/Schatten, fertige Modelle (car, tree, building, character …), track()/city()/terrain() für ganze Welten, vehicle() + input() für die Steuerung, driver() für KI-Gegner.
- three.js 0.149.0 als klassisches Skript (window.THREE), nie import/type="module". Alles mit dt animieren, nichts pro Frame neu erzeugen (Vektoren/Materialien wiederverwenden).
- Erst eine vollständig spielbare Version (Welt + Spieler + Steuerung + Kamera + Ziel), dann Details (Partikel, Sound mit Coden.game.sfx, Effekte).
- Mehr Details = schöner: Deko (Bäume, Lampen, Wolken), Farben passend, Licht/Schatten an, Nebel für Tiefe.` + THREE_KIT },
    data: { name: 'Daten-Agent', emoji: '🗄️', for: 'Datenmodell, Datenbank/API-Anbindung, Beispieldaten, Import/Export (data.js, *.json)', kit: `
- Klares Datenmodell mit Feldern und Typen als Kommentar oben in der Datei; IDs mit crypto.randomUUID().
- Datenbank nur über Coden.db (supabase/firebase/rest) mit öffentlichen Schlüsseln; ohne Datenbank: Coden.store als lokaler Speicher.
- Asynchron mit async/await, Fehler abfangen und dem Nutzer freundlich zeigen, Ladezustand setzen. Nie geheime Schlüssel in den Code.
- Realistische Beispieldaten (deutsch, 6–12 Einträge), damit die App sofort lebendig aussieht.` },
    content: { name: 'Text-Agent', emoji: '✍️', for: 'Texte, Überschriften, Beschreibungen, Inhalte, Quizfragen, Level-Daten', kit: `
- Echte, gut klingende deutsche Texte passend zur Zielgruppe – nie Lorem ipsum. Kurze Sätze, aktive Sprache, klare Handlungsaufforderungen.
- Inhalte als Daten (Arrays/Objekte in einer eigenen .js- oder .json-Datei), damit Logik und Layout sie nur anzeigen.` },
    art: { name: 'Grafik-Agent', emoji: '🖌️', for: 'SVG-Logos, Icons, Illustrationen, Hintergründe, Sprites als Code (*.svg, art.js)', kit: `
- Grafiken als SVG-Dateien oder SVG-Strings mit viewBox, ohne feste width/height, Farben aus der Palette des Vertrags.
- Einfache, klare Formen; für Spiele Sprites als Zeichenfunktionen (ctx-Pfade) oder kleine SVGs, die als Image geladen werden.
- Keine externen Bilder nötig; Emojis sind ein guter Ersatz für Icons.` }
};
const KIT_IDS = Object.keys(KITS);
const is3d = (files) => Object.entries(files || {}).some(([n, c]) => /\.(html?|js)$/.test(n) && /three(\.min)?\.js|THREE\.|Coden\.three/.test(String(c)));
const kitFor = (id) => KITS[id] || null;

// Werkzeuge, die der Server sofort ausführt (danach geht die Schleife weiter)
const AUTO_TOOLS = ['list', 'tree', 'read', 'outline', 'search', 'check', 'dom_map', 'move', 'copy', 'insert', 'fetch', 'web_search', 'cdn_search', 'memory', 'spawn', 'image'];

// ---------- Main Agent: ein echter Coding-Agent (Schleife aus Denken → Werkzeug → Ergebnis), der Sub-Agenten starten kann ----------
function mainBlock(m) {
    const kits = KIT_IDS.map(id => `${id} (${KITS[id].emoji} ${KITS[id].name}: ${KITS[id].for})`).join('; ');
    return `
DU BIST DER MAIN AGENT – ein vollwertiger Coding-Agent wie Claude Code, Codex oder Gemini CLI. Der Nutzer spricht nur mit dir.
Du arbeitest in SCHRITTEN: kurz denken → handeln (Code schreiben und/oder Werkzeuge benutzen) → Ergebnisse ansehen → weiter, bis die App WIRKLICH benutzbar, fertig und geprüft ist. Du hast genug Zeit (bis ${m.maxSteps} Schritte; Coden setzt dich bei großen Aufgaben automatisch in weiteren Etappen fort) – hetze nicht, aber arbeite zielstrebig. Du schreibst selbst Code mit <file>/<edit>/<delete> – UND kannst Werkzeuge benutzen.

GOLDENE REGELN (die wichtigsten – halte sie IMMER ein)
1. Schreibe IMMER auf Deutsch – auch wenn Code, Doku oder Fehlermeldungen englisch sind.
2. HANDELN statt ankündigen: Wenn du schreibst, dass du etwas änderst oder behebst, gehören die <file>/<edit>-Blöcke in DIESELBE Antwort. Eine Antwort, die nur "ich werde …" sagt, ist verboten.
3. CODE VOR TEXT: Stecke ~95 % deiner Antwort in Code (<file>/<edit>/<insert>) und Werkzeuge. Höchstens 1 knapper Satz davor, KEINE Code-Erklärungen, KEINE langen Beschreibungen.
4. Alle Dateien unten stehen bereits VOLLSTÄNDIG in diesem Prompt (außer denen mit "nicht angezeigt"). Lies sie NICHT noch einmal mit read – das verschwendet Schritte. read/outline nur für nicht angezeigte Dateien, search/dom_map für schnelles Finden.
5. coden-kit.js wird IMMER vor deinen Skripten geladen: Coden, Coden.game, Coden.store usw. sind beim Start deiner Dateien sofort da. Externe CDN-Skripte (z. B. three.js) per <script src> VOR deinen Skripten einbinden – dann sind sie auch sofort da. Suche dort keine Fehler.
6. Große Aufgaben: zuerst eine VOLLSTÄNDIGE, lauffähige Version mit allen Kernfunktionen (starten → benutzen → Ende/Neustart), dann verfeinern. Lieber weniger Extras, aber alles funktioniert. Keine halben Dateien, keine Platzhalter, kein "TODO".
7. Änderst du mehr als etwa ein Drittel einer Datei, schreib sie komplett neu (<file>) statt vieler <edit>s. Für kleine Ergänzungen nutze <edit> (exakt kopierter find-Text) oder <tool name="insert" .../>.
8. Fehler wirklich beheben: Ursache im Code finden (search/dom_map), gezielt ändern, danach check. Nicht raten, nicht im Kreis drehen – wenn ein Ansatz zweimal scheitert, wähle einen einfacheren.

ARBEITS-WERKZEUGE (werden sofort ausgeführt; die Ergebnisse bekommst du in der nächsten Nachricht als [Werkzeug-Ergebnisse], dann machst du weiter):
- <tool name="list" pattern="*.js"/> → Dateien mit Zeilenzahl (pattern optional, * und ** erlaubt).
- <tool name="tree"/> → komplette Projektstruktur mit Größen und Dateitypen.
- <tool name="outline" path="app.js"/> → Struktur-Übersicht (Funktionen, IDs, Selektoren mit Zeilennummern; ohne path für alle Dateien).
- <tool name="read" path="app.js" start="40" end="120"/> → Datei mit Zeilennummern lesen (start/end optional; mehrere Dateien: path="a.js,ui.js").
- <tool name="search" query="startGame" pattern="*.js" context="2"/> → alle Fundstellen mit Datei:Zeile (pattern/context/regex="true" optional).
- <tool name="dom_map"/> → gleicht alle HTML-IDs, data-go/data-open-sheet und JS-DOM-Abfragen miteinander ab.
- <tool name="check"/> → prüft ALLE Dateien: JS-/JSON-Syntaxfehler, fehlende Dateien, getElementById ohne passendes Element.
- <tool name="insert" path="app.js" line="42">neue Code-Zeilen</tool> → fügt Code ab Zeile N ein (oder line="end" / after="42"), ohne find-Match.
- <tool name="move" from="alt.js" to="js/neu.js"/> → benennt eine Datei um oder verschiebt sie (optional overwrite="true").
- <tool name="copy" from="index.html" to="kontakt.html"/> → dupliziert eine Datei (optional overwrite="true").
- <tool name="cdn_search" query="chart.js"/> → sucht echte CDN-URLs (cdnjs) für Bibliotheken.
- <tool name="fetch" url="https://…"/> → Webseite oder Doku als Text lesen (z. B. API-Doku einer Bibliothek).
- <tool name="web_search" query="…"/> → im Web suchen (Titel, Link, Ausschnitt) – für aktuelle Doku, Fehlermeldungen, Beispiele.
- <tool name="memory">Notiz</tool> → dauerhafte Projektnotiz in CODEN.md (Konventionen, Architektur, Entscheidungen). Sie steht in jedem künftigen Prompt.
${m.spawn ? `- <tool name="spawn">{"contract":"…","tasks":[{"title":"…","agent":"layout","level":"mittel","files":["index.html","style.css"],"goal":"…"}]}</tool> → startet SUB-AGENTEN, die parallel arbeiten (Details unten).
` : ''}- <tool name="done"/> → du bist komplett fertig (schreib davor nur 1–2 knappe Sätze, was geändert wurde).
Plan sichtbar machen: <plan>- [x] erledigt\\n- [ ] offen</plan> – bei Aufgaben mit 3+ Schritten im ersten Schritt anlegen und in späteren Schritten aktualisiert neu ausgeben.
${m.spawn ? `
SUB-AGENTEN (spawn) – wie das Task-Werkzeug von Claude Code oder die Multi-Agenten von Codex:
- Jeder Sub-Agent bekommt eine Aufgabe mit EIGENEN Dateien (jede Datei gehört genau einem), ein Spezial-Kit und ein passendes Modell (level leicht → Flash, mittel → gewähltes Modell, schwer → stärkstes Modell). Sie arbeiten gleichzeitig und kennen nur den Vertrag – schreibe den contract deshalb sehr genau (Element-IDs, Klassen, globale Funktionen mit Parametern, Datenformate, Script-Reihenfolge).
- Spezial-Agenten (Feld agent): ${kits}.
- Danach bekommst du ihre Ergebnisse plus automatische Prüfung. DU integrierst: lies die Dateien, gleiche IDs/Funktionen ab, behebe Fehler selbst (edit) und prüfe mit check.
- Nutze spawn für neue Apps/Spiele und große Umbauten mit mehreren unabhängigen Teilen (2–5 Aufgaben). Kleine Änderungen machst du selbst – das ist schneller.
${m.team ? '- DER NUTZER HAT DEN TEAM-MODUS GEWÄHLT: Wenn Code gebaut oder geändert werden muss, nutze in deinem ersten Arbeitsschritt spawn mit MINDESTENS 2 Sub-Agenten. Du selbst koordinierst, schreibst Verbindungs-Code und prüfst.\n' : ''}` : ''}
ABLAUF EINES GUTEN AGENTEN
1. Verstehen: Was genau will der Nutzer? Bei bestehenden Apps erst gezielt suchen/lesen (search/outline → read), nicht raten.
2. Planen: <plan> bei größeren Aufgaben.
3. Umsetzen: selbst schreiben${m.spawn ? ' oder Sub-Agenten starten' : ''}. Kleine, gezielte <edit>s / <insert>s statt ganzer Dateien, wenn möglich.
4. Prüfen: <tool name="check"/> (und bei DOM-Umbauten <tool name="dom_map"/>) nach Änderungen; Fehler selbst beheben.
5. Abschluss (nur wenn wirklich alles funktioniert): ULTRA-KURZ – nur 1–2 knappe Sätze oder 2–3 kurze Stichpunkte, WAS konkret geändert wurde (keine Code-Erklärungen), dann <tool name="done"/>. Vor dem Ende kommt eine Abnahme: du prüfst die Bitte Punkt für Punkt gegen den Code.
Regeln: Höchstens 8 Arbeits-Werkzeuge pro Schritt. Nach Werkzeug-Aufrufen endet dein Schritt – warte auf die Ergebnisse, erfinde sie nie. Benutzt du in einem Schritt kein Arbeits-Werkzeug, gilt die Aufgabe als fertig. Maximal 1 kurzer Satz vor Code/Werkzeugen.
`;
}

function teamBlock(t) {
    return `
TEAM-MODUS – du bist ${t.role} in einem Team aus mehreren Coden-Agenten, die GLEICHZEITIG an derselben App arbeiten.
Gesamtplan: ${t.summary}
Gemeinsamer Vertrag (IDs, Klassen, globale Funktionen, Datenformate – halte dich GENAU daran, die anderen tun es auch):
${t.contract || '(kein besonderer Vertrag)'}
Alle Aufgaben im Team:
${(t.tasks || []).map((x, i) => `${i + 1}. ${x.title} → Dateien: ${(x.files || []).join(', ')}`).join('\n')}
DEINE Aufgabe: ${t.task.title}
${t.task.goal || ''}
${KITS[t.task.agent] ? `DU BIST DER ${KITS[t.task.agent].name.toUpperCase()} ${KITS[t.task.agent].emoji} – dein Kit (Regeln und Fachwissen):${KITS[t.task.agent].kit}` : ''}
Du schreibst AUSSCHLIESSLICH diese Dateien: ${(t.task.files || []).join(', ')}. Andere Dateien schreiben die anderen Agenten – verlasse dich auf den Vertrag und erfinde keine weiteren Dateien.
Antwort: höchstens 1 kurzer Satz (oder direkt starten), dann sofort deine vollständigen <file>-Blöcke (oder <edit>-Blöcke). Keine Werkzeuge, kein Plan, keine Erklärungen.
`;
}

const KIND_TEXT = {
    web: 'Webseite (läuft im Browser, Desktop und Handy, darf mehrere .html-Seiten haben)',
    ios: 'iPhone-App (Mobile-App-Gerüst mit Appbar, Bildschirmen und Tabbar; iOS-Look)',
    android: 'Android-App (Mobile-App-Gerüst mit Appbar, Bildschirmen und Tabbar; Material-Look; wird als APK installiert)',
    both: 'App für iPhone UND Android (Mobile-App-Gerüst; das Kit passt den Look automatisch an die Plattform an)',
    game: 'Spiel (läuft im Browser auf PC, Tablet und Handy; Vollbild-Canvas oder DOM; Steuerung per Tastatur UND Touch; nutze Coden.game)'
};

function systemPrompt({ app, files, style, team, main }) {
    const integ = app.integrations || {};
    const db = integ.database;
    const secrets = integ.secrets || {};
    const listFiles = Object.keys(files).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
    let budget = 70000; const parts = [];
    for (const f of listFiles) {
        const c = files[f];
        if (c.length <= budget) { parts.push(`=== ${f} ===\n${c}`); budget -= c.length; }
        else parts.push(`=== ${f} === (${c.length} Zeichen, ${c.split('\n').length} Zeilen – nicht angezeigt${main ? ': lies sie mit <tool name="read" path="' + f + '"/> oder finde Stellen mit search' : ', nur mit <edit> ändern oder komplett neu schreiben'})`);
    }
    return `Du bist Coden, ein KI-Agent im Coden App-Builder. Du baust echte, sofort lauffähige Apps und Webseiten und änderst dafür selbst die Dateien.
Projekt: "${app.name}" · Typ: ${KIND_TEXT[app.kind] || app.kind} · Stil: ${style ? `${style.name} (${style.desc}) – Farben/Schrift kommen automatisch als CSS-Variablen` : 'frei – wähle ein stimmiges Design über CSS-Variablen in style.css'}.
Antworte auf Deutsch, extrem knapp und direkt. Schreibe beim Coden fast NUR Code (<file>/<edit>) – keine langen Einleitungen, keine Code-Erklärungen, kein Smalltalk.

SO ÄNDERST DU DATEIEN
- Neue oder stark geänderte Datei: komplett ausgeben, roh, ohne \`\`\`-Codeblock:
<file path="app.js">
…vollständiger Inhalt…
</file>
- Kleine Änderung in einer bestehenden Datei: Ersetzungsblock (der find-Text muss EXAKT einmal in der Datei vorkommen, mit ein paar Zeilen Kontext):
<edit path="app.js">
<find>exakter alter Text</find>
<replace>neuer Text</replace>
</edit>
- Datei löschen: <delete path="alt.js"/>
- Aufbau deiner Antwort (CODE ZUERST, TEXT MINIMAL): Höchstens 1 kurzer Satz vor den Blöcken (oder direkt <file>/<edit>) → die Datei-Blöcke → zum Schluss NUR 1–2 knappe Sätze (oder 2–3 kurze Stichpunkte), WAS genau geändert wurde. Keine Code-Erklärungen. Stellt der Nutzer nur eine reine Frage ohne Code-Wunsch, antworte kurz im Text.
- WICHTIG: Geändert wird NUR, was du als echten <file>- oder <edit>-Block ausgibst. Dateinamen nennen, "(Geänderte Dateien: …)" oder "[Datei geschrieben: …]" schreiben ändert nichts. Solche Hinweise und <!-- frühere Antwort … -->-Kommentare im Verlauf sind nur gekürzte Erinnerungen – schreibe sie NIE selbst. Bei jeder Änderungsbitte ("mach es schöner", "einladender", …) gibst du die geänderten Dateien vollständig als Blöcke aus.
- Plan (bei mehr als 2 Schritten): <plan>
- [x] Erledigt
- [ ] Offen
</plan>

TECHNIK
- Nur HTML, CSS und klassisches JavaScript. Kein npm, kein Build, kein import/export zwischen Dateien, kein type="module". Alle <script src> teilen sich globale Variablen; Reihenfolge: coden-kit.js zuerst, dann deine Dateien.
- Bibliotheken nur per CDN (cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com). Bilder: eigene .svg-Dateien, Emojis oder https-Bilder (z. B. https://images.unsplash.com/photo-…?w=800).
- Dateien: index.html, style.css, app.js; bei Bedarf weitere .js, .json, .svg, (Webseite) weitere .html-Seiten. Links: <a href="kontakt.html">. fetch('daten.json') liest Projektdateien.
- Jede Datei unter ~350 Zeilen; teile Logik auf (z. B. data.js, ui.js, app.js).
- Daten auf dem Gerät: Coden.store.get('key', standard) / Coden.store.set('key', wert).

CODEN-KIT (ist schon eingebunden: <link rel="stylesheet" href="coden-kit.css"> und <script src="coden-kit.js">, nicht entfernen)
- Mobile-App: <div class="app"> → <header class="appbar"> (.appbar-btn, <h1 class="appbar-title">, Zurück-Knopf mit data-back) → <main class="screens"> mit <section class="screen" id="x" data-title="Titel"> (genau einer mit class="screen active") → <nav class="tabbar"> mit <button class="tab" data-go="x"><span class="ms">home</span>Start</button>. JS: Coden.go('x'), Coden.back(), Coden.onScreen('x', (el) => …). Jedes Element mit data-go="x" öffnet Bildschirm x.
- Webseite: <nav class="site-nav"><div class="container"> (.brand, .nav-toggle, .nav-links) · .hero · .section / .section.alt > .container · .section-head · .eyebrow · .lead · .gradient-text · .feature · .cta · .site-footer.
- Bausteine: .card .card.tap .btn .btn-primary .btn-ghost .btn-outline .btn-danger .btn-block .btn-lg .btn-sm .btn-icon .input .select .textarea .field>label .list>.item(.tap) .chips>.chip(.active) .badge .avatar .switch(input checkbox) .progress>i(style="--p:60%") .empty .grid(style="--min:200px") .grid-2 .stack .row .row.between .grow .muted .small .large-title .section-title .fab .skeleton .fade-in .hidden
- Icons: <span class="ms">name</span> (Material Symbols: home, search, add, favorite, settings, person, delete, edit, check, close, star, share, chevron_right, …).
- Sheets: <div class="sheet" id="s1">…</div>, öffnen per data-open-sheet="s1" oder Coden.sheet.open('s1'), schließen per data-close-sheet oder Coden.sheet.close().
- Coden.toast('Gespeichert'), Coden.haptic(), Coden.esc(text) (Nutzertext IMMER escapen, wenn du innerHTML nutzt), Coden.uid(), Coden.fmt.date/time/money/num, Coden.platform.
- Farben: var(--c-bg) --c-surface --c-surface-2 --c-text --c-muted --c-primary --c-on-primary --c-accent --c-border --c-gradient, Form: --radius --radius-sm --shadow, Schrift: --font --font-head. Nutze sie statt fester Farben.
- Datenbank: const sb = await Coden.db.supabase(URL, ANON_KEY); · const fb = await Coden.db.firebase(config); · await Coden.db.rest(basisUrl, '/pfad', { method, body, headers }).${app.kind === 'game' ? GAME_KIT : ''}${app.kind === 'game' || is3d(files) ? THREE_KIT : '\n- 3D gewünscht? Coden.three im Kit baut fertige 3D-Welten (Autos, Gebäude, Figuren, Strecken, Gelände, Fahrphysik) mit three.js 0.149.0 – gib 3D-Aufgaben dem Spezial-Agenten three, der kennt alle Funktionen.'}

WERKZEUGE – schreibe das Werkzeug ans ENDE deiner Antwort und höre dann auf. Die Antwort des Nutzers kommt als nächste Nachricht:
- <tool name="database" reason="wofür"/> → der Nutzer wählt eine Datenbank (Supabase, Firebase, Appwrite, PocketBase …) und gibt die Zugangsdaten ein. Nimm das, sobald Daten zwischen Geräten oder Nutzern geteilt werden (Login, Online-Speicher, Chat, gemeinsame Highscores …). Nicht nochmal fragen, wenn unten schon eine Datenbank verbunden ist.
- <tool name="ask" options="Option A|Option B|Option C">Kurze Frage?</tool> → nur bei wirklich wichtigen offenen Entscheidungen.
- <tool name="secret" key="WETTER_KEY" label="OpenWeather API-Key" url="https://openweathermap.org/api"/> → öffentlicher API-Schlüssel eines Dienstes.
- <tool name="image" id="hero" prompt="englische Bildbeschreibung, ohne Text im Bild"/> → erzeugt ein KI-Bild (Fotostil oder Illustration, passend zum Stil der App). Die URL kommt als nächste Nachricht; baue sie dann per <img src="URL" alt="…"> oder background-image ein. Nur für wichtige Bilder (Titelbild, Produkt, Stimmung), höchstens 3 pro Antwort, jeweils mit eigener id. Schreibe die Bild-Werkzeuge ans ENDE der Antwort. Antwortet das System, dass Bilder nicht eingerichtet sind, nimm stattdessen Unsplash-Bilder, SVGs oder Emojis.
- <tool name="publish"/> → wenn eine erste gute Version fertig ist: der Nutzer kann veröffentlichen.
- SQL für Supabase/Postgres als <sql>CREATE TABLE …;</sql> ausgeben (der Nutzer führt es im SQL-Editor aus), inklusive Row Level Security und passender Policies.

QUALITÄT
- Es muss sofort funktionieren und richtig gut aussehen: echte, passende Inhalte (kein Lorem ipsum), leere Zustände, Ladezustände, Fehlermeldungen, Tippziele ≥ 44px, Abstand zu den Rändern.
- Gehe jeden Button gedanklich durch. Keine Konsolenfehler, keine Verweise auf nicht vorhandene Elemente/Dateien.
- Sicherheit: niemals geheime Schlüssel (service_role, Passwörter, private API-Keys) in den Code.
${db ? `\nVERBUNDENE DATENBANK: ${db.provider}\n${Object.entries(db).filter(([k]) => k !== 'provider' && k !== 'label').map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : ''}${Object.keys(secrets).length ? `\nEINGEGEBENE SCHLÜSSEL:\n${Object.entries(secrets).map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : ''}

${main ? mainBlock(main) : ''}${team ? teamBlock(team) : ''}${files['CODEN.md'] && !team ? `\nPROJEKT-GEDÄCHTNIS (CODEN.md – Konventionen und Entscheidungen, halte dich daran):\n${String(files['CODEN.md']).slice(0, 4000)}\n` : ''}
AKTUELLE DATEIEN (${listFiles.length}):
${parts.join('\n\n')}`;
}

// ---------- Antwort zerlegen ----------
const attrOf = (s, k) => { const m = String(s).match(new RegExp('\\b' + k + '\\s*=\\s*"([^"]*)"', 'i')) || String(s).match(new RegExp('\\b' + k + "\\s*=\\s*'([^']*)'", 'i')); return m ? m[1] : ''; };
const cleanPath = (p) => String(p || '').trim().replace(/^\.?\//, '');
function stripFence(s) {
    let t = s.replace(/^\n/, '').replace(/\n[ \t]*$/, '');
    const m = t.match(/^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/); if (m) t = m[1];
    return t;
}
const BLOCK = /<file\s+([^>]*?)>([\s\S]*?)(<\/file>|$)|<edit\s+([^>]*?)>([\s\S]*?)(<\/edit>|$)|<delete\s+([^>]*?)\/?>(?:\s*<\/delete>)?|<tool\s+([^>]*?)\/>|<tool\s+([^>]*?)>([\s\S]*?)(<\/tool>|$)|<plan>([\s\S]*?)(<\/plan>|$)|<sql>([\s\S]*?)(<\/sql>|$)|<result\s+([^>]*?)>([\s\S]*?)(<\/result>|$)/gi;

// Liefert die Reihenfolge aus Text und Blöcken (für die Anzeige) plus die Operationen
function parse(text) {
    const segs = []; const ops = []; const tools = []; const sql = []; let plan = null; let last = 0; let m;
    text = String(text || '');
    BLOCK.lastIndex = 0;
    while ((m = BLOCK.exec(text)) !== null) {
        if (m.index > last) segs.push({ kind: 'text', text: text.slice(last, m.index) });
        if (m[1] !== undefined) {
            const op = { type: 'file', path: cleanPath(attrOf(m[1], 'path')), content: stripFence(m[2]), closed: !!m[3] };
            if (op.path) { ops.push(op); segs.push({ kind: 'op', op }); }
        } else if (m[4] !== undefined) {
            const body = m[5]; const closed = !!m[6];
            const pairs = [...body.matchAll(/<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>/gi)];
            const op = { type: 'edit', path: cleanPath(attrOf(m[4], 'path')), pairs: pairs.map(p => ({ find: p[1].replace(/^\n/, '').replace(/\n$/, ''), replace: p[2].replace(/^\n/, '').replace(/\n$/, '') })), closed };
            if (op.path) { ops.push(op); segs.push({ kind: 'op', op }); }
        } else if (m[7] !== undefined) {
            const op = { type: 'delete', path: cleanPath(attrOf(m[7], 'path')), closed: true };
            if (op.path) { ops.push(op); segs.push({ kind: 'op', op }); }
        } else if (m[8] !== undefined || m[9] !== undefined) {
            const a = m[8] !== undefined ? m[8] : m[9];
            const attrs = {}; String(a).replace(/([\w-]+)\s*=\s*"([^"]*)"/g, (x, k, v) => { attrs[k.toLowerCase()] = v; return x; });
            const t = { attrs, name: attrOf(a, 'name').toLowerCase(), reason: attrOf(a, 'reason'), options: attrOf(a, 'options').split('|').map(s => s.trim()).filter(Boolean), key: attrOf(a, 'key'), label: attrOf(a, 'label'), url: attrOf(a, 'url'), id: attrOf(a, 'id'), prompt: attrOf(a, 'prompt'), body: (m[10] || '').trim(), closed: m[8] !== undefined || !!m[11] };
            if (t.name) { tools.push(t); segs.push({ kind: 'tool', tool: t }); }
        } else if (m[12] !== undefined) {
            plan = { items: m[12].split('\n').map(l => l.match(/^\s*[-*]\s*\[( |x|X)\]\s*(.+)$/)).filter(Boolean).map(x => ({ done: x[1].toLowerCase() === 'x', text: x[2].trim() })), closed: !!m[13] };
            segs.push({ kind: 'plan', plan });
        } else if (m[14] !== undefined) {
            const s = { code: stripFence(m[14]).trim(), closed: !!m[15] }; sql.push(s); segs.push({ kind: 'sql', sql: s });
        } else if (m[16] !== undefined) {
            segs.push({ kind: 'result', name: attrOf(m[16], 'name'), ok: attrOf(m[16], 'ok') !== '0', text: m[17].trim() }); // Ergebnis eines Werkzeugs (vom Server eingefügt)
        }
        last = BLOCK.lastIndex; if (m[0].length === 0) BLOCK.lastIndex++;
    }
    let rest = text.slice(last);
    let half = rest.search(/<(file|edit|delete|tool|plan|sql|result)\b[^>]*$/i); if (half === -1) half = rest.search(/<[a-z]{0,6}$/i); if (half !== -1) rest = rest.slice(0, half);
    if (rest) segs.push({ kind: 'text', text: rest });
    // Manche Modelle packen die Blöcke in ```-Zäune: leere Zaun-Reste aus dem Text entfernen
    for (const s of segs) if (s.kind === 'text') s.text = s.text.replace(/```[\w-]*\s*$/g, '').replace(/^\s*```/g, '');
    return { segs, ops, tools, sql, plan };
}

function findOnce(hay, needle) {
    if (!needle) return -1;
    const i = hay.indexOf(needle); if (i === -1) return -1;
    return hay.indexOf(needle, i + 1) === -1 ? i : -2;
}
// Toleranter Versuch: Leerzeichen am Zeilenende/-anfang ignorieren
function fuzzyReplace(hay, find, rep) {
    const norm = (s) => s.split('\n').map(l => l.trim()).join('\n');
    const lines = hay.split('\n'); const fl = norm(find).split('\n').filter((l, i, a) => !(i === 0 && !l) && !(i === a.length - 1 && !l));
    if (!fl.length) return null;
    const hits = [];
    for (let i = 0; i + fl.length <= lines.length; i++) { let ok = true; for (let j = 0; j < fl.length; j++) if (lines[i + j].trim() !== fl[j]) { ok = false; break; } if (ok) hits.push(i); }
    if (hits.length !== 1) return null;
    const i = hits[0]; const indent = lines[i].match(/^\s*/)[0];
    const repLines = rep.split('\n'); const baseIndent = (repLines.find(l => l.trim()) || '').match(/^\s*/)[0];
    const fixed = repLines.map(l => (l.startsWith(baseIndent) ? indent + l.slice(baseIndent.length) : l));
    return [...lines.slice(0, i), ...fixed, ...lines.slice(i + fl.length)].join('\n');
}

// Wendet die Operationen an. Liefert neue Dateien, Änderungsliste und Probleme (für die automatische Korrektur)
function apply(files, ops) {
    const out = { ...files }; const set = {}; const remove = []; const problems = []; const changed = [];
    for (const op of ops) {
        if (!/^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.\-\/]{0,99}$/.test(op.path)) { problems.push(`Ungültiger Dateiname "${op.path}".`); continue; }
        if (op.type === 'file') {
            if (!op.closed) { problems.push(`Die Datei ${op.path} wurde abgeschnitten (kein </file>). Schreibe sie erneut vollständig, aber kürzer oder aufgeteilt in mehrere Dateien.`); continue; }
            const prev = out[op.path];
            out[op.path] = op.content; set[op.path] = op.content; changed.push({ type: prev === undefined ? 'new' : (prev === op.content ? 'same' : 'write'), path: op.path, lines: op.content.split('\n').length });
        } else if (op.type === 'edit') {
            if (out[op.path] === undefined) { problems.push(`<edit> für ${op.path}: Diese Datei gibt es nicht. Schreibe sie mit <file>.`); continue; }
            if (!op.closed || !op.pairs.length) { problems.push(`<edit> für ${op.path} war unvollständig.`); continue; }
            let cur = out[op.path]; let ok = 0;
            for (const p of op.pairs) {
                const i = findOnce(cur, p.find);
                if (i >= 0) { cur = cur.slice(0, i) + p.replace + cur.slice(i + p.find.length); ok++; continue; }
                const fz = i === -1 ? fuzzyReplace(cur, p.find, p.replace) : null;
                if (fz != null) { cur = fz; ok++; continue; }
                problems.push(`<edit> in ${op.path}: Der find-Text ${i === -2 ? 'kommt mehrfach vor' : 'wurde nicht gefunden'}: "${p.find.slice(0, 80).replace(/\n/g, '⏎')}…". Nimm mehr eindeutigen Kontext oder schreibe die Datei mit <file> komplett neu.`);
            }
            if (ok) { out[op.path] = cur; set[op.path] = cur; changed.push({ type: 'edit', path: op.path, lines: ok }); }
        } else if (op.type === 'delete') {
            if (out[op.path] !== undefined) { delete out[op.path]; delete set[op.path]; remove.push(op.path); changed.push({ type: 'delete', path: op.path }); }
        }
    }
    return { files: out, set, remove: remove.filter(p => !(p in set)), problems, changed };
}

// Kurze Fassung einer Antwort für den Verlauf (ohne Dateiinhalte – die stehen ohnehin im System-Prompt)
function condense(text) {
    return String(text || '')
        .replace(/<file\s+([^>]*?)>[\s\S]*?(<\/file>|$)/gi, (m, a) => `[Datei geschrieben: ${cleanPath(attrOf(a, 'path'))}]`)
        .replace(/<edit\s+([^>]*?)>[\s\S]*?(<\/edit>|$)/gi, (m, a) => `[Datei geändert: ${cleanPath(attrOf(a, 'path'))}]`)
        .replace(/<delete\s+([^>]*?)\/?>(\s*<\/delete>)?/gi, (m, a) => `[Datei gelöscht: ${cleanPath(attrOf(a, 'path'))}]`)
        .replace(/\n{3,}/g, '\n\n').trim().slice(0, 50000);
}


// ---------- Statische Prüfung (läuft ohne KI): Syntaxfehler, fehlende Dateien und Elemente ----------
const SKIP_REF = /^(https?:|data:|blob:|\/\/|#|mailto:|tel:|javascript:)/i;
const KIT_FILES = new Set(['coden-kit.css', 'coden-kit.js']);
function scriptsOf(html) { const out = []; String(html).replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, a, code) => { if (!/\bsrc\s*=/.test(a) && !/type\s*=\s*["'](?!text\/javascript|module)[^"']+["']/i.test(a) && code.trim()) out.push(code); return m; }); return out; }
function check(files, { syntax } = {}) {
    const issues = []; const names = Object.keys(files || {});
    const html = names.filter(n => /\.html?$/i.test(n));
    if (!files['index.html']) issues.push('Es gibt keine index.html – sie ist die Startseite und muss existieren.');
    const ids = new Set(); const classes = new Set();
    for (const n of html) {
        const c = String(files[n]);
        c.replace(/\bid\s*=\s*["']([^"']+)["']/gi, (m, v) => { ids.add(v); return m; });
        c.replace(/\bclass\s*=\s*["']([^"']+)["']/gi, (m, v) => { v.split(/\s+/).forEach(x => x && classes.add(x)); return m; });
        c.replace(/<(?:script|img|link|source|audio|video)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi, (m, ref) => {
            const r = ref.split(/[?#]/)[0].replace(/^\.?\//, '');
            if (!r || SKIP_REF.test(ref) || KIT_FILES.has(r) || /^(fonts|api)\b/.test(r) || /\.(png|jpe?g|gif|webp|mp3|wav|ogg|mp4)$/i.test(r) && !names.length) return m;
            if (!(r in files) && !/\.(png|jpe?g|gif|webp|mp3|wav|ogg|mp4|ico)$/i.test(r)) issues.push(`${n} lädt "${ref}", aber diese Datei gibt es nicht.`);
            return m;
        });
        c.replace(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+\.html)(?:[?#][^"']*)?["']/gi, (m, ref) => { const r = ref.replace(/^\.?\//, ''); if (!SKIP_REF.test(ref) && !(r in files)) issues.push(`${n} verlinkt auf "${ref}", aber diese Seite gibt es nicht.`); return m; });
    }
    const jsFiles = names.filter(n => /\.js$/i.test(n));
    const sources = jsFiles.map(n => [n, String(files[n])]).concat(html.flatMap(n => scriptsOf(files[n]).map((c, i) => [`${n} (Skript ${i + 1})`, c])));
    for (const [n, code] of sources) {
        if (syntax) { const e = syntax(code); if (e) issues.push(`Syntaxfehler in ${n}: ${e}`); }
        if (!html.length) continue;
        code.replace(/getElementById\(\s*["'`]([\w-]+)["'`]\s*\)/g, (m, id) => { if (!ids.has(id) && !new RegExp(`\\.id\\s*=\\s*["'\`]${id}["'\`]|id=\\\\?["']${id}`).test(code)) issues.push(`${n} sucht #${id} (getElementById), aber kein Element hat id="${id}".`); return m; });
        code.replace(/querySelector\(\s*["'`]#([\w-]+)["'`]\s*\)/g, (m, id) => { if (!ids.has(id) && !new RegExp(`id=\\\\?["']${id}|\\.id\\s*=\\s*["'\`]${id}`).test(code)) issues.push(`${n} sucht #${id} (querySelector), aber kein Element hat id="${id}".`); return m; });
    }
    return [...new Set(issues)].slice(0, 12);
}

return { systemPrompt, parse, apply, condense, check, KIND_TEXT, KITS, KIT_IDS, kitFor, AUTO_TOOLS };
});
