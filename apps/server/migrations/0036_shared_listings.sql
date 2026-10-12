-- Every resident can buy or rent the same mapped home. The first resident takes the listing itself; each later one
-- gets a private copy (id "<listing>~<suffix>") with the same door, price and terms, so furniture, guests, needs and
-- staff stay per resident while everything keyed by property id keeps working.
ALTER TABLE property_listing ADD COLUMN template_id TEXT REFERENCES property_listing (id) ON DELETE CASCADE;
CREATE INDEX property_listing_template ON property_listing (template_id) WHERE template_id IS NOT NULL;
