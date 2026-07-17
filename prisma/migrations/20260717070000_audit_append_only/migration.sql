-- Enforce append-only on the audit chain at the database level.
--
-- The chain is hash-linked, so tampering is detectable after the fact, but nothing
-- physically prevented an UPDATE or DELETE. A regulator's question is not "would we
-- notice?" but "could it happen?" — these triggers answer the second one.
--
-- Scope and honest limits:
--   * Triggers apply to the table owner too, so this holds for the application's normal
--     credential. A superuser can still disable triggers or SET session_replication_role,
--     so this is not a defence against a compromised superuser. Real separation needs the
--     append-only role split (an insert-only runtime role), which the single shared
--     PostgreSQL credential does not allow yet.
--   * DELETE is blocked outright. There is deliberately no purge path: the retention and
--     legal-hold policy is not approved yet, and no purge job may exist before it is.

CREATE OR REPLACE FUNCTION atlas_audit_event_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'decision_audit_event is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_decision_audit_event_no_update ON "decision_audit_event";
CREATE TRIGGER trg_decision_audit_event_no_update
  BEFORE UPDATE ON "decision_audit_event"
  FOR EACH ROW EXECUTE FUNCTION atlas_audit_event_append_only();

DROP TRIGGER IF EXISTS trg_decision_audit_event_no_delete ON "decision_audit_event";
CREATE TRIGGER trg_decision_audit_event_no_delete
  BEFORE DELETE ON "decision_audit_event"
  FOR EACH ROW EXECUTE FUNCTION atlas_audit_event_append_only();

-- TRUNCATE bypasses row-level triggers entirely, so it needs its own statement-level guard.
DROP TRIGGER IF EXISTS trg_decision_audit_event_no_truncate ON "decision_audit_event";
CREATE TRIGGER trg_decision_audit_event_no_truncate
  BEFORE TRUNCATE ON "decision_audit_event"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_audit_event_append_only();
