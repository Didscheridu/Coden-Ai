// js/pdf-export.js – Reiner Client-Side PDF-Generator (JPEG-Bilder → mehrseitiges A4-PDF ohne externe Bibliotheken).
// Funktioniert offline, auf iPadOS Safari und in iFrames ohne Druckdialog-Blockade.

const enc = new TextEncoder();

function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export function jpegDimensions(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
        return null;
    }
    let i = 2;
    while (i + 3 < bytes.length) {
        if (bytes[i] !== 0xFF) { i++; continue; }
        while (i < bytes.length && bytes[i] === 0xFF) i++;
        if (i >= bytes.length) break;
        const marker = bytes[i++];
        if (marker === 0xD9 || marker === 0xDA) break;
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
        if (i + 1 >= bytes.length) break;
        const len = (bytes[i] << 8) | bytes[i + 1];
        if (len < 2 || i + len > bytes.length) break;
        if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
            if (i + 6 < bytes.length) {
                const h = (bytes[i + 3] << 8) | bytes[i + 4];
                const w = (bytes[i + 5] << 8) | bytes[i + 6];
                if (w > 0 && h > 0) return { width: w, height: h };
            }
        }
        i += len;
    }
    return null;
}

/**
 * Erzeugt aus einer Liste von JPEG-Data-URLs eine gültige PDF-1.4-Datei (Standard A4: 595.28 × 841.89 pt).
 * @param {Array<string|{dataUrl:string,widthPt?:number,heightPt?:number}>} frames
 * @returns {Uint8Array}
 */
export function buildPdfBytes(frames) {
    const list = (Array.isArray(frames) ? frames : [])
        .map(f => (typeof f === 'string' ? { dataUrl: f } : f))
        .filter(f => f && typeof f.dataUrl === 'string' && /^data:image\/jpe?g;base64,/i.test(f.dataUrl));

    if (!list.length) throw new Error('Keine gültigen JPEG-Seiten für den PDF-Export.');

    const chunks = [];
    let offset = 0;
    const pushBytes = (u8) => { chunks.push(u8); offset += u8.length; };
    const pushStr = (s) => pushBytes(enc.encode(s));

    pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const objOffsets = new Map();
    const startObj = (id) => {
        objOffsets.set(id, offset);
        pushStr(`${id} 0 obj\n`);
    };
    const endObj = () => pushStr('\nendobj\n');

    // Objekt-IDs:
    // 1 = Catalog, 2 = Pages
    // Je Seite i (0..N-1): pageId = 3 + i*3, contentId = 4 + i*3, imageId = 5 + i*3
    const pageIds = list.map((_, i) => 3 + i * 3);

    startObj(1);
    pushStr('<< /Type /Catalog /Pages 2 0 R >>');
    endObj();

    startObj(2);
    pushStr(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    endObj();

    list.forEach((frame, i) => {
        const b64 = frame.dataUrl.split(',')[1] || '';
        const jpeg = base64ToBytes(b64);
        const dim = jpegDimensions(jpeg) || { width: 1240, height: 1754 };

        // Standard-A4 im Hoch- oder Querformat je nach Seitenverhältnis
        const isLandscape = dim.width > dim.height * 1.05;
        const pageW = Number.isFinite(frame.widthPt) ? frame.widthPt : (isLandscape ? 841.89 : 595.28);
        const pageH = Number.isFinite(frame.heightPt) ? frame.heightPt : (isLandscape ? 595.28 : 841.89);

        // Bild proportional zentriert einpassen
        const sc = Math.min(pageW / dim.width, pageH / dim.height);
        const drawW = (dim.width * sc).toFixed(2);
        const drawH = (dim.height * sc).toFixed(2);
        const drawX = ((pageW - dim.width * sc) / 2).toFixed(2);
        const drawY = ((pageH - dim.height * sc) / 2).toFixed(2);

        const pageId = 3 + i * 3;
        const contentId = 4 + i * 3;
        const imageId = 5 + i * 3;
        const imgName = `/Im${i}`;

        const streamStr = `q\n${drawW} 0 0 ${drawH} ${drawX} ${drawY} cm\n${imgName} Do\nQ\n`;
        const streamBytes = enc.encode(streamStr);

        startObj(pageId);
        pushStr(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << ${imgName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
        endObj();

        startObj(contentId);
        pushStr(`<< /Length ${streamBytes.length} >>\nstream\n`);
        pushBytes(streamBytes);
        pushStr('endstream');
        endObj();

        startObj(imageId);
        pushStr(`<< /Type /XObject /Subtype /Image /Width ${dim.width} /Height ${dim.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
        pushBytes(jpeg);
        pushStr('\nendstream');
        endObj();
    });

    const totalObjs = 2 + list.length * 3;
    const xrefOffset = offset;
    pushStr(`xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= totalObjs; id++) {
        const off = objOffsets.get(id) ?? 0;
        pushStr(`${String(off).padStart(10, '0')} 00000 n \n`);
    }
    pushStr(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    const totalLen = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
        out.set(c, pos);
        pos += c.length;
    }
    return out;
}

export function buildPdfBlob(frames) {
    return new Blob([buildPdfBytes(frames)], { type: 'application/pdf' });
}

export function safePdfFilename(name, fallback = 'Notizbuch') {
    const clean = String(name || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    const base = clean || fallback;
    return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

export function downloadPdfBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safePdfFilename(filename);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
