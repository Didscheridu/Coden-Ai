// shared/mcp-catalog.js – Konnektoren-Katalog (wie bei Claude/ChatGPT). Läuft im Browser (window.CodenMcpCatalog) und in Node.
// auth: 'oauth' = Anmeldefenster (automatische Registrierung/Client-ID-Dokument), 'key' = Zugangsschlüssel, 'none' = offen.
// app: true = der Dienst erlaubt keine automatische Registrierung; Ein-Klick geht erst, wenn der Owner eine Coden-App hinterlegt
//            (Umgebungsvariable MCP_OAUTH_<ID>=clientId:clientSecret). Bis dahin: Zugangsschlüssel.
// key: true  = zusätzlich mit Zugangsschlüssel verbindbar (link zeigt, wo man ihn bekommt).
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api; else root.CodenMcpCatalog = api;
})(typeof self !== 'undefined' ? self : this, function () {
const CATEGORIES = [
    { id: 'all', label: 'Alle' },
    { id: 'dev', label: 'Entwicklung' },
    { id: 'prod', label: 'Produktivität' },
    { id: 'comm', label: 'Kommunikation' },
    { id: 'data', label: 'Daten & Cloud' },
    { id: 'design', label: 'Design & Medien' },
    { id: 'web', label: 'Web & Finanzen' }
];

const LIBRARY = [
    // Entwicklung & Code (10)
    { id: 'github', name: 'GitHub', cat: 'dev', icon: 'code', auth: 'oauth', app: true, scope: 'repo read:org read:user', url: 'https://api.githubcopilot.com/mcp/', desc: 'Repositories, Issues, Pull Requests und Code-Reviews direkt steuern.', info: 'Per OAuth-App (Client-ID) oder mit persönlichem GitHub-Token verbindbar.', link: 'https://github.com/settings/personal-access-tokens' },
    { id: 'gitlab', name: 'GitLab', cat: 'dev', icon: 'merge_type', auth: 'oauth', url: 'https://gitlab.com/api/v4/mcp', desc: 'Merge Requests, Pipelines, Issues und Projekte in GitLab verwalten.', info: 'Anmeldung über GitLab OAuth 2.1.', link: 'https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/' },
    { id: 'linear', name: 'Linear', cat: 'dev', icon: 'linear_scale', auth: 'oauth', url: 'https://mcp.linear.app/mcp', desc: 'Tickets, Zyklen, Roadmaps und Projektstatus in Linear lesen und aktualisieren.', info: 'Offizielle OAuth-2.1-Anmeldung mit automatischer App-Registrierung.', link: 'https://linear.app/docs/mcp' },
    { id: 'sentry', name: 'Sentry', cat: 'dev', icon: 'bug_report', auth: 'oauth', url: 'https://mcp.sentry.dev/mcp', desc: 'Fehlerberichte, Stacktraces und Performance-Daten aus Projekten analysieren.', info: 'Anmeldung direkt über dein Sentry-Konto.', link: 'https://docs.sentry.io/product/sentry-mcp/' },
    { id: 'vercel', name: 'Vercel', cat: 'dev', icon: 'change_history', auth: 'oauth', url: 'https://mcp.vercel.com', desc: 'Deployments, Build-Logs, Domains und Projekte auf Vercel prüfen.', info: 'Eigene Vercel-OAuth-App (Client-ID) oder Vercel Access-Token eintragen.', link: 'https://vercel.com/account/tokens' },
    { id: 'netlify', name: 'Netlify', cat: 'dev', icon: 'deployed_code', auth: 'oauth', url: 'https://netlify-mcp.netlify.app/mcp', desc: 'Webseiten deployen, Builds verwalten und Umgebungsvariablen steuern.', info: 'Anmeldung über Netlify OAuth.', link: 'https://docs.netlify.com/build/build-with-ai/overview/' },
    { id: 'context7', name: 'Context7', cat: 'dev', icon: 'library_books', auth: 'key', url: 'https://mcp.context7.com/mcp', desc: 'Aktuelle Dokumentation und Code-Beispiele zu Bibliotheken abrufen.', info: 'Kostenloser API-Schlüssel von context7.com.', link: 'https://context7.com/dashboard' },
    { id: 'deepwiki', name: 'DeepWiki', cat: 'dev', icon: 'menu_book', auth: 'none', url: 'https://mcp.deepwiki.com/mcp', desc: 'Fragen zu öffentlichen GitHub-Projekten beantworten und Dokus lesen.', info: 'Direkt ohne Anmeldung nutzbar.', link: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp' },
    { id: 'semgrep', name: 'Semgrep', cat: 'dev', icon: 'security', auth: 'oauth', url: 'https://mcp.semgrep.ai/mcp', desc: 'Code auf Sicherheitslücken und bekannte Schwachstellen prüfen.', info: 'OAuth-Anmeldung oder AppSec-Token.', link: 'https://semgrep.dev/docs/' },
    { id: 'circleci', name: 'CircleCI', cat: 'dev', icon: 'autorenew', auth: 'oauth', app: true, url: 'https://mcp.circleci.com/mcp', desc: 'CI/CD-Pipelines einsehen, fehlgeschlagene Tests analysieren und Builds starten.', info: 'CircleCI Personal API Token oder eigene OAuth Client-ID.', link: 'https://app.circleci.com/settings/user/tokens' },

    // Produktivität & Doku (8)
    { id: 'notion', name: 'Notion', cat: 'prod', icon: 'article', auth: 'oauth', url: 'https://mcp.notion.com/mcp', desc: 'Seiten, Datenbanken und Wissensbasen in Notion durchsuchen und bearbeiten.', info: 'Offizielle Notion-OAuth-Verbindung per Anmeldefenster.', link: 'https://developers.notion.com/docs/mcp' },
    { id: 'atlassian', name: 'Atlassian (Jira & Confluence)', cat: 'prod', icon: 'task_alt', auth: 'oauth', url: 'https://mcp.atlassian.com/v1/mcp', desc: 'Jira-Vorgänge und Confluence-Seiten suchen, erstellen und kommentieren.', info: 'Anmeldung mit deinem Atlassian-Konto.', link: 'https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/' },
    { id: 'asana', name: 'Asana', cat: 'prod', icon: 'checklist', auth: 'oauth', app: true, url: 'https://mcp.asana.com/v2/mcp', desc: 'Aufgaben, Projekte, Fälligkeiten und Team-Kommentare in Asana verwalten.', info: 'Eigene Asana OAuth-App (Client-ID) oder Personal Access Token.', link: 'https://app.asana.com/0/my-apps' },
    { id: 'monday', name: 'monday.com', cat: 'prod', icon: 'view_kanban', auth: 'oauth', url: 'https://mcp.monday.com/mcp', desc: 'Boards, Items und Workflows in monday.com lesen und aktualisieren.', info: 'Anmeldung über monday.com OAuth.', link: 'https://developer.monday.com/' },
    { id: 'todoist', name: 'Todoist', cat: 'prod', icon: 'check_circle', auth: 'oauth', url: 'https://ai.todoist.net/mcp', desc: 'Aufgaben planen, Listen organisieren und Erinnerungen abhaken.', info: 'Anmeldung über dein Todoist-Konto.', link: 'https://todoist.com' },
    { id: 'clickup', name: 'ClickUp', cat: 'prod', icon: 'view_timeline', auth: 'oauth', url: 'https://mcp.clickup.com/mcp', desc: 'Spaces, Listen, Aufgaben und Zeiterfassung in ClickUp ansteuern.', info: 'OAuth-Anmeldung über ClickUp.', link: 'https://developer.clickup.com/' },
    { id: 'zapier', name: 'Zapier', cat: 'prod', icon: 'bolt', auth: 'oauth', url: 'https://mcp.zapier.com/api/mcp/mcp', desc: 'Tausende Apps über deine freigegebenen Zapier-Aktionen automatisieren.', info: 'OAuth-Login über mcp.zapier.com.', link: 'https://zapier.com/mcp' },
    { id: 'make', name: 'Make', cat: 'prod', icon: 'account_tree', auth: 'key', url: 'https://mcp.make.com/mcp', desc: 'Make-Szenarien als Werkzeuge ausführen und Automatisierungen auslösen.', info: 'MCP-Token aus deinem Make-Profil.', link: 'https://www.make.com/en/help/ai-tools/make-mcp-server' },

    // Kommunikation & CRM (6)
    { id: 'slack', name: 'Slack', cat: 'comm', icon: 'forum', auth: 'oauth', app: true, url: 'https://mcp.slack.com/mcp', desc: 'Kanäle lesen, Nachrichten suchen und Updates in Slack posten.', info: 'OAuth über eigene Slack-App (Client-ID) oder Bot-Token.', link: 'https://api.slack.com/apps' },
    { id: 'intercom', name: 'Intercom', cat: 'comm', icon: 'support_agent', auth: 'oauth', app: true, url: 'https://mcp.intercom.com/mcp', desc: 'Kundenanfragen, Kontakte und Hilfeartikel in Intercom durchsuchen.', info: 'Intercom Access-Token oder eigene OAuth Client-ID.', link: 'https://developers.intercom.com/' },
    { id: 'hubspot', name: 'HubSpot', cat: 'comm', icon: 'handshake', auth: 'oauth', app: true, url: 'https://mcp.hubspot.com', desc: 'Kontakte, Deals, Unternehmen und Notizen im HubSpot CRM abrufen.', info: 'Eigene HubSpot-App (Client-ID) oder Private-App-Token.', link: 'https://developers.hubspot.com/' },
    { id: 'box', name: 'Box', cat: 'comm', icon: 'inventory_2', auth: 'oauth', app: true, url: 'https://mcp.box.com/', desc: 'Dokumente, Ordner und freigegebene Dateien in Box suchen und lesen.', info: 'Eigene Box OAuth-App (Client-ID) oder Developer-Token.', link: 'https://developer.box.com/' },
    { id: 'calcom', name: 'Cal.com', cat: 'comm', icon: 'calendar_month', auth: 'key', url: 'https://mcp.cal.com/mcp', desc: 'Termine, Verfügbarkeiten und Buchungen über Cal.com verwalten.', info: 'API-Schlüssel aus deinen Cal.com-Einstellungen.', link: 'https://app.cal.com/settings/developer/api-keys' },
    { id: 'calendly', name: 'Calendly', cat: 'comm', icon: 'event', auth: 'oauth', url: 'https://mcp.calendly.com/', desc: 'Meeting-Links, gebuchte Termine und Event-Typen einsehen.', info: 'OAuth-Anmeldung mit Calendly.', link: 'https://developer.calendly.com/' },

    // Daten & Cloud (7)
    { id: 'supabase', name: 'Supabase', cat: 'data', icon: 'database', auth: 'oauth', url: 'https://mcp.supabase.com/mcp', desc: 'Datenbanken, Tabellen, Edge Functions und SQL-Abfragen steuern.', info: 'Offizielle OAuth-2.1-Anmeldung über Supabase.', link: 'https://supabase.com/docs/guides/getting-started/mcp' },
    { id: 'neon', name: 'Neon Postgres', cat: 'data', icon: 'storage', auth: 'oauth', url: 'https://mcp.neon.tech/mcp', desc: 'Postgres-Branches anlegen, Schemas prüfen und SQL ausführen.', info: 'OAuth-Login über dein Neon-Konto.', link: 'https://neon.tech/docs/ai/neon-mcp-server' },
    { id: 'cloudflare', name: 'Cloudflare Docs', cat: 'data', icon: 'cloud', auth: 'none', url: 'https://docs.mcp.cloudflare.com/mcp', desc: 'Cloudflare-Dokumentation zu Workers, R2, D1 und Pages durchsuchen.', info: 'Direkt ohne Anmeldung nutzbar.', link: 'https://developers.cloudflare.com/' },
    { id: 'prisma', name: 'Prisma Postgres', cat: 'data', icon: 'table_chart', auth: 'oauth', url: 'https://mcp.prisma.io/mcp', desc: 'Prisma-Datenbanken erstellen, verwalten und Backups prüfen.', info: 'Anmeldung über Prisma OAuth.', link: 'https://www.prisma.io/docs/postgres/integrations/mcp-server' },
    { id: 'posthog', name: 'PostHog', cat: 'data', icon: 'insights', auth: 'oauth', url: 'https://mcp.posthog.com/mcp', desc: 'Produktanalysen, Feature-Flags, Fehler und Insights in PostHog lesen.', info: 'OAuth-Anmeldung bei PostHog.', link: 'https://posthog.com/docs/model-context-protocol' },
    { id: 'grafana', name: 'Grafana', cat: 'data', icon: 'monitoring', auth: 'key', url: 'https://mcp.grafana.com/mcp', desc: 'Dashboards, Metriken, Logs und Alarme aus Grafana abrufen.', info: 'Service-Account-Token von Grafana.', link: 'https://grafana.com/docs/grafana/latest/administration/service-accounts/' },
    { id: 'huggingface', name: 'Hugging Face', cat: 'data', icon: 'psychology', auth: 'oauth', key: true, url: 'https://huggingface.co/mcp', desc: 'KI-Modelle, Datasets, Papers und Spaces auf Hugging Face suchen.', info: 'Zugriffstoken von huggingface.co/settings/tokens.', link: 'https://huggingface.co/settings/tokens' },

    // Design & Medien (4)
    { id: 'figma', name: 'Figma', cat: 'design', icon: 'design_services', auth: 'oauth', url: 'https://mcp.figma.com/mcp', desc: 'Figma-Designs, Frames, Variablen und Komponenten für Code auslesen.', info: 'Persönlicher Figma-Token (PAT) oder eigene OAuth Client-ID.', link: 'https://www.figma.com/developers/api#access-tokens' },
    { id: 'canva', name: 'Canva', cat: 'design', icon: 'palette', auth: 'oauth', url: 'https://mcp.canva.com/mcp', desc: 'Canva-Vorlagen suchen, Designs erstellen und Inhalte exportieren.', info: 'Eigene Canva Connect-App (Client-ID + Callback-URL) oder Token.', link: 'https://www.canva.com/developers/' },
    { id: 'miro', name: 'Miro', cat: 'design', icon: 'dashboard_customize', auth: 'oauth', url: 'https://mcp.miro.com/', desc: 'Whiteboards, Diagramme, Notizen und Karten auf Miro-Boards bearbeiten.', info: 'OAuth-Anmeldung über Miro.', link: 'https://developers.miro.com/' },
    { id: 'webflow', name: 'Webflow', cat: 'design', icon: 'web', auth: 'oauth', url: 'https://mcp.webflow.com/mcp', desc: 'CMS-Einträge, Seiten und Komponenten in Webflow verwalten.', info: 'Anmeldung über Webflow OAuth.', link: 'https://developers.webflow.com/' },

    // Web, Suche & Finanzen (5)
    { id: 'stripe', name: 'Stripe', cat: 'web', icon: 'payments', auth: 'oauth', url: 'https://mcp.stripe.com', desc: 'Produkte, Zahlungen, Kunden, Rechnungen und Abos in Stripe einsehen.', info: 'Offizielle Stripe-OAuth-Anmeldung.', link: 'https://docs.stripe.com/mcp' },
    { id: 'paypal', name: 'PayPal', cat: 'web', icon: 'account_balance_wallet', auth: 'oauth', url: 'https://mcp.paypal.com/mcp', desc: 'Rechnungen, Bestellungen, Zahlungslinks und Transaktionen verwalten.', info: 'OAuth-Anmeldung über PayPal.', link: 'https://mcp.paypal.com/' },
    { id: 'square', name: 'Square', cat: 'web', icon: 'point_of_sale', auth: 'oauth', app: true, url: 'https://mcp.squareup.com/sse', desc: 'Kataloge, Bestellungen und Zahlungen über Square steuern.', info: 'Eigene Square OAuth Client-ID oder Access-Token.', link: 'https://developer.squareup.com/docs/mcp' },
    { id: 'firecrawl', name: 'Firecrawl', cat: 'web', icon: 'travel_explore', auth: 'key', url: 'https://mcp.firecrawl.dev/mcp', desc: 'Webseiten sauber auslesen, crawlen und als Markdown für Coden laden.', info: 'API-Schlüssel von firecrawl.dev.', link: 'https://www.firecrawl.dev/app/api-keys' },
    { id: 'exa', name: 'Exa Search', cat: 'web', icon: 'search', auth: 'oauth', key: true, url: 'https://mcp.exa.ai/mcp', desc: 'Präzise Echtzeit-Websuche und Recherche für aktuelle Informationen.', info: 'API-Schlüssel von dashboard.exa.ai.', link: 'https://dashboard.exa.ai/api-keys' }
];

// Domain für das Logo (Favicon); sonst die letzten zwei Teile der Server-Adresse
const DOMAIN = { github: 'github.com', todoist: 'todoist.com', semgrep: 'semgrep.dev', netlify: 'netlify.com', sentry: 'sentry.io', deepwiki: 'deepwiki.com', cloudflare: 'cloudflare.com' };
function domainOf(item) {
    if (DOMAIN[item.id]) return DOMAIN[item.id];
    try { return new URL(item.url).hostname.split('.').slice(-2).join('.'); } catch (_) { return ''; }
}
const byId = (id) => LIBRARY.find((x) => x.id === id) || null;
// Umgebungsvariable für die Coden-App eines Dienstes
const envName = (id) => 'MCP_OAUTH_' + String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_');
// Gehört die Adresse zum Katalog-Eintrag? (nur dann darf die Coden-App benutzt werden)
function sameServer(item, url) {
    try { const a = new URL(item.url), b = new URL(url); return a.origin === b.origin && b.pathname.replace(/\/+$/, '') === a.pathname.replace(/\/+$/, ''); } catch (_) { return false; }
}
return { CATEGORIES, LIBRARY, byId, envName, sameServer, domainOf };
});
