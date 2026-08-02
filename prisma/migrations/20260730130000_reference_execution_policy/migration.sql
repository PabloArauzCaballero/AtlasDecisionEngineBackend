-- §9 — configuración completa del nodo de referencia: ambiente, política de selección de
-- versión, reintentos, condición de ejecución, obligatoriedad y exposición en la traza.

CREATE TYPE "ArtifactVersionSelection" AS ENUM ('EXACT', 'ACTIVE_IN_ENVIRONMENT');

ALTER TABLE "decision_artifact_reference"
  ADD COLUMN "environment_code" VARCHAR(40),
  ADD COLUMN "version_selection" "ArtifactVersionSelection" NOT NULL DEFAULT 'EXACT',
  ADD COLUMN "max_retries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retry_delay_ms" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "execution_condition_json" JSONB,
  ADD COLUMN "is_required" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "trace_policy" "TracePolicy" NOT NULL DEFAULT 'FULL';

-- Reintentar sin tope convierte un hijo lento en una tormenta de peticiones; el motor
-- además acota el tiempo total de la cadena.
ALTER TABLE "decision_artifact_reference"
  ADD CONSTRAINT "decision_artifact_reference_retry_bounds"
  CHECK ("max_retries" >= 0 AND "max_retries" <= 3 AND "retry_delay_ms" >= 0 AND "retry_delay_ms" <= 5000);

-- Una referencia opcional necesita saber qué devolver cuando se omite; si la política es
-- FAIL no puede ser opcional, porque el fallo tumbaría igualmente la decisión.
ALTER TABLE "decision_artifact_reference"
  ADD CONSTRAINT "decision_artifact_reference_optional_policy"
  CHECK ("is_required" = true OR "on_error_policy" <> 'FAIL');
