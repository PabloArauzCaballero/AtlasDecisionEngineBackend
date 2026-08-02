# Mantenimiento

## Tareas periódicas

| Tarea | Cadencia | Cómo |
| --- | --- | --- |
| Auditoría de dependencias | Semanal (CI) | `yarn security:audit`, CodeQL, Trivy |
| Prueba de restauración | Mensual | [Recuperación ante desastres](disaster-recovery.md) |
| Revisión de accesos | Trimestral | Clientes, scopes, tenants, credenciales sin uso |
| Verificación de la cadena de auditoría | Continua | `GET /v1/audit/chain/verify` por tenant |
| Revisión de eventos muertos | Continua, por alerta | `atlas_outbox_dead_total` |
| Actualización del grafo de conocimiento | Tras cambios de código | `graphify update .` |
| Regeneración de la documentación | En cada PR (CI) | `yarn docs:validate` |

## Tareas automáticas

Ya corren solas; conviene saber que existen:

| Tarea | Dónde | Cadencia |
| --- | --- | --- |
| Purga de idempotencia | Proceso `WORKER` | `RUNTIME_RETENTION_SWEEP_INTERVAL_MS` (1 h) |
| Despacho del outbox | Proceso `WORKER` | `OUTBOX_RELAY_INTERVAL_MS` (1 s) |
| Recuperación de corridas con lease vencido | Proceso `WORKER` | Cada sondeo |
| Reintento de auditoría de accesos | Proceso que atiende HTTP | `ACCESS_AUDIT_RETRY_SECONDS` |

## Ventanas de mantenimiento

La mayoría de las tareas **no** requieren ventana:

| Operación | ¿Requiere ventana? |
| --- | --- |
| Desplegar la API | No (rolling) |
| Desplegar el worker | No (`Recreate`, con acumulación transitoria en el outbox) |
| Migración compatible | No |
| Migración destructiva (*contract*) | **Sí** |
| Rotar la clave de auditoría | No, si se conserva la anterior para verificar |
| Restaurar desde respaldo | **Sí** |

## Rotaciones

| Secreto | Impacto |
| --- | --- |
| API keys | Rotar y resembrar; la anterior queda **invalidada** — coordine con el integrador |
| `AUDIT_HASH_SECRET` | Ver [gestión de secretos](../security/secrets-management.md); conserve la anterior para verificar |
| `METRICS_TOKEN` | Actualice también el scrapeador |
| `APP_DB_PASSWORD` | `set-app-db-role.mjs` y luego la `DATABASE_URL` de las réplicas |

## Higiene de datos

- **Nunca** borre filas de auditoría: no se puede (permisos revocados) y no se debe.
- Las corridas de QA y sus contraejemplos se conservan: son la reproducibilidad.
- Las ejecuciones no tienen purga automática; se archivan (no se borran) a los 7 años desde
  `executedAt` ([ADR-0025](../adr/ADR-0025-execution-archival-threshold.md)). El job periódico
  que ejecuta ese archivado es trabajo de ingeniería de seguimiento.

## Deuda registrada

| Deuda | Estado |
| --- | --- |
| ~~Operaciones sin esquema de cuerpo de respuesta~~ | **Cerrado 2026-07-31**: 0/109, trinquete en fallo duro |
| ~~Prueba de concurrencia del sidecar sensible al reloj~~ | **Cerrada 2026-07-31**: compara la dispersión de los finales contra la duración de una ejecución, ambas de la **misma** corrida, así que la carga del equipo se cancela |
| Prueba del portal sensible a la carga | Pendiente; vive en el repositorio del frontend |
| Job de archivado de ejecuciones | Umbral decidido ([ADR-0025](../adr/ADR-0025-execution-archival-threshold.md)); falta escribir el job periódico |
| Particionado temporal de tablas de alto volumen | Decisión documentada de **no** hacerlo hoy |

Ver [análisis de brechas](../reports/documentation-gap-analysis.md).
