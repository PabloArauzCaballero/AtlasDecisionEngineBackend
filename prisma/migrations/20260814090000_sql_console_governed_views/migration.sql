-- Superficie SQL gobernada para la consola de consultas (ADR-0031).
--
-- Un analista necesita cruzar decisiones con desenlaces sin esperar a que alguien le
-- programe una pantalla. Darle la base entera no es una opción: 98 tablas con PII, la
-- cadena de auditoría y las credenciales de integración. Lo que se le da es ESTO: cinco
-- esquemas de VISTAS de sólo lectura, cada una con las columnas elegidas a mano, en
-- español, y con el tenant ya fijado dentro de la vista.
--
-- Tres decisiones que sostienen la seguridad de todo el módulo:
--
-- 1. **El tenant no es un filtro que el analista escriba, es parte de la vista.** Cada
--    vista lleva `WHERE ... = atlas_current_tenant()`, que lee el GUC `app.tenant_id` que
--    la API fija en la transacción. No hay forma de escribir una consulta que vea otro
--    tenant, porque la columna `tenant_id` ni siquiera se publica. Un `WHERE` olvidado
--    —el defecto clásico de estas consolas— aquí no puede existir.
--
-- 2. **`security_invoker = on`**, igual que las vistas `vw_*` de 20260719100000. Sin él la
--    vista se ejecutaría con los privilegios de su DUEÑO y saltaría la RLS de las tablas
--    base: la vista pasaría de ser una ventana a ser un túnel.
--
-- 3. **Los nombres son un contrato, no un espejo del esquema.** `decisiones.ejecuciones`
--    no es `decision_execution`: renombrar una columna interna no debe romper la consulta
--    guardada de nadie, y al revés, publicar una columna nueva tiene que ser un acto
--    deliberado. Por eso no hay `SELECT *` en ninguna vista.
--
-- Lo que deliberadamente NO se publica, y por qué:
--   · `input_snapshot_json` / `output_json` de las ejecuciones — llevan el dato del
--     solicitante en claro. Quien necesita ver una ejecución concreta tiene `/executions`,
--     que enmascara por rol; agregarlas aquí sería reabrir esa puerta por detrás.
--   · `subject_reference_hash` — es la clave con la que se reidentifica. La consola cuenta
--     sujetos (`subject_id`), no los señala.
--   · `payload_json` de la auditoría, `canonical_payload` y los hashes de la cadena.
--   · Todo el material de `decision_runtime_binding` y las credenciales de integración.

-- ---------------------------------------------------------------------------
-- El tenant de la sesión, resuelto una vez.
-- ---------------------------------------------------------------------------
--
-- Vive en `public` a propósito: con `security_invoker = on` la vista se evalúa con los
-- privilegios de quien consulta, así que ese rol necesita USAGE sobre el esquema de la
-- función. `public` ya lo tiene concedido para los tres roles; un esquema nuevo obligaría
-- a un GRANT más que se olvidaría al provisionar un entorno.
--
-- `STABLE` y no `IMMUTABLE`: el valor es constante dentro de una sentencia —que es lo que
-- el planificador necesita para empujar el filtro hasta el índice— pero cambia entre
-- transacciones. Declararla IMMUTABLE dejaría que el planificador la cachease entre
-- ejecuciones de un plan preparado, que es exactamente cómo un tenant vería a otro.
CREATE OR REPLACE FUNCTION public.atlas_current_tenant() RETURNS bigint
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE
  raw text;
BEGIN
  raw := nullif(current_setting('app.tenant_id', true), '');
  IF raw IS NULL THEN
    -- Falla la consulta entera en vez de devolver cero filas. Un resultado vacío se lee
    -- como «no hay datos» y se reporta como un hallazgo de negocio; un error con nombre
    -- se lee como lo que es: la consulta se emitió fuera de una transacción con tenant.
    RAISE EXCEPTION 'ATLAS_SQL_TENANT_NOT_SET: la consulta debe ejecutarse con app.tenant_id fijado'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN raw::bigint;
END;
$$;

COMMENT ON FUNCTION public.atlas_current_tenant() IS
  'Tenant de la transacción en curso. Cada vista de la consola SQL filtra por esta función.';

