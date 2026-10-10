-- Adebayo Court and Okoro Terrace each held a single home, so only one resident at a time could rent or
-- buy. Each building now has several units behind the same door; ids match HOME_UNITS in packages/shared.
UPDATE property_listing SET name = 'Okoro Terrace · House 1' WHERE id = 'lekki-chief-okoro-house';

INSERT INTO property_listing
  (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z,
   listing_type, deposit, rent_interval_days, grace_days, storage_slots, street_name, description)
SELECT 'lekki-adebayo-flat-' || n, 'Adebayo Court · Flat ' || n, 'Lekki Phase 1',
       'Fictional compound on a mapped footprint, Adebayo Doherty Road', 900000, 18000,
       -521, 296, 'rental', 12000, 7, 3, 16, 'Adebayo Doherty Road',
       'Affordable one-bedroom flat with a kitchenette, a short walk from the Admiralty Way danfo stop.'
FROM generate_series(1, 12) AS n
WHERE n <> 2
ON CONFLICT (id) DO NOTHING;

INSERT INTO property_listing
  (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z,
   listing_type, deposit, rent_interval_days, grace_days, storage_slots, street_name, description)
SELECT 'lekki-chief-okoro-house-' || n, 'Okoro Terrace · House ' || n, 'Lekki Phase 1',
       'Fictional terrace on a mapped footprint, Chief Okoro Avenue', 235000, 40000,
       -428, 190, 'sale', 0, 30, 3, 30, 'Chief Okoro Avenue',
       'A two-bedroom terrace house with a gated forecourt. Available to buy outright.'
FROM generate_series(2, 6) AS n
ON CONFLICT (id) DO NOTHING;
