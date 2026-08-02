# Auditoría integral de endurecimiento — backend

**Fecha:** 2026-07-30
**Alcance:** `src/**`, `runner/`, `prisma/**`, `scripts/**` del backend
`AtlasDecisionEngine`. Recorrido por las siete fases de la skill
`backend-hardening` (inventario, correctitud, seguridad, integridad de datos,
observabilidad, rendimiento, pruebas).
**Método:** lectura del código con las reglas de `.claude/rules/**` como criterio,
más reproducción real de cada hallazgo antes de tocarlo. Ningún cambio
destructivo: no se ejecutó `migrate reset`, no se tocó producción, no se hizo
`push`.

## Estado de partida

| Gate | Resultado |
|---|---|
| `typecheck` | ✅ PASS |
| `test:unit` | ✅ 512 passed / 60 suites |
| `migration:validate` | ❌ **FAIL** — ver H9 |

Superficie inventariada: 215 archivos TS (~32.8k líneas), 25 módulos de dominio,
24 controladores, 68 tablas, 27 migraciones, 79 archivos de prueba.

## Resumen de hallazgos

| # | Severidad | Fase | Hallazgo | Estado |
|---|---|---|---|---|
| H1 | **Alta** | Seguridad | Escape del sandbox JS en el runner **de producción** (SIDECAR) | ✅ Corregido |
| H2 | **Alta** | Correctitud | Una comparación contra un dato ausente devolvía `true` | ✅ Corregido |
| H3 | **Alta** | Correctitud | La política `missingData` de un campo calculado tapaba fallos de infraestructura | ✅ Corregido |
| H4 | Media | Seguridad | El backend externo de variables podía inyectar códigos no declarados | ✅ Corregido |
| H5 | Media | Correctitud | `SET_FIELD` publicaba salidas sin pasar por el contrato | ✅ Corregido |
| H6 | Media | Integridad | Una decisión `FAILED` no dejaba evento de auditoría | ✅ Corregido |
| H7 | Media | Seguridad | La respuesta del sidecar no estaba acotada ni validada | ✅ Corregido |
| H8 | Media | Rendimiento | La vista de dependencias cargaba todas las referencias del tenant | ✅ Corregido |
| H9 | Media | Seguridad | El validador de migraciones daba un falso negativo de RLS y bloqueaba el release | ✅ Corregido |
| H10 | Baja | Observabilidad | El relay del outbox registraba un ERROR en cada apagado limpio | ✅ Corregido |
| H11 | **Alta** | Rendimiento | El sidecar de scripts ejecutaba de uno en uno (`spawnSync`) | ✅ Corregido |
| H12 | **Alta** | Integridad | Un sidecar caído atrapaba la clave de idempotencia del llamante | ✅ Corregido |
| H13 | Media | Correctitud | Recursión sin cota al reclamar una clave en disputa | ✅ Corregido |
| H14 | Media | Rendimiento | Tres dominios de bloqueo compartían el espacio de claves consultivas | ✅ Corregido |
| H15 | Media | Rendimiento | Sin cota de memoria: acumulado de cadena y proceso de Python (§9.3, P-5) | ✅ Corregido |
| H16 | Baja | Observabilidad | Faltaba `atlas_dev_prod_result_diff_total` (§12, P-9) | ✅ Corregido |
| H17 | Media | Correctitud | `JobSchedulerService.runNow` rompía la exclusión mutua que la clase promete | ✅ Corregido |
| H18 | Baja | Pruebas | Una aserción de concurrencia quedó estable pero incapaz de fallar | ✅ Corregido |

---

## H1 — Escape del sandbox JS en el runner de producción · **Alta**

`runner/server.mjs` es el runner obligatorio en producción
(`SCRIPT_RUNNER_MODE=SIDECAR`, regla `30-security.md`). Su envoltorio `vm` había
divergido del que se endureció en `script-node-runner.service.ts`: entregaba al
sandbox `Object.freeze(payload.context.variables)` —congelado pero **conservando
su prototipo del realm exterior**— y `sandbox.Math = Object.create(Math)`, que
pone el `Math` exterior como prototipo. Ambos exponen
`.constructor.constructor`, es decir el constructor `Function` del realm
exterior.

Reproducido ejecutando el envoltorio real del sidecar:

```
SIDECAR: {"viaVariables":"number","viaMath":"number"}
```

