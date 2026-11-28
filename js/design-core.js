// js/design-core.js – Kernlogik für das Coden Canva-Design-Studio (ohne Host-DOM, in Node testbar).
// Vereint KI-Layout-Generierung (HTML/CSS + Bild-KI) mit direktem Canva-Bearbeiten im abgeschotteten iframe:
// Auswählen, Verschieben mit Smart-Guides, 8-Punkt-Skalierung, Drehen, Doppelklick-Textbearbeitung,
// Formen/Texte/Bilder hinzufügen, Multi-Page-Slides und PNG/JPG-Export (1×/2×).

export const FORMATS = {
    square: { id: 'square', label: 'Feed Quadrat', cat: 'Social', w: 1080, h: 1080, icon: 'crop_square', hint: '1080 × 1080' },
    portrait: { id: 'portrait', label: 'Feed Portrait', cat: 'Social', w: 1080, h: 1350, icon: 'crop_portrait', hint: '1080 × 1350' },
    story: { id: 'story', label: 'Story / Reel', cat: 'Social', w: 1080, h: 1920, icon: 'smartphone', hint: '1080 × 1920' },
    carousel: { id: 'carousel', label: 'Karussell', cat: 'Social', w: 1080, h: 1350, icon: 'view_carousel', hint: 'mehrere Slides · 1080 × 1350', multi: true },
    youtube: { id: 'youtube', label: 'YouTube Thumbnail', cat: 'Video', w: 1280, h: 720, icon: 'smart_display', hint: '1280 × 720' },
    presentation: { id: 'presentation', label: 'Präsentation 16:9', cat: 'Präsentation', w: 1920, h: 1080, icon: 'slideshow', hint: 'mehrere Folien · 1920 × 1080', multi: true },
    linkedin: { id: 'linkedin', label: 'LinkedIn / X Post', cat: 'Social', w: 1200, h: 628, icon: 'article', hint: '1200 × 628' },
    poster: { id: 'poster', label: 'Flyer / Poster A4', cat: 'Print', w: 1240, h: 1754, icon: 'description', hint: '1240 × 1754' },
    custom: { id: 'custom', label: 'Eigene Größe', cat: 'Custom', w: 1080, h: 1080, icon: 'aspect_ratio', hint: 'Benutzerdefiniert' }
};

export function formatOf(id, customW, customH) {
    const base = FORMATS[id] || FORMATS.square;
    if (base.id === 'custom') {
        const w = Math.max(200, Math.min(4000, Math.round(Number(customW) || base.w)));
        const h = Math.max(200, Math.min(4000, Math.round(Number(customH) || base.h)));
        return { ...base, w, h, hint: `${w} × ${h}` };
    }
    return base;
}

export const FONTS = [
    'Plus Jakarta Sans', 'Inter', 'Montserrat', 'Poppins', 'DM Sans', 'Space Grotesk',
    'Playfair Display', 'Cormorant Garamond', 'Bebas Neue', 'Oswald', 'Archivo Black',
    'Syne', 'Raleway', 'Lora', 'Roboto', 'JetBrains Mono'
];

const clean1 = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '');
export const safeFontName = (f) => clean1(f, 40).replace(/[^A-Za-z0-9 \-]/g, '');
export const fontLinkFor = (name) => {
    const f = safeFontName(name);
    if (!f) return '';
    return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,700&display=swap`;
};

export const BACKGROUNDS = {
    solids: [
        { name: 'Reinweiß', value: '#FFFFFF' },
        { name: 'Warmes Elfenbein', value: '#F7F3EB' },
        { name: 'Sand', value: '#EDE6DB' },
        { name: 'Hellgrau', value: '#F1F3F6' },
        { name: 'Anthrazit', value: '#18181B' },
        { name: 'Tiefschwarz', value: '#0B0B0D' },
        { name: 'Nachtblau', value: '#0F172A' },
        { name: 'Tannengrün', value: '#0D261F' },
        { name: 'Terrakotta', value: '#C85A32' },
        { name: 'Kobalt', value: '#1D4ED8' },
        { name: 'Smaragd', value: '#047857' },
        { name: 'Bordeaux', value: '#7F1D1D' }
    ],
    gradients: [
        { name: 'Studio Dunkel', value: 'linear-gradient(145deg, #111115 0%, #24242d 100%)' },
        { name: 'Warmes Editorial', value: 'linear-gradient(135deg, #f9f5ee 0%, #eadbc8 100%)' },
        { name: 'Sonnenuntergang', value: 'linear-gradient(135deg, #f97316 0%, #e11d48 100%)' },
        { name: 'Tiefsee', value: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 55%, #0ea5e9 100%)' },
        { name: 'Nordischer Nebel', value: 'linear-gradient(145deg, #e2e8f0 0%, #f8fafc 55%, #dbeafe 100%)' },
        { name: 'Smaragd Nacht', value: 'linear-gradient(145deg, #062019 0%, #0f4c3a 100%)' },
        { name: 'Champagner', value: 'linear-gradient(135deg, #fffbeb 0%, #fde68a 100%)' },
        { name: 'Koralle & Pfirsich', value: 'linear-gradient(135deg, #ffedd5 0%, #fecdd3 100%)' },
        { name: 'Kobalt Studio', value: 'linear-gradient(135deg, #172554 0%, #2563eb 100%)' },
        { name: 'Salbei', value: 'linear-gradient(135deg, #ecfdf5 0%, #a7f3d0 100%)' },
        { name: 'Espresso', value: 'linear-gradient(145deg, #1c1410 0%, #452c1e 100%)' },
        { name: 'Silber Metall', value: 'linear-gradient(135deg, #27272a 0%, #52525b 50%, #18181b 100%)' }
    ]
};

export const TEXT_PRESETS = [
    {
        id: 'h1', label: 'Überschrift hinzufügen', preview: 'Überschrift', sampleStyle: 'font-size:21px;font-weight:800;letter-spacing:-0.02em',
        make: (w, h) => `<div data-cd-layer="text" style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.18)}px;width:${Math.round(w * 0.8)}px;z-index:20;font-family:'Plus Jakarta Sans',sans-serif;font-size:${Math.round(Math.min(w, h) * 0.088)}px;font-weight:800;line-height:1.05;letter-spacing:-0.03em;color:#111114;text-align:left">Starke Headline</div>`
    },
    {
        id: 'h2', label: 'Untertitel hinzufügen', preview: 'Untertitel', sampleStyle: 'font-size:15px;font-weight:600',
        make: (w, h) => `<div data-cd-layer="text" style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.34)}px;width:${Math.round(w * 0.78)}px;z-index:20;font-family:'Inter',sans-serif;font-size:${Math.round(Math.min(w, h) * 0.044)}px;font-weight:600;line-height:1.25;color:#27272a;text-align:left">Klare Unterzeile für deinen Beitrag</div>`
    },
    {
        id: 'body', label: 'Fließtext hinzufügen', preview: 'Ein kurzer Absatz für Details & Infos.', sampleStyle: 'font-size:12.5px;font-weight:400;opacity:0.8',
        make: (w, h) => `<div data-cd-layer="text" style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.48)}px;width:${Math.round(w * 0.76)}px;z-index:20;font-family:'Inter',sans-serif;font-size:${Math.round(Math.min(w, h) * 0.031)}px;font-weight:400;line-height:1.5;color:#3f3f46;text-align:left">Kurzer, prägnanter Fließtext. Doppelklicken, um den Text direkt auf der Leinwand anzupassen.</div>`
    },
    {
        id: 'badge', label: 'Kicker / Pill-Badge', preview: 'NEU · LIMITED', group: 'combos', sampleStyle: 'display:inline-block;padding:4px 10px;border-radius:999px;background:#111;color:#fff;font-size:11px;font-weight:700;letter-spacing:0.12em',
        make: (w, h) => `<div data-cd-layer="text" style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.1)}px;width:auto;padding:16px 34px;border-radius:999px;background:#111114;color:#ffffff;z-index:22;font-family:'Plus Jakarta Sans',sans-serif;font-size:28px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;text-align:center">NEU · LIMITED</div>`
    },
    {
        id: 'editorial', label: 'Editorial Serif', preview: 'Zeitloses Design', group: 'combos', font: 'Playfair Display', sampleStyle: 'font-family:Georgia,serif;font-style:italic;font-size:19px;font-weight:700',
        make: (w, h) => `<div data-cd-layer="text" style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.28)}px;width:${Math.round(w * 0.8)}px;z-index:20;font-family:'Playfair Display',Georgia,serif;font-size:${Math.round(Math.min(w, h) * 0.095)}px;font-weight:700;font-style:italic;line-height:1.05;color:#18181b;text-align:center">Zeitloses Design</div>`
    },
    {
        id: 'impact', label: 'Impact Poster', preview: '50% SALE', group: 'combos', font: 'Bebas Neue', sampleStyle: 'font-size:22px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase',
        make: (w, h) => `<div data-cd-layer="text" style="position:absolute;left:${Math.round(w * 0.08)}px;top:${Math.round(h * 0.25)}px;width:${Math.round(w * 0.84)}px;z-index:20;font-family:'Bebas Neue',sans-serif;font-size:${Math.round(Math.min(w, h) * 0.16)}px;font-weight:400;line-height:0.95;letter-spacing:0.04em;text-transform:uppercase;color:#111114;text-align:center">50% RABATT</div>`
    },
    {
        id: 'cta', label: 'Call-to-Action Button', preview: 'Jetzt entdecken →', group: 'combos', sampleStyle: 'display:inline-block;padding:6px 14px;border-radius:12px;background:#2563eb;color:#fff;font-size:12px;font-weight:700',
        make: (w, h) => `<div data-cd-layer="text" style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.78)}px;padding:24px 48px;border-radius:18px;background:#111114;color:#ffffff;z-index:22;font-family:'Plus Jakarta Sans',sans-serif;font-size:34px;font-weight:700;text-align:center">Jetzt entdecken →</div>`
    },
    {
        id: 'metric', label: 'Kennzahl / Zahl', preview: '98%', group: 'combos', font: 'Space Grotesk', sampleStyle: 'font-size:24px;font-weight:800;letter-spacing:-0.04em',
        make: (w, h) => `<div data-cd-layer="text" style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.22)}px;width:420px;z-index:20;font-family:'Space Grotesk',sans-serif;font-size:160px;font-weight:700;line-height:0.95;letter-spacing:-0.04em;color:#111114">98%</div>`
    }
];

