# Runbook operativo

## Despliegue seguro

1. Construir una imagen inmutable etiquetada con versión y commit.
2. Ejecutar `prisma migrate deploy` como Job separado.
3. Verificar `/health/live` y `/health/ready`.
4. Ejecutar smoke tests con credenciales técnicas de alcance mínimo.
5. Habilitar tráfico gradualmente y observar error rate, p95/p99 y `NO_DECISION`.
6. Registrar evidencia de despliegue, checksum y aprobaciones.

## Incidente: readiness falla

- Consultar logs por `requestId`, métricas de DB/Redis y pool.
- No reiniciar repetidamente sin identificar la dependencia fallida.
- Si una migración falló, bloquear la API y aplicar el runbook de base de datos.
- Si Redis falla en producción, el servicio debe permanecer no listo para evitar idempotencia/rate-limit inconsistentes.

## Incidente: la ruta de lectura degrada al primario

Síntoma: `atlas_database_fallback_total` deja de ser cero, o
`atlas_database_connection_failures_total{connection="postgres-read"}` sube.

- Consultar `GET /health/data-sources`: dice qué conexión está caída y qué regla la usa.
  No expone host ni usuario, así que es seguro compartirlo en el canal del incidente.
- Buscar en los logs el evento `read_path_fallback`: lleva módulo, operación, conexión de
  origen, motivo, duración y `requestId`. El fallback **nunca** es silencioso.
- Comprobar el pool: `atlas_database_pool_connections{connection="postgres-read"}` con
  `waiting` sostenido significa que el pool va justo, no que la base esté caída.
- Mitigación inmediata sin desplegar: `DATA_READ_ROUTING_ENABLED=false` y reiniciar. Toda
  la lectura vuelve al primario. Si el primario no puede absorberla, hay que escalarlo
  antes de apagar el interruptor.
- Si la conexión de lectura no vuelve, vaciar `DATABASE_READ_URL`: el registro detecta la
  huella idéntica y reutiliza el pool de escritura.
- Detalle: [consistencia, transacciones y fallos](../data/persistence/consistency-and-failure.md).

## Incidente: el arranque falla por configuración de datos

El contenedor no levanta y el log nombra un módulo, una conexión o una capacidad. Es
intencionado: una ruta de datos imposible debe verse al arrancar, no en la primera petición.

- `unknown connection "…"` → una regla de `DATA_ROUTING_RULES` nombra una conexión que no
  existe. Vaciar la variable devuelve las reglas base.
- `registered as read-only` → hay una escritura enrutada a la conexión de lectura.
- `reserved for migrations and provisioning` → una regla intenta usar `postgres-admin`.
- `requires … which "…" does not provide` → el módulo exige una capacidad que su motor no
  tiene (por ejemplo `rowLevelSecurity` fuera de PostgreSQL).
- `read connection's database role holds write privileges` → reejecutar
  `yarn db:provision:dev`; el rol lector conserva DML de alguna tabla.
- Ningún mensaje de estos contiene secretos; se pueden pegar íntegros en el ticket.

## Incidente: aumento de 401, 403 o 429

- Consultar `decision_access_audit` por status, recurso, IP y ventana temporal.
- Correlacionar por `requestId` con logs estructurados.
- Verificar revocaciones, expiraciones, audience y tenants autorizados del cliente.
- No habilitar `x-roles` ni `x-principal-id` como mitigación: esos headers no son una fuente de identidad.
- Rotar o suspender la credencial afectada si hay indicios de abuso.

Si PostgreSQL no está disponible, la respuesta de seguridad continúa y la falla de persistencia queda en stdout; recuperar el evento requiere la plataforma externa de logs.

## Incidente: incremento de NO_DECISION

- Segmentar por artefacto, versión, ambiente y reason/error code.
- Revisar disponibilidad de variables externas y cambios recientes.
- Suspender o revertir el deployment si el umbral acordado se supera.
- Preservar trazas y no modificar eventos históricos.

## Incidente: ruptura de cadena de auditoría

- Declarar incidente de integridad.
- Congelar rotaciones o limpiezas que afecten evidencia.
- Exportar snapshot de solo lectura y hashes.
- Investigar escrituras directas, restauraciones o manipulación de datos.
- No “reparar” hashes sin proceso formal y evidencia del incidente.

## Rollback de aplicación

El rollback de imagen no revierte automáticamente el schema. Las migraciones deben ser backward-compatible. Para cambios destructivos usar patrón expand/contract y una ventana posterior de limpieza.

## Falla del sink de archivo

La aplicación siempre escribe a stdout. Si `LOG_OUTPUT=stdout_and_file` no puede abrir `LOG_FILE_PATH`, emite el error por stderr y continúa. Corrija permisos o el volumen; no reinicie repetidamente el proceso.

## Cola acumulada

Alerta `AtlasOutboxBacklogGrowing`: `min_over_time(atlas_outbox_pending[10m]) > 500`. El suelo
del pendiente no baja, así que no es una ráfaga: nadie está drenando al ritmo de entrada.

1. **Confirmar que hay quien reparta.** El fallo más frecuente no es de capacidad:

   ```bash
   docker compose ps worker
   docker compose logs worker | grep "worker started"
   ```

   La línea de arranque registra qué trabajos quedaron activos. Si no aparece `outbox-relay`,
   el proceso está vivo y verde **sin repartir nada** — revise `WORKER_ROLE` (debe ser `WORKER`
   o `ALL`, nunca `API`) y `OUTBOX_RELAY_ENABLED`.

