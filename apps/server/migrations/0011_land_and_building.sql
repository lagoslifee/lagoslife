-- Leasing or buying a building plot and paying builders stage by stage. A finished house becomes a property
-- listing of type 'built' that only its owner sees.

ALTER TABLE game_transaction DROP CONSTRAINT game_transaction_kind_check;
ALTER TABLE game_transaction ADD CONSTRAINT game_transaction_kind_check
  CHECK (kind IN (
    'starting_balance', 'purchase', 'job_reward',
    'property_purchase', 'property_rent', 'property_deposit',
    'deposit_refund', 'transport_fare',
    'vehicle_purchase', 'vehicle_service', 'vehicle_insurance', 'vehicle_tow',
    'community_wage', 'fine_payment',
    'plot_lease', 'plot_purchase', 'construction'
  ));

ALTER TABLE property_listing DROP CONSTRAINT IF EXISTS property_listing_listing_type_check;
ALTER TABLE property_listing ADD CONSTRAINT property_listing_listing_type_check
  CHECK (listing_type IN ('rental', 'sale', 'rental_or_sale', 'built'));

CREATE TABLE plot_tenure (
  plot_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  tenure_type TEXT NOT NULL CHECK (tenure_type IN ('leased', 'owned')),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_payment_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
-- One plot per resident keeps the first goal simple and leaves land for others.
CREATE UNIQUE INDEX plot_tenure_one_per_owner ON plot_tenure (owner_user_id);

CREATE TABLE construction (
  plot_id TEXT PRIMARY KEY REFERENCES plot_tenure (plot_id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  design_id TEXT NOT NULL CHECK (design_id IN ('self-contain', 'bungalow', 'duplex')),
  -- Stages paid for so far (1 = foundation under way or done, 4 = finishing paid).
  stages_paid SMALLINT NOT NULL CHECK (stages_paid BETWEEN 1 AND 4),
  stage_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stage_ready_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);
