-- iFitness gym: monthly membership, timed training sets and a fitness level that shapes the avatar's build.
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
    'gym_membership'
  ));

ALTER TABLE player_profile
  ADD COLUMN IF NOT EXISTS fitness REAL NOT NULL DEFAULT 0 CHECK (fitness BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS trained_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gym_member_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gym_exercise TEXT,
  ADD COLUMN IF NOT EXISTS gym_set_started_at TIMESTAMPTZ;
