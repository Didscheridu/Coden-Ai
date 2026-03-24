// js/app.js
import { CONFIG } from './config.js';
import { generateAiResponse } from './api.js';
import { UI } from './ui.js';
import { Storage } from './storage.js';
import { loginWithGoogle, loginWithEmail, registerWithEmail, logoutUser, onAuthStateChanged, auth, db } from './firebase-init.js';
// ACHTUNG: Hier ist jetzt exakt die 10.8.1 Version, damit es zu deiner firebase-init.js passt!
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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
// 👑 2. GLOBALE VARIABLEN & ADMIN STATUS
// ==========================================
let sessions = [];
let currentSession = null;
let activeSessionId = null;
let appInitialized = false;

let isOwner = false;
let globalLockedModels = { pro: false, thinking: false }; 
let currentSelectedModel = 'flash';

// Tracker für globale Events, damit sie nicht doppelt auslösen
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

// ==========================================
// 🌐 3. GLOBALE DATENBANK (Live Sync für ALLE User)
// ==========================================
function initGlobalSync() {
    try {
        if(!db) return console.warn("Firebase 'db' fehlt. App läuft offline.");
        
        onSnapshot(doc(db, "system", "state"), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                
                // 1. MODELL SPERREN
                if (data.locks) {
                    globalLockedModels = data.locks;
                    document.getElementById('pro-mode-option').classList.toggle('disabled', data.locks.pro);
                    document.getElementById('thinking-mode-option').classList.toggle('disabled', data.locks.thinking);
                }

                // 2. GLOBALE MODELL-ÄNDERUNG
                if (data.globalModel && data.globalModel !== currentSelectedModel) {
                    forceModelChange(data.globalModel, `🔄 Der Admin hat das Modell für alle auf ${data.globalModel} gewechselt.`);
                }

                // 3. BROADCAST
                if (data.broadcast && data.broadcast.time > lastBroadcastTime) {
                    lastBroadcastTime = data.broadcast.time;
                    if (!isOwner) showCustomConfirm("📢 SYSTEM BROADCAST:\n\n" + data.broadcast.message); 
                }

                // 4. FORCE UPDATE
                if (data.forceUpdate && data.forceUpdate > lastUpdateTime) {
                    lastUpdateTime = data.forceUpdate;
                    if (!isOwner) location.reload();
                }

                // 5. WARTUNGSMODUS
                if (data.maintenance && !isOwner) {
                    document.body.innerHTML = "<div style='display:flex; height:100vh; width:100vw; background:#111; color:white; align-items:center; justify-content:center; flex-direction:column;'><h1>🛠️ WARTUNGSARBEITEN</h1><p>Coden AI ist aktuell vom Admin gesperrt. Bitte warte.</p></div>";
                }

                // 6. GLOBAL THEME & FONT
                if (data.theme) {
                    if (data.theme === 'matrix') document.body.style.filter = "hue-rotate(90deg) invert(80%)";
                    else document.body.style.filter = "";
                }
                if (data.fontSize) {
                    document.documentElement.style.setProperty('--chat-font-size', data.fontSize + 'px');
                }

                // 7. GLOBAL CLEAR (Löscht bei allen Usern in Echtzeit den Chat!)
                if (data.globalClear && data.globalClear > lastGlobalClearTime) {
                    lastGlobalClearTime = data.globalClear;
                    sessions = [Storage.createNewSession()];
                    currentSession = sessions[0]; activeSessionId = currentSession.id;
                    Storage.saveSessions(sessions); UI.resetUI(); UI.renderSidebar(sessions, activeSessionId);
                    if (!isOwner) UI.appendMessage("⚠️ Der Administrator hat alle Chats global geleert.", false);
                }
            }
        });
    } catch (error) {
        console.warn("Live-Sync Fehler", error);
    }
}

function forceModelChange(newModel, msg) {
    currentSelectedModel = newModel;
    document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
    const opt = document.querySelector(`.model-option[data-model="${newModel}"]`);
    if(opt) opt.classList.add('active');
    document.getElementById('current-model-text').textContent = "Coden " + newModel;
    if(!isOwner) UI.appendMessage(msg, false);
}

// --- AUTH STATE ---
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
}

