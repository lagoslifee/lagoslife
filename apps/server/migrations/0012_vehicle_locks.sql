-- Owners choose whether other players may ride in their vehicle as passengers.
ALTER TABLE player_vehicle ADD COLUMN locked BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE vehicle_event DROP CONSTRAINT vehicle_event_kind_check;
ALTER TABLE vehicle_event ADD CONSTRAINT vehicle_event_kind_check
  CHECK (kind IN ('purchase', 'service', 'repair', 'insurance', 'tow', 'impact', 'garage', 'retrieve', 'lock', 'unlock'));
