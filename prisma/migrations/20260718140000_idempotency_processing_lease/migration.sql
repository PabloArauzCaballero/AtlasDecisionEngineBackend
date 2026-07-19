-- Separate the short PROCESSING lease from the long response TTL (plan §3.2).
--
-- expires_at was overloaded: it timed out the PROCESSING lock AND bounded the replay
-- window of a terminal response (24h). A request that crashed mid-flight therefore held
-- its idempotency key for the whole 24h instead of releasing it in seconds. lease_expires_at
-- is the short window a PROCESSING reservation holds the key; once it lapses another request
-- may reclaim the key, while expires_at keeps governing terminal-response replay.
--
-- Existing PROCESSING rows default to now(), so any that were already stuck become
-- reclaimable immediately rather than staying locked for the remainder of their TTL.
ALTER TABLE "decision_runtime_idempotency"
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
