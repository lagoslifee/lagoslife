-- One-off gigs from the shared gig board. Pay is recorded as job_reward.
CREATE TABLE IF NOT EXISTS gig_run (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  gig_id text NOT NULL,
  type_id text NOT NULL,
  title text NOT NULL,
  task text NOT NULL,
  emoji text NOT NULL,
  place_id text NOT NULL,
  reward bigint NOT NULL CHECK (reward > 0),
  work_seconds integer NOT NULL CHECK (work_seconds > 0),
  status text NOT NULL DEFAULT 'travelling' CHECK (status IN ('travelling', 'working', 'completed', 'cancelled')),
  started_work_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_gig_per_player ON gig_run (user_id) WHERE status IN ('travelling', 'working');
CREATE INDEX IF NOT EXISTS gig_run_user ON gig_run (user_id, created_at DESC);
