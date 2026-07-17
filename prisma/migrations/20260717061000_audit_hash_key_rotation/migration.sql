-- Existing audit events were signed with the original key, identified as v1.
-- Keeping this change incremental ensures databases that already applied the
-- baseline migrations receive the new column without rewriting migration history.
ALTER TABLE "decision_audit_event"
  ADD COLUMN "hash_key_id" VARCHAR(40) NOT NULL DEFAULT 'v1';
