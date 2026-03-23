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

onAuthStateChanged(auth, async (user) => {
    if (user) {
        loginScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');
        userEmailDisplay.textContent = user.email;
        
        await Storage.loadFromCloud();
        if (!appInitialized) initApp(); 
    } else {
        loginScreen.classList.remove('hidden');
        appContainer.classList.add('hidden');
        localStorage.removeItem('coden_sessions'); 
        appInitialized = false;
    }
});


// --- INITIALISIERUNG DER APP ---
const chatInput = document.getElementById('main-input');
const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.querySelector('.new-chat-btn');
const micBtn = document.getElementById('mic-btn'); 
const attachmentBtn = document.getElementById('attachment-btn'); 
const fileUploadInput = document.getElementById('file-upload-input'); 

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
// ✉️ EMAIL ASSISTENT LOGIK
// ==========================================
const emailModal = document.getElementById('email-modal');
const openEmailBtn = document.getElementById('open-email-btn');
const closeEmailBtn = document.getElementById('close-email-btn');
const saveEmailSettingsBtn = document.getElementById('save-email-settings');
const generateEmailBtn = document.getElementById('generate-email-btn');
const sendRealEmailBtn = document.getElementById('send-real-email-btn'); // NEU

openEmailBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const settings = Storage.getSettings();
    if (settings.emailConfig) {
        document.getElementById('email-provider').value = settings.emailConfig.provider || 'gmail';
        document.getElementById('email-address').value = settings.emailConfig.address || '';
        document.getElementById('email-password').value = settings.emailConfig.password || '';
    }
    emailModal.classList.remove('hidden');
});

closeEmailBtn.addEventListener('click', () => emailModal.classList.add('hidden'));

saveEmailSettingsBtn.addEventListener('click', () => {
    const settings = Storage.getSettings();
    settings.emailConfig = {
        provider: document.getElementById('email-provider').value,
        address: document.getElementById('email-address').value.trim(),
        password: document.getElementById('email-password').value.trim()
    };
    Storage.saveSettings(settings);
    
    const feedback = document.getElementById('email-save-feedback');
    feedback.style.display = 'block';
    setTimeout(() => feedback.style.display = 'none', 3000);
});

// KI Text generieren
generateEmailBtn.addEventListener('click', async () => {
    const emailText = document.getElementById('email-draft-input').value.trim();
    if (!emailText) return;

    generateEmailBtn.innerHTML = '<div class="spinner" style="width: 16px; height: 16px; border-color: var(--bg-main) transparent var(--bg-main) transparent;"></div> Verarbeite...';
    generateEmailBtn.disabled = true;

    const emailSystemPrompt = `Du bist der "Coden Email Assistent". Deine Aufgabe ist es, E-Mails zu analysieren und Antworten zu verfassen.
WICHTIGE REGELN:
1. Du darfst NIEMALS finanzielle Deals abschließen, Zahlungen bestätigen oder über Geld verhandeln. Wenn es um Geld geht, weise höflich darauf hin, dass dies persönlich geklärt werden muss.
2. Formatiere deine Antwort IMMER genau so:
ZUSAMMENFASSUNG: [Hier eine kurze Zusammenfassung der erhaltenen E-Mail in 2-3 Sätzen]
ANTWORT: [Hier der Text für die E-Mail-Antwort]
3. AM ENDE JEDER ANTWORT MUSS ZWINGEND DIESER TEXT STEHEN: "\n\nHinweis: Diese E-Mail wurde von einer KI verfasst und kann Fehler enthalten."`;

    try {
        const responseText = await generateAiResponse([
            { role: 'system', content: emailSystemPrompt },
            { role: 'user', content: `Hier ist die E-Mail:\n\n${emailText}` }
        ], CONFIG.models.normal);

        const parts = responseText.split('ANTWORT:');
        const summaryPart = parts[0].replace('ZUSAMMENFASSUNG:', '').trim();
        const replyPart = parts.length > 1 ? parts[1].trim() : 'Fehler bei der Generierung.';

        document.getElementById('email-summary').textContent = summaryPart;
        // Text in das editierbare Textarea schreiben!
        document.getElementById('email-draft-output').value = replyPart; 
        document.getElementById('email-result-container').classList.remove('hidden');

    } catch (error) {
        document.getElementById('email-summary').textContent = "Fehler bei der API-Verbindung.";
    }

    generateEmailBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">auto_awesome</span> Mit GPT-4o generieren';
    generateEmailBtn.disabled = false;
});

