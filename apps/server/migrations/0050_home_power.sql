-- A diesel generator in a home's compound: how much is in its tank, whether its switch is on, and the standing diesel order.
CREATE TABLE IF NOT EXISTS home_power (
  property_id TEXT PRIMARY KEY REFERENCES property_listing (id) ON DELETE CASCADE,
  generator TEXT NOT NULL,
  litres NUMERIC(8, 2) NOT NULL DEFAULT 0,
  running BOOLEAN NOT NULL DEFAULT TRUE,
  auto_diesel BOOLEAN NOT NULL DEFAULT FALSE,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The gateman switches the generator off once nobody has been home for a while.
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
