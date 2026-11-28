// js/doc-export.js – Clientseitige Schul- & Arbeits-Exporte ohne externe CDNs:
// 1) Gültige Word-Dateien (.docx via reinem Stored-ZIP + OOXML)
// 2) Saubere formatierte PDF-Referate/Dokumente (via Canvas + js/pdf-export.js)
// 3) Präsentations-Folien (<artifact type="slides">)-Konverter
// 4) Automatische Zitier- & Quellenverzeichnis-Formatierung (Schule / APA / Harvard)

import { buildPdfBlob, downloadPdfBlob, safePdfFilename } from './pdf-export.js';

const enc = new TextEncoder();

// ---------- Text-Bereinigung ----------
export function cleanExportMarkdown(raw) {
    return String(raw || '')
        .replace(/<(?:suggestions|choices|remember|think|web_search|use_skill|mcp_call|app_write|browser_open|browser_action|notebook_read|spotify|spotifycard)\b[^>]*>[\s\S]*?(?:<\/[a-z_]+>|\/>)/gi, '')
        .replace(/<browser\b[^>]*>([\s\S]*?)<\/browser>/gi, '')
        .replace(/<artifact\b[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/artifact>/gi, (_, t, b) => `\n## ${t || 'Artefakt'}\n\n${b}\n`)
        .replace(/<handwriting\b[^>]*>([\s\S]*?)<\/handwriting>/gi, (_, b) => `\n${b}\n`)
        .replace(/==(?!\s)(?:[A-Za-zÄÖÜäöüß]+:)?([^\n=]+?)==/g, '$1')
        .replace(/\{\{\s*[A-Za-zÄÖÜäöüß]+\s*:\s*([^\n}]+?)\s*\}\}/g, '$1')
        .replace(/data:image\/[^"'\s)\]]+/g, '[Bild]')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function safeExportFilename(name, ext = 'docx', fallback = 'Coden-Dokument') {
    const clean = String(name || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    const base = (clean || fallback).slice(0, 72);
    const re = new RegExp(`\\.${ext}$`, 'i');
    return re.test(base) ? base : `${base}.${ext}`;
}

// ---------- Markdown -> strukturierte Blöcke ----------
export function parseMarkdownBlocks(markdown) {
    const lines = cleanExportMarkdown(markdown).split(/\r?\n/);
    const blocks = [];
    let para = [];
    let inCode = false;
    let codeBuf = [];

    const flushPara = () => {
        if (!para.length) return;
        blocks.push({ type: 'p', text: para.join(' ').trim() });
        para = [];
    };

    for (const rawLine of lines) {
        const line = rawLine.replace(/\t/g, '  ');
        if (/^\s*```/.test(line)) {
            flushPara();
            if (inCode) {
                blocks.push({ type: 'code', text: codeBuf.join('\n') });
                codeBuf = [];
                inCode = false;
            } else {
                inCode = true;
            }
            continue;
        }
        if (inCode) {
            codeBuf.push(rawLine);
            continue;
        }
        const trimmed = line.trim();
        if (!trimmed) {
            flushPara();
            continue;
        }
        if (/^---+$/.test(trimmed)) {
            flushPara();
            blocks.push({ type: 'hr' });
            continue;
        }
        const hm = trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (hm) {
            flushPara();
            blocks.push({ type: `h${hm[1].length}`, text: stripInlineMd(hm[2]) });
            continue;
        }
        const bm = trimmed.match(/^[-*•]\s+(.+)$/);
        if (bm) {
            flushPara();
            blocks.push({ type: 'li', text: stripInlineMd(bm[1]) });
            continue;
        }
        const nm = trimmed.match(/^(\d+[.)])\s+(.+)$/);
        if (nm) {
            flushPara();
            blocks.push({ type: 'oli', num: nm[1], text: stripInlineMd(nm[2]) });
            continue;
        }
        const qm = trimmed.match(/^>\s*(.+)$/);
        if (qm) {
            flushPara();
            const qt = qm[1].replace(/^\[![A-Z]+\]\s*/i, '');
            if (qt.trim()) blocks.push({ type: 'quote', text: stripInlineMd(qt) });
            continue;
        }
        para.push(stripInlineMd(trimmed));
    }
    flushPara();
    if (inCode && codeBuf.length) blocks.push({ type: 'code', text: codeBuf.join('\n') });
    return blocks;
}

function stripInlineMd(s) {
    return String(s || '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)')
        .trim();
}

// ---------- Inline-Runs (fett/normal) für Word XML ----------
function inlineRuns(text) {
    const parts = [];
    const src = String(text || '');
    const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
    let last = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (m.index > last) parts.push({ text: src.slice(last, m.index), bold: false, mono: false });
        if (m[1]) parts.push({ text: m[1], bold: true, mono: false });
        else if (m[2]) parts.push({ text: m[2], bold: false, mono: true });
        last = re.lastIndex;
    }
    if (last < src.length) parts.push({ text: src.slice(last), bold: false, mono: false });
    return parts.length ? parts : [{ text: src, bold: false, mono: false }];
}

const xmlEsc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// ---------- Reiner JS CRC32 + Stored ZIP Builder (keine Abhängigkeiten) ----------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c >>> 0;
    }
    return t;
})();

export function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

export function buildZipBytes(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const f of files) {
        const nameBytes = enc.encode(f.name);
        const dataBytes = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
        const crc = crc32(dataBytes);
        const size = dataBytes.length;

        const lh = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(lh.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true); // UTF-8
        lv.setUint16(8, 0, true);      // Method 0 = Stored
        lv.setUint16(10, 0, true);
        lv.setUint16(12, 0x5421, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, size, true);
        lv.setUint32(22, size, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        lh.set(nameBytes, 30);

        const cd = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(cd.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0x5421, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, size, true);
        cv.setUint32(24, size, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        cd.set(nameBytes, 46);

        locals.push(lh, dataBytes);
        centrals.push(cd);
        offset += lh.length + dataBytes.length;
    }

    const cdSize = centrals.reduce((n, b) => n + b.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const total = offset + cdSize + eocd.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const part of [...locals, ...centrals, eocd]) {
        out.set(part, pos);
        pos += part.length;
    }
    return out;
}

// ---------- Word (.docx) OOXML Generator ----------
function docxParagraphXml(text, opts = {}) {
    const { style = '', prefix = '', monoBlock = false } = opts;
    const pPr = style ? `<w:pPr><w:pStyle w:val="${xmlEsc(style)}"/></w:pPr>` : '';
    const runs = [];
    if (prefix) {
        runs.push(`<w:r><w:t xml:space="preserve">${xmlEsc(prefix)}</w:t></w:r>`);
    }
    if (monoBlock) {
        for (const line of String(text || '').split('\n')) {
            runs.push(`<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${xmlEsc(line)}</w:t></w:r><w:r><w:br/></w:r>`);
        }
    } else {
        for (const r of inlineRuns(text)) {
            const rPr = r.bold ? '<w:rPr><w:b/></w:rPr>'
                : r.mono ? '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr>' : '';
            runs.push(`<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(r.text)}</w:t></w:r>`);
        }
    }
    return `<w:p>${pPr}${runs.join('')}</w:p>`;
}

export function generateDocxBytes({ title = 'Coden Dokument', markdown = '', author = 'Coden AI' } = {}) {
    const clean = cleanExportMarkdown(markdown);
    // Rohe Markdown-Zeilen für fette Inline-Erhaltung parsen
    const rawLines = clean.split(/\r?\n/);
    const paras = [];
    if (title) {
        paras.push(docxParagraphXml(title, { style: 'Title' }));
        paras.push(docxParagraphXml(`Erstellt mit ${author} · ${new Date().toLocaleDateString('de-DE')}`, { style: 'Subtitle' }));
    }

    let inCode = false;
    let codeBuf = [];
    let paraBuf = [];
    const flushPara = () => {
        if (!paraBuf.length) return;
        paras.push(docxParagraphXml(paraBuf.join(' ')));
        paraBuf = [];
    };

    for (const line of rawLines) {
        const t = line.trim();
        if (/^\s*```/.test(line)) {
            flushPara();
            if (inCode) {
                paras.push(docxParagraphXml(codeBuf.join('\n'), { monoBlock: true }));
                codeBuf = [];
                inCode = false;
            } else {
                inCode = true;
            }
            continue;
        }
        if (inCode) { codeBuf.push(line); continue; }
        if (!t) { flushPara(); continue; }
        const hm = t.match(/^(#{1,3})\s+(.+)$/);
        if (hm) {
            flushPara();
            paras.push(docxParagraphXml(stripInlineMd(hm[2]), { style: `Heading${hm[1].length}` }));
            continue;
        }
        const bm = t.match(/^[-*•]\s+(.+)$/);
        if (bm) {
            flushPara();
            paras.push(docxParagraphXml(bm[1], { prefix: '•  ', style: 'ListBullet' }));
            continue;
        }
        const nm = t.match(/^(\d+[.)])\s+(.+)$/);
        if (nm) {
            flushPara();
            paras.push(docxParagraphXml(nm[2], { prefix: `${nm[1]}  ` }));
            continue;
        }
        const qm = t.match(/^>\s*(.+)$/);
        if (qm) {
            flushPara();
            const qt = qm[1].replace(/^\[![A-Z]+\]\s*/i, '');
            if (qt.trim()) paras.push(docxParagraphXml(qt, { style: 'Quote' }));
            continue;
        }
        paraBuf.push(t);
    }
    flushPara();
    if (inCode && codeBuf.length) paras.push(docxParagraphXml(codeBuf.join('\n'), { monoBlock: true }));

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paras.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/>
    </w:sectPr>
  </w:body>
</w:document>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="1F2328"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="111827"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:sz w:val="19"/><w:color w:val="6B7280"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="240" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1D4ED8"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:spacing w:before="160" w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:ind w:left="360"/><w:spacing w:after="80"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="420"/><w:spacing w:before="100" w:after="120"/></w:pPr><w:rPr><w:i/><w:color w:val="374151"/></w:rPr></w:style>
</w:styles>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    return buildZipBytes([
        { name: '[Content_Types].xml', data: contentTypes },
        { name: '_rels/.rels', data: rootRels },
        { name: 'word/_rels/document.xml.rels', data: docRels },
        { name: 'word/styles.xml', data: stylesXml },
        { name: 'word/document.xml', data: documentXml }
    ]);
}

export function exportAsDocx(title, markdown) {
    const bytes = generateDocxBytes({ title, markdown });
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const filename = safeExportFilename(title, 'docx', 'Coden-Referat');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return filename;
}

// ---------- PDF-Referat Generator (A4 via Canvas + buildPdfBlob) ----------
function wrapCanvasLines(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
        const test = cur + ' ' + words[i];
        if (ctx.measureText(test).width <= maxWidth) cur = test;
        else { lines.push(cur); cur = words[i]; }
    }
    lines.push(cur);
    return lines;
}

export function exportAsPdfReport(title, markdown) {
    if (typeof document === 'undefined') throw new Error('PDF-Export erfordert eine Browser-Umgebung.');
    const W = 1240, H = 1754; // 150 DPI A4
    const PAD_X = 110, PAD_TOP = 110, PAD_BOT = 120;
    const MAX_W = W - PAD_X * 2;
    const blocks = parseMarkdownBlocks(markdown);

    const pages = [];
    const newPage = () => {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        return { c, ctx, y: PAD_TOP };
    };

    let pg = newPage();
    const ensureSpace = (needed) => {
        if (pg.y + needed > H - PAD_BOT) {
            pages.push(pg);
            pg = newPage();
        }
    };

    // Titelblatt-Kopf auf Seite 1
    if (title) {
        pg.ctx.fillStyle = '#111827';
        pg.ctx.font = '700 42px system-ui, -apple-system, "Segoe UI", sans-serif';
        for (const l of wrapCanvasLines(pg.ctx, title, MAX_W)) {
            pg.ctx.fillText(l, PAD_X, pg.y);
            pg.y += 52;
        }
        pg.ctx.fillStyle = '#6B7280';
        pg.ctx.font = '400 20px system-ui, -apple-system, "Segoe UI", sans-serif';
        pg.ctx.fillText(`Coden AI · ${new Date().toLocaleDateString('de-DE')}`, PAD_X, pg.y);
        pg.y += 28;
        pg.ctx.strokeStyle = '#E5E7EB';
        pg.ctx.lineWidth = 2;
        pg.ctx.beginPath();
        pg.ctx.moveTo(PAD_X, pg.y);
        pg.ctx.lineTo(W - PAD_X, pg.y);
        pg.ctx.stroke();
        pg.y += 42;
    }

    for (const b of blocks) {
        if (b.type === 'hr') {
            ensureSpace(30);
            pg.ctx.strokeStyle = '#E5E7EB';
            pg.ctx.lineWidth = 1.5;
            pg.ctx.beginPath(); pg.ctx.moveTo(PAD_X, pg.y + 8); pg.ctx.lineTo(W - PAD_X, pg.y + 8); pg.ctx.stroke();
            pg.y += 26;
            continue;
        }
        let font = '400 24px system-ui, -apple-system, "Segoe UI", sans-serif';
        let color = '#1F2328';
        let lineH = 36;
        let indent = 0;
        let preGap = 0;
        let postGap = 14;
        let text = b.text;

        if (b.type === 'h1') { font = '700 34px system-ui, sans-serif'; color = '#1D4ED8'; lineH = 44; preGap = 16; postGap = 14; }
        else if (b.type === 'h2') { font = '700 29px system-ui, sans-serif'; color = '#111827'; lineH = 38; preGap = 14; postGap = 10; }
        else if (b.type === 'h3') { font = '600 25px system-ui, sans-serif'; color = '#111827'; lineH = 34; preGap = 10; postGap = 8; }
        else if (b.type === 'li') { indent = 32; postGap = 8; text = '•  ' + b.text; }
        else if (b.type === 'oli') { indent = 32; postGap = 8; text = `${b.num}  ${b.text}`; }
        else if (b.type === 'quote') { indent = 28; color = '#4B5563'; postGap = 12; }
        else if (b.type === 'code') { font = '400 20px ui-monospace, monospace'; color = '#1F2937'; lineH = 28; indent = 20; postGap = 14; }

        pg.y += preGap;
        pg.ctx.font = font;
        pg.ctx.fillStyle = color;

        const lines = b.type === 'code'
            ? String(text || '').split('\n')
            : wrapCanvasLines(pg.ctx, text, MAX_W - indent);

        for (const l of lines) {
            ensureSpace(lineH);
            pg.ctx.font = font;
            pg.ctx.fillStyle = color;
            pg.ctx.fillText(l, PAD_X + indent, pg.y);
            pg.y += lineH;
        }
        pg.y += postGap;
    }

    pages.push(pg);
    // Seitenzahlen hinzufügen
    pages.forEach((p, idx) => {
        p.ctx.fillStyle = '#9CA3AF';
        p.ctx.font = '400 18px system-ui, sans-serif';
        p.ctx.fillText(`Seite ${idx + 1} / ${pages.length}`, W - PAD_X - 110, H - 56);
    });

    const frames = pages.map(p => p.c.toDataURL('image/jpeg', 0.9));
    const filename = safePdfFilename(title, 'Coden-Referat');
    const blob = buildPdfBlob(frames);
    downloadPdfBlob(blob, filename);
    return { filename, pages: frames.length };
}

// ---------- Markdown -> Slides (<artifact type="slides">) ----------
export function markdownToSlides(title, markdown) {
    const blocks = parseMarkdownBlocks(markdown);
    const slides = [];
    const safeTitle = String(title || 'Präsentation').trim();

    let cur = { title: safeTitle, bullets: [] };
    const pushCur = () => {
        if (cur.bullets.length || !slides.length) slides.push(cur);
    };

    for (const b of blocks) {
        if (b.type === 'h1' || b.type === 'h2') {
            if (cur.bullets.length) {
                pushCur();
                cur = { title: b.text, bullets: [] };
            } else {
                cur.title = b.text;
            }
        } else if (b.type === 'h3') {
            cur.bullets.push(`**${b.text}**`);
        } else if (b.type === 'li' || b.type === 'oli' || b.type === 'p' || b.type === 'quote') {
            const clean = String(b.text || '').trim();
            if (clean) cur.bullets.push(clean.length > 180 ? clean.slice(0, 177) + '…' : clean);
            if (cur.bullets.length >= 5) {
                pushCur();
                cur = { title: cur.title + ' (Forts.)', bullets: [] };
            }
        }
    }
    pushCur();

    const formatted = slides.slice(0, 12).map((s, i) => {
        if (i === 0 && slides.length > 1 && s.bullets.length <= 2) {
            return `# ${s.title}\n\n${s.bullets.join('\n') || 'Erstellt mit Coden AI'}`;
        }
        return `# ${s.title}\n\n${s.bullets.map(x => `- ${x}`).join('\n')}`;
    });

    if (formatted.length === 1) {
        return `# ${safeTitle}\n\nZusammenfassung & Überblick\n\n---\n\n${formatted[0]}`;
    }
    return formatted.join('\n\n---\n\n');
}

// ---------- Quellen- & Literaturverzeichnis-Formatierer ----------
export function extractCitations(text) {
    const src = String(text || '');
    const seen = new Map();
    const mdLinks = /\[([^\]]{2,140})\]\((https?:\/\/[^\s)]+)\)/g;
    let m;
    while ((m = mdLinks.exec(src)) !== null) {
        const url = m[2].replace(/[.,;!?]+$/, '');
        if (!seen.has(url)) seen.set(url, m[1].trim());
    }
    const bareUrls = /https?:\/\/[^\s<>"')]+/g;
    while ((m = bareUrls.exec(src)) !== null) {
        const url = m[0].replace(/[.,;!?]+$/, '');
        if (!seen.has(url)) seen.set(url, '');
    }
    const out = [];
    for (const [url, rawTitle] of seen.entries()) {
        let domain = '';
        try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
        const title = rawTitle && rawTitle !== url ? rawTitle : domain || url;
        out.push({ title, url, domain });
    }
    return out;
}

export function formatBibliography(text, style = 'schule') {
    const items = extractCitations(text);
    if (!items.length) return '';
    const today = new Date().toLocaleDateString('de-DE');
    const year = new Date().getFullYear();

    const lines = items.map((c, idx) => {
        if (style === 'apa') {
            return `${c.domain || 'Webseite'}. (${year}). *${c.title}*. Abgerufen am ${today} von ${c.url}`;
        }
        if (style === 'harvard') {
            return `${c.domain || 'o. A.'} (${year}): *${c.title}*. Online unter: ${c.url} (Zugriff am ${today}).`;
        }
        // Standard 'schule'
        return `[${idx + 1}] ${c.title} – ${c.domain ? c.domain + ' · ' : ''}${c.url} (Abruf: ${today})`;
    });

    const heading = style === 'apa' ? 'Literaturverzeichnis (APA)' : style === 'harvard' ? 'Quellenverzeichnis (Harvard)' : 'Quellenverzeichnis (Schule)';
    return `## ${heading}\n\n${lines.join('\n')}`;
}
