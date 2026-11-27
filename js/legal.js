// js/legal.js – Rechtliche Pflichtangaben (DDG, MStV, VSBG, DSGVO, TDDDG, EU AI Act Art. 50, DSA), Kontaktformular & DSGVO-Selbstbedienung
import { apiFetch, apiJson } from './backend.js';
import { auth, deleteAccount, logoutUser, onAuthStateChanged } from './auth.js';
import { Storage } from './storage.js';
import { toast } from './toast.js';

const LEGAL_TABS = [
  { id: 'impressum', label: 'Impressum', title: 'Impressum (§ 5 DDG)' },
  { id: 'kontakt', label: 'Kontakt', title: 'Kontaktformular (§ 5 DDG)' },
  { id: 'datenschutz', label: 'Datenschutz', title: 'Datenschutzerklärung (DSGVO & TDDDG)' },
  { id: 'agb', label: 'Nutzungsbedingungen', title: 'Nutzungsbedingungen (AGB)' },
  { id: 'ki', label: 'KI-Hinweis', title: 'KI-Transparenz (Art. 50 EU AI Act)' }
];

const TOPIC_LABELS = {
  allgemein: 'Allgemein & Feedback',
  datenschutz: 'Datenschutz / DSGVO',
  dsa: 'Inhalt melden (DSA)',
  bug: 'Fehler / Bug melden',
  sonstiges: 'Sonstiges'
};

const OWNER_EMAIL = 'kayden.schunack@gmail.com';

