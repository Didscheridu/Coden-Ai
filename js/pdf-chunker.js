// js/pdf-chunker.js – Sichere lokale PDF-Textextraktion & intelligente Dokument-Zerlegung.
// Funktioniert komplett ohne externe CDN-Skripte (DSGVO/legal.test.js konform).
// Unterstützt unkomprimierte PDFs sowie FlateDecode-Streams (über Browser DecompressionStream oder Node zlib).

function bytesToLatin1(bytes) {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

function latin1ToBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

async function inflateBytes(u8) {
  if (typeof DecompressionStream !== 'undefined') {
    for (const fmt of ['deflate', 'deflate-raw']) {
      try {
        const ds = new DecompressionStream(fmt);
        const writer = ds.writable.getWriter();
        writer.write(u8);
        writer.close();
        const buf = await new Response(ds.readable).arrayBuffer();
        return new Uint8Array(buf);
      } catch (_) { /* nächstes Format probieren */ }
    }
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    const zlib = await import('zlib');
    try { return new Uint8Array(zlib.inflateSync(u8)); } catch (_) {}
    try { return new Uint8Array(zlib.inflateRawSync(u8)); } catch (_) {}
  }
  return null;
}

function decodePdfLiteral(raw) {
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      bytes.push(raw.charCodeAt(i) & 0xff);
      continue;
    }
    i++;
    if (i >= raw.length) break;
    const esc = raw[i];
    if (esc === 'n') bytes.push(10);
    else if (esc === 'r') bytes.push(13);
    else if (esc === 't') bytes.push(9);
    else if (esc === 'b') bytes.push(8);
    else if (esc === 'f') bytes.push(12);
    else if (esc === '(' || esc === ')' || esc === '\\') bytes.push(esc.charCodeAt(0));
    else if (esc === '\r' || esc === '\n') { if (esc === '\r' && raw[i + 1] === '\n') i++; }
    else if (/[0-7]/.test(esc)) {
      let oct = esc;
      if (/[0-7]/.test(raw[i + 1] || '')) oct += raw[++i];
      if (/[0-7]/.test(raw[i + 1] || '')) oct += raw[++i];
      bytes.push(parseInt(oct, 8) & 0xff);
    } else {
      bytes.push(esc.charCodeAt(0) & 0xff);
    }
  }
  // UTF-16BE BOM (\xfe\xff) erkennen
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let j = 2; j + 1 < bytes.length; j += 2) {
      s += String.fromCharCode((bytes[j] << 8) | bytes[j + 1]);
    }
    return s;
  }
  // WinAnsi / Latin-1 fallback -> lesbare deutsche Umlaute bleiben erhalten
  try {
    return new TextDecoder('windows-1252').decode(new Uint8Array(bytes));
  } catch (_) {
    return String.fromCharCode(...bytes);
  }
}

function decodePdfHex(hex) {
  const clean = String(hex || '').replace(/\s+/g, '');
  if (!clean) return '';
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    const b = clean.slice(i, i + 2).padEnd(2, '0');
    bytes.push(parseInt(b, 16) || 0);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let j = 2; j + 1 < bytes.length; j += 2) s += String.fromCharCode((bytes[j] << 8) | bytes[j + 1]);
    return s;
  }
  // Häufig ASCII/Latin-1 oder 2-Byte Glyph IDs -> nur druckbare Zeichen übernehmen
  const printable = bytes.filter(b => b === 9 || b === 10 || b === 32 || (b >= 32 && b <= 126) || b >= 160);
  if (printable.length < bytes.length * 0.5) return '';
  return String.fromCharCode(...printable);
}

