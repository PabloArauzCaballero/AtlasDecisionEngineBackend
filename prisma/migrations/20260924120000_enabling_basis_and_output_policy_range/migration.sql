-- P-09 / P-10 del plan de cumplimiento (2026-09-24).
--
-- 1. `enabling_basis_policy`: qué base habilitante exige cada versión, por finalidad, y qué hacer
--    si falta (revisión o bloqueo). Hasta ahora la guardia sólo bloqueaba un permiso que EXISTÍA y
--    ya no valía; la ausencia de evidencia se leía como permiso. Nula = se deriva (ver
--    `src/modules/risk-governance/enabling-basis.ts`), así que ninguna versión publicada cambia de
--    forma hasta que el motor lo decide por política.
-- 2. `consent_version`: la versión del texto bajo la que se otorgó la base. Sin ella no se puede
--    exigir que el titular haya aceptado la versión vigente.
-- 3. `policy_min_value` / `policy_max_value`: el rango que la POLÍTICA admite para una salida
--    económica (precio, importe), más estrecho que el del rol. Fuera de él la salida no autoriza.
--
-- Todo es aditivo y nulable: ninguna fila existente cambia de significado.
ALTER TABLE "decision_artifact_version" ADD COLUMN "enabling_basis_policy" JSONB;

ALTER TABLE "subject_consent" ADD COLUMN "consent_version" VARCHAR(40);

ALTER TABLE "decision_output_contract_field"
  ADD COLUMN "policy_min_value" DECIMAL(18, 6),
  ADD COLUMN "policy_max_value" DECIMAL(18, 6);

ALTER TABLE "decision_output_contract_field"
  ADD CONSTRAINT "decision_output_contract_field_policy_range_chk"
  CHECK ("policy_min_value" IS NULL OR "policy_max_value" IS NULL OR "policy_min_value" <= "policy_max_value");
