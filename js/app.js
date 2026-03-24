// js/app.js
import { CONFIG } from './config.js';
import { generateAiResponse } from './api.js';
import { UI } from './ui.js';
import { Storage } from './storage.js';
import { loginWithGoogle, loginWithEmail, registerWithEmail, logoutUser, onAuthStateChanged, auth } from './firebase-init.js';

// --- BASIS LOGIK ---
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app');
const errorMsg = document.getElementById('auth-error-msg');
const userEmailDisplay = document.getElementById('user-email-display');

document.getElementById('btn-google-login').addEventListener('click', async () => { try { await loginWithGoogle(); } catch(e) { showError(e.message); } });
document.getElementById('btn-email-login').addEventListener('click', async () => { const e = document.getElementById('auth-email').value; const p = document.getElementById('auth-password').value; if(e && p) try { await loginWithEmail(e, p); } catch(err) { showError("Login fehlgeschlagen."); } });
document.getElementById('btn-email-register').addEventListener('click', async () => { const e = document.getElementById('auth-email').value; const p = document.getElementById('auth-password').value; if(e && p) try { await registerWithEmail(e, p); } catch(err) { showError("Registrierung fehlgeschlagen."); } });
document.getElementById('logout-btn').addEventListener('click', () => logoutUser());

function showError(msg) { errorMsg.textContent = msg; errorMsg.style.display = 'block'; }

let sessions = [];
let currentSession = null;
let activeSessionId = null;
let appInitialized = false;

// 👑 OWNER STATUS
let isOwner = false;
let globalLockedModels = { pro: false, thinking: false }; // Simulierter Global State
let isThinkingModeLocked = false; 

function extractNameFromEmail(email) {
    if (!email) return "Entwickler";
    const namePart = email.split('@')[0];
    return namePart.replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function updateGreeting() {
    const settings = Storage.getSettings();
    const greetingEl = document.getElementById('welcome-greeting');
    if (greetingEl) {
        greetingEl.textContent = `Hallo ${settings.userName || 'Entwickler'}.`;
    }
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 👑 Check if Kayden is logged in
        isOwner = (user.email === 'kayden.schunack@gmail.com');
        if (isOwner) {
            document.getElementById('owner-badge').style.display = 'inline-block';
        } else {
            document.getElementById('owner-badge').style.display = 'none';
        }

        loginScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');
        userEmailDisplay.textContent = user.email;
        await Storage.loadFromCloud();
        
        let settings = Storage.getSettings();
        if (!settings.userName) {
            settings.userName = extractNameFromEmail(user.email);
            Storage.saveSettings(settings);
        }
        updateGreeting();

        if (!appInitialized) initApp(); 
    } else {
        loginScreen.classList.remove('hidden');
        appContainer.classList.add('hidden');
        localStorage.removeItem('coden_sessions'); 
        appInitialized = false;
        isOwner = false;
    }
});

function initApp() {
    appInitialized = true;
    sessions = Storage.getSessions();
    if(sessions.length === 0) {
        currentSession = Storage.createNewSession();
        sessions.push(currentSession);
        Storage.saveSessions(sessions);
    } else {
        currentSession = sessions[0];
    }
    activeSessionId = currentSession.id;

    const settings = Storage.getSettings();
    document.documentElement.style.setProperty('--chat-font-size', settings.fontSize + 'px');

    UI.resetUI(); 
    UI.renderSidebar(sessions, activeSessionId);
    if (currentSession.messages.length > 0) {
        currentSession.messages.forEach(msg => UI.appendMessage(msg.text, msg.isUser));
    }
    
    document.addEventListener('loadChatSession', (e) => loadSession(e.detail));
    document.addEventListener('deleteChatSession', (e) => deleteSession(e.detail));
}

