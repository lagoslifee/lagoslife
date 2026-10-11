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
    'club_table', 'club_bottle',
    'robbery_loss', 'robbery_gain', 'robbery_restitution', 'security_hire',
    'visa_fee', 'flight_ticket', 'flight_refund',
    'hotel_stay', 'hotel_refund', 'travel_order', 'travel_activity', 'car_rental'
  ));

-- Fictional roleplay visas: approval is automatic after a short processing wait.
CREATE TABLE IF NOT EXISTS travel_visa (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  visits_total INTEGER NOT NULL CHECK (visits_total > 0),
  visits_used INTEGER NOT NULL DEFAULT 0 CHECK (visits_used >= 0),
  fee BIGINT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS travel_visa_user ON travel_visa (user_id, applied_at DESC);

-- A return ticket: both legs on one row. The flight columns persist the shared flight clock, so a reconnect
-- or a server restart resumes the same flight rather than starting another.
CREATE TABLE IF NOT EXISTS travel_ticket (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  party_id TEXT NOT NULL,
  cabin TEXT NOT NULL CHECK (cabin IN ('economy', 'business')),
  fare BIGINT NOT NULL,
  seat TEXT NOT NULL,
  outbound_status TEXT NOT NULL DEFAULT 'booked' CHECK (outbound_status IN ('booked', 'checked_in', 'boarded', 'flown', 'cancelled')),
  return_status TEXT NOT NULL DEFAULT 'booked' CHECK (return_status IN ('booked', 'checked_in', 'boarded', 'flown', 'cancelled')),
  flight_id TEXT,
  flight_leg TEXT CHECK (flight_leg IN ('outbound', 'return')),
  flight_seat TEXT,
  depart_at TIMESTAMPTZ,
  arrive_at TIMESTAMPTZ,
  immigration_at TIMESTAMPTZ,
  visa_id TEXT REFERENCES travel_visa (id),
  refunded BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS travel_ticket_user ON travel_ticket (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS travel_ticket_party ON travel_ticket (party_id);
CREATE INDEX IF NOT EXISTS travel_ticket_flight ON travel_ticket (flight_id) WHERE flight_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS travel_invite (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES travel_ticket (id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  to_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  cabin TEXT NOT NULL,
  fare BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS travel_invite_pending ON travel_invite (ticket_id, to_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS travel_invite_to ON travel_invite (to_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hotel_booking (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  hotel_id TEXT NOT NULL,
  room_type TEXT NOT NULL,
  nights INTEGER NOT NULL CHECK (nights > 0),
  price BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'checked_in', 'checked_out', 'cancelled', 'expired')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  checked_in_at TIMESTAMPTZ,
  key_code TEXT,
  refunded BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS hotel_booking_user ON hotel_booking (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hotel_guest (
  booking_id TEXT NOT NULL REFERENCES hotel_booking (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (booking_id, user_id)
);

-- Items kept in a room's safe. Whatever is here when the stay ends goes back to the owner's bag.
CREATE TABLE IF NOT EXISTS hotel_storage (
  booking_id TEXT NOT NULL REFERENCES hotel_booking (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES shop_catalog (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (booking_id, item_id)
);

CREATE TABLE IF NOT EXISTS travel_photo (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  spot TEXT NOT NULL,
  companions TEXT[] NOT NULL DEFAULT '{}',
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS travel_photo_user ON travel_photo (user_id, taken_at DESC);

CREATE TABLE IF NOT EXISTS travel_activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  activity TEXT NOT NULL,
  price BIGINT NOT NULL,
  model_id TEXT,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS travel_activity_user ON travel_activity (user_id, created_at DESC);

INSERT INTO shop_catalog (id, name, description, category, price, vendor_id) VALUES
  ('outfit:kandura', 'White kandura', 'Crisp ankle-length robe. Wear it from your wardrobe.', 'clothing', 18000, 'marina-boutique'),
  ('outfit:abaya', 'Black abaya', 'Flowing black abaya. Wear it from your wardrobe.', 'clothing', 18000, 'marina-boutique'),
  ('outfit:resort-linen', 'Resort linen set', 'Light linen shirt and trousers for warm evenings.', 'clothing', 22000, 'marina-boutique'),
  ('outfit:beach-day', 'Beach day outfit', 'Bright shirt and shorts for JBR beach.', 'clothing', 12000, 'marina-boutique'),
  ('souvenir:snow-globe', 'Marina snow globe', 'Glass globe with the marina skyline inside.', 'souvenir', 4500, 'marina-souvenirs'),
  ('souvenir:dates', 'Box of Medjool dates', 'A gift box to bring home to Lagos.', 'souvenir', 6000, 'marina-souvenirs'),
  ('souvenir:camel', 'Camel plush', 'Soft toy camel in a tiny scarf.', 'souvenir', 3500, 'marina-souvenirs'),
  ('souvenir:dhow-model', 'Wooden dhow model', 'Hand-finished model of a marina dhow.', 'souvenir', 9000, 'marina-souvenirs'),
  ('souvenir:oud', 'Oud perfume', 'A small bottle of rich oud scent.', 'souvenir', 14000, 'marina-souvenirs')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category,
  price = EXCLUDED.price, vendor_id = EXCLUDED.vendor_id, active = TRUE;
