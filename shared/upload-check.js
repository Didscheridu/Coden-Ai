// Prüft hochgeladene Dateien, bevor sie irgendwo verarbeitet werden. Läuft im Browser (window.CodenUpload) und im Backend (require).
// Grundsatz: Es werden nur Bilder (PNG, JPEG, GIF, WebP) und reine Textdateien angenommen. Alles, was ausführbar,
// gepackt, ein Office-Dokument mit Makros oder sonst binär ist, wird abgelehnt – egal, wie die Datei heißt.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api; else root.CodenUpload = api;
})(typeof self !== 'undefined' ? self : this, function () {
    const MAX_BYTES = 15 * 1024 * 1024;
    const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

    // Endungen, die auf Programme, Installer, Skripte zum Doppelklicken, Makro-Dokumente oder Archive hindeuten
    const BLOCKED_EXT = new Set(('exe dll sys drv ocx msi msp mst com scr pif cpl lnk bat cmd vbs vbe jse wsf wsh hta jar apk ipa dmg pkg app deb rpm iso img bin so dylib reg gadget chm cab ' +
        'docm xlsm pptm dotm xlam xlsb ppam sldm zip rar 7z gz tgz tar bz2 xz zst pdf swf class msix appx').split(' '));
    const IMAGE_MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
    const IMAGE_EXT = { png: ['png'], jpeg: ['jpg', 'jpeg', 'jpe', 'jfif'], gif: ['gif'], webp: ['webp'] };

    const at = (b, i) => (i < b.length ? b[i] : -1);
    const starts = (b, sig, off = 0) => sig.every((v, i) => at(b, off + i) === v);
    const ascii = (b, off, len) => String.fromCharCode(...Array.from(b.subarray(off, off + len)));

    // Erkennt den echten Dateityp an den ersten Bytes
    function sniff(b) {
        if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
        if (starts(b, [0xff, 0xd8, 0xff])) return 'jpeg';
        if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'gif';
        if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
        if (starts(b, [0x4d, 0x5a])) return 'exe';                                   // Windows-Programm (MZ)
        if (starts(b, [0x7f, 0x45, 0x4c, 0x46])) return 'elf';                       // Linux-Programm
        if (starts(b, [0xfe, 0xed, 0xfa, 0xce]) || starts(b, [0xfe, 0xed, 0xfa, 0xcf]) || starts(b, [0xce, 0xfa, 0xed, 0xfe]) || starts(b, [0xcf, 0xfa, 0xed, 0xfe]) || starts(b, [0xca, 0xfe, 0xba, 0xbe])) return 'macho'; // macOS / Java-Klasse
        if (starts(b, [0x50, 0x4b, 0x03, 0x04]) || starts(b, [0x50, 0x4b, 0x05, 0x06]) || starts(b, [0x50, 0x4b, 0x07, 0x08])) return 'zip';   // ZIP, JAR, APK, DOCX …
        if (ascii(b, 0, 4) === 'Rar!') return 'rar';
        if (starts(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
        if (starts(b, [0x1f, 0x8b])) return 'gzip';
        if (starts(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';  // altes Office / MSI
        if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
        if (ascii(b, 0, 4) === 'MSCF') return 'cab';
        if (ascii(b, 0, 2) === 'MZ') return 'exe';
        return null;
    }
    const KIND_LABEL = { exe: 'ein Windows-Programm', elf: 'ein Linux-Programm', macho: 'ein Programm', zip: 'ein Archiv (ZIP/Office/APK)', rar: 'ein Archiv', '7z': 'ein Archiv', gzip: 'ein Archiv', ole: 'ein altes Office-Dokument oder Installer', pdf: 'ein PDF', cab: 'ein Archiv' };

    // Sieht der Inhalt wie normaler Text aus? (keine Null-Bytes, kaum Steuerzeichen; Latin-1/ANSI-Texte sind okay)
    function looksLikeText(b) {
        const n = Math.min(b.length, 16384); let ctrl = 0;
        for (let i = 0; i < n; i++) { const c = b[i]; if (c === 0) return false; if (c < 9 || (c > 13 && c < 32 && c !== 27)) ctrl++; }
        if (n && ctrl / n > 0.02) return false;
        return true;
    }

    const EICAR = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';
    const cleanName = (name) => String(name || 'datei').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'datei';

    // inspect({ name, size, bytes: Uint8Array, type }) -> { ok, kind: 'image'|'text', mime?, name } | { ok: false, reason }
    function inspect({ name, size, bytes, type = '' }) {
        const raw = String(name || '');
        const fail = (reason) => ({ ok: false, reason, name: cleanName(raw) });
        if (/[‪-‮⁦-⁩\u0000-\u001f]/.test(raw)) return fail('Der Dateiname enthält versteckte Zeichen (so werden Dateiendungen vorgetäuscht).');
        const nm = cleanName(raw); const parts = nm.toLowerCase().split('.'); const exts = parts.slice(1);
        const last = exts[exts.length - 1] || '';
        if (BLOCKED_EXT.has(last)) return fail(`.${last}-Dateien werden aus Sicherheitsgründen nicht angenommen.`);
        if (exts.slice(0, -1).some(x => BLOCKED_EXT.has(x) && x !== 'app')) return fail('Verdächtiger Dateiname mit doppelter Endung.');
        const len = typeof size === 'number' ? size : bytes.length;
        if (len > MAX_BYTES || bytes.length > MAX_BYTES) return fail('Die Datei ist zu groß (höchstens 15 MB).');
        if (!bytes.length) return fail('Die Datei ist leer.');
        const real = sniff(bytes);
        if (real && IMAGE_MIME[real]) {
            if (!(IMAGE_EXT[real] || []).includes(last) && last) return fail(`Die Endung .${last} passt nicht zum Inhalt (ist eigentlich ${real.toUpperCase()}).`);
            if (type && type !== IMAGE_MIME[real] && type.startsWith('image/')) return fail('Der Dateityp stimmt nicht mit dem Inhalt überein.');
            return { ok: true, kind: 'image', mime: IMAGE_MIME[real], name: nm };
        }
        if (real) return fail(`Diese Datei ist ${KIND_LABEL[real] || 'keine Text- oder Bilddatei'} und wird nicht angenommen.`);
        if (type.startsWith('image/') && type !== 'image/svg+xml') return fail('Das ist kein gültiges Bild (erlaubt: PNG, JPG, GIF, WebP).');
        if (!looksLikeText(bytes)) return fail('Das sieht nach einer Binärdatei aus. Erlaubt sind nur Bilder und Textdateien (Code, TXT, JSON, CSV, Markdown …).');
        const head = ascii(bytes, 0, Math.min(bytes.length, 4096));
        if (head.includes(EICAR)) return fail('Die Datei enthält die Signatur einer Virus-Testdatei und wurde blockiert.');
        return { ok: true, kind: 'text', name: nm };
    }

    function decodeBase64(s) {
        if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
        const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
    }

    // Für Bilder, die als data:-URL zum Server geschickt werden
    function inspectImageDataUrl(url) {
        const m = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ''));
        if (!m) return { ok: false, reason: 'Nur PNG-, JPG-, GIF- und WebP-Bilder sind erlaubt.' };
        if (m[2].length > MAX_IMAGE_BYTES * 1.4) return { ok: false, reason: 'Das Bild ist zu groß.' };
        let bytes; try { bytes = decodeBase64(m[2]); } catch (e) { return { ok: false, reason: 'Ungültige Bilddaten.' }; }
        if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'Das Bild ist zu groß.' };
        if (sniff(bytes) !== m[1]) return { ok: false, reason: 'Der Bildinhalt passt nicht zum Bildtyp.' };
        return { ok: true, mime: 'image/' + m[1] };
    }

    return { inspect, inspectImageDataUrl, sniff, looksLikeText, MAX_BYTES, MAX_IMAGE_BYTES, BLOCKED_EXT };
});
