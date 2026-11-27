// js/design-core.js – Logik für „Design“ (Instagram-Posts, Storys, Karussells), ohne DOM der Seite, in Node testbar.
// Ablauf: Coding-KI schreibt HTML/CSS in Pixelmaßen → Bilder als <img data-ai-image-prompt="…"> → Bild-KI füllt sie.
// Gerendert wird in einem abgeschotteten iframe (eigener, leerer Ursprung). Die „Brücke“ darin macht Texte editierbar,
// tauscht Bilder und exportiert PNGs (html-to-image) – Kontakt zur Seite nur über postMessage.

export const FORMATS = {
    square: { id: 'square', label: 'Feed Quadrat', w: 1080, h: 1080, icon: 'crop_square', hint: '1080 × 1080' },
    portrait: { id: 'portrait', label: 'Feed Portrait', w: 1080, h: 1350, icon: 'crop_portrait', hint: '1080 × 1350' },
    story: { id: 'story', label: 'Story / Reel Cover', w: 1080, h: 1920, icon: 'smartphone', hint: '1080 × 1920' },
    carousel: { id: 'carousel', label: 'Karussell', w: 1080, h: 1350, icon: 'view_carousel', hint: 'mehrere Slides · 1080 × 1350', multi: true }
};
export const formatOf = (id) => FORMATS[id] || FORMATS.square;
export const FONTS = ['Inter', 'Montserrat', 'Poppins', 'DM Sans', 'Space Grotesk', 'Playfair Display', 'Bebas Neue', 'Oswald', 'Archivo Black', 'Raleway', 'Lora', 'Roboto'];

const clean1 = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '');
export const safeFontName = (f) => clean1(f, 40).replace(/[^A-Za-z0-9 \-]/g, '');

