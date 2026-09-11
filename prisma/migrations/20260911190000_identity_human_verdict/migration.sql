-- Lo que firmó una PERSONA, en su propia columna.
--
-- `decision` es el veredicto del worker. Cuando un caso va a la cola y alguien lo resuelve, lo que
-- esa persona afirma —«esta selfie es (o no es) del titular de este carnet»— no puede escribirse
-- encima: perdería la única comparación que mide si el worker acierta, y con ella la posibilidad
-- de calibrar sus umbrales contra algo que no sea él mismo.
--
-- Ésta es además la columna que convierte la cola en corpus: `human_decision` es la ETIQUETA, y el
-- protocolo del corpus de identidad exige que la ponga el operador y «jamás por score del worker».
--
-- Aditiva y anulable: las ejecuciones que nadie revisó quedan en NULL, que es la verdad.
-- Rollback operacional:
--   ALTER TABLE "decision_identity_verification_run" DROP COLUMN "human_decision";

ALTER TABLE "decision_identity_verification_run"
  ADD COLUMN "human_decision" VARCHAR(30);

-- Para el exportador del corpus: las etiquetadas son pocas frente al total y se leen enteras.
CREATE INDEX "decision_identity_run_human_decision_idx"
  ON "decision_identity_verification_run"("tenant_id", "human_decision")
  WHERE "human_decision" IS NOT NULL;
