-- Rebanada 1: transactional outbox + notification inbox (additive, no data transform).
--
-- decision_outbox_event: domain events written inside the same transaction as the
-- business change; a relay worker claims PENDING rows with a lease and dispatches them.
-- decision_processed_event: (consumer, event) bookkeeping for exactly-once consumers.
-- decision_notification: role/principal-addressed inbox projected from events.

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DISPATCHED', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "decision_outbox_event" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "schema_version" VARCHAR(20) NOT NULL DEFAULT '1',
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" VARCHAR(160) NOT NULL,
    "actor_id" VARCHAR(160) NOT NULL,
    "correlation_id" VARCHAR(120),
    "causation_id" VARCHAR(120),
    "payload_json" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_expires_at" TIMESTAMPTZ(6),
    "locked_by" VARCHAR(120),
    "last_error" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(6),

    CONSTRAINT "decision_outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_processed_event" (
    "id" BIGSERIAL NOT NULL,
    "consumer_name" VARCHAR(120) NOT NULL,
    "outbox_event_id" BIGINT NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_processed_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_notification" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "recipient_role" VARCHAR(80),
    "recipient_id" VARCHAR(160),
    "category" VARCHAR(50) NOT NULL,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "entity_type" VARCHAR(80),
    "entity_id" VARCHAR(160),
    "action_url" VARCHAR(500),
    "event_type" VARCHAR(120) NOT NULL,
    "correlation_id" VARCHAR(120),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decision_outbox_event_status_available_at_idx" ON "decision_outbox_event"("status", "available_at");

-- CreateIndex
CREATE INDEX "decision_outbox_event_tenant_id_occurred_at_idx" ON "decision_outbox_event"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "decision_outbox_event_aggregate_type_aggregate_id_idx" ON "decision_outbox_event"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_processed_event_consumer_name_outbox_event_id_key" ON "decision_processed_event"("consumer_name", "outbox_event_id");

-- CreateIndex
CREATE INDEX "decision_notification_tenant_id_recipient_role_read_at_id_idx" ON "decision_notification"("tenant_id", "recipient_role", "read_at", "id");

-- CreateIndex
CREATE INDEX "decision_notification_tenant_id_recipient_id_read_at_id_idx" ON "decision_notification"("tenant_id", "recipient_id", "read_at", "id");

-- Tenant Row-Level Security, mirroring 20260719080000_tenant_rls_and_app_role. Both new
-- tenant-scoped tables get the same policy shape: enforced whenever app.tenant_id is set
-- (every request-scoped query sets it via the PrismaService extension), permissive when
-- unset so the relay worker, migrations and seeds keep working without a tenant context.
-- decision_processed_event is system bookkeeping (no tenant column): it stays outside the
-- tenant filter, and atlas_app already has access through the schema default privileges.

-- RLS: decision_outbox_event
ALTER TABLE "decision_outbox_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_outbox_event" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_outbox_event";
CREATE POLICY tenant_isolation ON "decision_outbox_event"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- RLS: decision_notification
ALTER TABLE "decision_notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_notification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_notification";
CREATE POLICY tenant_isolation ON "decision_notification"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);