-- ---------------------------------------------------------------------------
-- Los cinco datasets.
-- ---------------------------------------------------------------------------
--
-- Un esquema por dataset, y no un prefijo en el nombre de la vista, porque es lo que
-- permite acotar el `search_path` de la sesión a exactamente estos cinco: cualquier
-- relación fuera de ellos deja de ser nombrable sin calificar, y calificar lo bloquea la
-- guardia léxica del módulo.
CREATE SCHEMA IF NOT EXISTS decisiones;
CREATE SCHEMA IF NOT EXISTS catalogo;
CREATE SCHEMA IF NOT EXISTS desenlaces;
CREATE SCHEMA IF NOT EXISTS riesgo;
CREATE SCHEMA IF NOT EXISTS auditoria;

COMMENT ON SCHEMA decisiones IS 'Qué decidió el motor, cuándo, con qué versión y por qué.';
COMMENT ON SCHEMA catalogo  IS 'Las piezas con las que se decide: artefactos, versiones, variables y motivos.';
COMMENT ON SCHEMA desenlaces IS 'Qué pasó DESPUÉS de decidir: créditos, ventanas de observación y desenlaces.';
COMMENT ON SCHEMA riesgo    IS 'Bajo qué condiciones se deja operar: cartera, límites y degradación del modelo.';
COMMENT ON SCHEMA auditoria IS 'Quién hizo qué: eventos firmados y despliegues.';

-- ---------------------------------------------------------------------------
-- decisiones
-- ---------------------------------------------------------------------------

CREATE VIEW decisiones.ejecuciones AS
SELECT
  e.id                                        AS ejecucion_id,
  e.request_id                                AS peticion,
  e.correlation_id                            AS correlacion,
  a.artifact_code                             AS artefacto,
  a.name                                      AS artefacto_nombre,
  a.risk_domain                               AS dominio_de_riesgo,
  a.decision_kind                             AS tipo_de_decision,
  v.version_number                            AS version,
  v.semantic_version                          AS version_semantica,
  env.code                                    AS entorno,
  env.is_production                           AS es_produccion,
  e.decision_status                           AS estado,
  e.business_outcome                          AS desenlace_de_negocio,
  e.duration_ms                               AS duracion_ms,
  e.degraded_inputs                           AS entradas_degradadas,
  e.subject_id                                AS sujeto_id,
  e.subject_absence_reason                    AS motivo_sin_sujeto,
  e.executed_at                               AS ejecutada_en
FROM decision_execution e
JOIN decision_artifact_version v ON v.id = e.artifact_version_id
JOIN decision_artifact a ON a.id = v.artifact_id
JOIN decision_environment env ON env.id = e.environment_id
WHERE e.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW decisiones.ejecuciones IS
  'Una fila por decisión tomada. Sin la entrada ni la salida en claro: para eso está /executions, que enmascara por rol.';

CREATE VIEW decisiones.pasos AS
SELECT
  s.execution_id                              AS ejecucion_id,
  s.step_order                                AS orden,
  n.node_key                                  AS nodo,
  n.node_type                                 AS tipo_de_nodo,
  n.label                                     AS nodo_etiqueta,
  n.is_terminal                               AS es_terminal,
  s.branch_taken                              AS rama_tomada,
  s.duration_us                               AS duracion_us
FROM decision_execution_step s
JOIN decision_execution e ON e.id = s.execution_id
JOIN decision_rule_node n ON n.id = s.node_id
WHERE e.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW decisiones.pasos IS
  'El recorrido por el grafo, nodo a nodo. `evaluation_result_json` no se publica: lleva los valores evaluados.';

CREATE VIEW decisiones.motivos AS
SELECT
  r.execution_id                              AS ejecucion_id,
  c.reason_code                               AS codigo,
  c.category                                  AS categoria,
  c.severity                                  AS severidad,
  c.is_adverse_action                         AS es_accion_adversa,
  r.priority                                  AS prioridad
FROM decision_execution_reason r
JOIN decision_execution e ON e.id = r.execution_id
JOIN decision_reason_code c ON c.id = r.reason_code_id
WHERE e.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW decisiones.motivos IS
  'Por qué se decidió así. `rendered_message` no se publica: el mensaje ya interpolado puede llevar datos del solicitante.';

CREATE VIEW decisiones.errores AS
SELECT
  x.execution_id                              AS ejecucion_id,
  x.error_code                                AS codigo,
  x.error_type                                AS tipo,
  x.retryable                                 AS reintentable
FROM decision_execution_error x
JOIN decision_execution e ON e.id = x.execution_id
WHERE e.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW decisiones.errores IS
  'Fallos durante la ejecución. Sin `error_message` ni `details_json`: ambos pueden citar el valor que falló.';

-- ---------------------------------------------------------------------------
-- catalogo
-- ---------------------------------------------------------------------------

