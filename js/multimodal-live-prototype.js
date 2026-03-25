// js/multimodal-live-prototype.js
import { CONFIG } from './config.js';
import { Storage } from './storage.js';
import { UI } from './ui.js';

export class MultimodalLivePrototype {
    constructor() {
        this.websocket = null;
        this.audioContext = null;
        this.mediaStream = null;
        this.audioProcessor = null;
        this.isSessionActive = false;
        
        this.SAMPLE_RATE = 16000; 
        this.BUFFER_SIZE = 1024;  
        this.systemInstructionSent = false;

        if (!document.getElementById('call-animations')) {
            const style = document.createElement('style');
            style.id = 'call-animations';
            style.innerHTML = `
                @keyframes callPulse { 0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(43, 108, 176, 0.7); } 70% { transform: scale(1.05); box-shadow: 0 0 0 20px rgba(43, 108, 176, 0); } 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(43, 108, 176, 0); } }
                .is-speaking { animation: callPulse 1.5s infinite; }
            `;
            document.head.appendChild(style);
        }
    }

    async initSession(liveCallBtn, liveStatusIndicator) {
        if (this.isSessionActive) return;

        const callModal = document.getElementById('live-call-modal');
        const endCallBtn = document.getElementById('end-call-btn');
        if (callModal) callModal.classList.remove('hidden');
        if (endCallBtn) endCallBtn.onclick = () => this.stopSession(liveCallBtn, liveStatusIndicator);
        
        this.updateCallUI('Verbinde mit Server...');
        
        const settings = Storage.getSettings();
        const apiKey = settings.apiKey || CONFIG.apiKey;

        if (!apiKey) {
            this.updateCallUI('❌ Kein API Key gefunden!');
            setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 3000);
            return;
        }

        // Offizielle Websocket URL für die Bidi API (Live API)
        const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