`"number"` es el `typeof process.pid`: el script leyó `process` por las dos vías.
El contenedor gVisor sin red sigue siendo la frontera exterior, pero la frontera
`vm` estaba rota y el runner del API ya la había cerrado.

**Corregido:** se portó `toNullProto` (elimina recursivamente el prototipo de los
datos de decisión) y se neutraliza `Math.random` con un preámbulo ejecutado
*dentro* del contexto, nunca con un objeto exterior.
[runner/server.mjs](runner/server.mjs)

Tras el cambio, la misma sonda: `viaVariables: "no-ctor"`, `viaMath: "blocked"`,
`Math.random` bloqueado y `Math.floor` intacto.

**Prueba:** [test/sidecar-sandbox-escape.spec.ts](test/sidecar-sandbox-escape.spec.ts)
ejecuta el envoltorio extraído del propio `runner/server.mjs` (no una copia) y,
además, fija los invariantes de seguridad en ambos runners: la divergencia que
causó el fallo ya no puede repetirse en silencio.

## H2 — Una comparación contra un dato ausente devolvía `true` · **Alta**

En `ExpressionEvaluator.compare`, todo lo que no fueran dos números o una fecha
caía en `String(left)` vs `String(right)`. Medido sobre
`{op:'gte', left:{var:'bureau_score'}, right:{value:600}}`:

```
ausente  >= 600 : true      <-- "undefined" > "600" por orden Unicode
null     >= 600 : true
"700"    >= 600 : true
"80"     >= 600 : true      <-- "8" > "6"
550      >= 600 : false
```

Un umbral de crédito aprobaba cuando la variable no se había resuelto. Alcanzable
con variables nullable, intermedias aún no escritas o `decision.score` leído
antes del nodo SCORE.

**Corregido:** `compare` solo ordena número contra número, fecha contra fecha y
cadena contra cadena; cualquier otra combinación lanza
`EXPRESSION_INCOMPARABLE_OPERANDS` con un mensaje que no filtra el valor (puede
ser PII). También se rechaza ordenar contra `NaN`/infinito.
[src/modules/graph/expression-evaluator.ts](src/modules/graph/expression-evaluator.ts)

Las 512 pruebas existentes siguen pasando: ningún artefacto ni prueba dependía
del orden lexicográfico.

**Prueba:** [test/expression-evaluator-operators.spec.ts](test/expression-evaluator-operators.spec.ts)

## H3 — La política de datos faltantes tapaba fallos de infraestructura · **Alta**

`executeCalculatedField` envolvía todo el cálculo en un `catch` que aplicaba la
política `missingData` a **cualquier** error. Con `missingData: RETURN_DEFAULT`,
un sandbox caído, un script agotando su tiempo, una librería sin implementación
autorizada o una salida no serializable devolvían silenciosamente el valor por
defecto, y la decisión seguía como si el cálculo hubiera salido bien. El propio
contrato define esa política como "qué hacer cuando falta una entrada necesaria
para el cálculo", no como qué hacer ante una avería.

**Corregido:** la política se aplica solo a una lista cerrada de códigos de dato
ausente (`CALCULATED_FIELD_INPUT_MISSING`, `ARGUMENT_INVALID`,
`CONVERSION_FAILED`, `DIVISION_BY_ZERO`). Todo lo demás se propaga.
[src/modules/calculated-fields/calculated-field-runtime.ts](src/modules/calculated-fields/calculated-field-runtime.ts)

**Prueba:** [test/calculated-fields.spec.ts](test/calculated-fields.spec.ts) —
un fallo del runner ya no se defaultea; un dato realmente ausente sí.

## H4 — El proveedor externo de variables podía inyectar códigos · Media

`fetchExternalValues` fusionaba la respuesta con `Object.assign(values, external)`
sin filtrar. Un backend comprometido —o simplemente mal implementado— podía
introducir códigos que el artefacto no declara (que entraban al contexto del
motor) y **sobrescribir un valor que el cliente sí había enviado**. Rompía el
invariante que el propio comentario del método afirma: "only declared, versioned
contracts enter the engine".

**Corregido:** solo se acepta lo que se pidió; se valida además la forma de la
respuesta.
[src/modules/variables/variable-resolution.service.ts](src/modules/variables/variable-resolution.service.ts)

**Prueba:** [test/variable-resolution.spec.ts](test/variable-resolution.spec.ts)

