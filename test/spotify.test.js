// Spotify (Logik): shared/spotify-core.js – Befehle lesen, Treffer wählen, Zustand, Fehler, Prompt
const S = require('../shared/spotify-core');
let n = 0, bad = 0;
const chk = (name, got, want) => { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) console.log('OK  ', name); else { bad++; console.log('FAIL', name, '\n   ist:  ', g, '\n   soll: ', w); } };

// --- Befehle ---
chk('play mit q und type', S.parseCommands('<spotify action="play" q="Apache 207" type="artist"/>'), [{ action: 'play', q: 'Apache 207', type: 'artist' }]);
chk('mehrere Befehle', S.parseCommands('<spotify action="volume" value="40"/>\n<spotify action="next"/>'), [{ action: 'volume', value: '40' }, { action: 'next' }]);
chk('Kurzform im Inhalt', S.parseCommands('<spotify>play: Roller von Apache 207</spotify>'), [{ action: 'play', q: 'Roller von Apache 207' }]);
chk('nur Wort im Inhalt', S.parseCommands('<spotify>pause</spotify>'), [{ action: 'pause' }]);
chk('deutsche Aliase', S.parseCommands('<spotify action="stopp"/><spotify action="weiter"/><spotify action="überspringen" q="x"/>'), [{ action: 'pause' }, { action: 'resume' }, { action: 'next' }]);
chk('play ohne q = weiter', S.parseCommands('<spotify action="play"/>'), [{ action: 'resume' }]);
chk('type-Alias song → track', S.parseCommands('<spotify action="play" q="Bohemian Rhapsody" type="song"/>'), [{ action: 'play', q: 'Bohemian Rhapsody', type: 'track' }]);
chk('Lautstärke begrenzt', S.parseCommands('<spotify action="volume" value="150"/><spotify action="volume" value="-4"/>'), [{ action: 'volume', value: '100' }, { action: 'volume', value: '0' }]);
chk('Lautstärke ohne Zahl fliegt raus', S.parseCommands('<spotify action="volume" value="laut"/>'), []);
chk('shuffle aus', S.parseCommands("<spotify action='shuffle' value='aus'/>"), [{ action: 'shuffle', value: 'off' }]);
chk('queue braucht q', S.parseCommands('<spotify action="queue"/>'), []);
chk('Denkblock zählt nicht', S.parseCommands('<think><spotify action="pause"/></think>Hallo'), []);
chk('kein Befehl', S.requested('Musik ist toll'), false);
chk('höchstens 4 Befehle', S.parseCommands('<spotify action="next"/>'.repeat(9)).length, 4);
chk('strip entfernt Befehle', S.strip('Okay! <spotify action="play" q="x"/> los').trim(), 'Okay!  los');
chk('strip entfernt halben Befehl beim Streamen', S.strip('Klar <spotify action="pl'), 'Klar ');

// --- Verwechslung mit Konnektoren (<mcp_call server="spotify" …>) ---
chk('MCP pause', S.fromMcp({ server: 'spotify', tool: 'pause', args: {} }), { action: 'pause' });
chk('MCP spotify_pause_playback', S.fromMcp({ server: 'Spotify', tool: 'spotify_pause_playback', args: {} }), { action: 'pause' });
chk('MCP skip_to_next', S.fromMcp({ server: 'spotify', tool: 'skip_to_next', args: {} }), { action: 'next' });
chk('MCP play mit query', S.fromMcp({ server: 'spotify', tool: 'play', args: { query: 'Apache 207', type: 'artist' } }), { action: 'play', q: 'Apache 207', type: 'artist' });
chk('MCP search_and_play', S.fromMcp({ server: 'spotify', tool: 'search_and_play', args: { track: 'Roller' } }), { action: 'play', q: 'Roller' });
chk('MCP set_volume', S.fromMcp({ server: 'spotify', tool: 'set_volume', args: { volume_percent: 25 } }), { action: 'volume', value: '25' });
chk('MCP get_current_track', S.fromMcp({ server: 'spotify', tool: 'get_current_track', args: {} }), { action: 'now' });
chk('MCP resume ohne q', S.fromMcp({ server: 'spotify', tool: 'play', args: {} }), { action: 'resume' });
chk('anderer Konnektor bleibt', S.fromMcp({ server: 'github', tool: 'pause', args: {} }), null);
chk('Prompt warnt vor mcp_call', /nie <mcp_call>/.test(S.prompt({ configured: true, connected: true })), true);