const LEGAL_HTML = {
  impressum: `
    <div class="legal-doc">
      <h4>Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz)</h4>
      <p><strong>Verantwortlicher Betreiber:</strong><br>
      Kayden Schunack<br>
      Lerchesflurweg 67<br>
      66119 Saarbrücken<br>
      Deutschland</p>

      <h4>Kontakt (§ 5 Abs. 1 Nr. 2 DDG)</h4>
      <p>E-Mail: <a href="mailto:kayden.schunack@gmail.com">kayden.schunack@gmail.com</a><br>
      Zweiter schneller elektronischer Kontaktweg: <a href="#/kontakt" data-legal="kontakt">Online-Kontaktformular öffnen</a></p>

      <h4>Verantwortlich für Inhalte nach § 18 Abs. 2 MStV</h4>
      <p>Kayden Schunack, Lerchesflurweg 67, 66119 Saarbrücken.</p>

      <h4>Meldung rechtswidriger Inhalte (Art. 16 Digital Services Act – DSA)</h4>
      <p>Nutzer können mit Coden AI eigene Web-Apps (<code>/a/…</code>) und Artefakte (<code>/s/…</code>) veröffentlichen. Hinweise auf rechtswidrige, urheberrechtsverletzende oder missbräuchliche Inhalte sende bitte unter Angabe der genauen URL und Begründung an <a href="mailto:kayden.schunack@gmail.com?subject=Inhalt%20melden%20(DSA)">kayden.schunack@gmail.com</a> oder direkt über unser <a href="#/kontakt" data-legal="kontakt">Kontaktformular (Kategorie „Inhalt melden (DSA)“)</a>. Gemeldete Inhalte werden unverzüglich geprüft und bei Rechtsverstößen entfernt.</p>

      <h4>Verbraucherstreitbeilegung (§ 36 VSBG)</h4>
      <p>Wir sind weder bereit noch verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>

      <h4>Hinweis zu Entgeltlichkeit &amp; Umsatzsteuer</h4>
      <p>Coden AI wird derzeit als kostenfreies Lern-, Entwicklungs- und Softwareprojekt betrieben. Sollten künftig kostenpflichtige Leistungen angeboten oder eine Umsatzsteuer-Identifikationsnummer erteilt werden, wird diese hier gemäß § 5 Abs. 1 Nr. 6 DDG ergänzt.</p>
    </div>
  `,
  kontakt: `
    <div class="legal-doc">
      <p class="legal-meta">Direkter Kontakt zu Kayden Schunack (Lerchesflurweg 67, 66119 Saarbrücken) · Antwort in der Regel innerhalb von 1–2 Werktagen</p>
      <form id="contact-form" class="contact-form" novalidate>
        <div class="legal-hp" aria-hidden="true">
          <label for="contact-website">Website</label>
          <input type="text" id="contact-website" name="website" tabindex="-1" autocomplete="off">
        </div>
        <div class="contact-grid">
          <div class="contact-field">
            <label for="contact-name">Dein Name *</label>
            <input type="text" id="contact-name" class="settings-input" required minlength="2" maxlength="100" placeholder="z. B. Max Mustermann" autocomplete="name">
          </div>
          <div class="contact-field">
            <label for="contact-email">Deine E-Mail-Adresse *</label>
            <input type="email" id="contact-email" class="settings-input" required maxlength="200" placeholder="name@beispiel.de" autocomplete="email">
          </div>
        </div>
        <div class="contact-grid">
          <div class="contact-field">
            <label for="contact-topic">Anliegen</label>
            <select id="contact-topic" class="settings-input">
              <option value="allgemein">Allgemein &amp; Feedback</option>
              <option value="datenschutz">Datenschutz / DSGVO-Anfrage</option>
              <option value="dsa">Rechtswidrigen Inhalt melden (DSA)</option>
              <option value="bug">Fehler / Bug melden</option>
              <option value="sonstiges">Sonstiges</option>
            </select>
          </div>
          <div class="contact-field">
            <label for="contact-subject">Betreff *</label>
            <input type="text" id="contact-subject" class="settings-input" required minlength="3" maxlength="140" placeholder="Kurze Zusammenfassung">
          </div>
        </div>
        <div class="contact-field">
          <label for="contact-message">Nachricht *</label>
          <textarea id="contact-message" class="settings-input" required minlength="10" maxlength="4000" rows="5" placeholder="Beschreibe dein Anliegen möglichst genau (bei Inhaltsmeldungen bitte die genaue URL mit angeben)…"></textarea>
          <div class="contact-meta-row">
            <span>Keine Passwörter oder geheimen API-Keys senden.</span>
            <span id="contact-char-count">0 / 4000</span>
          </div>
        </div>
        <label class="contact-check">
          <input type="checkbox" id="contact-privacy" required>
          <span>Ich habe die <a href="#/datenschutz" data-legal="datenschutz">Datenschutzhinweise</a> zur Verarbeitung meiner Kontaktanfrage zur Kenntnis genommen.</span>
        </label>
        <div id="contact-status" class="contact-status hidden" role="status" aria-live="polite"></div>
        <div class="contact-actions">
          <button type="submit" id="contact-submit-btn" class="btn-save">
            <span class="material-symbols-outlined">send</span>
            <span>Nachricht absenden</span>
          </button>
          <button type="button" id="contact-mailto-btn" class="btn-cancel">
            <span class="material-symbols-outlined">mail</span>
            <span>Im E-Mail-Programm öffnen</span>
          </button>
        </div>
      </form>
    </div>
  `,
  datenschutz: `
    <div class="legal-doc">
      <p class="legal-meta">Stand: 2026 · Informationen gemäß Art. 13 DSGVO &amp; § 25 TDDDG</p>

      <h4>1. Verantwortlicher</h4>
      <p>Kayden Schunack, Lerchesflurweg 67, 66119 Saarbrücken, E-Mail: <a href="mailto:kayden.schunack@gmail.com">kayden.schunack@gmail.com</a> (sowie <a href="#/kontakt" data-legal="kontakt">Kontaktformular</a>).</p>

      <h4>2. Welche Daten wir verarbeiten &amp; Rechtsgrundlagen</h4>
      <ul>
        <li><strong>Bereitstellung der Website &amp; Server-Protokolle (Art. 6 Abs. 1 lit. f DSGVO):</strong> Beim Aufruf der Seite verarbeitet unser Hosting-Anbieter (Vercel) technisch bedingt IP-Adresse, Zeitpunkt, Browsertyp und aufgerufene URL zur Auslieferung, Stabilität und Abwehr von Missbrauch (Rate-Limiting).</li>
        <li><strong>Nutzerkonto &amp; Anmeldung (Art. 6 Abs. 1 lit. b DSGVO):</strong> Bei Registrierung oder Login über Google oder E-Mail/Passwort (Firebase Authentication) werden E-Mail-Adresse, Nutzer-ID (UID) und Verifizierungsstatus verarbeitet.</li>
        <li><strong>Kontaktformular &amp; E-Mail-Anfragen (Art. 6 Abs. 1 lit. b / lit. f DSGVO):</strong> Wenn du uns über das Online-Kontaktformular oder per E-Mail schreibst, verarbeiten wir Name, E-Mail-Adresse, Kategorie, Betreff und Nachricht ausschließlich zur Bearbeitung und Beantwortung deines Anliegens.</li>
        <li><strong>Chats, Projekte, Lern-Studio, Apps &amp; Artefakte (Art. 6 Abs. 1 lit. b DSGVO):</strong> Gespeicherte Chats, Notizbücher, Handschriftprofile, Projekte, eigene Apps und veröffentlichte Artefakte werden in Google Firebase Firestore (sowie optional Neon Postgres) gespeichert, um sie geräteübergreifend bereitzustellen. Im <em>Temporären Chat</em> speichert Coden AI selbst keinen Verlauf in deiner Datenbank; die Eingaben werden zur Beantwortung dennoch an das gewählte KI-Modell übermittelt.</li>
        <li><strong>KI-Verarbeitung, kostenlose Free-Tier-Modelle &amp; Live-Sprachmodus (Art. 6 Abs. 1 lit. b / lit. f DSGVO):</strong> Eingaben, hochgeladene Dateien/Bilder, Sprachdaten und Kontext werden über unsere Server an den gewählten KI-Anbieter übermittelt (je nach Modell: Google Gemini / Gemini Live, OpenRouter, Groq, Cloudflare Workers AI sowie bei eigenen API-Schlüsseln (BYOK) der von dir konfigurierte Anbieter). <strong>Wichtiger Hinweis zu kostenlosen Modellen:</strong> Die standardmäßig bereitgestellten Modelle nutzen überwiegend kostenlose Free-Tier-Tarife der jeweiligen KI-Anbieter. Nach deren Nutzungs- und Datenschutzbedingungen können übermittelte Eingaben, Dateien und Antworten von den Drittanbietern <strong>gespeichert, eingesehen und zum Training bzw. zur Verbesserung ihrer KI-Modelle verwendet werden</strong>. <em>Gib daher in Standard-Chats niemals vertrauliche Geheimnisse, Passwörter, API-Keys, Gesundheits-/Finanzdaten oder personenbezogene Daten Dritter ohne deren Einwilligung ein.</em> Wenn du eigene kostenpflichtige API-Keys (BYOK) hinterlegst, gelten die Bedingungen deines eigenen Vertrags mit dem jeweiligen Anbieter.</li>
        <li><strong>Konnektoren, Websuche &amp; E-Mail-Versand (Art. 6 Abs. 1 lit. b / lit. a DSGVO):</strong> Externe Konnektoren (z. B. GitHub, MCP-Server), Websuchen und der E-Mail-Versand werden nur auf aktive Einrichtung bzw. Freigabe genutzt. Eigene API-Keys und OAuth-Tokens werden serverseitig verschlüsselt gespeichert.</li>
        <li><strong>Push-Benachrichtigungen (Art. 6 Abs. 1 lit. a DSGVO):</strong> Nur nach deiner ausdrücklichen Browser-Freigabe (Web Push); jederzeit unter <em>Einstellungen → Benachrichtigungen</em> widerrufbar.</li>
        <li><strong>Schriftarten &amp; Kern-Bibliotheken:</strong> Alle UI-Schriftarten (inkl. Handschrift- und Icon-Fonts) sowie Markdown-/Formel-/Code-Bibliotheken werden lokal von unserem Server (Self-Hosting) ausgeliefert. Beim Laden der App werden <strong>keine Anfragen an Google Fonts oder externe CDN-Skripte</strong> gesendet.</li>
      </ul>

      <h4>3. Lokale Speicherung &amp; Cookies (§ 25 Abs. 2 Nr. 2 TDDDG)</h4>
      <p>Wir verwenden <strong>keine Werbe-, Tracking- oder Analyse-Cookies</strong>. Der Browser-Speicher (<code>localStorage</code>) wird ausschließlich technisch erforderlich eingesetzt, um deine Anmeldesitzung, Design-Wahl (Hell/Dunkel), Chat-Zwischenspeicher, Lern-Studio-Zustand und die Bestätigung dieses Hinweises zu speichern.</p>

      <h4>4. Empfänger &amp; Datenübermittlung in Drittländer (Art. 44 ff. DSGVO)</h4>
      <p>Zur technischen Bereitstellung setzen wir Dienstleister (Auftragsverarbeiter / Partner) ein, darunter Vercel Inc. (Hosting), Google Ireland Ltd. / Google LLC (Firebase Auth/Firestore, Gemini) sowie ggf. Neon, Groq, OpenRouter, Cloudflare oder vom Nutzer per BYOK gewählte Anbieter. Soweit Daten in die USA übertragen werden, erfolgt dies auf Grundlage des EU-US Data Privacy Frameworks (DPF) und/oder von EU-Standardvertragsklauseln (SCC).</p>

      <h4>5. Speicherdauer</h4>
      <p>Deine Kontodaten in Coden AI bleiben gespeichert, bis du sie selbst löschst oder eine Löschung verlangst. Kontaktanfragen werden gelöscht, sobald sie abschließend bearbeitet sind und keine gesetzlichen Aufbewahrungspflichten entgegenstehen. Kurzlebige Hintergrund-Aufgaben (<code>ai_runs</code>) werden regelmäßig bereinigt. Soweit Eingaben über kostenlose Free-Tier-Schnittstellen an externe KI-Anbieter übermittelt wurden, richten sich dortige Speicher- und Trainingsfristen nach den Richtlinien des jeweiligen Drittanbieters.</p>

      <h4>6. Minderjährige (Art. 8 DSGVO)</h4>
      <p>Die Nutzung dieses Dienstes ist Personen ab 16 Jahren gestattet. Personen unter 16 Jahren dürfen Coden AI und das Lern-Studio nur mit ausdrücklicher Einwilligung ihrer Erziehungsberechtigten nutzen.</p>

      <h4>7. Deine Rechte (Art. 15–21, 77 DSGVO)</h4>
      <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit sowie Widerspruch und Widerruf erteilter Einwilligungen. Export und Kontolöschung kannst du direkt unter <em>Einstellungen → Rechtliches</em> ausführen.</p>
      <p><strong>Beschwerderecht bei der Aufsichtsbehörde:</strong><br>
      Unabhängiges Datenschutzzentrum Saarland, Fritz-Dobisch-Straße 12, 66111 Saarbrücken (E-Mail: poststelle@datenschutz.saarland.de).</p>
    </div>
  `,
  agb: `
    <div class="legal-doc">
      <p class="legal-meta">Stand: 2026 · Nutzungsbedingungen von Coden AI</p>

      <h4>1. Geltungsbereich &amp; Teilnahmevoraussetzungen</h4>
      <p>Diese Nutzungsbedingungen regeln die Nutzung der Webanwendung <strong>Coden AI</strong>. Die Nutzung durch Personen unter 16 Jahren erfordert die Einwilligung der Erziehungsberechtigten.</p>

      <h4>2. Leistungen &amp; KI-Hinweis</h4>
      <p>Coden AI stellt Werkzeuge für KI-gestützte Softwareentwicklung, Recherche, App-Erstellung und das Lern-Studio bereit. Alle Antworten, Quellcodes und Bewertungen werden automatisiert durch generative KI erzeugt. Sie können sachliche Fehler, Sicherheitslücken oder unvollständige Angaben („Halluzinationen“) enthalten und sind vor jeder Verwendung eigenverantwortlich zu prüfen.</p>

      <h4>3. Kostenlose KI-Modelle, Datennutzung durch Drittanbieter &amp; Verbot sensibler Eingaben</h4>
      <p>Damit Coden AI kostenlos genutzt werden kann, greifen die standardmäßig bereitgestellten Modelle auf <strong>kostenlose Tarife (Free-Tier-APIs) externer KI-Anbieter</strong> zurück (u. a. Google Gemini, OpenRouter, Groq, Cloudflare). Mit der Nutzung erklärst du dich ausdrücklich darüber informiert und einverstanden, dass:</p>
      <ul>
        <li>alle von dir gesendeten Nachrichten, Prompts, hochgeladenen Dateien/Bilder, Spracheingaben sowie erzeugte Ausgaben an den jeweiligen KI-Drittanbieter übermittelt werden (auch im Modus <em>Temporärer Chat</em>, der lediglich eine Speicherung in unserer eigenen Datenbank verhindert);</li>
        <li>die externen KI-Anbieter diese Daten im Rahmen ihrer Free-Tier-Bedingungen <strong>protokollieren, durch autorisiertes Personal bzw. automatisiert auswerten und zum Training sowie zur Weiterentwicklung ihrer KI-Modelle verwenden können</strong>;</li>
        <li>du <strong>keine vertraulichen Informationen, Geschäfts-, Schul- oder Betriebsgeheimnisse, Passwörter, API-Schlüssel, Zahlungs-/Gesundheitsdaten oder personenbezogene Daten anderer Personen ohne deren Einwilligung</strong> in Standard-Chats eingeben darfst.</li>
      </ul>
      <p>Wenn du eine Verarbeitung ohne Free-Tier-Training benötigst, kannst du unter <em>Einstellungen → Modelle &amp; Keys (BYOK)</em> einen eigenen, kostenpflichtigen API-Schlüssel eines Anbieters deiner Wahl einbinden; in diesem Fall gelten die Konditionen deines eigenen API-Vertrags.</p>

      <h4>4. Besonderer Hinweis zum Lern-Studio</h4>
      <p>Korrekturen, Punkteinschätzungen, Lernpläne und Handschrift-Ausgaben im Lern-Studio dienen ausschließlich als unverbindliche Übungs- und Lernhilfe. Sie stellen keine amtliche oder schulische Bewertung dar und begründen keinen Anspruch auf ein bestimmtes Prüfungsergebnis.</p>

      <h4>5. Veröffentlichte Apps (/a/) &amp; Artefakte (/s/)</h4>
      <p>Nutzer tragen die alleinige Verantwortung für Inhalte, Web-Apps und Artefakte, die sie über Coden AI erstellen oder öffentlich teilen. Untersagt sind insbesondere rechtswidrige Inhalte, Urheberrechts- oder Persönlichkeitsrechtsverletzungen, Schadcode/Malware, Phishing und automatisierter Missbrauch. Bei Verstößen kann der Zugang gesperrt und der veröffentlichte Inhalt umgehend entfernt werden.</p>

      <h4>6. Verfügbarkeit &amp; Kontokündigung</h4>
      <p>Coden AI wird unentgeltlich als Projekt bereitgestellt. Es besteht kein Anspruch auf ständige Erreichbarkeit oder unbegrenzte Kontingente. Du kannst dein Konto jederzeit unter <em>Einstellungen → Rechtliches</em> löschen.</p>

      <h4>7. Haftung (§ 309 Nr. 7 BGB)</h4>
      <p>Für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit, bei Vorsatz oder grober Fahrlässigkeit sowie nach den Vorschriften des Produkthaftungsgesetzes haftet der Anbieter unbeschränkt.</p>
      <p>Bei leicht fahrlässiger Verletzung einer wesentlichen Vertragspflicht (Kardinalpflicht) ist die Haftung auf den vertragstypischen, vorhersehbaren Schaden begrenzt. Im Übrigen ist die Haftung für leichte Fahrlässigkeit – insbesondere für die inhaltliche Richtigkeit unentgeltlich generierter KI-Ausgaben, Quellcodes oder Lernhinweise – ausgeschlossen.</p>

      <h4>8. Schlussbestimmungen</h4>
      <p>Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts; zwingende Verbraucherschutzvorschriften des Staates, in dem du deinen gewöhnlichen Aufenthalt hast, bleiben unberührt.</p>
    </div>
  `,
  ki: `
    <div class="legal-doc">
      <p class="legal-meta">Transparenzpflichten gemäß Art. 50 der EU-KI-Verordnung (EU AI Act)</p>

      <h4>1. Interaktion mit einem KI-System (Art. 50 Abs. 1 KI-VO)</h4>
      <p>Bei Coden AI kommunizierst du – sowohl im Text-Chat als auch im Live-Sprachmodus, im Lern-Studio, bei Recherche-Berichten und beim App-Builder – mit einem <strong>System künstlicher Intelligenz (KI)</strong> und nicht mit einem Menschen.</p>

      <h4>2. Kennzeichnung KI-generierter Medien &amp; Inhalte (Art. 50 Abs. 2 &amp; 4 KI-VO)</h4>
      <ul>
        <li><strong>KI-Bilder:</strong> Im Chat oder für Apps erstellte Bilder werden durch generative Bildmodelle (z. B. Flux) erzeugt. Sie werden in der Benutzeroberfläche als <em>KI-generiert</em> sowie technisch über Metadaten (u. a. HTTP-Header <code>X-AI-Generated: true</code>) gekennzeichnet.</li>
        <li><strong>Öffentliche Artefakte &amp; Apps:</strong> Öffentlich geteilte Seiten unter <code>/s/…</code> und <code>/a/…</code> tragen einen sichtbaren Hinweis auf die Erstellung mit KI („Mit Coden (KI) erstellt/gebaut“).</li>
      </ul>

      <h4>3. Verlässlichkeit, kostenlose KI-Modelle &amp; Menschliche Kontrolle</h4>
      <p>Generative KI kann trotz Sorgfalt unzutreffende Aussagen treffen, fehlerhaften Code erzeugen oder veraltete Informationen ausgeben. Prüfe sicherheitsrelevante, rechtliche, medizinische oder produktive Ergebnisse stets selbst, bevor du sie übernimmst. Da die Standard-Modelle über kostenlose Tarife (Free Tier) externer Anbieter laufen, können deine Eingaben dort ggf. für KI-Training genutzt werden – gib niemals Geheimnisse oder Passwörter ein.</p>
    </div>
  `
};

