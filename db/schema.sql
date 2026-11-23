-- Einmalig in der Neon SQL-Konsole ausführen
CREATE TABLE IF NOT EXISTS user_data (
  uid        TEXT PRIMARY KEY,
  sessions   JSONB NOT NULL DEFAULT '[]',
  settings   JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_state (
  id    INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  state JSONB NOT NULL DEFAULT '{}'
);
INSERT INTO system_state (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS rate_limits (
  key    TEXT   NOT NULL,
  bucket BIGINT NOT NULL,
  count  INT    NOT NULL DEFAULT 0,
  PRIMARY KEY (key, bucket)
);

-- Tageszähler für knappe Gemini-Modelle (Tag nach Pazifischer Zeit, wie bei Google)
CREATE TABLE IF NOT EXISTS model_quota (
  model  TEXT NOT NULL,
  day    DATE NOT NULL,
  total  INT  NOT NULL DEFAULT 0,
  public INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (model, day)
);

-- ===== Code Buddy =====
CREATE TABLE IF NOT EXISTS profiles (
  uid          TEXT PRIMARY KEY,
  handle       TEXT NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name TEXT NOT NULL,
  bio          TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS friendships (
  id         BIGSERIAL PRIMARY KEY,
  requester  TEXT NOT NULL,
  addressee  TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (requester <> addressee)
);
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair ON friendships (LEAST(requester, addressee), GREATEST(requester, addressee));
CREATE INDEX IF NOT EXISTS friendships_addressee ON friendships (addressee);

CREATE TABLE IF NOT EXISTS dm_messages (
  id         BIGSERIAL PRIMARY KEY,
  sender     TEXT NOT NULL,
  recipient  TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS dm_pair ON dm_messages (sender, recipient, id);
CREATE INDEX IF NOT EXISTS dm_unread ON dm_messages (recipient) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS projects (
  id          BIGSERIAL PRIMARY KEY,
  owner       TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uid        TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner','editor')),
  PRIMARY KEY (project_id, uid)
);
CREATE INDEX IF NOT EXISTS project_members_uid ON project_members (uid);

CREATE TABLE IF NOT EXISTS project_files (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  version    INT NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS project_messages (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_messages_proj ON project_messages (project_id, id);

-- ===== Apps (App-Builder) =====
CREATE TABLE IF NOT EXISTS apps (
  id            BIGSERIAL PRIMARY KEY,
  owner         TEXT NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('web','ios','android','both')),
  style         TEXT NOT NULL DEFAULT '',
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  preview_token TEXT NOT NULL,
  published     BOOLEAN NOT NULL DEFAULT false,
  files         JSONB NOT NULL DEFAULT '{}',
  integrations  JSONB NOT NULL DEFAULT '{}',
  version       INT NOT NULL DEFAULT 1,
  theme_color   TEXT NOT NULL DEFAULT '#8ab4f8',
  apk           JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS apps_owner ON apps (owner);

CREATE TABLE IF NOT EXISTS app_members (
  app_id    BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  uid       TEXT NOT NULL,
  role      TEXT NOT NULL CHECK (role IN ('owner','editor')),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, uid)
);
CREATE INDEX IF NOT EXISTS app_members_uid ON app_members (uid);

CREATE TABLE IF NOT EXISTS app_messages (
  id         BIGSERIAL PRIMARY KEY,
  app_id     BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant','tool','event')),
  body       TEXT NOT NULL,
  meta       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_messages_app ON app_messages (app_id, id);

-- KI-Bilder für Apps (werden unter /api/public/img/<key> ausgeliefert)
CREATE TABLE IF NOT EXISTS app_images (
  key        TEXT PRIMARY KEY,
  app_id     BIGINT REFERENCES apps(id) ON DELETE CASCADE,
  uid        TEXT,
  prompt     TEXT NOT NULL DEFAULT '',
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_images_app ON app_images (app_id);
ALTER TABLE app_images ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE app_images ALTER COLUMN app_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS app_images_uid ON app_images (uid);


-- Projekte (wie bei Claude/ChatGPT): Anweisungen + Wissensdateien, Chats verweisen per projectId darauf
CREATE TABLE IF NOT EXISTS user_projects (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  files JSONB NOT NULL DEFAULT '{}'::jsonb,
  color TEXT NOT NULL DEFAULT '#8ab4f8',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_projects_uid_idx ON user_projects (uid, updated_at DESC);

-- ===== Code Buddy Server (wie Discord): Server, Kanäle, Rollen, geteilte Apps =====
CREATE TABLE IF NOT EXISTS servers (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#8ab4f8',
  owner       TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS server_members (
  server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  uid       TEXT NOT NULL,
  role      TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, uid)
);
CREATE INDEX IF NOT EXISTS server_members_uid ON server_members (uid);
CREATE TABLE IF NOT EXISTS server_channels (
  id         BIGSERIAL PRIMARY KEY,
  server_id  BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS server_channels_server ON server_channels (server_id);
CREATE TABLE IF NOT EXISTS server_messages (
  id         BIGSERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES server_channels(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS server_messages_channel ON server_messages (channel_id, id);
CREATE TABLE IF NOT EXISTS server_shares (
  server_id  BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  app_id     BIGINT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  shared_by  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, app_id)
);
CREATE INDEX IF NOT EXISTS server_shares_app ON server_shares (app_id);

-- ===== @coden im Chat, Anhänge in Direktnachrichten, Zuschauer-Rolle bei Apps =====
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS attachment JSONB;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS peer TEXT;       -- bei Coden-Antworten: der andere Gesprächspartner
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS ai_for TEXT;     -- bei Coden-Antworten: wer Coden gefragt hat
ALTER TABLE server_messages ADD COLUMN IF NOT EXISTS ai_for TEXT;
CREATE INDEX IF NOT EXISTS dm_ai_for ON dm_messages (ai_for, created_at) WHERE ai_for IS NOT NULL;
CREATE INDEX IF NOT EXISTS server_ai_for ON server_messages (ai_for, created_at) WHERE ai_for IS NOT NULL;
ALTER TABLE app_members DROP CONSTRAINT IF EXISTS app_members_role_check;
ALTER TABLE app_members ADD CONSTRAINT app_members_role_check CHECK (role IN ('owner','editor','viewer'));

-- ===== Hintergrund-Läufe: KI arbeitet auf dem Server weiter, auch wenn die Seite zu ist =====
CREATE TABLE IF NOT EXISTS ai_runs (
  id         BIGSERIAL PRIMARY KEY,
  uid        TEXT NOT NULL,
  kind       TEXT NOT NULL,                       -- chat | app
  ref        TEXT NOT NULL,                       -- Chat-ID oder App-ID
  status     TEXT NOT NULL DEFAULT 'running',     -- running | done | error | stopped
  text       TEXT NOT NULL DEFAULT '',
  think      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- aktueller Denk-Schritt + bisherige Schritte
  agents     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Sub-Agenten (App-Builder)
  model      TEXT,
  error      TEXT,
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  stop       BOOLEAN NOT NULL DEFAULT false,
  claimed    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_runs_uid ON ai_runs (uid, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_ref ON ai_runs (kind, ref, created_at DESC);

-- ===== Neuer App-Typ "game" (Spiele) =====
ALTER TABLE apps DROP CONSTRAINT IF EXISTS apps_kind_check;
ALTER TABLE apps ADD CONSTRAINT apps_kind_check CHECK (kind IN ('web','ios','android','both','game'));

-- ===== Nutzungslimits: 5-Stunden-Fenster + Wochenfenster, gefüllt mit Tokens =====
CREATE TABLE IF NOT EXISTS usage_limits (
  uid        TEXT PRIMARY KEY,
  email      TEXT,
  s_start    TIMESTAMPTZ,                  -- Beginn des aktuellen 5-Stunden-Fensters
  s_tokens   BIGINT NOT NULL DEFAULT 0,
  w_start    TIMESTAMPTZ,                  -- Beginn des aktuellen Wochenfensters
  w_tokens   BIGINT NOT NULL DEFAULT 0,
  total      BIGINT NOT NULL DEFAULT 0,    -- Verbrauch insgesamt (nur zur Statistik)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_limits_email ON usage_limits (lower(email));

-- ===== Push-Benachrichtigungen (Coden ist fertig, auch wenn die Seite zu ist) =====
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  uid        TEXT NOT NULL,
  keys       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subs_uid ON push_subs (uid);
CREATE TABLE IF NOT EXISTS app_secrets (
  name  TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- ===== Bring your own Key: eigene API-Keys (verschlüsselt) und eigene Modelle =====
CREATE TABLE IF NOT EXISTS user_provider_keys (
  uid        TEXT NOT NULL,
  provider   TEXT NOT NULL,
  key_enc    TEXT NOT NULL,                 -- AES-256-GCM, nie im Klartext
  hint       TEXT,                          -- letzte 4 Zeichen zur Anzeige
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (uid, provider)
);
CREATE TABLE IF NOT EXISTS user_models (
  id            SERIAL PRIMARY KEY,
  uid           TEXT NOT NULL,
  provider      TEXT NOT NULL,              -- google | openai | anthropic | openrouter
  model_id      TEXT NOT NULL,              -- ID beim Anbieter
  label         TEXT NOT NULL,              -- Name im Auswahlmenü
  levels        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- erlaubte Denkstufen
  default_level TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (uid, provider, model_id)
);
CREATE INDEX IF NOT EXISTS user_models_uid ON user_models (uid);

-- ===== Bring your own Key: Ausweich-Ketten und App-Modus-Einstellungen =====
CREATE TABLE IF NOT EXISTS user_chains (
  id         SERIAL PRIMARY KEY,
  uid        TEXT NOT NULL,
  name       TEXT NOT NULL,
  members    JSONB NOT NULL DEFAULT '[]'::jsonb,   -- Reihenfolge: "flash" | "normal" | "pro" | "ultra" | "byok:<id>"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_chains_uid ON user_chains (uid);
CREATE TABLE IF NOT EXISTS user_agent_cfg (
  uid        TEXT PRIMARY KEY,
  cfg        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- Sub-Agenten: Modell je Schwierigkeit, keyMax, overflow
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Aufgaben & Zeitpläne: Coden erledigt etwas zu festen Zeiten (auch mit Deep Research) =====
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id         BIGSERIAL PRIMARY KEY,
  uid        TEXT NOT NULL,
  email      TEXT,                                  -- für Owner-Prüfung beim automatischen Lauf
  is_owner   BOOLEAN NOT NULL DEFAULT false,
  title      TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  schedule   JSONB NOT NULL,                        -- { kind: once|daily|weekly, time, days, at }
  tz         TEXT NOT NULL DEFAULT 'Europe/Berlin',
  tier       TEXT NOT NULL DEFAULT 'flash',
  research   BOOLEAN NOT NULL DEFAULT false,
  depth      TEXT NOT NULL DEFAULT 'normal',
  enabled    BOOLEAN NOT NULL DEFAULT true,
  next_run   TIMESTAMPTZ,                           -- null = läuft nicht mehr (einmalig erledigt)
  last_run   TIMESTAMPTZ,
  last_status TEXT,                                 -- ok | error
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduled_tasks_uid ON scheduled_tasks (uid);
CREATE INDEX IF NOT EXISTS scheduled_tasks_due ON scheduled_tasks (next_run) WHERE enabled;
CREATE TABLE IF NOT EXISTS task_results (
  id         BIGSERIAL PRIMARY KEY,
  uid        TEXT NOT NULL,
  task_id    BIGINT,                                -- null, wenn die Aufgabe inzwischen gelöscht ist
  title      TEXT NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  ok         BOOLEAN NOT NULL DEFAULT true,
  seen       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_results_uid ON task_results (uid, created_at DESC);
