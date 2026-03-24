// js/ui.js

const AI_PROFILE_PIC_SRC = './images/coden_logo.jpg';

const customRenderer = new marked.Renderer();

// Kompatibilität für marked.js v12 und v13+
customRenderer.code = function(tokenOrCode, language) {
    let codeText = '';
    let lang = '';
    
    if (typeof tokenOrCode === 'object' && tokenOrCode !== null) {
        codeText = tokenOrCode.text || '';
        lang = tokenOrCode.lang || '';
    } else {
        codeText = tokenOrCode || '';
        lang = language || '';
    }

    codeText = String(codeText);
    const validLanguage = hljs.getLanguage(lang) ? lang : 'plaintext';
    const highlightedCode = hljs.highlight(codeText, { language: validLanguage }).value;
    const langLabel = lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : 'Code';
    const encodedCode = encodeURIComponent(codeText);

    // Ultra-Cleanes Code-Block Design
    return `
    <div class="code-block-wrapper" style="margin: 16px 0; border-radius: 8px; overflow: hidden; background: #1e1e1e; border: 1px solid rgba(255,255,255,0.05);">
        <div class="code-header" style="display: flex; justify-content: space-between; padding: 6px 14px; background: rgba(255,255,255,0.03); font-size: 11px; color: #888; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <span class="lang" style="font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${langLabel}</span>
            <div class="code-actions">
                <button class="text-btn copy-code-btn" data-code="${encodedCode}" style="background: transparent; border: none; color: #888; cursor: pointer; display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 0;">
                    <span class="material-symbols-outlined" style="font-size: 14px;">content_copy</span> Kopieren
                </button>
            </div>
        </div>
        <pre style="margin: 0; padding: 14px; overflow-x: auto; background: transparent;"><code class="hljs ${validLanguage}" style="font-size: var(--chat-font-size, 14px); background: transparent; padding: 0; display: block; line-height: 1.5;">${highlightedCode}</code></pre>
    </div>`;
};

marked.setOptions({ renderer: customRenderer, breaks: true, gfm: true });

