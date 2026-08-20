-- Datos de prueba para casar documentos con artefactos.
--
-- Resuelve dos cosas que impedían probar la pantalla «Documentos PDF»:
--
--  1. NINGÚN contrato de salida sembrado tenía `example_json`. Los tres seeders que crean
--     contratos rellenan código, nombre, origen y motivos de ausencia, pero nunca el ejemplo
--     — y el ejemplo es justo de donde sale el dato de prueba. «Rellenar con datos del
--     artefacto» no fallaba: es que la fuente estaba vacía en toda la base.
--
--  2. No había con qué ejercitar cada rama de la comprobación. Un solo artefacto compatible
--     demuestra que la pantalla pinta verde; no demuestra que sepa rechazar.
--
-- Es un seeder de DESARROLLO. Los artefactos que crea abajo no tienen grafo compilado: existen
-- para ejercitar el vínculo documental, no para ejecutar decisiones. Por eso viven aquí y no en
-- `src/modules/seeding/`, que es lo que se despliega.
--
-- Idempotente: se puede correr las veces que haga falta.
--
--   docker exec -i atlas-decision-engine-postgres-1 \
--     psql -U atlas_app -d atlas_decision < prisma/dev-seeds/seed-pdf-artifact-binding.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ejemplos para los contratos que YA existen.
--    Los valores son verosímiles y del tipo que el campo publica: un ejemplo que
--    no encaja con su propio contrato es peor que ninguno, porque el formulario
--    lo copia y el motor lo rechaza.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE decision_output_contract_field f SET example_json = e.valor
FROM (VALUES
  ('decision_afordabilidad',      '"APROBADO"'::jsonb),
  ('dti_publicado',               '0.28'::jsonb),
  ('motivo_afordabilidad',        '"Relación cuota/ingreso dentro del umbral (0,28 frente a 0,35)."'::jsonb),
  ('collections_priority_score',  '782'::jsonb),
  ('collections_strategy',        '"GESTION_TELEFONICA"'::jsonb),
  ('confianza_extracto',          '0.94'::jsonb),
  ('decision_extracto',           '"ACEPTADO"'::jsonb),
  ('ingreso_verificado',          '12480.75'::jsonb),
  ('motivo_extracto',             '"Los movimientos conciliados cubren 6 de los 6 meses exigidos."'::jsonb)
) AS e(codigo, valor)
WHERE f.field_code = e.codigo;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Artefactos que cubren CADA rama de la comprobación de compatibilidad.
--
--    Todos se contrastan contra `generic-result-report`, cuyo contrato exige
--    `title` (string) y `sections` (array), y admite `subtitle`, `summary`,
--    `notices` y `signatures` como opcionales.
-- ─────────────────────────────────────────────────────────────────────────────

WITH tenant AS (SELECT MIN(tenant_id) AS id FROM decision_artifact),
nuevos(codigo, nombre, proposito, estado, version) AS (VALUES
  -- Publica title y sections con los tipos correctos: la pareja SIRVE.
  ('PDF_DEMO_COMPATIBLE',   'Demo · artefacto compatible',
   'Publica exactamente lo que el informe genérico exige.', 'DEPLOYED_TO_TEST', '1.0.0'),
  -- Le falta `sections`, que es obligatorio: la pareja NO sirve.
  ('PDF_DEMO_FALTA_CAMPO',  'Demo · falta un campo obligatorio',
   'Publica el título pero no las secciones que el informe exige.', 'DEPLOYED_TO_TEST', '1.0.0'),
  -- Publica `title` como número: el tipo no encaja.
  ('PDF_DEMO_TIPO_DISTINTO','Demo · tipo incompatible',
   'Publica el título como número, no como texto.', 'DEPLOYED_TO_TEST', '1.0.0'),
  -- Publica un enum más ancho que el que admite el documento.
  ('PDF_DEMO_ENUM_ANCHO',   'Demo · enum más ancho que el documento',
   'Puede emitir un valor que el documento no sabe pintar.', 'DEPLOYED_TO_TEST', '1.0.0'),
  -- Sus campos vienen de expresiones: el motor no puede resolver el tipo.
  ('PDF_DEMO_TIPO_DESCONOCIDO','Demo · tipo irresoluble',
   'Sus campos salen de expresiones, así que el tipo no está declarado.', 'DEPLOYED_TO_TEST', '1.0.0')
),
art AS (
  INSERT INTO decision_artifact
    (tenant_id, artifact_code, artifact_type, name, description, owner_team,
     business_purpose, risk_domain, decision_kind, is_active, created_at, updated_at)
  SELECT t.id, n.codigo, 'DECISION_FLOW', n.nombre, n.proposito, 'plataforma',
         n.proposito, 'CREDIT', 'ORIGINATION', true, now(), now()
  FROM nuevos n CROSS JOIN tenant t
  ON CONFLICT (tenant_id, artifact_code) DO UPDATE SET updated_at = now()
  RETURNING id, artifact_code
)
-- `decision_artifact_version` NO lleva `tenant_id` —lo hereda del artefacto— y sí
-- exige `created_by`, que es quien responde de la versión.
INSERT INTO decision_artifact_version
  (artifact_id, version_number, status, semantic_version, lock_version, created_by, created_at)
