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
        this.analyser = null; 
        this.dataArray = null;
        this.isSessionActive = false;
        this.currentStatus = 'Disconnected'; 
        this.lastSpeakTime = null; 
        
        this.SAMPLE_RATE = 16000; 
        this.BUFFER_SIZE = 1024;  
        
        this.setupCompleteReceived = false;
        this.nextPlaybackTime = 0; 
        this.chatHistory = []; 
        this.currentScreenText = ''; 
        this.isNewAITurn = true;

        // Wir werfen die alten CSS-pulsationen raus, Three.js kümmert sich jetzt!
    }

    async initSession(liveCallBtn, liveStatusIndicator, chatHistory = []) {
        if (this.isSessionActive) return;

        this.chatHistory = chatHistory; this.currentScreenText = ''; this.isNewAITurn = true;

        const callModal = document.getElementById('live-call-modal');
        const endCallBtn = document.getElementById('end-call-btn');
        const subtitle = document.getElementById('call-subtitle');
        
        if (callModal) callModal.classList.remove('hidden');
        if (endCallBtn) endCallBtn.onclick = () => this.stopSession(liveCallBtn, liveStatusIndicator);
        
        // 🌟 NEU: Wir starten die WebGL Partikel-Engine!
        if (window.ParticleEngine) window.ParticleEngine.start();

        this.updateCallUI('Verbinde mit Server...');
        
        const settings = Storage.getSettings() || {};
        const apiKey = settings.apiKey || CONFIG.apiKey;

        if (!apiKey) {
            this.updateCallUI('❌ Kein API Key!');
            setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 3000);
            return;
        }

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
        this.currentStatus = 'Handshake';
        this.setupCompleteReceived = false;
        this.lastSpeakTime = null;
        this.nextPlaybackTime = 0; 
        
        this.updateCallUI('Konfiguriere Pro Audio...');

        // (unveränderter Gedächtnis-Prompt Logik) ...
        const settings = Storage.getSettings() || {};
        const userName = settings.userName || 'Gast';

        let historyString = "";
        if (this.chatHistory && this.chatHistory.length > 0) {
            historyString = "\n\n--- DEIN GEDÄCHTNIS (BISHERIGER CHAT) ---\n";
            const recentHistory = this.chatHistory.slice(-15);
            recentHistory.forEach(msg => {
                let cleanText = msg.text.replace('📞 *KI im Live-Call:* ', '');
                historyString += `${msg.isUser ? 'Nutzer' : 'Du'}: ${cleanText}\n`;
            });
            historyString += "-----------------------------------\nNutze dieses Wissen zwingend!";
        }

        const systemPrompt = `Du bist "Coden", eine smarte und empathische KI, erschaffen von dem Entwickler "Kayden". 
Sprich den Nutzer "${userName}" mit seinem Namen an!
WICHTIGE REGELN:
1. Du bist eine REINE Audio-KI. Du hast KEINEN Bildschirm!
2. Wenn der Nutzer nach Code fragt, erkläre das Konzept verbal.
3. Antworte in kurzen, natürlichen Sätzen.${historyString}`;

        const setupMsg = {
            setup: { 
                model: "models/gemini-2.5-flash-native-audio-latest", 
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { responseModalities: ["AUDIO"] }
            }
        };

        try { this.websocket.send(JSON.stringify(setupMsg)); } catch(e) {}

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: this.SAMPLE_RATE, channelCount: 1 } });
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.SAMPLE_RATE });
            if (this.audioContext.state === 'suspended') await this.audioContext.resume();
            
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            this.audioProcessor = this.audioContext.createScriptProcessor(this.BUFFER_SIZE, 1, 1); 
            this.audioProcessor.onaudioprocess = (e) => this.processAudioInput(e);

            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.analyser);
            this.analyser.connect(this.audioProcessor);
            this.audioProcessor.connect(this.audioContext.destination);

            this.visualizeUserAudio(); // Startet die Mikrofon-Zuhör-Schleife

        } catch (error) {
            this.updateCallUI('❌ Mikrofon blockiert!');
            setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 4000);
        }
    }

    async handleMessage(event, liveCallBtn, liveStatusIndicator) {
        let data;
        try { let rawData = event.data; if (rawData instanceof Blob) rawData = await rawData.text(); data = JSON.parse(rawData); } catch (e) { return; }

        if (data.setupComplete) { this.setupCompleteReceived = true; this.updateCallUI('Höre Pro Audio zu...'); return; }

        if (data.serverContent?.modelTurn?.parts) {
            const parts = data.serverContent.modelTurn.parts;
            for (const part of parts) {
                if (part.text && !part.thought) { if (this.isNewAITurn) { this.currentScreenText = ''; this.isNewAITurn = false; } this.currentScreenText += part.text; }

                if (part.inlineData && part.inlineData.data) {
                    this.currentStatus = 'Speaking';
                    // Wir aktualisieren UI nur, wenn sich Text ändert, um GPU zu sparen
                    this.updateCallUI('Coden spricht Pro Audio...', true); 
                    
                    // (unveränderte Audio-Wiedergabe-Logik) ...
                    try {
                        const base64 = part.inlineData.data; const binaryString = window.atob(base64); const buffer = new ArrayBuffer(binaryString.length); const view = new DataView(buffer);
                        for (let i = 0; i < binaryString.length; i++) { view.setUint8(i, binaryString.charCodeAt(i)); }
                        const float32Array = new Float32Array(binaryString.length / 2);
                        for (let i = 0; i < float32Array.length; i++) { float32Array[i] = view.getInt16(i * 2, true) / 32768.0; }
                        if (this.audioContext.state === 'suspended') this.audioContext.resume();
                        const audioBuffer = this.audioContext.createBuffer(1, float32Array.length, 24000); audioBuffer.getChannelData(0).set(float32Array);
                        const source = this.audioContext.createBufferSource(); source.buffer = audioBuffer; source.connect(this.audioContext.destination);
                        
                        // 🌟 NEU: Wir analysieren auch das KI-Audio, um das Viereck morphen zu lassen!
                        // Da wir kein KI-Analyser haben, emulieren wir es einfach über Shader Uniforms (siehe ParticleEngine.updateAudio).

                        if (this.nextPlaybackTime < this.audioContext.currentTime) { this.nextPlaybackTime = this.audioContext.currentTime; }
                        source.start(this.nextPlaybackTime); this.nextPlaybackTime += audioBuffer.duration;
                        
                        source.onended = () => {
                            if (this.audioContext.currentTime >= this.nextPlaybackTime - 0.1) {
                                this.currentStatus = 'Listening';
                                this.updateCallUI('Höre zu...', false);
                            }
                        };
                    } catch (err) {}
                }
            }
        }

        if (data.serverContent?.turnComplete) {
            if (this.currentScreenText && this.currentScreenText.trim().length > 0) { document.dispatchEvent(new CustomEvent('liveAITurnComplete', { detail: this.currentScreenText.trim() })); this.currentScreenText = ''; }
            this.isNewAITurn = true; 
            if (this.currentStatus !== 'Speaking') { this.currentStatus = 'Listening'; this.updateCallUI('Höre zu...', false); }
        }
    }

    processAudioInput(audioProcessingEvent) {
        if (!this.isSessionActive || !this.websocket || this.websocket.readyState !== WebSocket.OPEN || !this.setupCompleteReceived) return;
        
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const inputData = inputBuffer.getChannelData(0); 
        
        // (unveränderte PCM-Logik) ...
        const int16PCM = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) { let s = Math.max(-1, Math.min(1, inputData[i])); int16PCM[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; }
        const base64Audio = this.uint8ArrayToBase64(new Uint8Array(int16PCM.buffer));
        this.websocket.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64Audio }] } }));
    }

    // 🌟 DIE WICHTIGSTE ÄNDERUNG: Zuhör-Schleife für WebGL 🌟
    visualizeUserAudio() {
        if (!this.isSessionActive) return;
        requestAnimationFrame(() => this.visualizeUserAudio()); // Die Schleife läuft...

        if (!this.analyser || !this.dataArray || !this.setupCompleteReceived) return;

        // Wir holen uns die Frequenz-Daten vom Mikrofon
        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
        let average = sum / this.dataArray.length; // Der durchschnittliche Audio-Ausschlag (0-255)

        // 🌟 NEU: Wir schicken die Daten an das WebGL-Viereck!
        if (window.ParticleEngine && this.currentStatus === 'Listening') {
            // Wenn der User spricht, lassen wir das Viereck morphen
            window.ParticleEngine.updateAudio(average, false);
        } else if (window.ParticleEngine && this.currentStatus === 'Speaking') {
            // Wenn die KI spricht, nutzen wir den Shader-Puls
            window.ParticleEngine.updateAudio(average, true);
        } else if (window.ParticleEngine) {
            // Still
            window.ParticleEngine.updateAudio(0, false);
        }

        // UI-Update (unverändert) ...
        const statusText = document.getElementById('call-status-text');
        if (average > 15 && this.currentStatus === 'Listening') { 
            if (statusText && statusText.textContent !== 'Du sprichst Pro Audio...') statusText.textContent = 'Du sprichst Pro Audio...';
            this.lastSpeakTime = Date.now();
        } else if (this.currentStatus === 'Listening') {
            if (this.lastSpeakTime && (Date.now() - this.lastSpeakTime > 800) && (Date.now() - this.lastSpeakTime < 4000)) { if (statusText && statusText.textContent !== 'Coden denkt Pro Audio nach...') statusText.textContent = 'Coden denkt Pro Audio nach...'; } 
            else if (!this.lastSpeakTime || (Date.now() - this.lastSpeakTime >= 4000)) { if (statusText && statusText.textContent !== 'Höre Pro Audio zu...') statusText.textContent = 'Höre Pro Audio zu...'; }
        }
    }

    uint8ArrayToBase64(u8Array) { let binary = ''; const len = u8Array.byteLength; for (let i = 0; i < len; i++) { binary += String.fromCharCode(u8Array[i]); } return window.btoa(binary); }

    updateCallUI(text, isAiSpeaking = false) {
        // Wir aktualisieren nur noch den Text, keine CSS-Pulsationen mehr!
        const statusText = document.getElementById('call-status-text');
        if (statusText) statusText.textContent = text;
    }

    // (unveränderte Close/Error Logik) ...
    handleClose(event, liveCallBtn, liveStatusIndicator) { if (event.code !== 1000 && event.code !== 1005) { const reason = event.reason ? event.reason : "Verbindung getrennt."; this.updateCallUI(`❌ Abbruch (Code ${event.code}): ${reason}`); setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 5000); } else { this.stopSession(liveCallBtn, liveStatusIndicator); } }
    handleError(event, liveCallBtn, liveStatusIndicator) { this.updateCallUI('❌ WebSocket Fehler!'); setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 4000); }

    stopSession(liveCallBtn, liveStatusIndicator) {
        if (!this.isSessionActive) return;
        this.updateCallUI('Aufgelegt Pro Audio.');
        
        // 🌟 NEU: Wir stoppen die WebGL Partikel-Engine, um GPU zu sparen
        if (window.ParticleEngine) window.ParticleEngine.stop();

        if (this.mediaStream) this.mediaStream.getTracks().forEach(track => track.stop()); if (this.audioProcessor) this.audioProcessor.disconnect(); if (this.analyser) this.analyser.disconnect(); if (this.audioContext) this.audioContext.close(); if (this.websocket) this.websocket.close();
        this.websocket = null; this.audioContext = null; this.mediaStream = null; this.audioProcessor = null; this.analyser = null; this.isSessionActive = false; this.setupCompleteReceived = false; this.currentStatus = 'Disconnected'; this.nextPlaybackTime = 0; this.currentScreenText = '';
        const callModal = document.getElementById('live-call-modal'); if (callModal) { setTimeout(() => callModal.classList.add('hidden'), 500); }
    }
}
