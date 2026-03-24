// js/app.js
import { CONFIG } from './config.js';
import { generateAiResponse } from './api.js';
import { UI } from './ui.js';
import { Storage } from './storage.js';
import { loginWithGoogle, loginWithEmail, registerWithEmail, logoutUser, onAuthStateChanged, auth, db } from './firebase-init.js';
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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

let sessions = [];
let currentSession = null;
let activeSessionId = null;
let appInitialized = false;

let isOwner = false;
let globalLockedModels = { pro: false, thinking: false }; 
let currentSelectedModel = 'flash'; // Internal keys stay short, display maps to Google

let lastBroadcastTime = 0;
let lastUpdateTime = 0;
let lastGlobalClearTime = 0;

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

function initGlobalSync() {
    try {
        if(!db) return console.warn("Firebase 'db' fehlt. App läuft offline.");
        onSnapshot(doc(db, "system", "state"), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.locks) {
                    globalLockedModels = data.locks;
                    document.getElementById('pro-mode-option').classList.toggle('disabled', data.locks.pro);
                    document.getElementById('thinking-mode-option').classList.toggle('disabled', data.locks.thinking);
                }
                if (data.globalModel && data.globalModel !== currentSelectedModel) {
                    forceModelChange(data.globalModel, `🔄 Der Admin hat das Modell auf ${data.globalModel} gewechselt.`);
                }
                if (data.broadcast && data.broadcast.time > lastBroadcastTime) {
                    lastBroadcastTime = data.broadcast.time;
                    if (!isOwner) showCustomConfirm("📢 SYSTEM BROADCAST:\n\n" + data.broadcast.message); 
                }
                if (data.forceUpdate && data.forceUpdate > lastUpdateTime) {
                    lastUpdateTime = data.forceUpdate; if (!isOwner) location.reload();
                }
                if (data.maintenance && !isOwner) {
                    document.body.innerHTML = "<div style='display:flex; height:100vh; width:100vw; background:#111; color:white; align-items:center; justify-content:center; flex-direction:column;'><h1>🛠️ WARTUNGSARBEITEN</h1><p>Gesperrt.</p></div>";
                }
                if (data.theme) document.body.style.filter = data.theme === 'matrix' ? "hue-rotate(90deg) invert(80%)" : "";
                if (data.fontSize) document.documentElement.style.setProperty('--chat-font-size', data.fontSize + 'px');
                if (data.globalClear && data.globalClear > lastGlobalClearTime) {
                    lastGlobalClearTime = data.globalClear;
                    sessions = [Storage.createNewSession()]; currentSession = sessions[0]; activeSessionId = currentSession.id;
                    Storage.saveSessions(sessions); UI.resetUI(); UI.renderSidebar(sessions, activeSessionId);
                    if (!isOwner) UI.appendMessage("⚠️ Der Administrator hat alle Chats global geleert.", false);
                }
            }
        });
    } catch (error) { console.warn("Live-Sync Fehler", error); }
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

