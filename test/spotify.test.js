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
chk('Ergebnis-Block', S.resultBlock([{ ok: true, text: 'Pausiert.' }]), 'Spotify-Ergebnis:\n✓ Pausiert.\n\nBestätige das jetzt in einem kurzen, lockeren Satz (ohne Befehl, ohne die Liste zu wiederholen).');
chk('Ergebnis-Block Auswahl: nicht nochmal aufzählen', /NICHT nochmal/.test(S.resultBlock([{ ok: true, act: 'choose', text: 'x' }])), true);
chk('Prompt kennt choose', /action="choose"/.test(p), true);

// --- Befehle direkt aus der Nachricht (Rückfall, wenn das Modell keinen Befehl schreibt) ---
const I = (t, st) => S.intentOf(t, { state: st || { playing: true, device: { volume: 40 } } });
chk('„bitte pausiere spotify“', I('bitte pausiere spotify'), { cmds: [{ action: 'pause' }], strong: true });
chk('„pause“ allein ist schwach', I('pause').strong, false);
chk('„mach die Musik aus“', I('mach die Musik aus').cmds, [{ action: 'pause' }]);
chk('„nächster Song“', I('Nächster Song!'), { cmds: [{ action: 'next' }], strong: true });
chk('„Kannst du bitte den nächsten Song spielen“', I('Kannst du bitte den nächsten Song spielen').cmds, [{ action: 'next' }]);
chk('„spiel weiter“ → fortsetzen', I('spiel weiter').cmds, [{ action: 'resume' }]);
chk('„weiter“ wenn es läuft → nächster', I('weiter').cmds, [{ action: 'next' }]);
chk('„weiter“ wenn pausiert → fortsetzen', I('weiter', { playing: false }).cmds, [{ action: 'resume' }]);
chk('„spiel Roller von Apache 207“', I('Spiel Roller von Apache 207'), { cmds: [{ action: 'play', q: 'roller von apache 207' }], strong: true });
chk('„spiel was von Cro“ → Künstler', I('spiel mal was von Cro').cmds, [{ action: 'play', q: 'cro', type: 'artist' }]);
chk('„spiel bitte Blinding Lights auf Spotify“', I('hey coden spiel bitte Blinding Lights auf Spotify').cmds, [{ action: 'play', q: 'blinding lights' }]);
chk('„spiel was Ruhiges zum Lernen“ → Playlist (schwach)', I('spiel was ruhiges zum lernen'), { cmds: [{ action: 'play', q: 'ruhiges zum lernen', type: 'playlist' }], strong: false });
chk('„lauter“ → +15', I('lauter').cmds, [{ action: 'volume', value: '55' }]);
chk('„etwas leiser“ → −8', I('mach etwas leiser').cmds, [{ action: 'volume', value: '32' }]);
chk('„Lautstärke auf 30“', I('lautstärke auf 30').cmds, [{ action: 'volume', value: '30' }]);
chk('„was läuft gerade?“', I('was läuft gerade?').cmds, [{ action: 'now' }]);
chk('„zeig mir Songs von Cro“ → Auswahl', I('zeig mir songs von cro').cmds, [{ action: 'choose', q: 'cro', type: 'track' }]);
chk('„meine Playlists“', I('meine playlists').cmds, [{ action: 'choose', q: 'meine', type: 'playlist' }]);
chk('kein Musik: „spiel mit mir Schach“', I('spiel mit mir schach'), null);
chk('kein Musik: „lass uns eine Pause machen“', I('lass uns eine pause machen'), null);
chk('kein Musik: „mach weiter mit Aufgabe 3“', I('mach weiter mit aufgabe 3'), null);
chk('kein Musik: „mach die Hausaufgabe“', I('mach die hausaufgabe'), null);
chk('kein Musik: „sprich lauter“', I('sprich lauter'), null);
chk('kein Musik: lange Frage', I('Erkläre mir bitte ganz genau, wie die Photosynthese funktioniert und warum'), null);
chk('Modell redet über Musik', [S.talksMusic('Klar, ich spiele das Lied!'), S.talksMusic('Hier ist die Erklärung')], [true, false]);
chk('Befehle als Text', S.commandsText([{ action: 'play', q: 'a "b"', type: 'artist' }, { action: 'volume', value: '20' }]), '<spotify action="play" q="a b" type="artist"/>\n<spotify action="volume" value="20"/>');
chk('Lade-Text', S.busyLabel([{ action: 'play', q: 'Cro' }, { action: 'volume', value: '30' }]), 'Sucht und spielt „Cro“ · Lautstärke 30 %');

// --- Karten im Chat ---
const item = S.itemOf('track', { name: 'Roller', uri: 'spotify:track:1', duration_ms: 1000, artists: [{ name: 'Apache 207' }], album: { uri: 'spotify:album:9', images: [{ url: 'https://i/1', width: 300 }] }, external_urls: { spotify: 'https://open.spotify.com/track/1' } });
chk('Eintrag klein', item, { ty: 'track', n: 'Roller', a: 'Apache 207', i: 'https://i/1', u: 'spotify:track:1', al: 'spotify:album:9', d: 1000, url: 'https://open.spotify.com/track/1' });
chk('Playlist-Eintrag mit Besitzer', S.itemOf('playlist', { name: 'Chill', uri: 'spotify:playlist:5', owner: { display_name: 'Kayden' } }).a, 'von Kayden');
const block = S.cardBlock({ k: 'pick', q: '</spotifycard><script>', items: [item] }, 'Auswahl "x" <b>');
chk('Karte: kein Ausbruch aus dem Block', (block.match(/<\/spotifycard>/g) || []).length === 1 && !/<script>/.test(block), true);
chk('Karte: Inhalt wieder lesbar', S.parseCard(block.replace(/^[\s\S]*?>/, '').replace(/<\/spotifycard>[\s\S]*$/, '')).q, '</spotifycard><script>');
chk('Verlauf: Karte → kurze Zeile', S.cardsToText('Ok ' + S.cardBlock({ k: 'status' }, 'Spielt jetzt Roller') + ' fertig').replace(/\s+/g, ' '), 'Ok [Spotify: Spielt jetzt Roller] fertig');
chk('choose-Befehl', S.parseCommands('<spotify action="choose" q="Cro" type="album"/><spotify action="choose"/>'), [{ action: 'choose', q: 'Cro', type: 'album' }]);
chk('MCP list_playlists → eigene Playlists', S.fromMcp({ server: 'spotify', tool: 'list_playlists', args: { type: 'playlist' } }), { action: 'choose', type: 'playlist' });
chk('Zustand merkt Kontext', S.stateFromApi({ is_playing: true, context: { uri: 'spotify:artist:7' }, item: { name: 'x', uri: 'u' } }).context, 'spotify:artist:7');

console.log(`\n${n - bad}/${n} OK`);
if (bad) process.exit(1);
