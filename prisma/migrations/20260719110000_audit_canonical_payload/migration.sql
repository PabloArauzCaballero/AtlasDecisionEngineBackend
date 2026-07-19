-- Store the exact canonical string each audit event was signed over (plan §2.5 / D-9).
--
-- eventHash is an HMAC over the canonical serialization of the event. Verification used to
-- rebuild that serialization from the columns, re-serializing payload_json — but Postgres
-- JSONB re-normalizes some numbers on round-trip (a high-precision decimal comes back with
-- one fewer digit), so a genuinely untampered event could verify as EVENT_HASH_MISMATCH.
-- Persisting the signed string and hashing it directly makes verification independent of
-- JSONB normalization. Nullable: events written before this fall back to the old path.
ALTER TABLE "decision_audit_event" ADD COLUMN "canonical_payload" TEXT;
