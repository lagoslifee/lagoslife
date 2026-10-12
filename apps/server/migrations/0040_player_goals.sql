-- What a resident told us they want from their Lagos life, asked once after sign-up.
CREATE TABLE IF NOT EXISTS player_goals (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  goals text[] NOT NULL DEFAULT '{}',
  interests text[] NOT NULL DEFAULT '{}',
  playstyle text,
  dream text NOT NULL DEFAULT '',
  skipped boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
