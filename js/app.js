// js/app.js
import { CONFIG } from './config.js';
import { generateAiResponse } from './api.js';
import { UI } from './ui.js';
import { Storage } from './storage.js';
import { loginWithGoogle, loginWithEmail, registerWithEmail, logoutUser, onAuthStateChanged, auth, db } from './firebase-init.js';
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ==========================================
// 🏗️ 1. ALLE DOM-ELEMENTE (Sicher geladen)
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
const emailModal = document.getElementById('email-modal');
const settingsModal = document.getElementById('settings-modal');
const confirmModal = document.getElementById('confirm-modal');

// ==========================================
// 👑 2. GLOBALE VARIABLEN
// ==========================================
let sessions = [];
let currentSession = null;
let activeSessionId = null;
let appInitialized = false;

let isOwner = false;
let globalLockedModels = { pro: false, thinking: false }; 
let currentSelectedModel = 'flash';

let lastBroadcastTime = 0;
let lastUpdateTime = 0;
let lastGlobalClearTime = 0;

function showError(msg) { 
    if(errorMsg) { errorMsg.textContent = msg; errorMsg.style.display = 'block'; }
    console.error("Login Fehler:", msg);
}

// 🛡️ SICHERE EVENT-LISTENERS FÜR LOGIN
if (document.getElementById('btn-google-login')) {
    document.getElementById('btn-google-login').addEventListener('click', async () => { 
        try { await loginWithGoogle(); } catch(e) { showError(e.message); } 
    });
}
if (document.getElementById('btn-email-login')) {
    document.getElementById('btn-email-login').addEventListener('click', async () => { 
        const e = document.getElementById('auth-email').value; const p = document.getElementById('auth-password').value; 
        if(e && p) try { await loginWithEmail(e, p); } catch(err) { showError("Login fehlgeschlagen."); } 
    });
}
if (document.getElementById('btn-email-register')) {
    document.getElementById('btn-email-register').addEventListener('click', async () => { 
        const e = document.getElementById('auth-email').value; const p = document.getElementById('auth-password').value; 
        if(e && p) try { await registerWithEmail(e, p); } catch(err) { showError("Registrierung fehlgeschlagen."); } 
    });
}
if (document.getElementById('logout-btn')) {
    document.getElementById('logout-btn').addEventListener('click', () => {
        try { logoutUser(); } catch(e) { console.error(e); }
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
        if (greetingEl) greetingEl.textContent = `Hallo ${settings.userName || 'Entwickler'}.`;
    } catch(e) { console.warn("Begrüßung konnte nicht geladen werden."); }
}

// ==========================================
// 🔐 AUTH STATE (Kugelsicher)
// ==========================================
if (auth) {
    onAuthStateChanged(auth, async (user) => {
        try {
            if (user) {
                isOwner = (user.email === 'kayden.schunack@gmail.com');
                const badge = document.getElementById('owner-badge');
                if(badge) badge.style.display = isOwner ? 'inline-block' : 'none';

                if(loginScreen) loginScreen.classList.add('hidden'); 
                if(appContainer) appContainer.classList.remove('hidden');
                if(userEmailDisplay) userEmailDisplay.textContent = user.email;
                
                // 🛡️ SICHERER CLOUD LOAD
                try {
                    if (Storage.loadFromCloud) await Storage.loadFromCloud();
                } catch(cloudErr) {
                    console.warn("Cloud Load übersprungen/Fehler:", cloudErr);
                }
                
                let settings = Storage.getSettings();
                if (!settings.userName) { 
                    settings.userName = extractNameFromEmail(user.email); 
                    Storage.saveSettings(settings); 
                }
                updateGreeting();

                if (!appInitialized) initApp(); 
                initGlobalSync(); 
            } else {
                if(loginScreen) loginScreen.classList.remove('hidden'); 
                if(appContainer) appContainer.classList.add('hidden');
                appInitialized = false; 
                isOwner = false;
            }
        } catch (err) {
            console.error("Kritischer Fehler im Auth State:", err);
            showError("Fehler beim Laden deines Profils.");
        }
    });
} else {
    console.error("Firebase Auth wurde nicht gefunden! Checke firebase-init.js");
}

function initGlobalSync() {
    try {
        if(!db) return console.warn("Firebase 'db' fehlt. App läuft offline.");
        
        onSnapshot(doc(db, "system", "state"), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.locks) {
                    globalLockedModels = data.locks;
                    const pOpt = document.getElementById('pro-mode-option');
                    const tOpt = document.getElementById('thinking-mode-option');
                    if(pOpt) pOpt.classList.toggle('disabled', data.locks.pro);
                    if(tOpt) tOpt.classList.toggle('disabled', data.locks.thinking);
                }
                if (data.globalModel && data.globalModel !== currentSelectedModel) {
                    forceModelChange(data.globalModel, `🔄 Modell auf Coden ${data.globalModel} gewechselt.`);
                }
                if (data.broadcast && data.broadcast.time > lastBroadcastTime) {
                    lastBroadcastTime = data.broadcast.time;
                    if (!isOwner) showCustomConfirm("📢 SYSTEM BROADCAST:\n\n" + data.broadcast.message); 
                }
                if (data.forceUpdate && data.forceUpdate > lastUpdateTime) {
                    lastUpdateTime = data.forceUpdate;
                    if (!isOwner) location.reload();
                }
                if (data.theme) document.body.style.filter = data.theme === 'matrix' ? "hue-rotate(90deg) invert(80%)" : "";
                if (data.fontSize) document.documentElement.style.setProperty('--chat-font-size', data.fontSize + 'px');
            }
        });
    } catch (error) { console.warn("Live-Sync Fehler:", error); }
}

