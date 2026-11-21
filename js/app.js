// js/app.js
import './dom-safe.js';
import { CONFIG } from './config.js';
import { generateAiResponse, streamAiResponse } from './api.js';
import { ARTIFACT_PROMPT, Artifacts } from './artifacts.js';
import { Buddy } from './buddy.js';
import { Layout, greetingText } from './layout.js';
import { UI } from './ui.js';
import { toast } from './toast.js';
import { Storage } from './storage.js';
import { initGoogleLogin, loginWithEmail, registerWithEmail, logoutUser, onAuthStateChanged, auth } from './auth.js';
import { apiFetch, apiJson } from './backend.js';
import { checkRateLimit } from './Limit-Spamschutz.js';
import { MultimodalLivePrototype } from './multimodal-live-prototype.js'; // 🔥 NEU: Der Live Client 🔥
import { ChessEngine } from './Chess.js'; // 🔥 NEU HINZUGEFÜGT

// ==========================================
// 🏗️ 1. ALLE DOM-ELEMENTE
// ==========================================
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app');
const errorMsg = document.getElementById('auth-error-msg');
const userEmailDisplay = document.getElementById('user-email-display');
const chatInput = document.getElementById('main-input');
const sendBtn = document.getElementById('send-btn');
let streamAbort = null, sendWhenDone = false;
const stopBtn = document.getElementById('stop-btn');
function setStreaming(on) {
    if (stopBtn) stopBtn.classList.toggle('hidden', !on);
    if (sendBtn) { sendBtn.classList.toggle('queued', on); sendBtn.title = on ? 'Wird gesendet, sobald Coden fertig ist' : 'Senden'; }
}
if (stopBtn) stopBtn.addEventListener('click', () => { sendWhenDone = false; if (streamAbort) streamAbort.abort(); });
const commandPopup = document.getElementById('command-popup');
const newChatBtn = document.querySelector('.new-chat-btn');
const liveCallBtn = document.getElementById('live-call-btn'); // Stelle sicher, dass du im HTML einen Button mit der ID 'live-call-btn' hast!
const liveStatusIndicator = document.getElementById('live-status-indicator'); // Ein kleines Icon/Text-Element für den Status
const attachmentBtn = document.getElementById('attachment-btn'); 
const emailModal = document.getElementById('email-modal');
const settingsModal = document.getElementById('settings-modal');
const confirmModal = document.getElementById('confirm-modal');
const cookieBanner = document.getElementById('cookie-banner');
const acceptCookiesBtn = document.getElementById('accept-cookies-btn');

// ==========================================
// 👑 2. GLOBALE VARIABLEN & STATUS
// ==========================================
let sessions = [];
let currentSession = null;
let activeSessionId = null;
let appInitialized = false;

let pendingAttachments = []; // Speichert unsere angehängten Dateien temporär

let isOwner = false;
let globalLockedModels = { pro: false, thinking: false }; 
let currentSelectedModel = 'flash';

let lastBroadcastTime = parseInt(localStorage.getItem('coden_last_broadcast')) || Date.now();
let lastUpdateTime = parseInt(localStorage.getItem('coden_last_update')) || Date.now();
let lastGlobalClearTime = parseInt(localStorage.getItem('coden_last_clear')) || Date.now();

function showError(msg) { 
    if (errorMsg) { 
        errorMsg.textContent = msg; 
        errorMsg.style.display = 'block'; 
    }
    console.error("System-Info:", msg);
}

// ==========================================
// 🍪 3. COOKIE BANNER LOGIK
// ==========================================
if (cookieBanner && !localStorage.getItem('coden_cookies_accepted')) {
    cookieBanner.classList.remove('hidden');
}

if (acceptCookiesBtn) {
    acceptCookiesBtn.addEventListener('click', () => {
        localStorage.setItem('coden_cookies_accepted', 'true');
        cookieBanner.classList.add('hidden');
    });
}

// ==========================================
// 🛡️ 4. AUTHENTIFIZIERUNG
// ==========================================
initGoogleLogin((msg) => showError(msg));

if (document.getElementById('btn-email-login')) {
    document.getElementById('btn-email-login').addEventListener('click', async () => { 
        const e = document.getElementById('auth-email').value.trim(); 
        const p = document.getElementById('auth-password').value.trim(); 
        
        if (e && p) {
            try { 
                await loginWithEmail(e, p); 
            } catch(err) { 
                showError("❌ " + err.message);
            } 
        } else {
            showError("❌ Bitte E-Mail und Passwort eingeben!");
        }
    });
}

if (document.getElementById('btn-email-register')) {
    document.getElementById('btn-email-register').addEventListener('click', async () => { 
        const e = document.getElementById('auth-email').value.trim(); 
        const p = document.getElementById('auth-password').value.trim(); 
        
        if (e && p) {
            try { 
                await registerWithEmail(e, p);
            } catch(err) { 
                showError("❌ " + err.message);
            } 
        } else {
            showError("❌ Bitte E-Mail und Passwort eingeben!");
        }
    });
}

if (document.getElementById('logout-btn')) {
    document.getElementById('logout-btn').addEventListener('click', () => { 
        try { 
            logoutUser(); 
        } catch(e) { 
            console.error(e); 
        } 
    });
}