CREATE VIEW catalogo.artefactos AS
SELECT
  a.id                                        AS artefacto_id,
  a.artifact_code                             AS codigo,
  a.name                                      AS nombre,
  a.artifact_type                             AS tipo,
  a.decision_kind                             AS tipo_de_decision,
  a.risk_domain                               AS dominio_de_riesgo,
  a.owner_team                                AS equipo_responsable,
  a.is_active                                 AS activo,
  a.created_at                                AS creado_en,
  a.updated_at                                AS actualizado_en
FROM decision_artifact a
WHERE a.tenant_id = public.atlas_current_tenant();

CREATE VIEW catalogo.versiones AS
SELECT
  v.id                                        AS version_id,
  a.artifact_code                             AS artefacto,
  v.version_number                            AS version,
  v.semantic_version                          AS version_semantica,
  v.status                                    AS estado,
  v.legal_basis                               AS base_legal,
  v.validated_by                              AS validada_por,
  v.validated_at                              AS validada_en,
  v.revalidation_due_at                       AS revalidacion_vence_en,
  v.created_by                                AS creada_por,
  v.created_at                                AS creada_en,
  v.approved_at                               AS aprobada_en,
  v.retired_at                                AS retirada_en
FROM decision_artifact_version v
JOIN decision_artifact a ON a.id = v.artifact_id
WHERE a.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW catalogo.versiones IS
  'Ciclo de vida de cada versión. `revalidacion_vence_en` es la columna con la que se encuentra un modelo operando fuera de su licitud vigente.';

CREATE VIEW catalogo.variables AS
SELECT
  d.id                                        AS variable_id,
  d.variable_code                             AS codigo,
  d.canonical_name                            AS nombre,
  d.data_classification                       AS clasificacion,
  d.sensitivity_class                         AS sensibilidad,
  d.lifecycle_state                           AS ciclo_de_vida,
  d.decision_use_restriction                  AS restriccion_de_uso,
  d.owner_team                                AS equipo_responsable,
  d.is_sensitive                              AS es_sensible,
  d.is_active                                 AS activa
FROM decision_variable_definition d
WHERE d.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW catalogo.variables IS
  'El catálogo de variables. `restriccion_de_uso` distingue la que no puede entrar en una decisión de la que sí.';

CREATE VIEW catalogo.motivos AS
SELECT
  c.id                                        AS motivo_id,
  c.reason_code                               AS codigo,
  c.category                                  AS categoria,
  c.severity                                  AS severidad,
  c.is_adverse_action                         AS es_accion_adversa,
  c.is_active                                 AS activo,
  c.public_message                            AS mensaje_publico
FROM decision_reason_code c
WHERE c.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW catalogo.motivos IS
  'Catálogo de códigos de motivo. Se publica `mensaje_publico` —es el que ve el solicitante— y no `internal_message`.';

-- ---------------------------------------------------------------------------
-- desenlaces
-- ---------------------------------------------------------------------------

CREATE VIEW desenlaces.creditos AS
SELECT
  f.id                                        AS credito_id,
  f.subject_id                                AS sujeto_id,
  f.origination_execution_id                  AS ejecucion_de_originacion,
  f.principal_amount                          AS principal,
  f.currency_code                             AS moneda,
  f.term_months                                AS plazo_meses,
  f.annual_rate                               AS tasa_anual,
  f.disbursed_at                              AS desembolsado_en,
  f.closed_at                                 AS cerrado_en,
  f.created_at                                AS creado_en
FROM credit_facility f
WHERE f.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW desenlaces.creditos IS
  'Créditos originados. `external_reference` no se publica: es la referencia con la que el negocio identifica a la persona.';

CREATE VIEW desenlaces.observaciones AS
SELECT
  o.id                                        AS observacion_id,
  o.execution_id                              AS ejecucion_id,
  o.facility_id                               AS credito_id,
  o.window_days                               AS ventana_dias,
  o.label                                     AS desenlace,
  o.amount                                    AS monto,
  o.source                                    AS origen,
  o.inference_method                          AS metodo_de_inferencia,
  o.observed_at                               AS observado_en,
  o.recorded_by                               AS registrado_por
FROM decision_outcome_observation o
WHERE o.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW desenlaces.observaciones IS
  'El desenlace observado de cada decisión. Es la tabla contra la que se mide si el modelo acierta.';