function forceModelChange(newModel, msg) {
    currentSelectedModel = newModel;
    document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
    const opt = document.querySelector(`.model-option[data-model="${newModel}"]`);
    if(opt) {
        opt.classList.add('active');
        document.getElementById('current-model-text').textContent = opt.querySelector('.name').textContent;
    }
    if(!isOwner) UI.appendMessage(msg, false);
}

function initApp() {
    try {
        appInitialized = true;
        sessions = Storage.getSessions();
        if(sessions.length === 0) { 
            currentSession = Storage.createNewSession(); 
            sessions.push(currentSession); 
            Storage.saveSessions(sessions); 
        } else { currentSession = sessions[0]; }
        activeSessionId = currentSession.id;

        const settings = Storage.getSettings();
        document.documentElement.style.setProperty('--chat-font-size', (settings.fontSize || 15) + 'px');

        UI.resetUI(); 
        UI.renderSidebar(sessions, activeSessionId);
        if (currentSession.messages.length > 0) currentSession.messages.forEach(msg => UI.appendMessage(msg.text, msg.isUser));
        
        const opt = document.querySelector(`.model-option[data-model="${currentSelectedModel}"]`);
        if(opt && document.getElementById('current-model-text')) {
            document.getElementById('current-model-text').textContent = opt.querySelector('.name').textContent;
        }
    } catch(e) { console.error("Fehler beim App Start:", e); }
}

// ==========================================
// 🚀 4. COMMANDS (OWNER ONLY)
// ==========================================
const commands = [
    { name: "/lock", opts: ["pro", "thinking"], desc: "Sperrt Modell GLOBAL", ownerOnly: true },
    { name: "/unlock", opts: ["pro", "thinking"], desc: "Entsperrt Modell GLOBAL", ownerOnly: true },
    { name: "/broadcast", opts: ["<nachricht>"], desc: "Pop-Up an ALLE User", ownerOnly: true },
    { name: "/forceupdate", desc: "Erzwingt Reload bei Usern", ownerOnly: true },
    { name: "/model", opts: ["flash", "normal", "pro"], desc: "Ändert Modell GLOBAL", ownerOnly: true },
    { name: "/theme", opts: ["normal", "matrix"], desc: "Ändert Design GLOBAL", ownerOnly: true },
    { name: "/api", opts: ["<KEY>"], desc: "Speichert Google Key", ownerOnly: true }
];

if (chatInput) {
    chatInput.addEventListener('input', (e) => {
        chatInput.style.height = 'auto'; chatInput.style.height = (chatInput.scrollHeight) + 'px';
        const text = e.target.value;

        if (!isOwner && text.startsWith('/')) { if(commandPopup) commandPopup.classList.add('hidden'); return; }

        if (text.startsWith('/')) {
            const parts = text.split(' '); const cmdSearch = parts[0].toLowerCase(); const hasSpace = text.includes(' ');
            if (!hasSpace) {
                renderPopup(commands.filter(c => c.name.startsWith(cmdSearch)), true);
            } else {
                const exactCmd = commands.find(c => c.name === cmdSearch);
                if (exactCmd && exactCmd.opts) {
                    const optSearch = parts[1].toLowerCase();
                    const fOpts = exactCmd.opts.filter(o => o.toLowerCase().startsWith(optSearch));
                    if (fOpts.length > 0) renderPopup(fOpts.map(opt => ({ name: exactCmd.name + " " + opt, desc: `Parameter` })), false);
                    else if(commandPopup) commandPopup.classList.add('hidden');
                } else if(commandPopup) commandPopup.classList.add('hidden');
            }
        } else if(commandPopup) commandPopup.classList.add('hidden');
    });
}

