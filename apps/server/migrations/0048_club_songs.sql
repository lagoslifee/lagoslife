-- Songs the admin uploads for the club DJs to play on request. The audio lives here so every server can serve it.
CREATE TABLE IF NOT EXISTS club_song (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  seconds INTEGER NOT NULL CHECK (seconds BETWEEN 1 AND 600),
  mime TEXT NOT NULL,
  audio BYTEA NOT NULL,
  uploaded_by TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS club_song_active ON club_song (active, created_at DESC);
