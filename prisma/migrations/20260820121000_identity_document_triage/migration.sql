-- La puerta de documentos del worker de identidad: rechazar, preguntar, procesar.
--
-- El defecto que corrige: cualquier imagen que el clasificador no supiera nombrar
-- salía por `IDENTITY_DOCUMENT_UNSUPPORTED`, así que la cédula fotografiada de
-- noche y la foto de un recibo recibían la misma respuesta —«ese tipo de
-- documento no está soportado»— y el mismo desenlace: ejecución fallida. A quien
-- tenía una cédula válida se le decía que su cédula no era una cédula, y a quien
-- subió un recibo no se le decía qué había subido.
--
-- Tres decisiones, las mismas que sostienen el triage de extractos:
--
-- 1. **Dos confianzas, no una.** `classification.confidence` (dentro de
--    `result_json`) mide QUÉ tipo de documento es; `document_type_confidence`
--    mide si SIQUIERA es un documento de identidad. Colapsarlas hacía que «es
--    claramente una cédula, no sé si boliviana» y «esto no es un documento» se
--    leyeran igual.
--
-- 2. **Estado y motivo son dos columnas.** El estado dice DÓNDE está el caso; el
--    motivo, QUÉ hay que resolver. Con un solo campo habría que inventar un
--    estado por causa y migrar el ciclo de vida entero cada vez que aparece una.
--
-- 3. **La franja de en medio es la única que pregunta.** Y a quién se pregunta es
--    una decisión de despliegue: `arbitration_mode` deja constancia de si aquel
--    caso lo resolvió una persona o un modelo, porque el día que convivan los dos
--    la única forma de medir cuál acierta más es haberlo anotado en su momento.
--
-- Reversión operacional: las columnas son todas nulables y ningún camino
-- existente las lee, así que revertir es dejar de escribirlas. Para revertir el
-- esquema: DROP de los índices, DROP de las restricciones, DROP COLUMN de las
-- once columnas y DROP TYPE de los dos enums, en ese orden.

-- ---------------------------------------------------------------------------
-- Motivos
-- ---------------------------------------------------------------------------

CREATE TYPE "IdentityReviewReason" AS ENUM (
  -- Se parece a un documento de identidad y las señales no bastaron.
  'DOUBTFUL_DOCUMENT',
  -- Hay evidencia sobrada de que es un documento, pero no se supo cuál.
  'UNRECOGNIZED_DOCUMENT_TYPE',
  -- El parecido biométrico cayó entre los dos umbrales calibrados.
  'AMBIGUOUS_FACE_MATCH',
  -- La captura tiene defectos que no impidieron leer, pero sí decidir.
  'LOW_IMAGE_QUALITY',
  -- El proceso superó su presupuesto de tiempo. El documento sigue siendo válido.
  'TIMEOUT',
  -- Alguien pidió la revisión a mano.
  'MANUAL_REQUEST'
);

CREATE TYPE "IdentityRejectionReason" AS ENUM (
  -- No hay ninguna señal de documento de identidad, o hay evidencia de otro documento.
  'NOT_AN_IDENTITY_DOCUMENT',
  -- ES un documento de identidad, pero no de los que este flujo admite.
  'UNSUPPORTED_DOCUMENT_TYPE',
  -- Se reconocieron señales sueltas y no bastan para afirmar nada.
  'UNREADABLE_DOCUMENT'
);

CREATE TYPE "IdentityArbitrationMode" AS ENUM ('HUMAN', 'AI');

-- ---------------------------------------------------------------------------
-- Columnas
-- ---------------------------------------------------------------------------

ALTER TABLE "decision_identity_verification_run"
  ADD COLUMN "document_type_confidence" DECIMAL(4,3),
  ADD COLUMN "review_reason"      "IdentityReviewReason",
  ADD COLUMN "rejection_reason"   "IdentityRejectionReason",
  ADD COLUMN "arbitration_mode"   "IdentityArbitrationMode",
  ADD COLUMN "review_priority"    INTEGER,
  ADD COLUMN "review_opened_at"   TIMESTAMPTZ(6),
  ADD COLUMN "review_claimed_by"  VARCHAR(160),
  ADD COLUMN "review_claimed_at"  TIMESTAMPTZ(6),
  ADD COLUMN "review_resolved_by" VARCHAR(160),
  ADD COLUMN "review_resolved_at" TIMESTAMPTZ(6),
  ADD COLUMN "review_notes"       TEXT;

-- La prioridad es un rango cerrado y no un entero libre. Sin la restricción, un
-- cálculo mal hecho ordena la cola con un 0 que se cuela delante de todo y nadie
-- lo nota: la lista sigue pintándose, sólo que mal ordenada.
ALTER TABLE "decision_identity_verification_run"
  ADD CONSTRAINT "decision_identity_verification_run_review_priority_range"
  CHECK ("review_priority" IS NULL OR ("review_priority" >= 1 AND "review_priority" <= 3));

-- Un pendiente sin motivo no se puede categorizar, y una cola sin categorías
-- vuelve a ser la tabla gigante que ésta existe para no ser. Se comprueba en la
-- base porque hay dos caminos que escriben aquí —el worker y las acciones de
-- revisión— y sólo uno es el sospechoso habitual.
ALTER TABLE "decision_identity_verification_run"
  ADD CONSTRAINT "decision_identity_verification_run_review_reason_matches_status"
  CHECK (
    ("status" IN ('PENDING_REVIEW', 'IN_REVIEW') AND "review_reason" IS NOT NULL)
    OR ("status" NOT IN ('PENDING_REVIEW', 'IN_REVIEW'))
  );

-- Y su simétrica: un rechazo SIEMPRE dice de qué, y sólo un rechazo lo dice. Es
-- lo que impide que la cola se convierta en el basurero de lo que el motor no
-- entendió.
--
-- El nombre abrevia la tabla («identity_run» en vez de
-- «identity_verification_run») porque el completo suma 65 caracteres y
-- PostgreSQL trunca los identificadores a 63 EN SILENCIO: dos restricciones
-- distintas podrían acabar compartiendo nombre y la segunda fallaría al
-- desplegar sobre una base vacía. `yarn migration:validate` lo comprueba.
ALTER TABLE "decision_identity_verification_run"
  ADD CONSTRAINT "decision_identity_run_rejection_reason_matches_status"
  CHECK (
    ("status" = 'DOCUMENT_REJECTED' AND "rejection_reason" IS NOT NULL)
    OR ("status" <> 'DOCUMENT_REJECTED' AND "rejection_reason" IS NULL)
  );

-- ---------------------------------------------------------------------------
-- Índice de la cola
-- ---------------------------------------------------------------------------
--
-- El orden es el EXACTO en que la pestaña lee: acota por tenant y estado, filtra
-- por motivo y ordena por prioridad y antigüedad. Los contadores de cada pestaña
-- salen de un GROUP BY sobre el mismo prefijo, así que no piden un segundo índice.
CREATE INDEX "decision_identity_verification_run_review_queue_idx"
  ON "decision_identity_verification_run"
  ("tenant_id", "status", "review_reason", "review_priority", "review_opened_at");

COMMENT ON COLUMN "decision_identity_verification_run"."document_type_confidence" IS
  'Confianza de que la imagen SEA un documento de identidad. Decide rechazo, arbitraje o proceso.';
COMMENT ON COLUMN "decision_identity_verification_run"."arbitration_mode" IS
  'Quién arbitró la duda de este caso: HUMAN (bandeja del portal) o AI. Se anota para poder comparar aciertos cuando convivan.';