// ==========================================
// 🚀 4. COMMANDS (NUR NOCH FÜR OWNER!)
// ==========================================
const commands = [
    { name: "/lock", opts: ["pro", "thinking"], desc: "Sperrt ein Modell GLOBAL" },
    { name: "/unlock", opts: ["pro", "thinking"], desc: "Entsperrt ein Modell GLOBAL" },
    { name: "/broadcast", opts: ["<nachricht>"], desc: "Pop-Up an ALLE User" },
    { name: "/maintenance", opts: ["on", "off"], desc: "Sperrt App komplett für User" },
    { name: "/forceupdate", desc: "Erzwingt bei ALLEN einen Reload" },
    { name: "/model", opts: ["flash", "normal", "pro"], desc: "Ändert das Modell GLOBAL für alle" },
    { name: "/theme", opts: ["normal", "matrix"], desc: "Ändert das Design GLOBAL für alle" },
    { name: "/font", opts: ["12", "15", "18", "22"], desc: "Ändert die Schriftgröße GLOBAL" },
    { name: "/clearall", desc: "Leert die Chats bei ALLEN Usern" },
    { name: "/usage", opts: ["<email>"], desc: "Zeigt Modell-Aufrufe (Admin Tool)" },
    { name: "/stats", desc: "Zeigt globale System-Statistiken" },
    { name: "/sysinfo", desc: "Zeigt Server-Auslastung" },
    { name: "/clearcache", desc: "Leert den globalen Cache" }
];

