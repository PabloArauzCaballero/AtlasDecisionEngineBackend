# ADR-0027 — Tecnología de mensajería: conservar el outbox transaccional sobre PostgreSQL

- **Estado:** Aceptada
- **Fecha:** 2026-08-04
- **Contexto de la decisión:** auditoría integral de dockerización y mensajería
- **Reemplaza a:** nada. Formaliza una decisión que estaba implícita en el código desde
  `decision_outbox_event` y que nunca se había contrastado por escrito con las alternativas.

## Contexto

El sistema ya reparte eventos de dominio de forma asíncrona. Lo hace sin broker dedicado:

| Pieza | Dónde vive |
| --- | --- |
| Tabla de salida transaccional | `decision_outbox_event` (`prisma/schema.prisma`) |
| Tabla de deduplicación (inbox) | `decision_processed_event`, única por `(consumer_name, outbox_event_id)` |
| Repartidor | `src/modules/outbox-relay/outbox-relay.service.ts` |
| Orquestador de trabajos | `src/common/jobs/job-scheduler.service.ts` |
| Despertar por señal | `pg_notify` → `src/common/jobs/job-signal.service.ts` |
| Bus en proceso | `src/common/events/event-bus.ts` |

La reclamación de trabajo es `SELECT … FOR UPDATE SKIP LOCKED` más un *lease* con caducidad, de
modo que N réplicas del worker no procesan la misma fila. Los reintentos usan retroceso
exponencial sobre `available_at` y, agotados `OUTBOX_MAX_ATTEMPTS` (8 por defecto), la fila
pasa a `status = DEAD`, que es la cola de mensajes fallidos de este diseño.

La pregunta que obliga a escribir este documento no es «¿funciona?» sino «¿es esto lo que
debería estar aquí, o es lo que había?». La auditoría pedía comparar contra RabbitMQ, Kafka,
NATS JetStream, Redis Streams, BullMQ y un servicio administrado.

## Volumen real, que es lo que decide

Ninguna comparación de brokers significa nada sin la carga. La de este sistema:

- **Productores de eventos de dominio:** decisiones ejecutadas, despliegues, aprobaciones,
  revisiones y notificaciones. Todos nacen de una escritura en PostgreSQL dentro de una
  transacción de negocio.
- **Consumidores:** el bus en proceso, que alimenta notificaciones y auditoría. **No hay ningún
  consumidor fuera de este servicio.** Ni otro equipo, ni otro lenguaje, ni otro despliegue.
- **Orden de magnitud:** decenas a cientos de eventos por minuto en el pico previsto, no
  decenas de miles por segundo. Un motor de decisiones de crédito está acotado por las
  solicitudes de crédito que existen, y esa cifra la fija el negocio, no la infraestructura.
- **Latencia aceptable:** segundos. Nada de lo que se reparte por aquí está en el camino
  síncrono de una decisión; si lo estuviera, sería un fallo de diseño distinto.

## Alternativas evaluadas

Ponderación elegida antes de puntuar, para no ajustar los pesos al resultado deseado. Los dos
primeros criterios pesan el doble porque son los que producen incidentes en este sistema
concreto: perder un evento de dominio rompe la trazabilidad regulatoria, y no hay equipo de
plataforma dedicado a operar un broker.

| Criterio | Peso | Outbox + PostgreSQL | RabbitMQ | Kafka | NATS JetStream | Redis Streams / BullMQ | SQS administrado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Atomicidad con la escritura de negocio | ×2 | 5 | 2 | 2 | 2 | 1 | 2 |
| Coste operativo (sin equipo de plataforma) | ×2 | 5 | 3 | 1 | 3 | 4 | 5 |
| Garantía de entrega | ×1 | 5 | 4 | 5 | 4 | 3 | 4 |
| Rendimiento en el volumen real | ×1 | 4 | 5 | 5 | 5 | 5 | 4 |
| Reintentos y DLQ | ×1 | 4 | 5 | 3 | 4 | 4 | 5 |
| Observabilidad con lo ya instalado | ×1 | 5 | 3 | 2 | 3 | 3 | 2 |
| Encaje con el stack actual | ×1 | 5 | 3 | 2 | 3 | 4 | 2 |
| Portabilidad / independencia del proveedor | ×1 | 5 | 4 | 4 | 4 | 4 | 1 |
| **Total ponderado (máx. 60)** | | **53** | **39** | **32** | **37** | **37** | **35** |

