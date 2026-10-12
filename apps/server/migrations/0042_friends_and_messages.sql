-- Friend requests (pending) and friendships (accepted); one row per pair, from whoever asked first.
CREATE TABLE IF NOT EXISTS friendship (
  requester_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  addressee_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  accepted_at timestamptz,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX IF NOT EXISTS friendship_addressee ON friendship (addressee_id);

-- Private messages between friends. `body` is what was typed (kept for moderation), `shown` what was delivered.
CREATE TABLE IF NOT EXISTS direct_message (
  id uuid PRIMARY KEY,
  sender_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  recipient_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  body text NOT NULL,
  shown text NOT NULL,
  filtered boolean NOT NULL DEFAULT FALSE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS direct_message_pair ON direct_message (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), created_at DESC);
CREATE INDEX IF NOT EXISTS direct_message_unread ON direct_message (recipient_id) WHERE read_at IS NULL;