        try {
            this.websocket = new WebSocket(endpoint);
            this.websocket.onopen = (e) => this.handleOpen(e, liveCallBtn, liveStatusIndicator);
            this.websocket.onmessage = (e) => this.handleMessage(e, liveCallBtn, liveStatusIndicator);
            this.websocket.onerror = (e) => this.handleError(e, liveCallBtn, liveStatusIndicator);
            this.websocket.onclose = (e) => this.handleClose(e, liveCallBtn, liveStatusIndicator);
        } catch (error) {
            this.handleError(error, liveCallBtn, liveStatusIndicator);
        }
    }

    async handleOpen(event, liveCallBtn, liveStatusIndicator) {
        this.isSessionActive = true;
        this.systemInstructionSent = false;
        
        this.updateCallUI('Greife auf Mikrofon zu...');

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { sampleRate: this.SAMPLE_RATE, channelCount: 1 } 
            });
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.SAMPLE_RATE });
            
            this.audioProcessor = this.audioContext.createScriptProcessor(this.BUFFER_SIZE, 1, 1); 
            this.audioProcessor.onaudioprocess = (e) => this.processAudioInput(e);

            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.audioProcessor);
            this.audioProcessor.connect(this.audioContext.destination);

            this.updateCallUI('Verbunden. Du kannst sprechen!');

        } catch (error) {
            console.error(error);
            this.updateCallUI('❌ Mikrofon blockiert!');
            setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 4000);
        }
    }

    handleMessage(event, liveCallBtn, liveStatusIndicator) {
        let data;
        try { data = JSON.parse(event.data); } catch (e) { return; }

        if (data.serverContent?.modelTurn?.parts) {
            const parts = data.serverContent.modelTurn.parts;
            for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    this.updateCallUI('Coden spricht...', true);
                    const audioSrc = `data:${part.inlineData.mimeType || 'audio/pcm'};base64,${part.inlineData.data}`;
                    const audio = new Audio(audioSrc);
                    audio.play().catch(e => console.log("Autoplay blockiert."));
                    
                    audio.onended = () => this.updateCallUI('Höre zu...', false);
                }
            }
        }

        if (data.serverContent?.turnComplete) {
            this.updateCallUI('Höre zu...', false);
        }
    }

    processAudioInput(audioProcessingEvent) {
        if (!this.isSessionActive || !this.websocket || this.websocket.readyState !== WebSocket.OPEN) return;
        
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const inputData = inputBuffer.getChannelData(0); 
        
        const int16PCM = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
            let s = Math.max(-1, Math.min(1, inputData[i]));
            int16PCM[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const base64Audio = this.uint8ArrayToBase64(new Uint8Array(int16PCM.buffer));

        if (!this.systemInstructionSent) {
            const userName = Storage.getSettings().userName || 'Entwickler';
            
            // 🛠️ Wenn wir "models/gemini-2.5-flash" über die Bidi API nutzen, greift das unbegrenzte Live-API Limit deines Screenshots!
            // 🛠️ DER FIX: Wir nutzen den exakten, internen Bidi-Codenamen und fordern explizit AUDIO an!
            this.websocket.send(JSON.stringify({
                setup: { 
                    model: "models/gemini-2.0-flash-exp", 
                    systemInstruction: { parts: [{ text: `Du bist Coden, eine KI. Nutzer: ${userName}. Sprich natürlich über Audio.` }] },
                    generationConfig: {
                        responseModalities: ["AUDIO"]
                    }
                }
            }));
            this.systemInstructionSent = true;
        } else {
            this.websocket.send(JSON.stringify({
                realtimeInput: {
                    mediaChunks: [{
                        mimeType: "audio/pcm;rate=16000",
                        data: base64Audio
                    }]
                }
            }));
        }
    }

    uint8ArrayToBase64(u8Array) {
        let binary = '';
        const len = u8Array.byteLength;
        for (let i = 0; i < len; i++) { binary += String.fromCharCode(u8Array[i]); }
        return window.btoa(binary);
    }

    updateCallUI(text, isSpeaking = false) {
        const statusText = document.getElementById('call-status-text');
        const avatarContainer = document.getElementById('call-avatar-container');
        if (statusText) statusText.textContent = text;
        
        if (avatarContainer) {
            if (isSpeaking) avatarContainer.classList.add('is-speaking');
            else avatarContainer.classList.remove('is-speaking');
        }
    }

    // 🛠️ DER FIX: Das UI bleibt bei einem Fehler offen, damit du lesen kannst, was passiert ist!
    handleClose(event, liveCallBtn, liveStatusIndicator) {
        console.log("🔊 [NATIVE AUDIO]: WebSocket getrennt.", event);
        
        // Wir zeigen den echten Grund von Google an!
        const reason = event.reason ? event.reason : "Google hat die Verbindung unerwartet getrennt.";
        this.updateCallUI(`❌ Abbruch (Code ${event.code}): ${reason}`);
        
        // Wir warten 6 Sekunden, bevor wir aufräumen, damit du den Fehler lesen kannst!
        setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 6000);
    }

    handleError(event, liveCallBtn, liveStatusIndicator) {
        this.updateCallUI('❌ WebSocket Fehler!');
        setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 4000);
    }

    stopSession(liveCallBtn, liveStatusIndicator) {
        if (!this.isSessionActive) return;
        
        if (this.mediaStream) this.mediaStream.getTracks().forEach(track => track.stop());
        if (this.audioProcessor) this.audioProcessor.disconnect();
        if (this.audioContext) this.audioContext.close();
        if (this.websocket) this.websocket.close();

        this.websocket = null; this.audioContext = null; this.mediaStream = null; this.audioProcessor = null;
        this.isSessionActive = false;
        this.systemInstructionSent = false;
        
        const callModal = document.getElementById('live-call-modal');
        if (callModal) {
            callModal.classList.add('hidden');
        }
        
        const statusText = document.getElementById('call-status-text');
        if (statusText) statusText.textContent = 'Verbinde mit Coden...';
    }
}