function extractNameFromEmail(email) {
    if (!email) return "Entwickler";
    return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function updateGreeting() {
    try {
        const settings = Storage.getSettings();
        const greetingEl = document.getElementById('welcome-greeting');
        if (greetingEl) {
            greetingEl.textContent = greetingText(settings.userName || 'Entwickler');
            Layout.setUser(settings.userName, auth?.currentUser?.email);
        }
    } catch(e) {}
}

if (auth) {
    onAuthStateChanged(auth, async (user) => {
        try {
            if (user) {
                isOwner = user.isOwner === true; // vom Server entschieden
                const badge = document.getElementById('owner-badge');
                if (badge) badge.style.display = isOwner ? 'inline-block' : 'none';

                if (loginScreen) loginScreen.classList.add('hidden'); 
                if (appContainer) appContainer.classList.remove('hidden');
                if (userEmailDisplay) userEmailDisplay.textContent = user.email;
                
                try { 
                    if (Storage.loadFromCloud) await Storage.loadFromCloud(); 
                } catch(e) {}
                
                let settings = Storage.getSettings();
                if (!settings.userName) { 
                    settings.userName = extractNameFromEmail(user.email); 
                    Storage.saveSettings(settings); 
                }
                updateGreeting();

                if (!appInitialized) initApp(); 
                initGlobalSync(); 
            } else {
                if (loginScreen) loginScreen.classList.remove('hidden'); 
                if (appContainer) appContainer.classList.add('hidden');
                appInitialized = false; 
                isOwner = false;
            }
        } catch (err) { 
            showError("Fehler beim Laden deines Profils."); 
        }
    });
}

// ==========================================
// 🌐 5. GLOBALE DATENBANK (Live Sync)
// ==========================================
let globalSyncTimer = null;
function initGlobalSync() {
    clearInterval(globalSyncTimer);
    pollSystemState();
    // Neon schläft bei Inaktivität ein -> bewusst nur alle 30 s abfragen, nur bei sichtbarem Tab
    globalSyncTimer = setInterval(() => { if (!document.hidden && auth.currentUser) pollSystemState(); }, 30000);
}

async function pollSystemState() {
    try {
        const data = await apiJson('/system/state');
        {
            {
                
                // Modell-Sperren
                if (data.locks) {
                    globalLockedModels = data.locks;
                    const pOpt = document.getElementById('pro-mode-option'); 
                    const tOpt = document.getElementById('thinking-mode-option');
                    if (pOpt) pOpt.classList.toggle('disabled', data.locks.pro);
                    if (tOpt) tOpt.classList.toggle('disabled', data.locks.thinking);
                }
                
                // Modell-Zwang
                if (data.globalModel && data.globalModel !== currentSelectedModel) {
                    forceModelChange(data.globalModel, `🔄 Modell durch Admin auf ${data.globalModel} gewechselt.`);
                }
                
                // Broadcasts
                if (data.broadcast && data.broadcast.time > lastBroadcastTime) { 
                    lastBroadcastTime = data.broadcast.time; 
                    localStorage.setItem('coden_last_broadcast', lastBroadcastTime.toString()); // <-- NEU: Gemerkt!
                    if (!isOwner) showCustomConfirm("📢 SYSTEM BROADCAST:\n\n" + data.broadcast.message); 
                }
                
                // Force Update
                if (data.forceUpdate && data.forceUpdate > lastUpdateTime) { 
                    lastUpdateTime = data.forceUpdate; localStorage.setItem('coden_last_update', String(lastUpdateTime)); 
                    if (!isOwner) location.reload(); 
                }
                
                // Wartungsmodus
                if (data.maintenance && !isOwner) {
                    document.body.innerHTML = "<div style='display:flex; height:100vh; width:100vw; background:#111; color:white; align-items:center; justify-content:center; flex-direction:column;'><h1>🛠️ WARTUNGSARBEITEN</h1><p>Coden AI ist aktuell vom Admin gesperrt. Bitte warte.</p></div>";
                }
                
                // Theme & Font
                if (data.theme) {
                    document.body.style.filter = data.theme === 'matrix' ? "hue-rotate(90deg) invert(80%)" : "";
                }
                if (data.fontSize) {
                    document.documentElement.style.setProperty('--chat-font-size', data.fontSize + 'px');
                }
                
                // Global Clear
                if (data.globalClear && data.globalClear > lastGlobalClearTime) {
                    lastGlobalClearTime = data.globalClear; localStorage.setItem('coden_last_clear', String(lastGlobalClearTime));
                    sessions = [Storage.createNewSession()]; 
                    currentSession = sessions[0]; 
                    activeSessionId = currentSession.id;
                    Storage.saveSessions(sessions); 
                    UI.resetUI(); 
                    UI.renderSidebar(sessions, activeSessionId);
                    if (!isOwner) UI.appendMessage("⚠️ Der Administrator hat alle Chats global geleert.", false);
                }
            }
        }
    } catch (error) {}
}

function forceModelChange(newModel, msg) {
    currentSelectedModel = newModel;
    document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
    const opt = document.querySelector(`.model-option[data-model="${newModel}"]`);
    if (opt) {
        opt.classList.add('active');
        const textEl = document.getElementById('current-model-text');
        if (textEl) textEl.textContent = opt.querySelector('.name').textContent;
    }
    if (!isOwner) UI.appendMessage(msg, false);
}

// js/app.js

// ... (ganz viel Code ...) ...

// 🔥 NEU: Wir erstellen eine Instanz des Live-Clients 🔥
const multimodalLive = new MultimodalLivePrototype();

function initApp() {
    Buddy.init();
    Layout.init({ sessionsGetter: () => sessions });
    try {
        appInitialized = true; 
        sessions = Storage.getSessions();
        
        // Session laden oder neu erstellen
        if (sessions.length === 0) { 
            currentSession = Storage.createNewSession(); 
            sessions.push(currentSession); 
            Storage.saveSessions(sessions); 
        } else { 
            currentSession = sessions[0]; 
        }
        activeSessionId = currentSession.id;
        
        // 🔥 DER FIX: Wir zwingen die App, den Chat jetzt auch wirklich auf den Bildschirm zu malen!
        loadSession(activeSessionId);

        // Event-Listener für Chats
        document.addEventListener('loadChatSession', (e) => loadSession(e.detail)); 
        document.addEventListener('deleteChatSession', (e) => deleteSession(e.detail));
        document.addEventListener('togglePinSession', (e) => { const t = sessions.find(x => x.id === e.detail); if (!t) return; t.pinned = !t.pinned; Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId); });

        // ♟️ Schach initialisieren
        window.codenChess = new ChessEngine();
        window.codenChess.init();

        // Live Call Button
        const liveCallBtn = document.getElementById('live-call-btn');
        const liveStatusIndicator = document.getElementById('live-status-indicator');
        if (liveCallBtn && liveStatusIndicator) {
            liveCallBtn.addEventListener('click', () => {
                if (multimodalLive.isSessionActive) {
                    multimodalLive.stopSession(liveCallBtn, liveStatusIndicator);
                } else {
                    if (!currentSelectedModel.includes('flash')) {
                        toast('Der Live-Sprachmodus braucht Coden Flash. Wechsle unten rechts das Modell.', { type: 'warn' });
                        return;
                    }
                    // 🔥 NEU: Wir übergeben das Gedächtnis an den Anruf!
                    multimodalLive.initSession(liveCallBtn, liveStatusIndicator, currentSession.messages);
                }
            });
        }

        // 🔥 NEU: Wenn die Stimme im Call geändert wird, Anruf kurz neu starten
        const voiceSelector = document.getElementById('live-voice-selector');
        if (voiceSelector) {
            voiceSelector.addEventListener('change', () => {
                if (multimodalLive.isSessionActive) {
                    // Legt unsichtbar auf und ruft sofort mit der neuen Stimme wieder an
                    multimodalLive.stopSession(liveCallBtn, liveStatusIndicator);
                    setTimeout(() => {
                        multimodalLive.initSession(liveCallBtn, liveStatusIndicator, currentSession.messages);
                    }, 500);
                }
            });
        }

        
    } catch(e) { console.error("Fehler beim Init:", e); }
}

