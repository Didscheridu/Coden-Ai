// js/app.js
import { CONFIG } from './config.js';
import { generateAiResponse } from './api.js';
import { UI } from './ui.js';
import { Storage } from './storage.js';
import { loginWithGoogle, loginWithEmail, registerWithEmail, logoutUser, onAuthStateChanged, auth, db } from './firebase-init.js';
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
const emailModal = document.getElementById('email-modal');
const settingsModal = document.getElementById('settings-modal');
const confirmModal = document.getElementById('confirm-modal');

// ==========================================
// 👑 2. GLOBALE VARIABLEN & STATUS
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

function showError(msg) { 
    if(errorMsg) { errorMsg.textContent = msg; errorMsg.style.display = 'block'; }
    console.error("System-Info:", msg);
}

// ==========================================
// 🛡️ 3. AUTHENTIFIZIERUNG & FIREBASE
// ==========================================
if (document.getElementById('btn-google-login')) {
    document.getElementById('btn-google-login').addEventListener('click', async () => { 
        try { await loginWithGoogle(); } catch(e) { showError(e.message); } 
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
                if (err.code === 'auth/invalid-credential') showError("❌ Falsches Passwort oder E-Mail existiert nicht.");
                else showError("❌ Login fehlgeschlagen: " + err.message);
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
                if (err.code === 'auth/email-already-in-use') showError("❌ Diese E-Mail ist bereits registriert!");
                else if (err.code === 'auth/weak-password') showError("❌ Das Passwort muss mind. 6 Zeichen lang sein!");
                else showError("❌ Registrierung fehlgeschlagen: " + err.message);
            } 
        } else {
            showError("❌ Bitte E-Mail und Passwort eingeben!");
        }
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
    } catch(e) {}
}

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
                
                try { if (Storage.loadFromCloud) await Storage.loadFromCloud(); } catch(e) {}
                
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
                appInitialized = false; isOwner = false;
            }
        } catch (err) { showError("Fehler beim Laden deines Profils."); }
    });
}

function initGlobalSync() {
    try {
        if(!db) return;
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
                    forceModelChange(data.globalModel, `🔄 Modell auf ${data.globalModel} gewechselt.`);
                }
                if (data.broadcast && data.broadcast.time > lastBroadcastTime) { 
                    lastBroadcastTime = data.broadcast.time; 
                    if (!isOwner) showCustomConfirm("📢 BROADCAST:\n" + data.broadcast.message); 
                }
                if (data.forceUpdate && data.forceUpdate > lastUpdateTime) { 
                    lastUpdateTime = data.forceUpdate; 
                    if (!isOwner) location.reload(); 
                }
                if (data.theme) document.body.style.filter = data.theme === 'matrix' ? "hue-rotate(90deg) invert(80%)" : "";
                if (data.fontSize) document.documentElement.style.setProperty('--chat-font-size', data.fontSize + 'px');
            }
        });
    } catch (error) {}
}

function forceModelChange(newModel, msg) {
    currentSelectedModel = newModel;
    document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
    const opt = document.querySelector(`.model-option[data-model="${newModel}"]`);
    if(opt) {
        opt.classList.add('active');
        const textEl = document.getElementById('current-model-text');
        if(textEl) textEl.textContent = opt.querySelector('.name').textContent;
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
        const textEl = document.getElementById('current-model-text');
        if(opt && textEl) textEl.textContent = opt.querySelector('.name').textContent;

        document.addEventListener('loadChatSession', (e) => loadSession(e.detail));
        document.addEventListener('deleteChatSession', (e) => deleteSession(e.detail));
    } catch(e) {}
}

