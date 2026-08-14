-- Valores que debían pertenecer a un catálogo y no se pudieron resolver.
--
-- La unicidad por (tenant, source, normalized_value) es el mecanismo de
-- deduplicación: el mismo término repetido suma apariciones en lugar de crear
-- pendientes y notificaciones duplicadas, incluso si dos procesos lo detectan a
-- la vez.
CREATE TABLE "decision_unresolved_classification" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "raw_value" TEXT NOT NULL,
    "normalized_value" VARCHAR(500) NOT NULL,
    "source" VARCHAR(120) NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "suggested_category_code" VARCHAR(120),
    "confidence" DECIMAL(4,3),
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "resolved_category_code" VARCHAR(120),
    "resolved_by" VARCHAR(160),
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_type" VARCHAR(30),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "decision_unresolved_classification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "decision_unresolved_classification_tenant_source_value_key"
    ON "decision_unresolved_classification"("tenant_id", "source", "normalized_value");
CREATE INDEX "decision_unresolved_classification_tenant_status_count_idx"
    ON "decision_unresolved_classification"("tenant_id", "status", "occurrence_count");
CREATE INDEX "decision_unresolved_classification_tenant_status_seen_idx"
    ON "decision_unresolved_classification"("tenant_id", "status", "last_seen_at");

-- Aislamiento por tenant, como el resto de las tablas del motor.
ALTER TABLE "decision_unresolved_classification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_unresolved_classification" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "decision_unresolved_classification"
    USING (current_setting('app.tenant_id', true) IS NULL
           OR tenant_id = current_setting('app.tenant_id', true)::bigint)
    WITH CHECK (current_setting('app.tenant_id', true) IS NULL
           OR tenant_id = current_setting('app.tenant_id', true)::bigint);
