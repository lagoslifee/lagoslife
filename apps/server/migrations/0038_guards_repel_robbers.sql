-- A hold-up on someone with hired guards is recorded as repelled: the guards chase the robber off and nothing is taken.
ALTER TABLE robbery DROP CONSTRAINT robbery_outcome_check;
ALTER TABLE robbery ADD CONSTRAINT robbery_outcome_check CHECK (outcome IN ('pending', 'robbed', 'escaped', 'caught', 'repelled'));
