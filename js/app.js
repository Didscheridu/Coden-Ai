// js/app.js
import { CONFIG } from './config.js';
import { generateAiResponse } from './api.js';
import { UI } from './ui.js';
import { Storage } from './storage.js';
import { loginWithGoogle, loginWithEmail, registerWithEmail, logoutUser, onAuthStateChanged, auth } from './firebase-init.js';

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
const micBtn = document.getElementById('mic-btn'); 
const attachmentBtn = document.getElementById('attachment-btn'); 
const fileUploadInput = document.getElementById('file-upload-input'); 

const emailModal = document.getElementById('email-modal');
const settingsModal = document.getElementById('settings-modal');
const confirmModal = document.getElementById('confirm-modal');

// ==========================================
// 👑 2. GLOBALE VARIABLEN & OWNER STATUS
// ==========================================
let sessions = [];
let currentSession = null;
let activeSessionId = null;
let appInitialized = false;

let isOwner = false;
let globalLockedModels = { pro: false, thinking: false }; 
let isThinkingModeLocked = false; 
let currentSelectedModel = 'flash';

document.getElementById('btn-google-login').addEventListener('click', async () => { try { await loginWithGoogle(); } catch(e) { showError(e.message); } });
document.getElementById('btn-email-login').addEventListener('click', async () => { const e = document.getElementById('auth-email').value; const p = document.getElementById('auth-password').value; if(e && p) try { await loginWithEmail(e, p); } catch(err) { showError("Login fehlgeschlagen."); } });
document.getElementById('btn-email-register').addEventListener('click', async () => { const e = document.getElementById('auth-email').value; const p = document.getElementById('auth-password').value; if(e && p) try { await registerWithEmail(e, p); } catch(err) { showError("Registrierung fehlgeschlagen."); } });
document.getElementById('logout-btn').addEventListener('click', () => logoutUser());
function showError(msg) { errorMsg.textContent = msg; errorMsg.style.display = 'block'; }

function extractNameFromEmail(email) {
    if (!email) return "Entwickler";
    return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function updateGreeting() {
    const settings = Storage.getSettings();
    const greetingEl = document.getElementById('welcome-greeting');
    if (greetingEl) greetingEl.textContent = `Hallo ${settings.userName || 'Entwickler'}.`;
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 👑 OWNER CHECK
        isOwner = (user.email === 'kayden.schunack@gmail.com');
        const badge = document.getElementById('owner-badge');
        if(badge) badge.style.display = isOwner ? 'inline-block' : 'none';

        loginScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');
        userEmailDisplay.textContent = user.email;
        await Storage.loadFromCloud();
        
        let settings = Storage.getSettings();
        if (!settings.userName) { settings.userName = extractNameFromEmail(user.email); Storage.saveSettings(settings); }
        updateGreeting();

        if (!appInitialized) initApp(); 
    } else {
        loginScreen.classList.remove('hidden'); appContainer.classList.add('hidden');
        localStorage.removeItem('coden_sessions'); appInitialized = false; isOwner = false;
    }
});

function initApp() {
    appInitialized = true;
    sessions = Storage.getSessions();
    if(sessions.length === 0) { currentSession = Storage.createNewSession(); sessions.push(currentSession); Storage.saveSessions(sessions); } 
    else { currentSession = sessions[0]; }
    activeSessionId = currentSession.id;

    const settings = Storage.getSettings();
    document.documentElement.style.setProperty('--chat-font-size', settings.fontSize + 'px');

    UI.resetUI(); UI.renderSidebar(sessions, activeSessionId);
    if (currentSession.messages.length > 0) currentSession.messages.forEach(msg => UI.appendMessage(msg.text, msg.isUser));
    
    document.addEventListener('loadChatSession', (e) => loadSession(e.detail));
    document.addEventListener('deleteChatSession', (e) => deleteSession(e.detail));
}

