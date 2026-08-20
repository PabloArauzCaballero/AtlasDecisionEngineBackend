-- Controles regulatorios: licitud de uso, base legal del tratamiento y derechos del titular.
--
-- Aditiva por completo. Todo lo nuevo lleva valor por defecto o admite NULL, así que ninguna
-- fila existente cambia de significado y el despliegue no necesita ventana.

-- ---------------------------------------------------------------------------
-- 1. Licitud de USO de un dato en una decisión.
--
-- Eje distinto de la sensibilidad: `sensitivity_class` dice cuánto hay que proteger el dato,
-- esto dice si puede influir en el resultado. Un ingreso es CONFIDENTIAL y utilizable; la
-- etnia puede estar bien protegida y aun así no poder tocar la decisión.
-- ---------------------------------------------------------------------------
CREATE TYPE "DecisionUseRestriction" AS ENUM ('NONE', 'PROHIBITED_BASIS', 'SPECIAL_CATEGORY');

ALTER TABLE "decision_variable_definition"
  ADD COLUMN "decision_use_restriction" "DecisionUseRestriction" NOT NULL DEFAULT 'NONE';

-- ---------------------------------------------------------------------------
-- 2. Base legal y finalidad del tratamiento que realiza cada versión (LGPD arts. 6 I, 7 y 11).
--
-- Ambas admiten NULL: exigirlas retroactivamente invalidaría las versiones ya publicadas y
-- desplegadas. La obligatoriedad la impone el validador de publicación, y sólo cuando la
-- versión consume una variable de categoría especial.
-- ---------------------------------------------------------------------------
CREATE TYPE "ProcessingLegalBasis" AS ENUM (
  'CONSENT',
  'CONTRACT',
  'LEGAL_OBLIGATION',
  'REGULATORY_EXERCISE',
  'CREDIT_PROTECTION',
  'LEGITIMATE_INTEREST',
  'VITAL_INTEREST',
  'HEALTH_PROTECTION'
);

ALTER TABLE "decision_artifact_version"
  ADD COLUMN "processing_purpose" TEXT,
  ADD COLUMN "legal_basis" "ProcessingLegalBasis";

-- ---------------------------------------------------------------------------
-- 3. Localizar las decisiones de un titular.
--
-- La columna se escribía desde el inicio y no la leía nadie: sin índice, atender una
-- solicitud de acceso o eliminación exigía recorrer la tabla de ejecuciones entera, que es
-- la que más crece de todo el esquema.
-- ---------------------------------------------------------------------------
CREATE INDEX "decision_execution_tenant_id_subject_reference_hash_idx"
  ON "decision_execution"("tenant_id", "subject_reference_hash");

-- ---------------------------------------------------------------------------
-- 4. Constancia de las solicitudes de titular (LGPD art. 18 §1; CCPA/CPRA).
--
-- El titular se identifica por el MISMO HMAC que la ejecución, así que la referencia en
-- claro no se persiste en ningún punto.
-- ---------------------------------------------------------------------------
CREATE TYPE "DataSubjectRequestType" AS ENUM ('ACCESS', 'PORTABILITY', 'ERASURE', 'REVIEW');
CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('RECEIVED', 'FULFILLED', 'REJECTED');

CREATE TABLE "decision_data_subject_request" (
  "id"                     BIGSERIAL PRIMARY KEY,
  "tenant_id"              BIGINT NOT NULL,
  "subject_reference_hash" VARCHAR(128) NOT NULL,
  "request_type"           "DataSubjectRequestType" NOT NULL,
  "status"                 "DataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "received_by"            VARCHAR(160) NOT NULL,
  "reference"              VARCHAR(200),
  "resolution_json"        JSONB,
  "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "resolved_at"            TIMESTAMPTZ(6)
);

CREATE INDEX "decision_data_subject_request_tenant_subject_created_idx"
  ON "decision_data_subject_request"("tenant_id", "subject_reference_hash", "created_at");
CREATE INDEX "decision_data_subject_request_tenant_status_created_idx"
  ON "decision_data_subject_request"("tenant_id", "status", "created_at");

-- RLS con la MISMA forma que el resto de tablas tenant-scoped
-- (20260719080000_tenant_rls_and_app_role). Una tabla nueva sin política sería el único
-- punto del esquema donde un fallo de filtrado en el servicio cruzaría tenants — y aquí el
-- dato cruzado sería precisamente el registro de quién ejerció un derecho.
ALTER TABLE "decision_data_subject_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_data_subject_request" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_data_subject_request";
CREATE POLICY tenant_isolation ON "decision_data_subject_request"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'atlas_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "decision_data_subject_request" TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "decision_data_subject_request_id_seq" TO atlas_app;
  END IF;
END
$$;
