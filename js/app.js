// js/app.js
import { CONFIG } from './config.js';
import { generateAiResponse } from './api.js';
import { UI } from './ui.js';
import { Storage } from './storage.js';
import { loginWithGoogle, loginWithEmail, registerWithEmail, logoutUser, onAuthStateChanged, auth } from './firebase-init.js';

// --- AUTHENTIFIZIERUNGS LOGIK ---
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app');
const errorMsg = document.getElementById('auth-error-msg');
const userEmailDisplay = document.getElementById('user-email-display');

document.getElementById('btn-google-login').addEventListener('click', async () => {
    try { await loginWithGoogle(); } catch(e) { showError(e.message); }
});
document.getElementById('btn-email-login').addEventListener('click', async () => {
    const e = document.getElementById('auth-email').value; const p = document.getElementById('auth-password').value;
    if(e && p) try { await loginWithEmail(e, p); } catch(err) { showError("Login fehlgeschlagen."); }
});
document.getElementById('btn-email-register').addEventListener('click', async () => {
    const e = document.getElementById('auth-email').value; const p = document.getElementById('auth-password').value;
    if(e && p) try { await registerWithEmail(e, p); } catch(err) { showError("Registrierung fehlgeschlagen."); }
});
document.getElementById('logout-btn').addEventListener('click', () => logoutUser());

function showError(msg) { errorMsg.textContent = msg; errorMsg.style.display = 'block'; }

let sessions = [];
let currentSession = null;
let activeSessionId = null;
let appInitialized = false;
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
// 🍔 SIDEBAR MENU & SUCHE LOGIK
// ==========================================
const mainSidebar = document.getElementById('main-sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar-btn');
const openSidebarBtn = document.getElementById('open-sidebar-btn');

const toggleSearchBtn = document.getElementById('toggle-search-btn');
const searchContainer = document.getElementById('search-container');
const chatSearchInput = document.getElementById('chat-search-input');

// Menü einklappen
closeSidebarBtn.addEventListener('click', () => {
    mainSidebar.classList.add('collapsed');
    openSidebarBtn.classList.remove('hidden');
});

// Menü ausklappen
openSidebarBtn.addEventListener('click', () => {
    mainSidebar.classList.remove('collapsed');
    openSidebarBtn.classList.add('hidden');
});

// Suche ein/ausblenden
toggleSearchBtn.addEventListener('click', () => {
    searchContainer.classList.toggle('active');
    if (searchContainer.classList.contains('active')) {
        chatSearchInput.focus();
    } else {
        // Suche löschen und alle Chats wieder anzeigen
        chatSearchInput.value = '';
        UI.renderSidebar(sessions, activeSessionId);
    }
});

// Echzeit-Filterung der Chats
chatSearchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    
    if (!searchTerm) {
        UI.renderSidebar(sessions, activeSessionId);
        return;
    }

    // Filtere Sessions nach Titel oder nach Inhalten in den Nachrichten
    const filteredSessions = sessions.filter(session => {
        const titleMatch = session.title && session.title.toLowerCase().includes(searchTerm);
        const messageMatch = session.messages.some(msg => msg.text.toLowerCase().includes(searchTerm));
        return titleMatch || messageMatch;
    });

    UI.renderSidebar(filteredSessions, activeSessionId);
});


// ==========================================
// ✉️ EMAIL MODAL STEUERUNG
// ==========================================
const emailModal = document.getElementById('email-modal');
const closeEmailBtn = document.getElementById('close-email-btn');
const sendRealEmailBtn = document.getElementById('send-real-email-btn');

closeEmailBtn.addEventListener('click', () => emailModal.classList.add('hidden'));

