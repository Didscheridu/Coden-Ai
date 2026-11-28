// Spotify in Coden: reine Logik (Befehle im Chat lesen, Treffer wählen, Zustand umrechnen, Fehler auf Deutsch).
// Läuft im Browser (window.CodenSpotify) und in den Tests (require). Netz und Oberfläche stehen in js/spotify*.js.
// Das Modell schreibt z. B. <spotify action="play" q="Apache 207" type="artist"/>, Coden führt das aus und meldet das Ergebnis zurück.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CodenSpotify = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SCOPES = [
    'streaming', 'user-read-email', 'user-read-private', // Web Playback SDK (Coden als Lautsprecher im Browser)
    'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
    'playlist-read-private', 'playlist-read-collaborative'
  ];
  const ACTIONS = ['play', 'pause', 'resume', 'next', 'previous', 'volume', 'queue', 'shuffle', 'now'];
  const TYPES = ['track', 'artist', 'album', 'playlist'];
  // Freie Modelle schreiben nicht immer genau das Wort aus dem Prompt
  const ALIAS = {
    spiel: 'play', spiele: 'play', start: 'play', abspielen: 'play', play_music: 'play', search: 'play', suche: 'play',
    stop: 'pause', stopp: 'pause', anhalten: 'pause', pausieren: 'pause',
    weiter: 'resume', fortsetzen: 'resume', continue: 'resume', unpause: 'resume',
    skip: 'next', 'überspringen': 'next', ueberspringen: 'next', naechster: 'next', 'nächster': 'next', vor: 'next', forward: 'next',
    prev: 'previous', back: 'previous', zurueck: 'previous', 'zurück': 'previous', vorheriger: 'previous',
    vol: 'volume', 'lautstärke': 'volume', lautstaerke: 'volume', lauter: 'volume', leiser: 'volume',
    add: 'queue', warteschlange: 'queue', enqueue: 'queue',
    zufall: 'shuffle', mix: 'shuffle',
    status: 'now', current: 'now', playing: 'now', 'was läuft': 'now', info: 'now'
  };
  const TYPE_ALIAS = { song: 'track', titel: 'track', lied: 'track', tracks: 'track', 'künstler': 'artist', kuenstler: 'artist', band: 'artist', interpret: 'artist', artists: 'artist', albums: 'album', playlists: 'playlist', liste: 'playlist' };

  const clean = (s, n = 200) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  const norm = (s) => clean(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9äöüß ]+/g, ' ').replace(/\s+/g, ' ').trim();

  function attrs(s) {
    const out = {};
    const re = /([a-zA-Z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|„([^“”"]*)[“”"]|([^\s"'>/]+))/g;
    let m;
    while ((m = re.exec(String(s || '')))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
    return out;
  }

  // Alle <spotify …/> bzw. <spotify …>…</spotify> einer Antwort → [{ action, q, type, value }]
  const TAG = /<spotify\b([^>]*?)(?:\/>|>([\s\S]*?)<\/spotify\s*>|>)/gi;
  function parseCommands(text) {
    const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
    const out = [];
    let m;
    TAG.lastIndex = 0;
    while ((m = TAG.exec(t)) && out.length < 4) {
      const a = attrs(m[1]);
      let inner = clean(m[2] || '', 200);
      let action = clean(a.action || a.do || a.cmd || '', 30).toLowerCase();
      // <spotify>play: Apache 207</spotify> oder <spotify>pause</spotify>
      if (!action && inner) {
        const im = inner.match(/^([a-zA-ZäöüÄÖÜ_]+)\s*[:\-–]?\s*(.*)$/);
        const w = im ? im[1].toLowerCase() : '';
        if (im && (ACTIONS.includes(w) || ALIAS[w])) { action = w; inner = clean(im[2]); } else action = 'play';
      }
      action = ALIAS[action] || action;
      if (!ACTIONS.includes(action)) action = (a.q || inner) ? 'play' : 'now';
      let type = clean(a.type || a.kind || '', 20).toLowerCase();
      type = TYPE_ALIAS[type] || type;
      if (!TYPES.includes(type)) type = '';
      const q = clean(a.q || a.query || a.song || a.artist || a.name || inner, 200);
      let value = clean(a.value || a.level || a.volume || a.state || '', 10).toLowerCase();
      if (action === 'volume') {
        const num = parseInt((value || q).replace(/[^\d-]/g, ''), 10);
        value = Number.isFinite(num) ? String(Math.max(0, Math.min(100, num))) : '';
        if (!value) continue;
      }
      if (action === 'shuffle') value = /^(off|aus|false|0|nein)$/.test(value) ? 'off' : 'on';
      if (action === 'play' && !q) { out.push({ action: 'resume' }); continue; }
      if (action === 'queue' && !q) continue;
      const cmd = { action };
      if (q && (action === 'play' || action === 'queue')) cmd.q = q;
      if (type && action === 'play') cmd.type = type;
      if (value && (action === 'volume' || action === 'shuffle')) cmd.value = value;
      out.push(cmd);
    }
    return out;
  }
  // Freie Modelle verwechseln Spotify oft mit einem Konnektor und schreiben <mcp_call server="spotify" tool="pause">{…}</mcp_call>.
  // Solche Aufrufe werden hier in normale Spotify-Befehle übersetzt.
  function fromMcp(call) {
    if (!call) return null;
    const server = String(call.server || '').toLowerCase();
    const rawTool = String(call.tool || '').toLowerCase();
    if (!/spotify/.test(server) && !/spotify/.test(rawTool)) return null;
    const a = call.args && typeof call.args === 'object' ? call.args : {};
    const tool = rawTool.replace(/spotify[_\-. ]?/g, '').replace(/^(player|playback)[_\-.]?/, '').replace(/[_\-.]?(track|song|music|playback)$/, '');
    const words = tool.split(/[_\-. ]+/).filter(Boolean);
    let action = '';
    for (const w of [tool, ...words]) { const x = ALIAS[w] || w; if (ACTIONS.includes(x)) { action = x; break; } }
    if (!action) {
      if (/skip|next/.test(tool)) action = 'next';
      else if (/prev|back/.test(tool)) action = 'previous';
      else if (/vol/.test(tool)) action = 'volume';
      else if (/queue/.test(tool)) action = 'queue';
      else if (/shuffle/.test(tool)) action = 'shuffle';
      else if (/current|state|status|now/.test(tool)) action = 'now';
      else if (/pause|stop/.test(tool)) action = 'pause';
      else if (/resume|continue|unpause/.test(tool)) action = 'resume';
      else action = 'play';
    }
    const q = clean(a.q || a.query || a.search || a.track || a.song || a.name || a.artist || a.playlist || a.album || '', 200);
    const type = TYPE_ALIAS[String(a.type || '').toLowerCase()] || String(a.type || '').toLowerCase();
    const val = a.value != null ? a.value : a.volume != null ? a.volume : a.volume_percent != null ? a.volume_percent : a.level != null ? a.level : a.state;
    const attr = (k, v) => (v ? ` ${k}="${String(v).replace(/"/g, '')}"` : '');
    const cmds = parseCommands(`<spotify action="${action}"${attr('q', q)}${attr('type', TYPES.includes(type) ? type : '')}${attr('value', val == null ? '' : val === true ? 'on' : val === false ? 'off' : val)}/>`);
    return cmds[0] || null;
  }

  const strip = (text) => String(text || '').replace(TAG, '').replace(/<spotify\b[^>]*$/i, '');
  const requested = (text) => parseCommands(text).length > 0;

  // Suchanfrage „Roller von Apache 207“ → { q, artist } für eine genauere Spotify-Suche
  function splitQuery(q) {
    const s = clean(q);
    const m = s.match(/^(.+?)\s+(?:von|by|-|–)\s+(.+)$/i);
    return m ? { title: clean(m[1]), artist: clean(m[2]) } : { title: s, artist: '' };
  }
  function searchQuery(q, type) {
    const { title, artist } = splitQuery(q);
    if (artist && (!type || type === 'track')) return `track:${title} artist:${artist}`;
    return clean(q);
  }

  // Bestes Ergebnis aus einer /search-Antwort (type=track,artist,album,playlist) wählen.
  // Mit type: nur diese Sorte. Ohne: Künstler, wenn der Name passt, sonst Song, sonst Playlist/Album.
  function pickBest(q, type, res) {
    const r = res || {};
    const list = (k) => ((r[k + 's'] && r[k + 's'].items) || []).filter(Boolean);
    const want = norm(splitQuery(q).title);
    const full = norm(q);
    const same = (x) => { const n = norm(x && x.name); return n && (n === want || n === full); };
    const first = (k) => { const l = list(k); return l.find(same) || l[0] || null; };
    const wrap = (k, x) => (x ? { type: k, item: x } : null);
    if (type) return wrap(type, first(type));
    const artist = list('artist').find(same);
    if (artist) return wrap('artist', artist);
    const track = list('track').find(same);
    if (track) return wrap('track', track);
    const pl = list('playlist').find(same);
    if (pl) return wrap('playlist', pl);
    const album = list('album').find(same);
    if (album) return wrap('album', album);
    if (list('track')[0]) return wrap('track', list('track')[0]);
    if (list('artist')[0]) return wrap('artist', list('artist')[0]);
    if (list('playlist')[0]) return wrap('playlist', list('playlist')[0]);
    return wrap('album', list('album')[0] || null);
  }

  // Eigene Playlists zuerst (ein Nutzer sagt „spiel meine Chill-Playlist“)
  function pickOwnPlaylist(q, items) {
    const want = norm(String(q || '').replace(/\b(meine|meiner|mein|playlist|liste|my)\b/gi, ''));
    if (!want) return null;
    const l = (items || []).filter(Boolean);
    return l.find(p => norm(p.name) === want) || l.find(p => norm(p.name).includes(want)) || null;
  }

  // Körper für PUT /me/player/play
  function playBody(pick) {
    if (!pick || !pick.item) return null;
    const x = pick.item;
    if (pick.type === 'track') {
      // Im Album weiterlaufen lassen, damit nach dem Song nicht Stille kommt
      const album = x.album && x.album.uri;
      return album ? { context_uri: album, offset: { uri: x.uri } } : { uris: [x.uri] };
    }
    return { context_uri: x.uri };
  }

  const artistsOf = (x) => ((x && x.artists) || []).map(a => a && a.name).filter(Boolean).join(', ');
  const imageOf = (imgs, size = 300) => {
    const l = (imgs || []).filter(i => i && i.url);
    if (!l.length) return '';
    const sorted = l.slice().sort((a, b) => (a.width || 0) - (b.width || 0));
    return (sorted.find(i => (i.width || 0) >= size) || sorted[sorted.length - 1]).url;
  };
  function describe(pick) {
    if (!pick || !pick.item) return '';
    const x = pick.item;
    if (pick.type === 'track') return `„${x.name}“ von ${artistsOf(x) || 'unbekannt'}`;
    if (pick.type === 'artist') return `${x.name} (Künstler)`;
    if (pick.type === 'album') return `das Album „${x.name}“ von ${artistsOf(x) || 'unbekannt'}`;
    return `die Playlist „${x.name}“`;
  }

  // GET /me/player → einheitlicher Zustand für den Miniplayer
  function stateFromApi(j, now = Date.now()) {
    if (!j || !j.item) return j && j.device ? { playing: false, track: null, progressMs: 0, device: deviceOf(j.device), shuffle: !!j.shuffle_state, at: now } : null;
    const it = j.item;
    return {
      playing: !!j.is_playing,
      track: {
        name: it.name || '', artists: artistsOf(it) || (it.show && it.show.name) || '', album: (it.album && it.album.name) || '',
        image: imageOf((it.album && it.album.images) || it.images), uri: it.uri || '', durationMs: it.duration_ms || 0,
        url: (it.external_urls && it.external_urls.spotify) || ''
      },
      progressMs: j.progress_ms || 0,
      device: deviceOf(j.device),
      shuffle: !!j.shuffle_state,
      at: now
    };
  }
  // Web Playback SDK (player_state_changed) → derselbe Zustand
  function stateFromSdk(s, device, now = Date.now()) {
    const it = s && s.track_window && s.track_window.current_track;
    if (!it) return null;
    return {
      playing: !s.paused,
      track: {
        name: it.name || '', artists: artistsOf(it), album: (it.album && it.album.name) || '',
        image: imageOf(it.album && it.album.images), uri: it.uri || '', durationMs: it.duration_ms || s.duration || 0,
        url: it.id ? 'https://open.spotify.com/track/' + it.id : ''
      },
      progressMs: s.position || 0,
      device: device || null,
      shuffle: !!s.shuffle,
      at: now
    };
  }
  function deviceOf(d) {
    if (!d) return null;
    return { id: d.id || '', name: d.name || 'Gerät', type: d.type || '', volume: d.volume_percent == null ? null : d.volume_percent, active: !!d.is_active, restricted: !!d.is_restricted };
  }
  // Fortschritt hochrechnen, ohne ständig zu fragen
  const progressAt = (st, now = Date.now()) => (!st || !st.track ? 0 : Math.min(st.track.durationMs || Infinity, st.progressMs + (st.playing ? Math.max(0, now - st.at) : 0)));
  const fmtTime = (ms) => { const s = Math.max(0, Math.floor((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // Gerät wählen: laufendes Gerät behalten, sonst Coden im Browser, sonst Handy/Computer
  function chooseDevice(devices, sdkId) {
    const l = (devices || []).filter(d => d && d.id && !d.is_restricted);
    const active = l.find(d => d.is_active);
    if (active) return active.id;
    if (sdkId) return sdkId;
    const order = ['Computer', 'Smartphone', 'Tablet', 'Speaker', 'TV'];
    l.sort((a, b) => (order.indexOf(a.type) + 99) % 99 - (order.indexOf(b.type) + 99) % 99);
    return l[0] ? l[0].id : '';
  }

  // Fehler der Web API → verständlicher Satz
  function errorText(status, body) {
    const e = (body && body.error) || {};
    const msg = String((typeof e === 'string' ? e : e.message) || (body && body.error_description) || '').trim();
    const reason = String(e.reason || '');
    if (/not registered|developer dashboard|user may not be registered/i.test(msg)) return 'Dein Spotify-Konto ist für Coden noch nicht freigeschaltet. Kayden muss deine Spotify-E-Mail im Spotify-Dashboard unter „User Management“ eintragen (höchstens 5 Personen).';
    if (reason === 'PREMIUM_REQUIRED' || /premium/i.test(msg)) return 'Zum Abspielen und Steuern braucht dein Spotify-Konto Premium.';
    if (reason === 'NO_ACTIVE_DEVICE' || (status === 404 && /device/i.test(msg))) return 'Kein Spotify-Gerät gefunden. Öffne kurz die Spotify-App (Handy oder Computer) und versuch es nochmal.';
    if (reason === 'QUOTA_EXCEEDED') return 'Spotify-Limit für heute erreicht. Bitte später nochmal.';
    if (status === 429) return 'Spotify bremst gerade (zu viele Anfragen). Warte kurz und versuch es nochmal.';
    if (status === 401) return 'Die Spotify-Anmeldung ist abgelaufen. Bitte Spotify neu verbinden.';
    if (reason === 'UNKNOWN' && status === 403) return 'Spotify hat den Befehl abgelehnt (vielleicht gerade nicht möglich, z. B. Werbung oder Gerät gesperrt).';
    if (status === 403) return 'Spotify hat den Befehl abgelehnt' + (msg ? ` (${msg})` : '') + '.';
    if (status >= 500) return 'Spotify ist gerade nicht erreichbar. Bitte gleich nochmal.';
    return 'Spotify-Fehler' + (msg ? `: ${msg}` : ` (${status})`);
  }

  // Zeile für den Systemprompt
  function prompt(info) {
    const i = info || {};
    if (!i.configured) return '';
    if (!i.connected) return '\nSPOTIFY: Spotify ist nicht verbunden. Will der Nutzer Musik hören oder steuern, sag ihm kurz, dass er im Plus-Menü (+) auf „Spotify verbinden“ tippen soll (Spotify Premium nötig). Schreib dann KEINEN <spotify>-Befehl.\n';
    const st = i.state;
    const now = st && st.track ? `Gerade ${st.playing ? 'läuft' : 'pausiert'}: „${st.track.name}“ von ${st.track.artists}${st.device ? ` auf „${st.device.name}“` : ''}${st.device && st.device.volume != null ? `, Lautstärke ${st.device.volume} %` : ''}.` : 'Gerade läuft nichts.';
    return '\nSPOTIFY: Der Nutzer hat Spotify verbunden. Will er Musik hören, wechseln, anhalten, überspringen, lauter/leiser machen oder wissen, was läuft, antworte NUR mit einem oder mehreren Befehlen, ohne weiteren Text:\n' +
      '<spotify action="play" q="Song, Künstler, Album oder Playlist" type="track|artist|album|playlist"/> (type weglassen, wenn unklar; Song mit Künstler so: q="Roller von Apache 207")\n' +
      '<spotify action="pause"/> · <spotify action="resume"/> · <spotify action="next"/> · <spotify action="previous"/>\n' +
      '<spotify action="volume" value="0-100"/> · <spotify action="queue" q="Song von Künstler"/> · <spotify action="shuffle" value="on|off"/> · <spotify action="now"/>\n' +
      'Für Stimmungen („was Ruhiges zum Lernen“, „Gym-Musik“) such eine passende Playlist, z. B. q="Lofi Lernen" type="playlist". „Lauter“ = etwa +15, „leiser“ = etwa −15. ' +
      'WICHTIG: Spotify ist KEIN Konnektor – benutze dafür nie <mcp_call>, sondern nur <spotify …/>. Danach bekommst du das Ergebnis und antwortest in einem kurzen, lockeren Satz. Nur wenn der Nutzer wirklich Musik will – sonst keine Befehle.\n' + now + '\n';
  }

  // Ergebnis an das Modell
  function resultBlock(results) {
    const lines = (results || []).map(r => (r.ok ? '✓ ' : '✗ ') + r.text);
    const ok = (results || []).every(r => r.ok);
    return 'Spotify-Ergebnis:\n' + lines.join('\n') + '\n\n' + (ok ? 'Bestätige das jetzt in einem kurzen, lockeren Satz (ohne Befehl).' : 'Erklär dem Nutzer kurz, was nicht ging und was er tun kann (ohne Befehl).');
  }

  return { SCOPES, ACTIONS, TYPES, parseCommands, fromMcp, strip, requested, splitQuery, searchQuery, pickBest, pickOwnPlaylist, playBody, describe, artistsOf, imageOf, stateFromApi, stateFromSdk, deviceOf, progressAt, fmtTime, chooseDevice, errorText, prompt, resultBlock, norm };
});
