ALTER TABLE game_transaction DROP CONSTRAINT game_transaction_kind_check;
ALTER TABLE game_transaction ADD CONSTRAINT game_transaction_kind_check
  CHECK (kind IN (
    'starting_balance', 'purchase', 'job_reward',
    'property_purchase', 'property_rent', 'property_deposit',
    'deposit_refund', 'transport_fare'
  ));

-- The Ikoyi preview listing used gameplay-scaled coordinates from the old
-- miniature map; it is retired in favour of 1:1 Lekki Phase 1 placements.
UPDATE property_listing SET active = FALSE WHERE id = 'glover-court-flat-1';

ALTER TABLE property_listing
  ADD COLUMN listing_type TEXT NOT NULL DEFAULT 'rental'
    CHECK (listing_type IN ('rental', 'sale', 'rental_or_sale')),
  ADD COLUMN deposit BIGINT NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  ADD COLUMN rent_interval_days SMALLINT NOT NULL DEFAULT 30 CHECK (rent_interval_days > 0),
  ADD COLUMN grace_days SMALLINT NOT NULL DEFAULT 3 CHECK (grace_days >= 0),
  ADD COLUMN storage_slots SMALLINT NOT NULL DEFAULT 12 CHECK (storage_slots >= 0),
  ADD COLUMN street_name TEXT,
  ADD COLUMN description TEXT NOT NULL DEFAULT '';

ALTER TABLE property_tenure
  ADD COLUMN next_payment_at TIMESTAMPTZ,
  ADD COLUMN deposit_paid BIGINT NOT NULL DEFAULT 0 CHECK (deposit_paid >= 0);
UPDATE property_tenure SET next_payment_at = expires_at WHERE tenure_type = 'rented';

INSERT INTO property_listing
  (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z,
   listing_type, deposit, rent_interval_days, grace_days, storage_slots, street_name, description)
VALUES
  ('lekki-adebayo-flat-2', 'Adebayo Court · Flat 2', 'Lekki Phase 1',
   'Fictional compound on a mapped footprint, Adebayo Doherty Road', 900000, 18000,
   -521, 296, 'rental', 12000, 7, 3, 16, 'Adebayo Doherty Road',
   'Affordable one-bedroom flat with a kitchenette, a short walk from the Admiralty Way danfo stop.'),
  ('lekki-chief-okoro-house', 'Okoro Terrace House', 'Lekki Phase 1',
   'Fictional terrace on a mapped footprint, Chief Okoro Avenue', 235000, 40000,
   -428, 190, 'sale', 0, 30, 3, 30, 'Chief Okoro Avenue',
   'A two-bedroom terrace house with a gated forecourt. Available to buy outright.')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE player_profile
  ADD COLUMN saved_x REAL,
  ADD COLUMN saved_z REAL,
  ADD COLUMN saved_place TEXT,
  ADD COLUMN home_property_id TEXT REFERENCES property_listing (id) ON DELETE SET NULL,
  ADD COLUMN progress JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN hunger SMALLINT NOT NULL DEFAULT 70 CHECK (hunger BETWEEN 0 AND 100),
  ADD COLUMN energy SMALLINT NOT NULL DEFAULT 80 CHECK (energy BETWEEN 0 AND 100),
  ADD COLUMN settings JSONB NOT NULL DEFAULT '{}';

CREATE TABLE transport_journey (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  route_id TEXT NOT NULL,
  bus_id TEXT NOT NULL,
  board_stop_id TEXT NOT NULL,
  alight_stop_id TEXT,
  fare BIGINT NOT NULL CHECK (fare > 0),
  status TEXT NOT NULL CHECK (status IN ('riding', 'completed', 'interrupted')),
  boarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX one_active_journey_per_player
  ON transport_journey (user_id) WHERE status = 'riding';

INSERT INTO shop_catalog (id, name, description, category, price) VALUES
  ('jollof-takeaway', 'Jollof Rice & Plantain', 'Smoky party jollof with dodo, packed to go.', 'food', 2500),
  ('suya-wrap', 'Suya Wrap', 'Spiced beef suya with onions and yaji.', 'food', 1800),
  ('puff-puff', 'Puff-Puff (6)', 'Warm, sweet and quick.', 'food', 600),
  ('zobo-drink', 'Chilled Zobo', 'Hibiscus drink with ginger.', 'food', 700)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE shop_catalog ADD COLUMN vendor_id TEXT;
UPDATE shop_catalog SET vendor_id = 'mama-titi-buka'
  WHERE id IN ('jollof-takeaway', 'suya-wrap', 'puff-puff', 'zobo-drink');
UPDATE shop_catalog SET vendor_id = 'corner-kiosk'
  WHERE id IN ('island-water', 'basic-phone');
UPDATE shop_catalog SET vendor_id = 'home-and-style'
  WHERE id IN ('ankara-shirt', 'lagoon-sofa', 'woven-table', 'island-bed');

ALTER TABLE job_run ADD COLUMN destination_label TEXT;

CREATE TABLE property_storage (
  property_id TEXT NOT NULL REFERENCES property_listing (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES shop_catalog (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (property_id, user_id, item_id)
);
