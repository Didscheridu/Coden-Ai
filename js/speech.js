// js/speech.js – Sprachausgabe (SpeechSynthesis) für KI-Antworten inkl. Erklärung & generiertem Code
import { stripMarks } from './rich-elements.js';

export function speakableCode(code, lang = '') {
    const cleanLines = String(code || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => line
            .replace(/\t/g, ' ')
            .replace(/^\s*([/*#;-]{3,})\s*$/, '')
            .replace(/\s+/g, ' ')
            .trim()
        )
        .filter(Boolean);

    if (!cleanLines.length) return '';

    const joined = cleanLines
        .map(line => (/[.!?;:,]$/.test(line) ? line : `${line},`))
        .join(' ')
        .replace(/,+$/, '.');

    const head = lang ? `Code (${lang}):` : 'Code:';
    return `${head} ${joined}`;
}

export function toSpeakableText(rawText) {
    let text = stripMarks(String(rawText || ''))
        .replace(/<(suggestions|choices|remember|think|notebook_read|notebook_write|spotifycard)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(notebook_read)\b[^>]*\/?>/gi, '');

    // Fenced code blocks & artifact blocks erhalten und sprachlich sauber strukturieren
    const blocks = [];
    const hold = (spoken) => {
        const idx = blocks.push(spoken) - 1;
        return `\n@@SPEAKBLOCK${idx}@@\n`;
    };

    text = text.replace(/<artifact\b([^>]*)>([\s\S]*?)<\/artifact>/gi, (_, attrs, body) => {
        const title = (attrs.match(/\btitle\s*=\s*"([^"]*)"/i)?.[1] || attrs.match(/\btitle\s*=\s*'([^']*)'/i)?.[1] || '').trim();
        const type = (attrs.match(/\btype\s*=\s*"([^"]*)"/i)?.[1] || '').trim();
        const prefix = title ? `Artefakt ${title}:` : (type ? `Artefakt (${type}):` : 'Artefakt:');
        const inner = body.trim();
        const spokenBody = type === 'markdown' ? toSpeakableText(inner) : speakableCode(inner, type && type !== 'code' ? '' : '');
        return hold(spokenBody ? `${prefix} ${spokenBody.replace(/^Code:\s*/, '')}` : prefix);
    });

    text = text.replace(/```([A-Za-z0-9_+#.-]*)[ \t]*\r?\n([\s\S]*?)```/g, (_, lang, code) => {
        return hold(speakableCode(code, String(lang || '').trim()));
    });

    // Inline-Code & Markdown-Formatierung für flüssiges Vorlesen bereinigen
    text = text
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => (alt ? `Bild: ${alt}.` : ''))
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`\n]+)`/g, '$1')
        .replace(/\$\$([\s\S]+?)\$\$/g, '$1')
        .replace(/\$([^$\n]+)\$/g, '$1')
        .replace(/^\s{0,3}>+\s?/gm, '')
        .replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '$1.')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*[-*_]{3,}\s*$/gm, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[*_~|]/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .replace(/[ \t]{2,}/g, ' ');

    text = text.replace(/@@SPEAKBLOCK(\d+)@@/g, (_, idx) => blocks[Number(idx)] || '');

    return text
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function detectSpeechLang(text) {
    const prose = String(text || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`\n]*`/g, ' ');
    if (/[äöüßÄÖÜ]|\b(der|die|das|und|ist|ein|eine|mit|für|auf|nicht|ich|du|wir|wie|was|hier|diese|kann|wird|auch|oder)\b/i.test(prose)) {
        return 'de-DE';
    }
    if (/\b(the|and|is|are|this|that|with|for|you|here|below|returns|creates|explains)\b/i.test(prose)) {
        return 'en-US';
    }
    return 'de-DE';
}