function extractTextFromContentStream(streamStr) {
  const out = [];
  // Text in BT ... ET Blöcken sowie direkte Tj / TJ Operatoren einsammeln
  const btBlocks = [...streamStr.matchAll(/BT\b([\s\S]*?)ET\b/g)].map(m => m[1]);
  const targets = btBlocks.length ? btBlocks : [streamStr];

  for (const blk of targets) {
    let i = 0;
    const pieces = [];
    while (i < blk.length) {
      const ch = blk[i];
      if (ch === '(') {
        let depth = 1, j = i + 1, cur = '';
        while (j < blk.length && depth > 0) {
          const c = blk[j];
          if (c === '\\') { cur += c + (blk[j + 1] || ''); j += 2; continue; }
          if (c === '(') depth++;
          else if (c === ')') { depth--; if (depth === 0) break; }
          cur += c;
          j++;
        }
        const after = blk.slice(j + 1, j + 12);
        if (/^\s*(?:Tj|'|")|^\s*[\]\-\d.\s]*TJ/.test(after) || pieces.length < 4000) {
          const txt = decodePdfLiteral(cur);
          if (txt) pieces.push(txt);
        }
        i = j + 1;
        continue;
      }
      if (ch === '<' && blk[i + 1] !== '<') {
        const end = blk.indexOf('>', i + 1);
        if (end > i) {
          const hex = blk.slice(i + 1, end);
          const after = blk.slice(end + 1, end + 12);
          if (/^\s*(?:Tj|'|")|^\s*[\]\-\d.\s]*TJ/.test(after)) {
            const txt = decodePdfHex(hex);
            if (txt) pieces.push(txt);
          }
          i = end + 1;
          continue;
        }
      }
      if ((ch === 'T' && (blk[i + 1] === 'd' || blk[i + 1] === 'D' || blk[i + 1] === '*')) || ch === '\'') {
        if (pieces.length && pieces[pieces.length - 1] !== '\n') pieces.push('\n');
      }
      i++;
    }
    const text = pieces.join(' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    if (text) out.push(text);
  }
  return out.join('\n').trim();
}

// Extrahiert lesbaren Text pro geschätzter/realer PDF-Seite ohne externe Skripte
export async function extractPdfTextPages(uint8Array) {
  const bytes = uint8Array instanceof Uint8Array ? uint8Array : new Uint8Array(uint8Array);
  const raw = bytesToLatin1(bytes);
  if (!raw.startsWith('%PDF-')) throw new Error('Keine gültige PDF-Datei.');

  // Objekte & Streams parsen
  const objStreams = new Map(); // objNum -> extracted text
  const objRaw = new Map();
  const objRe = /(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj/g;
  let m;
  while ((m = objRe.exec(raw))) {
    const objId = parseInt(m[1], 10);
    const body = m[2];
    objRaw.set(objId, body);
    const sm = body.match(/<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)\r?\n?endstream/);
    if (!sm) continue;
    const dict = sm[1];
    const streamPayload = sm[2];
    const isFlate = /\/Filter\s*(?:\[[^\]]*)?\/FlateDecode\b/.test(dict);
    let contentText = '';
    if (isFlate) {
      const inflated = await inflateBytes(latin1ToBytes(streamPayload));
      if (inflated) contentText = bytesToLatin1(inflated);
    } else {
      contentText = streamPayload;
    }
    if (contentText && (/BT\b[\s\S]*?ET\b/.test(contentText) || /\)\s*T[jJ]/.test(contentText))) {
      const t = extractTextFromContentStream(contentText);
      if (t) objStreams.set(objId, t);
    }
  }

  // Seitenobjekte (/Type /Page) den jeweiligen Content-Streams zuordnen
  const pages = [];
  for (const [, body] of objRaw.entries()) {
    if (!/\/Type\s*\/Page\b(?!s)/.test(body)) continue;
    const refs = [];
    const arrM = body.match(/\/Contents\s*\[([^\]]+)\]/);
    if (arrM) {
      for (const r of arrM[1].matchAll(/(\d+)\s+\d+\s+R/g)) refs.push(parseInt(r[1], 10));
    } else {
      const singleM = body.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
      if (singleM) refs.push(parseInt(singleM[1], 10));
    }
    const pageText = refs.map(id => objStreams.get(id) || '').filter(Boolean).join('\n').trim();
    if (pageText) pages.push({ page: pages.length + 1, text: pageText });
  }

  // Fallback: falls Seitenbaum über Object-Streams verdeckt ist, gefundene Textstreams nach Reihenfolge bündeln
  if (!pages.length && objStreams.size) {
    let idx = 1;
    for (const txt of objStreams.values()) {
      if (txt.trim().length >= 8) pages.push({ page: idx++, text: txt.trim() });
    }
  }

  return pages;
}

const cleanTokens = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 3);

