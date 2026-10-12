-- Lagos Living Boutique: outfits bought from the phone. No vendor, so no shop visit is needed.
-- Keep in step with BOUTIQUE in packages/shared/src/index.ts.
INSERT INTO shop_catalog (id, name, description, category, price, vendor_id) VALUES
  ('outfit:agbada-royal', 'Royal blue agbada', 'Flowing three-piece agbada with gold embroidery, for owambe Saturdays.', 'clothing', 65000, NULL),
  ('outfit:senator-black', 'Black senator', 'Sharp black senator top and trousers with a long sleeve.', 'clothing', 38000, NULL),
  ('outfit:aso-oke-wine', 'Wine aso-oke kaftan', 'Hand-woven wine aso-oke kaftan with matching trousers.', 'clothing', 52000, NULL),
  ('outfit:denim-street', 'White tee and denim', 'Clean white tee, straight blue jeans and white sneakers.', 'clothing', 18000, NULL),
  ('outfit:suit-navy', 'Navy two-piece suit', 'Tailored navy suit for Victoria Island boardrooms.', 'clothing', 75000, NULL),
  ('outfit:polo-weekend', 'Weekend polo and chinos', 'Navy polo, stone chinos and loafers for a Lekki brunch.', 'clothing', 22000, NULL),
  ('outfit:gown-emerald', 'Emerald evening gown', 'Floor-length emerald gown for the club and the gala.', 'clothing', 70000, NULL),
  ('outfit:boubou-gold', 'Gold boubou', 'Wide, airy boubou in gold with a deep print border.', 'clothing', 48000, NULL),
  ('outfit:ankara-jumpsuit', 'Ankara jumpsuit', 'Bold ankara jumpsuit, long-legged and sleeveless.', 'clothing', 34000, NULL),
  ('outfit:denim-skirt', 'Tee and denim skirt', 'White tee with a knee-length denim skirt.', 'clothing', 16000, NULL),
  ('outfit:corporate-red', 'Red corporate dress', 'Structured red sheath dress with long sleeves.', 'clothing', 42000, NULL),
  ('outfit:lace-wine', 'Wine lace iro and buba', 'Wine lace buba with a wrapped iro skirt.', 'clothing', 58000, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, price = EXCLUDED.price, vendor_id = NULL, active = TRUE;
