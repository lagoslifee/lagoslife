-- Furniture can stand upstairs in homes with an upper floor (the mansion suites): 0 is the ground floor, 1 upstairs.
ALTER TABLE furniture_placement ADD COLUMN IF NOT EXISTS level SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE furniture_placement DROP CONSTRAINT IF EXISTS furniture_placement_level_check;
ALTER TABLE furniture_placement ADD CONSTRAINT furniture_placement_level_check CHECK (level IN (0, 1));
