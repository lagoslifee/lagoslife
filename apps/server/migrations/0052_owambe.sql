-- Owambes residents host on the event ground: the party runs for half an hour and guests eat on the host.
CREATE TABLE IF NOT EXISTS owambe_booking (
  id TEXT PRIMARY KEY,
  host_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('wedding', 'birthday', 'burial')),
  celebrant TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS owambe_booking_ends ON owambe_booking (ends_at);

-- Plates eaten, so a guest gets one every few minutes even across reconnects.
CREATE TABLE IF NOT EXISTS owambe_plate (
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  dish TEXT NOT NULL,
  eaten_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS owambe_plate_user ON owambe_plate (user_id, eaten_at DESC);
