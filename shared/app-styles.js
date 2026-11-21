// Die App-Stile von Coden. Wird im Browser (window.CodenStyles) und im Backend (require) genutzt.
// Jeder Stil setzt nur CSS-Variablen des Coden-Kits und ein paar Extras. Coden darf sie in style.css überschreiben.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api; else root.CodenStyles = api;
})(typeof self !== 'undefined' ? self : this, function () {
    const S = (id, name, desc, v, extra = '') => ({ id, name, desc, v, extra });
    const STYLES = [
        S('minimal', 'Minimal', 'Viel Weißraum, klare Linien, ruhig', { dark: 0, bg: '#ffffff', surface: '#f6f6f7', surface2: '#ececee', text: '#111113', muted: '#6b6b74', primary: '#111113', onPrimary: '#ffffff', accent: '#3b82f6', border: '#e5e5e8', radius: '14px', font: 'Inter', fontHead: 'Inter' }),
        S('midnight', 'Midnight', 'Dunkles Blau, Indigo-Akzente, edel', { dark: 1, bg: '#0b1020', surface: '#141a2e', surface2: '#1d2540', text: '#e8ebf7', muted: '#8d96b5', primary: '#7c8cff', onPrimary: '#0b1020', accent: '#40e0d0', border: '#26304f', radius: '16px', font: 'Inter', fontHead: 'Sora' }),
        S('glass', 'Glas', 'Verschwommenes Glas über Farbverlauf', { dark: 1, bg: '#0f0c29', bgImage: 'radial-gradient(circle at 15% 10%, #6d28d9 0, transparent 45%), radial-gradient(circle at 85% 30%, #0ea5e9 0, transparent 40%), radial-gradient(circle at 50% 95%, #db2777 0, transparent 45%), linear-gradient(160deg, #0f0c29, #1b1446)', surface: 'rgba(255,255,255,.09)', surface2: 'rgba(255,255,255,.14)', text: '#ffffff', muted: 'rgba(255,255,255,.66)', primary: '#ffffff', onPrimary: '#1b1446', accent: '#a5b4fc', border: 'rgba(255,255,255,.18)', radius: '22px', font: 'Inter', fontHead: 'Inter', blur: '18px' }),
        S('softui', 'Soft UI', 'Weiche Schatten, wie aus Ton geformt', { dark: 0, bg: '#e9edf3', surface: '#e9edf3', surface2: '#dfe4eb', text: '#2d3748', muted: '#718096', primary: '#5a67d8', onPrimary: '#ffffff', accent: '#ed8936', border: 'transparent', radius: '20px', font: 'Nunito', fontHead: 'Nunito', shadow: '8px 8px 18px #c8ced8, -8px -8px 18px #ffffff' }, '.btn{box-shadow:5px 5px 12px #c8ced8,-5px -5px 12px #fff}.input{box-shadow:inset 4px 4px 9px #c8ced8,inset -4px -4px 9px #fff}'),
        S('brutal', 'Brutalismus', 'Dicke Ränder, harte Schatten, laut', { dark: 0, bg: '#fff7d6', surface: '#ffffff', surface2: '#ffe66d', text: '#000000', muted: '#3b3b3b', primary: '#ff5c5c', onPrimary: '#000000', accent: '#4dabf7', border: '#000000', radius: '0px', font: 'Space Grotesk', fontHead: 'Space Grotesk', shadow: '5px 5px 0 #000', borderW: '3px' }, '.btn{border:3px solid #000;box-shadow:4px 4px 0 #000}.btn:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #000}h1,h2{text-transform:uppercase;letter-spacing:-.02em}'),
        S('cupertino', 'Cupertino', 'Wie eine echte iPhone-App', { dark: 0, bg: '#f2f2f7', surface: '#ffffff', surface2: '#e9e9ee', text: '#000000', muted: '#8a8a8e', primary: '#007aff', onPrimary: '#ffffff', accent: '#34c759', border: '#d8d8dc', radius: '12px', font: '-apple-system', fontHead: '-apple-system', blur: '20px' }),
        S('material', 'Material You', 'Googles Design, freundlich und rund', { dark: 0, bg: '#fef7ff', surface: '#f3edf7', surface2: '#e8def8', text: '#1d1b20', muted: '#49454f', primary: '#6750a4', onPrimary: '#ffffff', accent: '#7d5260', border: '#cac4d0', radius: '20px', font: 'Roboto', fontHead: 'Roboto' }, '.btn{border-radius:999px}'),
        S('pixel', 'Retro 8-Bit', 'Pixel-Schrift wie bei alten Konsolen', { dark: 1, bg: '#1a1c2c', surface: '#29366f', surface2: '#3b5dc9', text: '#f4f4f4', muted: '#94b0c2', primary: '#38b764', onPrimary: '#1a1c2c', accent: '#ffcd75', border: '#f4f4f4', radius: '0px', font: 'VT323', fontHead: 'Press Start 2P', shadow: '4px 4px 0 #000', borderW: '3px', fontScale: '1.15' }, 'h1,h2,h3{line-height:1.5}.btn{border:3px solid #000;box-shadow:inset -4px -4px 0 rgba(0,0,0,.35)}'),
        S('cyber', 'Neon Cyberpunk', 'Schwarz, Neon-Pink und Cyan, leuchtend', { dark: 1, bg: '#05010d', surface: '#110725', surface2: '#1c0d3a', text: '#f5f3ff', muted: '#a78bfa', primary: '#ff2bd6', onPrimary: '#05010d', accent: '#00f0ff', border: '#3b1d6e', radius: '6px', font: 'Rajdhani', fontHead: 'Orbitron', shadow: '0 0 24px rgba(255,43,214,.35)' }, '.btn-primary{box-shadow:0 0 18px rgba(255,43,214,.7)}h1,h2{text-shadow:0 0 18px rgba(0,240,255,.55)}'),
        S('pastel', 'Pastell', 'Sanfte Farben, verspielt und weich', { dark: 0, bg: '#fff5f8', surface: '#ffffff', surface2: '#fde2ea', text: '#3d2c3e', muted: '#8f7a90', primary: '#f472b6', onPrimary: '#ffffff', accent: '#a78bfa', border: '#f7d3df', radius: '24px', font: 'Nunito', fontHead: 'Quicksand' }),
        S('nature', 'Natur', 'Erdtöne, Waldgrün, warm und organisch', { dark: 0, bg: '#f6f1e7', surface: '#fffaf0', surface2: '#ebe3d2', text: '#2b2a20', muted: '#7a7560', primary: '#2f5d3a', onPrimary: '#fffaf0', accent: '#c2703d', border: '#e0d6c0', radius: '18px', font: 'DM Sans', fontHead: 'Fraunces' }),
        S('luxury', 'Luxus', 'Schwarz und Gold, elegante Serifen', { dark: 1, bg: '#0c0b09', surface: '#16140f', surface2: '#221f17', text: '#f3ead7', muted: '#a89a7c', primary: '#d4af37', onPrimary: '#0c0b09', accent: '#f3ead7', border: '#3a3325', radius: '4px', font: 'Lato', fontHead: 'Playfair Display' }, 'h1,h2{letter-spacing:.01em;font-weight:600}.btn{letter-spacing:.12em;text-transform:uppercase;font-size:.85em}'),
        S('business', 'Business', 'Seriös, klar, vertrauenswürdig', { dark: 0, bg: '#f8fafc', surface: '#ffffff', surface2: '#eef2f7', text: '#0f172a', muted: '#64748b', primary: '#2563eb', onPrimary: '#ffffff', accent: '#0ea5e9', border: '#e2e8f0', radius: '10px', font: 'IBM Plex Sans', fontHead: 'IBM Plex Sans' }),
        S('playful', 'Verspielt', 'Knallige Farben, runde Formen, Spaß', { dark: 0, bg: '#fffbeb', surface: '#ffffff', surface2: '#fef3c7', text: '#1f1235', muted: '#6b5b7b', primary: '#7c3aed', onPrimary: '#ffffff', accent: '#f97316', border: '#1f1235', radius: '22px', font: 'Fredoka', fontHead: 'Fredoka', shadow: '0 6px 0 #1f1235', borderW: '2px' }, '.btn{border:2px solid #1f1235;box-shadow:0 4px 0 #1f1235}.btn:active{transform:translateY(3px);box-shadow:0 1px 0 #1f1235}'),
        S('editorial', 'Magazin', 'Große Serifen, wie eine Zeitschrift', { dark: 0, bg: '#faf8f3', surface: '#ffffff', surface2: '#f0ece2', text: '#141414', muted: '#6e6a60', primary: '#141414', onPrimary: '#faf8f3', accent: '#c2410c', border: '#d9d3c3', radius: '2px', font: 'Source Serif 4', fontHead: 'DM Serif Display' }, 'h1{font-size:clamp(2.6rem,7vw,5rem);line-height:1}.card{box-shadow:none;border-top:2px solid var(--c-text)}'),
        S('terminal', 'Terminal', 'Hacker-Look, grüne Monospace-Schrift', { dark: 1, bg: '#020a03', surface: '#071a0b', surface2: '#0c2912', text: '#7dff9a', muted: '#3fa957', primary: '#39ff6a', onPrimary: '#020a03', accent: '#ffd166', border: '#1b4d26', radius: '0px', font: 'JetBrains Mono', fontHead: 'JetBrains Mono', borderW: '1px' }, 'h1::before{content:"> "}body{text-shadow:0 0 6px rgba(57,255,106,.35)}'),
        S('sunset', 'Sonnenuntergang', 'Warme Verläufe von Orange bis Pink', { dark: 1, bg: '#1e1027', bgImage: 'linear-gradient(180deg, #2a1236 0%, #1e1027 60%)', surface: '#2c1838', surface2: '#3b2149', text: '#fff1ea', muted: '#d2a8b8', primary: '#ff7a59', onPrimary: '#1e1027', accent: '#ffcf5c', border: '#4a2b5a', radius: '18px', font: 'Poppins', fontHead: 'Poppins', gradient: 'linear-gradient(135deg, #ff7a59, #ff3d7f)' }, '.btn-primary{background:var(--c-gradient);color:#fff}'),
        S('nordic', 'Nordisch', 'Skandinavisch, hell, viel Holz-Gefühl', { dark: 0, bg: '#f4f2ee', surface: '#fbfaf8', surface2: '#e9e5dd', text: '#272a2e', muted: '#7d8085', primary: '#3f5f7a', onPrimary: '#ffffff', accent: '#b98b5e', border: '#e2ddd3', radius: '14px', font: 'Manrope', fontHead: 'Manrope' }),
        S('y2k', 'Y2K Chrom', 'Holografisch, Chrom und 2000er-Glanz', { dark: 0, bg: '#eef0ff', bgImage: 'linear-gradient(135deg, #e0e7ff 0%, #fae8ff 40%, #ccfbf1 100%)', surface: 'rgba(255,255,255,.75)', surface2: '#ffffff', text: '#1e1b4b', muted: '#6366f1', primary: '#8b5cf6', onPrimary: '#ffffff', accent: '#06b6d4', border: '#c7d2fe', radius: '28px', font: 'Syne', fontHead: 'Syne', blur: '12px', gradient: 'linear-gradient(120deg, #c4b5fd, #f0abfc, #67e8f9)' }, '.btn-primary{background:var(--c-gradient);color:#1e1b4b}h1{background:linear-gradient(90deg,#8b5cf6,#ec4899,#06b6d4);-webkit-background-clip:text;background-clip:text;color:transparent}'),
        S('mono', 'Schwarz-Weiß', 'Maximaler Kontrast, nur Schwarz und Weiß', { dark: 1, bg: '#000000', surface: '#0f0f0f', surface2: '#1c1c1c', text: '#ffffff', muted: '#9a9a9a', primary: '#ffffff', onPrimary: '#000000', accent: '#ffffff', border: '#2a2a2a', radius: '12px', font: 'Inter Tight', fontHead: 'Inter Tight' })
    ];
    const byId = (id) => STYLES.find(s => s.id === id) || null;
    const SYSTEM_FONTS = { '-apple-system': '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif' };
    const family = (f) => SYSTEM_FONTS[f] || `"${f}", system-ui, -apple-system, "Segoe UI", sans-serif`;

    // Google-Fonts-Link für einen Stil (oder null bei Systemschrift)
    function fontsHref(style) {
        if (!style) return 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
        const fams = [...new Set([style.v.font, style.v.fontHead])].filter(f => !SYSTEM_FONTS[f]);
        if (!fams.length) return null;
        const one = (f) => 'family=' + f.replace(/ /g, '+') + (/(VT323|Press Start 2P)/.test(f) ? '' : ':wght@400;500;600;700;800');
        return 'https://fonts.googleapis.com/css2?' + fams.map(one).join('&') + '&display=swap';
    }

    // CSS-Variablen für :root
    function themeCss(style) {
        if (!style) return '';
        const v = style.v;
        const vars = {
            '--c-bg': v.bg, '--c-bg-image': v.bgImage || 'none', '--c-surface': v.surface, '--c-surface-2': v.surface2, '--c-text': v.text,
            '--c-muted': v.muted, '--c-primary': v.primary, '--c-on-primary': v.onPrimary, '--c-accent': v.accent, '--c-border': v.border,
            '--c-gradient': v.gradient || `linear-gradient(135deg, ${v.primary}, ${v.accent})`, '--radius': v.radius,
            '--radius-sm': `calc(${v.radius} * .6)`, '--font': family(v.font), '--font-head': family(v.fontHead), '--blur': v.blur || '0px',
            '--shadow': v.shadow || (v.dark ? '0 10px 30px rgba(0,0,0,.45)' : '0 8px 24px rgba(17,17,26,.08)'),
            '--border-w': v.borderW || '1px', '--font-scale': v.fontScale || '1', 'color-scheme': v.dark ? 'dark' : 'light'
        };
        return ':root{' + Object.entries(vars).map(([k, x]) => `${k}:${x}`).join(';') + '}' + (style.extra || '');
    }
    return { STYLES, byId, themeCss, fontsHref };
});