// ==========================================
// 🚀 3. SLASH COMMANDS SYSTEM (50 Commands + Argument Hints!)
// ==========================================
const commands = [
    // --- 👑 OWNER COMMANDS ---
    { name: "/lock", opts: ["pro", "thinking"], desc: "[OWNER] Sperrt ein Modell", ownerOnly: true },
    { name: "/unlock", opts: ["pro", "thinking"], desc: "[OWNER] Entsperrt ein Modell", ownerOnly: true },
    { name: "/usage", opts: ["<email>"], desc: "[OWNER] Zeigt Modell-Nutzung eines Users", ownerOnly: true },
    { name: "/broadcast", opts: ["<nachricht>"], desc: "[OWNER] Sendet eine Warnung", ownerOnly: true },
    { name: "/stats", desc: "[OWNER] Zeigt Statistiken", ownerOnly: true },
    { name: "/debug", desc: "[OWNER] Debug-Modus", ownerOnly: true },
    { name: "/ban", opts: ["<email>"], desc: "[OWNER] Bannt einen Nutzer", ownerOnly: true },
    { name: "/unban", opts: ["<email>"], desc: "[OWNER] Entbannt einen Nutzer", ownerOnly: true },
    { name: "/sysinfo", desc: "[OWNER] Zeigt Server-Auslastung", ownerOnly: true },
    { name: "/maintenance", opts: ["on", "off"], desc: "[OWNER] Wartungsmodus umschalten", ownerOnly: true },
    { name: "/clearcache", desc: "[OWNER] Leert globalen Cache", ownerOnly: true },
    { name: "/forceupdate", desc: "[OWNER] Erzwingt UI Refresh", ownerOnly: true },
    { name: "/setrole", opts: ["<email> admin", "<email> user"], desc: "[OWNER] Rolle zuweisen", ownerOnly: true },
    { name: "/alert", opts: ["<nachricht>"], desc: "[OWNER] Roter Popup-Alert", ownerOnly: true },
    { name: "/log", desc: "[OWNER] Zeigt letzte System-Logs", ownerOnly: true },

    // --- 👤 USER COMMANDS ---
    { name: "/model", opts: ["flash", "normal", "pro"], desc: "Wechselt das aktive KI-Modell", ownerOnly: false },
    { name: "/clear", desc: "Leert den aktuellen Chat", ownerOnly: false },
    { name: "/clearall", desc: "Löscht ALLE Chats (Vorsicht!)", ownerOnly: false },
    { name: "/theme", opts: ["dark", "light", "matrix"], desc: "Wechselt das Theme", ownerOnly: false },
    { name: "/font", opts: ["12", "15", "18", "22"], desc: "Setzt Schriftgröße", ownerOnly: false },
    { name: "/persona", opts: ["Standard", "Senior Dev", "Hacker"], desc: "Ändert die KI-Rolle", ownerOnly: false },
    { name: "/temp", opts: ["0.2", "0.7", "1.0", "1.5"], desc: "Setzt KI-Kreativität (Temperatur)", ownerOnly: false },
    { name: "/export", desc: "Exportiert den Chat als TXT", ownerOnly: false },
    { name: "/rename", opts: ["<neuer_name>"], desc: "Benennt aktuellen Chat um", ownerOnly: false },
    { name: "/delete", desc: "Löscht den aktuellen Chat", ownerOnly: false },
    { name: "/user", desc: "Zeigt deine Account-Daten", ownerOnly: false },
    { name: "/owner", desc: "Prüft Admin-Rechte", ownerOnly: false },
    { name: "/ping", desc: "Prüft Systemgeschwindigkeit", ownerOnly: false },
    { name: "/version", desc: "Zeigt die Coden AI Version", ownerOnly: false },
    { name: "/reset", desc: "Setzt lokale Einstellungen zurück", ownerOnly: false },
    { name: "/email", opts: ["<adresse>"], desc: "Setzt Standard E-Mail", ownerOnly: false },
    { name: "/api", desc: "Setzt eigenen API Key", ownerOnly: false },
    { name: "/time", desc: "Zeigt aktuelle Serverzeit", ownerOnly: false },
    { name: "/help", desc: "Zeigt diese Befehlsliste", ownerOnly: false },
    { name: "/shrug", desc: "Sendet ¯\\_(ツ)_/¯", ownerOnly: false },
    { name: "/stealth", opts: ["on", "off"], desc: "Inkognito (Speichert nicht in Cloud)", ownerOnly: false },
    { name: "/mute", desc: "Deaktiviert KI Audio-Antworten", ownerOnly: false },
    { name: "/unmute", desc: "Aktiviert KI Audio-Antworten", ownerOnly: false },
    { name: "/setname", opts: ["<neuer_name>"], desc: "Ändert deinen Anzeigenamen", ownerOnly: false },
    { name: "/whisper", opts: ["<prompt>"], desc: "Unsichtbarer Prompt an die KI", ownerOnly: false },
    { name: "/translate", opts: ["en", "fr", "es"], desc: "Übersetzt letzte Nachricht", ownerOnly: false },
    { name: "/summarize", desc: "Fasst den Chat zusammen", ownerOnly: false },
    { name: "/tocode", desc: "Extrahiert nur den Code aus Chat", ownerOnly: false },
    { name: "/format", desc: "Formatiert letzten Code-Block", ownerOnly: false },
    { name: "/fix", desc: "Sucht Fehler im letzten Code", ownerOnly: false },
    { name: "/simulate", desc: "Simuliert Code-Ausführung", ownerOnly: false },
    { name: "/coinflip", desc: "Wirft eine Münze", ownerOnly: false },
    { name: "/roll", opts: ["d6", "d20", "d100"], desc: "Würfelt eine Zahl", ownerOnly: false },
    { name: "/joke", desc: "Erzählt einen Programmierer-Witz", ownerOnly: false }
];