export const SHAPES = [
    {
        id: 'rect', label: 'Rechteck', cat: 'shapes', icon: 'crop_landscape',
        make: (w, h) => `<div data-cd-layer="shape" style="position:absolute;left:${Math.round(w * 0.25)}px;top:${Math.round(h * 0.3)}px;width:${Math.round(w * 0.45)}px;height:${Math.round(h * 0.26)}px;background:#18181b;border-radius:0px;z-index:10"></div>`
    },
    {
        id: 'rounded', label: 'Karte', cat: 'shapes', icon: 'rounded_corner',
        make: (w, h) => `<div data-cd-layer="shape" style="position:absolute;left:${Math.round(w * 0.14)}px;top:${Math.round(h * 0.28)}px;width:${Math.round(w * 0.72)}px;height:${Math.round(h * 0.34)}px;background:#ffffff;border-radius:36px;border:2px solid rgba(0,0,0,0.08);box-shadow:0 24px 60px rgba(0,0,0,0.12);z-index:10"></div>`
    },
    {
        id: 'circle', label: 'Kreis', cat: 'shapes', icon: 'circle',
        make: (w, h) => { const s = Math.round(Math.min(w, h) * 0.32); return `<div data-cd-layer="shape" style="position:absolute;left:${Math.round((w - s) / 2)}px;top:${Math.round((h - s) / 2)}px;width:${s}px;height:${s}px;background:#f97316;border-radius:9999px;z-index:10"></div>`; }
    },
    {
        id: 'pill', label: 'Pille', cat: 'shapes', icon: 'pill',
        make: (w, h) => `<div data-cd-layer="shape" style="position:absolute;left:${Math.round(w * 0.22)}px;top:${Math.round(h * 0.44)}px;width:${Math.round(w * 0.56)}px;height:110px;background:#2563eb;border-radius:9999px;z-index:10"></div>`
    },
    {
        id: 'outline', label: 'Rahmen', cat: 'shapes', icon: 'check_box_outline_blank',
        make: (w, h) => `<div data-cd-layer="shape" style="position:absolute;left:${Math.round(w * 0.08)}px;top:${Math.round(h * 0.08)}px;width:${Math.round(w * 0.84)}px;height:${Math.round(h * 0.84)}px;background:transparent;border:6px solid #18181b;border-radius:24px;z-index:10"></div>`
    },
    {
        id: 'glass', label: 'Glas-Box', cat: 'shapes', icon: 'blur_on',
        make: (w, h) => `<div data-cd-layer="shape" style="position:absolute;left:${Math.round(w * 0.12)}px;top:${Math.round(h * 0.32)}px;width:${Math.round(w * 0.76)}px;height:${Math.round(h * 0.32)}px;background:rgba(255,255,255,0.16);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:2px solid rgba(255,255,255,0.28);border-radius:32px;z-index:12"></div>`
    },
    {
        id: 'line-h', label: 'Linie', cat: 'shapes', icon: 'horizontal_rule',
        make: (w, h) => `<div data-cd-layer="shape" style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.5)}px;width:${Math.round(w * 0.8)}px;height:6px;background:#18181b;border-radius:4px;z-index:12"></div>`
    },
    {
        id: 'line-v', label: 'Trenner', cat: 'shapes', icon: 'more_vert',
        make: (w, h) => `<div data-cd-layer="shape" style="position:absolute;left:${Math.round(w * 0.5)}px;top:${Math.round(h * 0.15)}px;width:6px;height:${Math.round(h * 0.7)}px;background:#18181b;border-radius:4px;z-index:12"></div>`
    },
    {
        id: 'arrow', label: 'Pfeil', cat: 'deco', icon: 'arrow_forward',
        make: (w, h) => `<div data-cd-layer="shape" style="position:absolute;left:${Math.round(w * 0.38)}px;top:${Math.round(h * 0.44)}px;width:240px;height:120px;color:#18181b;z-index:15"><svg viewBox="0 0 120 60" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="30" x2="104" y2="30"/><polyline points="78,10 106,30 78,50"/></svg></div>`
    },
    {
        id: 'star', label: 'Stern', cat: 'deco', icon: 'star',
        make: (w, h) => `<div data-cd-layer="shape" style="position:absolute;left:${Math.round(w * 0.38)}px;top:${Math.round(h * 0.38)}px;width:220px;height:220px;color:#f59e0b;z-index:15"><svg viewBox="0 0 100 100" width="100%" height="100%" fill="currentColor"><polygon points="50,5 63,36 96,38 71,60 79,93 50,75 21,93 29,60 4,38 37,36"/></svg></div>`
    },
    {
        id: 'sparkle', label: 'Sparkle', cat: 'deco', icon: 'auto_awesome',
        make: (w, h) => `<div data-cd-layer="shape" style="position:absolute;left:${Math.round(w * 0.4)}px;top:${Math.round(h * 0.36)}px;width:180px;height:180px;color:#18181b;z-index:15"><svg viewBox="0 0 100 100" width="100%" height="100%" fill="currentColor"><path d="M50 4 C54 34 66 46 96 50 C66 54 54 66 50 96 C46 66 34 54 4 50 C34 46 46 34 50 4 Z"/></svg></div>`
    },
    {
        id: 'check', label: 'Häkchen', cat: 'deco', icon: 'check_circle',
        make: (w, h) => `<div data-cd-layer="shape" style="position:absolute;left:${Math.round(w * 0.42)}px;top:${Math.round(h * 0.4)}px;width:160px;height:160px;color:#10b981;z-index:15"><svg viewBox="0 0 100 100" width="100%" height="100%"><circle cx="50" cy="50" r="46" fill="currentColor"/><polyline points="30,52 44,66 72,36" fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`
    },
    {
        id: 'triangle', label: 'Dreieck', cat: 'deco', icon: 'change_history',
        make: (w, h) => `<div data-cd-layer="shape" style="position:absolute;left:${Math.round(w * 0.36)}px;top:${Math.round(h * 0.35)}px;width:260px;height:230px;color:#18181b;z-index:12"><svg viewBox="0 0 100 90" width="100%" height="100%" fill="currentColor"><polygon points="50,4 96,86 4,86"/></svg></div>`
    },
    {
        id: 'quote-mark', label: 'Zitat-Zeichen', cat: 'deco', icon: 'format_quote',
        make: (w, h) => `<div data-cd-layer="text" style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.16)}px;width:200px;z-index:14;font-family:'Playfair Display',Georgia,serif;font-size:240px;line-height:0.75;color:#18181b;opacity:0.2">„</div>`
    }
];

export function blankSlideHtml(w = 1080, h = 1080, bg = '#FFFFFF') {
    const bgCss = bg.includes('gradient') ? `background-image:${bg}` : `background-color:${bg}`;
    return `<section data-slide style="width:${w}px;height:${h}px;${bgCss}" class="relative overflow-hidden"></section>`;
}