// NEU: E-Mail echt versenden!
sendRealEmailBtn.addEventListener('click', async () => {
    const settings = Storage.getSettings();
    if (!settings.emailConfig || !settings.emailConfig.address || !settings.emailConfig.password) {
        alert("Bitte speichere zuerst deine E-Mail und dein App-Passwort in den Einstellungen oben!");
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


// --- EINSTELLUNGEN LOGIK ---
const settingsModal = document.getElementById('settings-modal');
document.getElementById('open-settings-btn').addEventListener('click', (e) => { 
    e.preventDefault(); 
    const s = Storage.getSettings();
    document.getElementById('persona-select').value = s.persona;
    document.getElementById('custom-persona-input').value = s.customPersona;
    document.getElementById('font-size-slider').value = s.fontSize;
    document.getElementById('font-size-display').textContent = s.fontSize;
    document.getElementById('custom-persona-container').classList.toggle('hidden', s.persona !== 'Eigene (Custom)');
    settingsModal.classList.remove('hidden'); 
});

document.getElementById('persona-select').addEventListener('change', (e) => {
    document.getElementById('custom-persona-container').classList.toggle('hidden', e.target.value !== 'Eigene (Custom)');
});
document.getElementById('font-size-slider').addEventListener('input', (e) => document.getElementById('font-size-display').textContent = e.target.value);
document.getElementById('close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
document.getElementById('cancel-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));

document.getElementById('save-settings').addEventListener('click', () => {
    const currentSettings = Storage.getSettings(); 
    currentSettings.persona = document.getElementById('persona-select').value;
    currentSettings.customPersona = document.getElementById('custom-persona-input').value;
    currentSettings.fontSize = parseInt(document.getElementById('font-size-slider').value);
    
    Storage.saveSettings(currentSettings);
    document.documentElement.style.setProperty('--chat-font-size', currentSettings.fontSize + 'px');
    settingsModal.classList.add('hidden');
});

// --- UI / CHAT STEUERUNG ---
let currentSelectedModel = 'flash';
document.getElementById('model-selector-btn').addEventListener('click', (e) => {
    e.stopPropagation(); 
    document.getElementById('model-dropdown-menu').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
    if (!document.getElementById('model-dropdown-menu').contains(e.target) && e.target !== document.getElementById('model-selector-btn')) {
        document.getElementById('model-dropdown-menu').classList.add('hidden');
    }
});
document.querySelectorAll('.model-option').forEach(option => {
    option.addEventListener('click', () => {
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
    currentSession = Storage.createNewSession();
    sessions.unshift(currentSession);
    Storage.saveSessions(sessions);
    activeSessionId = currentSession.id;
    UI.resetUI(); UI.renderSidebar(sessions, activeSessionId);
});

function loadSession(sessionId) {
    const sessionToLoad = sessions.find(s => s.id === sessionId);
    if (sessionToLoad) {
        activeSessionId = sessionId; currentSession = sessionToLoad;
        UI.resetUI(); 
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


// HAUPT SENDE FUNKTION
async function handleSend() {
    if(!chatInput) return; const text = chatInput.value.trim(); if (!text) return;
    chatInput.value = ''; chatInput.style.height = 'auto';

    UI.appendMessage(text, true); currentSession.messages.push({ text: text, isUser: true }); Storage.saveSessions(sessions);
    if (currentSession.messages.length === 1) generateChatTitle(text);

    const context = currentSession.messages.map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.text }));
    const settings = Storage.getSettings();
    const now = new Date();
    
    let basePersona = `Du bist AUSSCHLIESSLICH "Coden", ein hochintelligenter KI-Softwarearchitekt. WICHTIG: Du bist KEINE andere KI. Dein Name ist Coden. Nutze Emojis in deinen Erklärungen. Heute ist ${now.toLocaleDateString('de-DE')} und es ist exakt ${now.toLocaleTimeString('de-DE')} Uhr. `;
    if (settings.persona === 'Senior Dev') basePersona += ' Antworte wie ein sehr erfahrener Senior Software Engineer.';
    else if (settings.persona === 'Erklärbär') basePersona += ' Erkläre alles für Anfänger.';
    else if (settings.persona === 'Hacker') basePersona += ' Du bist Cybersicherheits-Experte.';
    else if (settings.persona === 'Eigene (Custom)' && settings.customPersona.trim() !== '') basePersona += ' ' + settings.customPersona;

    context.unshift({ role: 'system', content: basePersona });

    const currentModelName = document.getElementById('current-model-text').textContent;
    let targetModelId = CONFIG.models[currentSelectedModel];

    if (currentSelectedModel === 'pro') {
        UI.showLoading(true, `Coden Pro analysiert Anfrage...`);
        let historyContext = "";
        currentSession.messages.slice(-4, -1).forEach(m => historyContext += `${m.isUser ? 'Nutzer' : 'KI'}: ${m.text.substring(0, 100)}...\n`);

        const analysisPrompt = `Entscheide, ob die folgende Nachricht des Nutzers eine Code-Aufgabe ist (JA/NEIN).
Bisheriger Kontext:
${historyContext || "(Kein vorheriger Kontext)"}
Aktuelle Nutzer-Nachricht: "${text}"`;
        
        try {
            const analysisResult = await generateAiResponse([{ role: 'user', content: analysisPrompt }], CONFIG.models.normal);
            if (analysisResult.toUpperCase().includes('JA')) {
                UI.showLoading(true, `Coden Pro programmiert Code...`); targetModelId = CONFIG.models.openRouterCoder; 
            } else { UI.showLoading(true, `Coden Pro überlegt tiefgründig...`); }
        } catch (err) { UI.showLoading(true, `Coden Pro überlegt...`); }
    } else {
        UI.showLoading(true, `${currentModelName} denkt...`);
    }

    const aiResponse = await generateAiResponse(context, targetModelId);
    UI.showLoading(false); UI.appendMessage(aiResponse, false);

    currentSession.messages.push({ text: aiResponse, isUser: false });
    Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId);
}

async function generateChatTitle(firstMessage) {
    try {
        const prompt = 'Generiere einen sehr kurzen Titel (max 4 Worte) für diese Anfrage. Antworte NUR mit dem Titel, ohne Anführungszeichen:\n"' + firstMessage + '"';
        const titleResponse = await generateAiResponse([{ 'role': 'user', 'content': prompt }], CONFIG.models.flash);
        if (titleResponse && titleResponse.length > 1) {
            currentSession.title = titleResponse.trim().replaceAll('"', '');
            Storage.saveSessions(sessions); UI.renderSidebar(sessions, activeSessionId); 
        }
    } catch (e) {}
}
