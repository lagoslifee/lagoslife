CREATE TABLE player_profile (
  user_id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  appearance JSONB NOT NULL DEFAULT
    '{"skinTone":"rich","hairstyle":"low-fade","outfit":"island-casual","accessory":"none"}',
  spawn_district TEXT NOT NULL DEFAULT 'ikoyi-preview',
  spawn_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  spawn_y DOUBLE PRECISION NOT NULL DEFAULT 2,
  spawn_z DOUBLE PRECISION NOT NULL DEFAULT 0,
  tutorial_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
