// test/websearch.test.js – Gratis-Websuche mit mehreren Quellen (Google über Gemini, DuckDuckGo, Bing, News, Wikipedia)
let fails = 0;
const chk = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fails++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` (bekam ${JSON.stringify(got)}, erwartet ${JSON.stringify(want)})`}`);
};

(async () => {
    const calls = [];
    let mode = {};
    const html = (s, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'text/html' } });
    global.fetch = async (url, o = {}) => {
        const u = String(url); calls.push(u.replace(/\?.*$/, ''));
        if (u.includes('generativelanguage.googleapis.com')) {
            if (mode.google === 'fail') return new Response(JSON.stringify({ error: { message: 'Search grounding is not supported' } }), { status: 400 });
            const body = JSON.parse(o.body);
            mode.googleBody = body;
            return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Nächstes Spiel: Sa. 29.11.2026, 14:00 Uhr gegen Verl.' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA', title: 'fc-saarbruecken.de' } }, { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB', title: 'kicker.de' } }] } }] }), { status: 200 });
        }
        if (u.includes('grounding-api-redirect/AAA')) return new Response('', { status: 302, headers: { location: 'https://www.fc-saarbruecken.de/spielplan' } });
        if (u.includes('grounding-api-redirect/BBB')) return new Response('', { status: 302, headers: { location: 'https://www.kicker.de/saarbruecken/spielplan' } });
        if (u.startsWith('https://html.duckduckgo.com/')) return html(mode.ddgBlocked ? '<div class="anomaly-modal">bots use DuckDuckGo too</div>' : '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fddg.de%2Fa&amp;rut=1">DDG &amp; Co</a><a class="result__snippet" href="x">Text <b>eins</b></a>');
        if (u.startsWith('https://lite.duckduckgo.com/')) return html('<div class="anomaly-modal"></div>');
        if (u.startsWith('https://www.bing.com/search')) {
            const enc = Buffer.from('https://www.transfermarkt.de/saarbruecken').toString('base64').replace(/=+$/, '');
            return html(`<ol><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=x&amp;u=a1${enc}&amp;ntb=1">Spielplan 1. FC Saarbrücken</a></h2><div class="b_caption"><p class="b_lineclamp2">Alle Spiele der Saison 2026/27</p></div></li><li class="b_algo"><h2><a href="https://www.liga3-online.de/x">3. Liga</a></h2><p>Tabelle</p></li></ol>`);
        }
        if (u.startsWith('https://news.google.com/rss/search')) return html('<rss><channel><item><title><![CDATA[Saarbrücken gewinnt 2:1]]></title><link>https://news.google.com/rss/articles/abc</link><pubDate>Thu, 26 Nov 2026 18:00:00 GMT</pubDate><source url="https://sr.de">SR.de</source></item></channel></rss>');
        if (u.startsWith('https://de.wikipedia.org/w/api.php')) return new Response(JSON.stringify({ query: { search: [{ title: '1. FC Saarbrücken', snippet: 'Der <span>1. FC</span> Saarbrücken ist ein Fußballverein' }] } }), { status: 200 });
        return html('', 404);
    };
    const Tools = require('../server/agent-tools');
    Tools.ddgResults = async () => { throw new Error('gesperrt'); }; // alte Abfrage: von Vercel aus oft gesperrt
    const W = require('../server/websearch');

    // 1) Mit Google-Key: Google-Suche über Gemini zuerst, Weiterleitungen aufgelöst, Antwort als erster Treffer
    process.env.GOOGLE_API_KEY = 'g-test';
    const r1 = await W.freeSearch('1. FC Saarbrücken nächstes Spiel', 6);
    chk('Google: Zusammenfassung + echte Quellen-Adressen', [r1.via.startsWith('google'), r1.results[0].summary, /14:00 Uhr/.test(r1.results[0].text), r1.results.slice(1, 3).map(x => x.url)], [true, true, true, ['https://www.fc-saarbruecken.de/spielplan', 'https://www.kicker.de/saarbruecken/spielplan']]);
    chk('Google: Grounding-Werkzeug und heutiges Datum im Auftrag', [JSON.stringify(mode.googleBody.tools), /Heute ist/.test(mode.googleBody.contents[0].parts[0].text)], ['[{"google_search":{}}]', true]);

    // 2) Google nicht verfügbar, DuckDuckGo gesperrt → Bing (Weiterleitungs-Links entschlüsselt), dann News
    mode = { google: 'fail', ddgBlocked: true }; calls.length = 0;
    const warn = [];
    const r2 = await W.freeSearch('Saarbrücken Spielplan', 6, undefined, (w) => warn.push(w));
    chk('Fallback: Bing-Treffer mit echter Adresse, News für aktuelle Fragen', [r2.results[0].url, r2.results[0].title, r2.results[0].snippet, r2.results.some(x => /Saarbrücken gewinnt 2:1/.test(x.title)), /google: Search grounding/.test(warn.join())], ['https://www.transfermarkt.de/saarbruecken', 'Spielplan 1. FC Saarbrücken', 'Alle Spiele der Saison 2026/27', true, true]);

    // 3) DuckDuckGo (POST) funktioniert → reicht zusammen mit Bing
    mode = { google: 'fail' };
    const r3 = await W.freeSearch('Photosynthese einfach', 6);
    chk('DuckDuckGo: Link aus uddg, Text ohne HTML', [r3.results[0].url, r3.results[0].title, r3.results[0].snippet], ['https://ddg.de/a', 'DDG & Co', 'Text eins']);

    // 4) Ohne Google-Key wird Gemini gar nicht gefragt
    delete process.env.GOOGLE_API_KEY; calls.length = 0;
    await W.freeSearch('irgendwas', 4);
    chk('Ohne Google-Key: keine Gemini-Anfrage', calls.some(c => c.includes('generativelanguage')), false);

    // 5) Alles leer/kaputt → leere Liste, kein Absturz
    global.fetch = async () => { throw new Error('offline'); };
    const r5 = await W.freeSearch('nichts', 4);
    chk('Alles offline: leere Liste', [r5.results.length, r5.via], [0, 'none']);

    console.log(fails ? `\n${fails} Fehler` : '\nAlle Websuche-Tests grün');
    process.exit(fails ? 1 : 0);
})();
