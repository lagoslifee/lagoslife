-- Rate-limit counters live in Postgres so every server process enforces the same limits.

-- Better Auth's database rate-limit storage (sign-in, sign-up and other auth endpoints).
create table if not exists "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index if not exists "rateLimit_lastRequest_idx" on "rateLimit" ("lastRequest");

-- Fixed-window counters for the game's own per-player limits.
CREATE TABLE IF NOT EXISTS request_rate (
  key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS request_rate_window_idx ON request_rate (window_started_at);