CREATE VIEW desenlaces.ventanas AS
SELECT
  w.id                                        AS ventana_id,
  w.execution_id                              AS ejecucion_id,
  w.facility_id                               AS credito_id,
  w.window_days                               AS ventana_dias,
  w.due_at                                    AS vence_en,
  w.observed_at                               AS observada_en,
  (w.observed_at IS NULL AND w.due_at < now()) AS vencida_sin_observar
FROM outcome_window_schedule w
WHERE w.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW desenlaces.ventanas IS
  'Ventanas de observación. `vencida_sin_observar` es la cola de trabajo de /decision-quality, ya calculada.';

-- ---------------------------------------------------------------------------
-- riesgo
-- ---------------------------------------------------------------------------

CREATE VIEW riesgo.evaluaciones AS
SELECT
  m.id                                        AS evaluacion_id,
  a.artifact_code                             AS artefacto,
  v.version_number                            AS version,
  m.metric_code                               AS metrica,
  m.scope                                     AS alcance,
  m.value                                     AS valor,
  m.threshold                                 AS umbral,
  m.verdict                                   AS veredicto,
  m.sample_size                               AS tamano_muestra,
  m.evaluated_at                              AS evaluada_en
FROM monitoring_evaluation m
JOIN decision_artifact_version v ON v.id = m.artifact_version_id
JOIN decision_artifact a ON a.id = v.artifact_id
WHERE m.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW riesgo.evaluaciones IS
  'Degradación del modelo medida contra su umbral. `tamano_muestra` va al lado del valor a propósito: un veredicto sobre 12 casos no es el mismo hecho que uno sobre 12.000.';

CREATE VIEW riesgo.cartera AS
SELECT
  p.as_of                                     AS al_dia,
  p.metric_code                               AS metrica,
  nullif(p.segment, '')                       AS segmento,
  p.value                                     AS valor,
  p.recorded_by                               AS registrado_por
FROM portfolio_state p
WHERE p.tenant_id = public.atlas_current_tenant();

CREATE VIEW riesgo.limites AS
SELECT
  l.limit_code                                AS codigo,
  nullif(l.segment, '')                       AS segmento,
  l.max_value                                 AS valor_maximo,
  l.currency_code                             AS moneda,
  l.enforced                                  AS bloquea,
  l.is_active                                 AS activo,
  l.created_by                                AS creado_por,
  l.created_at                                AS creado_en
FROM exposure_limit l
WHERE l.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW riesgo.limites IS
  '`bloquea` distingue el límite que RECHAZA del que sólo mide. Verlos iguales hace creer que la cartera está protegida cuando lo único que hay es un número guardado.';

-- ---------------------------------------------------------------------------
-- auditoria
-- ---------------------------------------------------------------------------

CREATE VIEW auditoria.eventos AS
SELECT
  a.id                                        AS evento_id,
  a.event_type                                AS tipo,
  a.aggregate_type                            AS entidad_tipo,
  a.aggregate_id                              AS entidad_id,
  a.actor_id                                  AS actor,
  a.request_id                                AS peticion,
  a.occurred_at                               AS ocurrido_en
FROM decision_audit_event a
WHERE a.tenant_id = public.atlas_current_tenant();

COMMENT ON VIEW auditoria.eventos IS
  'La bitácora firmada, sin el payload ni los hashes. Se consulta QUÉ pasó y cuándo; verificar la cadena es /audit/chain/verify, que es donde esa comprobación significa algo.';

CREATE VIEW auditoria.despliegues AS
SELECT
  d.id                                        AS despliegue_id,
  a.artifact_code                             AS artefacto,
  v.version_number                            AS version,
  env.code                                    AS entorno,
  env.is_production                           AS es_produccion,
  d.deployment_mode                           AS modo,
  d.deployment_status                         AS estado,
  d.is_active                                 AS activo,
  d.effective_from                            AS vigente_desde,
  d.effective_to                              AS vigente_hasta,
  d.deployed_by                               AS desplegado_por,
  d.deployed_at                               AS desplegado_en,
  (d.rollback_of_deployment_id IS NOT NULL)   AS es_reversion
FROM decision_deployment d
JOIN decision_artifact_version v ON v.id = d.artifact_version_id
JOIN decision_artifact a ON a.id = v.artifact_id
JOIN decision_environment env ON env.id = d.environment_id
WHERE a.tenant_id = public.atlas_current_tenant();

