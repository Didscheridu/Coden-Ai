// server/context.js – Chatverlauf komprimieren, damit an die KI höchstens ~10.000 Eingabe-Tokens gehen.
// Regeln:
//  - Die letzte Nachricht des Nutzers (und alles danach, z. B. Websuche-Ergebnisse oder eine Fortsetzung) bleibt
//    immer vollständig – auch wenn sie allein schon länger ist.
//  - Der Systemprompt bleibt, wird aber auf höchstens 60 % des Budgets gekürzt (hinten: Projektwissen, Extras).
//  - Ältere Nachrichten: erst Code-Blöcke und Element-Blöcke durch kurze Platzhalter ersetzen, dann kürzen,
//    die ältesten fallen in eine kurze Zusammenfassung („Früherer Verlauf“).
//  - Keine Begrenzung der Ausgabe.
// Tokens werden wie beim Nutzungslimit geschätzt: Zeichen / 4.

const BUDGET = () => Math.max(2000, parseInt(process.env.CODEN_INPUT_BUDGET, 10) || 10000);
const tok = (s) => Math.ceil(String(s || '').length / 4);
const tokOf = (msgs) => msgs.reduce((a, m) => a + tok(m.content), 0);

// Code und große Blöcke aus alten Antworten durch Platzhalter ersetzen (der Inhalt steht ja schon im Chat)
function lighten(text) {
  let s = String(text || '');
  s = s.replace(/```([\w+-]*)[^\n]*\n([\s\S]*?)```/g, (_, lang, body) => {
    const lines = body.split('\n').length;
    return lines <= 6 ? '```' + lang + '\n' + body + '```' : `[Code${lang ? ' (' + lang + ')' : ''}, ${lines} Zeilen – gekürzt]`;
  });
  s = s.replace(/<(artifact|handwriting|quiz|flashcards|steps|stats|proscons|bars|tabs|plot|pie|lernplan|chart|slides|table)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_, tag, attrs, body) => {
    const title = (attrs.match(/title="([^"]{0,80})"/) || [])[1];
    return body.length < 400 ? `<${tag}${attrs}>${body}</${tag}>` : `[${tag}${title ? ' „' + title + '“' : ''} – Inhalt gekürzt]`;
  });
  s = s.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{200,}/gi, '[Datei]');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

// Text auf höchstens maxTok kürzen: Anfang und Ende bleiben, die Mitte fällt weg
function clip(text, maxTok) {
  const s = String(text || '');
  const max = Math.max(40, maxTok * 4);
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.7), tail = Math.max(0, max - head - 40);
  return s.slice(0, head).trimEnd() + '\n[… gekürzt …]\n' + (tail ? s.slice(-tail).trimStart() : '');
}

const firstLine = (s, n) => lighten(s).replace(/\[Code[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

// Kurze Zusammenfassung der weggelassenen (ältesten) Nachrichten, die neuesten zuerst behalten
function summarize(dropped, maxTok) {
  if (!dropped.length || maxTok < 40) return '';
  const lines = dropped.map(m => (m.role === 'user' ? 'Nutzer: ' + firstLine(m.content, 220) : 'Coden: ' + firstLine(m.content, 160))).filter(l => l.length > 8);
  const kept = [];
  let used = 30;
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = tok(lines[i]) + 1;
    if (used + t > maxTok) break;
    kept.unshift(lines[i]); used += t;
  }
  if (!kept.length) return '';
  return `## Früherer Verlauf (zusammengefasst, ${dropped.length} ältere Nachrichten)\n${kept.length < lines.length ? '…\n' : ''}${kept.join('\n')}`;
}

/**
 * messages: [{ role, content, images? }]. Gibt { messages, before, after, compressed } zurück.
 * opts.budget: Eingabe-Budget in Tokens (Standard CODEN_INPUT_BUDGET oder 10.000)
 * opts.systemShare: Anteil des Budgets, den der Systemprompt höchstens bekommt (Standard 0,6)
 */
function compressMessages(messages, opts = {}) {
  const budget = opts.budget || BUDGET();
  const list = (Array.isArray(messages) ? messages : []).map(m => ({ ...m, content: String(m.content ?? '') }));
  const before = tokOf(list);
  if (before <= budget || list.length < 2) return { messages: list, before, after: before, compressed: false };

  // Systemprompt(e) vorne, letzte Nutzer-Nachricht + alles danach hinten (bleibt vollständig)
  let sysEnd = 0;
  while (sysEnd < list.length && list[sysEnd].role === 'system') sysEnd++;
  let lastUser = list.length - 1;
  while (lastUser > sysEnd && list[lastUser].role !== 'user') lastUser--;
  if (lastUser < sysEnd) lastUser = list.length - 1;
  // Fortsetzung einer abgeschnittenen Antwort: die angefangene Antwort davor gehört dazu und bleibt ganz
  if (lastUser - 1 >= sysEnd && list[lastUser - 1].role === 'assistant' && /^(Deine letzte Antwort wurde mitten|CONTINUE\b|Mach (nahtlos )?weiter)/i.test(list[lastUser].content.trim())) lastUser--;
  const system = list.slice(0, sysEnd);
  const tail = list.slice(lastUser);
  const middle = list.slice(sysEnd, lastUser);

  const sysMax = Math.floor(budget * (opts.systemShare ?? 0.6));
  if (tokOf(system) > sysMax) {
    let left = sysMax;
    for (const m of system) {
      const t = tok(m.content);
      if (t > left) m.content = m.content.slice(0, Math.max(0, left * 4 - 60)).trimEnd() + '\n[… Rest des Systemprompts gekürzt, um Tokens zu sparen]';
      left = Math.max(0, left - tok(m.content));
    }
  }

  // Platz für den Verlauf
  let room = budget - tokOf(system) - tokOf(tail);
  const kept = [];
  let i = middle.length - 1;
  const SUMMARY_RESERVE = Math.min(700, Math.max(0, Math.floor(room * 0.15)));
  room -= SUMMARY_RESERVE;
  for (; i >= 0 && room > 0; i--) {
    const m = middle[i];
    const recent = middle.length - 1 - i < 2;          // die letzte Runde möglichst vollständig
    let content = recent ? m.content : lighten(m.content);
    let t = tok(content);
    if (t > room) {
      content = clip(lighten(m.content), Math.min(recent ? room : Math.min(room, 700), room));
      t = tok(content);
      if (t > room || t < 30) break;
    } else if (!recent && t > 1500) {
      content = clip(content, 1500); t = tok(content);
    }
    kept.unshift({ ...m, content });
    room -= t;
  }
  const dropped = middle.slice(0, i + 1);
  // Verlauf muss mit dem Nutzer beginnen (sonst lehnen manche Anbieter ab)
  while (kept.length && kept[0].role !== 'user') dropped.push(kept.shift());
  const summary = summarize(dropped, SUMMARY_RESERVE + Math.max(0, room));
  const out = [...system];
  if (summary) {
    if (out.length) out[out.length - 1] = { ...out[out.length - 1], content: out[out.length - 1].content + '\n\n' + summary };
    else out.push({ role: 'system', content: summary });
  }
  out.push(...kept, ...tail);
  return { messages: out, before, after: tokOf(out), compressed: true };
}

module.exports = { compressMessages, lighten, clip, tok, BUDGET };
