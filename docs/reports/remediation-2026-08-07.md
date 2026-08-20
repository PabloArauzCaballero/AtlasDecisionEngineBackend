# Remediación de la auditoría integral — 7 de agosto de 2026

Cierre de los hallazgos de la auditoría de arriba abajo del backend. Cada entrada nombra el
defecto, el archivo donde vivía y la evidencia que ahora impide que vuelva.

## Resumen

| Id | Severidad | Estado | Evidencia que lo fija |
| --- | --- | --- | --- |
| A0 | Alta | Corregido | `.gitignore` cubre toda variante de `.env` |
| A1 | Alta | Corregido | 379 archivos versionados; el árbol compila desde un clon limpio |
| A2 | Alta | Corregido | `test/rls-guc-contamination.integration.spec.ts` |
| B1 | Media | Corregido | `test/execution-engine-finite-numbers.spec.ts` |
| B2 | Media | Corregido | 3 casos nuevos en `test/idempotency-lease.integration.spec.ts` + validación cruzada del env |
| B3 | Media | Corregido | ESLint con tipos en CI + `coverageThreshold` en Jest |
| B4 | Media | Corregido | 4 suites nuevas (health, live-execution, security-review, tutorials) |
| C1–C5 | Baja | Corregido | Ver detalle abajo |

## A0 — Copias de `.env` con secretos, sin ignorar

`.gitignore` sólo cubría el archivo `.env` exacto. Una copia de seguridad hecha antes de un
cambio grande (`.env.bak-antes-transformer`, 10 líneas con secretos) quedaba como archivo sin
seguimiento, a la espera de que un `git add -A` la publicara. El patrón pasa a ser `.env.*`
con excepción explícita de `.env.example`, que es la plantilla y sólo lleva valores
`change-me-*` que el env schema rechaza en producción.

## A1 — Código fuente fuera del control de versiones

`src/app.module.ts` importaba `./common/persistence/*`, un directorio entero sin seguimiento;
igual `prisma.service.ts` → `tenant-rls.ts`. Un clon limpio de la rama **no compilaba**. Se
versionaron 379 archivos: el módulo de persistencia, la telemetría, `worker-call.ts`, tres
migraciones y las pruebas asociadas.

## A2 — Sentencias crudas sobre tablas con RLS forzada, fuera de transacción

`applyTenantRls` envuelve las operaciones de modelo y `$transaction`, pero **una sentencia
cruda suelta cae al cliente base** y no fija `app.tenant_id`. Y `set_config(..., true)` es
local a la transacción sólo en apariencia: una vez que una conexión la ha usado, el parámetro
queda **definido con cadena vacía** para el resto de su vida. Deja de ser `NULL`, así que la
política intenta `''::bigint` y aborta con `22P02`.

Reproducido contra Postgres real:

```
paso 1  conexión virgen, consulta cruda        → OK
paso 2  una petición con tenant                → current_setting = ""  (IS NULL = false)
paso 3  misma conexión, consulta del relay     → ERROR 22P02
        invalid input syntax for type bigint: ""
```

Con `WORKER_ROLE=ALL` —el valor por defecto del código y de `.env.example`, documentado para
desarrollo y despliegues de un solo contenedor— los trabajos de fondo comparten pool con el
tráfico de peticiones, así que les tocaban conexiones ya contaminadas. El orquestador lo
enterraba bajo un backoff exponencial: eventos del outbox sin repartir, sin causa visible.
Las topologías de producción publicadas no lo sufrían (`WORKER_ROLE` = `API`/`WORKER`).

Corregido en las seis sentencias afectadas:

- `outbox-relay.service.ts` — `decision_outbox_event`
- `retention-sweeper.service.ts` — `decision_runtime_idempotency`
- `semantic-run-worker.service.ts` — `decision_semantic_analysis_run`
- `bank-statement-run-worker.service.ts` — `decision_bank_statement_run`
- `prisma-budget.repository.ts` — `decision_semantic_tenant_budget` (×3)

## B1 — El motor no fallaba cerrado ante un número no finito

`Number('lo-que-sea')` es `NaN`, y `NaN` atraviesa sumas y asignaciones sin quejarse hasta
que `JSON.stringify` lo convierte en `null`. El solicitante recibía
`{"status":"SUCCEEDED","outcome":"APPROVED","score":null}`: una decisión declarada correcta
sobre un valor que nunca se calculó.

`ExpressionEvaluator` ya cerraba esta puerta para las expresiones. Faltaba la otra: los
números que entran desde la configuración del nodo (`baseScore`, `points`, `scoreExpression`)
y desde el payload de las acciones (`SET_SCORE`, `ADD_SCORE`, `SET_LIMIT`, prioridad y SLA de
revisión manual), que se escriben a mano en el editor. Ahora pasan por `requireFiniteNumber`,
que lanza `NON_NUMERIC_DECISION_VALUE`. `Infinity` se rechaza igual que `NaN`.

## B2 — Carrera entre el titular caducado y quien reclama la idempotencia