## H5 — `SET_FIELD` publicaba salidas sin pasar por el contrato · Media

El contrato de salida se aplicaba solo en `setOutputValue`, es decir solo en los
nodos RESULT. La acción `SET_FIELD` escribía directamente en `state.output`, así
que un artefacto con contrato declarado podía publicar un campo que no estaba en
él, o el tipo equivocado en uno que sí. Es el mecanismo que usa el grafo de demo
para casi todas sus salidas.

**Corregido:** `SET_FIELD` (y el `score` de un nodo SCORE) pasan por
`publishOutput`, que aplica el contrato cuando el artefacto lo declara. Los
artefactos 1.0 —sin contrato— conservan la escritura libre, y `score` se valida
solo si está declarado, para no convertir de golpe en error algo que ya
funcionaba.
[src/modules/graph/execution-engine.service.ts](src/modules/graph/execution-engine.service.ts)

**Prueba:** [test/execution-engine-nodes.spec.ts](test/execution-engine-nodes.spec.ts)

## H6 — Una decisión `FAILED` no dejaba evidencia · Media

Los caminos de éxito y de `NO_DECISION` escriben su evento en la cadena de
auditoría dentro de la misma transacción que la acción. El camino de fallo
determinista (un 4xx de dominio: despliegue inexistente, artefacto desconocido…)
llamaba a `idempotency.fail(...)` **sin transacción y sin auditar**. El único
resultado sin entrada en la cadena era justo la negativa, que es la que pregunta
un regulador.

**Corregido:** `recordDeterministicFailure` persiste la idempotencia y un evento
`DECISION_FAILED` en una sola transacción. La persistencia es best-effort a
propósito: si lo que falló es la base de datos, el llamante recibe el error
original, no uno que lo enmascare.
[src/modules/runtime/runtime.service.ts](src/modules/runtime/runtime.service.ts)

**Prueba:** [test/runtime-failed-audit.spec.ts](test/runtime-failed-audit.spec.ts)

## H7 — La respuesta del sidecar no estaba acotada ni validada · Media

`postToSidecar` acumulaba la respuesta en memoria sin límite (un sidecar colgado
o comprometido podía tumbar el proceso del API), y `executeViaSidecar` devolvía
`payload.result` sin comprobar su forma, a diferencia de la ruta en proceso, que
sí exige un objeto no-array. Ese valor entra directo al contrato de salida de la
decisión.

**Corregido:** cota de `maxOutputBytes + 4 KiB` con corte de la respuesta, y la
misma validación de forma que la ruta en proceso.
[src/modules/graph/script-node-runner.service.ts](src/modules/graph/script-node-runner.service.ts)

## H8 — La vista de dependencias cargaba todo el catálogo del tenant · Media

`getDependencyGraph` hacía `findMany({ where: { tenantId } })` sobre
`decision_artifact_reference` —todas las referencias del tenant— para luego
descartar casi todas tras un recorrido acotado por profundidad. El coste crecía
con el catálogo entero aunque el artefacto no tuviera ninguna dependencia: un OOM
barato para cualquiera que pueda abrir la pantalla.

**Corregido:** recorrido por niveles que consulta solo la frontera, con cota de
aristas configurable (`NESTED_TREE_GRAPH_MAX_EDGES`, por defecto 2000). Cuando
recorta, lo **declara** en la respuesta (`truncated`, `maxEdges`) y lo registra:
una vista que calla que dejó aristas fuera se lee como "estas son todas las
dependencias". Se eliminó el helper `reachableWithinDepth`, ya muerto.
[src/modules/nested-trees/nested-tree.service.ts](src/modules/nested-trees/nested-tree.service.ts)

**Prueba:** [test/dependency-graph-bounded.spec.ts](test/dependency-graph-bounded.spec.ts)

## H9 — El validador de migraciones bloqueaba el release por un falso negativo · Media

`yarn migration:validate` —parte de `verify:release`— fallaba:

```
Tenant tables missing RLS ENABLE: ['decision_approved_library',
 'decision_calculated_field', 'decision_intermediate_variable',
 'decision_output_contract_field', 'decision_qa_counterexample',
 'decision_qa_generation_run']
```

