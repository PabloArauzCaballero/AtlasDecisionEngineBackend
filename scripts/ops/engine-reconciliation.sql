-- Consultas de conciliación del ensayo de restore del motor (P-17). Una fila «clave|valor» por
-- control; la base ORIGEN y la RESTAURADA deben dar exactamente las mismas filas. `md5:` resume el
-- contenido completo de cada tabla. Se ejecuta como UNA sola sentencia.
SELECT k || '|' || v FROM (
  SELECT 'filas:decision_execution' AS k, count(*)::text AS v FROM decision_execution
  UNION ALL SELECT 'md5:decision_execution', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_execution x
  UNION ALL SELECT 'filas:decision_execution_step' AS k, count(*)::text AS v FROM decision_execution_step
  UNION ALL SELECT 'md5:decision_execution_step', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_execution_step x
  UNION ALL SELECT 'filas:decision_execution_variable' AS k, count(*)::text AS v FROM decision_execution_variable
  UNION ALL SELECT 'md5:decision_execution_variable', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_execution_variable x
  UNION ALL SELECT 'filas:decision_execution_reason' AS k, count(*)::text AS v FROM decision_execution_reason
  UNION ALL SELECT 'md5:decision_execution_reason', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_execution_reason x
  UNION ALL SELECT 'filas:decision_runtime_idempotency' AS k, count(*)::text AS v FROM decision_runtime_idempotency
  UNION ALL SELECT 'md5:decision_runtime_idempotency', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_runtime_idempotency x
  UNION ALL SELECT 'filas:decision_subject' AS k, count(*)::text AS v FROM decision_subject
  UNION ALL SELECT 'md5:decision_subject', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_subject x
  UNION ALL SELECT 'filas:subject_consent' AS k, count(*)::text AS v FROM subject_consent
  UNION ALL SELECT 'md5:subject_consent', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM subject_consent x
  UNION ALL SELECT 'filas:credit_facility' AS k, count(*)::text AS v FROM credit_facility
  UNION ALL SELECT 'md5:credit_facility', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM credit_facility x
  UNION ALL SELECT 'filas:outcome_window_schedule' AS k, count(*)::text AS v FROM outcome_window_schedule
  UNION ALL SELECT 'md5:outcome_window_schedule', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM outcome_window_schedule x
  UNION ALL SELECT 'filas:decision_outcome_observation' AS k, count(*)::text AS v FROM decision_outcome_observation
  UNION ALL SELECT 'md5:decision_outcome_observation', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_outcome_observation x
  UNION ALL SELECT 'filas:decision_outbox_event' AS k, count(*)::text AS v FROM decision_outbox_event
  UNION ALL SELECT 'md5:decision_outbox_event', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_outbox_event x
  UNION ALL SELECT 'filas:decision_processed_event' AS k, count(*)::text AS v FROM decision_processed_event
  UNION ALL SELECT 'md5:decision_processed_event', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_processed_event x
  UNION ALL SELECT 'filas:decision_notification' AS k, count(*)::text AS v FROM decision_notification
  UNION ALL SELECT 'md5:decision_notification', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_notification x
  UNION ALL SELECT 'filas:decision_audit_event' AS k, count(*)::text AS v FROM decision_audit_event
  UNION ALL SELECT 'md5:decision_audit_event', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_audit_event x
  UNION ALL SELECT 'filas:decision_artifact_version' AS k, count(*)::text AS v FROM decision_artifact_version
  UNION ALL SELECT 'md5:decision_artifact_version', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_artifact_version x
  UNION ALL SELECT 'filas:decision_deployment' AS k, count(*)::text AS v FROM decision_deployment
  UNION ALL SELECT 'md5:decision_deployment', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_deployment x
  UNION ALL SELECT 'filas:integration_client' AS k, count(*)::text AS v FROM integration_client
  UNION ALL SELECT 'md5:integration_client', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM integration_client x
  UNION ALL SELECT 'filas:exposure_limit' AS k, count(*)::text AS v FROM exposure_limit
  UNION ALL SELECT 'md5:exposure_limit', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM exposure_limit x
  UNION ALL SELECT 'filas:decision_manual_review_case' AS k, count(*)::text AS v FROM decision_manual_review_case
  UNION ALL SELECT 'md5:decision_manual_review_case', coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM decision_manual_review_case x
  UNION ALL SELECT 'ejecuciones_por_desenlace:'||(coalesce(business_outcome,'-')||'/'||decision_status::text), count(*)::text FROM decision_execution GROUP BY coalesce(business_outcome,'-')||'/'||decision_status::text
  UNION ALL SELECT 'idempotencia_por_estado:'||status::text, count(*)::text FROM decision_runtime_idempotency GROUP BY status::text
  UNION ALL SELECT 'consentimientos_por_estado:'||(CASE WHEN revoked_at IS NULL THEN 'VIGENTE' ELSE 'REVOCADO' END), count(*)::text FROM subject_consent GROUP BY (CASE WHEN revoked_at IS NULL THEN 'VIGENTE' ELSE 'REVOCADO' END)
  UNION ALL SELECT 'outbox_por_estado:'||status::text, count(*)::text FROM decision_outbox_event GROUP BY status::text
  UNION ALL SELECT 'creditos_por_moneda:'||currency_code, count(*)||' / '||sum(principal_amount) FROM credit_facility GROUP BY currency_code
  UNION ALL SELECT 'ventanas_por_estado:'||(CASE WHEN observed_at IS NULL THEN 'PENDIENTE' ELSE 'OBSERVADA' END), count(*)::text FROM outcome_window_schedule GROUP BY (CASE WHEN observed_at IS NULL THEN 'PENDIENTE' ELSE 'OBSERVADA' END)
  UNION ALL SELECT 'desenlaces_por_etiqueta:'||label::text, count(*)::text FROM decision_outcome_observation GROUP BY label::text
  UNION ALL SELECT 'claves_con_mas_de_una_ejecucion', count(*)::text FROM (SELECT tenant_id, idempotency_key FROM decision_execution GROUP BY 1, 2 HAVING count(*) > 1) d
  UNION ALL SELECT 'creditos_sin_ejecucion', count(*)::text FROM credit_facility f LEFT JOIN decision_execution e ON e.id = f.origination_execution_id WHERE e.id IS NULL
  UNION ALL SELECT 'secuencia:decision_outbox_event_id_seq', last_value::text FROM decision_outbox_event_id_seq
) controles
ORDER BY 1;
