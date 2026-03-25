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
        this.currentStatus = 'Disconnected'; 
        
        this.SAMPLE_RATE = 16000; 
        this.BUFFER_SIZE = 1024;  
        this.systemInstructionSent = false;
    }

    async initSession(liveCallBtn, liveStatusIndicator) {
        if (this.isSessionActive || this.currentStatus === 'Error') return;

        console.warn("🔊 [SICHERHEITS-WARNUNG]: Beta Prototyp gestartet. API Key wird übertragen.");
        this.updateUI(liveCallBtn, liveStatusIndicator, 'Connecting', 'Verbinde...');
        
        const settings = Storage.getSettings();
        const apiKey = settings.apiKey || CONFIG.apiKey;

        if (!apiKey) {
            UI.appendMessage("❌ **SICHERHEITS FEHLER:** Kein Google API Key gefunden.", false);
            this.updateUI(liveCallBtn, liveStatusIndicator, 'Error', 'Key fehlt.');
            return;
        }

        // 🛠️ DER FIX: Die offizielle und korrekte Gemini Live API WebSocket URL!
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
        console.log("🔊 [NATIVE AUDIO]: WebSocket Verbindung offen.");
        this.isSessionActive = true;
        this.currentStatus = 'Handshake';
        this.systemInstructionSent = false;
        
        this.updateUI(liveCallBtn, liveStatusIndicator, 'Handshake', 'Initialisiere Audio...');

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

        } catch (error) {
            console.error("🔊 [FEHLER]: Kein Mikrofon Zugriff.", error);
            UI.appendMessage("❌ **HARDWARE FEHLER:** Kein Mikrofon-Zugriff.", false);
            this.stopSession(liveCallBtn, liveStatusIndicator);
        }
    }

    handleMessage(event, liveCallBtn, liveStatusIndicator) {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            console.error("🔊 [NATIVE AUDIO]: Ungültige JSON Antwort", e);
            return;
        }

        // --- GEMINI LIVE API INTERPRETATION ---
        if (data.serverContent?.modelTurn?.parts) {
            const parts = data.serverContent.modelTurn.parts;
            for (const part of parts) {
                if (part.text) {
                    UI.appendMessage(part.text, false, false);
                    this.currentStatus = 'Speaking';
                    this.updateUI(liveCallBtn, liveStatusIndicator, 'Speaking', 'Coden spricht');
                }
                if (part.inlineData && part.inlineData.data) {
                    // Die KI schickt uns rohes Audio (PCM)
                    const audioSrc = `data:${part.inlineData.mimeType || 'audio/pcm'};base64,${part.inlineData.data}`;
                    const audio = new Audio(audioSrc);
                    audio.play().catch(e => console.log("🔊 [NATIVE AUDIO]: Autoplay blockiert.", e));
                }
            }
        }

        if (data.serverContent?.turnComplete) {
            this.currentStatus = 'Listening';
            this.updateUI(liveCallBtn, liveStatusIndicator, 'Listening', 'Höre zu...');
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
            const systemPrompt = `Du bist "Coden", ein brillanter, freundlicher KI-Mensch. Wir führen ein NATIVES, FULL-DUPLEX GESPRÄCH über WebSockets. Sprich natürlich, empathisch und kurz. Dein Nutzer heißt: ${userName}.`;
            
            // 🛠️ DER FIX: Das korrekte "Setup" Paket nach Google Spezifikation!
            this.websocket.send(JSON.stringify({
                setup: { 
                    model: "models/gemini-2.0-flash-exp",
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    generationConfig: {
                        responseModalities: ["AUDIO"]
                    }
                }
            }));
            
            this.systemInstructionSent = true;
        } else {
            // Laufendes PCM-Audio streamen
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
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(u8Array[i]);
        }
        return window.btoa(binary);
    }

    stopSession(liveCallBtn, liveStatusIndicator) {
        if (!this.isSessionActive) return;
        
        this.updateUI(liveCallBtn, liveStatusIndicator, 'Disconnecting', 'Beende...');
        console.log("🔊 [NATIVE AUDIO]: Beende Live Session.");

        if (this.mediaStream) this.mediaStream.getTracks().forEach(track => track.stop());
        if (this.audioProcessor) this.audioProcessor.disconnect();
        if (this.audioContext) this.audioContext.close();
        if (this.websocket) this.websocket.close();

        this.websocket = null; this.audioContext = null; this.mediaStream = null; this.audioProcessor = null;
        this.isSessionActive = false;
        this.currentStatus = 'Disconnected';
        this.systemInstructionSent = false;
        
        this.updateUI(liveCallBtn, liveStatusIndicator, 'Disconnected', 'Live Modus');
    }

    handleError(event, liveCallBtn, liveStatusIndicator) {
        console.error("🔊 [NATIVE AUDIO ERROR]: WebSocket Fehler.", event);
        UI.appendMessage("❌ **NATIVE AUDIO FEHLER:** WebSocket-Verbindung abgebrochen.", false);
        this.currentStatus = 'Error';
        this.stopSession(liveCallBtn, liveStatusIndicator);
    }

    handleClose(event, liveCallBtn, liveStatusIndicator) {
        console.log("🔊 [NATIVE AUDIO]: WebSocket Verbindung geschlossen.");
        this.stopSession(liveCallBtn, liveStatusIndicator);
    }

    updateUI(liveCallBtn, liveStatusIndicator, status, label) {
        if (!liveCallBtn || !liveStatusIndicator) return;
        
        liveStatusIndicator.textContent = label;
        liveCallBtn.classList.remove('connecting', 'handshake', 'active', 'speaking', 'listening', 'error');

        if (status === 'Connecting') liveCallBtn.classList.add('connecting');
        else if (status === 'Handshake') liveCallBtn.classList.add('handshake');
        else if (status === 'Connected' || status === 'Speaking' || status === 'Listening') liveCallBtn.classList.add('active');
        else if (status === 'Speaking') liveCallBtn.classList.add('active', 'speaking');
        else if (status === 'Listening') liveCallBtn.classList.add('active', 'listening');
        else if (status === 'Error') liveCallBtn.classList.add('error');
    }
}
