-- Enforce deployment and range invariants at the database (plan §2.8 / D-10).
--
-- These are safety nets: application code already maintains them, but a bug or a manual
-- write must not be able to leave the data in a state the runtime assumes cannot happen.

-- At most one ACTIVE deployment per (artifact version, environment). A partial unique index
-- lets many inactive/superseded deployments coexist while guaranteeing a single live one,
-- which is what the runtime resolver depends on.
CREATE UNIQUE INDEX IF NOT EXISTS "decision_deployment_one_active_per_version_env"
  ON "decision_deployment" ("artifact_version_id", "environment_id")
  WHERE "is_active" = true;

-- Percentages are bounded; the column types allow out-of-range values that would corrupt
-- coverage gating and traffic routing.
ALTER TABLE "decision_test_coverage"
  ADD CONSTRAINT "decision_test_coverage_percentage_range"
  CHECK ("coverage_percentage" >= 0 AND "coverage_percentage" <= 100);

ALTER TABLE "decision_deployment_traffic"
  ADD CONSTRAINT "decision_deployment_traffic_percentage_range"
  CHECK ("traffic_percentage" >= 0 AND "traffic_percentage" <= 100);

-- A negative routing priority is meaningless and would sort unpredictably.
ALTER TABLE "decision_deployment_traffic"
  ADD CONSTRAINT "decision_deployment_traffic_priority_nonneg"
  CHECK ("priority" >= 0);
