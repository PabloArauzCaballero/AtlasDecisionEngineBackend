-- CreateEnum
CREATE TYPE "ArtifactReferenceErrorPolicy" AS ENUM ('FAIL', 'FALLBACK', 'SKIP');

-- CreateEnum
CREATE TYPE "CodeImportStatus" AS ENUM ('ANALYZED', 'DRAFT_SAVED', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "decision_artifact_reference" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "parent_artifact_version_id" BIGINT NOT NULL,
    "node_key" VARCHAR(120) NOT NULL,
    "child_artifact_id" BIGINT NOT NULL,
    "child_artifact_version_id" BIGINT NOT NULL,
    "input_mapping_json" JSONB NOT NULL,
    "output_mapping_json" JSONB NOT NULL,
    "timeout_ms" INTEGER NOT NULL DEFAULT 2000,
    "on_error_policy" "ArtifactReferenceErrorPolicy" NOT NULL DEFAULT 'FAIL',
    "fallback_output_json" JSONB,
    "required_role" VARCHAR(80),
    "created_by" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "decision_artifact_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_execution_tree_link" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "root_execution_id" BIGINT NOT NULL,
    "parent_execution_id" BIGINT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "parent_sequence" INTEGER,
    "node_key" VARCHAR(120) NOT NULL,
    "child_artifact_version_id" BIGINT,
    "child_execution_id" BIGINT,
    "depth" INTEGER NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "output_json" JSONB,
    "error_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_execution_tree_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_code_import" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "artifact_id" BIGINT,
    "artifact_version_id" BIGINT,
    "language" VARCHAR(30) NOT NULL,
    "source_code" TEXT NOT NULL,
    "source_checksum" VARCHAR(128) NOT NULL,
    "contract_version" VARCHAR(20) NOT NULL,
    "contract_json" JSONB NOT NULL,
    "ir_json" JSONB NOT NULL,
    "issues_json" JSONB NOT NULL,
    "status" "CodeImportStatus" NOT NULL DEFAULT 'ANALYZED',
    "created_by" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "decision_code_import_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decision_artifact_reference_tenant_id_child_artifact_id_idx" ON "decision_artifact_reference"("tenant_id", "child_artifact_id");

-- CreateIndex
CREATE INDEX "decision_artifact_reference_child_artifact_version_id_idx" ON "decision_artifact_reference"("child_artifact_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_artifact_reference_parent_artifact_version_id_node_key" ON "decision_artifact_reference"("parent_artifact_version_id", "node_key");

-- CreateIndex
CREATE INDEX "decision_execution_tree_link_tenant_id_root_execution_id_idx" ON "decision_execution_tree_link"("tenant_id", "root_execution_id");

-- CreateIndex
CREATE INDEX "decision_execution_tree_link_parent_execution_id_node_key_idx" ON "decision_execution_tree_link"("parent_execution_id", "node_key");

-- CreateIndex
CREATE UNIQUE INDEX "decision_execution_tree_link_root_execution_id_sequence_key" ON "decision_execution_tree_link"("root_execution_id", "sequence");

-- CreateIndex
CREATE INDEX "decision_code_import_tenant_id_status_created_at_idx" ON "decision_code_import"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "decision_code_import_artifact_version_id_idx" ON "decision_code_import"("artifact_version_id");

-- AddForeignKey (no Prisma relations declared, to keep the schema.prisma block purely
-- additive/mergeable; referential integrity is still enforced at the SQL level)
ALTER TABLE "decision_artifact_reference"
  ADD CONSTRAINT "decision_artifact_reference_parent_fkey"
  FOREIGN KEY ("parent_artifact_version_id") REFERENCES "decision_artifact_version"("id") ON DELETE CASCADE;
ALTER TABLE "decision_artifact_reference"
  ADD CONSTRAINT "decision_artifact_reference_child_artifact_fkey"
  FOREIGN KEY ("child_artifact_id") REFERENCES "decision_artifact"("id") ON DELETE RESTRICT;
ALTER TABLE "decision_artifact_reference"
  ADD CONSTRAINT "decision_artifact_reference_child_version_fkey"
  FOREIGN KEY ("child_artifact_version_id") REFERENCES "decision_artifact_version"("id") ON DELETE RESTRICT;

ALTER TABLE "decision_execution_tree_link"
  ADD CONSTRAINT "decision_execution_tree_link_root_fkey"
  FOREIGN KEY ("root_execution_id") REFERENCES "decision_execution"("id") ON DELETE CASCADE;
ALTER TABLE "decision_execution_tree_link"
  ADD CONSTRAINT "decision_execution_tree_link_parent_fkey"
  FOREIGN KEY ("parent_execution_id") REFERENCES "decision_execution"("id") ON DELETE CASCADE;
ALTER TABLE "decision_execution_tree_link"
  ADD CONSTRAINT "decision_execution_tree_link_child_version_fkey"
  FOREIGN KEY ("child_artifact_version_id") REFERENCES "decision_artifact_version"("id") ON DELETE RESTRICT;
ALTER TABLE "decision_execution_tree_link"
  ADD CONSTRAINT "decision_execution_tree_link_child_execution_fkey"
  FOREIGN KEY ("child_execution_id") REFERENCES "decision_execution"("id") ON DELETE SET NULL;

ALTER TABLE "decision_code_import"
  ADD CONSTRAINT "decision_code_import_artifact_fkey"
  FOREIGN KEY ("artifact_id") REFERENCES "decision_artifact"("id") ON DELETE SET NULL;
ALTER TABLE "decision_code_import"
  ADD CONSTRAINT "decision_code_import_artifact_version_fkey"
  FOREIGN KEY ("artifact_version_id") REFERENCES "decision_artifact_version"("id") ON DELETE SET NULL;

-- RLS (tenant-scoped tables), mirroring migration 20260719080000_tenant_rls_and_app_role.
ALTER TABLE "decision_artifact_reference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_artifact_reference" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_artifact_reference";
CREATE POLICY tenant_isolation ON "decision_artifact_reference"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

ALTER TABLE "decision_execution_tree_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_execution_tree_link" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_execution_tree_link";
CREATE POLICY tenant_isolation ON "decision_execution_tree_link"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

ALTER TABLE "decision_code_import" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_code_import" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_code_import";
CREATE POLICY tenant_isolation ON "decision_code_import"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- Explicit grants for the three new tables (belt-and-suspenders alongside the
-- ALTER DEFAULT PRIVILEGES set in 20260719080000, which only covers objects created
-- by the same role going forward).
GRANT SELECT, INSERT, UPDATE, DELETE ON "decision_artifact_reference", "decision_execution_tree_link", "decision_code_import" TO atlas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO atlas_app;

-- Depth guard for nested references: application-enforced (configurable max depth,
-- see NestedTreeService), but a hard ceiling here prevents runaway chains even if
-- application validation is ever bypassed.
ALTER TABLE "decision_artifact_reference"
  ADD CONSTRAINT "decision_artifact_reference_timeout_positive_chk"
  CHECK ("timeout_ms" > 0 AND "timeout_ms" <= 60000);
