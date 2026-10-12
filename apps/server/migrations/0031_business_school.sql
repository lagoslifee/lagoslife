-- Player businesses (passive income collected by hand) and the Lagos Skills Academy (courses and certificates).
ALTER TABLE game_transaction DROP CONSTRAINT game_transaction_kind_check;
ALTER TABLE game_transaction ADD CONSTRAINT game_transaction_kind_check
  CHECK (kind IN (
    'starting_balance', 'purchase', 'job_reward', 'property_purchase', 'property_rent', 'property_deposit',
    'deposit_refund', 'transport_fare', 'vehicle_purchase', 'vehicle_service', 'vehicle_insurance', 'vehicle_tow',
    'community_wage', 'fine_payment', 'plot_lease', 'plot_purchase', 'construction', 'ride_fare', 'ride_refund',
    'bike_rental', 'bike_deposit', 'tow_refund', 'club_cover', 'club_order', 'club_table', 'club_bottle',
    'robbery_loss', 'robbery_gain', 'robbery_restitution', 'security_hire', 'visa_fee', 'flight_ticket',
    'flight_refund', 'hotel_stay', 'hotel_refund', 'travel_order', 'travel_activity', 'car_rental', 'test_funds', 'agbero_payment', 'dent_repair',
    'daily_reward', 'transfer_out', 'transfer_in', 'investment_buy', 'investment_sell', 'bet_stake', 'bet_win',
    'home_staff', 'delivery_order', 'spray_money', 'business_start', 'business_upgrade', 'business_income', 'school_fee'
  ));

CREATE TABLE IF NOT EXISTS player_business (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  collected_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, type)
);

CREATE TABLE IF NOT EXISTS player_course (
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  course text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT NOW(),
  ends_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, course)
);
