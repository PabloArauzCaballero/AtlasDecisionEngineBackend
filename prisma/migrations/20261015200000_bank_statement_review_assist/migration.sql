-- Lo que la revisión humana de un extracto necesita para decidir con datos (2026-10-15).
--
-- 1. `provisional_result_json`: el análisis completo (movimientos, ingresos, gastos, categorías,
--    capacidad) de un documento cuyo EMISOR no se pudo reconocer. Va aparte de `result_json` a
--    propósito: `result_json` es el resultado que el consumidor (AtlasBackend) aplica, y un caso en
--    revisión no tiene resultado aplicable. Así el contrato no cambia y nada se admite solo.
-- 2. `assigned_institution_*`: la entidad que una persona asignó a mano al revisar, con quién y cuándo.
--    El reproceso la usa en lugar de la detección automática.
--
-- Expand puro: columnas nulas, sin valores por defecto ni reescritura de la tabla.
ALTER TABLE "decision_bank_statement_run"
  ADD COLUMN IF NOT EXISTS "provisional_result_json" JSONB,
  ADD COLUMN IF NOT EXISTS "assigned_institution_code" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "assigned_institution_by" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "assigned_institution_at" TIMESTAMPTZ(6);
--
-- Rollback operacional: dejar de leerlas. Si hubiera que quitarlas:
--   ALTER TABLE "decision_bank_statement_run" DROP COLUMN "provisional_result_json",
--     DROP COLUMN "assigned_institution_code", DROP COLUMN "assigned_institution_by",
--     DROP COLUMN "assigned_institution_at";