`complete`, `fail` y `release` operaban `where: { id }` sin guardia de propiedad, mientras que
`reserve` sí era atómico. Si la ejecución superaba `IDEMPOTENCY_LEASE_SECONDS`, otra petición
reclamaba la fila legítimamente y el titular original la borraba o la sobrescribía.

`reserve()` devuelve ahora el `leaseExpiresAt` que fijó, como comprobante de propiedad: cada
reclamación fija uno nuevo, y sólo puede reclamarse después de vencer, así que dos titulares
no pueden compartir instante. El cierre va acotado por ese valor. Cuando no encuentra la fila
**no lanza** —abortaría la transacción del llamante y se llevaría la ejecución y su evento de
auditoría, es decir, borraría la evidencia de una decisión que sí se tomó—: registra y
publica la métrica `atlas_idempotency_lease_lost_total`.

Y la situación se vuelve inalcanzable por configuración: el env schema exige ahora que el
lease supere la decisión más larga admisible (máximo de `REQUEST_TIMEOUT_MS` y
`NESTED_TREE_MAX_TOTAL_MS`). Antes cada cota se validaba por separado y nadie comparaba las
tres, así que `NESTED_TREE_MAX_TOTAL_MS=120000` con el lease por defecto de 60 s era una
combinación aceptada que rompía la idempotencia en silencio.

## B3 — Sin análisis estático ni suelo de cobertura

No había ESLint: `check` era Prettier + `tsc`. Se añade `eslint.config.mjs` con reglas **con
información de tipos**, que es lo único que detecta la promesa que nadie espera —en una base
NestJS llena de `async`, un `await` olvidado produce una escritura fuera de su transacción sin
romper ni la compilación ni el formato—. `yarn lint` entra en `check`, `verify`,
`verify:release` y en el workflow de CI.

El linter no encontró **ninguna** promesa sin esperar: la disciplina asíncrona ya era limpia.
Sí encontró y se corrigieron: un `message` de `HttpException` que podía registrarse como
`[object Object]`, un uso de una promesa como condición booleana en el apagado del
orquestador, un `undefined` colado en un agregador de promesas y un import muerto.

Las reglas apagadas llevan su motivo en el propio archivo de configuración. `jest.config.js`
gana `coverageThreshold` con el suelo fijado justo por debajo de lo medido, y umbrales más
altos para `src/modules/graph/` y `src/common/security/`.

## B4 — Cuatro módulos sin ninguna prueba

`health`, `live-execution`, `security-review` y `tutorials` no tenían una sola referencia en
`test/`. Se cubren los invariantes que importan, no la superficie:

- **health** — `ready()` nunca lanza y la respuesta pública no revela host, puerto ni el texto
  del driver; la escucha de señales caída degrada a sondeo sin sacar el proceso de rotación.
- **security-review** — la versión se resuelve **siempre** filtrando por el tenant del
  artefacto (las tablas que agrega no tienen `tenant_id`, así que no hay RLS detrás: ésa es la
  única barrera), y responde 404 y no 403 para no confirmar que el identificador existe.
- **live-execution** — cuando el stream falla, el HTTP 200 ya se envió y el filtro global no
  puede redactar nada: un fallo inesperado no llega al cliente pero sí cierra el stream.
- **tutorials** — la clave compuesta (tenant, usuario, tutorial) viaja entera en cada
  escritura, y `completedAt` se limpia al volver atrás.

## C1–C5

- **C1** — `qa-lab.service.ts` era la única de 37 llamadas a `audit.append` sin transacción del
  llamante; el cierre de la corrida y su evento ya commitean juntos.
- **C2** — `/v1/decisions/{artifactCode}` era la única de 124 rutas sin `@Roles`. Se declara
  `DECISION_RUNTIME`, que es el rol que la semilla ya asigna por defecto, así que ningún
  cliente aprovisionado con el bootstrap estándar cambia de comportamiento. El rol pasa a
  `platform-roles.ts` como constante canónica —vivía como literal suelto en la semilla y en el
  arnés e2e— y **fuera** de `PLATFORM_ROLES`, para que una credencial de ejecución no herede
  acceso al plano de gestión a través de las rutas que expanden esa lista.
- **C3** — el log de rechazos registraba `originalUrl` con el query string; el `redact()` del
  logger sólo recorre objetos. Ahora se registra la ruta y el query string se sustituye por
  `?<redactado>`.
- **C4** — los perfiles de extracto bancario compilaban expresiones regulares arbitrarias que
  después se ejecutan contra texto de PDF. Se rechazan al parsear las que tienen retroceso
  catastrófico, con el mismo `isPotentiallyCatastrophic` que usa el motor.
- **C5** — `take` defensivo en la matriz de cobertura de trazabilidad y en el listado de
  dependencias de una variable, los dos `findMany` sin cota natural.

## Cobertura: qué se midió mal y qué se cubrió después

El 47,8 % del que partía la auditoría **no describía el repositorio: describía una de sus
mitades**. El proyecto tiene dos configuraciones de Jest —unitaria/integración y e2e— y
`test:cov` solo medía la primera. Por eso los controladores salían al 10,8 % y los módulos de
Nest al 0 %: no porque nadie los ejecutara, sino porque quien los ejecuta es la batería que no
se estaba midiendo.