Consultado el catálogo de la base real, las seis tablas tienen
`relrowsecurity = t`, `relforcerowsecurity = t` y su política `tenant_isolation`.
El validador solo reconocía la forma literal `ALTER TABLE "x" ENABLE ROW LEVEL
SECURITY`; la migración `20260730080000` las protege con un bucle
`DO $$ ... EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target)`.
Un gate de seguridad que grita en falso se acaba ignorando, y la próxima vez que
acierte nadie lo creerá.

**Corregido:** el validador reconoce también la forma dinámica.
[scripts/validate-migrations.py](scripts/validate-migrations.py)

Y como el análisis estático siempre irá por detrás de lo que se puede escribir en
SQL, se añadió la comprobación autoritativa contra el catálogo vivo: enumera
todas las tablas con `tenant_id` del schema y exige RLS habilitada, forzada y con
política en la base real.
**Prueba:** [test/tenant-rls-isolation.integration.spec.ts](test/tenant-rls-isolation.integration.spec.ts)

## H10 — ERROR en cada apagado limpio del relay del outbox · Baja

Cada `test:e2e` y cada parada del servicio terminaban con
`ERROR [OutboxRelayService] Outbox relay poll failed: Cannot use a pool after
calling end on the pool`. `onModuleDestroy` cancelaba el temporizador pero no
esperaba al sondeo ya en vuelo, que seguía consultando mientras Prisma cerraba el
pool.

**Corregido:** el apagado espera al sondeo en curso, este sale antes si ya se está
parando, y una interrupción por apagado se registra como `debug`, no como
incidente.
[src/modules/outbox-relay/outbox-relay.service.ts](src/modules/outbox-relay/outbox-relay.service.ts)

---

## Verificado y correcto (no requirió cambios)

- **RBAC.** Los 24 controladores declaran `@Roles(...)` explícitos. Las dos rutas
  sin roles son deliberadas y correctas: `/v1/decisions/:code` usa
  `@Audience('runtime')` y `/v1/session/*` es `@Public()` con
  `SessionRateLimitGuard`. `PLATFORM_ADMIN` como comodín solo se honra sobre
  credenciales firmadas, nunca sobre una API key.
- **Aislamiento por tenant.** Las 19 consultas `$queryRaw` filtran por `tenant_id`
  y están parametrizadas; ninguna concatena entrada. Los servicios que operan
  sobre tablas hijas (sin `tenant_id` propio) validan antes la pertenencia del
  padre — comprobado en security-review, testing, nested-trees, calculated-fields.
- **Determinismo del motor.** Las aristas se compilan ordenadas por
  `priority`, luego `key`; sin `localeCompare`; sin reloj ni aleatoriedad en el
  sandbox.
- **Atomicidad acción + auditoría.** `AuditService.append` recibe la transacción
  del llamante y serializa la cadena por tenant con `pg_advisory_xact_lock`.
- **Idempotencia.** Reserva con lease corto y reclamo atómico por `updateMany`
  con guarda en el `WHERE`; los fallos transitorios liberan la reserva.
- **Despliegues.** `deploy`/`rollback`/`suspend` comparten la misma clave de
  bloqueo `(artefacto, entorno)` y releen el estado dentro de la transacción.
- **Frontera HTTP.** `ValidationPipe` con `whitelist` + `forbidNonWhitelisted`,
  helmet, CORS por lista explícita, cota de cuerpo, `trust proxy` configurable,
  correlación por `x-request-id` validado.

## Segunda pasada: los tres pendientes

Los tres puntos que la primera pasada dejó abiertos se abordaron después. Dos eran
defectos y se corrigieron; el tercero resultó ser una propiedad deliberada del
diseño, y lo que faltaba era medirla.

### H11 — El sidecar ejecutaba de uno en uno · **Alta** · ✅ Corregido

`runner/server.mjs` usaba `spawnSync`, que bloquea su servidor HTTP de un solo hilo
durante toda la ejecución del script: la concurrencia real era **1**. Un script
apurando su techo de 5 s detenía detrás de sí las decisiones de todos los demás
tenants. Medido contra el runner real:

```
concurrencia=1  1x=289ms  4x=1160ms  ratio=4.01   <- serial
concurrencia=4  1x=233ms  4x= 341ms  ratio=1.46   <- concurrente
```

