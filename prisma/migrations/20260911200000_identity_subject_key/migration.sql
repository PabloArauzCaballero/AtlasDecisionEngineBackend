-- El identificador SEUDÓNIMO del sujeto, puesto por quien revisa.
--
-- Para calibrar hace falta saber qué ejecuciones son de la MISMA persona: las parejas genuinas se
-- construyen dentro de un sujeto y las impostoras entre sujetos distintos. Sin esa agrupación, dos
-- intentos del mismo tester se cuentan como una pareja impostora, y el resultado es una tasa de
-- falsa aceptación inventada —peor que no tener ninguna, porque parece medida—.
--
-- No se deriva del documento a propósito: el número que el motor publica va enmascarado (`••••658`)
-- y con tres dígitos las colisiones entre veinte personas son frecuentes. El protocolo del corpus
-- ya dice cómo se hace: «Consentimiento y ID aleatorio del sujeto o sesión», y la verdad la
-- «etiqueta el operador; jamás por score del worker». Así que lo escribe quien firma el caso.
--
-- Seudónimo y corto (`T-07`): no lleva nombre ni número de cédula, así que la carpeta del corpus
-- no reidentifica a nadie.
--
-- Rollback operacional:
--   DROP INDEX "decision_identity_run_subject_key_idx";
--   ALTER TABLE "decision_identity_verification_run" DROP COLUMN "subject_key";

ALTER TABLE "decision_identity_verification_run"
  ADD COLUMN "subject_key" VARCHAR(64);

CREATE INDEX "decision_identity_run_subject_key_idx"
  ON "decision_identity_verification_run"("tenant_id", "subject_key")
  WHERE "subject_key" IS NOT NULL;
