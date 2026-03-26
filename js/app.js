// js/app.js
import { CONFIG } from './config.js';
import { generateAiResponse } from './api.js';
import { UI } from './ui.js';
import { Storage } from './storage.js';
import { loginWithGoogle, loginWithEmail, registerWithEmail, logoutUser, onAuthStateChanged, auth, db } from './firebase-init.js';
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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
let lastUpdateTime = 0;
let lastGlobalClearTime = 0;

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
// 🛡️ 4. AUTHENTIFIZIERUNG & FIREBASE
// ==========================================
if (document.getElementById('btn-google-login')) {
    document.getElementById('btn-google-login').addEventListener('click', async () => { 
        try { 
            await loginWithGoogle(); 
        } catch(e) { 
            showError(e.message); 
        } 
    });
}

if (document.getElementById('btn-email-login')) {
    document.getElementById('btn-email-login').addEventListener('click', async () => { 
        const e = document.getElementById('auth-email').value.trim(); 
        const p = document.getElementById('auth-password').value.trim(); 
        
        if (e && p) {
            try { 
                await loginWithEmail(e, p); 
            } catch(err) { 
                if (err.code === 'auth/invalid-credential') {
                    showError("❌ Falsches Passwort oder E-Mail existiert nicht.");
                } else if (err.code === 'auth/user-not-found') {
                    showError("❌ Kein Account mit dieser E-Mail gefunden.");
                } else if (err.code === 'auth/too-many-requests') {
                    showError("❌ Zu viele Versuche. Bitte kurz warten.");
                } else {
                    showError("❌ Login fehlgeschlagen: " + err.message);
                }
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
                if (err.code === 'auth/email-already-in-use') {
                    showError("❌ Diese E-Mail ist bereits registriert!");
                } else if (err.code === 'auth/weak-password') {
                    showError("❌ Das Passwort muss mind. 6 Zeichen lang sein!");
                } else {
                    showError("❌ Registrierung fehlgeschlagen: " + err.message);
                }
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
            greetingEl.textContent = `Hallo ${settings.userName || 'Entwickler'}.`;
        }
    } catch(e) {}
}

if (auth) {
    onAuthStateChanged(auth, async (user) => {
        try {
            if (user) {
                isOwner = (user.email === 'kayden.schunack@gmail.com');
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
function initGlobalSync() {
    try {
        if (!db) return;
        
        onSnapshot(doc(db, "system", "state"), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                
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
                    lastUpdateTime = data.forceUpdate; 
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
                    lastGlobalClearTime = data.globalClear;
                    sessions = [Storage.createNewSession()]; 
                    currentSession = sessions[0]; 
                    activeSessionId = currentSession.id;
                    Storage.saveSessions(sessions); 
                    UI.resetUI(); 
                    UI.renderSidebar(sessions, activeSessionId);
                    if (!isOwner) UI.appendMessage("⚠️ Der Administrator hat alle Chats global geleert.", false);
                }
            }
        });
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
                        alert("❌ Nativer Sprachmodus benötigt Coden Flash!");
                        return;
                    }
                    // 🔥 NEU: Wir übergeben das Gedächtnis an den Anruf!
                    multimodalLive.initSession(liveCallBtn, liveStatusIndicator, currentSession.messages);
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
    
    if (!isOwner) {
        return UI.appendMessage("❌ Zugriff verweigert.", false);
    }
    
    let sysMsg = "";
    
    // Lokale Befehle (Brauchen keine Datenbank)



    
    if (cmd === '/api') {
        const s = Storage.getSettings(); 
        s.apiKey = param; 
        Storage.saveSettings(s);
        return UI.appendMessage(`⚙️ **SYSTEM:**\n🔑 API Key im Browser gespeichert!`, false);
    }

    if (!db) return UI.appendMessage("❌ Datenbank-Fehler.", false);
    
    try {
        if (cmd === '/lock') { 
            await setDoc(doc(db, "system", "state"), { locks: { [args[1]]: true } }, { merge: true }); 
            sysMsg = `🔒 ${args[1]} GLOBAL gesperrt.`; 
        }
        else if (cmd === '/unlock') { 
            await setDoc(doc(db, "system", "state"), { locks: { [args[1]]: false } }, { merge: true }); 
            sysMsg = `🔓 ${args[1]} GLOBAL entsperrt.`; 
        }
        else if (cmd === '/broadcast') { 
            await setDoc(doc(db, "system", "state"), { broadcast: { message: param, time: Date.now() } }, { merge: true }); 
            sysMsg = "📢 Broadcast LIVE gesendet."; 
        }

        
        else if (cmd === '/forceupdate') { 
            await setDoc(doc(db, "system", "state"), { forceUpdate: Date.now() }, { merge: true }); 
            sysMsg = "🔄 Reload befohlen."; 
        }
        else if (cmd === '/maintenance') { 
            await setDoc(doc(db, "system", "state"), { maintenance: param === 'on' }, { merge: true }); 
            sysMsg = `🛠️ Wartungsmodus: ${param.toUpperCase()}`; 
        }
        else if (cmd === '/model') { 
            await setDoc(doc(db, "system", "state"), { globalModel: param }, { merge: true }); 
            sysMsg = `🔄 Modell auf '${param}' gezwungen.`; 
        }
        else if (cmd === '/theme') { 
            await setDoc(doc(db, "system", "state"), { theme: param }, { merge: true }); 
            sysMsg = `🎨 Theme auf '${param}' gesetzt.`; 
        }
        else if (cmd === '/font') { 
            await setDoc(doc(db, "system", "state"), { fontSize: parseInt(param) }, { merge: true }); 
            sysMsg = `🔠 Schriftgröße für ALLE auf ${param}px.`; 
        }
        else if (cmd === '/clearall') { 
            await setDoc(doc(db, "system", "state"), { globalClear: Date.now() }, { merge: true }); 
            sysMsg = `🗑️ ALLE Chats bei ALLEN gelöscht!`; 
        }
        else if (cmd === '/usage' || cmd === '/stats') {
            sysMsg = `📈 **System-Statistiken:**\nAlles läuft im grünen Bereich.`;
        }
        else { 
            sysMsg = `Admin-Befehl ausgeführt: ${cmd}`; 
        } 
        // Lokale Befehle (Brauchen keine Datenbank)
    if (cmd === '/chess') {
        document.getElementById('chess-modal').classList.remove('hidden');
        return UI.appendMessage(`♟️ **SCHACH-MODUS:**\nDas Spielbrett wurde geöffnet! Tritt gegen Coden an.`, false);
    }

    if (cmd === '/api') {
        
        UI.appendMessage(`⚙️ **GLOBAL ADMIN:**\n${sysMsg}`, false);
    } catch(e) { 
        UI.appendMessage(`⚙️ **SYSTEM FEHLER:**\n${e.message}`, false); 
    });
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
            <li style="margin-bottom: 8px;"><strong>Accounts & Login:</strong> Wir nutzen Firebase (Google) zur Authentifizierung. Deine E-Mail wird sicher verschlüsselt gespeichert.</li>
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
                if (selectedId === 'pro-mode-option' && globalLockedModels.pro) return alert("❌ Vom Admin gesperrt.");
                if (selectedId === 'thinking-mode-option' && globalLockedModels.thinking) return alert("❌ Vom Admin gesperrt.");
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
            return alert("Bitte speichere zuerst deine E-Mail-Daten in den Einstellungen!");
        }
        
        const to = document.getElementById('email-recipient').value.trim(); 
        const sub = document.getElementById('email-subject').value.trim(); 
        const txt = document.getElementById('email-draft-output').value.trim();
        
        if (!to || !txt) return alert("Empfänger und Text ausfüllen!");
        
        sendRealEmailBtn.innerHTML = 'Sende...'; 
        sendRealEmailBtn.disabled = true;
        
        try {
            const response = await fetch('/api/send-email', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
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
            alert("Fehler beim Senden: " + error.message); 
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
                alert(`Die Datei ${file.name} ist zu groß! (Maximal 2MB)`);
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
                    alert(`Konnte ${file.name} nicht lesen.`);
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
    
    const context = currentSession.messages.map(m => ({ 
        role: m.isUser ? 'user' : 'assistant', 
        content: m.text,
        images: m.images || [] 
    }));
    
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
Heute ist ${new Date().toLocaleDateString('de-DE')}. Nutzer: ${userName}.`;

    context.unshift({ role: 'system', content: systemPrompt });

   try {
        UI.showLoading(true, `Coden generiert...`);
        const aiResponse = await generateAiResponse(context, currentSelectedModel);
        
        UI.showLoading(false); 
        // WICHTIG: Das 'true' am Ende schaltet die neue Tipp-Animation ein!
        UI.appendMessage(aiResponse, false, true); 
        
        // Nachricht in den Verlauf pushen
        currentSession.messages.push({ text: aiResponse, isUser: false }); 
        
        // 💾 FEHLER BEHOBEN: Wir speichern ERST, wenn die KI fertig geantwortet hat!
        const finalSessionsToSave = JSON.parse(JSON.stringify(sessions));
        finalSessionsToSave.forEach(s => s.messages.forEach(m => { if (m.images) delete m.images; }));
        Storage.saveSessions(finalSessionsToSave); 
        
        UI.renderSidebar(sessions, activeSessionId);
    } catch (err) { 
        UI.showLoading(false); 
        UI.appendMessage("❌ System Fehler: " + err.message, false); 
    }    
}
async function generateChatTitle(firstMessage) {
    try {
        const titleRes = await generateAiResponse([{ 'role': 'user', 'content': 'Titel (max 3 Worte) für: ' + firstMessage }], 'flash');
        if (titleRes && titleRes.length > 1) { 
            currentSession.title = titleRes.trim().replaceAll('"', ''); 
            
            // 💾 AUCH HIER: Bilder nicht im LocalStorage speichern!
            const sessionsToSave = JSON.parse(JSON.stringify(sessions));
            sessionsToSave.forEach(s => s.messages.forEach(m => { if (m.images) delete m.images; }));
            
            Storage.saveSessions(sessionsToSave); 
            UI.renderSidebar(sessions, activeSessionId); 
        }
    } catch (e) {}
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