// ... (ganz viel Code bis zum Ende ...) ...

// ==========================================
// 🚀 6. OWNER COMMANDS (Vollständig!)
// ==========================================
const commands = [
    { name: "/lock", opts: ["pro", "thinking"], desc: "Sperrt Modell GLOBAL" },
    { name: "/unlock", opts: ["pro", "thinking"], desc: "Entsperrt Modell GLOBAL" },
    { name: "/broadcast", opts: ["<nachricht>"], desc: "Pop-Up an ALLE User" },
    { name: "/maintenance", opts: ["on", "off"], desc: "Sperrt App komplett" },
    { name: "/forceupdate", desc: "Erzwingt Reload bei Usern" },
    { name: "/model", opts: ["flash", "normal", "pro"], desc: "Ändert Modell GLOBAL" },
    { name: "/theme", opts: ["normal", "matrix"], desc: "Ändert Design GLOBAL" },
    { name: "/font", opts: ["12", "15", "18", "22"], desc: "Ändert Schriftgröße GLOBAL" },
    { name: "/clearall", desc: "Leert Chats bei ALLEN Usern" },
    { name: "/api", opts: ["<KEY>"], desc: "Speichert Google Key" },
    { name: "/usage", opts: ["<email>"], desc: "Zeigt Modell-Aufrufe" },
    { name: "/stats", desc: "Zeigt System-Statistiken" },
    { name: "/chess", desc: "Spiele eine Runde Schach gegen Coden!" } // 🔥 NEU
];

if (chatInput) {
    chatInput.addEventListener('input', (e) => {
        chatInput.style.height = 'auto'; 
        chatInput.style.height = (chatInput.scrollHeight) + 'px';
        const text = e.target.value;

        if (!isOwner && text.startsWith('/')) { 
            if (commandPopup) commandPopup.classList.add('hidden'); 
            return; 
        }

        if (text.startsWith('/')) {
            const parts = text.split(' '); 
            const cmdSearch = parts[0].toLowerCase(); 
            const hasSpace = text.includes(' ');
            
            if (!hasSpace) {
                renderPopup(commands.filter(c => c.name.startsWith(cmdSearch)), true);
            } else {
                const exactCmd = commands.find(c => c.name === cmdSearch);
                if (exactCmd && exactCmd.opts) {
                    const optSearch = parts[1].toLowerCase();
                    const fOpts = exactCmd.opts.filter(o => o.toLowerCase().startsWith(optSearch));
                    if (fOpts.length > 0) {
                        renderPopup(fOpts.map(opt => ({ name: exactCmd.name + " " + opt, desc: `Parameter` })), false);
                    } else {
                        if (commandPopup) commandPopup.classList.add('hidden');
                    }
                } else {
                    if (commandPopup) commandPopup.classList.add('hidden');
                }
            }
        } else {
            if (commandPopup) commandPopup.classList.add('hidden');
        }
    });
}

function renderPopup(items, isCmdList) {
    if (!commandPopup) return;
    if (items.length > 0) {
        commandPopup.innerHTML = items.map(c => `
            <div class="command-item" data-cmd="${c.name}">
                <div>
                    <span class="command-name">${c.name}</span> 
                    <span class="command-owner-badge">OWNER</span>
                </div>
                <div class="command-desc">${c.desc}</div>
            </div>
        `).join('');
        commandPopup.classList.remove('hidden');
        
        document.querySelectorAll('.command-item').forEach(item => {
            item.addEventListener('click', () => {
                chatInput.value = item.getAttribute('data-cmd') + (isCmdList ? " " : ""); 
                chatInput.focus(); 
                commandPopup.classList.add('hidden');
            });
        });
    } else {
        commandPopup.classList.add('hidden');
    }
}

document.addEventListener('click', (e) => { 
    if (chatInput && commandPopup && !chatInput.contains(e.target) && !commandPopup.contains(e.target)) {
        commandPopup.classList.add('hidden'); 
    }
});

