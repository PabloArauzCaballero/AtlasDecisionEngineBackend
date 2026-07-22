-- Notas explicativas de autoría a nivel de versión de artefacto (para el grafo).
-- Columna aditiva y nullable: no reescribe la tabla ni afecta datos existentes.
ALTER TABLE "decision_artifact_version" ADD COLUMN "authoring_notes" TEXT;
