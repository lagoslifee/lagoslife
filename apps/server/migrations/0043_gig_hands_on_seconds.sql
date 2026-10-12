-- Hands-on gigs (generator repair) have no timed work phase, so they store 0 seconds.
ALTER TABLE gig_run DROP CONSTRAINT IF EXISTS gig_run_work_seconds_check;
ALTER TABLE gig_run ADD CONSTRAINT gig_run_work_seconds_check CHECK (work_seconds >= 0);