sendRealEmailBtn.addEventListener('click', async () => {
    const settings = Storage.getSettings();
    if (!settings.emailConfig || !settings.emailConfig.address || !settings.emailConfig.password) {
        alert("Bitte speichere zuerst deine E-Mail und dein App-Passwort in den Einstellungen!");
        return;
    }

    const recipient = document.getElementById('email-recipient').value.trim();
    const subject = document.getElementById('email-subject').value.trim();
    const draftText = document.getElementById('email-draft-output').value.trim();
    const feedback = document.getElementById('email-send-feedback');

    if (!recipient || !draftText) {
        alert("Bitte Empfänger und Text ausfüllen!");
        return;
    }

    sendRealEmailBtn.innerHTML = '<div class="spinner" style="width: 16px; height: 16px; border-color: white transparent white transparent;"></div> Sende...';
    sendRealEmailBtn.disabled = true;

    try {
        const response = await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: settings.emailConfig.provider,
                email: settings.emailConfig.address,
                password: settings.emailConfig.password,
                to: recipient,
                subject: subject,
                text: draftText
            })
        });
        const data = await response.json();
        if (response.ok && data.success) {
            feedback.style.color = 'var(--accent-green)';
            feedback.textContent = '✅ E-Mail erfolgreich versendet!';
            feedback.style.display = 'block';
            setTimeout(() => emailModal.classList.add('hidden'), 2000); 
        } else {
            throw new Error(data.error || 'Unbekannter Serverfehler');
        }
    } catch (error) {
        feedback.style.color = '#ff4444';
        feedback.textContent = '❌ Fehler: ' + error.message;
        feedback.style.display = 'block';
    }
    sendRealEmailBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">send</span> E-Mail jetzt versenden';
    sendRealEmailBtn.disabled = false;
});

// ==========================================
// 🧠 CUSTOM CONFIRM LOGIK 
// ==========================================
const confirmModal = document.getElementById('confirm-modal');
const confirmMessage = document.getElementById('confirm-message');
const confirmYesBtn = document.getElementById('btn-confirm-yes');
const confirmCancelBtn = document.getElementById('btn-confirm-cancel');

function showCustomConfirm(message) {
    return new Promise((resolve) => {
        confirmMessage.textContent = message;
        confirmModal.classList.remove('hidden');

        const handleYes = () => {
            confirmModal.classList.add('hidden');
            removeListeners();
            resolve(true);
        };
        const handleCancel = () => {
            confirmModal.classList.add('hidden');
            removeListeners();
            resolve(false);
        };
        const removeListeners = () => {
            confirmYesBtn.removeEventListener('click', handleYes);
            confirmCancelBtn.removeEventListener('click', handleCancel);
        };

        confirmYesBtn.addEventListener('click', handleYes);
        confirmCancelBtn.addEventListener('click', handleCancel);
    });
}

// ==========================================
// 🛠️ THINKING MODUS SPERR-LOGIK
// ==========================================
function lockThinkingMode(lock) {
    const normalOption = document.getElementById('thinking-mode-option');
    if (lock) {
        isThinkingModeLocked = true;
        normalOption.classList.add('disabled');
        normalOption.title = "Thinking Modus temporär wegen Serverfehlern gesperrt.";
        
        if (currentSelectedModel === 'normal') {
            currentSelectedModel = 'flash';
            document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
            document.querySelector('.model-option[data-model="flash"]').classList.add('active');
            document.getElementById('current-model-text').textContent = 'Coden Flash';
            UI.appendMessage("⚠️ Coden Thinking ist überlastet. Automatisch zu Coden Flash gewechselt.", false);
        }
    } else {
        isThinkingModeLocked = false;
        normalOption.classList.remove('disabled');
        normalOption.removeAttribute('title');
    }
}

// --- EINSTELLUNGEN LOGIK ---
const settingsModal = document.getElementById('settings-modal');
const openSettingsBtn = document.getElementById('open-settings-btn');
const openEmailSettingsBtn = document.getElementById('open-email-settings-btn');

function openSettings() {
    const s = Storage.getSettings();
    document.getElementById('user-name-input').value = s.userName || ''; 
    document.getElementById('persona-select').value = s.persona;
    document.getElementById('custom-persona-input').value = s.customPersona;
    document.getElementById('font-size-slider').value = s.fontSize;
    document.getElementById('font-size-display').textContent = s.fontSize;
    document.getElementById('custom-persona-container').classList.toggle('hidden', s.persona !== 'Eigene (Custom)');
    if (s.emailConfig) {
        document.getElementById('email-provider').value = s.emailConfig.provider || 'gmail';
        document.getElementById('email-address').value = s.emailConfig.address || '';
        document.getElementById('email-password').value = s.emailConfig.password || '';
    }
    settingsModal.classList.remove('hidden'); 
}

