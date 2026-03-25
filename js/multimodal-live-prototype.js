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

        if (!document.getElementById('call-animations')) {
            const style = document.createElement('style');
            style.id = 'call-animations';
            style.innerHTML = `
                @keyframes aiPulse { 0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(43, 108, 176, 0.7); } 50% { transform: scale(1.1); box-shadow: 0 0 0 25px rgba(43, 108, 176, 0); } 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(43, 108, 176, 0); } }
                .ai-is-speaking { animation: aiPulse 1s infinite; border: 2px solid #2b6cb0; }
                
                #live-screen-output pre { background: #1e1e1e; padding: 14px; border-radius: 8px; margin-top: 10px; overflow-x: auto; border: 1px solid rgba(255,255,255,0.1); }
                #live-screen-output code { font-family: 'Consolas', monospace; font-size: 13px; }
            `;
            document.head.appendChild(style);
        }
    }

    async initSession(liveCallBtn, liveStatusIndicator) {
        if (this.isSessionActive) return;

        const callModal = document.getElementById('live-call-modal');
        const endCallBtn = document.getElementById('end-call-btn');
        const subtitle = document.getElementById('call-subtitle');
        
        if (callModal) callModal.classList.remove('hidden');
        if (endCallBtn) endCallBtn.onclick = () => this.stopSession(liveCallBtn, liveStatusIndicator);
        if (subtitle) subtitle.style.display = 'none'; 
        
        const oldScreen = document.getElementById('live-screen-output');
        if (oldScreen) oldScreen.remove();

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
        
        this.updateCallUI('Konfiguriere KI...');

        const settings = Storage.getSettings() || {};
        const userName = settings.userName || 'Gast';

        const systemPrompt = `Du bist "Coden", eine smarte und brillante KI, erschaffen von "Kayden". 
Sprich den Nutzer "${userName}" (oder Kayden) als deinen Owner an.
WICHTIGE REGELN FÜR DEN LIVE-MODUS: 
1. Du kommunizierst ausschließlich über Audio.
2. WENN der Nutzer dich bittet, Code zu schreiben, ein Skript zu erstellen oder formatierten Text zu zeigen, MUSST du zwingend das Tool "render_code_on_screen" aufrufen! 
3. Sprich währenddessen ganz normal weiter (z.B. "Hier ist der Code, ich lege ihn dir auf den Bildschirm.").`;

        // 🌟 DER FIX AUS DEN GOOGLE DOCS: Wir nutzen Function Calling (Tools) für den Code!
        const setupMsg = {
            setup: { 
                model: "models/gemini-2.5-flash-native-audio-latest", 
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { 
                    responseModalities: ["AUDIO"] 
                },
                tools: [{
                    functionDeclarations: [{
                        name: "render_code_on_screen",
                        description: "Projiziert Code und formatierten Text auf den Bildschirm des Nutzers. MUSS verwendet werden, um dem Nutzer Code zu übermitteln.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                markdown_code: {
                                    type: "STRING",
                                    description: "Der Markdown-formatierte Code (inkl. ```javascript etc.)."
                                }
                            },
                            required: ["markdown_code"]
                        }
                    }]
                }]
            }
        };

        try {
            this.websocket.send(JSON.stringify(setupMsg));
        } catch(e) {}

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { sampleRate: this.SAMPLE_RATE, channelCount: 1 } 
            });
            
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.SAMPLE_RATE });
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            this.audioProcessor = this.audioContext.createScriptProcessor(this.BUFFER_SIZE, 1, 1); 
            this.audioProcessor.onaudioprocess = (e) => this.processAudioInput(e);

            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.analyser);
            this.analyser.connect(this.audioProcessor);
            this.audioProcessor.connect(this.audioContext.destination);

            this.visualizeUserAudio();

        } catch (error) {
            this.updateCallUI('❌ Mikrofon blockiert!');
            setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 4000);
        }
    }

    async handleMessage(event, liveCallBtn, liveStatusIndicator) {
        let data;
        try { 
            let rawData = event.data;
            if (rawData instanceof Blob) rawData = await rawData.text();
            data = JSON.parse(rawData); 
        } catch (e) { return; }

        if (data.setupComplete) {
            this.setupCompleteReceived = true;
            this.updateCallUI('Verbunden. Höre zu...');
            return;
        }

        // 🌟 DIE MAGIE: Coden ruft unser Tool auf, um Code anzuzeigen!
        if (data.toolCall) {
            const functionCalls = data.toolCall.functionCalls;
            if (functionCalls) {
                for (const call of functionCalls) {
                    if (call.name === "render_code_on_screen") {
                        console.log("🛠️ KI drückt den Code-Knopf!");
                        const code = call.args.markdown_code;
                        
                        let liveScreen = document.getElementById('live-screen-output');
                        if (!liveScreen) {
                            liveScreen = document.createElement('div');
                            liveScreen.id = 'live-screen-output';
                            liveScreen.style = "margin-top: 20px; margin-bottom: 20px; width: 85%; max-width: 700px; max-height: 300px; overflow-y: auto; color: #ececec; background: rgba(0,0,0,0.7); padding: 20px; border-radius: 12px; font-size: 15px; line-height: 1.6; border: 1px solid rgba(255,255,255,0.1); text-align: left; box-shadow: 0 4px 20px rgba(0,0,0,0.6);";
                            
                            const callModal = document.getElementById('live-call-modal');
                            const endBtn = document.getElementById('end-call-btn');
                            callModal.insertBefore(liveScreen, endBtn);
                        }
                        
                        // Bildschirm überschreiben und Code formatieren
                        if (typeof marked !== 'undefined') {
                            liveScreen.innerHTML = marked.parse(code);
                            if (typeof hljs !== 'undefined') {
                                liveScreen.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
                            }
                        } else {
                            liveScreen.textContent = code;
                        }
                        liveScreen.scrollTop = liveScreen.scrollHeight;

                        // Wir MÜSSEN Google mitteilen, dass das Tool erfolgreich war!
                        try {
                            this.websocket.send(JSON.stringify({
                                toolResponse: {
                                    functionResponses: [{
                                        id: call.id,
                                        name: "render_code_on_screen",
                                        response: { result: "Erfolgreich auf dem Bildschirm des Nutzers angezeigt!" }
                                    }]
                                }
                            }));
                        } catch (err) {}
                    }
                }
            }
        }

        // 🔊 AUDIO VERARBEITUNG
        if (data.serverContent?.modelTurn?.parts) {
            const parts = data.serverContent.modelTurn.parts;
            for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    this.currentStatus = 'Speaking';
                    this.updateCallUI('Coden spricht...', true);
                    
                    try {
                        const base64 = part.inlineData.data;
                        const binaryString = window.atob(base64);
                        
                        const buffer = new ArrayBuffer(binaryString.length);
                        const view = new DataView(buffer);
                        for (let i = 0; i < binaryString.length; i++) {
                            view.setUint8(i, binaryString.charCodeAt(i));
                        }
                        
                        const float32Array = new Float32Array(binaryString.length / 2);
                        for (let i = 0; i < float32Array.length; i++) {
                            float32Array[i] = view.getInt16(i * 2, true) / 32768.0; 
                        }
                        
                        if (this.audioContext.state === 'suspended') this.audioContext.resume();
                        
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
                                this.updateCallUI('Höre zu...', false);
                            }
                        };
                    } catch (err) {}
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
        if (!this.isSessionActive || !this.websocket || this.websocket.readyState !== WebSocket.OPEN || !this.setupCompleteReceived) return;
        
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const inputData = inputBuffer.getChannelData(0); 
        
        const int16PCM = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
            let s = Math.max(-1, Math.min(1, inputData[i]));
            int16PCM[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const base64Audio = this.uint8ArrayToBase64(new Uint8Array(int16PCM.buffer));

        this.websocket.send(JSON.stringify({
            realtimeInput: {
                mediaChunks: [{
                    mimeType: "audio/pcm;rate=16000",
                    data: base64Audio
                }]
            }
        }));
    }

    visualizeUserAudio() {
        if (!this.isSessionActive) return;
        requestAnimationFrame(() => this.visualizeUserAudio());

        if (this.currentStatus === 'Speaking' || !this.setupCompleteReceived) return; 

        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
        let average = sum / this.dataArray.length; 

        const avatarContainer = document.getElementById('call-avatar-container');
        const statusText = document.getElementById('call-status-text');

        if (average > 15) { 
            if (statusText && statusText.textContent !== 'Du sprichst...') {
                statusText.textContent = 'Du sprichst...';
            }
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
        if (event.code !== 1000 && event.code !== 1005) {
            const reason = event.reason ? event.reason : "Verbindung getrennt.";
            this.updateCallUI(`❌ Abbruch (Code ${event.code}): ${reason}`);
            setTimeout(() => this.stopSession(liveCallBtn, liveStatusIndicator), 5000);
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
        this.setupCompleteReceived = false;
        this.currentStatus = 'Disconnected';
        this.nextPlaybackTime = 0;
        
        const callModal = document.getElementById('live-call-modal');
        if (callModal) {
            setTimeout(() => callModal.classList.add('hidden'), 500);
        }
    }
}