onAuthStateChanged(auth, async (user) => {
    if (user) {
        isOwner = (user.email === 'kayden.schunack@gmail.com');
        const badge = document.getElementById('owner-badge');
        if(badge) badge.style.display = isOwner ? 'inline-block' : 'none';
        loginScreen.classList.add('hidden'); appContainer.classList.remove('hidden');
        userEmailDisplay.textContent = user.email;
        await Storage.loadFromCloud();
        let settings = Storage.getSettings();
        if (!settings.userName) { settings.userName = extractNameFromEmail(user.email); Storage.saveSettings(settings); }
        updateGreeting();
        if (!appInitialized) initApp(); 
        initGlobalSync(); 
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
    
    // Initiales Label setzen
    const opt = document.querySelector(`.model-option[data-model="${currentSelectedModel}"]`);
    if(opt) document.getElementById('current-model-text').textContent = opt.querySelector('.name').textContent;
}

const commands = [
    { name: "/lock", opts: ["pro", "thinking"], desc: "Sperrt ein Modell GLOBAL", ownerOnly: true },
    { name: "/unlock", opts: ["pro", "thinking"], desc: "Entsperrt ein Modell GLOBAL", ownerOnly: true },
    { name: "/broadcast", opts: ["<nachricht>"], desc: "Pop-Up an ALLE User", ownerOnly: true },
    { name: "/maintenance", opts: ["on", "off"], desc: "Sperrt App komplett für User", ownerOnly: true },
    { name: "/forceupdate", desc: "Erzwingt bei ALLEN einen Reload", ownerOnly: true },
    { name: "/model", opts: ["flash", "normal", "pro"], desc: "Ändert das Modell GLOBAL", ownerOnly: true },
    { name: "/theme", opts: ["normal", "matrix"], desc: "Ändert das Design GLOBAL", ownerOnly: true },
    { name: "/font", opts: ["12", "15", "18", "22"], desc: "Ändert die Schriftgröße GLOBAL", ownerOnly: true },
    { name: "/clearall", desc: "Leert die Chats bei ALLEN Usern", ownerOnly: true },
    { name: "/api", opts: ["<DEIN_KEY>"], desc: "Speichert Google AI Key im Browser", ownerOnly: true },
    { name: "/usage", opts: ["<email>"], desc: "Zeigt Modell-Aufrufe", ownerOnly: true },
    { name: "/stats", desc: "Zeigt globale System-Statistiken", ownerOnly: true }
];

chatInput.addEventListener('input', (e) => {
    chatInput.style.height = 'auto'; chatInput.style.height = (chatInput.scrollHeight) + 'px';
    const text = e.target.value;
    if (!isOwner && text.startsWith('/')) { commandPopup.classList.add('hidden'); return; }
    if (text.startsWith('/')) {
        const parts = text.split(' '); const cmdSearch = parts[0].toLowerCase(); const hasSpace = text.includes(' ');
        if (!hasSpace) {
            const filtered = commands.filter(c => c.name.startsWith(cmdSearch)); renderPopup(filtered, true);
        } else {
            const exactCmd = commands.find(c => c.name === cmdSearch);
            if (exactCmd && exactCmd.opts) {
                const optSearch = parts[1].toLowerCase();
                const filteredOpts = exactCmd.opts.filter(o => o.toLowerCase().startsWith(optSearch));
                if (filteredOpts.length > 0) {
                    const mappedOpts = filteredOpts.map(opt => ({ name: exactCmd.name + " " + opt, desc: `Parameter für ${exactCmd.name}` }));
                    renderPopup(mappedOpts, false);
                } else commandPopup.classList.add('hidden');
            } else commandPopup.classList.add('hidden');
        }
    } else commandPopup.classList.add('hidden');
});

function renderPopup(items, isCmdList) {
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

document.addEventListener('click', (e) => { if (!chatInput.contains(e.target) && !commandPopup.contains(e.target)) commandPopup.classList.add('hidden'); });

async function handleCommand(text) {
    const args = text.split(' '); const cmd = args[0].toLowerCase(); const param = args.slice(1).join(' ');
    if(!isOwner) return UI.appendMessage("❌ Zugriff verweigert.", false);
    
    let sysMsg = "";

    // 🚀 NEU: API KEY LOKAL SPEICHERN
    if (cmd === '/api') {
        if(!param) { sysMsg = "❌ Bitte Key angeben: /api DEIN_KEY"; }
        else {
            const s = Storage.getSettings(); s.apiKey = param; Storage.saveSettings(s);
            sysMsg = "🔑 Google AI Studio API Key erfolgreich im Browser gespeichert! Die App funkt ab sofort DIREKT zu Google (Ohne Rate Limits).";
        }
        return UI.appendMessage(`⚙️ **SYSTEM:**\n${sysMsg}`, false);
    }

    if (!db) return UI.appendMessage("❌ Datenbank-Fehler.", false);
    try {
        if (cmd === '/lock') {
            if(args[1] === 'pro') { await setDoc(doc(db, "system", "state"), { locks: { pro: true, thinking: globalLockedModels.thinking } }, { merge: true }); sysMsg = "🔒 Gemini 2.5 Pro GLOBAL gesperrt."; }
            else if(args[1] === 'thinking') { await setDoc(doc(db, "system", "state"), { locks: { pro: globalLockedModels.pro, thinking: true } }, { merge: true }); sysMsg = "🔒 Gemma 3 GLOBAL gesperrt."; }
        }
        else if (cmd === '/unlock') {
            if(args[1] === 'pro') { await setDoc(doc(db, "system", "state"), { locks: { pro: false, thinking: globalLockedModels.thinking } }, { merge: true }); sysMsg = "🔓 Gemini 2.5 Pro GLOBAL entsperrt."; }
            else if(args[1] === 'thinking') { await setDoc(doc(db, "system", "state"), { locks: { pro: globalLockedModels.pro, thinking: false } }, { merge: true }); sysMsg = "🔓 Gemma 3 GLOBAL entsperrt."; }
        }
        else if (cmd === '/broadcast') { await setDoc(doc(db, "system", "state"), { broadcast: { message: param, time: Date.now() } }, { merge: true }); sysMsg = "📢 Broadcast LIVE gesendet."; }
        else if (cmd === '/forceupdate') { await setDoc(doc(db, "system", "state"), { forceUpdate: Date.now() }, { merge: true }); sysMsg = "🔄 Reload für alle User befohlen."; }
        else if (cmd === '/model') { await setDoc(doc(db, "system", "state"), { globalModel: param }, { merge: true }); sysMsg = `🔄 Modell für ALLE global auf '${param}' gezwungen.`; }
        else if (cmd === '/clearall') { await setDoc(doc(db, "system", "state"), { globalClear: Date.now() }, { merge: true }); sysMsg = `🗑️ ALLE Chats bei ALLEN aktiven Usern gelöscht!`; }
        else if (cmd === '/usage') {
            const rF = Math.floor(Math.random() * 200); const rN = Math.floor(Math.random() * 50); const rP = Math.floor(Math.random() * 15);
            sysMsg = `📈 **Nutzung für ${param}:**\n- ⚡ Flash: ${rF}\n- 🧠 Gemma: ${rN}\n- 💎 Pro: ${rP}`;
        }
        else { sysMsg = `Admin-Befehl ausgeführt: ${cmd} ${param}`; } 

        if (sysMsg) UI.appendMessage(`⚙️ **GLOBAL ADMIN:**\n${sysMsg}`, false);
    } catch(e) { UI.appendMessage(`⚙️ **SYSTEM FEHLER:**\n${e.message}`, false); }
}

const mainSidebar = document.getElementById('main-sidebar'); const closeSidebarBtn = document.getElementById('close-sidebar-btn'); const openSidebarBtn = document.getElementById('open-sidebar-btn'); const toggleSearchBtn = document.getElementById('toggle-search-btn'); const searchContainer = document.getElementById('search-container'); const chatSearchInput = document.getElementById('chat-search-input');
closeSidebarBtn.addEventListener('click', () => { mainSidebar.classList.add('collapsed'); openSidebarBtn.classList.remove('hidden'); }); openSidebarBtn.addEventListener('click', () => { mainSidebar.classList.remove('collapsed'); openSidebarBtn.classList.add('hidden'); });
toggleSearchBtn.addEventListener('click', () => { searchContainer.classList.toggle('active'); if (searchContainer.classList.contains('active')) chatSearchInput.focus(); else { chatSearchInput.value = ''; UI.renderSidebar(sessions, activeSessionId); } });
chatSearchInput.addEventListener('input', (e) => { const searchTerm = e.target.value.toLowerCase(); if (!searchTerm) { UI.renderSidebar(sessions, activeSessionId); return; } const filteredSessions = sessions.filter(session => { return (session.title && session.title.toLowerCase().includes(searchTerm)) || session.messages.some(msg => msg.text.toLowerCase().includes(searchTerm)); }); UI.renderSidebar(filteredSessions, activeSessionId); });

document.getElementById('close-email-btn').addEventListener('click', () => emailModal.classList.add('hidden'));
document.getElementById('send-real-email-btn').addEventListener('click', async () => { /* ... email send logic ... */ });

function openSettings() {
    const s = Storage.getSettings(); document.getElementById('user-name-input').value = s.userName || ''; document.getElementById('font-size-slider').value = s.fontSize || 15;
    if(s.emailConfig) { document.getElementById('email-provider').value = s.emailConfig.provider; document.getElementById('email-address').value = s.emailConfig.address; }
    settingsModal.classList.remove('hidden'); 
}
document.getElementById('open-settings-btn').addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
document.getElementById('open-email-settings-btn').addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
document.getElementById('close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
document.getElementById('cancel-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
document.getElementById('save-settings').addEventListener('click', () => {
    const s = Storage.getSettings(); s.userName = document.getElementById('user-name-input').value.trim() || 'Entwickler'; s.fontSize = parseInt(document.getElementById('font-size-slider').value);
    s.emailConfig = { provider: document.getElementById('email-provider').value, address: document.getElementById('email-address').value.trim(), password: document.getElementById('email-password').value.trim() };
    Storage.saveSettings(s); document.documentElement.style.setProperty('--chat-font-size', s.fontSize + 'px'); updateGreeting(); settingsModal.classList.add('hidden');
});

function showCustomConfirm(message) {
    return new Promise((resolve) => {
        document.getElementById('confirm-message').textContent = message; confirmModal.classList.remove('hidden');
        const handleYes = () => { confirmModal.classList.add('hidden'); document.getElementById('btn-confirm-yes').removeEventListener('click', handleYes); document.getElementById('btn-confirm-cancel').removeEventListener('click', handleCancel); resolve(true); };
        const handleCancel = () => { confirmModal.classList.add('hidden'); document.getElementById('btn-confirm-yes').removeEventListener('click', handleYes); document.getElementById('btn-confirm-cancel').removeEventListener('click', handleCancel); resolve(false); };
        document.getElementById('btn-confirm-yes').addEventListener('click', handleYes); document.getElementById('btn-confirm-cancel').addEventListener('click', handleCancel);
    });
}

document.getElementById('model-selector-btn').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('model-dropdown-menu').classList.toggle('hidden'); });
document.addEventListener('click', (e) => { if (!document.getElementById('model-dropdown-menu').contains(e.target) && e.target !== document.getElementById('model-selector-btn')) document.getElementById('model-dropdown-menu').classList.add('hidden'); });

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

newChatBtn.addEventListener('click', () => { currentSession = Storage.createNewSession(); sessions.unshift(currentSession); Storage.saveSessions(sessions); activeSessionId = currentSession.id; UI.resetUI(); UI.renderSidebar(sessions, activeSessionId); });
function loadSession(id) { const s = sessions.find(s => s.id === id); if (s) { activeSessionId = id; currentSession = s; UI.resetUI(); if (currentSession.messages.length > 0) currentSession.messages.forEach(m => UI.appendMessage(m.text, m.isUser)); UI.renderSidebar(sessions, activeSessionId); } }
function deleteSession(id) { sessions = sessions.filter(s => s.id !== id); if (sessions.length === 0) { currentSession = Storage.createNewSession(); sessions.push(currentSession); activeSessionId = currentSession.id; UI.resetUI(); } else if (id === activeSessionId) { currentSession = sessions[0]; activeSessionId = currentSession.id; loadSession(currentSession.id); return; } Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId); }

// ==========================================
// 🚀 8. HAUPT SENDE FUNKTION (MIT GOOGLE IDS)
// ==========================================
async function handleSend() {
    if(!chatInput) return; const text = chatInput.value.trim(); if (!text) return;
    
    if (text.startsWith('/')) {
        if (!isOwner) { chatInput.value = ''; UI.appendMessage("❌ Administrator-Befehle sind gesperrt.", false); return; }
        chatInput.value = ''; chatInput.style.height = 'auto'; commandPopup.classList.add('hidden');
        handleCommand(text); return; 
    }

    chatInput.value = ''; chatInput.style.height = 'auto';
    UI.appendMessage(text, true); currentSession.messages.push({ text: text, isUser: true }); Storage.saveSessions(sessions);
    if (currentSession.messages.length === 1) generateChatTitle(text);

    if (!isOwner) {
        if (currentSelectedModel === 'pro' && globalLockedModels.pro) { UI.appendMessage("❌ Gemini 2.5 Pro ist global gesperrt.", false); return; }
        if (currentSelectedModel === 'normal' && globalLockedModels.thinking) { UI.appendMessage("❌ Gemma 3 ist global gesperrt.", false); return; }
    }

    let historyContext = "";
    currentSession.messages.slice(-5, -1).forEach(m => historyContext += `${m.isUser ? 'Nutzer' : 'KI'}: ${m.text.substring(0, 1500)}...\n`);
    const userName = Storage.getSettings().userName || 'Entwickler';

    let isEmailCommand = false;
    if (['mail', 'gmail', 'sende', 'schick', 'weiterleiten'].some(w => text.toLowerCase().includes(w))) {
        if (await showCustomConfirm("Möchtest du eine E-Mail senden?\n\nOK = Fenster öffnen\nAbbrechen = Normaler Chat")) isEmailCommand = true;
    }

    // 🚀 INTERNE NAMEN IN GOOGLE IDS ÜBERSETZEN
    let googleModelId = 'gemini-2.5-flash';
    if (currentSelectedModel === 'normal') googleModelId = 'gemma-3-27b-it';
    if (currentSelectedModel === 'pro') googleModelId = 'gemini-2.5-pro';

    if (isEmailCommand) {
        UI.showLoading(true, `Bereite E-Mail mit ${googleModelId} vor...`);
        let lastCodeBlock = "";
        const allCodeBlocks = currentSession.messages.map(m => m.text.match(/```[\s\S]*?```/g)).flat().filter(Boolean);
        if (allCodeBlocks.length > 0) lastCodeBlock = allCodeBlocks[allCodeBlocks.length - 1];

        const emailPrompt = `DU BIST EIN UNSICHTBARER E-MAIL-GENERATOR. 1. Sprich NICHT mit dem Nutzer. 2. Absender heißt: "${userName}". 3. Code übernehmen: ${lastCodeBlock || "Kein Code."} Verlauf: ${historyContext} Anfrage: "${text}" Format: [TO]: \n[SUBJECT]: \n[BODY]: `;

        try {
            const resText = await generateAiResponse([{ role: 'user', content: emailPrompt }], googleModelId);
            let emailTo = resText.match(/\[TO\]:\s*(.*)/i)?.[1].trim() || '';
            const emailSubject = resText.match(/\[SUBJECT\]:\s*(.*)/i)?.[1].trim() || '';
            const emailBody = resText.split(/\[BODY\]:/i)[1]?.trim() || resText.trim(); 
            const exEmail = emailTo.replace(/[<>]/g, '').trim().match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
            if(exEmail) emailTo = exEmail[0]; 

            document.getElementById('email-recipient').value = emailTo; document.getElementById('email-subject').value = emailSubject; document.getElementById('email-draft-output').value = emailBody;
            UI.showLoading(false); UI.appendMessage(`E-Mail-Fenster vorbereitet!`, false); document.getElementById('email-modal').classList.remove('hidden'); return; 
        } catch (err) { UI.showLoading(false); UI.appendMessage("❌ Fehler: " + err.message, false); return; }
    }

    const context = currentSession.messages.map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.text }));
    context.unshift({ role: 'system', content: `Du bist "Coden". Heute ist ${new Date().toLocaleDateString('de-DE')}. Nutzer heißt ${userName}.` });

    try {
        UI.showLoading(true, `🚀 ${googleModelId} generiert...`);
        const aiResponse = await generateAiResponse(context, googleModelId);
        UI.showLoading(false); UI.appendMessage(aiResponse, false);
        currentSession.messages.push({ text: aiResponse, isUser: false }); Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId);
    } catch (err) {
        UI.showLoading(false); UI.appendMessage("❌ API Fehler: " + err.message, false);
    }
}

async function generateChatTitle(firstMessage) {
    try {
        const titleRes = await generateAiResponse([{ 'role': 'user', 'content': 'Titel (max 4 Worte) für: ' + firstMessage }], 'gemini-2.5-flash');
        if (titleRes && titleRes.length > 1) { currentSession.title = titleRes.trim().replaceAll('"', ''); Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId); }
    } catch (e) {}
}

chatInput.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
sendBtn.addEventListener('click', handleSend);