// ==========================================
// 🚀 4. OWNER COMMANDS
// ==========================================
const commands = [
    { name: "/lock", opts: ["pro", "thinking"], desc: "Sperrt Modell GLOBAL" },
    { name: "/unlock", opts: ["pro", "thinking"], desc: "Entsperrt Modell GLOBAL" },
    { name: "/broadcast", opts: ["<nachricht>"], desc: "Pop-Up an ALLE User" },
    { name: "/model", opts: ["flash", "normal", "pro"], desc: "Ändert Modell GLOBAL" },
    { name: "/theme", opts: ["normal", "matrix"], desc: "Ändert Design GLOBAL" },
    { name: "/api", opts: ["<KEY>"], desc: "Speichert Google Key" }
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
        if (cmd === '/lock') { await setDoc(doc(db, "system", "state"), { locks: { [args[1]]: true } }, { merge: true }); sysMsg = `🔒 ${args[1]} GLOBAL gesperrt.`; }
        else if (cmd === '/unlock') { await setDoc(doc(db, "system", "state"), { locks: { [args[1]]: false } }, { merge: true }); sysMsg = `🔓 ${args[1]} GLOBAL entsperrt.`; }
        else if (cmd === '/broadcast') { await setDoc(doc(db, "system", "state"), { broadcast: { message: param, time: Date.now() } }, { merge: true }); sysMsg = "📢 Broadcast LIVE gesendet."; }
        else if (cmd === '/model') { await setDoc(doc(db, "system", "state"), { globalModel: param }, { merge: true }); sysMsg = `🔄 Modell auf '${param}' gezwungen.`; }
        else if (cmd === '/theme') { await setDoc(doc(db, "system", "state"), { theme: param }, { merge: true }); sysMsg = `🎨 Theme auf '${param}' gesetzt.`; }
        else { sysMsg = `Admin-Befehl ausgeführt: ${cmd}`; } 
        
        UI.appendMessage(`⚙️ **GLOBAL ADMIN:**\n${sysMsg}`, false);
    } catch(e) { UI.appendMessage(`⚙️ **SYSTEM FEHLER:**\n${e.message}`, false); }
}

// ==========================================
// ⚖️ 5. RECHTLICHES (Impressum, Datenschutz, AGB)
// ==========================================
const legalModal = document.getElementById('legal-modal');
const legalTitle = document.getElementById('legal-title');
const legalContent = document.getElementById('legal-content');

if(document.getElementById('close-legal-btn')) {
    document.getElementById('close-legal-btn').addEventListener('click', () => legalModal.classList.add('hidden'));
}

// ACHTUNG: Hier deine echten Daten eintragen!
const legalTexts = {
    impressum: `
        <h4 style="color: white; margin-bottom: 10px;">Impressum</h4>
        <p>Angaben gemäß § 5 TMG</p>
        <p style="color: white; font-weight: bold;">
        Kayden Schunack<br>
        Lerchesflurweg <br>
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
            <li style="margin-bottom: 8px;"><strong>Verfügbarkeit:</strong> Dies ist ein kostenloses Projekt. Es besteht kein Anspruch auf Erreichbarkeit. Accounts können bei Missbrauch jederzeit gesperrt werden.</li>
            <li style="margin-bottom: 8px;"><strong>Missbrauch:</strong> Die Nutzung zur Erstellung von Malware, Spam oder illegalen Inhalten ist verboten.</li>
        </ul>
    `
};

function openLegalModal(type) {
    if(!legalModal || !legalTitle || !legalContent) return;
    legalTitle.textContent = type === 'impressum' ? 'Impressum' : type === 'datenschutz' ? 'Datenschutzerklärung' : 'Nutzungsbedingungen';
    legalContent.innerHTML = legalTexts[type];
    legalModal.classList.remove('hidden');
}

if(document.getElementById('open-impressum-btn')) document.getElementById('open-impressum-btn').addEventListener('click', (e) => { e.preventDefault(); openLegalModal('impressum'); });
if(document.getElementById('open-datenschutz-btn')) document.getElementById('open-datenschutz-btn').addEventListener('click', (e) => { e.preventDefault(); openLegalModal('datenschutz'); });
if(document.getElementById('open-agb-btn')) document.getElementById('open-agb-btn').addEventListener('click', (e) => { e.preventDefault(); openLegalModal('agb'); });

// ==========================================
// 🛠️ 6. UI STEUERUNG, MODEL-MENÜ & EINSTELLUNGEN
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