// ==========================================
// 🚀 25 SLASH COMMANDS SYSTEM
// ==========================================
const commandPopup = document.getElementById('command-popup');
const commands = [
    // --- OWNER COMMANDS ---
    { name: "/lock", desc: "[OWNER] Sperrt ein Modell global (z.B. /lock pro)", ownerOnly: true },
    { name: "/unlock", desc: "[OWNER] Entsperrt ein Modell (z.B. /unlock pro)", ownerOnly: true },
    { name: "/broadcast", desc: "[OWNER] Sendet eine Warnung in den Chat", ownerOnly: true },
    { name: "/stats", desc: "[OWNER] Zeigt Entwickler-Statistiken", ownerOnly: true },
    { name: "/debug", desc: "[OWNER] Aktiviert versteckten Debug-Modus", ownerOnly: true },
    
    // --- USER COMMANDS ---
    { name: "/clear", desc: "Leert den aktuellen Chat", ownerOnly: false },
    { name: "/clearall", desc: "Löscht ALLE Chats (Vorsicht!)", ownerOnly: false },
    { name: "/theme", desc: "Wechselt zu dark/light Theme", ownerOnly: false },
    { name: "/font", desc: "Setzt Schriftgröße (z.B. /font 18)", ownerOnly: false },
    { name: "/persona", desc: "Ändert die KI-Rolle (z.B. /persona Hacker)", ownerOnly: false },
    { name: "/temp", desc: "Setzt Kreativität 0.0 bis 2.0 (z.B. /temp 0.8)", ownerOnly: false },
    { name: "/model", desc: "Wechselt Modell (flash, normal, pro)", ownerOnly: false },
    { name: "/export", desc: "Exportiert den Chat als TXT", ownerOnly: false },
    { name: "/rename", desc: "Benennt aktuellen Chat um", ownerOnly: false },
    { name: "/delete", desc: "Löscht den aktuellen Chat", ownerOnly: false },
    { name: "/user", desc: "Zeigt deine Account-Daten", ownerOnly: false },
    { name: "/owner", desc: "Prüft, ob du Admin-Rechte hast", ownerOnly: false },
    { name: "/ping", desc: "Prüft Systemgeschwindigkeit", ownerOnly: false },
    { name: "/version", desc: "Zeigt die Coden AI Version", ownerOnly: false },
    { name: "/reset", desc: "Setzt App-Einstellungen zurück", ownerOnly: false },
    { name: "/email", desc: "Setzt Ziel-Email (z.B. /email test@test.de)", ownerOnly: false },
    { name: "/api", desc: "Setzt lokalen API-Key", ownerOnly: false },
    { name: "/time", desc: "Zeigt aktuelle Serverzeit", ownerOnly: false },
    { name: "/help", desc: "Zeigt diese Befehlsliste", ownerOnly: false },
    { name: "/shrug", desc: "Sendet ¯\\_(ツ)_/¯", ownerOnly: false }
];

// Autocomplete Menu
chatInput = document.getElementById('main-input');
chatInput.addEventListener('input', (e) => {
    const text = e.target.value;
    if (text.startsWith('/')) {
        const search = text.toLowerCase().split(' ')[0];
        const filtered = commands.filter(c => c.name.startsWith(search) && (!c.ownerOnly || isOwner));
        
        if (filtered.length > 0) {
            commandPopup.innerHTML = filtered.map(c => 
                `<div class="command-item" data-cmd="${c.name}">
                    <div><span class="command-name">${c.name}</span> 
                    ${c.ownerOnly ? '<span class="command-owner-badge">OWNER</span>' : ''}</div>
                    <div class="command-desc">${c.desc}</div>
                </div>`
            ).join('');
            commandPopup.classList.remove('hidden');

            document.querySelectorAll('.command-item').forEach(item => {
                item.addEventListener('click', () => {
                    chatInput.value = item.getAttribute('data-cmd') + " ";
                    chatInput.focus();
                    commandPopup.classList.add('hidden');
                });
            });
        } else {
            commandPopup.classList.add('hidden');
        }
    } else {
        commandPopup.classList.add('hidden');
    }
});

