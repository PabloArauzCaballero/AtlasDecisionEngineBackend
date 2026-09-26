-- La huella de cada original guardado, al lado de su clave.
--
-- El protocolo del corpus de identidad lo pide con estas palabras: «Original preservado; SHA256;
-- ningún medio real en Git». Guardábamos el original y la clave, pero no la huella, y sin ella la
-- copia del almacén no se puede contrastar con lo que se subió: si alguien reemplaza un objeto, la
-- fila sigue apuntando al mismo sitio y nada lo delata. Una evidencia que no se puede verificar
-- sostiene una decisión sólo mientras nadie la discuta.
--
-- `input_hash` no sirve para esto: es la huella de las imágenes JUNTO CON las reglas de decisión
-- vigentes —la clave de idempotencia—, así que cambia cuando cambia la calibración y no identifica
-- ningún archivo concreto.
--
-- El almacén ya calculaba estas huellas al escribir y se tiraban. Aditiva y anulable: las
-- ejecuciones anteriores quedan sin huella, que es la verdad —de algunas ni siquiera queda el
-- objeto—.
--
-- Rollback operacional:
--   ALTER TABLE "decision_identity_verification_run"
--     DROP COLUMN "document_sha256", DROP COLUMN "document_back_sha256", DROP COLUMN "selfie_sha256";
--   ALTER TABLE "decision_bank_statement_run" DROP COLUMN "file_sha256";

ALTER TABLE "decision_identity_verification_run"
  ADD COLUMN "document_sha256"      CHAR(64),
  ADD COLUMN "document_back_sha256" CHAR(64),
  ADD COLUMN "selfie_sha256"        CHAR(64);

ALTER TABLE "decision_bank_statement_run"
  ADD COLUMN "file_sha256" CHAR(64);
