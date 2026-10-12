-- Payments to roadside touts (agberos), recorded once per encounter, and panel-beating of their dents.
ALTER TABLE game_transaction DROP CONSTRAINT game_transaction_kind_check;
ALTER TABLE game_transaction ADD CONSTRAINT game_transaction_kind_check
  CHECK (kind IN (
    'starting_balance', 'purchase', 'job_reward', 'property_purchase', 'property_rent', 'property_deposit',
    'deposit_refund', 'transport_fare', 'vehicle_purchase', 'vehicle_service', 'vehicle_insurance', 'vehicle_tow',
    'community_wage', 'fine_payment', 'plot_lease', 'plot_purchase', 'construction', 'ride_fare', 'ride_refund',
    'bike_rental', 'bike_deposit', 'tow_refund', 'club_cover', 'club_order', 'club_table', 'club_bottle',
    'robbery_loss', 'robbery_gain', 'robbery_restitution', 'security_hire', 'visa_fee', 'flight_ticket',
    'flight_refund', 'hotel_stay', 'hotel_refund', 'travel_order', 'travel_activity', 'car_rental', 'test_funds', 'agbero_payment', 'dent_repair'
  ));

-- Cosmetic only: never affects condition, top speed or handling.
ALTER TABLE player_vehicle ADD COLUMN IF NOT EXISTS dents SMALLINT NOT NULL DEFAULT 0 CHECK (dents BETWEEN 0 AND 3);

CREATE TABLE IF NOT EXISTS street_encounter (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  spot_id text NOT NULL,
  vehicle_id text,
  ask integer NOT NULL CHECK (ask > 0),
  paid integer NOT NULL DEFAULT 0 CHECK (paid >= 0),
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'paid', 'drove_off', 'police', 'guards', 'ignored')),
  dent boolean NOT NULL DEFAULT false,
  cctv boolean NOT NULL DEFAULT false,
  x double precision NOT NULL,
  z double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  reported_at timestamptz
);
CREATE INDEX IF NOT EXISTS street_encounter_user ON street_encounter (user_id, created_at DESC);
