-- El titular del extracto tiene que ser el cliente que lo sube (Pablo, 2026-10-16).
--
-- 1. `expected_holder_*`: el nombre que se exige (completo, y nombres/apellidos por separado), lo manda
--    AtlasBackend con el PDF.
-- 2. `holder_name_read` y `holder_verdict`: lo que el motor leyó y el veredicto de la comparación.
-- 3. Dos valores de enum: el rechazo `HOLDER_MISMATCH` y el motivo de revisión `HOLDER_UNREADABLE`.
--
-- Expand puro: columnas nulas sin valores por defecto y valores de enum añadidos al final. Ninguna fila
-- existente cambia de significado.
ALTER TABLE "decision_bank_statement_run"
  ADD COLUMN IF NOT EXISTS "expected_holder_name" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "expected_holder_given_names" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "expected_holder_surnames" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "holder_name_read" VARCHAR(300),
  ADD COLUMN IF NOT EXISTS "holder_verdict" VARCHAR(16);

ALTER TYPE "StatementRejectionReason" ADD VALUE IF NOT EXISTS 'HOLDER_MISMATCH';
ALTER TYPE "StatementReviewReason" ADD VALUE IF NOT EXISTS 'HOLDER_UNREADABLE';
--
-- Rollback operacional: dejar de escribirlas. Los valores de enum no se quitan (Postgres no lo permite);
-- sin filas que los usen son inertes.