### Por qué la atomicidad decide

Es el criterio que descarta a todos los brokers para *este* caso, y conviene ser explícito.

Con un broker externo, guardar la decisión y publicar el evento son dos sistemas distintos.
Entre el `COMMIT` y el `publish` cabe un fallo, y quedan dos finales posibles: una decisión
registrada cuyo evento nunca se emitió, o un evento emitido de una decisión que se revirtió.
Evitarlo exige... escribir primero en una tabla de salida y repartir después. Es decir: **el
patrón outbox es obligatorio de todas formas**, y añadir un broker no lo sustituye, lo pone
detrás. Se pagarían dos sistemas para obtener la garantía que ya da uno.

La regla del enunciado —«Evita actualizar la base de datos y publicar un mensaje como
operaciones separadas sin protección»— apunta exactamente aquí, y este diseño ya la cumple.

### Notas por alternativa

- **RabbitMQ.** Enrutado y DLQ excelentes, y sería la primera opción si hubiera consumidores
  externos. No los hay. Añade un servicio con estado, su cola de espejo, su política de
  memoria y su interfaz administrativa que proteger.
- **Kafka.** Resuelve un problema que este sistema no tiene: retención de un registro de
  eventos de alto volumen releíble por varios consumidores. El coste operativo es el más alto
  de la tabla y el volumen no lo justifica ni de lejos.
- **NATS JetStream.** Ligero y buen candidato técnico, pero el equipo no tiene experiencia con
  él y seguiría necesitando el outbox por la atomicidad. Complejidad nueva sin problema nuevo
  resuelto.
- **Redis Streams / BullMQ.** La tentación obvia: **Redis ya está desplegado**. Se descarta a
  propósito y es la decisión menos evidente de este documento. La instancia actual está
  configurada con `maxmemory` y `noeviction` porque guarda contadores de límite de tasa y caché
  por tenant. Meter ahí la cola mezcla dos cargas con requisitos de durabilidad opuestos: la
  caché *quiere* poder desalojar, la cola *nunca* debe perder un elemento. Con `noeviction`,
  llenar la memoria con trabajos encolados hace que empiecen a fallar las escrituras de caché y
  de límite de tasa — un problema de mensajería que se manifiesta como un fallo de
  autenticación. Separarlo exigiría una segunda instancia de Redis, y entonces la ventaja de
  «ya está desplegado» desaparece.
- **SQS u otro administrado.** El menor coste operativo de todos, pero ata el sistema a un
  proveedor y deja de funcionar en el Compose local, donde se desarrolla y se prueba. Tampoco
  elimina el outbox.

## Decisión

**Se conserva el outbox transaccional sobre PostgreSQL. No se introduce ningún broker.**

Justificación en una frase: el único consumidor vive dentro de este proceso, el volumen cabe
holgado en la base de datos que ya se opera, y la garantía que importa —que un evento y el
hecho de negocio que lo origina se confirmen juntos o no se confirme ninguno— solo la da el
outbox, con broker o sin él.

## Qué resuelve

- Atomicidad real: el evento se escribe en la misma transacción que el hecho de negocio.
- Deduplicación en el consumidor mediante `decision_processed_event` (patrón inbox), con
  restricción única como garantía última frente a la concurrencia.