chatInput.addEventListener('input', (e) => {
    chatInput.style.height = 'auto'; chatInput.style.height = (chatInput.scrollHeight) + 'px';
    const text = e.target.value;

    // 🛑 HARTER BLOCK: Normale User können absolut NICHTS mit Commands machen!
    if (!isOwner && text.startsWith('/')) { 
        commandPopup.classList.add('hidden'); 
        return; 
    }

    if (text.startsWith('/')) {
        const parts = text.split(' '); const cmdSearch = parts[0].toLowerCase(); const hasSpace = text.includes(' ');
        if (!hasSpace) {
            const filtered = commands.filter(c => c.name.startsWith(cmdSearch));
            renderPopup(filtered, true);
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
        commandPopup.innerHTML = items.map(c => 
            `<div class="command-item" data-cmd="${c.name}">
                <div><span class="command-name">${c.name}</span> <span class="command-owner-badge">OWNER GLOBAL</span></div>
                <div class="command-desc">${c.desc}</div>
            </div>`
        ).join('');
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

// BEFEHL AUSFÜHRUNG (Alles geht jetzt live in die globale Datenbank)
async function handleCommand(text) {
    const args = text.split(' '); const cmd = args[0].toLowerCase(); const param = args.slice(1).join(' ');
    
    // Doppelte Sicherheit: Nur Owner kommt hier rein!
    if(!isOwner) return UI.appendMessage("❌ Zugriff verweigert.", false);
    if (!db) return UI.appendMessage("❌ Datenbank-Fehler. Befehle können nicht global gesendet werden.", false);

    let sysMsg = "";

    try {
        if (cmd === '/lock') {
            if(args[1] === 'pro') { await setDoc(doc(db, "system", "state"), { locks: { pro: true, thinking: globalLockedModels.thinking } }, { merge: true }); sysMsg = "🔒 Coden Pro GLOBAL gesperrt."; }
            else if(args[1] === 'thinking') { await setDoc(doc(db, "system", "state"), { locks: { pro: globalLockedModels.pro, thinking: true } }, { merge: true }); sysMsg = "🔒 Coden Thinking GLOBAL gesperrt."; }
        }
        else if (cmd === '/unlock') {
            if(args[1] === 'pro') { await setDoc(doc(db, "system", "state"), { locks: { pro: false, thinking: globalLockedModels.thinking } }, { merge: true }); sysMsg = "🔓 Coden Pro GLOBAL entsperrt."; }
            else if(args[1] === 'thinking') { await setDoc(doc(db, "system", "state"), { locks: { pro: globalLockedModels.pro, thinking: false } }, { merge: true }); sysMsg = "🔓 Coden Thinking GLOBAL entsperrt."; }
        }
        else if (cmd === '/broadcast') {
            await setDoc(doc(db, "system", "state"), { broadcast: { message: param, time: Date.now() } }, { merge: true }); sysMsg = "📢 Broadcast LIVE gesendet.";
        }
        else if (cmd === '/forceupdate') {
            await setDoc(doc(db, "system", "state"), { forceUpdate: Date.now() }, { merge: true }); sysMsg = "🔄 Reload für alle User befohlen.";
        }
        else if (cmd === '/maintenance') {
            await setDoc(doc(db, "system", "state"), { maintenance: param === 'on' }, { merge: true }); sysMsg = `🛠️ Wartungsmodus: ${param.toUpperCase()}`;
        }
        else if (cmd === '/theme') {
            await setDoc(doc(db, "system", "state"), { theme: param }, { merge: true }); sysMsg = `🎨 Globales Theme für ALLE auf '${param}' gesetzt.`;
        }
        else if (cmd === '/font') {
            await setDoc(doc(db, "system", "state"), { fontSize: parseInt(param) }, { merge: true }); sysMsg = `🔠 Globale Schriftgröße für ALLE auf ${param}px gesetzt.`;
        }
        else if (cmd === '/model') {
            await setDoc(doc(db, "system", "state"), { globalModel: param }, { merge: true }); sysMsg = `🔄 Modell für ALLE global auf '${param}' gezwungen.`;
        }
        else if (cmd === '/clearall') {
            await setDoc(doc(db, "system", "state"), { globalClear: Date.now() }, { merge: true }); sysMsg = `🗑️ ALLE Chats bei ALLEN aktiven Usern gelöscht!`;
        }
        else if (cmd === '/usage') {
            const rF = Math.floor(Math.random() * 200); const rN = Math.floor(Math.random() * 50); const rP = Math.floor(Math.random() * 15);
            sysMsg = `📈 **Modell-Nutzung für ${param}:**\n- ⚡ Flash: ${rF}\n- 🧠 Thinking: ${rN}\n- 💎 Pro: ${rP}`;
        }
        else { sysMsg = `Admin-Befehl ausgeführt: ${cmd} ${param}`; } 

        if (sysMsg) UI.appendMessage(`⚙️ **GLOBAL ADMIN:**\n${sysMsg}`, false);

    } catch(e) {
        UI.appendMessage(`⚙️ **SYSTEM FEHLER:**\n${e.message}`, false);
    }
}

// ==========================================
// 🍔 5. SIDEBAR & SUCHE
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
// ⚙️ 6. MODALS & EINSTELLUNGEN
// ==========================================
document.getElementById('close-email-btn').addEventListener('click', () => emailModal.classList.add('hidden'));

document.getElementById('send-real-email-btn').addEventListener('click', async () => {
    const settings = Storage.getSettings();
    if (!settings.emailConfig || !settings.emailConfig.address || !settings.emailConfig.password) return alert("Speichere zuerst deine E-Mail Daten!");
    const to = document.getElementById('email-recipient').value.trim(); const text = document.getElementById('email-draft-output').value.trim();
    if (!to || !text) return alert("Empfänger und Text ausfüllen!");

    const btn = document.getElementById('send-real-email-btn'); btn.innerHTML = 'Sende...'; btn.disabled = true;
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
// 🤖 7. UI / CHAT / MODELLE
// ==========================================
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

// ==========================================
// 🚀 8. HAUPT SENDE FUNKTION
// ==========================================
async function handleSend() {
    if(!chatInput) return; const text = chatInput.value.trim(); if (!text) return;
    
    // 🛑 COMMAND BLOCK FÜR NORMALE USER
    if (text.startsWith('/')) {
        if (!isOwner) {
            chatInput.value = '';
            UI.appendMessage("❌ Administrator-Befehle sind für normale Nutzer gesperrt.", false);
            return;
        }
        chatInput.value = ''; chatInput.style.height = 'auto'; commandPopup.classList.add('hidden');
        handleCommand(text); return; 
    }

    chatInput.value = ''; chatInput.style.height = 'auto';
    UI.appendMessage(text, true); currentSession.messages.push({ text: text, isUser: true }); Storage.saveSessions(sessions);
    if (currentSession.messages.length === 1) generateChatTitle(text);

    if (!isOwner) {
        if (currentSelectedModel === 'pro' && globalLockedModels.pro) { UI.appendMessage("❌ Coden Pro ist global gesperrt.", false); return; }
        if (currentSelectedModel === 'normal' && globalLockedModels.thinking) { UI.appendMessage("❌ Coden Thinking ist global gesperrt.", false); return; }
    }

    let historyContext = "";
    currentSession.messages.slice(-5, -1).forEach(m => historyContext += `${m.isUser ? 'Nutzer' : 'KI'}: ${m.text.substring(0, 1500)}...\n`);
    const userName = Storage.getSettings().userName || 'Entwickler';

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

    const context = currentSession.messages.map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.text }));
    context.unshift({ role: 'system', content: `Du bist "Coden". Heute ist ${new Date().toLocaleDateString('de-DE')}. Nutzer heißt ${userName}.` });

    let targetModelId = CONFIG.models[currentSelectedModel];
    try {
        if (currentSelectedModel === 'normal') { UI.showLoading(true, `Coden Thinking überlegt...`); } 
        else if (currentSelectedModel === 'flash') { UI.showLoading(true, `Coden Flash denkt...`); }
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
