-- Resting at home: when the player sat down, and in which room, so energy is earned for the time actually seated.
ALTER TABLE player_profile
  ADD COLUMN IF NOT EXISTS rest_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rest_location TEXT;