SELECT a.id, 1, n.estado::"VersionStatus", n.version, 1, 'dev-seed', now()
FROM art a
JOIN nuevos n ON n.codigo = a.artifact_code
ON CONFLICT DO NOTHING;

-- Campos de salida de los artefactos de demostración.
WITH v AS (
  -- El tenant lo lleva el ARTEFACTO, no la versión.
  SELECT ver.id, a.tenant_id, a.artifact_code
  FROM decision_artifact_version ver
  JOIN decision_artifact a ON a.id = ver.artifact_id
  WHERE a.artifact_code LIKE 'PDF_DEMO_%'
),
campos(artefacto, codigo, nombre, origen, ref, ejemplo, mapeo) AS (VALUES
  ('PDF_DEMO_COMPATIBLE', 'title',    'Título del informe', 'NODE', 'titulo_informe',
   '"Resultado de la evaluación de riesgo"'::jsonb, NULL::jsonb),
  ('PDF_DEMO_COMPATIBLE', 'sections', 'Secciones', 'NODE', 'secciones_informe',
   '[{"title":"Identificación","fields":[{"label":"Solicitante","value":"María José Núñez Peñaranda"}]}]'::jsonb, NULL::jsonb),
  ('PDF_DEMO_COMPATIBLE', 'subtitle', 'Subtítulo', 'NODE', 'subtitulo_informe',
   '"Evaluación automática · expediente 4821"'::jsonb, NULL::jsonb),

  ('PDF_DEMO_FALTA_CAMPO', 'title', 'Título del informe', 'NODE', 'titulo_informe',
   '"Informe sin secciones"'::jsonb, NULL::jsonb),

  ('PDF_DEMO_TIPO_DISTINTO', 'title',    'Título (como número)', 'NODE', 'puntaje_modelo',
   '782'::jsonb, NULL::jsonb),
  ('PDF_DEMO_TIPO_DISTINTO', 'sections', 'Secciones', 'NODE', 'secciones_informe',
   '[{"title":"Detalle"}]'::jsonb, NULL::jsonb),

  ('PDF_DEMO_ENUM_ANCHO', 'title',    'Título del informe', 'NODE', 'titulo_informe',
   '"Informe con veredicto"'::jsonb, NULL::jsonb),
  ('PDF_DEMO_ENUM_ANCHO', 'sections', 'Secciones', 'NODE', 'secciones_informe',
   '[{"title":"Veredicto"}]'::jsonb, NULL::jsonb),
  -- El mapeo de valores es lo que publica el conjunto cerrado. `DERIVADO` es el
  -- valor de más: el documento no lo admite y la comprobación tiene que verlo.
  ('PDF_DEMO_ENUM_ANCHO', 'decision', 'Veredicto', 'NODE', 'decision_final',
   '"APPROVED"'::jsonb,
   '{"1":"APPROVED","2":"REJECTED","3":"REVIEW","4":"DERIVADO"}'::jsonb),

  ('PDF_DEMO_TIPO_DESCONOCIDO', 'title',    'Título (desde expresión)', 'EXPRESSION', 'concat(prefijo, folio)',
   '"Informe calculado"'::jsonb, NULL::jsonb),
  ('PDF_DEMO_TIPO_DESCONOCIDO', 'sections', 'Secciones (desde expresión)', 'EXPRESSION', 'construir_secciones()',
   '[{"title":"Bloque"}]'::jsonb, NULL::jsonb)
)
INSERT INTO decision_output_contract_field
  (tenant_id, artifact_version_id, field_code, name, description, source_kind, source_ref,
   semantic_role, value_mapping_json, absence_reasons, example_json, contract_version,
   sensitivity_class, trace_policy, created_at, updated_at)
SELECT v.tenant_id, v.id, c.codigo, c.nombre, c.nombre,
       c.origen::"OutputSourceKind", c.ref, 'NONE'::"OutputSemanticRole", c.mapeo,
       ARRAY[]::text[], c.ejemplo, '1', 'INTERNAL'::"SensitivityClass",
       'FULL'::"TracePolicy", now(), now()
