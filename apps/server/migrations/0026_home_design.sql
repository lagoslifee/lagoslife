-- Modern house designs with pools and carports.
ALTER TABLE construction DROP CONSTRAINT IF EXISTS construction_design_id_check;
ALTER TABLE construction ADD CONSTRAINT construction_design_id_check
  CHECK (design_id IN ('self-contain', 'bungalow', 'duplex', 'pool-villa', 'estate-mansion'));

-- Furniture stands anywhere on the floor: room-local metres from the middle of the room.
-- grid_x / grid_z remain as the nearest old cell for older clients.
ALTER TABLE furniture_placement ADD COLUMN pos_x REAL;
ALTER TABLE furniture_placement ADD COLUMN pos_z REAL;
UPDATE furniture_placement SET pos_x = -5.6 + (grid_x + 0.5) * 1.4, pos_z = -4.8 + (grid_z + 0.5) * 1.6;
ALTER TABLE furniture_placement ALTER COLUMN pos_x SET NOT NULL;
ALTER TABLE furniture_placement ALTER COLUMN pos_z SET NOT NULL;
ALTER TABLE furniture_placement DROP CONSTRAINT IF EXISTS furniture_placement_property_id_grid_x_grid_z_key;

-- The furniture catalogue is ordered from the phone and delivered; Home & Style still sells it in person.
-- Keep in step with FURNITURE in packages/shared/src/furniture.ts.
INSERT INTO shop_catalog (id, name, description, category, price, vendor_id) VALUES
  ('eko-king-bed', 'Eko King Bed', 'A wide upholstered king bed with bedside tables.', 'furniture', 78000, NULL),
  ('ikoyi-sectional', 'Ikoyi Sectional Sofa', 'An L-shaped grey sectional that seats six.', 'furniture', 95000, NULL),
  ('velvet-armchair', 'Velvet Armchair', 'A deep mustard armchair for reading by the window.', 'furniture', 22000, NULL),
  ('marble-coffee-table', 'Marble Coffee Table', 'A low white marble table for the sitting room.', 'furniture', 18000, NULL),
  ('dining-set', 'Six-seat Dining Set', 'A walnut dining table with six chairs for Sunday rice.', 'furniture', 65000, NULL),
  ('tv-console', 'TV and Media Console', 'A 65-inch TV on a long low console.', 'furniture', 55000, NULL),
  ('wardrobe', 'Sliding Wardrobe', 'A tall wardrobe with mirrored sliding doors.', 'furniture', 48000, NULL),
  ('bookshelf', 'Open Bookshelf', 'Five open shelves of books and keepsakes.', 'furniture', 21000, NULL),
  ('work-desk', 'Work Desk and Chair', 'A desk with a laptop and an office chair.', 'furniture', 32000, NULL),
  ('floor-lamp', 'Arc Floor Lamp', 'A brass floor lamp with a warm shade.', 'furniture', 9000, NULL),
  ('potted-palm', 'Potted Palm', 'A tall areca palm in a clay pot.', 'furniture', 7500, NULL),
  ('aso-rug', 'Aso-oke Pattern Rug', 'A large woven rug in indigo and gold.', 'furniture', 16000, NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, price = EXCLUDED.price,
  vendor_id = EXCLUDED.vendor_id, active = TRUE;
UPDATE shop_catalog SET vendor_id = NULL WHERE id IN ('lagoon-sofa', 'woven-table', 'island-bed');
