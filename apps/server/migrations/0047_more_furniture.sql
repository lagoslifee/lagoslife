-- A wall-mounted TV and a dressing table, delivered from the phone. Keep in step with FURNITURE in packages/shared/src/furniture.ts.
INSERT INTO shop_catalog (id, name, description, category, price, vendor_id) VALUES
  ('wall-tv', '85-inch Wall TV and Soundbar', 'A huge wall-mounted TV over a floating walnut shelf and soundbar.', 'furniture', 120000, NULL),
  ('dressing-table', 'Dressing Table and Mirror', 'A cream dressing table with a lit round mirror and a velvet stool.', 'furniture', 38000, NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, price = EXCLUDED.price, vendor_id = EXCLUDED.vendor_id, active = TRUE;