FROM campos c JOIN v ON v.artifact_code = c.artefacto
ON CONFLICT (artifact_version_id, field_code) DO UPDATE
  SET example_json = EXCLUDED.example_json,
      value_mapping_json = EXCLUDED.value_mapping_json,
      source_kind = EXCLUDED.source_kind,
      source_ref = EXCLUDED.source_ref,
      updated_at = now();

COMMIT;

-- Resumen de lo que quedó sembrado.
SELECT a.artifact_code, v.semantic_version, v.status,
       count(f.id) AS campos, count(f.example_json) AS con_ejemplo
FROM decision_artifact a
JOIN decision_artifact_version v ON v.artifact_id = a.id
JOIN decision_output_contract_field f ON f.artifact_version_id = v.id
GROUP BY a.artifact_code, v.semantic_version, v.status
ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Variables detrás de los artefactos de demostración.
--
-- Sin esto, los tres casos que deben RECHAZARSE salían compatibles. El contrato
-- de salida no guarda el tipo: lo hereda de la variable que produce el valor
-- (`source_ref`). Si esa variable no existe, el motor responde `unknown` y la
-- comprobación lo trata como advertencia —«no se pudo comprobar»— en vez de como
-- error. Correcto por su parte; lo flojo eran los datos de prueba.
--
-- Con las variables sembradas y su `data_type` declarado, cada caso discrimina.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

WITH tenant AS (SELECT MIN(tenant_id) AS id FROM decision_artifact),
vars(codigo, nombre, tipo) AS (VALUES
  ('titulo_informe',    'Título del informe',        'STRING'),
  ('subtitulo_informe', 'Subtítulo del informe',     'STRING'),
  ('secciones_informe', 'Secciones del informe',     'ARRAY'),
  -- El caso del tipo incompatible: el documento espera texto en `title` y esta
  -- variable publica un número.
  -- INTEGER y no NUMBER: `score` del informe crediticio se declara entero, y un
  -- decimal no cabe ahí. Con NUMBER el rechazo llegaba por el tipo del puntaje y
  -- tapaba el caso que este artefacto existe para probar — el enum más ancho.
  ('puntaje_modelo',    'Puntaje del modelo',        'INTEGER'),
  ('decision_final',    'Veredicto de la decisión',  'ENUM'),
  ('nombre_solicitante','Nombre del solicitante',    'STRING')
),
def AS (
  INSERT INTO decision_variable_definition
    (tenant_id, variable_code, canonical_name, business_description, data_classification,
     owner_team)
  SELECT t.id, v.codigo, v.nombre, v.nombre, 'INTERNAL', 'plataforma'
  FROM vars v CROSS JOIN tenant t
  ON CONFLICT (tenant_id, variable_code) DO UPDATE SET canonical_name = EXCLUDED.canonical_name
  RETURNING id, variable_code
)
INSERT INTO decision_variable_version (variable_definition_id, version_number, data_type)
SELECT d.id, 1, v.tipo
FROM def d JOIN vars v ON v.codigo = d.variable_code
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El caso del enum va contra `credit-analysis-report`, no contra el genérico.
--
-- El informe genérico no tiene ningún campo `decision`, así que ahí ese artefacto
-- nunca podía fallar por el enum: el campo simplemente sobraba. El documento que
-- SÍ declara `decision` —con tres valores— es el de análisis crediticio.
-- ─────────────────────────────────────────────────────────────────────────────

WITH v AS (
  SELECT ver.id, a.tenant_id FROM decision_artifact_version ver
  JOIN decision_artifact a ON a.id = ver.artifact_id
  WHERE a.artifact_code = 'PDF_DEMO_ENUM_ANCHO'
),
campos(codigo, nombre, ref, ejemplo, mapeo) AS (VALUES
  ('customerName', 'Nombre del solicitante', 'nombre_solicitante',
   '"María José Núñez Peñaranda"'::jsonb, NULL::jsonb),
  ('score', 'Puntaje', 'puntaje_modelo', '782'::jsonb, NULL::jsonb)
)
INSERT INTO decision_output_contract_field
  (tenant_id, artifact_version_id, field_code, name, description, source_kind, source_ref,
   semantic_role, value_mapping_json, absence_reasons, example_json, contract_version,
   sensitivity_class, trace_policy, created_at, updated_at)
SELECT v.tenant_id, v.id, c.codigo, c.nombre, c.nombre, 'NODE'::"OutputSourceKind", c.ref,
       'NONE'::"OutputSemanticRole", c.mapeo, ARRAY[]::text[], c.ejemplo, '1',
       'INTERNAL'::"SensitivityClass", 'FULL'::"TracePolicy", now(), now()
FROM campos c CROSS JOIN v
ON CONFLICT (artifact_version_id, field_code) DO UPDATE
  SET example_json = EXCLUDED.example_json, source_ref = EXCLUDED.source_ref, updated_at = now();

COMMIT;