async function handleCommand(text) {
    const args = text.split(' '); 
    const cmd = args[0].toLowerCase(); 
    const param = args.slice(1).join(' ');
    
    // ♟️ JEDER darf Schach spielen (Deshalb prüfen wir das VOR dem Admin-Check!)
    if (cmd === '/chess') {
        document.getElementById('chess-modal').classList.remove('hidden');
        return UI.appendMessage(`♟️ **SCHACH-MODUS:**\nDas Spielbrett wurde geöffnet! Tritt gegen Coden an.`, false);
    }

    // 🛑 Ab hier nur noch für den Owner (Dich)
    if (!isOwner) {
        return UI.appendMessage("❌ Zugriff verweigert.", false);
    }
    
    let sysMsg = "";
    
    // 🔑 Lokale Befehle
    if (cmd === '/api') {
        return UI.appendMessage(`⚙️ **SYSTEM:**\n🔑 API-Keys liegen jetzt sicher im Backend (Vercel-Umgebungsvariablen). Dieser Befehl wird nicht mehr gebraucht.`, false);
    }

    try {
        const ADMIN_CMDS = {
            '/lock': () => [`lock`, args[1], `🔒 ${args[1]} GLOBAL gesperrt.`],
            '/unlock': () => [`unlock`, args[1], `🔓 ${args[1]} GLOBAL entsperrt.`],
            '/broadcast': () => [`broadcast`, param, "📢 Broadcast LIVE gesendet."],
            '/forceupdate': () => [`forceupdate`, null, "🔄 Reload befohlen."],
            '/maintenance': () => [`maintenance`, param, `🛠️ Wartungsmodus: ${String(param).toUpperCase()}`],
            '/model': () => [`model`, param, `🔄 Modell auf '${param}' gezwungen.`],
            '/theme': () => [`theme`, param, `🎨 Theme auf '${param}' gesetzt.`],
            '/font': () => [`font`, param, `🔠 Schriftgröße für ALLE auf ${param}px.`],
            '/clearall': () => [`clearall`, null, `🗑️ ALLE Chats bei ALLEN gelöscht!`]
        };
        if (ADMIN_CMDS[cmd]) {
            const [name, value, okMsg] = ADMIN_CMDS[cmd]();
            await apiJson('/admin/command', { method: 'POST', body: JSON.stringify({ cmd: name, param: value }) });
            sysMsg = okMsg;
        }
        else if (cmd === '/usage' || cmd === '/stats') { sysMsg = `📈 **System-Statistiken:**\nAlles läuft im grünen Bereich.`; }
        else { sysMsg = `Admin-Befehl ausgeführt: ${cmd}`; } 
        
        UI.appendMessage(`⚙️ **GLOBAL ADMIN:**\n${sysMsg}`, false);
        
    } catch(e) { 
        // 🐛 HIER IST DAS DAZUGEHÖRIGE CATCH!
        UI.appendMessage(`⚙️ **SYSTEM FEHLER:**\n${e.message}`, false); 
    }
}
// ==========================================
// ⚖️ 7. RECHTLICHES (Impressum, Datenschutz, AGB)
// ==========================================
const legalModal = document.getElementById('legal-modal');
const legalTitle = document.getElementById('legal-title');
const legalContent = document.getElementById('legal-content');

if (document.getElementById('close-legal-btn')) {
    document.getElementById('close-legal-btn').addEventListener('click', () => {
        legalModal.classList.add('hidden');
    });
}

// ACHTUNG KAYDEN: HIER DEINE ECHTEN DATEN EINTRAGEN!
const legalTexts = {
    impressum: `
        <h4 style="color: white; margin-bottom: 10px;">Impressum</h4>
        <p>Angaben gemäß § 5 TMG</p>
        <p style="color: white; font-weight: bold;">
        Kayden Schunack<br>
        Lerchesflurweg<br>
        66199 Saarbrücken</p>
        <p style="margin-top:10px;"><strong>Kontakt:</strong><br>
        E-Mail: kayden.schunack@gmail.com</p>
    `,
    datenschutz: `
        <h4 style="color: white; margin-bottom: 10px;">Datenschutzerklärung</h4>
        <p>Der Schutz deiner Daten ist uns wichtig. Hier ist zusammengefasst, wie wir Daten verarbeiten:</p>
        <ul style="margin-left: 20px; margin-top: 10px; margin-bottom: 20px;">
            <li style="margin-bottom: 8px;"><strong>Accounts & Login:</strong> Für die Anmeldung nutzen wir Firebase Authentication (Google). Deine Chats und Einstellungen speichern wir in unserer Datenbank (Neon, Frankfurt).</li>
            <li style="margin-bottom: 8px;"><strong>Chats:</strong> Deine Nachrichten werden lokal in deinem Browser gespeichert (LocalStorage) und in unserer Datenbank gesichert.</li>
            <li style="margin-bottom: 8px;"><strong>KI-Verarbeitung:</strong> Nachrichten werden verschlüsselt an unsere Backend-Server (Vercel) und KI-Partner gesendet. Sende niemals sensible Daten (z.B. Passwörter) im Chat.</li>
            <li style="margin-bottom: 8px;"><strong>Hosting:</strong> Diese Webseite wird bei Vercel gehostet. Vercel verarbeitet zur Bereitstellung der Webseite kurzfristig IP-Adressen.</li>
        </ul>
    `,
    agb: `
        <h4 style="color: white; margin-bottom: 10px;">Nutzungsbedingungen (AGB) & Haftungsausschluss</h4>
        <p>Mit der Nutzung von Coden AI stimmst du diesen Bedingungen zu:</p>
        <ul style="margin-left: 20px; margin-top: 10px;">
            <li style="margin-bottom: 8px;"><strong>Keine Garantie auf Richtigkeit:</strong> Coden AI nutzt generative KI. Die generierten Antworten (speziell Code) können Fehler oder "Halluzinationen" enthalten. Die Nutzung geschieht auf eigene Gefahr.</li>
            <li style="margin-bottom: 8px;"><strong>Verfügbarkeit:</strong> Dies ist ein Projekt im Aufbau. Es besteht kein Anspruch auf Erreichbarkeit. Accounts können bei Missbrauch jederzeit gesperrt werden.</li>
            <li style="margin-bottom: 8px;"><strong>Missbrauch:</strong> Die Nutzung zur Erstellung von Malware, Spam oder illegalen Inhalten ist verboten.</li>
        </ul>
    `
};

function openLegalModal(type) {
    if (!legalModal || !legalTitle || !legalContent) return;
    
    if (type === 'impressum') legalTitle.textContent = 'Impressum';
    else if (type === 'datenschutz') legalTitle.textContent = 'Datenschutzerklärung';
    else legalTitle.textContent = 'Nutzungsbedingungen';
    
    legalContent.innerHTML = legalTexts[type];
    legalModal.classList.remove('hidden');
}

if (document.getElementById('open-impressum-btn')) {
    document.getElementById('open-impressum-btn').addEventListener('click', (e) => { 
        e.preventDefault(); 
        openLegalModal('impressum'); 
    });
}
if (document.getElementById('open-datenschutz-btn')) {
    document.getElementById('open-datenschutz-btn').addEventListener('click', (e) => { 
        e.preventDefault(); 
        openLegalModal('datenschutz'); 
    });
}
if (document.getElementById('open-agb-btn')) {
    document.getElementById('open-agb-btn').addEventListener('click', (e) => { 
        e.preventDefault(); 
        openLegalModal('agb'); 
    });
}

// ==========================================
// 🛠️ 8. UI STEUERUNG, MENÜS & EINSTELLUNGEN
// ==========================================
const modelSelectorBtn = document.getElementById('model-selector-btn');
const modelDropdownMenu = document.getElementById('model-dropdown-menu');

