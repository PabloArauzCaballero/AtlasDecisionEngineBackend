-- El padrón de entidades de intermediación financiera, administrable.
--
-- Hasta aquí el motor sabía atribuir un extracto a una entidad contra una lista
-- COMPILADA de veinte nombres. Dos consecuencias, y las dos se medían:
--
--   1. Las entidades que faltaban —39 cooperativas, 3 entidades de vivienda, 8
--      IFD y varios bancos— caían en "entidad desconocida", que es la misma
--      respuesta que recibe una factura. Un extracto legítimo de una cooperativa
--      era indistinguible de un documento ajeno.
--   2. Revocar una licencia exigía un despliegue. ASFI interviene una entidad por
--      resolución, de un día para otro; el motor seguía procesando sus documentos
--      como si nada hasta la siguiente versión.
--
-- Por eso es una tabla y no una constante: lo que hay aquí son DATOS que cambian
-- por decisión del regulador, no reglas del motor.

CREATE TYPE "FinancialInstitutionKind" AS ENUM (
  'MULTIPLE_BANK',
  'PYME_BANK',
  'STATE_BANK',
  'DEVELOPMENT_BANK',
  'HOUSING_ENTITY',
  'COOPERATIVE',
  'DEVELOPMENT_IFD'
);

CREATE TYPE "InstitutionLicenseStatus" AS ENUM ('LICENSED', 'SUSPENDED', 'REVOKED');

CREATE TABLE "decision_financial_institution" (
  "id"              BIGSERIAL PRIMARY KEY,
  "tenant_id"       BIGINT NOT NULL,
  "code"            VARCHAR(16) NOT NULL,
  "name"            VARCHAR(200) NOT NULL,
  "kind"            "FinancialInstitutionKind" NOT NULL,
  "license_status"  "InstitutionLicenseStatus" NOT NULL DEFAULT 'LICENSED',
  "retail_deposits" BOOLEAN NOT NULL DEFAULT true,
  -- Fuente de expresión regular, en un arreglo. Se valida al escribir (longitud,
  -- compilación y `safe-regex`): un patrón catastrófico en el padrón se ejecuta
  -- contra la carátula de CADA documento que entra.
  "markers"         JSONB NOT NULL,
  "exclusions"      JSONB NOT NULL DEFAULT '[]'::jsonb,
  "note"            TEXT,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_by"      VARCHAR(160)
);

CREATE UNIQUE INDEX "decision_financial_institution_tenant_code_key"
  ON "decision_financial_institution" ("tenant_id", "code");
CREATE INDEX "decision_financial_institution_tenant_active_idx"
  ON "decision_financial_institution" ("tenant_id", "is_active");
CREATE INDEX "decision_financial_institution_tenant_license_idx"
  ON "decision_financial_institution" ("tenant_id", "license_status");

-- Un padrón sin marcadores no atribuiría nada, y el motor leería esa tabla vacía
-- como "ninguna entidad boliviana existe": rechazaría todos los extractos a la
-- vez. La restricción convierte ese estado en un error de escritura en vez de en
-- una caída silenciosa del reconocimiento.
ALTER TABLE "decision_financial_institution"
  ADD CONSTRAINT "decision_financial_institution_markers_no_vacios"
  CHECK (jsonb_typeof("markers") = 'array' AND jsonb_array_length("markers") > 0);

ALTER TABLE "decision_financial_institution"
  ADD CONSTRAINT "decision_financial_institution_exclusions_arreglo"
  CHECK (jsonb_typeof("exclusions") = 'array');

-- Una licencia no vigente sin explicación deja a quien revisa el caso sin nada
-- que leer: el motivo es lo único que convierte "esta entidad no opera" en una
-- decisión que alguien puede tomar.
ALTER TABLE "decision_financial_institution"
  ADD CONSTRAINT "decision_financial_institution_motivo_de_revocacion"
  CHECK ("license_status" = 'LICENSED' OR "note" IS NOT NULL);

ALTER TABLE "decision_financial_institution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_financial_institution" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_financial_institution";
CREATE POLICY tenant_isolation ON "decision_financial_institution"
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::bigint);
