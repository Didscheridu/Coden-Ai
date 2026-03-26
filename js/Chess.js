// js/Chess.js
import { generateAiResponse } from './api.js';

export class ChessEngine {
    constructor() {
        this.board = null;
        this.game = new Chess();
        this.isAiThinking = false;
        this.currentSelectedModel = 'normal'; // Standardmäßig nutzen wir ein starkes Modell
    }

    init() {
        const config = {
            draggable: true,
            position: 'start',
            onDragStart: this.onDragStart.bind(this),
            onDrop: this.onDrop.bind(this),
            onSnapEnd: this.onSnapEnd.bind(this),
            
            // 🔥 DER FIX: Wir laden die Figuren direkt aus dem Web!
            pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
        };
        
        // Initialisiert das Board aus der chessboard.js Library
        this.board = Chessboard('myBoard', config);
        
        document.getElementById('reset-chess-btn').addEventListener('click', () => {
            this.game.reset();
            this.board.start();
            this.updateStatus("Du bist dran! (Weiß)", "Mache deinen ersten Zug.");
        });

        document.getElementById('close-chess-btn').addEventListener('click', () => {
            document.getElementById('chess-modal').classList.add('hidden');
        });
    }

    onDragStart(source, piece, position, orientation) {
        // KI denkt nach oder Spiel ist vorbei? Ziehen verboten!
        if (this.game.game_over() || this.isAiThinking) return false;
        // Nur weiße Figuren dürfen gezogen werden
        if (piece.search(/^b/) !== -1) return false;
    }

    async onDrop(source, target) {
        // Zug ausprobieren
        let move = this.game.move({
            from: source,
            to: target,
            promotion: 'q' // Bauern immer in Dame umwandeln
        });

        // Ungültiger Zug? Figur springt zurück
        if (move === null) return 'snapback';

        // Gültiger Zug!
        this.updateStatus("Coden denkt nach...", "Analysiere deinen Zug...");
        this.isAiThinking = true;

        await this.letAiPlay(move.san);
    }

    onSnapEnd() {
        this.board.position(this.game.fen());
    }

    async letAiPlay(userMove) {
        // Das Brett als Code
        const currentFen = this.game.fen();
        
        const prompt = `Du bist Coden, ein Schach-Großmeister und Mentor.
Das aktuelle Schachbrett im FEN-Format lautet: ${currentFen}
Der Nutzer hat als Weiß gerade diesen Zug gespielt: ${userMove}

DEINE AUFGABE:
1. Analysiere den Zug des Nutzers in 1-2 kurzen Sätzen. War er gut? Wenn er schlecht war, erkläre warum und was besser gewesen wäre.
2. Überlege dir deinen besten Gegenzug (als Schwarz) und gib ihn in Standard Algebraic Notation (SAN) aus (z.B. Nf6, e5, O-O). Du MUSST einen legalen Zug spielen!

ANTWORTE AUSSCHLIESSLICH IN DIESEM JSON-FORMAT:
{
    "analysis": "Deine Mentor-Analyse hier...",
    "aiMove": "Dein Gegenzug (z.B. e5)"
}`;

        try {
            // Wir schicken den Prompt als JSON-Anfrage an die API
            const responseText = await generateAiResponse([{ role: 'user', content: prompt }], this.currentSelectedModel);
            
            // JSON säubern (manchmal packen KIs Markdown-Codeblöcke drumherum)
            const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const aiData = JSON.parse(cleanJson);
            
            if (aiData.aiMove) {
                // KI führt den Zug aus
                let moveResult = this.game.move(aiData.aiMove);
                
                if (moveResult === null) {
                    // Fallback, falls die KI einen ungültigen Zug halluziniert hat
                    this.updateStatus("Fehler", "Coden hat einen illegalen Zug versucht. Er ist noch im Training!");
                    this.game.undo(); // User-Zug zurücknehmen
                    this.board.position(this.game.fen());
                } else {
                    this.board.position(this.game.fen());
                    this.updateStatus("Du bist dran!", aiData.analysis + `<br><br><b>Coden spielte:</b> ${aiData.aiMove}`);
                }
            }
            
            if (this.game.in_checkmate()) {
                this.updateStatus("Schachmatt!", "Das Spiel ist vorbei.");
            }

        } catch (error) {
            console.error("Schach AI Fehler:", error);
            this.updateStatus("Fehler", "Verbindung zum Schach-Server abgebrochen. Versuche es nochmal.");
            this.game.undo(); // User-Zug zurücknehmen
            this.board.position(this.game.fen());
        }
        
        this.isAiThinking = false;
    }

    updateStatus(title, text) {
        const statusEl = document.getElementById('chess-status');
        const feedbackEl = document.getElementById('chess-feedback');
        
        statusEl.innerHTML = title;
        feedbackEl.innerHTML = text;
        
        if (title.includes("denkt")) {
            statusEl.classList.add('chess-loading');
        } else {
            statusEl.classList.remove('chess-loading');
        }
    }
}