openSettingsBtn.addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
openEmailSettingsBtn.addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
document.getElementById('persona-select').addEventListener('change', (e) => { document.getElementById('custom-persona-container').classList.toggle('hidden', e.target.value !== 'Eigene (Custom)'); });
document.getElementById('font-size-slider').addEventListener('input', (e) => document.getElementById('font-size-display').textContent = e.target.value);
document.getElementById('close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
document.getElementById('cancel-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));

document.getElementById('save-settings').addEventListener('click', () => {
    const currentSettings = Storage.getSettings(); 
    currentSettings.userName = document.getElementById('user-name-input').value.trim() || 'Entwickler'; 
    currentSettings.persona = document.getElementById('persona-select').value;
    currentSettings.customPersona = document.getElementById('custom-persona-input').value;
    currentSettings.fontSize = parseInt(document.getElementById('font-size-slider').value);
    currentSettings.emailConfig = {
        provider: document.getElementById('email-provider').value,
        address: document.getElementById('email-address').value.trim(),
        password: document.getElementById('email-password').value.trim()
    };
    Storage.saveSettings(currentSettings);
    document.documentElement.style.setProperty('--chat-font-size', currentSettings.fontSize + 'px');
    
    updateGreeting(); 
    settingsModal.classList.add('hidden');
});

// --- UI / MODELL STEUERUNG ---
let currentSelectedModel = 'flash';
const chatInput = document.getElementById('main-input');
const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.querySelector('.new-chat-btn');
const micBtn = document.getElementById('mic-btn'); 
const attachmentBtn = document.getElementById('attachment-btn'); 
const fileUploadInput = document.getElementById('file-upload-input'); 

document.getElementById('model-selector-btn').addEventListener('click', (e) => {
    e.stopPropagation(); document.getElementById('model-dropdown-menu').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
    if (!document.getElementById('model-dropdown-menu').contains(e.target) && e.target !== document.getElementById('model-selector-btn')) {
        document.getElementById('model-dropdown-menu').classList.add('hidden');
    }
});
document.querySelectorAll('.model-option').forEach(option => {
    option.addEventListener('click', () => {
        if (option.id === 'thinking-mode-option' && isThinkingModeLocked) return;
        document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
        option.classList.add('active');
        document.getElementById('current-model-text').textContent = option.querySelector('.name').textContent.trim();
        currentSelectedModel = option.getAttribute('data-model');
        document.getElementById('model-dropdown-menu').classList.add('hidden');
    });
});

attachmentBtn.addEventListener('click', () => fileUploadInput.click());
fileUploadInput.addEventListener('change', async (e) => {
    const files = e.target.files; if (files.length === 0) return;
    let appendedText = "";
    for (let i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/')) { appendedText += `\n[Bilddatei ausgewählt: ${files[i].name}]\n`; continue; }
        try { const text = await files[i].text(); appendedText += `\n\n// --- Datei: ${files[i].name} ---\n\`\`\`\n${text}\n\`\`\`\n// ---------------------------\n`; } catch (err) {}
    }
    if (appendedText && chatInput) {
        chatInput.value = (chatInput.value + appendedText); chatInput.dispatchEvent(new Event('input')); 
        const originalHtml = attachmentBtn.innerHTML;
        attachmentBtn.innerHTML = '<span class="material-symbols-outlined" style="color: var(--accent-green);">check</span>';
        setTimeout(() => attachmentBtn.innerHTML = originalHtml, 2000);
    }
    fileUploadInput.value = '';
});

chatInput.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px'; });
chatInput.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
sendBtn.addEventListener('click', handleSend);

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

// SPRACHERKENNUNG
let recognition = null; let isListening = false;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition(); recognition.lang = 'de-DE'; recognition.interimResults = false; recognition.continuous = false;
    recognition.onstart = () => { isListening = true; micBtn.style.color = '#ff4444'; chatInput.placeholder = 'Höre zu... (Sprich jetzt)'; };
    recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        if (finalTranscript && chatInput) { chatInput.value = (chatInput.value + ' ' + finalTranscript).trim(); chatInput.dispatchEvent(new Event('input')); }
    };
    recognition.onerror = () => stopListening(); recognition.onend = () => stopListening();
}
function stopListening() { isListening = false; micBtn.style.color = 'var(--text-secondary)'; chatInput.placeholder = 'Einen Prompt für Coden AI eingeben...'; }
micBtn.addEventListener('click', () => {
    if (!recognition) return alert('Dein Browser unterstützt die Spracherkennung leider nicht.');
    isListening ? recognition.stop() : recognition.start();
});