2. **Medir el reparto**, no solo el pendiente:

   ```promql
   rate(atlas_outbox_dispatched_total[5m])
   ```

   En cero con pendiente alto ⇒ el relay no corre o falla en cada intento; mire `last_error`.

3. **Ver dónde se atasca:**

   ```sql
   SELECT status, count(*), min(available_at), max(attempt_count)
   FROM decision_outbox_event GROUP BY status;
   ```

   Muchos `PENDING` con `available_at` en el futuro ⇒ están en retroceso exponencial tras
   fallar; la causa está en `last_error`, no en la capacidad.

4. **Escalar solo si el reparto es sano y aun así no da abasto:**

   ```bash
   docker compose up -d --scale worker=3
   ```

   Antes de escalar, compruebe el pool: `WORKER_DATABASE_POOL_MAX` × N réplicas +
   `API_DATABASE_POOL_MAX` × réplicas de API debe caber en `max_connections`. Los trabajos
   reclaman con `FOR UPDATE SKIP LOCKED` + *lease*, así que N réplicas no duplican trabajo.

Si el backlog se sostiene por encima de 5 000 en operación normal, deja de ser un incidente y
pasa a ser el disparador de migración documentado en
[ADR-0027](../adr/ADR-0027-messaging-technology-selection.md).

## DLQ creciendo

Alerta `AtlasOutboxDeadLetter`: `increase(atlas_outbox_dead_total[15m]) > 0`. Se alerta con el
**primer** evento muerto, no a partir de un umbral: un evento de dominio perdido en silencio es
exactamente el fallo que el patrón outbox existe para impedir.

1. **Ver qué murió y por qué:**

   ```sql
   SELECT id, event_type, aggregate_type, aggregate_id, attempt_count, last_error, occurred_at
   FROM decision_outbox_event
   WHERE status = 'DEAD'
   ORDER BY occurred_at DESC LIMIT 50;
   ```

2. **Clasificar por `last_error`.** El repartidor no distingue transitorio de permanente
   (limitación conocida, R4), así que un fallo transitorio prolongado también llega aquí.

   - Causa externa ya resuelta (indisponibilidad, contención) ⇒ reprocesable.
   - Payload que ningún reintento arregla ⇒ **no** reencolar sin corregir el origen; volvería
     a morir tras otros 8 intentos.

3. **Reprocesar** solo tras entender la causa. Devuelve la fila a la cola con el contador a
   cero. Acote siempre por `id`; nunca lance un `UPDATE` sobre todo `status = 'DEAD'`:

   ```sql
   UPDATE decision_outbox_event
   SET status = 'PENDING', attempt_count = 0, available_at = now(),
       lease_expires_at = NULL, locked_by = NULL, last_error = NULL
   WHERE id IN (:ids);
   ```

   El consumidor es idempotente (`decision_processed_event`, único por
   `(consumer_name, outbox_event_id)`), así que reprocesar un evento que ya se había aplicado
   no duplica su efecto: se descarta al chocar con la restricción única.

4. **Verificar** que baja `atlas_outbox_pending` y que no reaparecen en `DEAD`.

## Worker detenido

Alerta `AtlasBackgroundJobStalled`: `time() - atlas_job_last_success_timestamp_seconds > 900`.
Es una sonda de latido, no un contador — un contador que deja de crecer es indistinguible de
uno que nunca tuvo trabajo. Detecta el caso que un health check de proceso **no** ve: el
contenedor está sano y no procesa nada.

1. `docker compose ps worker` — ¿vivo? ¿reiniciando?
2. `docker compose logs --tail=200 worker` — busque excepciones repetidas y la línea de
   arranque con la lista de trabajos registrados.
3. `curl -s http://127.0.0.1:3001/health/ready` — `checks.jobSignal` dice `listening`,
   `polling` o `disabled`. En `polling` la latencia sube al intervalo de sondeo pero el trabajo
   avanza; no es causa de reinicio.
4. Compruebe el pool de PostgreSQL: un worker sin conexiones libres se queda esperando sin
   fallar de forma visible.
5. Reinicio controlado, que drena los trabajos en vuelo dentro del `stop_grace_period` de 60 s:

   ```bash
   docker compose restart worker
   ```

   Un trabajo interrumpido vuelve a la cola cuando vence su *lease*; no se pierde ni se
   confirma a medias.

## API caída

Alertas `AtlasApiErrorRateHigh`, `AtlasApiLatencyP95High` y `AtlasTargetDown`.

1. **Distinga «caída» de «sonda lenta».** Un `unhealthy` con la API respondiendo 200 es un
   problema de la sonda, no del servicio:

   ```bash
   docker inspect atlas-decision-engine-api-1 --format '{{json .State.Health}}'
   ```

   `Health check exceeded timeout` ⇒ vea
   [diagnóstico de problemas](../getting-started/troubleshooting.md).

2. `curl -s http://127.0.0.1:3000/health/ready` — `checks` señala la dependencia concreta
   (`database`, `cache`). No reinicie en bucle sin identificarla.
3. Con `AtlasTargetDown` y la API atendiendo tráfico, el problema puede ser solo el raspado:
   revise `METRICS_TOKEN` y que Prometheus esté en la red `atlas_app`.
4. Si la causa es un despliegue reciente, aplique [rollback](#rollback-de-aplicacion) — el
   rollback de imagen **no** revierte el esquema.
