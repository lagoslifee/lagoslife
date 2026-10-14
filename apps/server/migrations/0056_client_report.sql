-- Browser crash and performance reports, kept in the database so they can be read without shell access to the host.
CREATE TABLE IF NOT EXISTS client_report (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id TEXT REFERENCES "user" (id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  stack TEXT,
  detail JSONB,
  quality TEXT,
  device TEXT,
  page TEXT
);
CREATE INDEX IF NOT EXISTS client_report_at ON client_report (at DESC);