function sanitizeTab(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'impressum' || t === 'kontakt' || t === 'datenschutz' || t === 'agb' || t === 'ki') return t;
  if (t === 'contact' || t === 'kontaktformular') return 'kontakt';
  if (t === 'nutzungsbedingungen' || t === 'terms') return 'agb';
  if (t === 'privacy') return 'datenschutz';
  if (t === 'ai' || t === 'ki-hinweis') return 'ki';
  return 'impressum';
}

function buildMailtoHref({ name, email, topic, subject, message }) {
  const label = TOPIC_LABELS[topic] || 'Anfrage';
  const subj = `[Coden AI · ${label}] ${subject || 'Kontaktanfrage'}`;
  const body = [
    `Name: ${name || '-'}`,
    `E-Mail: ${email || '-'}`,
    `Thema: ${label}`,
    '',
    message || ''
  ].join('\n');
  return `mailto:${OWNER_EMAIL}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
}

function readStoredUserName() {
  try {
    const raw = localStorage.getItem('coden_settings');
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s.userName === 'string') return s.userName.trim();
    }
  } catch (_) {}
  return '';
}

function bindContactForm(bodyWrap) {
  const form = bodyWrap.querySelector('#contact-form');
  if (!form) return;

  const nameEl = form.querySelector('#contact-name');
  const emailEl = form.querySelector('#contact-email');
  const topicEl = form.querySelector('#contact-topic');
  const subjectEl = form.querySelector('#contact-subject');
  const msgEl = form.querySelector('#contact-message');
  const websiteEl = form.querySelector('#contact-website');
  const privacyEl = form.querySelector('#contact-privacy');
  const countEl = form.querySelector('#contact-char-count');
  const statusEl = form.querySelector('#contact-status');
  const submitBtn = form.querySelector('#contact-submit-btn');
  const mailtoBtn = form.querySelector('#contact-mailto-btn');

  if (nameEl && !nameEl.value) nameEl.value = readStoredUserName();
  if (emailEl && !emailEl.value && auth.currentUser?.email) emailEl.value = auth.currentUser.email;

  const updateCount = () => {
    if (countEl && msgEl) countEl.textContent = `${msgEl.value.length} / 4000`;
  };
  msgEl?.addEventListener('input', updateCount);
  updateCount();

  const setStatus = (kind, text, mailtoHref = '') => {
    if (!statusEl) return;
    statusEl.className = `contact-status ${kind}`;
    statusEl.replaceChildren();
    const p = document.createElement('div');
    p.textContent = text;
    statusEl.append(p);
    if (mailtoHref) {
      const a = document.createElement('a');
      a.href = mailtoHref;
      a.className = 'btn-save';
      a.style.marginTop = '8px';
      a.textContent = 'Jetzt im E-Mail-Programm senden';
      statusEl.append(a);
    }
  };

  mailtoBtn?.addEventListener('click', () => {
    const href = buildMailtoHref({
      name: nameEl?.value.trim(),
      email: emailEl?.value.trim(),
      topic: topicEl?.value,
      subject: subjectEl?.value.trim(),
      message: msgEl?.value.trim()
    });
    const a = document.createElement('a');
    a.href = href;
    a.click();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: nameEl?.value.trim() || '',
      email: emailEl?.value.trim() || '',
      topic: topicEl?.value || 'allgemein',
      subject: subjectEl?.value.trim() || '',
      message: msgEl?.value.trim() || '',
      website: websiteEl?.value || '',
      privacyAccepted: !!privacyEl?.checked
    };

    if (payload.name.length < 2) { setStatus('err', 'Bitte gib deinen Namen ein (mindestens 2 Zeichen).'); nameEl?.focus(); return; }
    if (!/^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/.test(payload.email)) { setStatus('err', 'Bitte gib eine gültige E-Mail-Adresse ein.'); emailEl?.focus(); return; }
    if (payload.subject.length < 3) { setStatus('err', 'Bitte gib einen Betreff ein (mindestens 3 Zeichen).'); subjectEl?.focus(); return; }
    if (payload.message.length < 10) { setStatus('err', 'Bitte schreibe mindestens 10 Zeichen in deine Nachricht.'); msgEl?.focus(); return; }
    if (!payload.privacyAccepted) { setStatus('err', 'Bitte bestätige die Datenschutzhinweise.'); privacyEl?.focus(); return; }

    if (submitBtn) submitBtn.disabled = true;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (auth.currentUser?.getIdToken) {
        try {
          const tok = await auth.currentUser.getIdToken();
          if (tok) headers.Authorization = `Bearer ${tok}`;
        } catch (_) {}
      }
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setStatus('ok', `Anfrage (#${data.id}) erfolgreich gesendet! Wir melden uns über deine E-Mail-Adresse.`);
        if (subjectEl) subjectEl.value = '';
        if (msgEl) msgEl.value = '';
        if (privacyEl) privacyEl.checked = false;
        updateCount();
        toast('Kontaktanfrage gesendet.', { type: 'ok' });
        refreshContactInbox();
      } else if (data.fallbackMailto) {
        const href = buildMailtoHref(payload);
        setStatus('warn', data.error || 'Bitte sende die Anfrage über dein E-Mail-Programm ab.', href);
      } else {
        setStatus('err', data.error || 'Senden fehlgeschlagen. Bitte prüfe deine Eingaben.');
      }
    } catch (_) {
      const href = buildMailtoHref(payload);
      setStatus('warn', 'Verbindung fehlgeschlagen. Du kannst die Anfrage direkt über dein E-Mail-Programm absenden.', href);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

export function openLegalModal(type = 'impressum') {
  const modal = document.getElementById('legal-modal');
  const titleEl = document.getElementById('legal-title');
  const contentEl = document.getElementById('legal-content');
  if (!modal || !titleEl || !contentEl) return;

  const active = sanitizeTab(type);
  const meta = LEGAL_TABS.find(x => x.id === active) || LEGAL_TABS[0];
  titleEl.textContent = meta.title;

  const tabsNav = document.createElement('div');
  tabsNav.className = 'legal-tabs';
  tabsNav.setAttribute('role', 'tablist');
  for (const tab of LEGAL_TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'legal-tab' + (tab.id === active ? ' active' : '');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(tab.id === active));
    btn.textContent = tab.label;
    btn.addEventListener('click', () => openLegalModal(tab.id));
    tabsNav.append(btn);
  }

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'legal-doc-wrap';
  bodyWrap.innerHTML = LEGAL_HTML[active] || LEGAL_HTML.impressum;
  if (active === 'kontakt') bindContactForm(bodyWrap);

  contentEl.replaceChildren(tabsNav, bodyWrap);
  contentEl.scrollTop = 0;
  modal.classList.remove('hidden');
}

