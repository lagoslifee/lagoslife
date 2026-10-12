-- Testing servers (TEST_FUNDS > 0) refill wallets; each refill is a ledger entry like any other credit.
ALTER TABLE game_transaction DROP CONSTRAINT game_transaction_kind_check;
ALTER TABLE game_transaction ADD CONSTRAINT game_transaction_kind_check
  CHECK (kind IN (
    'starting_balance', 'purchase', 'job_reward', 'property_purchase', 'property_rent', 'property_deposit',
    'deposit_refund', 'transport_fare', 'vehicle_purchase', 'vehicle_service', 'vehicle_insurance', 'vehicle_tow',
    'community_wage', 'fine_payment', 'plot_lease', 'plot_purchase', 'construction', 'ride_fare', 'ride_refund',
    'bike_rental', 'bike_deposit', 'tow_refund', 'club_cover', 'club_order', 'club_table', 'club_bottle',
    'robbery_loss', 'robbery_gain', 'robbery_restitution', 'security_hire', 'visa_fee', 'flight_ticket',
    'flight_refund', 'hotel_stay', 'hotel_refund', 'travel_order', 'travel_activity', 'car_rental', 'test_funds'
  ));