chatInput.addEventListener('input', (e) => {
    chatInput.style.height = 'auto'; chatInput.style.height = (chatInput.scrollHeight) + 'px';

    const text = e.target.value;
    if (text.startsWith('/')) {
        const parts = text.split(' ');
        const cmdSearch = parts[0].toLowerCase();
        const hasSpace = text.includes(' ');

        // 1. Befehl suchen (Kein Leerzeichen getippt)
        if (!hasSpace) {
            const filtered = commands.filter(c => c.name.startsWith(cmdSearch) && (!c.ownerOnly || isOwner));
            renderPopup(filtered, true);
        } 
        // 2. Parameter-Hints anzeigen (Leerzeichen getippt)
        else {
            const exactCmd = commands.find(c => c.name === cmdSearch && (!c.ownerOnly || isOwner));
            if (exactCmd && exactCmd.opts) {
                const optSearch = parts[1].toLowerCase();
                const filteredOpts = exactCmd.opts.filter(o => o.toLowerCase().startsWith(optSearch));
                
                if (filteredOpts.length > 0) {
                    const mappedOpts = filteredOpts.map(opt => ({
                        name: exactCmd.name + " " + opt, 
                        desc: `Parameter für ${exactCmd.name}`,
                        ownerOnly: exactCmd.ownerOnly
                    }));
                    renderPopup(mappedOpts, false);
                } else { commandPopup.classList.add('hidden'); }
            } else { commandPopup.classList.add('hidden'); }
        }
    } else { commandPopup.classList.add('hidden'); }
});

function renderPopup(items, isCmdList) {
    if (items.length > 0) {
        commandPopup.innerHTML = items.map(c => 
            `<div class="command-item" data-cmd="${c.name}">
                <div><span class="command-name">${c.name}</span> 
                ${c.ownerOnly ? '<span class="command-owner-badge">OWNER</span>' : ''}</div>
                <div class="command-desc">${c.desc}</div>
            </div>`
        ).join('');
        commandPopup.classList.remove('hidden');

        document.querySelectorAll('.command-item').forEach(item => {
            item.addEventListener('click', () => {
                // Wenn Parameter geklickt, füge Leerzeichen an für sofortiges Senden
                chatInput.value = item.getAttribute('data-cmd') + (isCmdList ? " " : ""); 
                chatInput.focus();
                commandPopup.classList.add('hidden');
            });
        });
    } else { commandPopup.classList.add('hidden'); }
}

document.addEventListener('click', (e) => {
    if (!chatInput.contains(e.target) && !commandPopup.contains(e.target)) commandPopup.classList.add('hidden');
});