async function exportMyData(btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await apiFetch('/account/export');
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error(data?.error || 'Export fehlgeschlagen.');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coden-ai-datenexport-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Datenexport heruntergeladen (JSON).', { type: 'ok' });
  } catch (e) {
    toast(e.message || 'Export nicht möglich.', { type: 'error' });
  } finally {
    if (btn) btn.disabled = false;
  }
}

function clearLocalCacheOnly(showCustomConfirm) {
  return async () => {
    const ok = showCustomConfirm
      ? await showCustomConfirm({
          title: 'Lokalen Cache leeren?',
          message: 'Entfernt zwischengespeicherte Sitzungen und UI-Einstellungen aus diesem Browser. Deine in der Cloud gespeicherten Daten bleiben erhalten.',
          icon: 'cleaning_services',
          confirmLabel: 'Cache leeren',
          cancelLabel: 'Abbrechen'
        })
      : true;
    if (!ok) return;
    Storage.clearLocalUserCache?.();
    for (const k of ['coden_settings', 'coden_cookies_accepted', 'coden_last_broadcast', 'coden_last_update', 'coden_last_clear', 'coden_hw_mode']) {
      try { localStorage.removeItem(k); } catch (_) {}
    }
    toast('Lokaler Browser-Speicher geleert.', { type: 'ok' });
  };
}