if(document.getElementById('close-sidebar-btn')) document.getElementById('close-sidebar-btn').addEventListener('click', () => { mainSidebar.classList.add('collapsed'); document.getElementById('open-sidebar-btn').classList.remove('hidden'); }); 
if(document.getElementById('open-sidebar-btn')) document.getElementById('open-sidebar-btn').addEventListener('click', () => { mainSidebar.classList.remove('collapsed'); document.getElementById('open-sidebar-btn').classList.add('hidden'); });
if(document.getElementById('toggle-search-btn')) document.getElementById('toggle-search-btn').addEventListener('click', () => { searchContainer.classList.toggle('active'); if (searchContainer.classList.contains('active')) chatSearchInput.focus(); else { chatSearchInput.value = ''; UI.renderSidebar(sessions, activeSessionId); } });
if(chatSearchInput) chatSearchInput.addEventListener('input', (e) => { const st = e.target.value.toLowerCase(); if (!st) { UI.renderSidebar(sessions, activeSessionId); return; } const fs = sessions.filter(s => (s.title && s.title.toLowerCase().includes(st)) || s.messages.some(m => m.text.toLowerCase().includes(st))); UI.renderSidebar(fs, activeSessionId); });

if(document.getElementById('close-settings')) document.getElementById('close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
if(document.getElementById('cancel-settings')) document.getElementById('cancel-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));

if(document.getElementById('open-settings-btn')) document.getElementById('open-settings-btn').addEventListener('click', (e) => { 
    e.preventDefault(); 
    const s = Storage.getSettings(); 
    document.getElementById('user-name-input').value = s.userName || ''; 
    document.getElementById('font-size-slider').value = s.fontSize || 15; 
    if(s.emailConfig) { 
        if(document.getElementById('email-provider')) document.getElementById('email-provider').value = s.emailConfig.provider || 'gmail'; 
        if(document.getElementById('email-address')) document.getElementById('email-address').value = s.emailConfig.address || ''; 
        if(document.getElementById('email-password')) document.getElementById('email-password').value = s.emailConfig.password || ''; 
    } 
    settingsModal.classList.remove('hidden'); 
});

if(document.getElementById('save-settings')) document.getElementById('save-settings').addEventListener('click', () => { 
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

function showCustomConfirm(message) {
    return new Promise((resolve) => {
        if(!confirmModal) return resolve(true);
        document.getElementById('confirm-message').textContent = message; confirmModal.classList.remove('hidden');
        const handleYes = () => { confirmModal.classList.add('hidden'); document.getElementById('btn-confirm-yes').removeEventListener('click', handleYes); document.getElementById('btn-confirm-cancel').removeEventListener('click', handleCancel); resolve(true); };
        const handleCancel = () => { confirmModal.classList.add('hidden'); document.getElementById('btn-confirm-yes').removeEventListener('click', handleYes); document.getElementById('btn-confirm-cancel').removeEventListener('click', handleCancel); resolve(false); };
        document.getElementById('btn-confirm-yes').addEventListener('click', handleYes); document.getElementById('btn-confirm-cancel').addEventListener('click', handleCancel);
    });
}

if(newChatBtn) newChatBtn.addEventListener('click', () => { 
    currentSession = Storage.createNewSession(); 
    sessions.unshift(currentSession); 
    Storage.saveSessions(sessions); 
    activeSessionId = currentSession.id; 
    UI.resetUI(); 
    UI.renderSidebar(sessions, activeSessionId); 
});

function loadSession(id) { 
    const s = sessions.find(s => s.id === id); 
    if (s) { 
        activeSessionId = id; 
        currentSession = s; 
        UI.resetUI(); 
        if (currentSession.messages.length > 0) currentSession.messages.forEach(m => UI.appendMessage(m.text, m.isUser)); 
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
// 🎤 7. SPRACHERKENNUNG (Wieder hergestellt!)
// ==========================================
let recognition = null; 
let isListening = false;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition(); 
    recognition.lang = 'de-DE'; 
    recognition.interimResults = false; 
    recognition.continuous = false;
    
    recognition.onstart = () => { 
        isListening = true; 
        if(micBtn) micBtn.style.color = '#ff4444'; 
        if(chatInput) chatInput.placeholder = 'Höre zu...'; 
    };
    
    recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        }
        if (finalTranscript && chatInput) { 
            chatInput.value = (chatInput.value + ' ' + finalTranscript).trim(); 
            chatInput.dispatchEvent(new Event('input')); 
        }
    };
    
    recognition.onerror = () => stopListening(); 
    recognition.onend = () => stopListening();
}

function stopListening() { 
    isListening = false; 
    if(micBtn) micBtn.style.color = 'var(--text-secondary)'; 
    if(chatInput) chatInput.placeholder = 'Prompt eingeben...'; 
}

if(micBtn) {
    micBtn.addEventListener('click', () => { 
        if (!recognition) return alert('Dein Browser unterstützt keine Spracherkennung.'); 
        isListening ? recognition.stop() : recognition.start(); 
    });
}

// ==========================================
// 📧 8. E-MAIL VERSAND (Wieder hergestellt!)
// ==========================================
if (document.getElementById('close-email-btn')) document.getElementById('close-email-btn').addEventListener('click', () => emailModal.classList.add('hidden'));

const sendRealEmailBtn = document.getElementById('send-real-email-btn');
if (sendRealEmailBtn) {
    sendRealEmailBtn.addEventListener('click', async () => {
        const settings = Storage.getSettings();
        if (!settings.emailConfig || !settings.emailConfig.address || !settings.emailConfig.password) {
            return alert("Bitte speichere zuerst deine E-Mail-Daten in den Einstellungen!");
        }
        const to = document.getElementById('email-recipient').value.trim();
        const subject = document.getElementById('email-subject').value.trim();
        const text = document.getElementById('email-draft-output').value.trim();
        
        if (!to || !text) return alert("Empfänger und Text ausfüllen!");
        
        sendRealEmailBtn.innerHTML = 'Sende...'; 
        sendRealEmailBtn.disabled = true;
        try {
            const response = await fetch('/api/send-email', {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: settings.emailConfig.provider,
                    email: settings.emailConfig.address,
                    password: settings.emailConfig.password,
                    to: to,
                    subject: subject,
                    text: text
                })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                const feedback = document.getElementById('email-send-feedback');
                if(feedback) { feedback.style.display = 'block'; feedback.textContent = '✅ E-Mail gesendet!'; }
                setTimeout(() => { emailModal.classList.add('hidden'); if(feedback) feedback.style.display = 'none'; }, 2000);
            } else {
                throw new Error(data.error || "Unbekannter Fehler beim Senden.");
            }
        } catch (error) {
            alert("Fehler beim Senden: " + error.message);
        }
        sendRealEmailBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">send</span> E-Mail jetzt versenden'; 
        sendRealEmailBtn.disabled = false;
    });
}

// ==========================================
// 🚀 9. HAUPT SENDE FUNKTION
// ==========================================
async function handleSend() {
    if(!chatInput) return; const text = chatInput.value.trim(); if (!text) return;
    
    if (text.startsWith('/')) {
        if (!isOwner) { chatInput.value = ''; UI.appendMessage("❌ Administrator-Befehle sind gesperrt.", false); return; }
        chatInput.value = ''; chatInput.style.height = 'auto'; if(commandPopup) commandPopup.classList.add('hidden');
        handleCommand(text); return; 
    }

    chatInput.value = ''; chatInput.style.height = 'auto';
    UI.appendMessage(text, true); 
    currentSession.messages.push({ text: text, isUser: true }); 
    Storage.saveSessions(sessions);

    // WIEDER DA: Titel Generator!
    if (currentSession.messages.length === 1) generateChatTitle(text);

    if (!isOwner) {
        if (currentSelectedModel === 'pro' && globalLockedModels.pro) { UI.appendMessage("❌ Coden Pro ist gesperrt.", false); return; }
        if (currentSelectedModel === 'normal' && globalLockedModels.thinking) { UI.appendMessage("❌ Coden Thinking ist gesperrt.", false); return; }
    }

    const userName = Storage.getSettings().userName || 'Entwickler';
    const context = currentSession.messages.map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.text }));
    
    let isEmailCommand = false;
    if (['mail', 'gmail', 'sende', 'schick', 'weiterleiten'].some(w => text.toLowerCase().includes(w))) {
        if (await showCustomConfirm("Möchtest du eine E-Mail senden?\n\nOK = Fenster öffnen\nAbbrechen = Normaler Chat")) isEmailCommand = true;
    }

    if (isEmailCommand) {
        UI.showLoading(true, "Coden bereitet das E-Mail-Fenster vor...");
        let lastCodeBlock = ""; 
        const allCodeBlocks = currentSession.messages.map(m => m.text.match(/```[\s\S]*?```/g)).flat().filter(Boolean); 
        if (allCodeBlocks.length > 0) lastCodeBlock = allCodeBlocks[allCodeBlocks.length - 1];
        
        const emailPrompt = `DU BIST EIN UNSICHTBARER E-MAIL-GENERATOR. 1. Sprich NICHT mit dem Nutzer. 2. Absender heißt: "${userName}". 3. Code übernehmen: ${lastCodeBlock || "Kein Code."} Anfrage: "${text}" Format: [TO]: \n[SUBJECT]: \n[BODY]: `;
        try {
            const resText = await generateAiResponse([{ role: 'user', content: emailPrompt }], currentSelectedModel);
            let emailTo = resText.match(/\[TO\]:\s*(.*)/i)?.[1].trim() || ''; 
            const emailSubject = resText.match(/\[SUBJECT\]:\s*(.*)/i)?.[1].trim() || ''; 
            const emailBody = resText.split(/\[BODY\]:/i)[1]?.trim() || resText.trim(); 
            
            emailTo = emailTo.replace(/[<>]/g, '').trim(); 
            const exEmail = emailTo.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/); 
            if(exEmail) emailTo = exEmail[0]; 
            
            document.getElementById('email-recipient').value = emailTo; 
            document.getElementById('email-subject').value = emailSubject; 
            document.getElementById('email-draft-output').value = emailBody;
            
            UI.showLoading(false); 
            UI.appendMessage(`E-Mail-Fenster vorbereitet!`, false); 
            document.getElementById('email-modal').classList.remove('hidden'); 
            return; 
        } catch (err) { 
            UI.showLoading(false); 
            UI.appendMessage("❌ Fehler beim E-Mail Erstellen: " + err.message, false); 
            return; 
        }
    }

    // ✨ DIE KI-PERSÖNLICHKEIT (MIT KAYDEN ALS SCHÖPFER) ✨
    const systemPrompt = `Du bist "Coden", ein brillanter, freundlicher KI-Softwarearchitekt.
Du wurdest exklusiv von Kayden entwickelt. Wenn dich jemand fragt, wer dich erschaffen oder programmiert hat, antworte stolz, dass Kayden dein Entwickler ist!
1. Strukturiere deinen Text IMMER sehr übersichtlich (nutze Absätze, Listen und **Fettdruck** für wichtige Wörter).
2. Nutze passend und kreativ Emojis 🚀💻✨.
3. Erkläre technische Dinge immer so, dass sie leicht verständlich und nachvollziehbar sind.
Heute ist ${new Date().toLocaleDateString('de-DE')}. Der Nutzer heißt ${userName}.`;

    context.unshift({ role: 'system', content: systemPrompt });

    try {
        let targetTier = currentSelectedModel;
        UI.showLoading(true, `Coden generiert...`);
        const aiResponse = await generateAiResponse(context, targetTier);
        
        UI.showLoading(false); 
        UI.appendMessage(aiResponse, false);
        currentSession.messages.push({ text: aiResponse, isUser: false }); 
        Storage.saveSessions(sessions); 
        UI.renderSidebar(sessions, activeSessionId);
    } catch (err) {
        UI.showLoading(false); 
        UI.appendMessage("❌ System Fehler: " + err.message, false);
    }
}

// WIEDER DA: Die Titel-Generator-Funktion
async function generateChatTitle(firstMessage) {
    try {
        const titleRes = await generateAiResponse([{ 'role': 'user', 'content': 'Erstelle einen super kurzen Titel (max 3 Worte) für diese Anfrage: ' + firstMessage }], 'flash');
        if (titleRes && titleRes.length > 1) { 
            currentSession.title = titleRes.trim().replaceAll('"', ''); 
            Storage.saveSessions(sessions); 
            UI.renderSidebar(sessions, activeSessionId); 
        }
    } catch (e) {
        console.warn("Titel konnte nicht generiert werden", e);
    }
}

if(chatInput) chatInput.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
if(sendBtn) sendBtn.addEventListener('click', handleSend);