export function splitSpeechChunks(text, maxLen = 220) {
    const clean = String(text || '').trim();
    if (!clean) return [];
    const limit = Math.max(40, Number(maxLen) || 220);
    const chunks = [];

    const pushPiece = (piece) => {
        let rest = piece.trim();
        while (rest.length > limit) {
            let cut = -1;
            for (const sep of ['. ', '! ', '? ', '; ', ', ', ' ']) {
                const pos = rest.lastIndexOf(sep, limit);
                if (pos > limit * 0.35) {
                    cut = pos + sep.trimEnd().length;
                    break;
                }
            }
            if (cut <= 0) cut = limit;
            const head = rest.slice(0, cut).trim();
            if (head) chunks.push(head);
            rest = rest.slice(cut).trim();
        }
        if (rest) chunks.push(rest);
    };

    const paragraphs = clean.split(/\n+/);
    for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        const sentences = trimmed.match(/[^.!?]+(?:[.!?]+|$)/g) || [trimmed];
        let buf = '';
        for (const s of sentences) {
            const part = s.trim();
            if (!part) continue;
            if (!buf) {
                if (part.length > limit) pushPiece(part);
                else buf = part;
            } else if (buf.length + 1 + part.length <= limit) {
                buf += ' ' + part;
            } else {
                chunks.push(buf);
                if (part.length > limit) {
                    pushPiece(part);
                    buf = '';
                } else {
                    buf = part;
                }
            }
        }
        if (buf) chunks.push(buf);
    }

    return chunks;
}

function pickVoice(synth, lang) {
    try {
        const voices = synth.getVoices?.() || [];
        if (!voices.length) return null;
        const prefix = String(lang || 'de-DE').split('-')[0].toLowerCase();
        return voices.find(v => String(v.lang || '').toLowerCase() === String(lang).toLowerCase())
            || voices.find(v => String(v.lang || '').toLowerCase().startsWith(prefix))
            || null;
    } catch (_) {
        return null;
    }
}

export function createSpeechController({
    getSynth = () => (typeof window !== 'undefined' ? window.speechSynthesis : null),
    getUtterance = () => (typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null),
    chunkSize = 220
} = {}) {
    let activeKey = null;
    let playbackToken = 0;
    let activeCallbacks = null;

    function clearState({ notifyEnd = false } = {}) {
        const cb = activeCallbacks;
        activeKey = null;
        activeCallbacks = null;
        if (notifyEnd) cb?.onEnd?.();
    }

    function stop() {
        playbackToken++;
        const synth = getSynth();
        try { synth?.cancel?.(); } catch (_) {}
        clearState({ notifyEnd: true });
    }

    function speak(rawText, { key = null, lang, rate = 1, raw = false, onStart, onEnd, onError } = {}) {
        const synth = getSynth();
        const Utterance = getUtterance();
        if (!synth || typeof synth.speak !== 'function' || typeof Utterance !== 'function') {
            onError?.('unsupported');
            return false;
        }

        const spoken = raw ? String(rawText || '').trim() : toSpeakableText(rawText);
        if (!spoken) {
            onError?.('empty');
            return false;
        }

        const wasSameKey = key !== null && key === activeKey;
        stop();
        if (wasSameKey) return false;

        const targetLang = lang || detectSpeechLang(rawText);
        const chunks = splitSpeechChunks(spoken, chunkSize);
        if (!chunks.length) {
            onError?.('empty');
            return false;
        }

        const token = ++playbackToken;
        activeKey = key;
        activeCallbacks = { onEnd, onError };
        const voice = pickVoice(synth, targetLang);
        let index = 0;

        const speakNext = () => {
            if (token !== playbackToken) return;
            if (index >= chunks.length) {
                clearState({ notifyEnd: true });
                return;
            }
            const u = new Utterance(chunks[index++]);
            u.lang = targetLang;
            u.rate = rate;
            if (voice) u.voice = voice;
            u.onend = () => {
                if (token !== playbackToken) return;
                speakNext();
            };
            u.onerror = (ev) => {
                if (token !== playbackToken) return;
                const reason = String(ev?.error || '').toLowerCase();
                if (reason === 'canceled' || reason === 'interrupted') {
                    clearState({ notifyEnd: true });
                    return;
                }
                const errCb = activeCallbacks?.onError;
                clearState({ notifyEnd: true });
                errCb?.(reason || 'error');
            };
            try {
                synth.speak(u);
            } catch (err) {
                const errCb = activeCallbacks?.onError;
                clearState({ notifyEnd: true });
                errCb?.(err?.message || 'error');
            }
        };

        onStart?.();
        speakNext();
        return true;
    }

    return {
        speak,
        stop,
        isSpeaking: () => activeKey !== null,
        currentKey: () => activeKey
    };
}
