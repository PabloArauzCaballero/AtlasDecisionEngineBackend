-- Persist test-suite work before executing it so HTTP requests can return 202 quickly
-- and multiple application replicas can claim jobs without duplicating execution.
ALTER TABLE "decision_test_run"
  ADD COLUMN "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "decision_test_run"
SET "queued_at" = "started_at"
WHERE "started_at" IS NOT NULL;

ALTER TABLE "decision_test_run"
  ALTER COLUMN "status" SET DEFAULT 'QUEUED',
  ALTER COLUMN "started_at" DROP DEFAULT,
  ALTER COLUMN "started_at" DROP NOT NULL;

CREATE INDEX "decision_test_run_status_queued_at_idx"
  ON "decision_test_run"("status", "queued_at");