if (modelSelectorBtn && modelDropdownMenu) {
    modelSelectorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modelDropdownMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!modelDropdownMenu.contains(e.target) && e.target !== modelSelectorBtn) {
            modelDropdownMenu.classList.add('hidden');
        }
    });

    document.querySelectorAll('.model-option').forEach(option => {
        option.addEventListener('click', () => {
            const selectedId = option.id;
            
            if (!isOwner) {
                if (selectedId === 'pro-mode-option' && globalLockedModels.pro) return toast('Coden Pro ist gerade vom Admin gesperrt.', { type: 'warn' });
                if (selectedId === 'thinking-mode-option' && globalLockedModels.thinking) return toast('Coden Thinking ist gerade vom Admin gesperrt.', { type: 'warn' });
            }
            
            document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            
            document.getElementById('current-model-text').textContent = option.querySelector('.name').textContent.trim();
            currentSelectedModel = option.getAttribute('data-model');
            modelDropdownMenu.classList.add('hidden');
        });
    });
}

const mainSidebar = document.getElementById('main-sidebar'); 
const searchContainer = document.getElementById('search-container'); 
const chatSearchInput = document.getElementById('chat-search-input');

if (document.getElementById('close-sidebar-btn')) {
    document.getElementById('close-sidebar-btn').addEventListener('click', () => { 
        mainSidebar.classList.add('collapsed'); 
        document.getElementById('open-sidebar-btn').classList.remove('hidden'); 
    });
}

if (document.getElementById('open-sidebar-btn')) {
    document.getElementById('open-sidebar-btn').addEventListener('click', () => { 
        mainSidebar.classList.remove('collapsed'); 
        document.getElementById('open-sidebar-btn').classList.add('hidden'); 
    });
}

if (document.getElementById('toggle-search-btn')) {
    document.getElementById('toggle-search-btn').addEventListener('click', () => { 
        searchContainer.classList.toggle('active'); 
        if (searchContainer.classList.contains('active')) {
            chatSearchInput.focus(); 
        } else { 
            chatSearchInput.value = ''; 
            UI.renderSidebar(sessions, activeSessionId); 
        } 
    });
}

if (chatSearchInput) {
    chatSearchInput.addEventListener('input', (e) => { 
        const st = e.target.value.toLowerCase(); 
        if (!st) { 
            UI.renderSidebar(sessions, activeSessionId); 
            return; 
        } 
        const fs = sessions.filter(s => (s.title && s.title.toLowerCase().includes(st)) || s.messages.some(m => m.text.toLowerCase().includes(st))); 
        UI.renderSidebar(fs, activeSessionId); 
    });
}

