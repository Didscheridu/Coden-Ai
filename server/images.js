// Bild-Erzeugung über Cloudflare Workers AI (Flux). Schlüssel nur aus Umgebungsvariablen.
const configured = () => !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);

async function generateImage(prompt, { signal } = {}) {
  if (!configured()) throw Object.assign(new Error('Bilder sind noch nicht eingerichtet (CLOUDFLARE_ACCOUNT_ID und CLOUDFLARE_API_TOKEN fehlen in Vercel).'), { status: 503 });
  const model = process.env.CLOUDFLARE_IMAGE_MODEL || '@cf/black-forest-labs/flux-1-schnell';
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: String(prompt).slice(0, 1500) })
  });
  const d = await r.json().catch(() => ({}));
  const b64 = d.result?.image;
  if (!r.ok || !b64) {
    const msg = d.errors?.[0]?.message || `HTTP ${r.status}`;
    if (/neuron|quota|limit|allocation/i.test(msg) || r.status === 429) throw Object.assign(new Error('Das Gratis-Tageslimit für Bilder ist aufgebraucht. Morgen geht es wieder.'), { status: 429 });
    throw Object.assign(new Error('Bild konnte nicht erstellt werden: ' + msg), { status: 502 });
  }
  const data = Buffer.from(b64, 'base64');
  const mime = data[0] === 0xff && data[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  return { data, mime };
}

module.exports = { generateImage, configured };
