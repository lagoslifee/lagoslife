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
    'tow_refund',
    'club_cover', 'club_order'
  ));

-- One paid entry (wristband) per resident, club and Lagos night; re-entry the same night is free.
CREATE TABLE club_entry (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  lagos_night DATE NOT NULL,
  cover INTEGER NOT NULL CHECK (cover >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX club_entry_once_per_night ON club_entry (user_id, place_id, lagos_night);

CREATE TABLE club_order (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX club_order_idempotency ON club_order (user_id, idempotency_key);