**Corregido:** ejecución asíncrona con `spawn`, cota de salida aplicada a mano (la
daba `maxBuffer` de `spawnSync`), `stderr` drenado y descartado, y control de
admisión —`RUNNER_MAX_CONCURRENCY` (4) y `RUNNER_MAX_QUEUE` (64)— porque forkear
sin límite solo movería el fallo: el contenedor limita `pids` a 64 y la CPU a 0.5.
El exceso se rechaza con **503 `SCRIPT_RUNNER_BUSY`**, nunca con un 4xx: el script
no llegó a ejecutarse, así que no es una decisión sobre la petición.
[runner/server.mjs](runner/server.mjs) · [docker-compose.yml](docker-compose.yml)

**Prueba:** [test/sidecar-concurrency.spec.ts](test/sidecar-concurrency.spec.ts)
levanta el sidecar real sobre un socket real. El umbral de la aserción (2.5×) se
verificó discriminante: con concurrencia 1 el ratio es 4.01 y la prueba **falla**.

### H12 — Un sidecar caído atrapaba la clave de idempotencia · **Alta** · ✅ Corregido

Hallado al hacer H11. `ScriptNodeRunnerService` lanzaba **todos** sus errores con
el estado por defecto de `DomainException` (400), incluidos los de infraestructura:
`SCRIPT_RUNNER_UNAVAILABLE`, el sidecar al límite, los nodos de script
deshabilitados. `RuntimeService.isRetryable` solo trata como transitorio un 5xx,
así que un sidecar caído se cacheaba como la **decisión terminal FAILED** de esa
petición y el llamante no podía reintentar con la misma clave durante todo el TTL
— exactamente lo que el comentario de `execute()` dice querer evitar, y nombrando
"script runner unavailable" como su ejemplo.

**Corregido:** los fallos de infraestructura y configuración se lanzan con 503, y
un 5xx del sidecar se propaga como 503; lo que sí es determinista (script
inválido, salida no serializable) sigue siendo 4xx.
[src/modules/graph/script-node-runner.service.ts](src/modules/graph/script-node-runner.service.ts)

**Prueba:** [test/runtime-failed-audit.spec.ts](test/runtime-failed-audit.spec.ts)

### H13 — Recursión sin cota al reclamar una clave · Media · ✅ Corregido

`IdempotencyService.reserve` se rellamaba a sí misma al perder la carrera de
reclamo de una reserva vencida. Sin techo, una clave bajo contención sostenida
podía recursar hasta agotar la pila, y un desbordamiento de pila en el camino de
decisión es peor resultado que un 409 que el llamante reintenta.

**Corregido:** dos reintentos y después `IDEMPOTENCY_CONTENDED` (409). Se lanza
antes de entrar al `try`, así que no toca la idempotencia ni deja evidencia falsa.
[src/modules/runtime/idempotency.service.ts](src/modules/runtime/idempotency.service.ts)

**Prueba:** [test/idempotency-reclaim-bound.spec.ts](test/idempotency-reclaim-bound.spec.ts)

### H14 — Las claves de bloqueo de tres dominios compartían espacio · Media · ✅ Corregido

Al revisar la contención de la auditoría apareció el defecto real de esa zona.
`pg_advisory_lock` tiene **un único espacio de claves de 64 bits para toda la base**,
y los tres dominios derivaban la suya de identificadores crudos que pueden coincidir:
la cadena de auditoría usaba `tenantId` tal cual, los despliegues
`(artifactId << 32) ^ environmentId` —valores de 2^32 en adelante— y el sembrado la
constante `46262026`. Los identificadores de tenant de esta plataforma no son
pequeños (el generador de pruebas ya produce 17 cifras), así que la coincidencia era
alcanzable. El síntoma habría sido un misterio de rendimiento: despliegues de un
artefacto serializándose contra las decisiones de un tenant sin relación.

**Corregido:** claves derivadas de dominio + identificadores con una mezcla de
avalancha de 64 bits, en un único sitio que además deja escrito qué bloqueos
existen y en qué orden se toman.
[src/common/prisma/advisory-lock.ts](src/common/prisma/advisory-lock.ts)

**Prueba:** [test/advisory-lock-namespace.integration.spec.ts](test/advisory-lock-namespace.integration.spec.ts)
— las propiedades se verifican contra PostgreSQL real, porque es Postgres quien usa
las claves: que quepan en su `bigint` con signo, que dominios distintos no se
esperen entre sí, y que la misma clave **sí** compita.

### El bloqueo de la cadena de auditoría: medido, no rediseñado