// Kuratierte Canva-Vorlagen – sofort ohne Wartezeit editierbar (Texte, Farben, Positionen, Formen).
export const TEMPLATES = [
    {
        id: 'editorial-quote',
        name: 'Editorial Zitat',
        cat: 'Social',
        format: 'square',
        previewBg: 'linear-gradient(135deg,#f8f3ea 0%,#eadfce 100%)',
        previewFg: '#1c1917',
        previewAccent: '#b45309',
        previewTitle: 'Weniger Lärm, mehr Klarheit.',
        previewTag: 'ZITAT',
        head: `<link href="${fontLinkFor('Playfair Display')}" rel="stylesheet"><link href="${fontLinkFor('Plus Jakarta Sans')}" rel="stylesheet">`,
        body: `<section data-slide style="width:1080px;height:1080px;background-image:linear-gradient(135deg,#f8f3ea 0%,#eadfce 100%)" class="relative overflow-hidden">
  <div data-cd-layer="shape" style="position:absolute;left:72px;top:72px;width:936px;height:936px;border:2px solid rgba(28,25,23,0.14);border-radius:28px;background:transparent;z-index:2"></div>
  <div data-cd-layer="text" style="position:absolute;left:130px;top:140px;padding:12px 26px;border-radius:999px;background:#1c1917;color:#f8f3ea;font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;z-index:10">GEDANKE DER WOCHE</div>
  <div data-cd-layer="text" style="position:absolute;left:120px;top:240px;width:160px;font-family:'Playfair Display',serif;font-size:220px;line-height:0.8;color:#b45309;opacity:0.35;z-index:5">„</div>
  <div data-cd-layer="text" style="position:absolute;left:130px;top:340px;width:820px;font-family:'Playfair Display',serif;font-size:94px;font-weight:700;line-height:1.08;letter-spacing:-0.02em;color:#1c1917;z-index:12">Gutes Design ist so wenig Design wie möglich.</div>
  <div data-cd-layer="shape" style="position:absolute;left:130px;top:790px;width:110px;height:5px;background:#b45309;border-radius:4px;z-index:10"></div>
  <div data-cd-layer="text" style="position:absolute;left:130px;top:824px;width:620px;font-family:'Plus Jakarta Sans',sans-serif;font-size:34px;font-weight:600;color:#57534e;z-index:10">Dieter Rams · @deinprofil</div>
</section>`
    },
    {
        id: 'bold-drop',
        name: 'Modern Sale Drop',
        cat: 'Social',
        format: 'portrait',
        previewBg: 'linear-gradient(145deg,#111114 0%,#1f1f27 100%)',
        previewFg: '#ffffff',
        previewAccent: '#f97316',
        previewTitle: 'WEEKEND DROP -30%',
        previewTag: 'SALE',
        head: `<link href="${fontLinkFor('Bebas Neue')}" rel="stylesheet"><link href="${fontLinkFor('Plus Jakarta Sans')}" rel="stylesheet">`,
        body: `<section data-slide style="width:1080px;height:1350px;background-image:linear-gradient(145deg,#111114 0%,#1f1f27 100%)" class="relative overflow-hidden">
  <div data-cd-layer="shape" style="position:absolute;left:640px;top:-120px;width:580px;height:580px;border-radius:9999px;background:#f97316;opacity:0.9;z-index:2"></div>
  <div data-cd-layer="shape" style="position:absolute;left:-140px;top:940px;width:460px;height:460px;border-radius:9999px;background:rgba(255,255,255,0.06);z-index:2"></div>
  <div data-cd-layer="text" style="position:absolute;left:88px;top:96px;padding:16px 32px;border-radius:999px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:#ffffff;font-family:'Plus Jakarta Sans',sans-serif;font-size:28px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;z-index:10">NUR DIESES WOCHENENDE</div>
  <div data-cd-layer="text" style="position:absolute;left:88px;top:270px;width:900px;font-family:'Bebas Neue',sans-serif;font-size:235px;line-height:0.9;letter-spacing:0.02em;color:#ffffff;z-index:12">SUMMER<br>STUDIO<br>DROP</div>
  <div data-cd-layer="shape" style="position:absolute;left:88px;top:945px;width:904px;height:210px;border-radius:32px;background:rgba(255,255,255,0.08);border:2px solid rgba(255,255,255,0.14);z-index:8"></div>
  <div data-cd-layer="text" style="position:absolute;left:134px;top:986px;width:360px;font-family:'Plus Jakarta Sans',sans-serif;font-size:96px;font-weight:800;line-height:1;color:#f97316;z-index:14">-30%</div>
  <div data-cd-layer="text" style="position:absolute;left:460px;top:996px;width:490px;font-family:'Plus Jakarta Sans',sans-serif;font-size:36px;font-weight:600;line-height:1.35;color:#f4f4f5;z-index:14">Auf die gesamte Kollektion mit Code STUDIO30</div>
  <div data-cd-layer="text" style="position:absolute;left:88px;top:1215px;width:904px;font-family:'Plus Jakarta Sans',sans-serif;font-size:30px;font-weight:600;color:#a1a1aa;z-index:12">deinshop.de · Nur solange der Vorrat reicht</div>
</section>`
    },
    {
        id: 'carousel-tips',
        name: 'Karussell: 3 Profi-Tipps',
        cat: 'Karussell',
        format: 'carousel',
        previewBg: 'linear-gradient(145deg,#0f172a 0%,#1e293b 100%)',
        previewFg: '#f8fafc',
        previewAccent: '#38bdf8',
        previewTitle: '3 Tipps für bessere Designs',
        previewTag: '4 SLIDES',
        head: `<link href="${fontLinkFor('Space Grotesk')}" rel="stylesheet"><link href="${fontLinkFor('Inter')}" rel="stylesheet">`,
        body: `<section data-slide style="width:1080px;height:1350px;background-image:linear-gradient(145deg,#0f172a 0%,#1e293b 100%)" class="relative overflow-hidden">
  <div data-cd-layer="text" style="position:absolute;left:90px;top:100px;padding:14px 30px;border-radius:999px;background:#38bdf8;color:#0f172a;font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;letter-spacing:0.08em;z-index:10">KARUSSELL · 1/4</div>
  <div data-cd-layer="text" style="position:absolute;left:90px;top:300px;width:900px;font-family:'Space Grotesk',sans-serif;font-size:122px;font-weight:700;line-height:1.02;letter-spacing:-0.03em;color:#ffffff;z-index:12">3 Regeln für Designs, die sofort wirken</div>
  <div data-cd-layer="text" style="position:absolute;left:90px;top:850px;width:820px;font-family:'Inter',sans-serif;font-size:40px;font-weight:400;line-height:1.45;color:#cbd5e1;z-index:12">Einfache Prinzipien aus dem Studio – direkt anwendbar für deinen nächsten Post.</div>
  <div data-cd-layer="text" style="position:absolute;left:90px;top:1185px;width:900px;font-family:'Space Grotesk',sans-serif;font-size:34px;font-weight:700;color:#38bdf8;z-index:12">Wischen für Tipp 1 →</div>
</section>
<section data-slide style="width:1080px;height:1350px;background-color:#f8fafc" class="relative overflow-hidden">
  <div data-cd-layer="text" style="position:absolute;left:90px;top:96px;font-family:'Space Grotesk',sans-serif;font-size:30px;font-weight:700;color:#64748b;z-index:10">01 / KONTRABALANCE · 2/4</div>
  <div data-cd-layer="text" style="position:absolute;left:84px;top:210px;width:300px;font-family:'Space Grotesk',sans-serif;font-size:200px;font-weight:700;line-height:0.9;color:#0284c7;z-index:10">01</div>
  <div data-cd-layer="text" style="position:absolute;left:90px;top:460px;width:900px;font-family:'Space Grotesk',sans-serif;font-size:94px;font-weight:700;line-height:1.06;letter-spacing:-0.03em;color:#0f172a;z-index:12">Ein starker Fokus pro Slide</div>
  <div data-cd-layer="shape" style="position:absolute;left:90px;top:730px;width:900px;height:310px;border-radius:32px;background:#ffffff;border:2px solid #e2e8f0;z-index:6"></div>
  <div data-cd-layer="text" style="position:absolute;left:140px;top:785px;width:800px;font-family:'Inter',sans-serif;font-size:40px;line-height:1.5;color:#334155;z-index:12">Überlade deine Leinwand nicht. Eine klare Botschaft, viel Weißraum und ein starker Größenkontrast reichen aus.</div>
  <div data-cd-layer="text" style="position:absolute;left:90px;top:1185px;width:900px;font-family:'Space Grotesk',sans-serif;font-size:32px;font-weight:700;color:#0f172a;z-index:12">Weiter →</div>
</section>
<section data-slide style="width:1080px;height:1350px;background-color:#f8fafc" class="relative overflow-hidden">
  <div data-cd-layer="text" style="position:absolute;left:90px;top:96px;font-family:'Space Grotesk',sans-serif;font-size:30px;font-weight:700;color:#64748b;z-index:10">02 / TYPOGRAFIE · 3/4</div>
  <div data-cd-layer="text" style="position:absolute;left:84px;top:210px;width:300px;font-family:'Space Grotesk',sans-serif;font-size:200px;font-weight:700;line-height:0.9;color:#0284c7;z-index:10">02</div>
  <div data-cd-layer="text" style="position:absolute;left:90px;top:460px;width:900px;font-family:'Space Grotesk',sans-serif;font-size:94px;font-weight:700;line-height:1.06;letter-spacing:-0.03em;color:#0f172a;z-index:12">Maximal zwei Schriftarten</div>
  <div data-cd-layer="shape" style="position:absolute;left:90px;top:730px;width:900px;height:310px;border-radius:32px;background:#ffffff;border:2px solid #e2e8f0;z-index:6"></div>
  <div data-cd-layer="text" style="position:absolute;left:140px;top:785px;width:800px;font-family:'Inter',sans-serif;font-size:40px;line-height:1.5;color:#334155;z-index:12">Kombiniere eine charakterstarke Headline-Schrift mit einer ruhigen Sans-Serif für den Text. Das wirkt sofort wie aus einer Agentur.</div>
  <div data-cd-layer="text" style="position:absolute;left:90px;top:1185px;width:900px;font-family:'Space Grotesk',sans-serif;font-size:32px;font-weight:700;color:#0f172a;z-index:12">Weiter →</div>
</section>
<section data-slide style="width:1080px;height:1350px;background-image:linear-gradient(145deg,#0284c7 0%,#0f172a 100%)" class="relative overflow-hidden">
  <div data-cd-layer="text" style="position:absolute;left:90px;top:110px;font-family:'Space Grotesk',sans-serif;font-size:30px;font-weight:700;color:#bae6fd;z-index:10">DEIN NÄCHSTER SCHRITT · 4/4</div>
  <div data-cd-layer="text" style="position:absolute;left:90px;top:340px;width:900px;font-family:'Space Grotesk',sans-serif;font-size:112px;font-weight:700;line-height:1.06;letter-spacing:-0.03em;color:#ffffff;z-index:12">Speicher dir diesen Guide für später.</div>
  <div data-cd-layer="text" style="position:absolute;left:90px;top:850px;padding:28px 54px;border-radius:20px;background:#ffffff;color:#0f172a;font-family:'Space Grotesk',sans-serif;font-size:38px;font-weight:700;z-index:12">Folge @deinprofil</div>
</section>`
    },
    {
        id: 'story-event',
        name: 'Story Ankündigung',
        cat: 'Story',
        format: 'story',
        previewBg: 'linear-gradient(160deg,#062019 0%,#0f4c3a 100%)',
        previewFg: '#ecfdf5',
        previewAccent: '#34d399',
        previewTitle: 'Live Session · Heute 19 Uhr',
        previewTag: 'STORY',
        head: `<link href="${fontLinkFor('Plus Jakarta Sans')}" rel="stylesheet">`,
        body: `<section data-slide style="width:1080px;height:1920px;background-image:linear-gradient(160deg,#062019 0%,#0f4c3a 100%)" class="relative overflow-hidden">
  <div data-cd-layer="shape" style="position:absolute;left:560px;top:240px;width:620px;height:620px;border-radius:9999px;background:rgba(52,211,153,0.14);z-index:2"></div>
  <div data-cd-layer="text" style="position:absolute;left:96px;top:310px;padding:18px 36px;border-radius:999px;background:#34d399;color:#062019;font-family:'Plus Jakarta Sans',sans-serif;font-size:32px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;z-index:10">LIVE SESSION</div>
  <div data-cd-layer="text" style="position:absolute;left:96px;top:460px;width:888px;font-family:'Plus Jakarta Sans',sans-serif;font-size:132px;font-weight:800;line-height:1.02;letter-spacing:-0.03em;color:#ffffff;z-index:12">Design-Workflows der Zukunft</div>
  <div data-cd-layer="shape" style="position:absolute;left:96px;top:1050px;width:888px;height:280px;border-radius:36px;background:rgba(255,255,255,0.08);border:2px solid rgba(255,255,255,0.16);z-index:8"></div>
  <div data-cd-layer="text" style="position:absolute;left:150px;top:1106px;width:780px;font-family:'Plus Jakarta Sans',sans-serif;font-size:48px;font-weight:700;color:#34d399;z-index:12">Donnerstag · 19:00 Uhr</div>
  <div data-cd-layer="text" style="position:absolute;left:150px;top:1188px;width:780px;font-family:'Plus Jakarta Sans',sans-serif;font-size:38px;font-weight:500;color:#d1fae5;z-index:12">Kostenlos dabei sein · Q&amp;A inklusive</div>
  <div data-cd-layer="text" style="position:absolute;left:96px;top:1430px;padding:30px 56px;border-radius:24px;background:#ffffff;color:#062019;font-family:'Plus Jakarta Sans',sans-serif;font-size:40px;font-weight:800;z-index:12">Link in der Bio ↑</div>
</section>`
    },
    {
        id: 'yt-thumb',
        name: 'YouTube Thumbnail',
        cat: 'Video',
        format: 'youtube',
        previewBg: 'linear-gradient(125deg,#111116 0%,#1d4ed8 100%)',
        previewFg: '#ffffff',
        previewAccent: '#facc15',
        previewTitle: 'SO GEHT ES 10× SCHNELLER',
        previewTag: '16:9',
        head: `<link href="${fontLinkFor('Archivo Black')}" rel="stylesheet"><link href="${fontLinkFor('Plus Jakarta Sans')}" rel="stylesheet">`,
        body: `<section data-slide style="width:1280px;height:720px;background-image:linear-gradient(125deg,#111116 0%,#1e3a8a 65%,#2563eb 100%)" class="relative overflow-hidden">
  <div data-cd-layer="shape" style="position:absolute;left:760px;top:60px;width:460px;height:600px;border-radius:36px;background:rgba(255,255,255,0.08);border:3px solid rgba(255,255,255,0.2);z-index:4"></div>
  <div data-cd-layer="text" style="position:absolute;left:74px;top:76px;padding:12px 28px;border-radius:12px;background:#facc15;color:#111116;font-family:'Plus Jakarta Sans',sans-serif;font-size:32px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;z-index:12">NEUER WORKFLOW</div>
  <div data-cd-layer="text" style="position:absolute;left:74px;top:185px;width:650px;font-family:'Archivo Black',sans-serif;font-size:108px;line-height:0.98;letter-spacing:-0.02em;color:#ffffff;z-index:12">10× MEHR<br>OUTPUT</div>
  <div data-cd-layer="text" style="position:absolute;left:74px;top:450px;width:620px;font-family:'Plus Jakarta Sans',sans-serif;font-size:38px;font-weight:600;color:#dbeafe;z-index:12">In unter 5 Minuten erklärt</div>
  <div data-cd-layer="text" style="position:absolute;left:815px;top:290px;width:350px;font-family:'Plus Jakarta Sans',sans-serif;font-size:34px;font-weight:700;color:rgba(255,255,255,0.65);text-align:center;z-index:10">Hier dein Foto<br>einfügen</div>
</section>`
    },
    {
        id: 'pitch-deck',
        name: 'Präsentation Pitch',
        cat: 'Präsentation',
        format: 'presentation',
        previewBg: 'linear-gradient(135deg,#ffffff 0%,#f1f5f9 100%)',
        previewFg: '#0f172a',
        previewAccent: '#111827',
        previewTitle: 'Quartals-Update Q4',
        previewTag: '2 FOLIEN',
        head: `<link href="${fontLinkFor('Plus Jakarta Sans')}" rel="stylesheet"><link href="${fontLinkFor('Inter')}" rel="stylesheet">`,
        body: `<section data-slide style="width:1920px;height:1080px;background-color:#ffffff" class="relative overflow-hidden">
  <div data-cd-layer="shape" style="position:absolute;left:1220px;top:0px;width:700px;height:1080px;background:#111114;z-index:2"></div>
  <div data-cd-layer="text" style="position:absolute;left:120px;top:110px;font-family:'Plus Jakarta Sans',sans-serif;font-size:30px;font-weight:700;letter-spacing:0.12em;color:#64748b;text-transform:uppercase;z-index:10">STRATEGIE · 2026</div>
  <div data-cd-layer="text" style="position:absolute;left:120px;top:280px;width:980px;font-family:'Plus Jakarta Sans',sans-serif;font-size:130px;font-weight:800;line-height:1.02;letter-spacing:-0.03em;color:#0f172a;z-index:12">Produkt-Roadmap &amp; Wachstum</div>
  <div data-cd-layer="text" style="position:absolute;left:120px;top:740px;width:920px;font-family:'Inter',sans-serif;font-size:40px;color:#475569;z-index:12">Die wichtigsten Meilensteine, Zahlen und nächsten Schritte auf einen Blick.</div>
  <div data-cd-layer="text" style="position:absolute;left:1310px;top:410px;width:520px;font-family:'Plus Jakarta Sans',sans-serif;font-size:148px;font-weight:800;line-height:1;color:#ffffff;z-index:12">+142%</div>
  <div data-cd-layer="text" style="position:absolute;left:1310px;top:590px;width:500px;font-family:'Inter',sans-serif;font-size:36px;color:#a1a1aa;z-index:12">Wachstum im Vergleich zum Vorjahr</div>
</section>
<section data-slide style="width:1920px;height:1080px;background-color:#f8fafc" class="relative overflow-hidden">
  <div data-cd-layer="text" style="position:absolute;left:120px;top:100px;width:1200px;font-family:'Plus Jakarta Sans',sans-serif;font-size:84px;font-weight:800;letter-spacing:-0.03em;color:#0f172a;z-index:10">Drei zentrale Schwerpunkte</div>
  <div data-cd-layer="shape" style="position:absolute;left:120px;top:290px;width:520px;height:620px;border-radius:32px;background:#ffffff;border:2px solid #e2e8f0;z-index:4"></div>
  <div data-cd-layer="text" style="position:absolute;left:170px;top:350px;width:420px;font-family:'Plus Jakarta Sans',sans-serif;font-size:52px;font-weight:800;color:#0f172a;z-index:10">01 · Tempo</div>
  <div data-cd-layer="text" style="position:absolute;left:170px;top:450px;width:420px;font-family:'Inter',sans-serif;font-size:34px;line-height:1.5;color:#475569;z-index:10">Schnellere Abläufe von der ersten Idee bis zum fertigen Ergebnis.</div>
  <div data-cd-layer="shape" style="position:absolute;left:700px;top:290px;width:520px;height:620px;border-radius:32px;background:#ffffff;border:2px solid #e2e8f0;z-index:4"></div>
  <div data-cd-layer="text" style="position:absolute;left:750px;top:350px;width:420px;font-family:'Plus Jakarta Sans',sans-serif;font-size:52px;font-weight:800;color:#0f172a;z-index:10">02 · Qualität</div>
  <div data-cd-layer="text" style="position:absolute;left:750px;top:450px;width:420px;font-family:'Inter',sans-serif;font-size:34px;line-height:1.5;color:#475569;z-index:10">Einheitliche Marken-Optik über alle Kanäle hinweg.</div>
  <div data-cd-layer="shape" style="position:absolute;left:1280px;top:290px;width:520px;height:620px;border-radius:32px;background:#111114;z-index:4"></div>
  <div data-cd-layer="text" style="position:absolute;left:1330px;top:350px;width:420px;font-family:'Plus Jakarta Sans',sans-serif;font-size:52px;font-weight:800;color:#ffffff;z-index:10">03 · Fokus</div>
  <div data-cd-layer="text" style="position:absolute;left:1330px;top:450px;width:420px;font-family:'Inter',sans-serif;font-size:34px;line-height:1.5;color:#cbd5e1;z-index:10">Weniger Werkzeuge, mehr kreative Freiheit im Team.</div>
</section>`
    },
    {
        id: 'cafe-special',
        name: 'Café & Gastro Angebot',
        cat: 'Social',
        format: 'square',
        previewBg: 'linear-gradient(145deg,#231710 0%,#462d1e 100%)',
        previewFg: '#fef3c7',
        previewAccent: '#f59e0b',
        previewTitle: 'Frisch geröstet · 20% Rabatt',
        previewTag: 'LOCAL',
        head: `<link href="${fontLinkFor('Cormorant Garamond')}" rel="stylesheet"><link href="${fontLinkFor('DM Sans')}" rel="stylesheet">`,
        body: `<section data-slide style="width:1080px;height:1080px;background-image:linear-gradient(145deg,#231710 0%,#462d1e 100%)" class="relative overflow-hidden">
  <div data-cd-layer="shape" style="position:absolute;left:72px;top:72px;width:936px;height:936px;border-radius:40px;border:2px solid rgba(254,243,199,0.22);background:transparent;z-index:2"></div>
  <div data-cd-layer="text" style="position:absolute;left:120px;top:145px;width:840px;font-family:'DM Sans',sans-serif;font-size:28px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#f59e0b;text-align:center;z-index:10">NEUERÖFFNUNG · DIESE WOCHE</div>
  <div data-cd-layer="text" style="position:absolute;left:110px;top:255px;width:860px;font-family:'Cormorant Garamond',serif;font-size:138px;font-weight:700;line-height:0.96;color:#fef3c7;text-align:center;z-index:12">Artisan Coffee &amp; Croissants</div>
  <div data-cd-layer="shape" style="position:absolute;left:240px;top:635px;width:600px;height:150px;border-radius:999px;background:#f59e0b;z-index:8"></div>
  <div data-cd-layer="text" style="position:absolute;left:240px;top:668px;width:600px;font-family:'DM Sans',sans-serif;font-size:62px;font-weight:800;color:#231710;text-align:center;z-index:12">20% AUF ALLES</div>
  <div data-cd-layer="text" style="position:absolute;left:120px;top:860px;width:840px;font-family:'DM Sans',sans-serif;font-size:34px;color:#e7d7c1;text-align:center;z-index:10">Mo–Sa · 07:30–18:00 · Hauptstraße 14</div>
</section>`
    },
    {
        id: 'poster-event',
        name: 'Flyer / Poster Modern',
        cat: 'Print',
        format: 'poster',
        previewBg: 'linear-gradient(155deg,#fafaf9 0%,#e7e5e4 100%)',
        previewFg: '#18181b',
        previewAccent: '#dc2626',
        previewTitle: 'DESIGN NIGHT 2026',
        previewTag: 'A4 FLYER',
        head: `<link href="${fontLinkFor('Syne')}" rel="stylesheet"><link href="${fontLinkFor('Inter')}" rel="stylesheet">`,
        body: `<section data-slide style="width:1240px;height:1754px;background-color:#fafaf9" class="relative overflow-hidden">
  <div data-cd-layer="shape" style="position:absolute;left:88px;top:88px;width:1064px;height:16px;background:#18181b;z-index:6"></div>
  <div data-cd-layer="text" style="position:absolute;left:88px;top:145px;width:600px;font-family:'Inter',sans-serif;font-size:34px;font-weight:700;letter-spacing:0.12em;color:#dc2626;z-index:10">EINLADUNG · EINTRITT FREI</div>
  <div data-cd-layer="text" style="position:absolute;left:88px;top:270px;width:1064px;font-family:'Syne',sans-serif;font-size:154px;font-weight:800;line-height:0.96;letter-spacing:-0.03em;color:#18181b;z-index:12">OPEN<br>STUDIO<br>NIGHT</div>
  <div data-cd-layer="shape" style="position:absolute;left:88px;top:860px;width:1064px;height:490px;border-radius:36px;background:#18181b;z-index:4"></div>
  <div data-cd-layer="text" style="position:absolute;left:156px;top:940px;width:920px;font-family:'Syne',sans-serif;font-size:66px;font-weight:700;color:#ffffff;z-index:12">Freitag, 24. Oktober · ab 18:00</div>
  <div data-cd-layer="text" style="position:absolute;left:156px;top:1070px;width:920px;font-family:'Inter',sans-serif;font-size:40px;line-height:1.5;color:#d4d4d8;z-index:12">Live-Demos, Drinks, Musik und Austausch mit Kreativen aus der Region.</div>
  <div data-cd-layer="text" style="position:absolute;left:88px;top:1460px;width:1064px;font-family:'Inter',sans-serif;font-size:42px;font-weight:700;color:#18181b;z-index:10">Kreativquartier Halle 3 · Musterstadt</div>
  <div data-cd-layer="text" style="position:absolute;left:88px;top:1540px;width:1064px;font-family:'Inter',sans-serif;font-size:34px;color:#52525b;z-index:10">Anmeldung unter studio-night.de</div>
</section>`
    },
    {
        id: 'linkedin-insight',
        name: 'LinkedIn Insight Card',
        cat: 'Social',
        format: 'linkedin',
        previewBg: 'linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%)',
        previewFg: '#ffffff',
        previewAccent: '#38bdf8',
        previewTitle: 'Warum Klarheit gewinnt',
        previewTag: 'LINKEDIN',
        head: `<link href="${fontLinkFor('Plus Jakarta Sans')}" rel="stylesheet">`,
        body: `<section data-slide style="width:1200px;height:628px;background-image:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%)" class="relative overflow-hidden">
  <div data-cd-layer="text" style="position:absolute;left:80px;top:70px;padding:10px 24px;border-radius:999px;background:rgba(56,189,248,0.18);color:#7dd3fc;font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:700;letter-spacing:0.1em;z-index:10">INSIGHT · PRAXIS</div>
  <div data-cd-layer="text" style="position:absolute;left:80px;top:165px;width:1020px;font-family:'Plus Jakarta Sans',sans-serif;font-size:74px;font-weight:800;line-height:1.08;letter-spacing:-0.025em;color:#ffffff;z-index:12">Gute Kommunikation spart Teams jede Woche Stunden.</div>
  <div data-cd-layer="shape" style="position:absolute;left:80px;top:450px;width:96px;height:5px;background:#38bdf8;border-radius:4px;z-index:10"></div>
  <div data-cd-layer="text" style="position:absolute;left:80px;top:485px;width:900px;font-family:'Plus Jakarta Sans',sans-serif;font-size:30px;font-weight:600;color:#cbd5e1;z-index:10">Dein Name · Rolle / Unternehmen</div>
</section>`
    }
];