export const UI = {
    chatContainer: document.getElementById('chat-container'),
    welcomeScreen: document.getElementById('welcome-screen'),

    init: () => {
        // CSS für die pulsierenden Tipp-Punkte dynamisch injizieren
        const style = document.createElement('style');
        style.innerHTML = `
            @keyframes codenPulse { 0% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } 100% { opacity: 0.3; transform: scale(0.8); } }
            .typing-dot { width: 6px; height: 6px; background: var(--text-muted, #888); border-radius: 50%; opacity: 0.3; animation: codenPulse 1.4s infinite; }
            .typing-dot:nth-child(2) { animation-delay: 0.2s; }
            .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        `;
        document.head.appendChild(style);

        UI.chatContainer.addEventListener('click', async (e) => {
            const copyBtn = e.target.closest('.copy-code-btn');
            if (copyBtn) {
                const rawCode = decodeURIComponent(copyBtn.getAttribute('data-code'));
                try {
                    await navigator.clipboard.writeText(rawCode);
                    const originalHTML = copyBtn.innerHTML;
                    copyBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">check</span> Kopiert!`;
                    copyBtn.style.color = "var(--accent-green, #4caf50)";
                    setTimeout(() => {
                        copyBtn.innerHTML = originalHTML;
                        copyBtn.style.color = "#888";
                    }, 2000);
                } catch (err) {
                    console.error('Fehler beim Kopieren:', err);
                }
            }
        });
    },

    appendMessage: (text, isUser) => {
        const chatContainer = document.getElementById('chat-container');
        if (!chatContainer) return;
        
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) welcomeScreen.style.display = 'none';

        // 🛡️ FEHLER FIX: Tipp-Indikator entfernen, wenn eine echte Nachricht kommt
        const typingIndicator = document.getElementById('coden-typing-row');
        if (typingIndicator) typingIndicator.remove();

        const msgDiv = document.createElement('div');
        msgDiv.className = `message-row ${isUser ? 'user-message' : 'ai-message'}`;
        
        // Flexbox Layout (wiederhergestellt/optimiert)
        msgDiv.style.display = 'flex';
        msgDiv.style.gap = '16px';
        msgDiv.style.marginBottom = '24px'; // Etwas kompakter
        msgDiv.style.alignItems = 'flex-start';
        
        if (isUser) {
            msgDiv.style.flexDirection = 'row-reverse';
        }

        // --- AVATAR BEREICH ---
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.style.flexShrink = '0';
        avatar.style.width = '36px';
        avatar.style.height = '36px';
        avatar.style.borderRadius = '50%';
        avatar.style.overflow = 'hidden';
        avatar.style.display = 'flex';
        avatar.style.alignItems = 'center';
        avatar.style.justifyContent = 'center';

        if (!isUser) {
            // KI Avatar: Neben dem Text, KEIN Hintergrund
            avatar.style.background = 'transparent';
            avatar.innerHTML = `<img src="${AI_PROFILE_PIC_SRC}" style="width:100%; height:100%; object-fit:contain;" onerror="this.style.display='none'">`;
        } else {
            // Nutzer Avatar: Google Account Bild
            const userPhoto = localStorage.getItem('coden_user_photo');
            if (userPhoto) {
                avatar.innerHTML = `<img src="${userPhoto}" style="width:100%; height:100%; object-fit:cover;">`;
            } else {
                avatar.style.background = 'var(--accent-blue, #2b6cb0)';
                avatar.innerHTML = '<span class="material-symbols-outlined" style="color:white; font-size: 20px;">person</span>';
            }
        }

        // --- CONTENT BEREICH ---
        const content = document.createElement('div');
        content.className = 'content';
        content.style.maxWidth = '75%';
        content.style.lineHeight = '1.6';
        
        if (isUser) {
            // Nutzer: Schicke Chatblase
            content.style.background = 'var(--accent-blue, #2b6cb0)'; 
            content.style.color = '#ffffff';
            content.style.padding = '10px 16px'; // Etwas kompakter
            content.style.borderRadius = '16px 16px 4px 16px';
            content.style.fontSize = '15px';
            content.innerHTML = marked.parse(text);
        } else {
            // KI: KEINE Chatblase, cleaner Text
            content.style.background = 'transparent';
            content.style.color = 'var(--text-primary, #ececec)';
            content.style.padding = '4px 0';
            content.innerHTML = marked.parse(text);
        }

        // Highlight.js & Bilder
        if (!isUser) {
            content.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }
        content.querySelectorAll('img').forEach((img) => {
            img.style.maxWidth = '100%';
            img.style.borderRadius = '8px';
            img.style.marginTop = '12px';
            img.style.border = '1px solid rgba(255,255,255,0.05)';
        });

        // Zusammenbauen
        msgDiv.appendChild(avatar);
        msgDiv.appendChild(content);
        chatContainer.appendChild(msgDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    },

    // 🌟 NEUE, DYNAMISCHE LADE-ANIMATION (Messenger-Style) 🌟
    showLoading: (show, modelNameDisplay = "Coden denkt nach...") => {
        const chatContainer = document.getElementById('chat-container');
        if (!chatContainer) return;
        
        // Zuerst prüfen, ob schon eine Animation da ist
        const existingIndicator = document.getElementById('coden-typing-row');
        
        if (show) {
            if (UI.welcomeScreen) UI.welcomeScreen.classList.add('hidden');
            if (existingIndicator) return; // Schon da, nichts tun

            // Dynamisch eine KI-Nachrichten-Reihe für das Laden erzeugen
            const typingRow = document.createElement('div');
            typingRow.id = 'coden-typing-row';
            typingRow.style.display = 'flex';
            typingRow.style.gap = '16px';
            typingRow.style.marginBottom = '24px';
            typingRow.style.alignItems = 'flex-start';

            // KI-Avatar für die Tipp-Reihe
            const avatar = document.createElement('div');
            avatar.style.flexShrink = '0';
            avatar.style.width = '36px';
            avatar.style.height = '36px';
            avatar.style.borderRadius = '50%';
            avatar.style.background = 'transparent';
            avatar.style.display = 'flex';
            avatar.style.justifyContent = 'center';
            avatar.style.alignItems = 'center';
            avatar.style.overflow = 'hidden';
            avatar.innerHTML = `<img src="${AI_PROFILE_PIC_SRC}" style="width:100%; height:100%; object-fit:contain;" onerror="this.style.display='none'">`;

            // Der Tipp-Indikator selbst (Text + Punkte)
            const content = document.createElement('div');
            content.style.display = 'flex';
            content.style.flexDirection = 'column';
            content.style.gap = '8px';
            content.style.padding = '4px 0';

            // Modell-Name (Optional)
            const nameSpan = document.createElement('span');
            nameSpan.textContent = modelNameDisplay;
            nameSpan.style.fontSize = '12px';
            nameSpan.style.color = 'var(--text-muted, #888)';
            nameSpan.style.fontWeight = '500';

            // Die pulsierenden Punkte
            const dotsContainer = document.createElement('div');
            dotsContainer.style.display = 'flex';
            dotsContainer.style.gap = '5px';
            dotsContainer.style.padding = '8px 14px';
            dotsContainer.style.background = 'rgba(255,255,255,0.03)'; // Sehr dezente Blase für die Punkte
            dotsContainer.style.borderRadius = '16px';
            dotsContainer.style.width = 'fit-content';
            
            dotsContainer.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';

            content.appendChild(nameSpan);
            content.appendChild(dotsContainer);
            typingRow.appendChild(avatar);
            typingRow.appendChild(content);

            chatContainer.appendChild(typingRow);
            UI.scrollToBottom();
        } else {
            // Wenn show = false, entfernen wir die dynamische Tipp-Reihe
            if (existingIndicator) {
                existingIndicator.remove();
            }
        }
    },

    scrollToBottom: () => {
        UI.chatContainer.scrollTo({ top: UI.chatContainer.scrollHeight, behavior: 'smooth' });
    },

    renderSidebar: (sessions, activeSessionId) => {
        const list = document.querySelector('.sidebar-scroll-area');
        if (!list) return;

        let historySection = document.getElementById('dynamic-history');
        if (!historySection) {
            historySection = document.createElement('div');
            historySection.id = 'dynamic-history';
            historySection.className = 'nav-section';
            list.insertBefore(historySection, list.firstChild);
        }

        historySection.innerHTML = '<span class="nav-label">Letzte Chats</span>';
        
        sessions.forEach(session => {
            const item = document.createElement('div');
            const isActive = session.id === activeSessionId;
            item.className = `nav-item ${isActive ? 'active-sub' : ''}`;
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.cursor = 'pointer';

            item.innerHTML = `
                <div class="nav-item-left" style="display: flex; align-items: center; gap: 12px; overflow: hidden; width: 100%;">
                    <span class="material-symbols-outlined">chat_bubble</span> 
                    <span class="session-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${session.title}</span>
                </div>
                <button class="icon-btn delete-chat-btn" title="Chat löschen" style="padding: 4px; color: var(--text-muted); display: flex;">
                    <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
                </button>
            `;

            item.querySelector('.nav-item-left').addEventListener('click', (e) => {
                e.stopPropagation();
                document.dispatchEvent(new CustomEvent('loadChatSession', { detail: session.id }));
            });

            item.querySelector('.delete-chat-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                document.dispatchEvent(new CustomEvent('deleteChatSession', { detail: session.id }));
            });
            
            historySection.appendChild(item);
        });
    },

    resetUI: () => {
        const messages = UI.chatContainer.querySelectorAll('.message-row');
        messages.forEach(msg => msg.remove());
        
        // Auch den Lade-Indikator entfernen beim Reset
        const typingIndicator = document.getElementById('coden-typing-row');
        if (typingIndicator) typingIndicator.remove();

        if (UI.welcomeScreen) UI.welcomeScreen.classList.remove('hidden');
    }
};

UI.init();
