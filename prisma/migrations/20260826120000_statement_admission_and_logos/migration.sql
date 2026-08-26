-- Admisión del extracto: autenticidad del contenedor y cobertura mínima.
--
-- Los cuatro valores nuevos existen porque el worker ya no responde sólo «¿es un
-- extracto y de quién?», sino también «¿este archivo es el que emitió el banco?»
-- y «¿cubre los meses que hacen falta para poder afirmar algo?». Sin motivos
-- propios, esos dos rechazos caerían en `NOT_BANK_STATEMENT`, que es falso —el
-- documento sí lo es— y además borraría la única distinción que importa para el
-- cliente: en un caso tiene que subir OTRO documento, en el otro el MISMO sin
-- editar, y en el tercero el mismo con más meses.
ALTER TYPE "StatementRejectionReason" ADD VALUE IF NOT EXISTS 'TAMPERED_DOCUMENT';
ALTER TYPE "StatementRejectionReason" ADD VALUE IF NOT EXISTS 'ACTIVE_CONTENT';
ALTER TYPE "StatementRejectionReason" ADD VALUE IF NOT EXISTS 'INSUFFICIENT_PERIOD';
ALTER TYPE "StatementReviewReason" ADD VALUE IF NOT EXISTS 'SUSPECTED_TAMPERING';

-- El logotipo de cada entidad, guardado en la propia fila.
--
-- Como BYTES y no como URL externa: el padrón no puede depender de que sesenta y
-- siete sitios ajenos sigan sirviendo la misma ruta, y la pantalla que lo
-- administra no debe pedir recursos a esos dominios.
ALTER TABLE "decision_financial_institution"
  ADD COLUMN IF NOT EXISTS "website" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "logo_data" BYTEA,
  ADD COLUMN IF NOT EXISTS "logo_content_type" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "logo_source" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "logo_source_url" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "logo_updated_at" TIMESTAMPTZ(6);

-- El resultado de la capacidad de pago, junto a la ejecución que lo produjo.
--
-- En columnas y no sólo dentro de `result_json` porque son las cifras por las
-- que se filtra y se ordena una cola de revisión —«enséñame los que no llegan a
-- tres meses», «ordénalos por capacidad»— y hacerlo sobre un JSON obliga a leer
-- la fila entera de cada ejecución para descartarla.
ALTER TABLE "decision_bank_statement_run"
  ADD COLUMN IF NOT EXISTS "affordability_json" JSONB,
  ADD COLUMN IF NOT EXISTS "months_complete" SMALLINT,
  ADD COLUMN IF NOT EXISTS "affordability_score" SMALLINT,
  ADD COLUMN IF NOT EXISTS "affordability_band" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "monthly_income" NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS "monthly_obligations" NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS "max_affordable_installment" NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS "authenticity_verdict" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "authenticity_score" SMALLINT;

CREATE INDEX IF NOT EXISTS "decision_bank_statement_run_affordability_idx"
  ON "decision_bank_statement_run" ("tenant_id", "affordability_band");
