# Fase 8 — Catálogo de spans de negocio

Spans creados **a mano** por el motor. Los técnicos —HTTP, Express, PostgreSQL, Redis,
`fetch`— los produce la instrumentación automática y no se listan aquí.

## Criterio de inclusión

Se instrumenta una operación cuando **no se entiende mirando sólo los spans técnicos**. Una
decisión de crédito es media docena de consultas y una llamada externa: sin un span que diga
«esto es una evaluación del artefacto BNPL en PROD que terminó en APPROVED», la traza es una
lista de sentencias SQL sin sujeto.

No se instrumenta un método por ser importante. Un `findUnique` ya aparece como span de `pg`;
envolverlo sólo añade profundidad.

## Reglas comunes

- Nombre `<dominio>.<acción>`, estable y **sin identificadores**.
- Atributos de baja cardinalidad, salvo `app.entity.id`, que es un identificador **opaco** del
  motor y la única forma de ir de un incidente concreto a su traza.
- **Ningún** atributo transporta variables de decisión, texto analizado, contenido de extractos
  ni credenciales.
- El error se registra **una vez**, donde nace.

## Catálogo

### `decision.execute`

| | |
| --- | --- |
| **Módulo** | `runtime` — [runtime.service.ts](../../src/modules/runtime/runtime.service.ts) |
| **Operación** | Ejecución en línea de una decisión: idempotencia → despliegue → variables → motor → evidencia |
| **Tipo** | INTERNAL |

**Atributos**

| Atributo | Ejemplo | Cardinalidad |
| --- | --- | --- |
| `app.module` | `runtime` | 1 |
| `app.operation` | `execute` | 1 |
| `app.tenant.id` | `1` | nº de tenants |
| `app.entity.type` | `DecisionExecution` | 1 |
| `decision.artifact.code` | `BNPL_CREDIT_DECISION` | catálogo acotado |
| `decision.environment` | `PROD` | acotada |
| `decision.outcome` | `APPROVED`, `NO_DECISION`, `MANUAL_REVIEW` | acotada |
| `http.response.status_code` | `200`, `422` | acotada |

**Eventos**

| Evento | Cuándo | Atributos |
| --- | --- | --- |
| `variables.resolved` | Tras resolver el contrato de entrada | `decision.variables.count` |
| `engine.completed` | Tras recorrer el grafo | `decision.steps.count` |

Son eventos y no spans hijos a propósito: resolución y recorrido son **fases de una misma
operación**, y partirlas añadiría profundidad sin decir nada que estos dos hitos no digan ya.

**Motivo de negocio.** Es la operación que justifica el producto. Responde a «cuánto tardó la
decisión», «se fue el tiempo en las variables externas o en el motor» y «qué resolvió».

**Riesgos de privacidad.** Altos si se instrumenta mal: `dto.variables` contiene ingresos,
deudas e identificadores fiscales, y `subjectReference` identifica a una persona. **Ninguno de
los dos entra en el span.** Sólo viaja el *código* del artefacto y el resultado.

---

### `outbox.publish`

| | |
| --- | --- |
| **Módulo** | `events` — [outbox-publisher.service.ts](../../src/common/events/outbox-publisher.service.ts) |
| **Operación** | Escritura del evento en el outbox transaccional |
| **Tipo** | **PRODUCER** |

Atributos: `messaging.system=atlas-outbox`, `messaging.destination.name`,
`messaging.operation.type=publish`, `app.event.type`, `app.entity.type`, `app.tenant.id`.

**Motivo.** Es el punto donde se captura el contexto que cruzará al worker. Sin este span no
habría traza activa de la que inyectar el `traceparent`.

**Privacidad.** `payload_json` **no** se copia a atributos: puede contener datos del sujeto de
la decisión.

---

### `outbox.dispatch`

| | |
| --- | --- |
| **Módulo** | `outbox-relay` — [outbox-relay.service.ts](../../src/modules/outbox-relay/outbox-relay.service.ts) |
| **Operación** | Reparto del evento al bus, ya en el proceso worker |
| **Tipo** | **CONSUMER** |

Atributos: los de mensajería más `messaging.message.id`, `app.event.type`, `app.tenant.id` y
`app.job.attempt` (el intento en curso, útil para ver un reintento).

**Motivo.** Cierra la traza que abrió `outbox.publish` en el otro proceso. Es lo que hace
visible «la API aprobó la versión y el worker tardó 40 s en notificar».

---

### `semantic.consume`

| | |
| --- | --- |
| **Módulo** | `semantic-analysis` — [semantic-run-worker.service.ts](../../src/modules/workers/semantic-analysis/semantic-run-worker.service.ts) |
| **Tipo** | **CONSUMER** |

Atributos de mensajería más `app.job.name` y `app.job.attempt`. Por debajo cuelgan los spans
del núcleo absorbido (`semantic.process`, `semantic.analyze`, `semantic.classify`,
`catalog.load`, `tenant-budget.reserve`), cuyo vocabulario está en
[telemetry.constants.ts](../../src/modules/workers/semantic-analysis/core/observability/telemetry.constants.ts).

**Privacidad.** El texto analizado (`input_text`) **nunca** entra en un atributo. El núcleo
publica el nivel, el estado y el recuento de candidatos, no el contenido.

---

### `bank-statement.process`

| | |
| --- | --- |
| **Módulo** | `bank-statement` — [bank-statement-run-worker.service.ts](../../src/modules/workers/bank-statement/bank-statement-run-worker.service.ts) |
| **Tipo** | **CONSUMER** |

**Privacidad.** El documento (`file_bytes`), el nombre del titular y el número de cuenta no
salen del proceso. El span identifica la ejecución por su id, nada más.

---

### `job.run`

| | |
| --- | --- |
| **Módulo** | `jobs` — [job-scheduler.service.ts](../../src/common/jobs/job-scheduler.service.ts) |
| **Operación** | Un ciclo de cualquier trabajo de fondo |
| **Tipo** | INTERNAL, **raíz** |

| Atributo | Valores |
| --- | --- |
| `app.job.name` | `outbox-relay`, `test-run`, `runtime-retention`, `semantic-analysis`, … |
| `app.job.attempt` | intento consecutivo tras fallos |
| `app.job.outcome` | `work` \| `idle` |
| `app.job.processed.count` | elementos del lote |

**Por qué raíz.** Un trabajo periódico no lo origina ninguna solicitud. Colgarlo del contexto
activo lo ataría a una petición ajena elegida al azar por el bucle de eventos.

**Un span por lote, nunca por registro.** Un barrido de retención sobre cien mil filas debe
producir una traza legible.

**Coste en vacío.** También se abre en los ciclos sin trabajo. Es asumible por el retroceso
adaptativo: al ralentí la cadencia tiende al techo (30 s), o sea dos trazas por minuto y
trabajo. Decidir a posteriori habría dejado las consultas del lote sin padre, que es justo lo
que interesa ver.

## Lo que deliberadamente **no** se instrumenta

| Candidato | Por qué no |
| --- | --- |
| Cada nodo del grafo (`ExecutionEngineService`) | Un artefacto medio recorre decenas de nodos por decisión; un span por nodo multiplica el volumen por veinte para reproducir lo que la traza de ejecución ya persiste en la evidencia |
| `CacheService.get/set` | `ioredis` ya produce el span, con el comando y la duración |
| Repositorios de Prisma | El adaptador pasa por `pg`; envolverlos duplicaría cada consulta |
| Compilación y validación de artefactos | Operaciones de diseño, fuera del camino caliente; su latencia no es un incidente |
