-- The weight chosen for the set in progress on the bench or dumbbells; NULL for the treadmill.
ALTER TABLE player_profile ADD COLUMN IF NOT EXISTS gym_set_kg integer;
