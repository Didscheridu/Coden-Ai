// js/live-waves.js – Wellen am unteren Rand des Live-Modus. Höhe und Farbe folgen der Lautstärke.
const PALETTES = {
    idle: ['#5b6bff', '#7a5cff', '#3fa7ff'],
    user: ['#00f2fe', '#4facfe', '#6ee7ff'],
    ai:   ['#f093fb', '#f5576c', '#fee140']
};
export class LiveWaves {
    constructor(canvas) {
        this.c = canvas; this.ctx = canvas.getContext('2d');
        this.level = 0; this.shown = 0; this.mode = 'idle'; this.t = 0; this.raf = 0;
        this.reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        this.resize = this.resize.bind(this); this.frame = this.frame.bind(this);
    }
    resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2), r = this.c.getBoundingClientRect();
        this.c.width = Math.max(1, Math.round(r.width * dpr)); this.c.height = Math.max(1, Math.round(r.height * dpr));
        this.w = r.width; this.h = r.height; this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    start() { this.resize(); addEventListener('resize', this.resize); if (!this.raf) this.raf = requestAnimationFrame(this.frame); }
    stop() { removeEventListener('resize', this.resize); cancelAnimationFrame(this.raf); this.raf = 0; this.ctx.clearRect(0, 0, this.w || 0, this.h || 0); }
    set(level, mode) { this.level = Math.max(0, Math.min(1, level)); if (mode) this.mode = mode; }
    frame() {
        this.raf = requestAnimationFrame(this.frame);
        const { ctx, w, h } = this; if (!w) return;
        // weich nachführen: schnell hoch, langsam runter
        this.shown += (this.level - this.shown) * (this.level > this.shown ? 0.35 : 0.08);
        this.t += this.reduce ? 0.004 : 0.02 + this.shown * 0.05;
        ctx.clearRect(0, 0, w, h);
        const cols = PALETTES[this.mode] || PALETTES.idle, base = h * 0.78, amp = h * (0.06 + this.shown * 0.5);
        ctx.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 3; k++) {
            const g = ctx.createLinearGradient(0, base - amp, 0, h); g.addColorStop(0, cols[k] + 'cc'); g.addColorStop(1, cols[k] + '00');
            ctx.beginPath(); ctx.moveTo(0, h);
            for (let x = 0; x <= w; x += 6) {
                const u = x / w, env = Math.sin(Math.PI * u) ** 1.2;
                const y = base - amp * env * (0.55 + 0.45 * Math.sin(u * (3 + k * 1.7) * Math.PI + this.t * (1 + k * 0.45) + k * 1.3)) - amp * 0.15 * Math.sin(u * 9 + this.t * 1.7 + k);
                ctx.lineTo(x, y);
            }
            ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = g; ctx.globalAlpha = 0.55; ctx.fill();
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
}