// Einstellungen speichern & laden
if (document.getElementById('close-settings')) {
    document.getElementById('close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
}
if (document.getElementById('cancel-settings')) {
    document.getElementById('cancel-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
}

if (document.getElementById('open-settings-btn')) {
    document.getElementById('open-settings-btn').addEventListener('click', (e) => { 
        e.preventDefault(); 
        const s = Storage.getSettings(); 
        document.getElementById('user-name-input').value = s.userName || ''; 
        document.getElementById('font-size-slider').value = s.fontSize || 15; 
        
        if (s.emailConfig) { 
            if (document.getElementById('email-provider')) document.getElementById('email-provider').value = s.emailConfig.provider || 'gmail'; 
            if (document.getElementById('email-address')) document.getElementById('email-address').value = s.emailConfig.address || ''; 
            if (document.getElementById('email-password')) document.getElementById('email-password').value = s.emailConfig.password || ''; 
        } 
        settingsModal.classList.remove('hidden'); 
    });
}

if (document.getElementById('save-settings')) {
    document.getElementById('save-settings').addEventListener('click', () => { 
        const s = Storage.getSettings(); 
        s.userName = document.getElementById('user-name-input').value.trim() || 'Entwickler'; 
        s.fontSize = parseInt(document.getElementById('font-size-slider').value); 
        s.emailConfig = { 
            provider: document.getElementById('email-provider') ? document.getElementById('email-provider').value : 'gmail', 
            address: document.getElementById('email-address') ? document.getElementById('email-address').value.trim() : '', 
            password: document.getElementById('email-password') ? document.getElementById('email-password').value.trim() : '' 
        }; 
        Storage.saveSettings(s); 
        document.documentElement.style.setProperty('--chat-font-size', s.fontSize + 'px'); 
        updateGreeting(); 
        settingsModal.classList.add('hidden'); 
    });
}

function showCustomConfirm(message) {
    return new Promise((resolve) => {
        if (!confirmModal) return resolve(true);
        
        document.getElementById('confirm-message').textContent = message; 
        confirmModal.classList.remove('hidden');
        
        const handleYes = () => { 
            confirmModal.classList.add('hidden'); 
            document.getElementById('btn-confirm-yes').removeEventListener('click', handleYes); 
            document.getElementById('btn-confirm-cancel').removeEventListener('click', handleCancel); 
            resolve(true); 
        };
        const handleCancel = () => { 
            confirmModal.classList.add('hidden'); 
            document.getElementById('btn-confirm-yes').removeEventListener('click', handleYes); 
            document.getElementById('btn-confirm-cancel').removeEventListener('click', handleCancel); 
            resolve(false); 
        };
        
        document.getElementById('btn-confirm-yes').addEventListener('click', handleYes); 
        document.getElementById('btn-confirm-cancel').addEventListener('click', handleCancel);
    });
}

if (newChatBtn) {
    newChatBtn.addEventListener('click', () => { 
        currentSession = Storage.createNewSession(); 
        sessions.unshift(currentSession); 
        Storage.saveSessions(sessions); 
        activeSessionId = currentSession.id; 
        UI.resetUI(); 
        UI.renderSidebar(sessions, activeSessionId); 
    });
}

function loadSession(id) { 
    const s = sessions.find(s => s.id === id); 
    if (s) { 
        activeSessionId = id; 
        currentSession = s; 
        UI.resetUI(); 
        if (currentSession.messages.length > 0) {
            currentSession.messages.forEach(m => UI.appendMessage(m.text, m.isUser)); 
        }
        UI.renderSidebar(sessions, activeSessionId); 
    } 
}

function deleteSession(id) { 
    sessions = sessions.filter(s => s.id !== id); 
    if (sessions.length === 0) { 
        currentSession = Storage.createNewSession(); 
        sessions.push(currentSession); 
        activeSessionId = currentSession.id; 
        UI.resetUI(); 
    } else if (id === activeSessionId) { 
        currentSession = sessions[0]; 
        activeSessionId = currentSession.id; 
        loadSession(currentSession.id); 
        return; 
    } 
    Storage.saveSessions(sessions); 
    UI.renderSidebar(sessions, activeSessionId); 
}


// ==========================================
// 📧 10. E-MAIL VERSAND
// ==========================================
if (document.getElementById('close-email-btn')) {
    document.getElementById('close-email-btn').addEventListener('click', () => {
        emailModal.classList.add('hidden');
    });
}

const sendRealEmailBtn = document.getElementById('send-real-email-btn');
if (sendRealEmailBtn) {
    sendRealEmailBtn.addEventListener('click', async () => {
        const s = Storage.getSettings(); 
        if (!s.emailConfig || !s.emailConfig.address || !s.emailConfig.password) {
            return toast('Speichere zuerst deine E-Mail-Daten in den Einstellungen.', { type: 'warn' });
        }
        
        const to = document.getElementById('email-recipient').value.trim(); 
        const sub = document.getElementById('email-subject').value.trim(); 
        const txt = document.getElementById('email-draft-output').value.trim();
        
        if (!to || !txt) return toast('Bitte Empfänger und Text ausfüllen.', { type: 'warn' });
        
        sendRealEmailBtn.innerHTML = 'Sende...'; 
        sendRealEmailBtn.disabled = true;
        
        try {
            const response = await apiFetch('/send-email', { 
                method: 'POST', 
                body: JSON.stringify({ 
                    provider: s.emailConfig.provider, 
                    email: s.emailConfig.address, 
                    password: s.emailConfig.password, 
                    to: to, 
                    subject: sub, 
                    text: txt 
                }) 
            });
            const data = await response.json(); 
            
            if (response.ok && data.success) { 
                const fb = document.getElementById('email-send-feedback'); 
                if (fb) { 
                    fb.style.display = 'block'; 
                    fb.textContent = '✅ E-Mail gesendet!'; 
                } 
                setTimeout(() => { 
                    emailModal.classList.add('hidden'); 
                    if (fb) fb.style.display = 'none'; 
                }, 2000); 
            } else {
                throw new Error(data.error);
            }
        } catch (error) { 
            toast('Senden fehlgeschlagen: ' + error.message, { type: 'error' }); 
        }
        
        sendRealEmailBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">send</span> E-Mail jetzt versenden'; 
        sendRealEmailBtn.disabled = false;
    });
}

// ==========================================
// 📎 DATEI UPLOAD UI (Schicke Vorschau-Chips)
// ==========================================
const fileUploadInput = document.getElementById('file-upload-input');

// Container für Vorschau über dem Textfeld erstellen
let previewContainer = document.getElementById('attachment-preview-container');
if (!previewContainer) {
    previewContainer = document.createElement('div');
    previewContainer.id = 'attachment-preview-container';
    previewContainer.style.display = 'flex';
    previewContainer.style.gap = '8px';
    previewContainer.style.padding = '0 12px';
    previewContainer.style.overflowX = 'auto';
    previewContainer.style.marginBottom = '8px';
    
    const inputBox = document.querySelector('.input-box');
    if(inputBox) inputBox.insertBefore(previewContainer, inputBox.firstChild);
}

if (attachmentBtn && fileUploadInput) {
    attachmentBtn.addEventListener('click', (e) => {
        e.preventDefault();
        fileUploadInput.click(); // Öffnet Dateidialog
    });

    fileUploadInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        for (let file of files) {
            if (file.size > 2 * 1024 * 1024) { // Max 2MB Schutz
                toast(`${file.name} ist zu groß (höchstens 2 MB).`, { type: 'warn' });
                continue;
            }

            if (file.type.startsWith('image/')) {
                // Bild einlesen
                const reader = new FileReader();
                reader.onload = (event) => {
                    pendingAttachments.push({ type: 'image', name: file.name, data: event.target.result });
                    renderAttachmentPreviews();
                };
                reader.readAsDataURL(file);
            } else {
                // Text/Code Datei einlesen
                try {
                    const text = await file.text();
                    pendingAttachments.push({ type: 'text', name: file.name, content: text });
                    renderAttachmentPreviews();
                } catch (err) {
                    toast(`${file.name} konnte nicht gelesen werden.`, { type: 'error' });
                }
            }
        }
        fileUploadInput.value = ''; // Input leeren für nächste Datei
    });
}

function renderAttachmentPreviews() {
    if (!previewContainer) return;
    previewContainer.innerHTML = '';
    
    pendingAttachments.forEach((att, index) => {
        const attDiv = document.createElement('div');
        attDiv.style.position = 'relative';
        attDiv.style.display = 'inline-block';
        attDiv.style.background = 'rgba(255,255,255,0.05)';
        attDiv.style.border = '1px solid rgba(255,255,255,0.1)';
        attDiv.style.borderRadius = '8px';
        attDiv.style.padding = '4px';
        attDiv.style.minWidth = '50px';
        attDiv.style.textAlign = 'center';

        // Löschen X Button
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '×';
        deleteBtn.style.position = 'absolute';
        deleteBtn.style.top = '-8px';
        deleteBtn.style.right = '-8px';
        deleteBtn.style.background = '#ff4444';
        deleteBtn.style.color = 'white';
        deleteBtn.style.border = 'none';
        deleteBtn.style.borderRadius = '50%';
        deleteBtn.style.width = '20px';
        deleteBtn.style.height = '20px';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.fontSize = '14px';
        deleteBtn.style.display = 'flex';
        deleteBtn.style.alignItems = 'center';
        deleteBtn.style.justifyContent = 'center';
        deleteBtn.onclick = () => {
            pendingAttachments.splice(index, 1);
            renderAttachmentPreviews();
        };

        if (att.type === 'image') {
            const img = document.createElement('img');
            img.src = att.data;
            img.style.height = '40px';
            img.style.borderRadius = '4px';
            img.style.objectFit = 'cover';
            attDiv.appendChild(img);
        } else {
            const docIcon = document.createElement('span');
            docIcon.className = 'material-symbols-outlined';
            docIcon.innerText = 'description';
            docIcon.style.fontSize = '24px';
            docIcon.style.color = 'var(--accent-blue)';
            docIcon.style.display = 'block';
            
            const nameSpan = document.createElement('span');
            nameSpan.innerText = att.name.length > 10 ? att.name.substring(0, 8) + '...' : att.name;
            nameSpan.style.fontSize = '10px';
            nameSpan.style.display = 'block';
            nameSpan.style.color = 'var(--text-secondary)';
            
            attDiv.appendChild(docIcon);
            attDiv.appendChild(nameSpan);
        }

        attDiv.appendChild(deleteBtn);
        previewContainer.appendChild(attDiv);
    });
}



