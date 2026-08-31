-- Vigencia del extracto y metadatos administrables de la entidad.
--
-- `STALE_PERIOD` es motivo propio y no reutiliza `INSUFFICIENT_PERIOD` aunque
-- los dos hablen del periodo, porque la acción del cliente es la CONTRARIA: al
-- extracto corto le faltan meses hacia atrás y hay que pedir un rango más ancho;
-- al vencido le falta el presente y hay que volver a descargarlo hoy. Con un
-- solo motivo, a quien sube doce meses cerrados en marzo se le pediría «más
-- meses», que es justo lo que no le falta.
ALTER TYPE "StatementRejectionReason" ADD VALUE IF NOT EXISTS 'STALE_PERIOD';

-- El descriptor de SEÑALES ESPERADAS de cada entidad.
--
-- Es la referencia contra la que se mide el parecido de un documento con los
-- extractos que esa entidad emite de verdad, y de ahí sale el porcentaje de
-- coincidencia. Columna propia y no una bolsa genérica de metadatos porque este
-- dato SÍ influye en el desenlace: un parecido alto con un patrón medido sostiene
-- un documento que el análisis del contenedor había dejado en duda. Un dato que
-- decide escondido dentro de un JSON de propósito general no se audita.
--
-- JSONB y no columnas porque el descriptor es una LISTA de señales ponderadas y
-- su forma crece: hoy carátula, columnas y generador; mañana, geometría. Se
-- valida al escribir, contra el esquema de `institution-signals.ts`.
ALTER TABLE "decision_financial_institution"
  ADD COLUMN IF NOT EXISTS "expected_signals" JSONB;

-- Encontrar las entidades que TODAVÍA no tienen descriptor es la consulta con la
-- que se planifica el trabajo de calibración, y sin índice recorre el padrón
-- entero. Parcial porque sólo interesa el lado nulo: las que ya lo tienen se
-- buscan por código.
CREATE INDEX IF NOT EXISTS "decision_financial_institution_sin_descriptor_idx"
  ON "decision_financial_institution" ("tenant_id")
  WHERE "expected_signals" IS NULL;
