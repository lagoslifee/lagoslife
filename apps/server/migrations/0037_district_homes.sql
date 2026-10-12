-- Homes in every district, priced by area: Lekki Phase 1 stays the affordable start, Victoria Island costs several
-- times more, and the Ikoyi villas (sale only) are for the rich. Fictional homes on mapped footprints; ids match
-- HOME_UNITS and the places in packages/shared.
INSERT INTO property_listing
  (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z,
   listing_type, deposit, rent_interval_days, grace_days, storage_slots, street_name, description)
SELECT CASE WHEN n = 1 THEN 'vi-femi-pearse-court' ELSE 'vi-femi-pearse-court-' || n END,
       'Femi Pearse Court · Flat ' || n, 'Victoria Island',
       'Fictional apartment block on a mapped footprint, Elsie Femi Pearse Street', 4000000, 60000,
       -6348, -1350, 'rental', 40000, 7, 3, 24, 'Elsie Femi Pearse Street',
       'A two-bedroom Victoria Island flat with a balcony, a short drive from Adeola Odeku and Bar Beach.'
FROM generate_series(1, 8) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO property_listing
  (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z,
   listing_type, deposit, rent_interval_days, grace_days, storage_slots, street_name, description)
SELECT CASE WHEN n = 1 THEN 'vi-kofo-residences' ELSE 'vi-kofo-residences-' || n END,
       'Kofo Abayomi Residences · Apartment ' || n, 'Victoria Island',
       'Fictional residence on a mapped footprint, Kofo Abayomi Road', 3500000, 90000,
       -5999, -965, 'sale', 0, 30, 3, 40, 'Kofo Abayomi Road',
       'A three-bedroom Victoria Island apartment to own outright, minutes from the Island''s offices and clubs.'
FROM generate_series(1, 4) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO property_listing
  (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z,
   listing_type, deposit, rent_interval_days, grace_days, storage_slots, street_name, description)
VALUES
  ('ikoyi-oyinkan-villa', 'Oyinkan Villa', 'Ikoyi', 'Fictional villa on a mapped footprint, Oyinkan Abayomi Drive',
   15000000, 250000, -3578, -83, 'sale', 0, 30, 3, 80, 'Oyinkan Abayomi Drive',
   'A walled Ikoyi compound with a pool and parking for your cars, behind its own gate.'),
  ('ikoyi-reeve-house', 'Reeve House', 'Ikoyi', 'Fictional villa on a mapped footprint, Reeve Road',
   18500000, 300000, -3216, 1044, 'sale', 0, 30, 3, 80, 'Reeve Road',
   'A walled Ikoyi compound with a pool and parking for your cars on a quiet residential road.'),
  ('ikoyi-milverton-mansion', 'Milverton Mansion', 'Ikoyi', 'Fictional mansion on a mapped footprint, Milverton Road',
   28000000, 450000, -2798, 824, 'sale', 0, 30, 3, 120, 'Milverton Road',
   'The grandest compound in Ikoyi: a walled mansion with a pool and parking for your cars.')
ON CONFLICT (id) DO NOTHING;