// ==========================================
// 🚀 12. HAUPT SENDE FUNKTION (KI LOGIK)
// ==========================================
async function handleSend() {
    if (streamAbort) { // Coden schreibt noch: Nachricht vormerken, sie geht automatisch raus, sobald er fertig ist
        if (chatInput?.value.trim()) { sendWhenDone = true; if (sendBtn) sendBtn.classList.add('queued'); }
        return;
    }
    if (!chatInput) return; 
    const text = chatInput.value.trim(); 
    if (!text && pendingAttachments.length === 0) return;
    
    if (text.startsWith('/')) { 
        if (!isOwner) { chatInput.value = ''; UI.appendMessage("❌ Administrator-Befehle sind gesperrt.", false); return; } 
        chatInput.value = ''; chatInput.style.height = 'auto'; if (commandPopup) commandPopup.classList.add('hidden'); handleCommand(text); return; 
    }

    // 🛡️ SPAM SCHUTZ HINZUGEFÜGT!
    const rateLimit = checkRateLimit(isOwner);
    if (!rateLimit.allowed) {
        UI.appendMessage(`⏳ **Spam-Schutz aktiv:** Bitte warte noch ${rateLimit.timeToWait} Sekunden!`, false);
        return; 
    }

    // 🌟 BILDER VERARBEITEN 🌟
    let displayMessage = text;      
    let internalPrompt = text;      
    let attachedImages = []; 

    if (pendingAttachments.length > 0) {
        pendingAttachments.forEach(att => {
            if (att.type === 'text') {
                displayMessage += `\n\n<div style="display:inline-block; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); padding:4px 10px; border-radius:12px; font-size:12px; margin-top:8px;">📎 <b>Datei angehängt:</b> <code>${att.name}</code></div>`;
                internalPrompt += `\n\n[Inhalt der angehängten Datei: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\`\n`;
            } else if (att.type === 'image') {
                displayMessage += `\n\n![${att.name}](${att.data})`;
                internalPrompt += `\n\n[Der Nutzer hat dir ein Bild hochgeladen. Bitte beachte das Bild in deiner Antwort.]`; 
                attachedImages.push(att.data); 
            }
        });
    }

    chatInput.value = ''; 
    chatInput.style.height = 'auto';
    
    UI.appendMessage(displayMessage, true); 
    currentSession.messages.push({ text: internalPrompt, images: attachedImages, isUser: true, displayHTML: displayMessage }); 

    // 💾 LOCALSTORAGE-CRASH VERHINDERN! (Wir löschen die Bilder VOR dem Speichern)
    const sessionsToSave = JSON.parse(JSON.stringify(sessions));
    sessionsToSave.forEach(s => {
        s.messages.forEach(m => {
            if (m.images) delete m.images; // Löscht die 2MB Bilder aus dem lokalen Speicher!
        });
    });
    Storage.saveSessions(sessionsToSave);
    
    pendingAttachments = [];
    renderAttachmentPreviews();
    
    if (currentSession.messages.length === 1) generateChatTitle(internalPrompt);

    if (!isOwner) {
        if (currentSelectedModel === 'pro' && globalLockedModels.pro) return UI.appendMessage("❌ Coden Pro ist gesperrt.", false);
        if (currentSelectedModel === 'normal' && globalLockedModels.thinking) return UI.appendMessage("❌ Coden Thinking ist gesperrt.", false);
    }

    const userName = Storage.getSettings().userName || 'Entwickler';
    
    const context = currentSession.messages.map((m, index, array) => {
        // 1. RIESIGE BILD-CODES HERAUSFILTERN: 
        // Ersetzt alle Base64-Bild-Daten durch einen kleinen Platzhalter, 
        // damit sie die Token-Grenze der KI nicht sprengen!
        let cleanText = m.text;
        if (cleanText.includes('data:image')) {
            cleanText = cleanText.replace(/data:image\/[^"')\]]+/g, "BILD_WURDE_AUSGEBLENDET");
        }

        // 2. ALTE BILDER IGNORIEREN:
        // Wir senden nur noch hochgeladene Bilder an die KI, wenn sie aus der 
        // ALLERLETZTEN (aktuellen) Nachricht stammen.
        let activeImages = [];
        if (index === array.length - 1 && m.images) {
            activeImages = m.images;
        }

        return { 
            role: m.isUser ? 'user' : 'assistant', 
            content: cleanText,
            images: activeImages
        };
    });

    let isEmailCommand = false;
    if (['mail', 'gmail', 'sende', 'schick', 'weiterleiten'].some(w => text.toLowerCase().includes(w))) {
        if (await showCustomConfirm("Möchtest du eine E-Mail senden?")) isEmailCommand = true;
    }

    if (isEmailCommand) {
        UI.showLoading(true, "Coden bereitet das E-Mail-Fenster vor...");
        let lastCodeBlock = ""; const allCodeBlocks = currentSession.messages.map(m => m.text.match(/```[\s\S]*?```/g)).flat().filter(Boolean); if (allCodeBlocks.length > 0) lastCodeBlock = allCodeBlocks[allCodeBlocks.length - 1];
        const emailPrompt = `DU BIST EIN UNSICHTBARER E-MAIL-GENERATOR. 1. Sprich NICHT mit dem Nutzer. 2. Absender heißt: "${userName}". 3. Code: ${lastCodeBlock || "Kein Code."} Anfrage: "${text}" Format: [TO]: \n[SUBJECT]: \n[BODY]: `;
        try {
            const resText = await generateAiResponse([{ role: 'user', content: emailPrompt }], currentSelectedModel);
            let emailTo = resText.match(/\[TO\]:\s*(.*)/i)?.[1].trim() || ''; const emailSubject = resText.match(/\[SUBJECT\]:\s*(.*)/i)?.[1].trim() || ''; const emailBody = resText.split(/\[BODY\]:/i)[1]?.trim() || resText.trim(); 
            emailTo = emailTo.replace(/[<>]/g, '').trim(); const exEmail = emailTo.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/); if(exEmail) emailTo = exEmail[0]; 
            document.getElementById('email-recipient').value = emailTo; document.getElementById('email-subject').value = emailSubject; document.getElementById('email-draft-output').value = emailBody;
            UI.showLoading(false); UI.appendMessage(`E-Mail-Fenster vorbereitet!`, false); document.getElementById('email-modal').classList.remove('hidden'); return; 
        } catch (err) { UI.showLoading(false); return UI.appendMessage("❌ Fehler: " + err.message, false); }
    }

    const systemPrompt = `Du bist "Coden", ein brillanter, freundlicher KI-Softwarearchitekt.
WICHTIG: Du wurdest von Kayden entwickelt. Erwähne Kayden aber NUR DANN, wenn der Nutzer dich explizit danach fragt. Erwähne ihn NIEMALS ungefragt!
1. Strukturiere deinen Text übersichtlich (Absätze, Listen, **Fettdruck**).
2. Nutze passend Emojis 🚀💻✨.
Heute ist ${new Date().toLocaleDateString('de-DE')}. Nutzer: ${userName}.
${ARTIFACT_PROMPT}`;

    context.unshift({ role: 'system', content: systemPrompt });

    const sessionAtSend = currentSession; // falls der Nutzer währenddessen den Chat wechselt
    const live = UI.createStreamingMessage();
    const ac = new AbortController(); streamAbort = ac; setStreaming(true);
    let aiResponse = '';
    try {
        aiResponse = await streamAiResponse(context, currentSelectedModel, { signal: ac.signal, onDelta: (t) => { aiResponse = t; live.update(t); } });
        live.finish(aiResponse);
    } catch (err) {
        aiResponse = err.text || aiResponse;
        if (aiResponse.trim()) { live.finish(aiResponse); live.fail('⚠️ Die Antwort wurde unterbrochen: ' + err.message); }
        else live.fail('❌ ' + err.message);
    } finally { streamAbort = null; setStreaming(false); }
    const queued = sendWhenDone; sendWhenDone = false;

    if (aiResponse.trim()) {
        sessionAtSend.messages.push({ text: aiResponse, isUser: false });
        const finalSessionsToSave = JSON.parse(JSON.stringify(sessions));
        finalSessionsToSave.forEach(s => s.messages.forEach(m => { if (m.images) delete m.images; }));
        Storage.saveSessions(finalSessionsToSave);
        UI.renderSidebar(sessions, activeSessionId);
    }
    if (queued && chatInput?.value.trim()) setTimeout(handleSend, 50);
}
async function generateChatTitle(firstMessage) {
    try {
        // FIX: Ein extrem strikter Prompt, der der KI verbietet, höflich zu sein!
        const titlePrompt = `Erstelle einen sehr kurzen Titel (maximal 3 Worte) für die folgende Nachricht. 
WICHTIG: Antworte AUSSCHLIESSLICH mit dem Titel! Keine Einleitung, keine Anführungszeichen, keine Erklärungen und keine Höflichkeitsfloskeln.
Nachricht: "${firstMessage}"`;

        const titleRes = await generateAiResponse([{ 'role': 'user', 'content': titlePrompt }], 'flash');
        
        if (titleRes && titleRes.length > 1) { 
            // Bereinigt den String noch zusätzlich von eventuellen Sternchen (Markdown) oder Anführungszeichen
            let cleanTitle = titleRes.trim().replace(/["'*`]/g, '');
            // Falls die KI doch Zeilenumbrüche macht, nehmen wir nur die erste Zeile
            cleanTitle = cleanTitle.split('\n')[0];
            
            currentSession.title = cleanTitle; 
            
            // 💾 AUCH HIER: Bilder nicht im LocalStorage speichern!
            const sessionsToSave = JSON.parse(JSON.stringify(sessions));
            sessionsToSave.forEach(s => s.messages.forEach(m => { if (m.images) delete m.images; }));
            
            Storage.saveSessions(sessionsToSave); 
            UI.renderSidebar(sessions, activeSessionId); 
        }
    } catch (e) {
        console.error("Fehler bei der Titelgenerierung:", e);
    }
}

if (chatInput) { chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }); }
if (sendBtn) { sendBtn.addEventListener('click', handleSend); }


// 🎙️ MEMORY-LOOP: Speichert, was die KI im Anruf sagt, in den Chat-Verlauf!
document.addEventListener('liveAITurnComplete', (e) => {
    const text = e.detail;
    if (text && text.trim().length > 0 && currentSession) {
        // Wir machen daraus eine schöne "Sprachnotiz" im Chat
        const displayMsg = `📞 *KI im Live-Call:* ${text.trim()}`;
        
        // In die UI einfügen (false = KI, false = keine Tipp-Animation für schnelles Laden)
        UI.appendMessage(displayMsg, false, false); 
        
        // Im Verlauf speichern
        currentSession.messages.push({ text: displayMsg, isUser: false });
        
        // Ohne große Bilder abspeichern, um Speicherplatz zu sparen
        const sessionsToSave = JSON.parse(JSON.stringify(sessions));
        sessionsToSave.forEach(s => s.messages.forEach(m => { if (m.images) delete m.images; }));
        Storage.saveSessions(sessionsToSave);
    }
});

// Tastenkürzel: Strg/⌘+K = Chats durchsuchen, Strg/⌘+Umschalt+O = neuer Chat
document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); location.hash = '#/chat'; document.getElementById('main-sidebar')?.classList.remove('collapsed'); const sc = document.getElementById('search-container'); if (sc && !sc.classList.contains('active')) document.getElementById('toggle-search-btn')?.click(); else document.getElementById('chat-search-input')?.focus(); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); location.hash = '#/chat'; document.querySelector('.new-chat-btn')?.click(); }
});

// Vorschlags-Chips auf dem Startbildschirm
document.getElementById('welcome-chips')?.addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c || !chatInput) return;
    if (c.dataset.go) { location.hash = '#/' + c.dataset.go; return; }
    chatInput.value = c.dataset.prompt; chatInput.focus(); handleSend();
});