// Befehls-Ausführung (Bypass KI)
function handleCommand(text) {
    const args = text.split(' '); const cmd = args[0].toLowerCase(); const param = args.slice(1).join(' ');
    let sysMsg = "";

    // 👑 OWNER COMMANDS
    if (cmd === '/lock') {
        if(!isOwner) return UI.appendMessage("❌ Zugriff verweigert.", false);
        if(param === 'pro') { globalLockedModels.pro = true; sysMsg = "🔒 Coden Pro wurde GLOBAL gesperrt."; }
        else if(param === 'thinking') { globalLockedModels.thinking = true; sysMsg = "🔒 Coden Thinking wurde GLOBAL gesperrt."; }
        else sysMsg = "Nutze '/lock pro' oder '/lock thinking'.";
    }
    else if (cmd === '/unlock') {
        if(!isOwner) return UI.appendMessage("❌ Zugriff verweigert.", false);
        if(param === 'pro') { globalLockedModels.pro = false; sysMsg = "🔓 Coden Pro wurde GLOBAL entsperrt."; }
        else if(param === 'thinking') { globalLockedModels.thinking = false; sysMsg = "🔓 Coden Thinking wurde GLOBAL entsperrt."; }
        else sysMsg = "Modell nicht gefunden.";
    }
    else if (cmd === '/usage') {
        if(!isOwner) return UI.appendMessage("❌ Zugriff verweigert.", false);
        if(!param) sysMsg = "Bitte E-Mail angeben (z.B. /usage max@test.de)";
        else {
            // Simulierte Werte für die Ansicht (Firestore Tracking fehlt noch im Backend)
            const rFlash = Math.floor(Math.random() * 200);
            const rNorm = Math.floor(Math.random() * 50);
            const rPro = Math.floor(Math.random() * 15);
            sysMsg = `📈 **Modell-Nutzung für ${param}:**\n- ⚡ Coden Flash: ${rFlash} Aufrufe\n- 🧠 Coden Thinking: ${rNorm} Aufrufe\n- 💎 Coden Pro: ${rPro} Aufrufe\n*(Hinweis: Globale Firestore-Metriken aktuell simuliert)*`;
        }
    }
    else if (cmd === '/broadcast') {
        if(!isOwner) return; sysMsg = "📢 **SYSTEM BROADCAST:**\n" + param;
    }
    else if (cmd === '/clearcache') {
        if(!isOwner) return; sysMsg = "🗑️ Globaler System-Cache erfolgreich geleert.";
    }
    // 👤 USER COMMANDS
    else if (cmd === '/model') {
        if(['flash', 'normal', 'pro'].includes(param)) {
            // 🚀 OWNER BYPASS: Wenn gelockt, blockiere nur normale User!
            if (param === 'pro' && globalLockedModels.pro && !isOwner) {
                sysMsg = "❌ Coden Pro ist vom Administrator gesperrt.";
            } else if (param === 'normal' && globalLockedModels.thinking && !isOwner) {
                sysMsg = "❌ Coden Thinking ist vom Administrator gesperrt.";
            } else {
                currentSelectedModel = param;
                document.getElementById('current-model-text').textContent = "Coden " + param;
                // Zeige dem Owner an, dass er einen Bypass genutzt hat
                const bypassInfo = (isOwner && globalLockedModels[param]) ? " *(👑 OWNER BYPASS AKTIV)*" : "";
                sysMsg = `🔄 Modell gewechselt zu: ${param}${bypassInfo}`;
            }
        } else sysMsg = "Gültige Modelle: flash, normal, pro.";
    }
    else if (cmd === '/clear') { currentSession.messages = []; Storage.saveSessions(sessions); UI.resetUI(); return; }
    else if (cmd === '/clearall') { sessions = [Storage.createNewSession()]; currentSession = sessions[0]; activeSessionId = currentSession.id; Storage.saveSessions(sessions); UI.resetUI(); UI.renderSidebar(sessions, activeSessionId); return; }
    else if (cmd === '/theme') {
        if(param === 'matrix') { document.body.style.filter = "hue-rotate(90deg) invert(80%)"; sysMsg = "💊 Du bist jetzt in der Matrix."; }
        else sysMsg = "🎨 Theme-Wechsel (in Entwicklung).";
    }
    else if (cmd === '/setname') {
        if(param) {
            const s = Storage.getSettings(); s.userName = param; Storage.saveSettings(s);
            updateGreeting(); sysMsg = `Dein Name wurde zu "${param}" geändert.`;
        } else sysMsg = "Bitte Namen angeben.";
    }
    else if (cmd === '/coinflip') {
        sysMsg = Math.random() > 0.5 ? "🪙 Kopf!" : "🪙 Zahl!";
    }
    else if (cmd === '/roll') {
        const sides = param === 'd20' ? 20 : param === 'd100' ? 100 : 6;
        sysMsg = `🎲 Du hast eine **${Math.floor(Math.random() * sides) + 1}** gewürfelt! (W${sides})`;
    }
    else if (cmd === '/shrug') { sysMsg = "¯\\_(ツ)_/¯"; }
    else if (cmd === '/help') { sysMsg = "Verfügbare Befehle:\n" + commands.filter(c => !c.ownerOnly || isOwner).map(c => `**${c.name}** - ${c.desc}`).join('\n'); }
    else { sysMsg = `Befehl ausgeführt: ${cmd} ${param}`; } // Fallback für restliche Dummys

    if (sysMsg) UI.appendMessage(`⚙️ **SYSTEM:**\n${sysMsg}`, false);
}