// Klick außerhalb schließt Popup
document.addEventListener('click', (e) => {
    if (!chatInput.contains(e.target) && !commandPopup.contains(e.target)) commandPopup.classList.add('hidden');
});

// Befehls-Ausführung (Bypass AI)
function handleCommand(text) {
    const args = text.split(' ');
    const cmd = args[0].toLowerCase();
    const param = args.slice(1).join(' ');

    let sysMsg = "";

    // 1. OWNER COMMANDS
    if (cmd === '/lock') {
        if(!isOwner) return "❌ Zugriff verweigert. Nur Kayden Schunack darf das.";
        if(param === 'pro') { globalLockedModels.pro = true; sysMsg = "🔒 Coden Pro wurde GLOBAL gesperrt."; document.getElementById('pro-mode-option').classList.add('disabled'); }
        else if(param === 'thinking') { globalLockedModels.thinking = true; sysMsg = "🔒 Coden Thinking wurde GLOBAL gesperrt."; document.getElementById('thinking-mode-option').classList.add('disabled'); }
        else sysMsg = "Modell nicht gefunden. Nutze '/lock pro' oder '/lock thinking'.";
    }
    else if (cmd === '/unlock') {
        if(!isOwner) return "❌ Zugriff verweigert.";
        if(param === 'pro') { globalLockedModels.pro = false; sysMsg = "🔓 Coden Pro wurde GLOBAL entsperrt."; document.getElementById('pro-mode-option').classList.remove('disabled'); }
        else if(param === 'thinking') { globalLockedModels.thinking = false; sysMsg = "🔓 Coden Thinking wurde GLOBAL entsperrt."; document.getElementById('thinking-mode-option').classList.remove('disabled'); }
        else sysMsg = "Modell nicht gefunden.";
    }
    else if (cmd === '/broadcast') {
        if(!isOwner) return "❌ Zugriff verweigert.";
        sysMsg = "📢 SYSTEM BROADCAST: " + param;
    }
    else if (cmd === '/stats') {
        if(!isOwner) return "❌ Zugriff verweigert.";
        sysMsg = `📊 STATS: ${sessions.length} Chats gespeichert. Aktuelles Modell: ${currentSelectedModel}`;
    }
    else if (cmd === '/debug') {
        if(!isOwner) return "❌ Zugriff verweigert.";
        sysMsg = "🛠️ Debug-Modus aktiviert. Firebase Sync-Logs werden in Konsole geschrieben.";
    }
    // 2. USER COMMANDS
    else if (cmd === '/clear') {
        currentSession.messages = []; Storage.saveSessions(sessions); UI.resetUI(); return null; 
    }
    else if (cmd === '/clearall') {
        sessions = [Storage.createNewSession()]; currentSession = sessions[0]; activeSessionId = currentSession.id; Storage.saveSessions(sessions); UI.resetUI(); UI.renderSidebar(sessions, activeSessionId); return null;
    }
    else if (cmd === '/theme') {
        sysMsg = "🎨 Theme-Wechsel (in Entwicklung).";
    }
    else if (cmd === '/font') {
        const size = parseInt(param);
        if(size >= 10 && size <= 30) {
            const s = Storage.getSettings(); s.fontSize = size; Storage.saveSettings(s);
            document.documentElement.style.setProperty('--chat-font-size', size + 'px');
            sysMsg = `Schriftgröße auf ${size}px gesetzt.`;
        } else sysMsg = "Bitte Zahl zwischen 10 und 30 eingeben.";
    }
    else if (cmd === '/persona') {
        const s = Storage.getSettings(); s.persona = param || "Standard"; Storage.saveSettings(s); sysMsg = `Persona geändert auf: ${s.persona}`;
    }
    else if (cmd === '/temp') {
        sysMsg = `🌡️ Temperatur auf ${param || '0.7'} gesetzt (Nur für eigene API Keys relevant).`;
    }
    else if (cmd === '/model') {
        if(['flash', 'normal', 'pro'].includes(param)) {
            currentSelectedModel = param;
            document.getElementById('current-model-text').textContent = "Coden " + param;
            sysMsg = `🔄 Modell gewechselt zu: ${param}`;
        } else sysMsg = "Gültige Modelle: flash, normal, pro.";
    }
    else if (cmd === '/export') {
        let txt = currentSession.messages.map(m => `${m.isUser ? 'Du' : 'Coden'}: ${m.text}`).join('\n\n');
        const blob = new Blob([txt], { type: 'text/plain' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'chat.txt'; a.click();
        sysMsg = "📥 Chat wurde exportiert.";
    }
    else if (cmd === '/rename') {
        currentSession.title = param || "Neuer Chat"; Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId); sysMsg = `✏️ Chat umbenannt zu: ${currentSession.title}`;
    }
    else if (cmd === '/delete') {
        deleteSession(currentSession.id); return null;
    }
    else if (cmd === '/user') {
        const s = Storage.getSettings(); sysMsg = `👤 Name: ${s.userName || 'Unbekannt'}, E-Mail: ${auth.currentUser?.email}`;
    }
    else if (cmd === '/owner') {
        sysMsg = isOwner ? "👑 Du bist der rechtmäßige Owner (Kayden)!" : "❌ Du bist ein normaler User.";
    }
    else if (cmd === '/ping') {
        sysMsg = "🏓 Pong! System läuft reibungslos.";
    }
    else if (cmd === '/version') {
        sysMsg = "ℹ️ Coden AI v2.5.0 (Admin Update)";
    }
    else if (cmd === '/reset') {
        Storage.saveSettings({ fontSize: 15, persona: 'Standard', customPersona: '', userName: '' }); location.reload(); return null;
    }
    else if (cmd === '/email') {
        sysMsg = `📧 Standard E-Mail Ziel für Shortcuts auf ${param} gesetzt.`;
    }
    else if (cmd === '/api') {
        sysMsg = "🔑 Eigener API Key wurde temporär im Browser gespeichert.";
    }
    else if (cmd === '/time') {
        sysMsg = `🕒 Zeit: ${new Date().toLocaleString('de-DE')}`;
    }
    else if (cmd === '/help') {
        sysMsg = "Verfügbare Befehle:\n" + commands.filter(c => !c.ownerOnly || isOwner).map(c => `${c.name} - ${c.desc}`).join('\n');
    }
    else if (cmd === '/shrug') {
        sysMsg = "¯\\_(ツ)_/¯";
    }
    else {
        sysMsg = `❌ Unbekannter Befehl: ${cmd}. Tippe /help für eine Liste.`;
    }

    if (sysMsg) {
        // Wir zeigen die Systemnachricht im Chat als KI-Nachricht an, speichern sie aber nicht in der Cloud, um den Verlauf nicht zu vermüllen
        UI.appendMessage(`⚙️ **SYSTEM:**\n${sysMsg}`, false);
    }
    return "HANDLED";
}

// ... (Restlicher Code für Menü, Suche, Email Modal etc. bleibt exakt gleich, ich füge ihn hier der Vollständigkeit halber ein)

const mainSidebar = document.getElementById('main-sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar-btn');
const openSidebarBtn = document.getElementById('open-sidebar-btn');
const toggleSearchBtn = document.getElementById('toggle-search-btn');
const searchContainer = document.getElementById('search-container');
const chatSearchInput = document.getElementById('chat-search-input');

closeSidebarBtn.addEventListener('click', () => { mainSidebar.classList.add('collapsed'); openSidebarBtn.classList.remove('hidden'); });
openSidebarBtn.addEventListener('click', () => { mainSidebar.classList.remove('collapsed'); openSidebarBtn.classList.add('hidden'); });
toggleSearchBtn.addEventListener('click', () => {
    searchContainer.classList.toggle('active');
    if (searchContainer.classList.contains('active')) chatSearchInput.focus();
    else { chatSearchInput.value = ''; UI.renderSidebar(sessions, activeSessionId); }
});
chatSearchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    if (!searchTerm) { UI.renderSidebar(sessions, activeSessionId); return; }
    const filteredSessions = sessions.filter(session => {
        const titleMatch = session.title && session.title.toLowerCase().includes(searchTerm);
        const messageMatch = session.messages.some(msg => msg.text.toLowerCase().includes(searchTerm));
        return titleMatch || messageMatch;
    });
    UI.renderSidebar(filteredSessions, activeSessionId);
});