Tres cambios, en este orden:

1. **`coverageReporters` incluye ahora `json`.** Sin él `coverage-final.json` no se regeneraba
   nunca, y la primera unión que se intentó acabó sumando el mapa de otra corrida —de otra
   ruta de trabajo incluso— sin avisar. `scripts/merge-coverage.mjs` falla ahora en voz alta
   si un informe no contiene un solo fichero de `src/`.
2. **`yarn cov:merge` une los dos mapas de Istanbul.** Una línea cubierta por un e2e y por una
   unitaria se cuenta una vez; el recorte a `src/` evita que los ayudantes de `test/e2e/support`
   entren en el denominador.
3. **Diez suites nuevas** sobre lo que estaba de verdad sin probar.

| Medida | Antes | Después |
| --- | --- | --- |
| Líneas (unitaria + e2e) | 47,8 %¹ | **77,0 %** |
| Sentencias | — | 76,3 % |
| Funciones | — | 66,6 % |
| Ramas | — | 56,1 % |
| Pruebas unitarias/integración | 947 | **1210** |
| Pruebas e2e | 0 en verde² | **77** |

¹ informe obsoleto de la batería unitaria únicamente. ² las 14 suites e2e no arrancaban.

Y por categoría de fichero, que es lo que explica el número: DTOs 99,5 % · módulos de Nest
100 % · lógica y controladores 75,4 % · semillas y fixtures 58,2 % · arranque
(`main.ts`/`worker.ts`) 0 %.

### Suites nuevas

`deployment-resolver-cache` (Redis es optimización, no autoridad) · `library-registry` (una
fila solo HABILITA un prelude existente) · `identity-session-boundary` (cookie, origen y
límite por IP) · `views-tenant-sql` (el `WHERE tenant_id` que sustituye a la RLS en las vistas)
· `manual-review-segregation` (nadie abre y cierra un caso en una llamada) ·
`traceability-coverage-matrix` (COMPLETE exige artefacto **y** prueba) ·
`audit-chain-verification` (cada forma de romper la cadena) · `governance-approval-guards`
(las seis guardas de la puerta de aprobación) · `health-probe` · `security-review` ·
`live-execution-stream` · `tutorial-progress` · `execution-engine-finite-numbers` ·
`rls-guc-contamination`.

### Un fallo intermitente encontrado por el camino

`esm-import.ts` cacheaba a nivel de módulo la función que resuelve `import()`. Esa función
queda ligada al contexto donde se creó, y bajo Jest cada suite corre en su propia máquina
virtual que se destruye al terminar: la siguiente suite que leyera un PDF fallaba con
«A dynamic import callback was invoked without --experimental-vm-modules» —un mensaje que
señala al flag, que sí estaba puesto, en vez de al contexto muerto—. Aparecía o no según el
orden en que Jest repartiera las suites. Construirla en cada llamada lo cierra, y con eso
pasaron también las 14 suites e2e.

### Por qué el 100 % no es el objetivo

Quedan 3.409 líneas sin cubrir. La aritmética de lo que costaría llevarlas a cero:

- **160 líneas son el arranque** (`main.ts`, `worker.ts`): abren puertos, registran manejadores
  de señal y llaman a `process.exit`. Cubrirlas exige arrancar el proceso real, que es lo que
  hace el smoke, no una prueba unitaria.
- **1.458 están en `workers/`**, un tercio del código del repositorio, con dos motores
  completos —extractos bancarios y análisis semántico— cuya cobertura profunda es un proyecto
  en sí mismo.
- El resto son en su mayoría ramas defensivas: `catch` de infraestructura, `?? valor por
  defecto` sobre configuración que siempre viene puesta, y guardas de tipos que el compilador
  ya garantiza.

Forzar esas ramas exige pruebas que afirman que algo no explota, sin fijar ningún
comportamiento. Cuestan mantenimiento, se rompen con cada refactor y —lo peor— dan la misma
señal verde que una prueba que sí comprueba algo. El objetivo útil no es el 100 % global sino
el que ya se aplica por ruta: **`src/modules/graph/` está al 91,4 %** porque ahí un hueco
significa una decisión sin verificar.

## Dato externo que falta

`yarn docs:openapi:generate` levanta la aplicación completa, y `DATABASE_READ_URL` del entorno
local apunta al host `postgres` del Compose, que no resuelve fuera del contenedor. El contrato
se regeneró apuntando esa variable a la misma base que `DATABASE_URL`, sin modificar el
`.env`. En CI y en Compose el nombre resuelve y no hace falta nada.

La suite `postgres-role-privileges.integration.spec.ts` sigue saltándose por el mismo motivo:
necesita `DATABASE_WRITE_URL` y `DATABASE_READ_URL` apuntando a los roles `atlas_writer` y
`atlas_reader` aprovisionados. Los roles existen en la base; lo que falta son las dos cadenas
de conexión resolubles.