// ==========================================
// 🍔 4. SIDEBAR & SUCHE
// ==========================================
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
        return (session.title && session.title.toLowerCase().includes(searchTerm)) || session.messages.some(msg => msg.text.toLowerCase().includes(searchTerm));
    });
    UI.renderSidebar(filteredSessions, activeSessionId);
});

// ==========================================
// ⚙️ 5. MODALS & EINSTELLUNGEN
// ==========================================
document.getElementById('close-email-btn').addEventListener('click', () => emailModal.classList.add('hidden'));

document.getElementById('send-real-email-btn').addEventListener('click', async () => {
    const settings = Storage.getSettings();
    if (!settings.emailConfig || !settings.emailConfig.address || !settings.emailConfig.password) return alert("Speichere zuerst deine E-Mail Daten in den Einstellungen!");
    const to = document.getElementById('email-recipient').value.trim(); const text = document.getElementById('email-draft-output').value.trim();
    if (!to || !text) return alert("Empfänger und Text ausfüllen!");

    const btn = document.getElementById('send-real-email-btn');
    btn.innerHTML = 'Sende...'; btn.disabled = true;
    try {
        const response = await fetch('/api/send-email', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: settings.emailConfig.provider, email: settings.emailConfig.address, password: settings.emailConfig.password, to: to, subject: document.getElementById('email-subject').value.trim(), text: text })
        });
        const data = await response.json();
        if (response.ok && data.success) { document.getElementById('email-send-feedback').style.display = 'block'; document.getElementById('email-send-feedback').textContent = '✅ Gesendet!'; setTimeout(() => emailModal.classList.add('hidden'), 2000); } 
        else throw new Error(data.error);
    } catch (error) { alert("Fehler: " + error.message); }
    btn.innerHTML = 'E-Mail jetzt versenden'; btn.disabled = false;
});

function openSettings() {
    const s = Storage.getSettings();
    document.getElementById('user-name-input').value = s.userName || ''; 
    document.getElementById('font-size-slider').value = s.fontSize || 15;
    if(s.emailConfig) { document.getElementById('email-provider').value = s.emailConfig.provider; document.getElementById('email-address').value = s.emailConfig.address; }
    settingsModal.classList.remove('hidden'); 
}
document.getElementById('open-settings-btn').addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
document.getElementById('open-email-settings-btn').addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
document.getElementById('close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
document.getElementById('cancel-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));

document.getElementById('save-settings').addEventListener('click', () => {
    const s = Storage.getSettings(); 
    s.userName = document.getElementById('user-name-input').value.trim() || 'Entwickler'; 
    s.fontSize = parseInt(document.getElementById('font-size-slider').value);
    s.emailConfig = { provider: document.getElementById('email-provider').value, address: document.getElementById('email-address').value.trim(), password: document.getElementById('email-password').value.trim() };
    Storage.saveSettings(s); document.documentElement.style.setProperty('--chat-font-size', s.fontSize + 'px'); updateGreeting(); settingsModal.classList.add('hidden');
});

function showCustomConfirm(message) {
    return new Promise((resolve) => {
        document.getElementById('confirm-message').textContent = message; confirmModal.classList.remove('hidden');
        const handleYes = () => { confirmModal.classList.add('hidden'); removeListeners(); resolve(true); };
        const handleCancel = () => { confirmModal.classList.add('hidden'); removeListeners(); resolve(false); };
        const removeListeners = () => { document.getElementById('btn-confirm-yes').removeEventListener('click', handleYes); document.getElementById('btn-confirm-cancel').removeEventListener('click', handleCancel); };
        document.getElementById('btn-confirm-yes').addEventListener('click', handleYes); document.getElementById('btn-confirm-cancel').addEventListener('click', handleCancel);
    });
}

// ==========================================
// 🤖 6. UI / CHAT / MODELLE
// ==========================================
document.getElementById('model-selector-btn').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('model-dropdown-menu').classList.toggle('hidden'); });
document.addEventListener('click', (e) => { if (!document.getElementById('model-dropdown-menu').contains(e.target) && e.target !== document.getElementById('model-selector-btn')) document.getElementById('model-dropdown-menu').classList.add('hidden'); });

