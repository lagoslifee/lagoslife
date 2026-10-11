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
    'club_cover', 'club_order',
    'club_table', 'club_bottle'
  ));

-- One VIP table per club, table number and Lagos night; a resident books at most one table per club per night.
CREATE TABLE club_table_booking (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL,
  lagos_night DATE NOT NULL,
  table_no INTEGER NOT NULL CHECK (table_no BETWEEN 1 AND 3),
  owner_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  price INTEGER NOT NULL CHECK (price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX club_table_once ON club_table_booking (place_id, lagos_night, table_no);
CREATE UNIQUE INDEX club_table_one_per_owner ON club_table_booking (owner_user_id, place_id, lagos_night);

CREATE TABLE club_table_guest (
  booking_id TEXT NOT NULL REFERENCES club_table_booking (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (booking_id, user_id)
);

CREATE TABLE club_bottle_order (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES club_table_booking (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX club_bottle_idempotency ON club_bottle_order (user_id, idempotency_key);
CREATE INDEX club_bottle_by_booking ON club_bottle_order (booking_id, created_at);
