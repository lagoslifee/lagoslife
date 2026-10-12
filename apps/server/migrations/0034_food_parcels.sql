-- Delivery orders become parcels: a rider brings each one to where the player stood or to their front door, the player
-- takes it from the rider, and food is eaten later (ideally sitting down at home).
CREATE TABLE IF NOT EXISTS food_parcel (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  destination TEXT NOT NULL CHECK (destination IN ('here', 'home')),
  property_id TEXT,
  drop_x DOUBLE PRECISION NOT NULL,
  drop_z DOUBLE PRECISION NOT NULL,
  drop_location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'on_the_way' CHECK (status IN ('on_the_way', 'collected', 'eaten')),
  ordered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arrives_at TIMESTAMPTZ NOT NULL,
  collected_at TIMESTAMPTZ,
  eaten_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS food_parcel_open ON food_parcel (user_id) WHERE status <> 'eaten';
