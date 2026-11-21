// Erzeugt ein App-Symbol als PNG (ohne Zusatzpakete): farbiger Hintergrund mit Verlauf und weißem Anfangsbuchstaben.
// Wird für Homescreen-Symbole (PWA), Apple-Touch-Icon und den APK-Build genutzt.
const zlib = require('zlib');

// 5x7-Pixelschrift für A-Z und 0-9
const FONT = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110', D: '11110100011000110001100011000111110',
  E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000', G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001110011010110011100011000110001', O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001', S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100', W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111', 0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110',
  2: '01110100010000100010001000100011111', 3: '11111000100010000010000011000101110', 4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110',
  6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000', 8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100'
};

let CRC; function crc32(buf) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function hex(c) { const m = String(c || '').match(/^#?([0-9a-f]{6})$/i); const h = m ? m[1] : '8ab4f8'; return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

function iconPng({ size = 512, color = '#8ab4f8', letter = 'C', maskable = false } = {}) {
  size = Math.max(16, Math.min(1024, size | 0));
  const base = hex(color); const light = mix(base, [255, 255, 255], 0.28); const dark = mix(base, [0, 0, 0], 0.22);
  const ch = String(letter || 'C').toUpperCase().replace(/[ÄÖÜ]/g, (x) => ({ Ä: 'A', Ö: 'O', Ü: 'U' }[x]))[0];
  const glyph = FONT[ch] || FONT.C;
  const r = maskable ? 0 : size * 0.22; // abgerundete Ecken (maskable: volle Fläche, das System schneidet selbst zu)
  const cell = Math.floor(size * (maskable ? 0.075 : 0.095)); const gw = cell * 5, gh = cell * 7;
  const gx = Math.floor((size - gw) / 2), gy = Math.floor((size - gh) / 2);
  const row = size * 4 + 1; const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * row + 1 + x * 4;
      // Abstand zur abgerundeten Ecke (weiche Kante)
      let a = 255;
      if (r > 0) { const cx = Math.min(Math.max(x + 0.5, r), size - r), cy = Math.min(Math.max(y + 0.5, r), size - r); const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); a = d > r ? (d > r + 1 ? 0 : Math.round(255 * (r + 1 - d))) : 255; }
      const t = (x + y) / (2 * size); let [R, G, B] = mix(light, dark, t);
      const lx = x - gx, ly = y - gy;
      if (lx >= 0 && ly >= 0 && lx < gw && ly < gh && glyph[Math.floor(ly / cell) * 5 + Math.floor(lx / cell)] === '1') { R = 255; G = 255; B = 255; }
      raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { iconPng };
