-- Businesses listed for sale to other residents.
ALTER TABLE player_business ADD COLUMN IF NOT EXISTS sale_price BIGINT CHECK (sale_price IS NULL OR sale_price > 0);
ALTER TABLE player_business ADD COLUMN IF NOT EXISTS listed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS player_business_for_sale ON player_business (listed_at DESC) WHERE sale_price IS NOT NULL;
