-- Triage de documentos y cola de revisión del worker de extractos.
--
-- El defecto que corrige: había UN solo desenlace para todo lo que no terminaba
-- en movimientos —`FAILED`—, así que cuando se quiso derivar los casos ambiguos
-- a una persona no hubo dónde separar el contrato que nadie debía subir del
-- extracto con el encabezado ilegible. Las dos cosas caían en la misma cola, y
-- una cola de revisión con facturas dentro deja de revisarse: cuesta dinero,
-- esconde los casos que sí importan, y hace imposible medir si el motor mejora.
--
-- Tres decisiones que sostienen el resto:
--
-- 1. **`PDF_INVALID` es terminal y NO es «pendiente».** Queda registrado para
--    auditoría, métricas y prevención de abuso, pero fuera de la cola. La lista
--    de pendientes tiene que poder leerse entera.
--
-- 2. **El estado y el motivo son dos columnas.** `status = PENDING_REVIEW` con
--    `review_reason = TIMEOUT` y el mismo estado con `LOW_CONFIDENCE` son el
--    mismo sitio y dos trabajos distintos. Con un solo campo habría que inventar
--    un estado por causa, y el día que aparezca una causa nueva hay que migrar
--    el enum del ciclo de vida entero.
--
-- 3. **Dos confianzas, no una.** `confidence` mide la EXTRACCIÓN —qué tan bien
--    se leyeron los movimientos— y `document_type_confidence` la CLASIFICACIÓN
--    —qué tan seguro es que sea un extracto—. Colapsarlas hacía que «99 % seguro
--    de que es un extracto, 60 % seguro de algunos movimientos» (revisión de
--    extracción) y «2 % de que sea un extracto» (rechazo) se leyeran igual.

-- Los tres estados nuevos los declara `20260816090000_statement_review_status`,
-- en su propia transacción: las restricciones CHECK de más abajo los NOMBRAN, y
-- PostgreSQL prohíbe usar un valor de enum en la transacción que lo añade.

-- ---------------------------------------------------------------------------
-- Motivos
-- ---------------------------------------------------------------------------

CREATE TYPE "StatementReviewReason" AS ENUM (
  'TIMEOUT',
  'LOW_CONFIDENCE',
  'DOUBTFUL_DOCUMENT',
  'UNKNOWN_BANK',
  'PARTIAL_EXTRACTION',
  'AMBIGUOUS_DATA',
  'OCR_ERROR',
  'MANUAL_REQUEST'
);

CREATE TYPE "StatementRejectionReason" AS ENUM (
  'NOT_BANK_STATEMENT',
  'UNSUPPORTED_FILE',
  'EMPTY_DOCUMENT',
  'CORRUPTED_PDF',
  'UNREADABLE_DOCUMENT'
);

-- ---------------------------------------------------------------------------
-- Columnas
-- ---------------------------------------------------------------------------

ALTER TABLE "decision_bank_statement_run"
  ADD COLUMN "document_type_confidence" DECIMAL(4,3),
  ADD COLUMN "review_reason"     "StatementReviewReason",
  ADD COLUMN "rejection_reason"  "StatementRejectionReason",
  ADD COLUMN "review_priority"   INTEGER,
  ADD COLUMN "review_opened_at"  TIMESTAMPTZ(6),
  ADD COLUMN "review_claimed_by" VARCHAR(160),
  ADD COLUMN "review_claimed_at" TIMESTAMPTZ(6),
  ADD COLUMN "review_resolved_by" VARCHAR(160),
  ADD COLUMN "review_resolved_at" TIMESTAMPTZ(6),
  ADD COLUMN "review_notes"      TEXT;

-- La prioridad es un rango cerrado y no un entero libre. Sin la restricción, un
-- cálculo mal hecho ordena la cola con un 0 que se cuela delante de todo y nadie
-- lo nota: la lista sigue pintándose, sólo que mal ordenada.
ALTER TABLE "decision_bank_statement_run"
  ADD CONSTRAINT "decision_bank_statement_run_review_priority_range"
  CHECK ("review_priority" IS NULL OR ("review_priority" >= 1 AND "review_priority" <= 3));

-- Un motivo de revisión sin estado de revisión —o al revés— describe una fila
-- que no puede existir, y es el error que una escritura mal hecha produce en
-- silencio: la fila aparece en la cola sin categoría, o desaparece de ella
-- conservando el motivo. Se comprueba en la base porque hay dos caminos que
-- escriben aquí (el worker y las acciones de revisión) y sólo uno es el sospechoso
-- habitual.
ALTER TABLE "decision_bank_statement_run"
  ADD CONSTRAINT "decision_bank_statement_run_review_reason_matches_status"
  CHECK (
    ("status" IN ('PENDING_REVIEW', 'IN_REVIEW') AND "review_reason" IS NOT NULL)
    OR ("status" NOT IN ('PENDING_REVIEW', 'IN_REVIEW'))
  );

ALTER TABLE "decision_bank_statement_run"
  ADD CONSTRAINT "decision_bank_statement_run_rejection_reason_matches_status"
  CHECK (
    ("status" = 'PDF_INVALID' AND "rejection_reason" IS NOT NULL)
    OR ("status" <> 'PDF_INVALID' AND "rejection_reason" IS NULL)
  );

-- ---------------------------------------------------------------------------
-- Índice de la cola
-- ---------------------------------------------------------------------------
--
-- El orden es el EXACTO en que la pantalla lee: acota por tenant y estado, filtra
-- por la pestaña (el motivo) y ordena por prioridad y antigüedad. Los contadores
-- de cada pestaña salen de un `GROUP BY review_reason` sobre el mismo prefijo, así
-- que no exigen un segundo índice.
CREATE INDEX "decision_bank_statement_run_review_queue_idx"
  ON "decision_bank_statement_run"
  ("tenant_id", "status", "review_reason", "review_priority", "review_opened_at");

COMMENT ON COLUMN "decision_bank_statement_run"."confidence" IS
  'Confianza de la EXTRACCIÓN de movimientos. Ver document_type_confidence para la de clasificación.';
COMMENT ON COLUMN "decision_bank_statement_run"."document_type_confidence" IS
  'Confianza de que el documento SEA un extracto bancario. Decide rechazo, revisión o proceso.';
