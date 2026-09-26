-- Monitoreo continuo del modelo (SR 11-7 §V «ongoing monitoring»; CMN 4.557 art. 40).
--
-- Cierra el hueco que la revisión regulatoria dejó identificado: el motor sabía qué decidió y
-- nadie le contaba nunca si acertó, de modo que no había forma de saber si un modelo
-- desplegado seguía funcionando.
--
-- Aditiva. Dos tablas nuevas y nada que cambie de significado en las existentes.

CREATE TYPE "ObservedOutcomeLabel" AS ENUM (
  'GOOD',
  'BAD',
  'REJECTED_WOULD_HAVE_BEEN_GOOD',
  'REJECTED_CONFIRMED_BAD',
  'INDETERMINATE'
);

-- ---------------------------------------------------------------------------
-- 1. Resultado REAL de cada decisión.
--
-- Tabla aparte y no columna de la ejecución: llega meses después, puede corregirse cuando la
-- evidencia cambia, y la ejecución es evidencia regulatoria que no conviene reescribir.
--
-- La unicidad es (ejecución, ventana): el mismo caso se observa a 30, 90 y 180 días porque el
-- comportamiento de un crédito depende del plazo, pero no dos veces la misma ventana.
-- ---------------------------------------------------------------------------
CREATE TABLE "decision_outcome_observation" (
  "id"           BIGSERIAL PRIMARY KEY,
  "tenant_id"    BIGINT NOT NULL,
  "execution_id" BIGINT NOT NULL,
  "window_days"  INTEGER NOT NULL,
  "label"        "ObservedOutcomeLabel" NOT NULL,
  "amount"       DECIMAL(18,4),
  "source"       VARCHAR(120) NOT NULL,
  "notes"        TEXT,
  "observed_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "recorded_by"  VARCHAR(160) NOT NULL,
  CONSTRAINT "decision_outcome_observation_execution_fk"
    FOREIGN KEY ("execution_id") REFERENCES "decision_execution"("id") ON DELETE CASCADE,
  -- Una ventana negativa o absurda haría que el análisis agrupara por un plazo que no existe.
  CONSTRAINT "decision_outcome_observation_window_positive" CHECK ("window_days" > 0)
);

CREATE UNIQUE INDEX "decision_outcome_observation_execution_window_key"
  ON "decision_outcome_observation"("execution_id", "window_days");
CREATE INDEX "decision_outcome_observation_tenant_observed_idx"
  ON "decision_outcome_observation"("tenant_id", "observed_at");

-- ---------------------------------------------------------------------------
-- 2. Atributos conservados SOLO para medir sesgo.
--
-- Para comprobar que un modelo no discrimina hay que saber a qué grupo pertenece cada
-- solicitante, y ese es justo el dato que ECOA §1002.6(b)(9) prohíbe usar al decidir. La
-- salida no es dejar de medir —un modelo que nadie audita por sesgo es peor— sino separar los
-- caminos: esta tabla se escribe DESPUÉS de la decisión, por su propio endpoint, no cuelga del
-- catálogo de variables y por tanto no puede aparecer en un contrato de entrada, y el motor no
-- la lee nunca. Es el mismo criterio con el que Regulation B admite el autoexamen.
-- ---------------------------------------------------------------------------
CREATE TABLE "decision_monitoring_attribute" (
  "id"           BIGSERIAL PRIMARY KEY,
  "tenant_id"    BIGINT NOT NULL,
  "execution_id" BIGINT NOT NULL,
  "attribute"    VARCHAR(80) NOT NULL,
  "group_value"  VARCHAR(80) NOT NULL,
  "recorded_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "recorded_by"  VARCHAR(160) NOT NULL,
  CONSTRAINT "decision_monitoring_attribute_execution_fk"
    FOREIGN KEY ("execution_id") REFERENCES "decision_execution"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "decision_monitoring_attribute_execution_attribute_key"
  ON "decision_monitoring_attribute"("execution_id", "attribute");
CREATE INDEX "decision_monitoring_attribute_tenant_attribute_recorded_idx"
  ON "decision_monitoring_attribute"("tenant_id", "attribute", "recorded_at");

-- RLS con la misma forma que el resto del esquema (20260719080000_tenant_rls_and_app_role).
-- En estas dos tablas importa especialmente: una filtra el desempeño real del modelo de un
-- cliente y la otra la composición demográfica de sus solicitantes.
DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'decision_outcome_observation',
    'decision_monitoring_attribute'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (current_setting(''app.tenant_id'', true) IS NULL OR tenant_id = current_setting(''app.tenant_id'', true)::bigint) WITH CHECK (current_setting(''app.tenant_id'', true) IS NULL OR tenant_id = current_setting(''app.tenant_id'', true)::bigint)',
      target
    );
  END LOOP;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'atlas_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "decision_outcome_observation",
      "decision_monitoring_attribute"
    TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "decision_outcome_observation_id_seq" TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "decision_monitoring_attribute_id_seq" TO atlas_app;
  END IF;
END
$$;
