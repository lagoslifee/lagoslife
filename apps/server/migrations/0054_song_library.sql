-- A staff role that only manages the song library, and where each song plays.
ALTER TABLE staff_role DROP CONSTRAINT IF EXISTS staff_role_role_check;
ALTER TABLE staff_role ADD CONSTRAINT staff_role_role_check CHECK (role IN ('moderator', 'admin', 'music'));

ALTER TABLE club_song ADD COLUMN IF NOT EXISTS venues TEXT[] NOT NULL DEFAULT '{club}'
  CHECK (cardinality(venues) > 0 AND venues <@ ARRAY['club', 'owambe', 'party']::TEXT[]);
ALTER TABLE club_song ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
