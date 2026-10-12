-- A business can trade from premises built on its owner's plot instead of a house.
ALTER TABLE player_business ADD COLUMN IF NOT EXISTS plot_id text UNIQUE;
