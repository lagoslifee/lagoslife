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
    'robbery_loss', 'robbery_gain', 'robbery_restitution', 'security_hire'
  ));

ALTER TABLE citation DROP CONSTRAINT IF EXISTS citation_offence_check;
ALTER TABLE citation ADD CONSTRAINT citation_offence_check
  CHECK (offence IN ('careless_driving', 'no_papers', 'evading_checkpoint', 'armed_robbery'));

-- Every hold-up the server saw, whatever its outcome; reports at a police station are checked against these rows.
CREATE TABLE robbery (
  id TEXT PRIMARY KEY,
  robber_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  victim_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'robbed', 'escaped', 'caught')),
  x DOUBLE PRECISION NOT NULL,
  z DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  reported_at TIMESTAMPTZ
);
CREATE INDEX robbery_by_robber ON robbery (robber_id, created_at DESC);
CREATE INDEX robbery_by_victim ON robbery (victim_id, created_at DESC);

CREATE TABLE police_case (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  accused_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  robbery_id TEXT REFERENCES robbery (id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('charged', 'no_record')),
  details TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX police_case_by_reporter ON police_case (reporter_id, created_at DESC);

CREATE TABLE checkpoint_stop (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL,
  vehicle_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('cleared', 'fined', 'fled_escaped', 'fled_caught')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX checkpoint_stop_by_user ON checkpoint_stop (user_id, created_at DESC);

CREATE TABLE security_hire (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('pair', 'squad')),
  guards SMALLINT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL
);
CREATE UNIQUE INDEX security_hire_idempotency ON security_hire (user_id, idempotency_key);
CREATE INDEX security_hire_active ON security_hire (user_id, ends_at DESC);
