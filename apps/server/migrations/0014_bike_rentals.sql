-- Public bicycle hire: one active rental per resident; deposit held until return.
CREATE TABLE bike_rental (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  station_from TEXT NOT NULL,
  station_to TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  deposit INTEGER NOT NULL CHECK (deposit >= 0),
  usage INTEGER CHECK (usage >= 0),
  last_x DOUBLE PRECISION NOT NULL,
  last_z DOUBLE PRECISION NOT NULL,
  last_yaw DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned'))
);
CREATE UNIQUE INDEX bike_rental_one_active ON bike_rental (user_id) WHERE status = 'active';

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
    'bike_rental', 'bike_deposit'
  ));
