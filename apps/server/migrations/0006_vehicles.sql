ALTER TABLE game_transaction DROP CONSTRAINT game_transaction_kind_check;
ALTER TABLE game_transaction ADD CONSTRAINT game_transaction_kind_check
  CHECK (kind IN (
    'starting_balance', 'purchase', 'job_reward',
    'property_purchase', 'property_rent', 'property_deposit',
    'deposit_refund', 'transport_fare',
    'vehicle_purchase', 'vehicle_service', 'vehicle_insurance', 'vehicle_tow'
  ));

CREATE TABLE player_vehicle (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  colour TEXT NOT NULL CHECK (colour ~ '^#[0-9a-fA-F]{6}$'),
  plate TEXT NOT NULL UNIQUE,
  condition SMALLINT NOT NULL DEFAULT 100 CHECK (condition BETWEEN 0 AND 100),
  odometer_m DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (odometer_m >= 0),
  service_odometer_m DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (service_odometer_m >= 0),
  status TEXT NOT NULL DEFAULT 'parked' CHECK (status IN ('parked', 'garaged', 'driving')),
  driver_session_id TEXT,
  x REAL,
  z REAL,
  yaw REAL,
  garage_property_id TEXT REFERENCES property_listing (id) ON DELETE SET NULL,
  insured_until TIMESTAMPTZ,
  purchase_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, purchase_key),
  CHECK (status <> 'parked' OR (x IS NOT NULL AND z IS NOT NULL AND yaw IS NOT NULL)),
  CHECK (status <> 'garaged' OR garage_property_id IS NOT NULL)
);
CREATE INDEX player_vehicle_owner_idx ON player_vehicle (owner_user_id);

CREATE TABLE vehicle_event (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES player_vehicle (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('purchase', 'service', 'repair', 'insurance', 'tow', 'impact', 'garage', 'retrieve')),
  amount BIGINT NOT NULL DEFAULT 0,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX vehicle_event_vehicle_idx ON vehicle_event (vehicle_id, created_at DESC);