async function deleteMyAccount(btn, showCustomConfirm) {
  const ok = showCustomConfirm
    ? await showCustomConfirm({
        title: 'Konto & alle Daten endgültig löschen?',
        subtitle: 'Art. 17 DSGVO · Unwiderruflich',
        message: 'Alle deine Chats, Projekte, Lern-Studio-Seiten, Apps, Artefakte, API-Schlüssel und dein Login-Konto werden dauerhaft gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden.',
        icon: 'delete_forever',
        danger: true,
        confirmLabel: 'Endgültig löschen',
        cancelLabel: 'Abbrechen'
      })
    : false;
  if (!ok) return;

  if (btn) btn.disabled = true;
  try {
    await apiJson('/account', { method: 'DELETE' });
    Storage.clearLocalUserCache?.();
    try { localStorage.removeItem('coden_settings'); } catch (_) {}

    try {
      await deleteAccount();
      document.getElementById('settings-modal')?.classList.add('hidden');
      toast('Konto und Cloud-Daten wurden dauerhaft gelöscht.', { type: 'ok', ms: 6000 });
    } catch (authErr) {
      if (authErr?.code === 'auth/requires-recent-login') {
        document.getElementById('settings-modal')?.classList.add('hidden');
        toast('Cloud-Daten gelöscht. Aus Sicherheitsgründen bitte kurz neu anmelden und die Kontolöschung bestätigen.', { type: 'warn', ms: 9000 });
        await logoutUser().catch(() => {});
        return;
      }
      throw authErr;
    }
  } catch (e) {
    toast(e.message || 'Löschen fehlgeschlagen.', { type: 'error' });
  } finally {
    if (btn) btn.disabled = false;
  }
}