`AuditService` toma un bloqueo por tenant en toda escritura auditada. **No se ha
eliminado, y no debería eliminarse a ciegas**: las reglas del proyecto exigen que la
acción y su evidencia commiteen en la misma transacción
(`.claude/rules/80-database.md`) y que la cadena sea append-only y encadenada por
hash (`30-security.md`). Agrupar la cadena rompería la primera.

Lo que faltaba era el dato. Medido contra el PostgreSQL real, replicando la forma
exacta de `appendWithin` (bloqueo → leer cabeza → insertar → commit) sobre una tabla
de sondeo, para no escribir basura en una tabla append-only:

| Concurrencia | Con bloqueo de cadena | Sin bloqueo (referencia) |
|---|---|---|
| 1 | 124 escrituras/s | 145 escrituras/s |
| 8 | 155 escrituras/s | 604 escrituras/s |
| 32 | 114 escrituras/s | 568 escrituras/s |

El techo por tenant es de ~150 escrituras auditadas por segundo y **no mejora al
añadir concurrencia**: la serialización es real y está cuantificada. Basta de sobra
para el volumen de decisiones previsto, así que la conclusión es no rediseñar. Para
que deje de ser folclore en la siguiente revisión, la espera del bloqueo se publica
como métrica `atlas_audit_chain_lock_wait_ms`; si algún día ese histograma se
desplaza, la conversación sobre agrupar la cadena empezará con números.
[src/common/observability/metrics.service.ts](src/common/observability/metrics.service.ts)

## Gates tras los cambios — salida real

| Gate | Resultado | Evidencia |
|---|---|---|
| `format:check` | ✅ PASS | `All matched files use Prettier code style!` |
| `typecheck` | ✅ PASS | `tsc --noEmit` sin errores |
| `build` | ✅ PASS | `nest build` sin errores |
| `prisma:validate` | ✅ PASS | `The schema at prisma\schema.prisma is valid` |
| `migration:validate` | ✅ PASS | `OK: 27 migrations, 68 models/tables, 26 enums, 215 named constraints/indexes` |
| `test` (unit + integración) | ✅ PASS | `Test Suites: 87 passed; Tests: 2 skipped, 692 passed, 694 total` |
| `test:e2e` | ✅ PASS | `Test Suites: 13 passed; Tests: 67 passed, 67 total` |

Infraestructura real: PostgreSQL en `:55432` y Redis en `:6379`
(`atlas-decision-engine-postgres-1`, `atlas-decision-engine-redis-1`), conectando
como el rol no superusuario `atlas_app` para que la RLS aplique de verdad.

Partiendo de 512 pruebas unitarias en 60 suites, la auditoría deja **637 pruebas
en 81 suites**, con las nuevas fijando cada hallazgo corregido.

Nota de convivencia: el árbol lo comparten dos agentes. Una corrida de `test:e2e`
falló 2 casos mientras el otro agente editaba ficheros a mitad de ejecución (el
recuento creció de 58 a 62 entre corridas); no reprodujo en las dos siguientes.

## Tercera pasada: los pendientes del pliego asignados al agente A

`docs/PENDIENTES-ampliacion-contratos.md` reparte el trabajo restante entre dos
agentes. Los que quedaban del lado A se cerraron aquí; ese documento tiene el
detalle y queda actualizado.

### P-5 — La única cota de §9.3 sin implementar: memoria · ✅ Cerrado

El nudo era **cómo medirla**. Leer el montículo queda descartado:
`process.memoryUsage()` es de todo el proceso y depende del recolector y de las
peticiones vecinas, así que una decisión pasaría o fallaría por motivos ajenos a
sus datos — dejaría de ser reproducible. Lo determinista, y lo que crece de
verdad, es lo que la cadena **retiene**: cada entrada de la traza anidada conserva
su `output`.

1. **Acumulado de cadena** (`NESTED_TREE_MAX_RETAINED_BYTES`, 1 MiB). El tope por
   resultado no bastaba: 25 saltos de 256 KiB pasan uno a uno y dejan 6,4 MiB.
   `assertResultSize` pasó a `consumeResult`, que cobra ambas cotas en ese orden —
   un resultado desmesurado debe decir que lo ES, no que faltó memoria.
