-- Copia duradera de las imágenes de identidad en el almacén de objetos (MinIO).
--
-- Hasta ahora la cara y las dos caras del carnet vivían sólo en `document_bytes`,
-- `document_back_bytes` y `selfie_bytes`, y esas tres columnas se ponen a NULL en cuanto la
-- ejecución cierra. Era coherente con la privacidad y con que la tabla no creciera, pero
-- significaba que la evidencia sobre la que se decidió no existía al día siguiente.
--
-- Estas tres columnas guardan la CLAVE del objeto en el almacén; los bytes siguen viviendo —y
-- borrándose— exactamente igual que antes.
--
-- Aditiva y sin reescritura de tabla: tres columnas anulables sin valor por defecto. Las
-- ejecuciones existentes quedan en NULL, que es la verdad — sus imágenes ya no están.
ALTER TABLE "decision_identity_verification_run"
  ADD COLUMN "document_object_key"      VARCHAR(512),
  ADD COLUMN "document_back_object_key" VARCHAR(512),
  ADD COLUMN "selfie_object_key"        VARCHAR(512);
