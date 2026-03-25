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
        this.systemInstructionSent = false;
        this.nextPlaybackTime = 0; 

        if (!document.getElementById('call-animations')) {
            const style = document.createElement('style');
            style.id = 'call-animations';
            style.innerHTML = `
                @keyframes aiPulse { 0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(43, 108, 176, 0.7); } 50% { transform: scale(1.1); box-shadow: 0 0 0 25px rgba(43, 108, 176, 0); } 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(43, 108, 176, 0); } }
                .ai-is-speaking { animation: aiPulse 1s infinite; border: 2px solid #2b6cb0; }
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
        this.currentStatus = 'Listening';
        this.systemInstructionSent = false;
        this.lastSpeakTime = null;
        this.nextPlaybackTime = 0; 
        
        this.updateCallUI('Greife auf Mikrofon zu...');

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { sampleRate: this.SAMPLE_RATE, channelCount: 1 } 
            });
            
            // AudioContext erstellen (wird oft vom Browser pausiert gestartet!)
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.SAMPLE_RATE });
            
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            // Hinweis: Die Deprecation-Warnung hier im Browser ist normal und beeinträchtigt die Funktion nicht!
            this.audioProcessor = this.audioContext.createScriptProcessor(this.BUFFER_SIZE, 1, 1); 
            this.audioProcessor.onaudioprocess = (e) => this.processAudioInput(e);

            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.analyser);
            this.analyser.connect(this.audioProcessor);
            this.audioProcessor.connect(this.audioContext.destination); // Sendet intern 0 Volume, hält aber den Loop am Leben

            this.updateCallUI('Verbunden. Höre zu...');
            this.visualizeUserAudio();

        } catch (error) {
            console.error(error);
            this.updateCallUI('❌ Mikrofon blockiert!');
            setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 4000);
        }
    }

    visualizeUserAudio() {
        if (!this.isSessionActive) return;
        requestAnimationFrame(() => this.visualizeUserAudio());

        if (this.currentStatus === 'Speaking') return; 

        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
        let average = sum / this.dataArray.length; 

        const avatarContainer = document.getElementById('call-avatar-container');
        const statusText = document.getElementById('call-status-text');

        if (average > 15) { 
            if (statusText && statusText.textContent !== 'Du sprichst...') statusText.textContent = 'Du sprichst...';
            if (avatarContainer) {
                const scale = 1 + (average / 255) * 0.4;
                avatarContainer.style.transform = `scale(${scale})`;
                avatarContainer.style.boxShadow = `0 0 ${average * 1.5}px rgba(43, 108, 176, 0.8)`;
            }
            this.lastSpeakTime = Date.now();
        } else {
            if (avatarContainer) {
                avatarContainer.style.transform = 'scale(1)';
                avatarContainer.style.boxShadow = '0 0 30px rgba(43, 108, 176, 0.5)';
            }
            
            if (this.lastSpeakTime && (Date.now() - this.lastSpeakTime > 800) && (Date.now() - this.lastSpeakTime < 4000)) {
               if (statusText && statusText.textContent !== 'Coden denkt nach...') statusText.textContent = 'Coden denkt nach...';
            } else if (!this.lastSpeakTime || (Date.now() - this.lastSpeakTime >= 4000)) {
               if (statusText && statusText.textContent !== 'Höre zu...') statusText.textContent = 'Höre zu...';
            }
        }
    }

    handleMessage(event, liveCallBtn, liveStatusIndicator) {
        let data;
        try { data = JSON.parse(event.data); } catch (e) { return; }

        if (data.serverContent?.modelTurn?.parts) {
            const parts = data.serverContent.modelTurn.parts;
            for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    
                    this.currentStatus = 'Speaking';
                    this.updateCallUI('Coden spricht...', true);
                    
                    // 🚀 KUGELSICHERER AUDIO DECODER
                    try {
                        const base64 = part.inlineData.data;
                        const binaryString = window.atob(base64);
                        console.log(`🔊 [AUDIO IN]: Chunk mit ${binaryString.length} Bytes erhalten.`);
                        
                        const buffer = new ArrayBuffer(binaryString.length);
                        const view = new DataView(buffer);
                        
                        // Bytes exakt einlesen
                        for (let i = 0; i < binaryString.length; i++) {
                            view.setUint8(i, binaryString.charCodeAt(i));
                        }
                        
                        // In Float32 umwandeln (Browser-Format)
                        const float32Array = new Float32Array(binaryString.length / 2);
                        for (let i = 0; i < float32Array.length; i++) {
                            // true = Little Endian (WICHTIG für Google Audio!)
                            float32Array[i] = view.getInt16(i * 2, true) / 32768.0; 
                        }
                        
                        // 🚀 FORCE RESUME: Den Browser zwingen, den Lautsprecher anzuschalten
                        if (this.audioContext.state === 'suspended') {
                            console.log("🔊 [AUDIO WAKE UP]: Wecke den AudioContext auf...");
                            this.audioContext.resume();
                        }
                        
                        // Audio abspielen
                        const audioBuffer = this.audioContext.createBuffer(1, float32Array.length, 24000);
                        audioBuffer.getChannelData(0).set(float32Array);
                        
                        const source = this.audioContext.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(this.audioContext.destination);
                        
                        if (this.nextPlaybackTime < this.audioContext.currentTime) {
                            this.nextPlaybackTime = this.audioContext.currentTime;
                        }
                        source.start(this.nextPlaybackTime);
                        this.nextPlaybackTime += audioBuffer.duration;
                        
                        source.onended = () => {
                            if (this.audioContext.currentTime >= this.nextPlaybackTime - 0.1) {
                                this.currentStatus = 'Listening';
                                this.lastSpeakTime = null; 
                                this.updateCallUI('Höre zu...', false);
                            }
                        };
                    } catch (err) {
                        console.error("❌ Audio Decode Fehler:", err);
                    }
                }
            }
        }

        if (data.serverContent?.turnComplete) {
            if (this.currentStatus !== 'Speaking') {
                this.currentStatus = 'Listening';
                this.updateCallUI('Höre zu...', false);
            }
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
            
            this.websocket.send(JSON.stringify({
                setup: { 
                    model: "models/gemini-2.5-flash-native-audio-latest", 
                    systemInstruction: { parts: [{ text: `Du bist Coden, eine KI. Nutzer: ${userName}. Sprich natürlich, freundlich und empathisch über Audio. Antworte in kurzen, klaren Sätzen.` }] },
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

    updateCallUI(text, isAiSpeaking = false) {
        const statusText = document.getElementById('call-status-text');
        const avatarContainer = document.getElementById('call-avatar-container');
        if (statusText) statusText.textContent = text;
        
        if (avatarContainer) {
            if (isAiSpeaking) avatarContainer.classList.add('ai-is-speaking');
            else avatarContainer.classList.remove('ai-is-speaking');
        }
    }

    handleClose(event, liveCallBtn, liveStatusIndicator) {
        console.log("🔊 [NATIVE AUDIO]: WebSocket getrennt.", event);
        const reason = event.reason ? event.reason : "Google hat die Verbindung unerwartet getrennt.";
        
        if (event.code !== 1000 && event.code !== 1005) {
            this.updateCallUI(`❌ Abbruch (Code ${event.code}): ${reason}`);
            setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 6000);
        } else {
            this.stopSession(liveCallBtn, liveStatusIndicator);
        }
    }

    handleError(event, liveCallBtn, liveStatusIndicator) {
        this.updateCallUI('❌ WebSocket Fehler!');
        setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 4000);
    }

    stopSession(liveCallBtn, liveStatusIndicator) {
        if (!this.isSessionActive) return;
        
        this.updateCallUI('Aufgelegt.');
        
        if (this.mediaStream) this.mediaStream.getTracks().forEach(track => track.stop());
        if (this.audioProcessor) this.audioProcessor.disconnect();
        if (this.analyser) this.analyser.disconnect();
        if (this.audioContext) this.audioContext.close();
        if (this.websocket) this.websocket.close();

        this.websocket = null; this.audioContext = null; this.mediaStream = null; this.audioProcessor = null; this.analyser = null;
        this.isSessionActive = false;
        this.systemInstructionSent = false;
        this.currentStatus = 'Disconnected';
        this.nextPlaybackTime = 0;
        
        const callModal = document.getElementById('live-call-modal');
        if (callModal) {
            setTimeout(() => callModal.classList.add('hidden'), 500);
        }
    }
}
