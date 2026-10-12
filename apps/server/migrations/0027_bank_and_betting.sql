-- Daily bonus streaks, transfers between residents, simulated shares and bitcoin, and betting. Game naira only.
ALTER TABLE game_transaction DROP CONSTRAINT game_transaction_kind_check;
ALTER TABLE game_transaction ADD CONSTRAINT game_transaction_kind_check
  CHECK (kind IN (
    'starting_balance', 'purchase', 'job_reward', 'property_purchase', 'property_rent', 'property_deposit',
    'deposit_refund', 'transport_fare', 'vehicle_purchase', 'vehicle_service', 'vehicle_insurance', 'vehicle_tow',
    'community_wage', 'fine_payment', 'plot_lease', 'plot_purchase', 'construction', 'ride_fare', 'ride_refund',
    'bike_rental', 'bike_deposit', 'tow_refund', 'club_cover', 'club_order', 'club_table', 'club_bottle',
    'robbery_loss', 'robbery_gain', 'robbery_restitution', 'security_hire', 'visa_fee', 'flight_ticket',
    'flight_refund', 'hotel_stay', 'hotel_refund', 'travel_order', 'travel_activity', 'car_rental', 'test_funds', 'agbero_payment', 'dent_repair',
    'daily_reward', 'transfer_out', 'transfer_in', 'investment_buy', 'investment_sell', 'bet_stake', 'bet_win'
  ));

CREATE TABLE IF NOT EXISTS daily_reward (
  user_id text PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  streak integer NOT NULL DEFAULT 0 CHECK (streak >= 0),
  last_day date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investment_holding (
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  asset_id text NOT NULL,
  units numeric(24, 8) NOT NULL CHECK (units >= 0),
  invested bigint NOT NULL DEFAULT 0 CHECK (invested >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id)
);

CREATE TABLE IF NOT EXISTS bet (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  game text NOT NULL CHECK (game IN ('spin', 'football')),
  round bigint NOT NULL,
  fixture_id text,
  selection text NOT NULL,
  stake bigint NOT NULL CHECK (stake > 0),
  odds numeric(8, 2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost')),
  payout bigint NOT NULL DEFAULT 0 CHECK (payout >= 0),
  settles_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS bet_user_recent ON bet (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bet_pending ON bet (user_id, settles_at) WHERE status = 'pending';
