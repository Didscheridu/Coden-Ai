// Aufgaben & Zeitpläne: reine Logik (prüfen, nächsten Termin berechnen, beschreiben). Läuft im Server, im Browser und in den Tests.
// Ein Zeitplan: { kind: 'once', at: ISO } | { kind: 'daily', time: 'HH:MM' } | { kind: 'weekly', time: 'HH:MM', days: [1..7] } (Montag = 1).
// Uhrzeiten gelten in der Zeitzone des Nutzers (tz, z. B. Europe/Berlin), Sommer-/Winterzeit eingeschlossen.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CodenTasks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LIMITS = { tasks: 10, research: 3, title: 60, prompt: 2000, results: 100, resultChars: 60000 };
  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const DEFAULT_TZ = 'Europe/Berlin';

  const validTz = (tz) => { try { new Intl.DateTimeFormat('de-DE', { timeZone: tz }); return typeof tz === 'string' && tz.length < 60; } catch (_) { return false; } };
  const tzOf = (tz) => (validTz(tz) ? tz : DEFAULT_TZ);

  function partsIn(ms, tz) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(o.weekday) + 1;
    return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute, ss: +o.second, dow };
  }
  const offsetAt = (ms, tz) => { const p = partsIn(ms, tz); return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000; };
  // Ortszeit -> Unix-Millisekunden (zweimal nachgerechnet, damit Zeitumstellungen stimmen)
  function zonedToUtc(y, m, d, hh, mm, tz) {
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    let utc = guess - offsetAt(guess, tz); const off2 = offsetAt(utc, tz); utc = guess - off2; return utc;
  }

  const timeOk = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

  function cleanSchedule(s) {
    if (!s || typeof s !== 'object') return { error: 'Wähle, wann die Aufgabe laufen soll.' };
    if (s.kind === 'once') {
      const t = Date.parse(s.at); if (!Number.isFinite(t)) return { error: 'Wähle Datum und Uhrzeit.' };
      return { schedule: { kind: 'once', at: new Date(t).toISOString() } };
    }
    if (!timeOk(s.time)) return { error: 'Gib die Uhrzeit so an: 08:30.' };
    if (s.kind === 'daily') return { schedule: { kind: 'daily', time: s.time } };
    if (s.kind === 'weekly') {
      const days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter(d => d >= 1 && d <= 7))].sort((a, b) => a - b);
      if (!days.length) return { error: 'Wähle mindestens einen Wochentag.' };
      return { schedule: { kind: 'weekly', time: s.time, days } };
    }
    return { error: 'Unbekannter Zeitplan.' };
  }

  // Nächster Termin nach `from` (ms) oder null (einmalig und vorbei)
  function nextRun(schedule, tz, from = Date.now()) {
    tz = tzOf(tz);
    if (!schedule) return null;
    if (schedule.kind === 'once') { const t = Date.parse(schedule.at); return Number.isFinite(t) && t > from ? t : null; }
    if (!timeOk(schedule.time)) return null;
    const [hh, mm] = schedule.time.split(':').map(Number);
    const p = partsIn(from, tz);
    for (let i = 0; i <= 8; i++) {
      const day = new Date(Date.UTC(p.y, p.m - 1, p.d + i)); // nur Kalenderrechnung
      const dow = ((day.getUTCDay() + 6) % 7) + 1;
      if (schedule.kind === 'weekly' && !schedule.days.includes(dow)) continue;
      const t = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz);
      if (t > from) return t;
    }
    return null;
  }

  function describe(schedule, tz) {
    if (!schedule) return '';
    if (schedule.kind === 'once') {
      try { return 'Einmalig am ' + new Intl.DateTimeFormat('de-DE', { timeZone: tzOf(tz), day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(schedule.at)).replace(',', ' um') + ' Uhr'; } catch (_) { return 'Einmalig'; }
    }
    if (schedule.kind === 'daily') return `Täglich um ${schedule.time} Uhr`;
    const d = schedule.days || [];
    if (d.length === 7) return `Täglich um ${schedule.time} Uhr`;
    if (d.join() === '1,2,3,4,5') return `Werktags um ${schedule.time} Uhr`;
    if (d.join() === '6,7') return `Am Wochenende um ${schedule.time} Uhr`;
    return `${d.map(x => DAYS[x - 1]).join(', ')} um ${schedule.time} Uhr`;
  }

  // Eingabe prüfen und bereinigen. input: { title, prompt, schedule, research, depth, tier, tz }
  function cleanTask(input) {
    const b = input || {};
    const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.title);
    const prompt = String(b.prompt || '').trim().slice(0, LIMITS.prompt);
    if (prompt.length < 5) return { error: 'Schreib auf, was Coden tun soll (mindestens ein Satz).' };
    const sc = cleanSchedule(b.schedule); if (sc.error) return { error: sc.error };
    const tz = tzOf(b.tz);
    if (sc.schedule.kind === 'once' && nextRun(sc.schedule, tz) == null) return { error: 'Dieser Zeitpunkt liegt schon in der Vergangenheit.' };
    const tier = typeof b.tier === 'string' && /^(flash|normal|pro|byok:\d{1,9}|chain:\d{1,9})$/.test(b.tier) ? b.tier : 'flash';
    return { task: { title: title || (prompt.length <= 50 ? prompt : prompt.slice(0, 48).replace(/\s+\S*$/, '') + ' …').replace(/\s+/g, ' '), prompt, schedule: sc.schedule, research: !!b.research, depth: ['quick', 'normal', 'deep'].includes(b.depth) ? b.depth : 'normal', tier, tz } };
  }

  return { LIMITS, DAYS, DEFAULT_TZ, validTz, tzOf, partsIn, zonedToUtc, cleanSchedule, nextRun, describe, cleanTask, timeOk };
});
