-- Petrol in every motor vehicle's tank; NULL is a full tank, as cars leave the dealer.
ALTER TABLE player_vehicle ADD COLUMN IF NOT EXISTS fuel_l REAL CHECK (fuel_l IS NULL OR fuel_l >= 0);

-- Filling stations a resident has bought off their oil marketer: their pump price and takings.
CREATE TABLE IF NOT EXISTS fuel_station (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES "user" (id) ON DELETE SET NULL,
  price INTEGER NOT NULL,
  litres_sold DOUBLE PRECISION NOT NULL DEFAULT 0,
  earned BIGINT NOT NULL DEFAULT 0,
  bought_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    'match_refund', 'business_sale', 'business_purchase', 'owambe_food', 'song_request', 'station_purchase'
  ));
