ALTER TABLE game_transaction DROP CONSTRAINT game_transaction_kind_check;
ALTER TABLE game_transaction ADD CONSTRAINT game_transaction_kind_check
  CHECK (kind IN (
    'starting_balance', 'purchase', 'job_reward',
    'property_purchase', 'property_rent', 'property_deposit',
    'deposit_refund', 'transport_fare',
    'vehicle_purchase', 'vehicle_service', 'vehicle_insurance', 'vehicle_tow',
    'community_wage', 'fine_payment'
  ));

-- Staff roles are granted from the server command line or by an admin; never self-assigned.
CREATE TABLE staff_role (
  user_id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('moderator', 'admin')),
  granted_by TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every chat line is kept (original and as shown) so reports can be checked against what was actually said.
CREATE TABLE chat_message (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  location TEXT NOT NULL,
  x REAL NOT NULL,
  z REAL NOT NULL,
  body TEXT NOT NULL,
  shown TEXT NOT NULL,
  filtered BOOLEAN NOT NULL,
  recipients INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX chat_message_user_idx ON chat_message (user_id, created_at DESC);
CREATE INDEX chat_message_created_idx ON chat_message (created_at);

CREATE TABLE player_block (
  blocker_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX player_block_blocked_idx ON player_block (blocked_id);

CREATE TABLE player_report (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  reported_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('harassment', 'hate', 'sexual', 'spam', 'cheating', 'impersonation', 'other')),
  details TEXT NOT NULL DEFAULT '',
  chat_message_id TEXT REFERENCES chat_message (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (reporter_id <> reported_id)
);
-- One open report per reporter and target; further reports add nothing until a moderator resolves it.
CREATE UNIQUE INDEX player_report_one_open ON player_report (reporter_id, reported_id) WHERE status = 'open';
CREATE INDEX player_report_queue_idx ON player_report (status, created_at);

-- Warnings, mutes and suspensions in force or in the past.
CREATE TABLE account_sanction (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('warn', 'mute', 'suspend')),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  lifted_at TIMESTAMPTZ,
  lifted_by TEXT,
  acknowledged_at TIMESTAMPTZ
);
CREATE INDEX account_sanction_user_idx ON account_sanction (user_id, kind, created_at DESC);

CREATE FUNCTION forbid_audit_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit rows are append-only';
END
$$ LANGUAGE plpgsql;

-- Account moderation audit trail. No foreign keys: entries outlive the accounts they mention.
CREATE TABLE moderation_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  target_user_id TEXT,
  target_name TEXT,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX moderation_audit_created_idx ON moderation_audit (created_at DESC);
CREATE INDEX moderation_audit_target_idx ON moderation_audit (target_user_id, created_at DESC);
CREATE TRIGGER moderation_audit_append_only BEFORE UPDATE OR DELETE ON moderation_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();

-- Fictional in-game law: citations paid in game naira, appealable to a moderator.
CREATE TABLE citation (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  offence TEXT NOT NULL CHECK (offence IN ('careless_driving')),
  fine BIGINT NOT NULL CHECK (fine > 0),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'appealed', 'paid', 'overturned')),
  evidence JSONB NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  appeal_statement TEXT,
  appeal_filed_at TIMESTAMPTZ,
  appeal_outcome TEXT CHECK (appeal_outcome IN ('upheld', 'overturned')),
  appeal_note TEXT,
  decided_by TEXT,
  decided_at TIMESTAMPTZ
);
CREATE INDEX citation_user_idx ON citation (user_id, issued_at DESC);
CREATE INDEX citation_appeal_queue_idx ON citation (appeal_filed_at) WHERE status = 'appealed';

-- In-game justice audit trail, kept apart from account moderation.
CREATE TABLE justice_event (
  id TEXT PRIMARY KEY,
  citation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('issued', 'paid', 'appealed', 'upheld', 'overturned')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX justice_event_citation_idx ON justice_event (citation_id, created_at);
CREATE TRIGGER justice_event_append_only BEFORE UPDATE OR DELETE ON justice_event
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();