/** Systemprompt für die Coding-KI. brand: { primary, secondary, font, logo } */
export function designSystemPrompt({ format = 'square', slides = 1, brand = {}, editing = false } = {}) {
    const f = formatOf(format);
    const n = f.multi ? Math.max(2, Math.min(10, Number(slides) || 5)) : 1;
    const b = { primary: safeColor(brand.primary), secondary: safeColor(brand.secondary), font: safeFontName(brand.font), logo: /^https?:\/\//.test(String(brand.logo || '')) ? String(brand.logo).slice(0, 300) : '' };
    const lines = [
        'Du bist Coden Design, ein erstklassiger Social-Media-Designer, und baust Instagram-Designs als HTML/CSS.',
        `FORMAT: ${f.label}, exakt ${f.w} × ${f.h} Pixel${f.multi ? ` pro Slide, ${n} Slides` : ''}.`,
        '',
        'AUSGABE:',
        '- Gib GENAU EIN vollständiges HTML-Dokument in einem ```html-Block aus, sonst nichts außer höchstens einem kurzen Satz davor.',
        `- Der <body> enthält genau ${n} <section data-slide>${n === 1 ? '' : ' (eine pro Slide, in Reihenfolge)'}. Jede Section hat style="width:${f.w}px;height:${f.h}px" sowie class="relative overflow-hidden".`,
        '- Tailwind CSS ist schon geladen (Play CDN) – nutze Tailwind-Klassen, auch beliebige Werte wie text-[120px], bg-[#1a1a1a], font-[\'Montserrat\'], tracking-[-0.02em]. Zusätzliches CSS darf in ein <style> im <head>.',
        '- Schriften NUR über <link href="https://fonts.googleapis.com/css2?family=…&display=swap" rel="stylesheet"> im <head>.',
        '- KEIN JavaScript, keine <script>-Tags, kein tailwind.config, keine Formulare, keine iframes.',
        '',
        'BILDER (die macht eine Bild-KI, nicht du):',
        '- Für Hintergründe und Motive: <img data-ai-image-prompt="detaillierte ENGLISCHE Bildbeschreibung: Motiv, Licht, Stil, Farben, Perspektive" alt="kurze deutsche Beschreibung" class="…"> OHNE src.',
        '- Die Bildbeschreibung enthält NIE Text, Buchstaben, Logos oder Schriftzüge – alle Texte schreibst du als echtes HTML darüber.',
        '- Vollflächige Hintergründe: <img … class="absolute inset-0 w-full h-full object-cover"> als erstes Kind der Section, darüber ein Verlauf (z. B. bg-gradient-to-t from-black/80) für lesbaren Text. Keine CSS-background-image.',
        '- Höchstens 2 Bilder pro Slide. Bilder mit vorhandenem src (hochgeladen oder Logo) behältst du unverändert.',
        '',
        'GESTALTUNG (professionell, wie von einer Agentur):',
        '- Klare Hierarchie: eine starke Headline (ca. 90–150 px, fett, enge Zeilenhöhe), Unterzeile 36–48 px, Fließtext nie unter 30 px.',
        '- Großzügiger Rand (mind. 80 px), saubere Ausrichtung, wenig Text, starke Kontraste, max. 2 Schriften, 2–3 Farben.',
        f.id === 'story' ? '- Story: oben 250 px und unten 320 px frei von wichtigen Texten (Instagram-Bedienelemente).' : null,
        f.multi ? `- Karussell: einheitliches Design über alle ${n} Slides. Slide 1 = Hook (neugierig machen), Mitte = Inhalt (ein Gedanke pro Slide), letzter Slide = Call-to-Action. Kleine Seitenzahl (z. B. „2/${n}“) und ein Pfeil „→“ auf allen außer dem letzten.` : null,
        '- Texte auf Deutsch (außer der Nutzer will es anders), kurz und knackig, keine Platzhalter wie „Lorem ipsum“.',
        '- Kleine Text-Elemente (Badges, Labels) mit Hintergrundfarbe und Rundung wirken hochwertig. Icons als Unicode/Emoji oder einfache Inline-SVG.'
    ];
    if (b.primary || b.secondary || b.font || b.logo) {
        lines.push('', 'BRAND KIT DES NUTZERS (unbedingt einhalten):');
        if (b.primary) lines.push(`- Primärfarbe: ${b.primary} (Hauptakzente, Headlines oder Flächen)`);
        if (b.secondary) lines.push(`- Sekundärfarbe: ${b.secondary}`);
        if (b.font) lines.push(`- Schrift: „${b.font}“ (per Google Fonts laden, für Headlines und Text)`);
        if (b.logo) lines.push(`- Logo: <img src="${b.logo}" alt="Logo" data-brand-logo class="…"> klein (ca. 120–180 px breit) in eine Ecke jeder Slide.`);
    }
    if (editing) lines.push('', 'ÄNDERN: Du bekommst das aktuelle Design. Setze den Änderungswunsch um und gib wieder das KOMPLETTE Dokument aus. Bilder, die bleiben sollen, behalten ihr data-ai-image-prompt exakt (dann wird nichts neu erzeugt); für neue Bilder neue Beschreibungen.');
    return lines.filter(l => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}

/** HTML aus der KI-Antwort holen (```html-Block, sonst <!DOCTYPE …>/<html>, sonst nackte Sections einpacken). */
export function extractHtml(text) {
    const t = String(text || '');
    const fence = t.match(/```(?:html)?\s*\n([\s\S]*?)(?:```|$)/i);
    let s = fence && /<(?:html|body|section|div)/i.test(fence[1]) ? fence[1] : t;
    const doc = s.match(/<!DOCTYPE html[\s\S]*?(?:<\/html>|$)/i) || s.match(/<html[\s\S]*?(?:<\/html>|$)/i);
    if (doc) return doc[0].trim();
    const secs = s.match(/<section\b[\s\S]*<\/section>/i);
    if (secs) return `<!DOCTYPE html><html><head></head><body>${secs[0].trim()}</body></html>`;
    return '';
}

/** Kopf- und Body-Inhalt eines Dokuments (als Text). */
export function splitDoc(html) {
    const s = String(html || '');
    const head = (s.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [])[1] || '';
    const body = (s.match(/<body\b[^>]*>([\s\S]*?)(?:<\/body>|$)/i) || [])[1] ?? (head ? '' : s);
    return { head: head.trim(), body: body.trim() };
}

export const safeFontLink = (href) => /^https:\/\/fonts\.googleapis\.com\/css2?\?/.test(String(href || ''));
export const cleanImagePrompt = (p) => clean1(String(p || '').replace(/<[^>]*>/g, ' ').replace(/["„“”<>]/g, ''), 1200); // auch als HTML-Attribut sicher
export function exportName(title, i, n) {
    const base = String(title || '').replace(/[^A-Za-z0-9ÄÖÜäöüß _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'Coden-Design';
    return n > 1 ? `${base}-${i}-von-${n}.png` : `${base}.png`;
}

const CSP = "default-src 'none'; img-src * data: blob:; media-src * data: blob:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; script-src 'unsafe-inline' https://cdn.tailwindcss.com; connect-src * data: blob:; form-action 'none'; base-uri 'none'";
const EMPTY_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export { EMPTY_IMG };

/**
 * Komplettes Dokument fürs iframe. mode: 'edit' (Texte editierbar, eine Slide sichtbar) | 'view' (nur ansehen, z. B. Vorschaubild).
 * lib: Quelltext von html-to-image (nur im Editor nötig).
 */
export function frameDoc({ head = '', body = '', format = 'square', lib = '', mode = 'edit', active = 0 } = {}) {
    const f = formatOf(format);
    const cfg = { w: f.w, h: f.h, mode, active };
    const css = `html,body{margin:0;padding:0;background:transparent}body{width:${f.w}px;overflow:hidden}[data-slide]{width:${f.w}px!important;height:${f.h}px!important;min-height:0!important;max-height:none!important;position:relative;overflow:hidden;flex:none}
.cd-hide{display:none!important}
img[data-ai-state="pending"]{background:linear-gradient(100deg,#26262b 30%,#3b3b44 50%,#26262b 70%);background-size:300% 100%;animation:cdsh 1.3s linear infinite;object-fit:cover}
img[data-ai-state="error"]{background:repeating-linear-gradient(45deg,#2a2a2e,#2a2a2e 14px,#33333a 14px,#33333a 28px)}
@keyframes cdsh{from{background-position:100% 0}to{background-position:-100% 0}}
${mode === 'edit' ? '[data-cd-text]:hover{outline:3px dashed rgba(138,180,248,.7);outline-offset:4px;cursor:text}[data-cd-text]:focus{outline:3px solid #8ab4f8;outline-offset:4px}img[data-ai-id]{cursor:pointer}img.cd-sel{outline:6px solid #8ab4f8;outline-offset:-6px}' : ''}`;
    return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">`
        + `<script src="https://cdn.tailwindcss.com"><\/script>${head}<style data-cd-injected>${css}</style></head>`
        + `<body>${body}${lib ? `<script data-cd-injected>${lib.replace(/<\/script/gi, '<\\/script')}<\/script>` : ''}`
        + `<script data-cd-injected>(${bridge.toString()})(${JSON.stringify(cfg)});<\/script></body></html>`;
}

// Läuft IM iframe (eigener Ursprung). Nur postMessage zur Seite.
function bridge(cfg) {
    const post = (m) => parent.postMessage(Object.assign({ codenDesign: 1 }, m), '*');
    const slides = () => { const s = Array.from(document.querySelectorAll('[data-slide]')); return s.length ? s : [document.body]; };
    let active = Math.min(cfg.active || 0, slides().length - 1);
    const show = (i) => { const s = slides(); active = Math.max(0, Math.min(i, s.length - 1)); s.forEach((el, k) => el.classList.toggle('cd-hide', k !== active && s.length > 1)); post({ t: 'slide', i: active, n: s.length }); };
    const TEXT = 'h1,h2,h3,h4,h5,h6,p,span,li,a,button,small,strong,em,b,i,u,blockquote,figcaption,label,td,th,div';
    const markText = () => {
        document.querySelectorAll(TEXT).forEach((el) => {
            if (el.closest('svg')) return;
            const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
            if (!own || el.closest('[data-cd-text]')) return;
            el.setAttribute('contenteditable', 'true'); el.setAttribute('spellcheck', 'false'); el.setAttribute('data-cd-text', '');
        });
    };
    const cleanBody = () => {
        const c = document.body.cloneNode(true);
        c.querySelectorAll('[data-cd-injected]').forEach(n => n.remove());
        c.querySelectorAll('[contenteditable],[data-cd-text],[spellcheck]').forEach(n => { n.removeAttribute('contenteditable'); n.removeAttribute('data-cd-text'); n.removeAttribute('spellcheck'); });
        c.querySelectorAll('.cd-hide,.cd-sel').forEach(n => { n.classList.remove('cd-hide', 'cd-sel'); if (!n.getAttribute('class')) n.removeAttribute('class'); });
        return c.innerHTML.trim();
    };
    if (cfg.mode === 'edit') {
        markText();
        let t = null;
        document.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => post({ t: 'body', body: cleanBody() }), 450); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target.closest('h1,h2,h3,h4,h5,h6,button,a,span,small,strong,b,em,label')) e.preventDefault(); });
        document.addEventListener('paste', (e) => { if (!e.target.closest('[data-cd-text]')) return; e.preventDefault(); const txt = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, txt); });
        document.addEventListener('click', (e) => {
            const img = e.target.closest('img[data-ai-id]');
            document.querySelectorAll('img.cd-sel').forEach(x => x.classList.remove('cd-sel'));
            if (img) { img.classList.add('cd-sel'); post({ t: 'img-select', id: img.getAttribute('data-ai-id') }); }
            else post({ t: 'img-select', id: null });
        });
    }
    window.addEventListener('message', async (e) => {
        const m = e.data || {}; if (e.source !== parent || !m.codenDesign) return;
        if (m.t === 'show') show(m.i);
        else if (m.t === 'set-img') {
            const img = document.querySelector(`img[data-ai-id="${CSS.escape(String(m.id))}"]`); if (!img) return;
            if (m.src) img.setAttribute('src', m.src);
            if (m.state) img.setAttribute('data-ai-state', m.state); else img.removeAttribute('data-ai-state');
            if (m.prompt != null) img.setAttribute('data-ai-image-prompt', m.prompt);
            if (m.save) post({ t: 'body', body: cleanBody() });
        } else if (m.t === 'select-img') {
            document.querySelectorAll('img.cd-sel').forEach(x => x.classList.remove('cd-sel'));
            const img = document.querySelector(`img[data-ai-id="${CSS.escape(String(m.id))}"]`);
            if (img) { img.classList.add('cd-sel'); const k = slides().findIndex(s => s.contains(img)); if (k >= 0 && k !== active) show(k); }
        } else if (m.t === 'export') {
            const s = slides(); const el = s[m.i] || s[0]; const was = active;
            try {
                if (!window.htmlToImage) throw new Error('Export-Bibliothek fehlt.');
                document.querySelectorAll('img.cd-sel').forEach(x => x.classList.remove('cd-sel'));
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                show(s.indexOf(el));
                if (document.fonts && document.fonts.ready) await document.fonts.ready;
                const data = await window.htmlToImage.toPng(el, { width: cfg.w, height: cfg.h, pixelRatio: m.ratio || 1, cacheBust: false, style: { margin: '0', transform: 'none' }, filter: (n) => !(n.getAttribute && n.hasAttribute('data-cd-injected')) });
                post({ t: 'png', req: m.req, i: m.i, data });
            } catch (err) {
                const msg = err && err.message ? err.message : (err && err.type === 'error' ? 'Ein Bild oder eine Schrift im Design konnte nicht geladen werden.' : String(err));
                post({ t: 'png', req: m.req, i: m.i, error: msg });
            }
            finally { show(was); }
        }
    });
    const ready = () => { show(active); post({ t: 'ready', n: slides().length, h: document.body.scrollHeight }); };
    if (document.readyState === 'complete') setTimeout(ready, 30); else window.addEventListener('load', () => setTimeout(ready, 30));
}