export function chunkDocumentPages(pages, { id = '', title = 'Dokument', maxChunkChars = 1800, overlap = 160 } = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const chunks = [];
  let buf = '';
  let startPage = list[0]?.page || 1;
  let endPage = startPage;

  const pushChunk = (text, pA, pB) => {
    const t = String(text || '').trim();
    if (!t) return;
    const firstLine = t.split('\n').find(l => l.trim().length >= 3)?.trim().slice(0, 80) || `Abschnitt ${chunks.length + 1}`;
    chunks.push({
      index: chunks.length + 1,
      pageStart: pA,
      pageEnd: pB,
      heading: firstLine,
      text: t,
      tokens: cleanTokens(t)
    });
  };

  for (const p of list) {
    const pText = String(p.text || '').trim();
    if (!pText) continue;
    const tagged = `[Seite ${p.page}]\n${pText}`;
    if (buf.length + tagged.length + 2 <= maxChunkChars) {
      if (!buf) startPage = p.page;
      buf = buf ? `${buf}\n\n${tagged}` : tagged;
      endPage = p.page;
    } else {
      if (buf) {
        pushChunk(buf, startPage, endPage);
        const tail = overlap > 0 ? buf.slice(-overlap) : '';
        buf = tail ? `${tail}\n\n${tagged}` : tagged;
        startPage = p.page;
        endPage = p.page;
      } else {
        // Eine einzelne sehr lange Seite in kleinere Stücke schneiden
        for (let off = 0; off < tagged.length; off += (maxChunkChars - overlap)) {
          pushChunk(tagged.slice(off, off + maxChunkChars), p.page, p.page);
        }
        buf = '';
      }
    }
  }
  if (buf) pushChunk(buf, startPage, endPage);

  const toc = chunks.slice(0, 40).map(c =>
    `#${c.index} (S. ${c.pageStart}${c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ''}): ${c.heading}`
  ).join('\n');

  return {
    id: id || ('doc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    title: String(title || 'Dokument'),
    pageCount: list.length || chunks.length,
    totalChars: chunks.reduce((n, c) => n + c.text.length, 0),
    chunks,
    toc
  };
}

export function chunkLongText(text, { id = '', title = 'Textdokument', maxChunkChars = 1800, overlap = 160 } = {}) {
  const paras = String(text || '').split(/\n{2,}/);
  const pages = [];
  let pageBuf = '';
  let pageNum = 1;
  for (const para of paras) {
    if (pageBuf.length + para.length > 2600 && pageBuf) {
      pages.push({ page: pageNum++, text: pageBuf });
      pageBuf = para;
    } else {
      pageBuf = pageBuf ? `${pageBuf}\n\n${para}` : para;
    }
  }
  if (pageBuf) pages.push({ page: pageNum, text: pageBuf });
  return chunkDocumentPages(pages, { id, title, maxChunkChars, overlap });
}

export function retrieveDocumentChunks(docs, query, { maxChunks = 5, maxChars = 8500 } = {}) {
  const list = Array.isArray(docs) ? docs.filter(d => d && Array.isArray(d.chunks) && d.chunks.length) : [];
  if (!list.length) return { tocText: '', snippetsText: '', selected: [] };

  const q = String(query || '').trim();
  const qTokens = [...new Set(cleanTokens(q))];
  const pageMatches = [...q.matchAll(/\b(?:seite|s\.?|page|p\.?)\s*(\d{1,4})\b/gi)].map(m => parseInt(m[1], 10));

  const scored = [];
  for (const doc of list) {
    for (const c of doc.chunks) {
      let score = 0;
      if (pageMatches.some(pn => pn >= c.pageStart && pn <= c.pageEnd)) score += 10;
      const cSet = new Set(c.tokens || cleanTokens(c.text));
      for (const t of qTokens) {
        if (cSet.has(t)) score += 1.5;
      }
      if (c.index === 1) score += 0.35; // Einstieg leicht bevorzugen bei allgemeinen Fragen („fasse zusammen“)
      scored.push({ doc, chunk: c, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index);
  const selected = [];
  let usedChars = 0;
  for (const item of scored) {
    if (selected.length >= maxChunks) break;
    if (usedChars + item.chunk.text.length > maxChars && selected.length > 0) continue;
    selected.push(item);
    usedChars += item.chunk.text.length;
  }

  const tocText = list.map(d =>
    `DOKUMENT „${d.title}“ (${d.pageCount} Seiten, ${d.chunks.length} Abschnitte):\n${d.toc}`
  ).join('\n\n');

  const snippetsText = selected.map(({ doc, chunk }) =>
    `--- Ausschnitt aus „${doc.title}“ · Abschnitt #${chunk.index} (Seite ${chunk.pageStart}${chunk.pageEnd !== chunk.pageStart ? `–${chunk.pageEnd}` : ''}) ---\n${chunk.text}`
  ).join('\n\n');

  return { tocText, snippetsText, selected };
}

export function parseDocReadRequests(text) {
  const reqs = [];
  const re = /<doc_read\s+([^>]*?)\/?>(?:<\/doc_read>)?/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const attrs = {};
    m[1].replace(/([a-zA-Z_-]+)\s*=\s*["“]([^"”]*)["”]/g, (_, k, v) => { attrs[k.toLowerCase()] = v.trim(); });
    reqs.push({
      doc: attrs.doc || attrs.title || '',
      pages: attrs.pages || attrs.page || ''
    });
    if (reqs.length >= 3) break;
  }
  return reqs;
}

export function fulfillDocReads(docs, reqs) {
  const list = Array.isArray(docs) ? docs : [];
  if (!list.length || !reqs.length) return '';
  const blocks = [];
  for (const r of reqs) {
    const doc = (r.doc && list.find(d => d.title.toLowerCase().includes(r.doc.toLowerCase()))) || list[0];
    if (!doc) continue;
    const pm = String(r.pages || '').match(/^(\d+)(?:\s*[-–bis]+\s*(\d+))?$/);
    const from = pm ? parseInt(pm[1], 10) : 1;
    const to = pm && pm[2] ? parseInt(pm[2], 10) : from;
    const matched = doc.chunks.filter(c => c.pageEnd >= from && c.pageStart <= to).slice(0, 4);
    const chosen = matched.length ? matched : doc.chunks.slice(0, 2);
    for (const c of chosen) {
      blocks.push(`[Nachgeladener Abschnitt aus „${doc.title}“ · Seite ${c.pageStart}${c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ''}]\n${c.text}`);
    }
  }
  return blocks.join('\n\n').slice(0, 9000);
}
