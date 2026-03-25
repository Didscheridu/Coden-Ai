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
        
        // 🗑️ SICHERHEITS-SPERRE WURDE HIER ENTFERNT! 
        // Läuft jetzt auch auf Vercel.
    }

    async initSession(liveCallBtn, liveStatusIndicator) {
// ... Rest der Datei bleibt exakt gleich!

    async initSession(liveCallBtn, liveStatusIndicator) {
        if (this.isSessionActive || this.currentStatus === 'Error') return;

        console.warn("🔊 [SICHERHEITS-WARNUNG]: Beta Prototyp gestartet. API Key wird über WebSockets im Browser übertragen (only localhost).");
        this.updateUI(liveCallBtn, liveStatusIndicator, 'Connecting', 'Nativ... (Verbinde)');
        
        const settings = Storage.getSettings();
        const apiKey = settings.apiKey || CONFIG.apiKey;

        if (!apiKey) {
            UI.appendMessage("❌ **SICHERHEITS FEHLER:** Kein Google API Key im System/Prototyp gefunden.", false);
            this.updateUI(liveCallBtn, liveStatusIndicator, 'Error', 'Key fehlt.');
            return;
        }

        // Websocket Endpoint von Google AI Studio Beta (Client-Direkt)
        const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.studio.v1beta.live?key=${apiKey}`;

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
        
        this.updateUI(liveCallBtn, liveStatusIndicator, 'Handshake', 'Nativ... (Funk)');

        try {
            // 🎤 Zugriff auf das echte Mikrofon anfordern
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { sampleRate: this.SAMPLE_RATE, channelCount: 1 } 
            });
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.SAMPLE_RATE });
            
            // PCM Audio Processor für das Live-Streaming
            this.audioProcessor = this.audioContext.createScriptProcessor(this.BUFFER_SIZE, 1, 1); 
            this.audioProcessor.onaudioprocess = (e) => this.processAudioInput(e);

            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.audioProcessor);
            this.audioProcessor.connect(this.audioContext.destination);

        } catch (error) {
            console.error("🔊 [FEHLER]: Kein Mikrofon Zugriff.", error);
            UI.appendMessage("❌ **HARDWARE FEHLER:** Kein Mikrofon-Zugriff möglich.", false);
            this.stopSession(liveCallBtn, liveStatusIndicator);
        }
    }

    handleMessage(event, liveCallBtn, liveStatusIndicator) {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            console.error("🔊 [NATIVE AUDIO]: Ungültige JSON Antwort: ", e.data);
            return;
        }

        // --- BETA PCM AUDIO INTERPRETATION ---
        
        // 🌟 Wenn die KI Text zurückgibt
        if (data.text) {
            // Wir fügen den Text normal dem Chat hinzu, aber OHNE Animation (da wir ja Live sprechen)
            UI.appendMessage(data.text, false, false);
            this.currentStatus = 'Speaking';
            this.updateUI(liveCallBtn, liveStatusIndicator, 'Speaking', 'Coden spricht');
        }

        // 🌟 Wenn die KI ECHTE Audio-Daten schickt 🔥
        if (data.audio_data) {
            // Wir müssen die rohen PCM-Daten in ein Format konvertieren, das der Browser abspielen kann
            // Dies ist ein Prototyp, wir spielen es einfach direkt über `Audio` ab (base64)
            // Für echte Full-Duplex wäre hier PCM-Streaming-Konvertierung nötig.
            const audioSrc = `data:audio/webm;base64,${data.audio_data}`;
            const audio = new Audio(audioSrc);
            audio.play().catch(e => console.log("🔊 [NATIVE AUDIO]: Autoplay blockiert oder PCM Fehler: ", e));
        }

        // 🛡️ Wenn Google uns mitteilt, dass die KI fertig gesprochen hat
        if (data.interrupted || data.stream_end) {
            this.currentStatus = 'Listening';
            this.updateUI(liveCallBtn, liveStatusIndicator, 'Listening', 'Höre zu');
        }
    }

    // 🔥 NATIVE AUDIO MAGIC: Deine Stimme live streamen 🔥
    processAudioInput(audioProcessingEvent) {
        if (!this.isSessionActive || !this.websocket || this.websocket.readyState !== WebSocket.OPEN) return;
        
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const inputData = inputBuffer.getChannelData(0); // Rohe PCM-Daten
        
        // Konvertierung von Float32 zu Int16 für Google
        const int16PCM = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
            let s = Math.max(-1, Math.min(1, inputData[i]));
            int16PCM[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Zwingend nötig: System Prompt VOR dem ersten Audio senden
        if (!this.systemInstructionSent) {
            const userName = Storage.getSettings().userName || 'Entwickler';
            const systemPrompt = `Du bist "Coden", ein brillanter, freundlicher KI-Mensch. 
            Wir führen ein NATIVES, NATÜRLICHES, FULL-DUPLEX GESPRÄCH über WebSockets.
            Sprich natürlich, empathisch und kurz, wie als würdest du mir gegenüberstehen.
            Dein Nutzer heißt: ${userName}. Heute ist ${new Date().toLocaleDateString('de-DE')}.`;
            
            this.websocket.send(JSON.stringify({
                'systemInstruction': { parts: [{ text: systemPrompt }] },
                'audio_data': this.uint8ArrayToBase64(new Uint8Array(int16PCM.buffer)) // Das erste Audio mitschicken
            }));
            this.systemInstructionSent = true;
        } else {
            // Laufendes PCM-Audio senden (als Base64-Datenstrom)
            this.websocket.send(JSON.stringify({
                'audio_data': this.uint8ArrayToBase64(new Uint8Array(int16PCM.buffer))
            }));
        }
    }

    // Helper: Int16Array -> Uint8Array -> Base64
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
        UI.appendMessage("❌ **NATIVE AUDIO FEHLER:** WebSocket-Verbindung (BETA) abgebrochen.", false);
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
        else if (status === 'Handshake' || status === 'Connected' || status === 'Speaking' || status === 'Listening') liveCallBtn.classList.add('active');
        else if (status === 'Speaking') liveCallBtn.classList.add('active', 'speaking');
        else if (status === 'Listening') liveCallBtn.classList.add('active', 'listening');
        else if (status === 'Error') liveCallBtn.classList.add('error');
    }
}