/** Systemprompt für die Coding-KI. brand: { primary, secondary, font, logo } */
export function designSystemPrompt({ format = 'square', slides = 1, brand = {}, editing = false, w, h } = {}) {
    const f = formatOf(format, w, h);
    const n = f.multi ? Math.max(2, Math.min(10, Number(slides) || 5)) : 1;
    const b = { primary: safeColor(brand.primary), secondary: safeColor(brand.secondary), font: safeFontName(brand.font), logo: /^https?:\/\//.test(String(brand.logo || '')) ? String(brand.logo).slice(0, 300) : '' };
    const lines = [
        'Du bist Coden Design, ein erstklassiger Grafik- und Social-Media-Designer, und baust editierbare Designs im Canva-Stil als HTML/CSS.',
        `FORMAT: ${f.label}, exakt ${f.w} × ${f.h} Pixel${f.multi ? ` pro Slide, ${n} Slides` : ''}.`,
        '',
        'AUSGABE:',
        '- Gib GENAU EIN vollständiges HTML-Dokument in einem ```html-Block aus, sonst nichts außer höchstens einem kurzen Satz davor.',
        `- Der <body> enthält genau ${n} <section data-slide>${n === 1 ? '' : ' (eine pro Slide, in Reihenfolge)'}. Jede Section hat style="width:${f.w}px;height:${f.h}px" sowie class="relative overflow-hidden".`,
        '- Tailwind CSS v4 ist schon geladen – nutze Tailwind-Klassen (auch die bekannten v3-Namen wie bg-gradient-to-t funktionieren), auch beliebige Werte wie text-[120px], bg-[#1a1a1a], font-[\'Montserrat\'], tracking-[-0.02em]. Zusätzliches CSS darf in ein <style> im <head>.',
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
        f.id === 'youtube' ? '- YouTube Thumbnail: extrem klare Lesbarkeit auch klein, max. 3–5 Wörter in der Headline, starker Kontrast.' : null,
        f.multi ? `- Mehrere Slides: einheitliches Design über alle ${n} Slides. Slide 1 = Hook/Titel, Mitte = Inhalt (ein Gedanke pro Slide), letzter Slide = Call-to-Action / Fazit.` : null,
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
export const cleanImagePrompt = (p) => clean1(String(p || '').replace(/<[^>]*>/g, ' ').replace(/["„“”<>]/g, ''), 1200);
export function exportName(title, i, n, ext = 'png') {
    const e = ext === 'jpg' || ext === 'jpeg' ? 'jpg' : 'png';
    const base = String(title || '').replace(/[^A-Za-z0-9ÄÖÜäöüß _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'Coden-Design';
    return n > 1 ? `${base}-${i}-von-${n}.${e}` : `${base}.${e}`;
}

// Tailwind kommt von Codens eigener Adresse (js/vendor/tailwind-browser.js, v4) statt vom fremden CDN:
// Im abgeschotteten iframe lud cdn.tailwindcss.com auf dem iPad nicht → Layout ohne jede Klasse (27.11.).
const ASSET_RE = /^https?:\/\/[A-Za-z0-9.\-]+(?::\d+)?$/;
export const TAILWIND_PATH = '/js/vendor/tailwind-browser.js';
const cspFor = (assets) => `default-src 'none'; img-src * data: blob:; media-src * data: blob:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; script-src 'unsafe-inline' ${ASSET_RE.test(assets) ? assets : 'https://cdn.tailwindcss.com'}; connect-src * data: blob:; form-action 'none'; base-uri 'none'`;
const tailwindTag = (assets) => (ASSET_RE.test(assets) ? `<script src="${assets}${TAILWIND_PATH}"><\/script>` : '<script src="https://cdn.tailwindcss.com"><\/script>');
const EMPTY_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export { EMPTY_IMG };

/**
 * Komplettes Dokument fürs iframe.
 * mode: 'edit' (Canva-Canvas mit Auswahl, Drag/Resize/Rotate, Smart Guides, Inline-Text) | 'view' (nur ansehen).
 */
export function frameDoc({ head = '', body = '', format = 'square', w, h, lib = '', mode = 'edit', active = 0, assets = '' } = {}) {
    const f = formatOf(format, w, h);
    const cfg = { w: f.w, h: f.h, mode, active };
    const uiCss = mode === 'edit' ? `
#cd-ui{position:fixed;inset:0;pointer-events:none;z-index:2147483640;user-select:none;-webkit-user-select:none}
#cd-hov{position:fixed;border:2px dashed rgba(59,130,246,.75);border-radius:3px;pointer-events:none;display:none;box-sizing:border-box}
#cd-box{position:fixed;border:3px solid #3b82f6;box-shadow:0 0 0 1px rgba(255,255,255,.75);pointer-events:none;display:none;box-sizing:border-box;transform-origin:center center}
#cd-box.editing{border-style:dashed;border-color:#2563eb}
#cd-box.editing .cd-h,#cd-box.editing .cd-rot,#cd-box.editing .cd-quick{display:none!important}
.cd-h{position:absolute;background:#ffffff;border:3px solid #3b82f6;box-shadow:0 2px 6px rgba(0,0,0,.22);pointer-events:auto;box-sizing:border-box}
.cd-h.c{width:22px;height:22px;border-radius:50%}
.cd-h.ew{width:14px;height:36px;border-radius:8px;top:50%;transform:translateY(-50%)}
.cd-h.ns{width:36px;height:14px;border-radius:8px;left:50%;transform:translateX(-50%)}
.cd-h[data-h="nw"]{left:-11px;top:-11px;cursor:nwse-resize}
.cd-h[data-h="ne"]{right:-11px;top:-11px;cursor:nesw-resize}
.cd-h[data-h="sw"]{left:-11px;bottom:-11px;cursor:nesw-resize}
.cd-h[data-h="se"]{right:-11px;bottom:-11px;cursor:nwse-resize}
.cd-h[data-h="w"]{left:-7px;cursor:ew-resize}
.cd-h[data-h="e"]{right:-7px;cursor:ew-resize}
.cd-h[data-h="n"]{top:-7px;cursor:ns-resize}
.cd-h[data-h="s"]{bottom:-7px;cursor:ns-resize}
.cd-rot{position:absolute;left:50%;bottom:-56px;transform:translateX(-50%);width:36px;height:36px;border-radius:50%;background:#ffffff;border:3px solid #3b82f6;color:#1e3a8a;display:flex;align-items:center;justify-content:center;cursor:grab;pointer-events:auto;box-shadow:0 4px 12px rgba(0,0,0,.22)}
.cd-rot:before{content:'';position:absolute;bottom:100%;left:50%;width:3px;height:18px;background:#3b82f6;transform:translateX(-50%)}
.cd-rot:active{cursor:grabbing;background:#3b82f6;color:#fff}
.cd-badge{position:fixed;background:#111827;color:#fff;font:700 22px/1 system-ui,sans-serif;padding:8px 14px;border-radius:10px;pointer-events:none;display:none;z-index:2147483645;box-shadow:0 6px 18px rgba(0,0,0,.3)}
.cd-guide{position:fixed;background:#ec4899;pointer-events:none;display:none;z-index:2147483642}
#cd-gx{width:2px;top:0;bottom:0}
#cd-gy{height:2px;left:0;right:0}
.cd-quick{position:fixed;display:none;gap:6px;padding:7px;border-radius:14px;background:#18181b;border:1px solid rgba(255,255,255,.16);box-shadow:0 10px 28px rgba(0,0,0,.36);pointer-events:auto;z-index:2147483644;align-items:center}
.cd-quick button{width:42px;height:42px;border:0;border-radius:10px;background:transparent;color:#f4f4f5;cursor:pointer;display:flex;align-items:center;justify-content:center;font:600 22px/1 system-ui,sans-serif;padding:0}
.cd-quick button:hover{background:rgba(255,255,255,.14)}
.cd-quick button.del:hover{background:rgba(239,68,68,.24);color:#fca5a5}
[contenteditable="true"]{outline:none!important;cursor:text!important}` : '';

    const css = `html,body{margin:0;padding:0;background:transparent}body{width:${f.w}px;height:${f.h}px;overflow:hidden}[data-slide]{width:${f.w}px!important;height:${f.h}px!important;min-height:0!important;max-height:none!important;position:relative;overflow:hidden;flex:none}
.cd-hide{display:none!important}
img[data-ai-state="pending"]{background:linear-gradient(100deg,#26262b 30%,#3b3b44 50%,#26262b 70%);background-size:300% 100%;animation:cdsh 1.3s linear infinite;object-fit:cover}
img[data-ai-state="error"]{background:repeating-linear-gradient(45deg,#2a2a2e,#2a2a2e 14px,#33333a 14px,#33333a 28px)}
@keyframes cdsh{from{background-position:100% 0}to{background-position:-100% 0}}${uiCss}`;

    return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${cspFor(assets)}">`
        + `${tailwindTag(assets)}${head}<style data-cd-injected>${css}</style></head>`
        + `<body>${body}${lib ? `<script data-cd-injected>${lib.replace(/<\/script/gi, '<\\/script')}<\/script>` : ''}`
        + `<script data-cd-injected>(${bridge.toString()})(${JSON.stringify(cfg)});<\/script></body></html>`;
}

// Läuft IM iframe (eigener Ursprung). Canva-Canvas-Engine mit postMessage-Brücke zur Seite.
function bridge(cfg) {
    const post = (m) => parent.postMessage(Object.assign({ codenDesign: 1 }, m), '*');
    const slides = () => { const s = Array.from(document.querySelectorAll('[data-slide]')); return s.length ? s : [document.body]; };
    let active = Math.min(cfg.active || 0, slides().length - 1);
    let sel = null, editing = null, idSeq = 1;
    let ui = null, hov = null, box = null, gx = null, gy = null, badge = null, quick = null;
    let drag = null;

    const curSlide = () => slides()[active] || slides()[0];
    const ensureId = (el) => {
        if (!el || el === document.body) return '';
        let id = el.getAttribute('data-cd-id');
        if (!id) { id = 'el' + (idSeq++); el.setAttribute('data-cd-id', id); }
        return id;
    };
    const isTextTag = (el) => /^(H1|H2|H3|H4|H5|H6|P|SPAN|A|BUTTON|LI|BLOCKQUOTE|SMALL|STRONG|B|EM|I|FIGCAPTION|LABEL)$/.test(el.tagName);
    const hasOwnText = (el) => Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    const elemKind = (el) => {
        if (!el) return null;
        const l = el.getAttribute('data-cd-layer');
        if (l === 'text') return 'text';
        if (l === 'image' || el.tagName === 'IMG') return 'image';
        if (l === 'shape' || el.tagName === 'SVG') return 'shape';
        if (el.querySelector && el.querySelector('img') && !hasOwnText(el) && el.children.length === 1) return 'image';
        if (isTextTag(el) || hasOwnText(el)) return 'text';
        return 'shape';
    };

    const getTx = (el) => parseFloat(el.getAttribute('data-cd-tx') || '0') || 0;
    const getTy = (el) => parseFloat(el.getAttribute('data-cd-ty') || '0') || 0;
    const getRot = (el) => parseFloat(el.getAttribute('data-cd-rot') || '0') || 0;
    const applyTransform = (el, tx, ty, rot) => {
        if (getComputedStyle(el).display === 'inline') el.style.display = 'inline-block';
        el.setAttribute('data-cd-tx', String(Math.round(tx)));
        el.setAttribute('data-cd-ty', String(Math.round(ty)));
        el.setAttribute('data-cd-rot', String(Math.round(rot)));
        const parts = [];
        if (Math.round(tx) || Math.round(ty)) parts.push(`translate(${Math.round(tx)}px,${Math.round(ty)}px)`);
        if (Math.round(rot)) parts.push(`rotate(${Math.round(rot)}deg)`);
        el.style.transform = parts.join(' ');
    };
    const rgbToHex = (c) => {
        if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return '';
        const m = String(c).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (!m) return /^#[0-9a-f]{3,6}$/i.test(c) ? c : '';
        return '#' + [m[1], m[2], m[3]].map(v => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0')).join('');
    };

    const cleanBody = () => {
        const c = document.body.cloneNode(true);
        c.querySelectorAll('[data-cd-injected]').forEach(n => n.remove());
        c.querySelectorAll('[contenteditable],[data-cd-text],[spellcheck],[data-cd-id]').forEach(n => {
            n.removeAttribute('contenteditable'); n.removeAttribute('data-cd-text'); n.removeAttribute('spellcheck'); n.removeAttribute('data-cd-id');
        });
        c.querySelectorAll('.cd-hide,.cd-sel').forEach(n => { n.classList.remove('cd-hide', 'cd-sel'); if (!n.getAttribute('class')) n.removeAttribute('class'); });
        return c.innerHTML.trim();
    };

    let bodyTimer = null;
    const emitBody = (immediate = false) => {
        clearTimeout(bodyTimer);
        if (immediate) post({ t: 'body', body: cleanBody(), commit: true });
        else bodyTimer = setTimeout(() => post({ t: 'body', body: cleanBody(), commit: true }), 260);
    };

    const slideBgInfo = () => {
        const sl = curSlide(); if (!sl) return { color: '#ffffff', gradient: '' };
        const cs = getComputedStyle(sl);
        return { color: rgbToHex(cs.backgroundColor) || '#ffffff', gradient: cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : '' };
    };

    const elemBox = (el) => {
        const r = el.getBoundingClientRect();
        const rot = getRot(el);
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const w = rot ? (el.offsetWidth || r.width) : r.width;
        const h = rot ? (el.offsetHeight || r.height) : r.height;
        return { x: cx - w / 2, y: cy - h / 2, w: Math.max(16, w), h: Math.max(16, h), cx, cy, rot };
    };

    const syncBox = () => {
        if (!box) return;
        if (!sel || !document.contains(sel) || !curSlide()?.contains(sel)) {
            box.style.display = 'none'; quick.style.display = 'none'; return;
        }
        const b = elemBox(sel);
        box.style.display = 'block';
        box.style.left = b.x + 'px';
        box.style.top = b.y + 'px';
        box.style.width = b.w + 'px';
        box.style.height = b.h + 'px';
        box.style.transform = b.rot ? `rotate(${b.rot}deg)` : 'none';
        box.classList.toggle('editing', editing === sel);
        if (editing === sel) { quick.style.display = 'none'; return; }
        quick.style.display = 'flex';
        const qW = 200, qH = 56;
        const qx = Math.max(12, Math.min(cfg.w - qW - 12, b.cx - qW / 2));
        const qy = b.y > 76 ? b.y - qH - 14 : Math.min(cfg.h - qH - 12, b.y + b.h + 68);
        quick.style.left = qx + 'px';
        quick.style.top = qy + 'px';
    };

    const emitSel = () => {
        syncBox();
        if (!sel || !document.contains(sel)) {
            post({ t: 'sel', id: null, kind: null, slideBg: slideBgInfo() });
            return;
        }
        const cs = getComputedStyle(sel);
        const kind = elemKind(sel);
        const b = elemBox(sel);
        const imgEl = sel.tagName === 'IMG' ? sel : sel.querySelector?.('img[data-ai-id]');
        const img = imgEl ? {
            aiId: imgEl.getAttribute('data-ai-id') || '',
            prompt: imgEl.getAttribute('data-ai-image-prompt') || '',
            src: imgEl.getAttribute('src') || '',
            state: imgEl.getAttribute('data-ai-state') || ''
        } : null;
        const fam = String(cs.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim();
        post({
            t: 'sel',
            id: ensureId(sel),
            kind,
            tag: sel.tagName.toLowerCase(),
            layer: !!sel.hasAttribute('data-cd-layer'),
            hasSvg: sel.tagName === 'SVG' || !!sel.querySelector?.('svg'),
            rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) },
            rot: Math.round(b.rot),
            styles: {
                fontFamily: fam,
                fontSize: Math.round(parseFloat(cs.fontSize) || 32),
                fontWeight: String(cs.fontWeight || '400'),
                fontStyle: cs.fontStyle || 'normal',
                textDecoration: cs.textDecorationLine || 'none',
                textTransform: cs.textTransform || 'none',
                color: rgbToHex(cs.color) || '#111114',
                backgroundColor: rgbToHex(cs.backgroundColor) || '',
                textAlign: cs.textAlign || 'left',
                letterSpacing: Math.round((parseFloat(cs.letterSpacing) || 0) * 10) / 10,
                lineHeight: Math.round(((parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2) / (parseFloat(cs.fontSize) || 32)) * 100) / 100,
                opacity: Math.round((parseFloat(cs.opacity) || 1) * 100),
                borderRadius: Math.round(parseFloat(cs.borderRadius) || 0),
                borderWidth: Math.round(parseFloat(cs.borderTopWidth) || 0),
                borderColor: rgbToHex(cs.borderTopColor) || '#111114',
                zIndex: parseInt(cs.zIndex, 10) || 1,
                objectFit: imgEl ? (getComputedStyle(imgEl).objectFit || 'cover') : 'cover'
            },
            img,
            slideBg: slideBgInfo()
        });
    };

    const stopEdit = (commit = true) => {
        if (!editing) return;
        editing.removeAttribute('contenteditable');
        editing.removeAttribute('spellcheck');
        const was = editing;
        editing = null;
        syncBox();
        if (commit) emitBody(true);
        if (sel === was) emitSel();
    };

    const startEdit = (el) => {
        if (!el || elemKind(el) !== 'text') return;
        if (editing && editing !== el) stopEdit(true);
        editing = el;
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'false');
        el.focus();
        syncBox();
    };

    const selectEl = (el) => {
        if (editing && editing !== el) stopEdit(true);
        sel = el && curSlide()?.contains(el) && el !== curSlide() ? el : null;
        emitSel();
        const imgEl = sel ? (sel.tagName === 'IMG' ? sel : sel.querySelector?.('img[data-ai-id]')) : null;
        post({ t: 'img-select', id: imgEl ? imgEl.getAttribute('data-ai-id') : null });
    };

    const findSelectable = (target) => {
        const sl = curSlide();
        if (!target || !sl || !sl.contains(target) || target === sl) return null;
        if (target.closest && target.closest('[data-cd-injected]')) return null;
        const layer = target.closest('[data-cd-layer]');
        if (layer && sl.contains(layer) && layer !== sl) return layer;
        let cur = target;
        while (cur && cur !== sl) {
            if (cur.tagName === 'IMG' || cur.tagName === 'SVG') return cur;
            if (isTextTag(cur) && (hasOwnText(cur) || cur.textContent.trim())) {
                if (cur.parentElement && cur.parentElement !== sl && isTextTag(cur.parentElement) && cur.tagName === 'SPAN') { cur = cur.parentElement; continue; }
                return cur;
            }
            if (cur.tagName === 'DIV' || cur.tagName === 'ARTICLE' || cur.tagName === 'HEADER' || cur.tagName === 'FOOTER') {
                if (hasOwnText(cur)) return cur;
                const cs = getComputedStyle(cur);
                const r = cur.getBoundingClientRect();
                const full = r.width >= cfg.w * 0.96 && r.height >= cfg.h * 0.96;
                const hasVis = (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') || (cs.backgroundImage && cs.backgroundImage !== 'none') || parseFloat(cs.borderTopWidth) > 0;
                if (hasVis && !full) return cur;
            }
            cur = cur.parentElement;
        }
        return null;
    };

    const show = (i) => {
        stopEdit(false);
        const s = slides();
        active = Math.max(0, Math.min(i, s.length - 1));
        s.forEach((el, k) => el.classList.toggle('cd-hide', k !== active && s.length > 1));
        sel = null;
        if (hov) hov.style.display = 'none';
        emitSel();
        post({ t: 'slide', i: active, n: s.length });
    };

    const hideGuides = () => { if (gx) gx.style.display = 'none'; if (gy) gy.style.display = 'none'; if (badge) badge.style.display = 'none'; };

    const snapTargets = (ignoreEl) => {
        const xs = [cfg.w / 2, 80, cfg.w - 80], ys = [cfg.h / 2, 80, cfg.h - 80];
        const sl = curSlide(); if (!sl) return { xs, ys };
        Array.from(sl.children).forEach(ch => {
            if (ch === ignoreEl || ch.hasAttribute('data-cd-injected')) return;
            const r = ch.getBoundingClientRect();
            if (r.width >= cfg.w * 0.96 && r.height >= cfg.h * 0.96) return;
            xs.push(r.left, r.left + r.width / 2, r.right);
            ys.push(r.top, r.top + r.height / 2, r.bottom);
        });
        return { xs, ys };
    };

    const setupUI = () => {
        ui = document.createElement('div'); ui.id = 'cd-ui'; ui.setAttribute('data-cd-injected', '1');
        hov = document.createElement('div'); hov.id = 'cd-hov';
        box = document.createElement('div'); box.id = 'cd-box';
        const handles = [
            ['nw', 'c'], ['ne', 'c'], ['sw', 'c'], ['se', 'c'],
            ['n', 'ns'], ['s', 'ns'], ['w', 'ew'], ['e', 'ew']
        ];
        handles.forEach(([h, cls]) => {
            const d = document.createElement('div'); d.className = 'cd-h ' + cls; d.setAttribute('data-h', h);
            box.appendChild(d);
        });
        const rot = document.createElement('div'); rot.className = 'cd-rot'; rot.setAttribute('data-h', 'rot'); rot.title = 'Drehen';
        rot.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><polyline points="21 3 21 8 16 8"/></svg>';
        box.appendChild(rot);
        gx = document.createElement('div'); gx.id = 'cd-gx'; gx.className = 'cd-guide';
        gy = document.createElement('div'); gy.id = 'cd-gy'; gy.className = 'cd-guide';
        badge = document.createElement('div'); badge.className = 'cd-badge';
        quick = document.createElement('div'); quick.className = 'cd-quick';
        quick.innerHTML = [
            ['front', 'Nach vorne', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>'],
            ['back', 'Nach hinten', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>'],
            ['dup', 'Duplizieren', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'],
            ['del', 'Löschen', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>']
        ].map(([cmd, tip, svg]) => `<button type="button" data-qcmd="${cmd}" class="${cmd === 'del' ? 'del' : ''}" title="${tip}">${svg}</button>`).join('');
        ui.append(hov, box, gx, gy, badge, quick);
        document.body.appendChild(ui);

        quick.addEventListener('pointerdown', (e) => e.stopPropagation());
        quick.addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.target.closest('button[data-qcmd]');
            if (btn) runCmd(btn.getAttribute('data-qcmd'));
        });
    };

    const runCmd = (cmd, arg) => {
        if (cmd === 'deselect') { selectEl(null); return; }
        if (!sel || !document.contains(sel)) return;
        const sl = curSlide(); if (!sl) return;
        if (cmd === 'edit-text') { startEdit(sel); return; }
        if (cmd === 'del') {
            const target = sel; selectEl(null); target.remove(); emitBody(true); return;
        }
        if (cmd === 'dup') {
            const clone = sel.cloneNode(true);
            clone.removeAttribute('data-cd-id');
            if (clone.hasAttribute('data-cd-layer')) {
                clone.style.left = ((parseFloat(clone.style.left) || 0) + 32) + 'px';
                clone.style.top = ((parseFloat(clone.style.top) || 0) + 32) + 'px';
            } else {
                applyTransform(clone, getTx(clone) + 32, getTy(clone) + 32, getRot(clone));
            }
            const z = parseInt(getComputedStyle(sel).zIndex, 10) || 10;
            clone.style.zIndex = String(z + 1);
            sel.parentElement.appendChild(clone);
            selectEl(clone);
            emitBody(true);
            return;
        }
        if (cmd === 'front' || cmd === 'back' || cmd === 'to-front' || cmd === 'to-back') {
            const z = parseInt(getComputedStyle(sel).zIndex, 10) || 10;
            if (getComputedStyle(sel).position === 'static') sel.style.position = 'relative';
            if (cmd === 'front') sel.style.zIndex = String(z + 2);
            else if (cmd === 'back') sel.style.zIndex = String(Math.max(0, z - 2));
            else if (cmd === 'to-front') sel.style.zIndex = '90';
            else if (cmd === 'to-back') sel.style.zIndex = '1';
            emitSel(); emitBody(true); return;
        }
        if (cmd === 'align') {
            const b = elemBox(sel);
            let dx = 0, dy = 0;
            if (arg === 'left') dx = 80 - b.x;
            else if (arg === 'cx') dx = (cfg.w / 2) - b.cx;
            else if (arg === 'right') dx = (cfg.w - 80) - (b.x + b.w);
            else if (arg === 'top') dy = 80 - b.y;
            else if (arg === 'cy') dy = (cfg.h / 2) - b.cy;
            else if (arg === 'bottom') dy = (cfg.h - 80) - (b.y + b.h);
            if (sel.hasAttribute('data-cd-layer')) {
                sel.style.left = Math.round((parseFloat(sel.style.left) || b.x) + dx) + 'px';
                sel.style.top = Math.round((parseFloat(sel.style.top) || b.y) + dy) + 'px';
            } else {
                applyTransform(sel, getTx(sel) + dx, getTy(sel) + dy, getRot(sel));
            }
            emitSel(); emitBody(true);
        }
    };

    const applyStylePatch = (patch, target) => {
        if (target === 'slide') {
            const sl = curSlide(); if (!sl) return;
            if ('backgroundColor' in patch) { sl.style.backgroundImage = 'none'; sl.style.backgroundColor = patch.backgroundColor; }
            if ('backgroundImage' in patch) { sl.style.backgroundColor = ''; sl.style.backgroundImage = patch.backgroundImage; }
            emitSel(); emitBody(true); return;
        }
        if (!sel || !document.contains(sel)) return;
        const imgEl = sel.tagName === 'IMG' ? sel : sel.querySelector?.('img');
        for (const [k, v] of Object.entries(patch || {})) {
            if (k === 'fontFamily') sel.style.fontFamily = `'${v}', sans-serif`;
            else if (k === 'fontSize') sel.style.fontSize = Math.max(10, Math.min(400, Number(v) || 32)) + 'px';
            else if (k === 'fontWeight') sel.style.fontWeight = String(v);
            else if (k === 'fontStyle') sel.style.fontStyle = String(v);
            else if (k === 'textDecoration') sel.style.textDecoration = String(v);
            else if (k === 'textTransform') sel.style.textTransform = String(v);
            else if (k === 'color') sel.style.color = String(v);
            else if (k === 'backgroundColor') sel.style.backgroundColor = v ? String(v) : 'transparent';
            else if (k === 'textAlign') sel.style.textAlign = String(v);
            else if (k === 'letterSpacing') sel.style.letterSpacing = (Number(v) || 0) + 'px';
            else if (k === 'lineHeight') sel.style.lineHeight = String(Math.max(0.7, Math.min(3, Number(v) || 1.2)));
            else if (k === 'opacity') sel.style.opacity = String(Math.max(0, Math.min(100, Number(v))) / 100);
            else if (k === 'borderRadius') sel.style.borderRadius = Math.max(0, Number(v) || 0) + 'px';
            else if (k === 'borderWidth') {
                const bw = Math.max(0, Number(v) || 0);
                sel.style.borderWidth = bw + 'px';
                sel.style.borderStyle = bw > 0 ? 'solid' : 'none';
            }
            else if (k === 'borderColor') sel.style.borderColor = String(v);
            else if (k === 'objectFit' && imgEl) imgEl.style.objectFit = String(v);
            else if (k === 'filter') sel.style.filter = String(v || 'none');
            else if (k === 'rot') applyTransform(sel, getTx(sel), getTy(sel), Number(v) || 0);
        }
        emitSel(); emitBody(true);
    };

    if (cfg.mode === 'edit') {
        setupUI();

        document.addEventListener('pointermove', (e) => {
            if (drag) {
                e.preventDefault();
                const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
                if (drag.mode === 'move') {
                    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
                    drag.moved = true;
                    let nx = drag.bx + dx, ny = drag.by + dy;
                    let snapX = null, snapY = null;
                    if (!e.altKey) {
                        const th = 9;
                        const { xs, ys } = drag.snaps;
                        const checksX = [[nx, 0], [nx + drag.bw / 2, drag.bw / 2], [nx + drag.bw, drag.bw]];
                        for (const [val, off] of checksX) {
                            const hit = xs.find(t => Math.abs(t - val) < th);
                            if (hit != null) { nx = hit - off; snapX = hit; break; }
                        }
                        const checksY = [[ny, 0], [ny + drag.bh / 2, drag.bh / 2], [ny + drag.bh, drag.bh]];
                        for (const [val, off] of checksY) {
                            const hit = ys.find(t => Math.abs(t - val) < th);
                            if (hit != null) { ny = hit - off; snapY = hit; break; }
                        }
                    }
                    const adx = nx - drag.bx, ady = ny - drag.by;
                    if (drag.isLayer) {
                        drag.el.style.left = Math.round(drag.origLeft + adx) + 'px';
                        drag.el.style.top = Math.round(drag.origTop + ady) + 'px';
                    } else {
                        applyTransform(drag.el, drag.origTx + adx, drag.origTy + ady, drag.origRot);
                    }
                    gx.style.display = snapX != null ? 'block' : 'none'; if (snapX != null) gx.style.left = snapX + 'px';
                    gy.style.display = snapY != null ? 'block' : 'none'; if (snapY != null) gy.style.top = snapY + 'px';
                    syncBox();
                } else if (drag.mode === 'rot') {
                    const ang = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) * 180 / Math.PI - drag.startAng;
                    let deg = Math.round(drag.origRot + ang);
                    const snaps = [0, 45, 90, 135, 180, -45, -90, -135, -180];
                    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
                    else { const near = snaps.find(s => Math.abs(((deg - s + 540) % 360) - 180) < 4); if (near != null) deg = near; }
                    applyTransform(drag.el, drag.origTx, drag.origTy, deg);
                    badge.textContent = `${((deg % 360) + 360) % 360}°`;
                    badge.style.display = 'block';
                    badge.style.left = Math.min(cfg.w - 90, Math.max(12, e.clientX + 18)) + 'px';
                    badge.style.top = Math.min(cfg.h - 50, Math.max(12, e.clientY - 24)) + 'px';
                    syncBox();
                } else if (drag.mode === 'resize') {
                    const h = drag.handle;
                    const isCorner = h.length === 2;
                    let dw = (h.includes('e') ? dx : h.includes('w') ? -dx : 0);
                    let dh = (h.includes('s') ? dy : h.includes('n') ? -dy : 0);
                    let nw = Math.max(32, drag.bw + dw);
                    let nh = Math.max(24, drag.bh + dh);
                    if (drag.kind === 'text' && isCorner) {
                        const scale = Math.max(0.25, Math.min(6, nw / Math.max(32, drag.bw)));
                        drag.el.style.fontSize = Math.max(12, Math.round(drag.origFont * scale)) + 'px';
                        drag.el.style.width = Math.round(drag.bw * scale) + 'px';
                        if (drag.isLayer) {
                            if (h.includes('w')) drag.el.style.left = Math.round(drag.origLeft + (drag.bw - drag.bw * scale)) + 'px';
                            if (h.includes('n')) drag.el.style.top = Math.round(drag.origTop + (drag.bh - drag.bh * scale)) + 'px';
                        }
                    } else {
                        if (isCorner && (drag.kind === 'image' || e.shiftKey)) {
                            const ratio = drag.bw / Math.max(1, drag.bh);
                            if (Math.abs(dw) >= Math.abs(dh)) nh = Math.max(24, nw / ratio);
                            else nw = Math.max(32, nh * ratio);
                        }
                        if (h.includes('e') || h.includes('w') || isCorner) drag.el.style.width = Math.round(nw) + 'px';
                        if ((h.includes('n') || h.includes('s') || isCorner) && drag.kind !== 'text') drag.el.style.height = Math.round(nh) + 'px';
                        if (drag.isLayer) {
                            if (h.includes('w')) drag.el.style.left = Math.round(drag.origLeft + (drag.bw - nw)) + 'px';
                            if (h.includes('n') && drag.kind !== 'text') drag.el.style.top = Math.round(drag.origTop + (drag.bh - nh)) + 'px';
                        }
                    }
                    badge.textContent = `${Math.round(nw)} × ${Math.round(drag.el.offsetHeight || nh)}`;
                    badge.style.display = 'block';
                    badge.style.left = Math.min(cfg.w - 150, Math.max(12, e.clientX + 18)) + 'px';
                    badge.style.top = Math.min(cfg.h - 50, Math.max(12, e.clientY - 24)) + 'px';
                    syncBox();
                }
                return;
            }
            if (editing) { hov.style.display = 'none'; return; }
            const hit = findSelectable(e.target);
            if (hit && hit !== sel) {
                const b = elemBox(hit);
                hov.style.display = 'block';
                hov.style.left = b.x + 'px'; hov.style.top = b.y + 'px';
                hov.style.width = b.w + 'px'; hov.style.height = b.h + 'px';
                hov.style.transform = b.rot ? `rotate(${b.rot}deg)` : 'none';
            } else {
                hov.style.display = 'none';
            }
        });

        document.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const handle = e.target.closest?.('[data-h]');
            if (handle && sel) {
                e.preventDefault(); e.stopPropagation();
                document.body.style.userSelect = 'none';
                const h = handle.getAttribute('data-h');
                const b = elemBox(sel);
                const isLayer = sel.hasAttribute('data-cd-layer');
                drag = {
                    mode: h === 'rot' ? 'rot' : 'resize',
                    handle: h, el: sel, kind: elemKind(sel), isLayer,
                    sx: e.clientX, sy: e.clientY, bx: b.x, by: b.y, bw: b.w, bh: b.h, cx: b.cx, cy: b.cy,
                    origLeft: parseFloat(sel.style.left) || b.x, origTop: parseFloat(sel.style.top) || b.y,
                    origTx: getTx(sel), origTy: getTy(sel), origRot: getRot(sel),
                    origFont: parseFloat(getComputedStyle(sel).fontSize) || 32,
                    startAng: Math.atan2(e.clientY - b.cy, e.clientX - b.cx) * 180 / Math.PI
                };
                return;
            }
            if (e.target.closest?.('.cd-quick')) return;
            if (editing && editing.contains(e.target)) return;
            const hit = findSelectable(e.target);
            if (!hit) { selectEl(null); return; }
            selectEl(hit);
            document.body.style.userSelect = 'none';
            const b = elemBox(hit);
            const isLayer = hit.hasAttribute('data-cd-layer');
            drag = {
                mode: 'move', el: hit, isLayer, moved: false,
                sx: e.clientX, sy: e.clientY, bx: b.x, by: b.y, bw: b.w, bh: b.h,
                origLeft: parseFloat(hit.style.left) || b.x, origTop: parseFloat(hit.style.top) || b.y,
                origTx: getTx(hit), origTy: getTy(hit), origRot: getRot(hit),
                snaps: snapTargets(hit)
            };
        });

        const finishDrag = () => {
            if (!drag) return;
            document.body.style.userSelect = '';
            const changed = drag.mode !== 'move' || drag.moved;
            drag = null;
            hideGuides();
            if (changed) { emitSel(); emitBody(true); }
        };
        window.addEventListener('pointerup', finishDrag);
        window.addEventListener('pointercancel', finishDrag);

        document.addEventListener('dblclick', (e) => {
            if (e.target.closest?.('[data-cd-injected]')) return;
            const hit = findSelectable(e.target);
            if (hit && elemKind(hit) === 'text') {
                e.preventDefault();
                selectEl(hit);
                startEdit(hit);
            }
        });

        document.addEventListener('input', () => {
            if (editing) { syncBox(); emitBody(false); }
        });
        document.addEventListener('paste', (e) => {
            if (!editing) return;
            e.preventDefault();
            const txt = (e.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, txt);
        });
        document.addEventListener('keydown', (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (editing) {
                if (e.key === 'Escape') { e.preventDefault(); stopEdit(true); }
                return;
            }
            if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); post({ t: 'key', action: e.shiftKey ? 'redo' : 'undo' }); return; }
            if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); post({ t: 'key', action: 'redo' }); return; }
            if (mod && e.key.toLowerCase() === 'd' && sel) { e.preventDefault(); runCmd('dup'); return; }
            if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); runCmd('del'); return; }
            if (e.key === 'Escape' && sel) { e.preventDefault(); selectEl(null); return; }
            if (e.key === 'Enter' && sel && elemKind(sel) === 'text') { e.preventDefault(); startEdit(sel); return; }
            if (sel && /^Arrow(Up|Down|Left|Right)$/.test(e.key)) {
                e.preventDefault();
                const step = e.shiftKey ? 12 : 2;
                const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
                const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
                if (sel.hasAttribute('data-cd-layer')) {
                    sel.style.left = Math.round((parseFloat(sel.style.left) || elemBox(sel).x) + dx) + 'px';
                    sel.style.top = Math.round((parseFloat(sel.style.top) || elemBox(sel).y) + dy) + 'px';
                } else {
                    applyTransform(sel, getTx(sel) + dx, getTy(sel) + dy, getRot(sel));
                }
                emitSel(); emitBody(false);
            }
        });
    }

    window.addEventListener('message', async (e) => {
        const m = e.data || {}; if (e.source !== parent || !m.codenDesign) return;
        if (m.t === 'show') show(m.i);
        else if (m.t === 'load-font' && m.href) {
            if (!document.querySelector(`link[href="${CSS.escape(m.href)}"]`)) {
                const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = m.href; document.head.appendChild(l);
            }
        } else if (m.t === 'add-el' && m.html) {
            const sl = curSlide(); if (!sl) return;
            const tmp = document.createElement('div'); tmp.innerHTML = m.html.trim();
            const el = tmp.firstElementChild; if (!el) return;
            sl.appendChild(el);
            selectEl(el);
            emitBody(true);
        } else if (m.t === 'style') {
            applyStylePatch(m.patch, m.target);
        } else if (m.t === 'cmd') {
            runCmd(m.cmd, m.arg);
        } else if (m.t === 'set-img') {
            const img = document.querySelector(`img[data-ai-id="${CSS.escape(String(m.id))}"]`); if (!img) return;
            if (m.src) img.setAttribute('src', m.src);
            if (m.state) img.setAttribute('data-ai-state', m.state); else img.removeAttribute('data-ai-state');
            if (m.prompt != null) img.setAttribute('data-ai-image-prompt', m.prompt);
            if (sel && (sel === img || sel.contains(img))) emitSel();
            if (m.save) emitBody(true);
        } else if (m.t === 'select-img') {
            const img = document.querySelector(`img[data-ai-id="${CSS.escape(String(m.id))}"]`);
            if (img) {
                const k = slides().findIndex(s => s.contains(img));
                if (k >= 0 && k !== active) show(k);
                selectEl(img.closest('[data-cd-layer]') || img);
            }
        } else if (m.t === 'export') {
            const s = slides(); const el = s[m.i] || s[0]; const was = active;
            try {
                if (!window.htmlToImage) throw new Error('Export-Bibliothek fehlt.');
                stopEdit(false);
                if (ui) ui.style.display = 'none';
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                show(s.indexOf(el));
                if (document.fonts && document.fonts.ready) await document.fonts.ready;
                const opts = {
                    width: cfg.w, height: cfg.h, pixelRatio: Math.max(1, Math.min(3, Number(m.ratio) || 1)),
                    cacheBust: false, quality: m.quality || 0.92, backgroundColor: m.mime === 'image/jpeg' ? '#ffffff' : undefined,
                    style: { margin: '0', transform: 'none' },
                    filter: (n) => !(n.getAttribute && n.hasAttribute('data-cd-injected'))
                };
                const data = m.mime === 'image/jpeg'
                    ? await window.htmlToImage.toJpeg(el, opts)
                    : await window.htmlToImage.toPng(el, opts);
                post({ t: 'png', req: m.req, i: m.i, data });
            } catch (err) {
                const msg = err && err.message ? err.message : (err && err.type === 'error' ? 'Ein Bild oder eine Schrift im Design konnte nicht geladen werden.' : String(err));
                post({ t: 'png', req: m.req, i: m.i, error: msg });
            } finally {
                if (ui) ui.style.display = '';
                show(was);
            }
        }
    });

    show(active);
    const ready = () => { show(active); post({ t: 'ready', n: slides().length, h: document.body.scrollHeight }); };
    if (document.readyState === 'complete') setTimeout(ready, 30); else window.addEventListener('load', () => setTimeout(ready, 30));
}
