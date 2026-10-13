-- Eko Hustle Fund starter loans: at most one open loan per resident; `remaining` falls as it is paid back.
CREATE TABLE IF NOT EXISTS hustle_loan (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  principal BIGINT NOT NULL CHECK (principal > 0),
  owed BIGINT NOT NULL CHECK (owed >= principal),
  remaining BIGINT NOT NULL CHECK (remaining >= 0 AND remaining <= owed),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL,
  repaid_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS hustle_loan_one_open ON hustle_loan (user_id) WHERE repaid_at IS NULL;

-- Storyline chapter bonuses, claimed once each.
CREATE TABLE IF NOT EXISTS story_claim (
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  chapter TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, chapter)
);

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
    'home_staff', 'delivery_order', 'spray_money', 'business_start', 'business_upgrade', 'business_income', 'school_fee',
    'gym_membership', 'admin_grant', 'referral_bonus', 'venue_entry', 'personal_trainer',
    'home_decor', 'fuel_purchase', 'fuel_sale', 'diesel_purchase', 'generator_purchase', 'match_stake', 'match_win',
    'match_refund', 'business_sale', 'business_purchase', 'owambe_food', 'song_request', 'station_purchase',
    'loan_payout', 'loan_repayment', 'story_reward'
  ));
