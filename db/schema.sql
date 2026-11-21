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
