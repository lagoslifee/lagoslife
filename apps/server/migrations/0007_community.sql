ALTER TABLE game_transaction DROP CONSTRAINT game_transaction_kind_check;
ALTER TABLE game_transaction ADD CONSTRAINT game_transaction_kind_check
  CHECK (kind IN (
    'starting_balance', 'purchase', 'job_reward',
    'property_purchase', 'property_rent', 'property_deposit',
    'deposit_refund', 'transport_fare',
    'vehicle_purchase', 'vehicle_service', 'vehicle_insurance', 'vehicle_tow',
    'community_wage'
  ));

-- Quiet-place visits (library, park, places of worship) and community-hall volunteer shifts.
CREATE TABLE community_visit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('quiet', 'volunteer')),
  lagos_day DATE NOT NULL,
  energy_delta SMALLINT NOT NULL DEFAULT 0,
  rested BOOLEAN NOT NULL DEFAULT FALSE,
  wage BIGINT NOT NULL DEFAULT 0 CHECK (wage >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX community_visit_user_idx ON community_visit (user_id, kind, created_at DESC);
CREATE UNIQUE INDEX community_volunteer_once_per_day ON community_visit (user_id, lagos_day) WHERE kind = 'volunteer';