2. **Memoria por proceso de script** (`SCRIPT_NODE_MAX_MEMORY_MB`, 32 MiB). El
   runner de JS ya tenía `--max-old-space-size`; el de Python **ninguna**, y desde
   que el sidecar atiende varias ejecuciones a la vez eso dejaba que un script se
   llevara por delante las de otros tenants. Comprobado con el wrapper real en
   Linux sobre `list(range(60_000_000))` (solo builtins permitidos):

   | | Resultado |
   |---|---|
   | Con la cota | `MemoryError` — falla solo ese script |
   | Sin la cota | `Killed` — el kernel lo mata tras agotar el contenedor entero |

### P-9 — Métrica de diferencias DEV/PROD · ✅ Cerrado

Lo que faltaba era la semántica de «dos ejecuciones equivalentes entre ambientes».
**Queda fijada así:** solo está bien definido si se fija todo menos el ambiente, de
modo que la comparación **reutiliza los valores ya resueltos** en vez de
resolverlos otra vez. Si cada lado resolviera los suyos, una diferencia podría
venir de un valor por defecto o de un proveedor externo y la métrica dejaría de
medir lo que dice medir. Fijadas las entradas y siendo el motor determinista, lo
único que varía es el artefacto compilado de cada ambiente — la desviación que
§12 busca.

Se activa con `compareWithProduction: true` en `POST /v1/simulations/{code}`; nada
se persiste. `atlas_dev_prod_result_diff_total{artifact_code, difference}` cuenta
también los `NONE`, porque sin denominador la tasa de divergencia no se lee. Que
PROD no esté desplegado se informa y **no** tumba la simulación.

## Cuarta pasada: la superficie nueva del proceso worker

Cerrados los pendientes del pliego, el otro agente añadió un proceso worker aparte, un
orquestador central de trabajos y una señal `LISTEN`/`NOTIFY`. Auditada esa superficie:

### H17 — `runNow` rompía la exclusión mutua que la clase promete · Media

`JobSchedulerService` promete explícitamente que «dentro de un proceso no hay dos ejecuciones
simultáneas del mismo trabajo». `runNow` esperaba a `inFlight` pero no **ocupaba** la ranura
ni cancelaba el temporizador pendiente, así que un ciclo agendado arrancaba el MISMO trabajo
en paralelo. Medido con una sonda antes de tocar nada: dos ejecuciones vivas a la vez; tras el
arreglo, una.

Con lotes reclamados por `FOR UPDATE SKIP LOCKED` no corrompe datos, pero duplica trabajo y
vuelve intermitente cualquier prueba que use `runNow` — y el comentario de la clase anticipa
«un futuro endpoint de operación que fuerce un ciclo», que es donde sí importaría. El arreglo
repone el temporizador al terminar: sin eso, una ejecución manual dejaba el trabajo sin
sondear el resto de la vida del proceso.

### H18 — Una aserción de concurrencia estable pero incapaz de fallar · Baja

La aserción de `sidecar-concurrency.spec.ts` se cambió con buen motivo (la original comparaba
tiempos de pared contra una medición aparte y fallaba bajo carga sin regresión), pero el
reemplazo resultó ser una tautología: las cuatro llamadas se emiten síncronamente, así que
`max(inicios) < min(finales)` solo afirma que se enviaron antes de recibir la primera
respuesta. Comprobado con el runner real a `RUNNER_MAX_CONCURRENCY=1`: **pasa igual**, es
decir, no habría detectado la vuelta a `spawnSync`.

Repuesta comparando dos magnitudes de la misma corrida —dispersión de los finales frente a la
duración de una— de modo que la velocidad del equipo se cancela sin reintroducir la
fragilidad. En serie `spread=635ms` vs `una=290ms` (falla); concurrente `73ms` vs `409ms`
(pasa).

La regla que deja: al desflakear una prueba de tiempo, verificar que la nueva aserción sigue
fallando con el comportamiento que vigila. Una prueba verde que no puede ponerse roja es peor
que ninguna, porque además da confianza.

## Pendiente conocido

Queda anotado, sin acción, lo que es una decisión de diseño y no un defecto:

- El bloqueo de la cadena de auditoría limita a ~150 escrituras auditadas por
  segundo y por tenant (medido arriba). Es el precio de que la acción y su
  evidencia commiteen juntas; revisarlo solo tiene sentido si
  `atlas_audit_chain_lock_wait_ms` empieza a desplazarse.
- Los pendientes P-3, P-4, P-6, P-7 y P-8 del pliego siguen abiertos y están
  **asignados al agente B** en `docs/PENDIENTES-ampliacion-contratos.md`.
