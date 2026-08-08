-- Propagación del contexto de traza entre procesos (observabilidad distribuida).
--
-- El motor no tiene broker: el trabajo que cruza de la API al proceso worker viaja como FILA
-- en estas cuatro tablas. El contexto de OpenTelemetry vive en el almacenamiento asíncrono del
-- proceso que lo creó y no sobrevive al commit, así que la traza moría exactamente ahí: el
-- worker abría una traza nueva y nada la unía con la petición que originó el trabajo.
--
-- Estas columnas guardan el portador W3C (`traceparent`, y cuando existan `tracestate` y
-- `baggage`) tal como lo produce `propagation.inject`, para que el consumidor pueda continuar
-- la traza del productor.
--
-- Por qué una columna propia y no dentro de `payload_json`: ese JSON es el CONTRATO que ven
-- los consumidores del evento. Meterle metadatos de transporte es un cambio de contrato
-- encubierto, y el primer consumidor que valide estrictamente su forma se rompería.
--
-- ADITIVA Y ANULABLE, sin backfill ni valor por defecto:
--   * Toda fila existente queda con NULL, que es la verdad — no se capturó ningún contexto.
--   * `MessagingTraceService.extract` devuelve el contexto activo ante un portador ausente o
--     malformado, así que el consumidor abre una traza raíz y procesa el trabajo igual.
--   * Un despliegue con la versión anterior del código ignora la columna por completo.
-- La compatibilidad hacia atrás es por construcción, no por una rama especial en el código.
--
-- No lleva índice: nunca se filtra ni se ordena por este valor, sólo se lee junto a la fila
-- que ya se reclamó. Un índice sobre un JSONB que nadie consulta sólo encarece cada escritura.
--
-- Privacidad: el portador contiene identificadores de traza generados por OpenTelemetry.
-- No admite —ni transporta— datos de la solicitud. Ver docs/observability/04-data-privacy-policy.md.

ALTER TABLE "decision_outbox_event"          ADD COLUMN "trace_carrier" JSONB;
ALTER TABLE "decision_test_run"              ADD COLUMN "trace_carrier" JSONB;
ALTER TABLE "decision_semantic_analysis_run" ADD COLUMN "trace_carrier" JSONB;
ALTER TABLE "decision_bank_statement_run"    ADD COLUMN "trace_carrier" JSONB;

COMMENT ON COLUMN "decision_outbox_event"."trace_carrier" IS
  'Portador de traza W3C capturado al publicar. NULL = sin contexto; el relay abre traza raíz.';
COMMENT ON COLUMN "decision_test_run"."trace_carrier" IS
  'Portador de traza W3C capturado al encolar. NULL = sin contexto; el worker abre traza raíz.';
COMMENT ON COLUMN "decision_semantic_analysis_run"."trace_carrier" IS
  'Portador de traza W3C capturado al encolar. NULL = sin contexto; el worker abre traza raíz.';
COMMENT ON COLUMN "decision_bank_statement_run"."trace_carrier" IS
  'Portador de traza W3C capturado al encolar. NULL = sin contexto; el worker abre traza raíz.';