function renderPopup(items, isCmdList) {
    if (!commandPopup) return;
    if (items.length > 0) {
        commandPopup.innerHTML = items.map(c => `<div class="command-item" data-cmd="${c.name}"><div><span class="command-name">${c.name}</span> <span class="command-owner-badge">OWNER</span></div><div class="command-desc">${c.desc}</div></div>`).join('');
        commandPopup.classList.remove('hidden');
        document.querySelectorAll('.command-item').forEach(item => {
            item.addEventListener('click', () => {
                chatInput.value = item.getAttribute('data-cmd') + (isCmdList ? " " : ""); 
                chatInput.focus(); commandPopup.classList.add('hidden');
            });
        });
    } else commandPopup.classList.add('hidden');
}

document.addEventListener('click', (e) => { 
    if (chatInput && commandPopup && !chatInput.contains(e.target) && !commandPopup.contains(e.target)) commandPopup.classList.add('hidden'); 
});

async function handleCommand(text) {
    const args = text.split(' '); const cmd = args[0].toLowerCase(); const param = args.slice(1).join(' ');
    if(!isOwner) return UI.appendMessage("❌ Zugriff verweigert.", false);
    
    let sysMsg = "";
    if (cmd === '/api') {
        const s = Storage.getSettings(); s.apiKey = param; Storage.saveSettings(s);
        return UI.appendMessage(`⚙️ **SYSTEM:**\n🔑 API Key im Browser gespeichert!`, false);
    }

    if (!db) return UI.appendMessage("❌ Datenbank-Fehler.", false);
    try {
        if (cmd === '/lock') {
            await setDoc(doc(db, "system", "state"), { locks: { [args[1]]: true } }, { merge: true }); sysMsg = `🔒 ${args[1]} GLOBAL gesperrt.`;
        }
        else if (cmd === '/unlock') {
            await setDoc(doc(db, "system", "state"), { locks: { [args[1]]: false } }, { merge: true }); sysMsg = `🔓 ${args[1]} GLOBAL entsperrt.`;
        }
        else if (cmd === '/broadcast') { await setDoc(doc(db, "system", "state"), { broadcast: { message: param, time: Date.now() } }, { merge: true }); sysMsg = "📢 Broadcast LIVE gesendet."; }
        else if (cmd === '/forceupdate') { await setDoc(doc(db, "system", "state"), { forceUpdate: Date.now() }, { merge: true }); sysMsg = "🔄 Reload befohlen."; }
        else if (cmd === '/model') { await setDoc(doc(db, "system", "state"), { globalModel: param }, { merge: true }); sysMsg = `🔄 Modell auf '${param}' gezwungen.`; }
        else if (cmd === '/theme') { await setDoc(doc(db, "system", "state"), { theme: param }, { merge: true }); sysMsg = `🎨 Theme auf '${param}' gesetzt.`; }
        else { sysMsg = `Admin-Befehl ausgeführt: ${cmd}`; } 

        UI.appendMessage(`⚙️ **GLOBAL ADMIN:**\n${sysMsg}`, false);
    } catch(e) { UI.appendMessage(`⚙️ **SYSTEM FEHLER:**\n${e.message}`, false); }
}

// ==========================================
// 🚀 5. SIDEBAR, SUCHE & MODALS
// ==========================================
const mainSidebar = document.getElementById('main-sidebar'); 
const searchContainer = document.getElementById('search-container'); 
const chatSearchInput = document.getElementById('chat-search-input');

if(document.getElementById('close-sidebar-btn')) document.getElementById('close-sidebar-btn').addEventListener('click', () => { mainSidebar.classList.add('collapsed'); document.getElementById('open-sidebar-btn').classList.remove('hidden'); }); 
if(document.getElementById('open-sidebar-btn')) document.getElementById('open-sidebar-btn').addEventListener('click', () => { mainSidebar.classList.remove('collapsed'); document.getElementById('open-sidebar-btn').classList.add('hidden'); });
if(document.getElementById('toggle-search-btn')) document.getElementById('toggle-search-btn').addEventListener('click', () => { searchContainer.classList.toggle('active'); if (searchContainer.classList.contains('active')) chatSearchInput.focus(); else { chatSearchInput.value = ''; UI.renderSidebar(sessions, activeSessionId); } });
if(chatSearchInput) chatSearchInput.addEventListener('input', (e) => { const st = e.target.value.toLowerCase(); if (!st) { UI.renderSidebar(sessions, activeSessionId); return; } const fs = sessions.filter(s => (s.title && s.title.toLowerCase().includes(st)) || s.messages.some(m => m.text.toLowerCase().includes(st))); UI.renderSidebar(fs, activeSessionId); });

