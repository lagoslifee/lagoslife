CREATE TABLE wallet (
  user_id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  balance BIGINT NOT NULL CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE shop_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  price BIGINT NOT NULL CHECK (price > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO shop_catalog (id, name, description, category, price) VALUES
  ('island-water', 'Chilled Water', 'A reusable bottle from the neighbourhood market.', 'food', 500),
  ('ankara-shirt', 'Ankara Day Shirt', 'A bright everyday shirt for the modular wardrobe.', 'clothing', 12000),
  ('basic-phone', 'City Phone', 'A basic in-game phone for jobs and navigation.', 'utility', 45000);

CREATE TABLE inventory_item (
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES shop_catalog (id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE game_transaction (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('starting_balance', 'purchase', 'job_reward')),
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  reference TEXT NOT NULL,
  idempotency_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX game_transaction_user_idempotency
  ON game_transaction (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX game_transaction_user_created
  ON game_transaction (user_id, created_at DESC);

CREATE TABLE job_run (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('delivery')),
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
  reward BIGINT NOT NULL CHECK (reward > 0),
  pickup_x REAL NOT NULL,
  pickup_z REAL NOT NULL,
  destination_x REAL NOT NULL,
  destination_z REAL NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX one_active_job_per_player
  ON job_run (user_id)
  WHERE status = 'active';
