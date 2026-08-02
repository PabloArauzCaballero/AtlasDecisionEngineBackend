# Semántica de entrega

## Al menos una vez

La entrega es **at-least-once**, no exactly-once. Es una consecuencia inevitable del diseño y
conviene entender por qué:

El relay reclama un lote, lo emite y marca las filas como despachadas. Si el proceso muere
entre emitir y marcar, el lease vence y otro relay vuelve a emitir el mismo evento. La
alternativa —marcar antes de emitir— perdería eventos ante el mismo fallo, y perder es peor
que repetir.

**El consumidor debe deduplicar.** El proyector de notificaciones lo hace con
`decision_processed_event`: un evento ya procesado se descarta.

## Reclamo atómico

```sql
SELECT ... FOR UPDATE SKIP LOCKED
```

más un lease (`OUTBOX_LEASE_MS`, 30 s). Consecuencias:

- N réplicas del relay pueden correr sin doble despacho.
- Una réplica que muere a mitad de lote no bloquea nada: sus filas vuelven a ser reclamables al vencer el lease.
- No hace falta coordinación externa ni un líder elegido.

## Orden

**No se garantiza el orden global.** Con varias réplicas y reintentos con retroceso, un evento
que falló se despacha después de otros posteriores.

Lo que sí se conserva: cada evento lleva su `occurredAt` y su agregado, de modo que un
consumidor que necesite orden lo reconstruye por agregado. Si necesita orden estricto, debe
tratarlo explícitamente, no asumirlo.

## Configuración

| Variable | Por defecto | Qué controla |
| --- | --- | --- |
| `OUTBOX_RELAY_ENABLED` | `true` | Interruptor del relay |
| `OUTBOX_RELAY_INTERVAL_MS` | 1000 | Cadencia del sondeo |
| `OUTBOX_BATCH_SIZE` | 25 | Filas por lote |
| `OUTBOX_MAX_ATTEMPTS` | 8 | Intentos antes de dar el evento por muerto |
| `OUTBOX_LEASE_MS` | 30000 | Duración de la reserva |

El relay **drena el backlog en lotes sucesivos** dentro de un mismo ciclo, no un lote por
intervalo: una ráfaga de eventos no tarda `backlog/lote` ciclos en despejarse.

## Dónde corre

Solo en procesos con `WORKER_ROLE` igual a `WORKER` o `ALL`. Si todo se despliega con rol
`API`, **nadie drena el outbox** y la tabla crece en silencio mientras la API sigue
respondiendo. Vigile `atlas_outbox_pending`.

## Apagado

`onModuleDestroy` cancela el temporizador y **espera al sondeo en vuelo**. Sin esa espera, el
apagado derribaba el pool de Prisma por debajo del sondeo y el último registro de cada parada
limpia era un `error` que no era un error — justo el ruido que entrena a un operador para
ignorar el logger.