// --- Suche ---
chk('Song von Künstler', S.searchQuery('Roller von Apache 207'), 'track:Roller artist:Apache 207');
chk('Künstler-Typ bleibt frei', S.searchQuery('Roller von Apache 207', 'artist'), 'Roller von Apache 207');
const res = {
  tracks: { items: [{ name: 'Roller', uri: 'spotify:track:1', artists: [{ name: 'Apache 207' }], album: { uri: 'spotify:album:9' } }, { name: 'Apache 207 Medley', uri: 'spotify:track:2', artists: [{ name: 'X' }] }] },
  artists: { items: [{ name: 'Apache 207', uri: 'spotify:artist:7' }] },
  playlists: { items: [null, { name: 'Lofi Lernen', uri: 'spotify:playlist:5' }] },
  albums: { items: [] }
};
chk('Künstlername passt → Künstler', S.pickBest('Apache 207', '', res).type, 'artist');
chk('Songname passt → Song', S.pickBest('Roller', '', res).item.uri, 'spotify:track:1');
chk('Song „von“ → Song', S.pickBest('Roller von Apache 207', '', res).item.uri, 'spotify:track:1');
chk('Typ vorgegeben', S.pickBest('irgendwas', 'playlist', res).item.uri, 'spotify:playlist:5');
chk('nichts gefunden', S.pickBest('x', '', {}), null);
chk('Song spielt im Album weiter', S.playBody({ type: 'track', item: res.tracks.items[0] }), { context_uri: 'spotify:album:9', offset: { uri: 'spotify:track:1' } });
chk('Song ohne Album', S.playBody({ type: 'track', item: res.tracks.items[1] }), { uris: ['spotify:track:2'] });
chk('Künstler als Kontext', S.playBody({ type: 'artist', item: res.artists.items[0] }), { context_uri: 'spotify:artist:7' });
chk('eigene Playlist', S.pickOwnPlaylist('meine Chill Playlist', [{ name: 'Gym' }, { name: 'Chill' }]).name, 'Chill');
chk('Beschreibung Song', S.describe({ type: 'track', item: res.tracks.items[0] }), '„Roller“ von Apache 207');

// --- Zustand ---
const st = S.stateFromApi({ is_playing: true, progress_ms: 1000, shuffle_state: true, device: { id: 'd1', name: 'iPad', type: 'Tablet', volume_percent: 30, is_active: true }, item: { name: 'Roller', uri: 'spotify:track:1', duration_ms: 180000, artists: [{ name: 'Apache 207' }], album: { name: 'Treppenhaus', images: [{ url: 'big', width: 640 }, { url: 'small', width: 64 }, { url: 'mid', width: 300 }] } } }, 1000);
chk('Zustand: Titel, Cover passend, Gerät', [st.track.name, st.track.image, st.device.name, st.device.volume, st.shuffle], ['Roller', 'mid', 'iPad', 30, true]);
chk('Fortschritt läuft weiter', S.progressAt(st, 3500), 3500);
chk('Fortschritt nie über Länge', S.progressAt(st, 999999), 180000);
chk('Pause: Fortschritt steht', S.progressAt({ ...st, playing: false }, 9000), 1000);
chk('leer → null', S.stateFromApi(null), null);
chk('Zeit', [S.fmtTime(0), S.fmtTime(65000), S.fmtTime(3599000)], ['0:00', '1:05', '59:59']);
const sdk = S.stateFromSdk({ paused: false, position: 5, track_window: { current_track: { id: 'abc', name: 'T', uri: 'u', duration_ms: 10, artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Al', images: [{ url: 'i', width: 300 }] } } } }, { id: 'sdk' });
chk('SDK-Zustand', [sdk.playing, sdk.track.artists, sdk.track.url, sdk.device.id], [true, 'A, B', 'https://open.spotify.com/track/abc', 'sdk']);

// --- Geräte ---
chk('aktives Gerät bleibt', S.chooseDevice([{ id: 'a', type: 'Smartphone' }, { id: 'b', is_active: true }], 'sdk'), 'b');
chk('sonst Coden im Browser', S.chooseDevice([{ id: 'a', type: 'Smartphone' }], 'sdk'), 'sdk');
chk('sonst Computer vor Handy', S.chooseDevice([{ id: 'p', type: 'Smartphone' }, { id: 'c', type: 'Computer' }], ''), 'c');
chk('gesperrte Geräte nicht', S.chooseDevice([{ id: 'x', is_restricted: true }], ''), '');

// --- Fehler ---
chk('nicht freigeschaltet', /User Management/.test(S.errorText(403, { error: { status: 403, message: 'Check settings on developer.spotify.com/dashboard, the user may not be registered.' } })), true);
chk('Premium', /Premium/.test(S.errorText(403, { error: { message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } })), true);
chk('kein Gerät', /Spotify-App/.test(S.errorText(404, { error: { message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } })), true);
chk('Limit', /Limit/.test(S.errorText(429, { error: { reason: 'QUOTA_EXCEEDED' } })), true);

// --- Prompt ---
chk('ohne Einrichtung kein Prompt', S.prompt({ configured: false }), '');
chk('nicht verbunden: Hinweis aufs Plus-Menü', /Spotify verbinden/.test(S.prompt({ configured: true, connected: false })), true);
const p = S.prompt({ configured: true, connected: true, state: st });
chk('verbunden: Befehle und was gerade läuft', /action="play"/.test(p) && /„Roller“ von Apache 207 auf „iPad“, Lautstärke 30 %/.test(p), true);
chk('Ergebnis-Block', S.resultBlock([{ ok: true, text: 'Pausiert.' }]), 'Spotify-Ergebnis:\n✓ Pausiert.\n\nBestätige das jetzt in einem kurzen, lockeren Satz (ohne Befehl).');

console.log(`\n${n - bad}/${n} OK`);
if (bad) process.exit(1);
