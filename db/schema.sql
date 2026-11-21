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