// ==========================================
// 🚀 HAUPT SENDE FUNKTION
// ==========================================
async function handleSend() {
    if(!chatInput) return; const text = chatInput.value.trim(); if (!text) return;
    chatInput.value = ''; chatInput.style.height = 'auto';

    UI.appendMessage(text, true); currentSession.messages.push({ text: text, isUser: true }); Storage.saveSessions(sessions);
    if (currentSession.messages.length === 1) generateChatTitle(text);

    let historyContext = "";
    currentSession.messages.slice(-5, -1).forEach(m => historyContext += `${m.isUser ? 'Nutzer' : 'KI'}: ${m.text.substring(0, 1500)}...\n`);

    const lowerText = text.toLowerCase();
    let isEmailCommand = false;

    const triggerWords = ['mail', 'gmail', 'sende', 'schick', 'weiterleiten'];
    const hasTriggerWord = triggerWords.some(w => lowerText.includes(w));

    if (hasTriggerWord) {
        const wantsEmail = await showCustomConfirm("Möchtest du eine E-Mail senden?\n\nOK = Fenster öffnen\nAbbrechen = Normaler Chat");
        if (wantsEmail) {
            isEmailCommand = true;
        }
    }

    const settings = Storage.getSettings();
    const userName = settings.userName || 'Entwickler';

    // =================================================================
    // 📨 E-MAIL EXTRAKTION
    // =================================================================
    if (isEmailCommand) {
        UI.showLoading(true, "Coden bereitet das E-Mail-Fenster vor...");
        
        let lastCodeBlock = "";
        const codeRegex = /```[\s\S]*?```/g;
        const allCodeBlocks = currentSession.messages.map(m => m.text.match(codeRegex)).flat().filter(Boolean);
        if (allCodeBlocks.length > 0) lastCodeBlock = allCodeBlocks[allCodeBlocks.length - 1];

        const emailExtractionPrompt = `DU BIST EIN UNSICHTBARER E-MAIL-GENERATOR. Deine EINZIGE Aufgabe ist es, einen fertigen E-Mail-Entwurf zu erstellen.
        
WICHTIGE REGELN:
1. Sprich NICHT mit dem Nutzer. Stelle KEINE Rückfragen.
2. Der Absender der E-Mail heißt: "${userName}". Unterschreibe die E-Mail zwingend mit diesem Namen am Ende! Verwende NIEMALS Platzhalter wie "[Dein Name]".
3. Wenn der Nutzer Code verlangt, kopiere EXAKT diesen Code:
${lastCodeBlock || "Kein Code vorhanden."}

Bisheriger Verlauf als Kontext: 
${historyContext}

Der Befehl des Nutzers (Was in die Mail soll): "${text}"

Anweisung für die Felder:
- [TO]: Suche in der Nutzer-Anfrage nach der Adresse. Schreibe NUR die nackte E-Mail-Adresse (keine Klammern, keine Sätze).
- [SUBJECT]: Ein passender, professioneller Betreff.
- [BODY]: Der finale, fertige E-Mail-Text an den Empfänger. Nichts anderes!

Antworte EXAKT in diesem Format:
[TO]: 
[SUBJECT]: 
[BODY]: 
`;

        try {
            let activeModelForEmail = CONFIG.models[currentSelectedModel];
            if (currentSelectedModel === 'normal' && isThinkingModeLocked) {
                activeModelForEmail = CONFIG.models.flash;
            }

            const responseText = await generateAiResponse([{ role: 'user', content: emailExtractionPrompt }], activeModelForEmail);
            
            const toMatch = responseText.match(/\[TO\]:\s*(.*)/i);
            const subjectMatch = responseText.match(/\[SUBJECT\]:\s*(.*)/i);
            const bodySplit = responseText.split(/\[BODY\]:/i);
            
            let emailTo = toMatch ? toMatch[1].trim() : '';
            const emailSubject = subjectMatch ? subjectMatch[1].trim() : '';
            const emailBody = bodySplit.length > 1 ? bodySplit[1].trim() : responseText.trim(); 

            emailTo = emailTo.replace(/[<>]/g, '').trim(); 
            const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/;
            const extractedEmail = emailTo.match(emailRegex);
            if(extractedEmail) {
                emailTo = extractedEmail[0]; 
            }

            document.getElementById('email-recipient').value = emailTo;
            document.getElementById('email-subject').value = emailSubject;
            document.getElementById('email-draft-output').value = emailBody;

            UI.showLoading(false);
            const successMsg = `Ich habe das E-Mail-Fenster (mit ${document.getElementById('current-model-text').textContent}) für dich vorbereitet!`;
            UI.appendMessage(successMsg, false);
            currentSession.messages.push({ text: successMsg, isUser: false });
            Storage.saveSessions(sessions);
            
            document.getElementById('email-modal').classList.remove('hidden');
            return; 
            
        } catch (err) { 
            console.error("E-Mail Generierung fehlgeschlagen:", err); 
            UI.showLoading(false);
            const errorMsg = "❌ API Fehler beim E-Mail Erstellen: " + err.message;
            UI.appendMessage(errorMsg, false);
            currentSession.messages.push({ text: errorMsg, isUser: false });
            Storage.saveSessions(sessions);
            return;
        }
    }

    // =================================================================
    // 🤖 NORMALER MODELL-ABLAUF
    // =================================================================
    const context = currentSession.messages.map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.text }));
    const now = new Date();
    
    let basePersona = `Du bist "Coden", ein KI-Softwarearchitekt. Heute ist ${now.toLocaleDateString('de-DE')} um ${now.toLocaleTimeString('de-DE')}. Der Nutzer, mit dem du sprichst, heißt ${userName}. Sprich ihn gelegentlich damit an. `;
    if (settings.persona === 'Senior Dev') basePersona += ' Antworte wie ein Senior Software Engineer.';
    else if (settings.persona === 'Erklärbär') basePersona += ' Erkläre für Anfänger.';
    else if (settings.persona === 'Hacker') basePersona += ' Du bist Cybersicherheits-Experte.';
    else if (settings.persona === 'Eigene (Custom)' && settings.customPersona.trim() !== '') basePersona += ' ' + settings.customPersona;

    context.unshift({ role: 'system', content: basePersona });

    let targetModelId = CONFIG.models[currentSelectedModel];

    if (currentSelectedModel === 'normal') {
        if (isThinkingModeLocked) {
            UI.showLoading(true, "Thinking Modus gesperrt. Verwende Coden Pro als Fallback...");
            targetModelId = CONFIG.models.fallback; 
        } else {
            UI.showLoading(true, `Coden Thinking überlegt...`);
        }
    } else if (currentSelectedModel === 'flash') {
        UI.showLoading(true, `Coden Flash denkt...`);
    }

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
        }

        const aiResponse = await generateAiResponse(context, targetModelId);
        UI.showLoading(false); 
        UI.appendMessage(aiResponse, false);
        currentSession.messages.push({ text: aiResponse, isUser: false });
        Storage.saveSessions(sessions); 
        UI.renderSidebar(sessions, activeSessionId);

        if (currentSelectedModel === 'normal' && isThinkingModeLocked) {
            lockThinkingMode(false);
            UI.appendMessage("✅ Coden Thinking ist wieder verfügbar.", false);
        }

    } catch (err) {
        UI.showLoading(false);

        if (currentSelectedModel === 'normal' && !isThinkingModeLocked) {
            console.error("GPT-4o Fehler. Wechsle zu Fallback:", err);
            lockThinkingMode(true); 

            UI.showLoading(true, "GPT-4o ausgefallen. Starte Coden Pro als Fallback...");
            try {
                const fallbackResponse = await generateAiResponse(context, CONFIG.models.fallback);
                UI.showLoading(false);
                UI.appendMessage(fallbackResponse, false);
                currentSession.messages.push({ text: fallbackResponse, isUser: false });
                Storage.saveSessions(sessions);
                UI.renderSidebar(sessions, activeSessionId);
                return; 
            } catch (fallbackErr) {
                UI.showLoading(false);
                UI.appendMessage("❌ Auch der Fallback ist fehlgeschlagen.", false);
                return;
            }
        }

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

initApp();