-- ---------------------------------------------------------------------------
-- `security_invoker` en las dieciséis, sin excepción.
-- ---------------------------------------------------------------------------
--
-- Se listan una a una y no con un bucle sobre `pg_views`: un bucle habría cubierto
-- también cualquier vista futura que alguien añadiera a estos esquemas sin pensar en
-- esto, y la propiedad que aquí importa es que CADA vista publicada haya sido una
-- decisión escrita. La prueba `sql-console-views.spec.ts` verifica que ninguna vista de
-- los cinco esquemas se quede sin ella.
ALTER VIEW decisiones.ejecuciones   SET (security_invoker = on);
ALTER VIEW decisiones.pasos         SET (security_invoker = on);
ALTER VIEW decisiones.motivos       SET (security_invoker = on);
ALTER VIEW decisiones.errores       SET (security_invoker = on);
ALTER VIEW catalogo.artefactos      SET (security_invoker = on);
ALTER VIEW catalogo.versiones       SET (security_invoker = on);
ALTER VIEW catalogo.variables       SET (security_invoker = on);
ALTER VIEW catalogo.motivos         SET (security_invoker = on);
ALTER VIEW desenlaces.creditos      SET (security_invoker = on);
ALTER VIEW desenlaces.observaciones SET (security_invoker = on);
ALTER VIEW desenlaces.ventanas      SET (security_invoker = on);
ALTER VIEW riesgo.evaluaciones      SET (security_invoker = on);
ALTER VIEW riesgo.cartera           SET (security_invoker = on);
ALTER VIEW riesgo.limites           SET (security_invoker = on);
ALTER VIEW auditoria.eventos        SET (security_invoker = on);
ALTER VIEW auditoria.despliegues    SET (security_invoker = on);

-- ---------------------------------------------------------------------------
-- La bitácora de la consola.
-- ---------------------------------------------------------------------------
--
-- Se crea aquí y no en su propia migración porque no tiene sentido por separado: es la
-- contrapartida de auditoría de la superficie que esta misma migración abre. Desplegar una
-- sin la otra deja, en un sentido, una consola sin registro; en el otro, una tabla que
-- nadie escribe.
CREATE TABLE "sql_console_query_log" (
  "id"             BIGSERIAL PRIMARY KEY,
  "tenant_id"      BIGINT       NOT NULL,
  "actor_id"       VARCHAR(160) NOT NULL,
  "request_id"     VARCHAR(120),
  "statement"      TEXT         NOT NULL,
  "relations"      TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "outcome"        VARCHAR(20)  NOT NULL,
  "error_code"     VARCHAR(60),
  "row_count"      INTEGER,
  "duration_ms"    INTEGER,
  "estimated_rows" BIGINT,
  "truncated"      BOOLEAN      NOT NULL DEFAULT false,
  "executed_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "sql_console_query_log_tenant_id_executed_at_idx"
  ON "sql_console_query_log" ("tenant_id", "executed_at");
CREATE INDEX "sql_console_query_log_tenant_id_actor_id_executed_at_idx"
  ON "sql_console_query_log" ("tenant_id", "actor_id", "executed_at");

-- Una bitácora que su propio autor puede reescribir no es una bitácora. Mismo trato que
-- `decision_audit_event`: se inserta y se lee, nunca se corrige.
REVOKE UPDATE, DELETE, TRUNCATE ON "sql_console_query_log" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON "sql_console_query_log" FROM atlas_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_writer') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON "sql_console_query_log" FROM atlas_writer';
  END IF;
END
$$;

ALTER TABLE "sql_console_query_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sql_console_query_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "sql_console_query_log";
CREATE POLICY tenant_isolation ON "sql_console_query_log"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- ---------------------------------------------------------------------------
-- Privilegios: USAGE sobre los datasets y SELECT sobre las vistas. Nada más.
-- ---------------------------------------------------------------------------
--
-- El bloque comprueba que el rol exista antes de concederle nada: los entornos de
-- desarrollo comparten la conexión de escritura y no tienen `atlas_reader`, y una
-- migración que fallara ahí dejaría la base a medias por una diferencia de topología que
-- no cambia nada de lo que esta migración afirma.
DO $$
DECLARE
  target text;
  dataset text;
BEGIN
  FOREACH target IN ARRAY ARRAY['atlas_reader', 'atlas_sql_console'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target) THEN CONTINUE; END IF;
    FOREACH dataset IN ARRAY ARRAY['decisiones', 'catalogo', 'desenlaces', 'riesgo', 'auditoria'] LOOP
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', dataset, target);
      EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', dataset, target);
      -- Sin esto, una vista añadida por una migración posterior nace invisible para la
      -- consola y el síntoma es «esa tabla no existe» sobre algo que sí existe.
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO %I', dataset, target);
    END LOOP;
  END LOOP;
END
$$;
