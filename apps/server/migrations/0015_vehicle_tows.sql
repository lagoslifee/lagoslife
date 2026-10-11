-- Tow, repair and return: a car on a recovery job is off the street ('towing') until it is delivered.
ALTER TABLE player_vehicle DROP CONSTRAINT player_vehicle_status_check;
ALTER TABLE player_vehicle ADD CONSTRAINT player_vehicle_status_check
  CHECK (status IN ('parked', 'garaged', 'driving', 'towing'));

CREATE TABLE vehicle_tow (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES player_vehicle (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('requested', 'arriving', 'loading', 'collected', 'repairing', 'returning', 'delivered', 'cancelled')),
  destination TEXT NOT NULL CHECK (destination IN ('home', 'here')),
  property_id TEXT,
  tow_fee INTEGER NOT NULL CHECK (tow_fee >= 0),
  repair INTEGER NOT NULL CHECK (repair >= 0),
  full_repair INTEGER NOT NULL CHECK (full_repair >= 0),
  charged INTEGER NOT NULL CHECK (charged >= 0),
  idempotency_key TEXT NOT NULL,
  from_x REAL NOT NULL,
  from_z REAL NOT NULL,
  delivered_x REAL,
  delivered_z REAL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  collected_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  UNIQUE (user_id, idempotency_key)
);
CREATE UNIQUE INDEX vehicle_tow_one_active ON vehicle_tow (vehicle_id) WHERE stage NOT IN ('delivered', 'cancelled');

ALTER TABLE game_transaction DROP CONSTRAINT game_transaction_kind_check;
ALTER TABLE game_transaction ADD CONSTRAINT game_transaction_kind_check
  CHECK (kind IN (
    'starting_balance', 'purchase', 'job_reward',
    'property_purchase', 'property_rent', 'property_deposit',
    'deposit_refund', 'transport_fare',
    'vehicle_purchase', 'vehicle_service', 'vehicle_insurance', 'vehicle_tow',
    'community_wage', 'fine_payment',
    'plot_lease', 'plot_purchase', 'construction',
    'ride_fare', 'ride_refund',
    'bike_rental', 'bike_deposit',
    'tow_refund'
  ));