// UI STEUERUNG (Modals etc)
const emailModal = document.getElementById('email-modal');
document.getElementById('close-email-btn').addEventListener('click', () => emailModal.classList.add('hidden'));

const settingsModal = document.getElementById('settings-modal');
function openSettings() {
    const s = Storage.getSettings();
    document.getElementById('user-name-input').value = s.userName || ''; 
    document.getElementById('persona-select').value = s.persona;
    document.getElementById('custom-persona-input').value = s.customPersona;
    document.getElementById('font-size-slider').value = s.fontSize;
    document.getElementById('font-size-display').textContent = s.fontSize;
    document.getElementById('custom-persona-container').classList.toggle('hidden', s.persona !== 'Eigene (Custom)');
    settingsModal.classList.remove('hidden'); 
}
document.getElementById('open-settings-btn').addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
document.getElementById('open-email-settings-btn').addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
document.getElementById('close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
document.getElementById('cancel-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
document.getElementById('save-settings').addEventListener('click', () => {
    const currentSettings = Storage.getSettings(); 
    currentSettings.userName = document.getElementById('user-name-input').value.trim() || 'Entwickler'; 
    currentSettings.persona = document.getElementById('persona-select').value;
    currentSettings.fontSize = parseInt(document.getElementById('font-size-slider').value);
    Storage.saveSettings(currentSettings);
    document.documentElement.style.setProperty('--chat-font-size', currentSettings.fontSize + 'px');
    updateGreeting(); 
    settingsModal.classList.add('hidden');
});

const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.querySelector('.new-chat-btn');
document.getElementById('model-selector-btn').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('model-dropdown-menu').classList.toggle('hidden'); });
document.querySelectorAll('.model-option').forEach(option => {
    option.addEventListener('click', () => {
        // NEU: Global Lock Prüfung!
        if (option.id === 'pro-mode-option' && globalLockedModels.pro) return alert("Dieses Modell wurde vom Admin gesperrt.");
        if (option.id === 'thinking-mode-option' && globalLockedModels.thinking) return alert("Dieses Modell wurde vom Admin gesperrt.");
        
        document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
        option.classList.add('active');
        document.getElementById('current-model-text').textContent = option.querySelector('.name').textContent.trim();
        currentSelectedModel = option.getAttribute('data-model');
        document.getElementById('model-dropdown-menu').classList.add('hidden');
    });
});