- Reintentos con retroceso exponencial y DLQ (`status = DEAD`) sin reintentos infinitos.
- Escalado horizontal de consumidores con `FOR UPDATE SKIP LOCKED` + *lease*.
- Latencia baja sin sondeo agresivo: `pg_notify` despierta al repartidor en el commit y el
  sondeo queda como garantía de fondo.
- Una sola tecnología con estado que respaldar, restaurar, monitorizar y actualizar.

## Qué limitaciones conserva

Son reales y no se maquillan:

1. **Techo de rendimiento.** El repartidor es un sondeo transaccional sobre una tabla. En el
   orden de las decenas de miles de mensajes por segundo, PostgreSQL deja de ser el sitio.
2. **Sin abanico a consumidores externos.** No hay suscripción para otro servicio. Añadir uno
   exige exportar desde el relay.
3. **La tabla crece.** `decision_outbox_event` necesita purga de las filas `DISPATCHED`; hoy la
   purga cubre idempotencia de runtime, no el outbox histórico. *Riesgo registrado.*
4. **Sin prioridades entre tipos de evento.** Todos comparten cola y se ordenan por
   `available_at`. Un lote grande retrasa a los demás.
5. **Sin ordenación garantizada por agregado.** `SKIP LOCKED` con N réplicas puede repartir dos
   eventos del mismo agregado en desorden. Hoy ningún consumidor depende del orden; si alguno
   llegara a depender, hay que particionar por `aggregate_id`.

## Cuándo habría que migrar

Disparadores concretos y medibles, para que la decisión de migrar no dependa de una impresión.
Los tres primeros se vigilan con alertas ya definidas en `docker/observability/alerts.yml`:

- `atlas_outbox_pending` se sostiene por encima de **5 000** en operación normal.
- El repartidor no drena una ráfaga en menos de **5 minutos** de forma repetida.
- El relay pasa de forma sostenida del **30 %** de la capacidad de escritura de la base.
- Aparece **un consumidor fuera de este servicio** (otro equipo, otro lenguaje, un socio).
- Se hace necesaria la **ordenación estricta por agregado** o las **prioridades por tipo**.

El destino natural en ese punto sería RabbitMQ **detrás** del outbox, no en su lugar: el relay
pasaría a publicar al broker en vez de al bus en proceso, y la garantía de atomicidad seguiría
siendo de la tabla. Es un cambio localizado en `outbox-relay.service.ts`, que es justo por lo
que esta decisión no es una trampa difícil de revertir.

## Coste operativo

Cero servicios adicionales. El respaldo del outbox es el respaldo de la base
(`scripts/backup.sh`); su monitorización son tres métricas que la aplicación ya publica
(`atlas_outbox_pending`, `atlas_outbox_dispatched_total`, `atlas_outbox_dead_total`); su
recuperación es la de PostgreSQL. Un broker habría añadido un servicio con estado más al
inventario de respaldo, de alertas y de actualizaciones.

## Despliegue

Idéntico en desarrollo y producción, que es una propiedad de esta decisión y no una
casualidad: no hay un componente que exista solo en un entorno, así que no hay una clase de
fallo que solo aparezca en producción. El reparto lo ejecuta el proceso `worker`
(`WORKER_ROLE=WORKER`), separado de la API desde ADR-0021 y escalable con
`docker compose up --scale worker=N`.

## Referencias

- Topología, contrato del mensaje y flujo completo:
  [arquitectura event-driven](../event-driven-architecture.md)
- Reparto de trabajos de fondo y despertar por `LISTEN`/`NOTIFY`:
  [orquestación de workers](../worker-orchestration.md)
- Inventario de contenedores, redes y riesgos: [docker/architecture.md](../docker/architecture.md)
- Separación de roles API/worker: [ADR-0021](ADR-0021-worker-role-separation.md)
- Workers absorbidos y sus colas: [ADR-0026](ADR-0026-additional-workers-integration.md)
- Alertas implementadas sobre estas métricas: `docker/observability/alerts.yml`
