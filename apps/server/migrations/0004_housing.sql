ALTER TABLE game_transaction DROP CONSTRAINT game_transaction_kind_check;
ALTER TABLE game_transaction ADD CONSTRAINT game_transaction_kind_check
  CHECK (kind IN (
    'starting_balance', 'purchase', 'job_reward',
    'property_purchase', 'property_rent'
  ));

CREATE TABLE property_listing (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  district TEXT NOT NULL,
  address_label TEXT NOT NULL,
  purchase_price BIGINT NOT NULL CHECK (purchase_price > 0),
  monthly_rent BIGINT NOT NULL CHECK (monthly_rent > 0),
  world_x REAL NOT NULL,
  world_z REAL NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO property_listing
  (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z)
VALUES
  ('glover-court-flat-1', 'Glover Court Garden Flat', 'Ikoyi',
   'Glover Road — gameplay-scaled residence', 180000, 30000, 50, -48);

CREATE TABLE property_tenure (
  property_id TEXT PRIMARY KEY REFERENCES property_listing (id),
  owner_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  tenure_type TEXT NOT NULL CHECK (tenure_type IN ('owned', 'rented')),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX property_tenure_owner ON property_tenure (owner_user_id);

CREATE TABLE property_guest (
  property_id TEXT NOT NULL REFERENCES property_listing (id) ON DELETE CASCADE,
  guest_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (property_id, guest_user_id)
);

CREATE TABLE home_state (
  property_id TEXT PRIMARY KEY REFERENCES property_listing (id) ON DELETE CASCADE,
  hunger SMALLINT NOT NULL DEFAULT 70 CHECK (hunger BETWEEN 0 AND 100),
  energy SMALLINT NOT NULL DEFAULT 70 CHECK (energy BETWEEN 0 AND 100),
  cleanliness SMALLINT NOT NULL DEFAULT 80 CHECK (cleanliness BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO shop_catalog (id, name, description, category, price) VALUES
  ('lagoon-sofa', 'Lagoon Sofa', 'A compact teal sofa for a Lagos living room.', 'furniture', 28000),
  ('woven-table', 'Woven Side Table', 'A locally inspired table for small interiors.', 'furniture', 9500),
  ('island-bed', 'Island Double Bed', 'A comfortable bed that enables sleeping at home.', 'furniture', 36000);

CREATE TABLE furniture_placement (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES property_listing (id) ON DELETE CASCADE,
  placed_by TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES shop_catalog (id),
  grid_x SMALLINT NOT NULL CHECK (grid_x BETWEEN 0 AND 7),
  grid_z SMALLINT NOT NULL CHECK (grid_z BETWEEN 0 AND 5),
  rotation SMALLINT NOT NULL CHECK (rotation IN (0, 90, 180, 270)),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (placed_by, idempotency_key),
  UNIQUE (property_id, grid_x, grid_z)
);