let inboxBoxRef = null;
let inboxTitleRef = null;
async function refreshContactInbox() {
  if (!inboxBoxRef || !auth.currentUser) return;
  if (inboxTitleRef) {
    inboxTitleRef.textContent = auth.currentUser.isOwner
      ? 'Eingegangene Kontaktanfragen'
      : 'Meine Kontaktanfragen';
  }
  inboxBoxRef.textContent = 'Lade Anfragen …';
  try {
    const { items = [] } = await apiJson('/contact');
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'settings-hint';
      empty.textContent = auth.currentUser.isOwner
        ? 'Noch keine Kontaktanfragen eingegangen.'
        : 'Du hast bisher keine Anfragen über das Kontaktformular gesendet.';
      inboxBoxRef.replaceChildren(empty);
      return;
    }

    const cards = items.map((item) => {
      const card = document.createElement('div');
      card.className = 'contact-inbox-card';

      const top = document.createElement('div');
      top.className = 'contact-inbox-top';

      const statusBadge = document.createElement('span');
      statusBadge.className = `contact-badge ${item.status === 'done' ? 'done' : 'open'}`;
      statusBadge.textContent = item.status === 'done' ? 'Erledigt' : 'Offen';

      const topicBadge = document.createElement('span');
      topicBadge.className = 'contact-badge';
      topicBadge.textContent = TOPIC_LABELS[item.topic] || item.topic || 'Anfrage';

      const who = document.createElement('span');
      const when = item.created_at ? new Date(item.created_at).toLocaleString('de-DE') : '';
      who.textContent = `${item.name || ''} (${item.email || ''})${when ? ' · ' + when : ''}`;

      top.append(statusBadge, topicBadge, who);

      const subj = document.createElement('div');
      subj.className = 'contact-inbox-subject';
      subj.textContent = item.subject || '(Ohne Betreff)';

      const body = document.createElement('div');
      body.className = 'contact-inbox-body';
      body.textContent = item.message || '';

      const btns = document.createElement('div');
      btns.className = 'contact-inbox-btns';

      if (auth.currentUser?.isOwner) {
        const nextStatus = item.status === 'done' ? 'open' : 'done';
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn-cancel';
        toggleBtn.textContent = nextStatus === 'done' ? 'Als erledigt markieren' : 'Wieder öffnen';
        toggleBtn.addEventListener('click', async () => {
          toggleBtn.disabled = true;
          try {
            await apiJson(`/contact/${item.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: nextStatus })
            });
            refreshContactInbox();
          } catch (e) {
            toast(e.message || 'Status-Änderung fehlgeschlagen.', { type: 'error' });
            toggleBtn.disabled = false;
          }
        });
        btns.append(toggleBtn);
      }

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-cancel legal-danger-btn';
      delBtn.textContent = 'Löschen';
      delBtn.addEventListener('click', async () => {
        delBtn.disabled = true;
        try {
          await apiJson(`/contact/${item.id}`, { method: 'DELETE' });
          toast('Anfrage gelöscht.', { type: 'ok' });
          refreshContactInbox();
        } catch (e) {
          toast(e.message || 'Löschen fehlgeschlagen.', { type: 'error' });
          delBtn.disabled = false;
        }
      });
      btns.append(delBtn);

      card.append(top, subj, body, btns);
      return card;
    });

    inboxBoxRef.replaceChildren(...cards);
  } catch (e) {
    const err = document.createElement('p');
    err.className = 'settings-hint';
    err.textContent = e.message || 'Anfragen konnten nicht geladen werden.';
    inboxBoxRef.replaceChildren(err);
  }
}

export function renderLegalSettings(showCustomConfirm) {
  const pane = document.querySelector('#settings-modal .st-pane[data-pane="legal"]');
  if (!pane) return;

  pane.innerHTML = '';

  const hDocs = document.createElement('h4');
  hDocs.textContent = 'Pflichtangaben, Kontakt & Richtlinien';

  const docsRow = document.createElement('div');
  docsRow.className = 'legal-btn-grid';
  for (const [id, label] of [
    ['open-impressum-btn', 'Impressum (§ 5 DDG)'],
    ['open-kontakt-btn', 'Kontaktformular'],
    ['open-datenschutz-btn', 'Datenschutz (DSGVO)'],
    ['open-agb-btn', 'Nutzungsbedingungen'],
    ['open-ki-btn', 'KI-Transparenz (AI Act)']
  ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-cancel';
    b.id = id;
    b.textContent = label;
    docsRow.append(b);
  }

  const hRights = document.createElement('h4');
  hRights.style.marginTop = '24px';
  hRights.textContent = 'Deine Datenschutz-Rechte (DSGVO)';

  const hint = document.createElement('p');
  hint.className = 'settings-hint';
  hint.textContent = 'Du kannst jederzeit eine maschinenlesbare Kopie deiner gespeicherten Daten herunterladen (Art. 20 DSGVO) oder dein Konto samt Cloud-Daten endgültig löschen (Art. 17 DSGVO).';

  const actions = document.createElement('div');
  actions.className = 'legal-actions';

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.id = 'legal-export-btn';
  exportBtn.className = 'btn-cancel';
  exportBtn.innerHTML = '<span class="material-symbols-outlined">download</span><span>Meine Daten exportieren (JSON)</span>';
  exportBtn.addEventListener('click', () => exportMyData(exportBtn));

  const cacheBtn = document.createElement('button');
  cacheBtn.type = 'button';
  cacheBtn.id = 'legal-clear-cache-btn';
  cacheBtn.className = 'btn-cancel';
  cacheBtn.innerHTML = '<span class="material-symbols-outlined">cleaning_services</span><span>Lokalen Browser-Cache leeren</span>';
  cacheBtn.addEventListener('click', clearLocalCacheOnly(showCustomConfirm));

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.id = 'legal-delete-account-btn';
  delBtn.className = 'btn-cancel legal-danger-btn';
  delBtn.innerHTML = '<span class="material-symbols-outlined">delete_forever</span><span>Konto &amp; alle Cloud-Daten löschen</span>';
  delBtn.addEventListener('click', () => deleteMyAccount(delBtn, showCustomConfirm));

  actions.append(exportBtn, cacheBtn, delBtn);

  const inboxHead = document.createElement('div');
  inboxHead.className = 'contact-inbox-head';
  const hInbox = document.createElement('h4');
  hInbox.style.margin = '0';
  hInbox.textContent = 'Kontaktanfragen';
  const reloadBtn = document.createElement('button');
  reloadBtn.type = 'button';
  reloadBtn.className = 'btn-cancel';
  reloadBtn.style.padding = '5px 10px';
  reloadBtn.style.fontSize = '12px';
  reloadBtn.textContent = 'Aktualisieren';
  reloadBtn.addEventListener('click', refreshContactInbox);
  inboxHead.append(hInbox, reloadBtn);

  const inboxList = document.createElement('div');
  inboxList.className = 'contact-inbox-list';
  inboxBoxRef = inboxList;
  inboxTitleRef = hInbox;

  pane.append(hDocs, docsRow, hRights, hint, actions, inboxHead, inboxList);
}

export function initLegal({ showCustomConfirm } = {}) {
  renderLegalSettings(showCustomConfirm);

  const modal = document.getElementById('legal-modal');
  document.getElementById('close-legal-btn')?.addEventListener('click', () => modal?.classList.add('hidden'));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
    }
  });

  onAuthStateChanged(auth, (u) => {
    if (u) refreshContactInbox();
  });

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-legal]');
    if (trigger) {
      e.preventDefault();
      openLegalModal(trigger.getAttribute('data-legal'));
      return;
    }
    const btn = e.target.closest('#open-impressum-btn, #open-kontakt-btn, #open-datenschutz-btn, #open-agb-btn, #open-ki-btn');
    if (btn) {
      e.preventDefault();
      const map = {
        'open-impressum-btn': 'impressum',
        'open-kontakt-btn': 'kontakt',
        'open-datenschutz-btn': 'datenschutz',
        'open-agb-btn': 'agb',
        'open-ki-btn': 'ki'
      };
      openLegalModal(map[btn.id]);
      return;
    }
    if (e.target.closest('.st-tab[data-tab="legal"]')) {
      refreshContactInbox();
    }
  });

  const checkUrlLegal = () => {
    try {
      const q = new URLSearchParams(location.search).get('legal');
      if (q) { openLegalModal(q); return; }
      const h = (location.hash || '').replace(/^#\/?/, '').toLowerCase();
      if (['impressum', 'kontakt', 'datenschutz', 'agb', 'ki'].includes(h)) openLegalModal(h);
    } catch (_) {}
  };
  checkUrlLegal();
  window.addEventListener('hashchange', checkUrlLegal);
}
