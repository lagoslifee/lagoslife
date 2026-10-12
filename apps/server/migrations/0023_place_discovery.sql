-- Public places each player has been to; only these (plus favourites) can be fast-travelled to.
CREATE TABLE IF NOT EXISTS place_discovery (
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  place_id text NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, place_id)
);