if(document.getElementById('close-settings')) document.getElementById('close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
if(document.getElementById('cancel-settings')) document.getElementById('cancel-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));

if(document.getElementById('open-settings-btn')) document.getElementById('open-settings-btn').addEventListener('click', (e) => { 
    e.preventDefault(); 
    const s = Storage.getSettings(); document.getElementById('user-name-input').value = s.userName || ''; document.getElementById('font-size-slider').value = s.fontSize || 15;
    settingsModal.classList.remove('hidden'); 
});

if(document.getElementById('save-settings')) document.getElementById('save-settings').addEventListener('click', () => {
    const s = Storage.getSettings(); s.userName = document.getElementById('user-name-input').value.trim() || 'Entwickler'; s.fontSize = parseInt(document.getElementById('font-size-slider').value);
    Storage.saveSettings(s); document.documentElement.style.setProperty('--chat-font-size', s.fontSize + 'px'); updateGreeting(); settingsModal.classList.add('hidden');
});

function showCustomConfirm(message) {
    return new Promise((resolve) => {
        if(!confirmModal) return resolve(true);
        document.getElementById('confirm-message').textContent = message; confirmModal.classList.remove('hidden');
        const handleYes = () => { confirmModal.classList.add('hidden'); document.getElementById('btn-confirm-yes').removeEventListener('click', handleYes); document.getElementById('btn-confirm-cancel').removeEventListener('click', handleCancel); resolve(true); };
        const handleCancel = () => { confirmModal.classList.add('hidden'); document.getElementById('btn-confirm-yes').removeEventListener('click', handleYes); document.getElementById('btn-confirm-cancel').removeEventListener('click', handleCancel); resolve(false); };
        document.getElementById('btn-confirm-yes').addEventListener('click', handleYes); document.getElementById('btn-confirm-cancel').addEventListener('click', handleCancel);
    });
}

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
        document.getElementById('model-dropdown-menu').classList.add('hidden');
    });
});

if(newChatBtn) newChatBtn.addEventListener('click', () => { currentSession = Storage.createNewSession(); sessions.unshift(currentSession); Storage.saveSessions(sessions); activeSessionId = currentSession.id; UI.resetUI(); UI.renderSidebar(sessions, activeSessionId); });
function loadSession(id) { const s = sessions.find(s => s.id === id); if (s) { activeSessionId = id; currentSession = s; UI.resetUI(); if (currentSession.messages.length > 0) currentSession.messages.forEach(m => UI.appendMessage(m.text, m.isUser)); UI.renderSidebar(sessions, activeSessionId); } }
function deleteSession(id) { sessions = sessions.filter(s => s.id !== id); if (sessions.length === 0) { currentSession = Storage.createNewSession(); sessions.push(currentSession); activeSessionId = currentSession.id; UI.resetUI(); } else if (id === activeSessionId) { currentSession = sessions[0]; activeSessionId = currentSession.id; loadSession(currentSession.id); return; } Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId); }

// ==========================================
// 🚀 6. HAUPT SENDE FUNKTION
// ==========================================
async function handleSend() {
    if(!chatInput) return; const text = chatInput.value.trim(); if (!text) return;
    
    if (text.startsWith('/')) {
        if (!isOwner) { chatInput.value = ''; UI.appendMessage("❌ Administrator-Befehle sind gesperrt.", false); return; }
        chatInput.value = ''; chatInput.style.height = 'auto'; if(commandPopup) commandPopup.classList.add('hidden');
        handleCommand(text); return; 
    }

    chatInput.value = ''; chatInput.style.height = 'auto';
    UI.appendMessage(text, true); currentSession.messages.push({ text: text, isUser: true }); Storage.saveSessions(sessions);

    if (!isOwner) {
        if (currentSelectedModel === 'pro' && globalLockedModels.pro) { UI.appendMessage("❌ Coden Pro ist gesperrt.", false); return; }
        if (currentSelectedModel === 'normal' && globalLockedModels.thinking) { UI.appendMessage("❌ Coden Thinking ist gesperrt.", false); return; }
    }

    const userName = Storage.getSettings().userName || 'Entwickler';
    const context = currentSession.messages.map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.text }));
    context.unshift({ role: 'system', content: `Du bist "Coden". Heute ist ${new Date().toLocaleDateString('de-DE')}. Nutzer heißt ${userName}.` });

    try {
        let targetTier = currentSelectedModel;
        UI.showLoading(true, `Coden generiert...`);
        const aiResponse = await generateAiResponse(context, targetTier);
        
        UI.showLoading(false); UI.appendMessage(aiResponse, false);
        currentSession.messages.push({ text: aiResponse, isUser: false }); Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId);
    } catch (err) {
        UI.showLoading(false); UI.appendMessage("❌ System Fehler: " + err.message, false);
    }
}

if(chatInput) chatInput.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
if(sendBtn) sendBtn.addEventListener('click', handleSend);