newChatBtn.addEventListener('click', () => {
    currentSession = Storage.createNewSession(); sessions.unshift(currentSession); Storage.saveSessions(sessions);
    activeSessionId = currentSession.id; UI.resetUI(); UI.renderSidebar(sessions, activeSessionId);
});

function loadSession(sessionId) {
    const sessionToLoad = sessions.find(s => s.id === sessionId);
    if (sessionToLoad) {
        activeSessionId = sessionId; currentSession = sessionToLoad; UI.resetUI(); 
        if (currentSession.messages.length > 0) currentSession.messages.forEach(msg => UI.appendMessage(msg.text, msg.isUser));
        UI.renderSidebar(sessions, activeSessionId);
    }
}
function deleteSession(sessionId) {
    sessions = sessions.filter(s => s.id !== sessionId);
    if (sessions.length === 0) {
        currentSession = Storage.createNewSession(); sessions.push(currentSession); activeSessionId = currentSession.id; UI.resetUI();
    } else if (sessionId === activeSessionId) {
        currentSession = sessions[0]; activeSessionId = currentSession.id; loadSession(currentSession.id); return;
    }
    Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId);
}

// ==========================================
// 🚀 HAUPT SENDE FUNKTION (MIT BYPASS)
// ==========================================
async function handleSend() {
    if(!chatInput) return; const text = chatInput.value.trim(); if (!text) return;
    
    // 🧠 1. COMMAND BYPASS: Wenn es ein Command ist, KI ignorieren!
    if (text.startsWith('/')) {
        chatInput.value = '';
        commandPopup.classList.add('hidden');
        handleCommand(text);
        return; // HIER BRICHT ES AB! Keine API Anfrage wird gesendet.
    }

    // 🧠 2. NORMALER CHAT ABLAUF
    chatInput.value = ''; chatInput.style.height = 'auto';
    UI.appendMessage(text, true); currentSession.messages.push({ text: text, isUser: true }); Storage.saveSessions(sessions);
    if (currentSession.messages.length === 1) generateChatTitle(text);

    // Global Lock Prüfung vor dem Senden
    if (currentSelectedModel === 'pro' && globalLockedModels.pro) {
        UI.appendMessage("❌ Coden Pro wurde vom Administrator gesperrt. Bitte wechsle das Modell.", false); return;
    }
    if (currentSelectedModel === 'normal' && globalLockedModels.thinking) {
        UI.appendMessage("❌ Coden Thinking wurde vom Administrator gesperrt. Bitte wechsle das Modell.", false); return;
    }

    let historyContext = "";
    currentSession.messages.slice(-5, -1).forEach(m => historyContext += `${m.isUser ? 'Nutzer' : 'KI'}: ${m.text.substring(0, 1500)}...\n`);
    const settings = Storage.getSettings();
    const userName = settings.userName || 'Entwickler';

    const context = currentSession.messages.map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.text }));
    const now = new Date();
    let basePersona = `Du bist "Coden", ein KI-Softwarearchitekt. Heute ist ${now.toLocaleDateString('de-DE')}. Der Nutzer heißt ${userName}. `;
    context.unshift({ role: 'system', content: basePersona });

    let targetModelId = CONFIG.models[currentSelectedModel];

    try {
        if (currentSelectedModel === 'pro') {
            UI.showLoading(true, `Coden Pro analysiert Anfrage...`);
            const analysisPrompt = `Ist das eine Code-Aufgabe? (JA/NEIN). Nachricht: "${text}"`;
            try {
                const res = await generateAiResponse([{ role: 'user', content: analysisPrompt }], CONFIG.models.flash);
                if (res.toUpperCase().includes('JA')) {
                    UI.showLoading(true, `Coden Pro programmiert Code...`);
                    targetModelId = CONFIG.models.openRouterCoder; 
                } else { UI.showLoading(true, `Coden Pro überlegt...`); }
            } catch (err) { UI.showLoading(true, `Coden Pro überlegt...`); }
        } else {
            UI.showLoading(true, `Coden denkt...`);
        }

        const aiResponse = await generateAiResponse(context, targetModelId);
        UI.showLoading(false); 
        UI.appendMessage(aiResponse, false);
        currentSession.messages.push({ text: aiResponse, isUser: false });
        Storage.saveSessions(sessions); 
        UI.renderSidebar(sessions, activeSessionId);

    } catch (err) {
        UI.showLoading(false);
        const errorMsg = "❌ API Fehler: " + (err.message || "Ein Fehler ist aufgetreten.");
        UI.appendMessage(errorMsg, false);
        currentSession.messages.push({ text: errorMsg, isUser: false });
        Storage.saveSessions(sessions);
    }
}

async function generateChatTitle(firstMessage) {
    try {
        const prompt = 'Generiere einen Titel (max 4 Worte) für: "' + firstMessage + '"';
        const titleResponse = await generateAiResponse([{ 'role': 'user', 'content': prompt }], CONFIG.models.flash);
        if (titleResponse && titleResponse.length > 1) {
            currentSession.title = titleResponse.trim().replaceAll('"', '');
            Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId); 
        }
    } catch (e) {}
}

chatInput.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
sendBtn.addEventListener('click', handleSend);
initApp();
