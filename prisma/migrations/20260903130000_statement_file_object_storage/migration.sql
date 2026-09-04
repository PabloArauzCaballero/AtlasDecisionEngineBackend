-- Copia duradera del extracto bancario en el almacén de objetos (MinIO).
--
-- Va en una migración APARTE de la de identidad, aunque sean el mismo cambio conceptual y del
-- mismo día, porque aquélla ya se aplicó en el VPS. Prisma identifica cada migración por el
-- nombre de su carpeta: ampliar una ya aplicada no la vuelve a ejecutar, y renombrarla la
-- convierte en una migración «nueva» que reintentaría un ALTER ya hecho y moriría con
-- "column already exists". Dos carpetas es lo correcto, no una duplicación.
--
-- `file_bytes` se pone a NULL al cerrar la ejecución, así que el documento sobre el que se calculó
-- la capacidad de pago desaparecía, y con él la posibilidad de rehacer el cálculo o de sostenerlo
-- ante una impugnación.
--
-- Aditiva y sin reescritura de tabla: una columna anulable sin valor por defecto.
ALTER TABLE "decision_bank_statement_run"
  ADD COLUMN "file_object_key" VARCHAR(512);
