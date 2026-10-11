-- Rides live in room memory; this row exists from payment until the ride is settled, so a ride cut off by a server
-- restart can be refunded when the rider comes back.
CREATE TABLE IF NOT EXISTS ride_open (
  ride_id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  fare integer NOT NULL CHECK (fare >= 0),
  label text NOT NULL,
  booked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ride_open_user ON ride_open (user_id);
