-- Supabase: Tabelle für eigene API-Keys (BYOK). Einmal im Supabase-Dashboard unter "SQL Editor" ausführen.
-- Idempotent: kann gefahrlos mehrfach laufen.
-- Die Keys kommen schon verschlüsselt (AES-256-GCM) vom Coden-Server; Supabase sieht nie den Klartext.

create table if not exists public.byok_keys (
  uid        text        not null,
  provider   text        not null,
  key_enc    text        not null check (char_length(key_enc) between 10 and 2000),
  hint       text        check (hint is null or char_length(hint) <= 32),
  created_at timestamptz not null default now(),
  primary key (uid, provider)
);

-- Row Level Security an und KEINE Policies: Nur der Coden-Server mit dem Service-Role-/Secret-Key
-- darf lesen und schreiben. Mit dem öffentlichen anon-/publishable-Key kommt niemand an die Tabelle.
alter table public.byok_keys enable row level security;
revoke all on public.byok_keys from anon, authenticated;