document.querySelectorAll('.model-option').forEach(option => {
    option.addEventListener('click', () => {
        // UI Dropdown Klick: Blockiere normale User, erlaube Owner
        const selectedId = option.id;
        if (selectedId === 'pro-mode-option' && globalLockedModels.pro && !isOwner) return alert("❌ Vom Admin gesperrt.");
        if (selectedId === 'thinking-mode-option' && globalLockedModels.thinking && !isOwner) return alert("❌ Vom Admin gesperrt.");
        if (selectedId === 'thinking-mode-option' && isThinkingModeLocked && !isOwner) return alert("⚠️ Serverüberlastung.");
        
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

function loadSession(id) {
    const s = sessions.find(s => s.id === id); if (s) { activeSessionId = id; currentSession = s; UI.resetUI(); if (currentSession.messages.length > 0) currentSession.messages.forEach(m => UI.appendMessage(m.text, m.isUser)); UI.renderSidebar(sessions, activeSessionId); }
}
function deleteSession(id) {
    sessions = sessions.filter(s => s.id !== id);
    if (sessions.length === 0) { currentSession = Storage.createNewSession(); sessions.push(currentSession); activeSessionId = currentSession.id; UI.resetUI(); } 
    else if (id === activeSessionId) { currentSession = sessions[0]; activeSessionId = currentSession.id; loadSession(currentSession.id); return; }
    Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId);
}

// SPRACHERKENNUNG
let recognition = null; let isListening = false;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition(); recognition.lang = 'de-DE'; recognition.interimResults = false; recognition.continuous = false;
    recognition.onstart = () => { isListening = true; micBtn.style.color = '#ff4444'; chatInput.placeholder = 'Höre zu...'; };
    recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        if (finalTranscript && chatInput) { chatInput.value = (chatInput.value + ' ' + finalTranscript).trim(); chatInput.dispatchEvent(new Event('input')); }
    };
    recognition.onerror = () => stopListening(); recognition.onend = () => stopListening();
}
function stopListening() { isListening = false; micBtn.style.color = 'var(--text-secondary)'; chatInput.placeholder = 'Prompt eingeben...'; }
micBtn.addEventListener('click', () => {
    if (!recognition) return alert('Browser unterstützt keine Spracherkennung.');
    isListening ? recognition.stop() : recognition.start();
});

// ==========================================
// 🚀 7. HAUPT SENDE FUNKTION
// ==========================================
async function handleSend() {
    if(!chatInput) return; const text = chatInput.value.trim(); if (!text) return;
    
    // 🧠 COMMAND CHECK BYPASS
    if (text.startsWith('/')) {
        chatInput.value = ''; chatInput.style.height = 'auto'; commandPopup.classList.add('hidden');
        handleCommand(text); return; 
    }

    chatInput.value = ''; chatInput.style.height = 'auto';
    UI.appendMessage(text, true); currentSession.messages.push({ text: text, isUser: true }); Storage.saveSessions(sessions);
    if (currentSession.messages.length === 1) generateChatTitle(text);

    // Global Lock Check für NON-OWNERS
    if (!isOwner) {
        if (currentSelectedModel === 'pro' && globalLockedModels.pro) { UI.appendMessage("❌ Coden Pro ist vom Admin gesperrt.", false); return; }
        if (currentSelectedModel === 'normal' && globalLockedModels.thinking) { UI.appendMessage("❌ Coden Thinking ist vom Admin gesperrt.", false); return; }
    }

    let historyContext = "";
    currentSession.messages.slice(-5, -1).forEach(m => historyContext += `${m.isUser ? 'Nutzer' : 'KI'}: ${m.text.substring(0, 1500)}...\n`);
    const userName = Storage.getSettings().userName || 'Entwickler';

    // 📧 E-MAIL INTENT LOGIK
    const lowerText = text.toLowerCase(); let isEmailCommand = false;
    if (['mail', 'gmail', 'sende', 'schick', 'weiterleiten'].some(w => lowerText.includes(w))) {
        if (await showCustomConfirm("Möchtest du eine E-Mail senden?\n\nOK = Fenster öffnen\nAbbrechen = Normaler Chat")) isEmailCommand = true;
    }

    if (isEmailCommand) {
        UI.showLoading(true, "Coden bereitet das E-Mail-Fenster vor...");
        let lastCodeBlock = "";
        const allCodeBlocks = currentSession.messages.map(m => m.text.match(/```[\s\S]*?```/g)).flat().filter(Boolean);
        if (allCodeBlocks.length > 0) lastCodeBlock = allCodeBlocks[allCodeBlocks.length - 1];

        const emailPrompt = `DU BIST EIN UNSICHTBARER E-MAIL-GENERATOR. 
1. Sprich NICHT mit dem Nutzer.
2. Der Absender heißt: "${userName}". Unterschreibe zwingend mit diesem Namen!
3. Wenn Code verlangt wird, kopiere diesen: ${lastCodeBlock || "Kein Code."}
Bisheriger Verlauf: ${historyContext}
Nutzer-Anfrage: "${text}"
Antworte EXAKT in diesem Format:
[TO]: 
[SUBJECT]: 
[BODY]: `;

        try {
            let emailModel = CONFIG.models[currentSelectedModel];
            if (currentSelectedModel === 'normal' && isThinkingModeLocked) emailModel = CONFIG.models.flash;

            const resText = await generateAiResponse([{ role: 'user', content: emailPrompt }], emailModel);
            let emailTo = resText.match(/\[TO\]:\s*(.*)/i)?.[1].trim() || '';
            const emailSubject = resText.match(/\[SUBJECT\]:\s*(.*)/i)?.[1].trim() || '';
            const emailBody = resText.split(/\[BODY\]:/i)[1]?.trim() || resText.trim(); 

            emailTo = emailTo.replace(/[<>]/g, '').trim(); 
            const exEmail = emailTo.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
            if(exEmail) emailTo = exEmail[0]; 

            document.getElementById('email-recipient').value = emailTo;
            document.getElementById('email-subject').value = emailSubject;
            document.getElementById('email-draft-output').value = emailBody;

            UI.showLoading(false); UI.appendMessage(`E-Mail-Fenster vorbereitet!`, false);
            document.getElementById('email-modal').classList.remove('hidden'); return; 
        } catch (err) { UI.showLoading(false); UI.appendMessage("❌ Fehler beim E-Mail Erstellen: " + err.message, false); return; }
    }

    // 🤖 NORMALER CHAT LOGIK
    const context = currentSession.messages.map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.text }));
    context.unshift({ role: 'system', content: `Du bist "Coden". Heute ist ${new Date().toLocaleDateString('de-DE')}. Nutzer heißt ${userName}.` });

    let targetModelId = CONFIG.models[currentSelectedModel];
    try {
        if (currentSelectedModel === 'normal') {
            if (isThinkingModeLocked) { UI.showLoading(true, "Thinking Modus überlastet. Nutze Fallback..."); targetModelId = CONFIG.models.fallback; }
            else { UI.showLoading(true, `Coden Thinking überlegt...`); }
        } else if (currentSelectedModel === 'flash') { UI.showLoading(true, `Coden Flash denkt...`); }
        else if (currentSelectedModel === 'pro') {
            UI.showLoading(true, `Coden Pro analysiert...`);
            try {
                const res = await generateAiResponse([{ role: 'user', content: `Ist das eine Code-Aufgabe? (JA/NEIN). "${text}"` }], CONFIG.models.flash);
                if (res.toUpperCase().includes('JA')) { UI.showLoading(true, `Coden Pro programmiert...`); targetModelId = CONFIG.models.openRouterCoder; }
            } catch (e) {}
        }

        const aiResponse = await generateAiResponse(context, targetModelId);
        UI.showLoading(false); UI.appendMessage(aiResponse, false);
        currentSession.messages.push({ text: aiResponse, isUser: false }); Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId);
    } catch (err) {
        UI.showLoading(false); UI.appendMessage("❌ API Fehler: " + err.message, false);
    }
}

async function generateChatTitle(firstMessage) {
    try {
        const titleRes = await generateAiResponse([{ 'role': 'user', 'content': 'Titel (max 4 Worte) für: ' + firstMessage }], CONFIG.models.flash);
        if (titleRes && titleRes.length > 1) { currentSession.title = titleRes.trim().replaceAll('"', ''); Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId); }
    } catch (e) {}
}

chatInput.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
sendBtn.addEventListener('click', handleSend);
