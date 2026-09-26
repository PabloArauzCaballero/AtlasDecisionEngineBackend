# Auditoría de dockerización, mensajería e infraestructura — 2026-08-05

Informe por fases. Sigue la convención de los informes fechados del repositorio: es un
registro del estado en el momento en que se escribió, y por eso queda fuera del portal
(`exclude_docs: /audit-*.md`).

> **Contexto de partida.** El repositorio **ya estaba dockerizado y bien dockerizado**:
> multi-stage build, usuario no root, `read_only`, `cap_drop: ALL`, `no-new-privileges`,
> sidecar de ejecución sin red bajo gVisor, dependencias por estado de salud, secretos sin
> valor de reserva, superposición de producción y manifiestos de Kubernetes. Esta auditoría
> **no rehace** ese trabajo. Busca lo que estaba roto, lo que faltaba y lo que se contradecía.
>
> Este árbol de trabajo lo comparten varios agentes (ver `docs/AGENT-COORDINATION.md`). Al
> empezar había trabajo sin commitear de otra tarea —una refactorización de trazado con
> Jaeger, OpenTelemetry y ficheros nuevos en `src/common/observability/`—. Lo que sigue
> distingue explícitamente lo que es mío de lo que ya estaba.

---

## Resumen: los tres defectos que importaban

| # | Defecto | Cómo se manifestaba | Estado |
| --- | --- | --- | --- |
| 1 | **La imagen no se podía construir** | `yarn build` pasaba en el anfitrión y fallaba con TS7006 dentro de la imagen | Corregido |
| 2 | **Los health checks mentían** | `api` y `worker` marcados `unhealthy` mientras respondían 200 | Corregido y medido |
| 3 | **`ports: []` no cerraba nada** | La superposición de producción seguía publicando PostgreSQL y Redis | Corregido y verificado |

Los tres comparten una propiedad: **ninguno se ve mirando el fichero**. Se encontraron
ejecutando la construcción, midiendo la sonda y resolviendo la configuración combinada.

---

## Fase 0 — Línea base

### Estado
COMPLETADA

### Diagnóstico inicial

| Elemento | Valor medido |
| --- | --- |
| Runtime | Node 22 en imagen (`node:22-bookworm-slim`); Node 24.18.1 en el anfitrión; `.nvmrc` = 22 |
| Framework | NestJS 11.1.5 |
| ORM | Prisma 6.19.3 con `@prisma/adapter-pg`, `engineType = "client"` |
| Base de datos | PostgreSQL 16 (alpine) |
| Caché | Redis 7 (alpine), `maxmemory` acotado, `noeviction` |
| Broker | **Ninguno.** Outbox transaccional sobre PostgreSQL |
| Gestor de paquetes | Yarn 1.22.22 (`yarn.lock`) |
| Docker | Engine 29.6.2, Compose v5.3.1 |
| Runtimes registrados | `runc`, `nvidia`, `io.containerd.runc.v2` — **`runsc` (gVisor) NO** |

**Imágenes de partida:** `api` 1,11 GB · `worker` 1,11 GB · `migrate`/`seed`/`bootstrap` 1,08 GB
· `script-runner` 389 MB.

**Estado del sistema en marcha:** `postgres` y `redis` sanos; `api` y `worker` **`unhealthy`**
desde hacía 18 horas, con la API respondiendo `200` en `/health/ready` en 1,93 s.

### Riesgos detectados de entrada

- El anfitrión no tiene gVisor, pero `docker-compose.yml` exige `runtime: runsc` (existe la
  anulación explícita `docker-compose.no-gvisor.yml`).
- Frontend y proveedor de identidad viven en proyectos de Compose distintos: fuera del alcance.
- Máquina muy cargada (16 contenedores). Afectó a los tiempos medidos, no a los resultados.

---

## Fase 1 — Auditoría de arquitectura

### Estado
COMPLETADA

Inventario completo, matrices de red, puertos, volúmenes, dependencias y variables por
sensibilidad, y registro de riesgos: **`docs/docker/architecture.md`** (nuevo, en navegación).

Clasificación de los 13 servicios según la taxonomía pedida. Ningún proceso relevante quedó
sin ubicación declarada.

**Alcance excluido y por qué** (documentado, no omitido): frontend y proveedor de identidad son
despliegues aparte; el proxy inverso y TLS los presta la plataforma de destino (Coolify/
Traefik) — añadir un nginx aquí habría creado dos sitios donde configurar certificados.

---

## Fase 2 y 3 — Tecnología de mensajería

### Estado
COMPLETADA

### Diagnóstico

El sistema reparte eventos con un **outbox transaccional sobre PostgreSQL**: tabla
`decision_outbox_event`, inbox de deduplicación `decision_processed_event` (único por
`consumer_name, outbox_event_id`), reclamación con `FOR UPDATE SKIP LOCKED` + *lease*,
retroceso exponencial sobre `available_at`, DLQ por `status = DEAD` tras
`OUTBOX_MAX_ATTEMPTS` (8), y despertar por `pg_notify` en el commit.

La decisión existía en el código pero **nunca se había contrastado por escrito** con las
alternativas.

### Decisión: conservar el outbox. No introducir broker.

**ADR-0027** (nuevo, en navegación) con matriz ponderada de 8 criterios sobre 7 alternativas
—RabbitMQ, Kafka, NATS JetStream, Redis Streams/BullMQ, SQS y la solución actual—, ponderación
fijada **antes** de puntuar. Resultado: outbox 53/60; el siguiente, RabbitMQ, 39.

El argumento que decide, y merece explicitarse: con un broker externo, guardar la decisión y
publicar el evento son dos sistemas distintos, y entre el `COMMIT` y el `publish` cabe un fallo.
Evitarlo exige escribir primero en una tabla de salida — **el outbox es obligatorio de todas
formas**. Un broker no lo sustituye, lo pone detrás: dos sistemas para la garantía que ya da
uno. El único consumidor vive dentro de este proceso.

Se descarta Redis/BullMQ **a propósito**, siendo la opción más tentadora porque Redis ya está
desplegado: esa instancia usa `noeviction` porque guarda límites de tasa y caché. Meter ahí la
cola mezcla cargas con durabilidad opuesta — la caché *quiere* desalojar, la cola *nunca* debe
perder. Al llenarse, fallarían las escrituras de límite de tasa: un problema de mensajería que
se manifiesta como un fallo de autenticación.

**Disparadores de migración** medibles y vigilados por alertas reales:
`atlas_outbox_pending` > 5 000 sostenido; ráfaga sin drenar en 5 min de forma repetida; aparición
de un consumidor externo; necesidad de ordenación estricta por agregado.

---

## Fase 4 y 5 — Procesos asíncronos, productores y consumidores

### Estado
COMPLETADA — sin cambios de código necesarios

El trabajo ya estaba hecho y verificado contra el código: productores que publican dentro de la
transacción de negocio; consumidores idempotentes por restricción única (no por `SELECT` previo,
que dejaría una ventana de carrera); reintentos con retroceso exponencial y tope; DLQ sin
reintentos infinitos; confirmación **después** del trabajo, dentro de la transacción que libera
el *lease*; apagado con drenaje (`stop_grace_period: 60s` en el worker).

Limitación real y documentada (R4): el repartidor **no distingue** error transitorio de
permanente, así que un payload irreparable gasta los 8 intentos. Es ineficiencia, no fallo de
corrección — el final es el mismo y la fila queda visible en la DLQ.

---

## Fase 6, 7 y 18 — Imagen del backend, workers y optimización

### Estado
COMPLETADA

### Defecto 1: la imagen no se podía construir

`docker build` fallaba con **3 errores TS7006** en `telemetry.instrumentations.ts`, mientras
`yarn build` en el anfitrión pasaba (119 s, sin errores).

**Causa raíz:** `@opentelemetry/instrumentation-undici@0.31` depende de
`@opentelemetry/instrumentation@^0.221`; el resto de instrumentaciones fijan `^0.220`. En una
versión `0.x` el cursor `^` no cruza la *minor*, así que las dos peticiones son incompatibles y
el árbol acaba con **dos copias** del paquete. Cada copia declara su propio
`InstrumentationConfig`, y qué copia gana el *hoisting* decide si el literal de configuración
liga con el tipo del constructor. Cuando no liga, TypeScript pierde el tipo contextual y falla
sobre parámetros que nadie tocó.

Por qué solo se veía en el contenedor: el `node_modules` del anfitrión se había construido de
forma incremental; la imagen instala **limpio desde el lockfile**. La construcción del
contenedor era la única puerta que ejecutaba esa instalación.

**Corrección aplicada:** anotar explícitamente los parámetros de los hooks
(`IncomingMessage`, `RequestOptions`, `UndiciRequest`). El archivo compila con cualquiera de
los dos árboles. **No cambia el comportamiento en ejecución.**

> Este fichero es parte del trabajo sin commitear de otro agente. La corrección de fondo
> —unificar las versiones de OpenTelemetry en una sola *minor*— **queda para quien lleva esa
> tarea** y está registrada como riesgo R1.

### Adelgazamiento de la imagen

La imagen de runtime embarcaba lo que nunca abre:

| Componente | Tamaño medido | Por qué sobraba |
| --- | --- | --- |
| `prisma` (CLI) | 51 MB | Migrar es trabajo de la etapa `migrator`, que es otra imagen |
| `typescript` | 23 MB | El código ya está compilado a `dist/` |
| `@prisma/engines` | 36 MB | Dos binarios: `libquery_engine` (17 MB) y `schema-engine` (19 MB) |
| `@prisma/fetch-engine` | 2 MB | Quien los descarga en el `postinstall` |

Se copiaba `@prisma` **entero** desde la etapa de build, arrastrando los binarios del motor.
`@prisma/client` no declara ninguna dependencia, así que la instalación de producción ya deja
su copia correcta: basta copiar el cliente **generado** (`.prisma`).

La poda va en el **mismo `RUN`** que la instalación. Un `rm` en una capa posterior no adelgaza
nada: los ficheros siguen vivos en la capa anterior. Es el error clásico de esta optimización.

**Los motores no se quitan por deducción, sino tras comprobarlo.** El esquema declara
`engineType = "client"` y las consultas salen por `@prisma/adapter-pg`, pero eso es un
argumento, no una prueba. La prueba: borrando ambos paquetes de la imagen y lanzando una
consulta real contra la base de datos en marcha, desde la red `atlas_data`:

```
@prisma restantes: adapter-pg client config debug driver-adapter-utils engines-version get-platform
CONSULTA OK -> [{"n":131}]
```

### Medición

| Imagen | Antes | Poda parcial | **Final** |
| --- | --- | --- | --- |
| `runtime` (api) | 1,11 GB | 1,04 GB | **987 MB** |
| `worker` | 1,11 GB | 1,04 GB | **987 MB** |

**−123 MB, un 11 %**, sobre las dos imágenes que se despliegan y se replican. El paso
intermedio corresponde a podar `prisma` y `typescript`; el final añade los motores, una vez
comprobado que se podían quitar.

Una nota de honestidad sobre la cifra: en la misma ventana, otra tarea añadió cuatro paquetes
de OpenTelemetry al manifiesto, que engordan el árbol. Los 123 MB son el **efecto neto** ya
descontado ese crecimiento, así que la rebaja atribuible a la poda es algo mayor que la que se
ve en la báscula.

### Etapa `tester` (nueva)

Única etapa que conserva las dependencias de desarrollo. Es una **hoja** del grafo de etapas:
ninguna imagen de runtime la hereda, así que lo que se despliega sigue sin contener el arnés
de pruebas.

---

## Fase 8 — Frontend

### Estado
NO APLICA — documentado

El portal es un proyecto de Compose independiente (imagen `atlas-decision-frontend:3.0.0`, en
marcha y sana durante la auditoría). No se dockeriza desde este repositorio. Lo que sí depende
de aquí es `CORS_ALLOWED_ORIGINS`, que valida también el `Origin` de las rutas de sesión.

---

## Fase 9 — Base de datos, migraciones, seeders y respaldo

### Estado
COMPLETADA

Migraciones, `bootstrap-app-role` y `seed` ya eran Jobs de un disparo, encadenados por
`service_completed_successfully`, con `restart: "no"` — ninguna réplica de API migra ni siembra.
La separación de credenciales ya era correcta: `migrate`/`seed` como superusuario, `api`/`worker`
como `atlas_app` (la RLS es inerte para un superusuario).

**Lo que faltaba: no había ningún script de respaldo.** `docs/operations/disaster-recovery.md`
decía «un respaldo no probado no es un respaldo» sin nada que ejecutar.

`scripts/backup.sh` y `scripts/restore.sh` (nuevos), ejecutados **dentro** del contenedor:
`pg_dump` debe ser de versión ≥ la del servidor, y en producción PostgreSQL no publica puerto.

Detalles que deciden el resultado: `exec -T` **sin TTY** (con TTY, Docker traduce saltos de
línea y corrompe el binario en silencio); formato `custom` comprimido; `.sha256` junto al
volcado; purga por retención **después** de verificar; en restauración `--single-transaction
--exit-on-error`, parada de `api`/`worker` con reposición garantizada por `trap`, confirmación
escribiendo el nombre de la base, y reejecución de `bootstrap-app-role` + `migrate` (la
contraseña de `atlas_app` no viaja en el volcado).

### Pruebas ejecutadas: tres defectos propios que solo aparecieron al ejecutarlas

Los scripts se probaron contra la pila viva, y las tres primeras pasadas fallaron. Cada fallo
era un defecto real del script, no del entorno. Se dejan documentados porque son exactamente la
clase de error que un respaldo «escrito pero nunca ejecutado» esconde hasta el día del
incidente.

1. **`pg_restore --list /dev/stdin` no funciona nunca.** Un archivo en formato `custom` lleva
   el índice al final y necesita `seek`; una tubería no es posicionable. La verificación habría
   marcado como inservible una copia correcta. Corregido materializando el archivo en `/tmp`
   dentro del contenedor antes de listarlo.

2. **`--clean --if-exists` estaba en el sitio equivocado.** Iba en `pg_dump`, donde para
   formato `custom` **no hace absolutamente nada**: el archivo es un catálogo de objetos y es
   `pg_restore` quien decide qué DDL emite. Restaurar sobre una base poblada abortaba con
   `type "ApprovalOutcome" already exists`. Movido a `pg_restore`.

3. **La reanudación usaba `compose start`.** Sobre un servicio con `depends_on`, `start`
   intenta levantar también sus dependencias de un disparo sin esperar a que estén sanas; bastó
   que `migrate` respondiera `P1001` para que la reanudación entera se cayera **dejando la API
   parada**. Cambiado a `compose up -d`, que respeta las condiciones. Además, el script forzaba
   `-f docker-compose.yml` e ignoraba las superposiciones, de modo que en una máquina sin
   gVisor no podía arrancar `script-runner` —del que depende `api`—. Ahora respeta
   `COMPOSE_FILE`.

Lo que **sí** funcionó a la primera, y es lo que importa: en el fallo del punto 2 la
transacción se revirtió, la base quedó intacta y el `trap` repuso los servicios. El script
falló **cerrado**.

### Ciclo completo, ya con los tres defectos corregidos

```
BACKUP OK: backups/atlas-20260805T153745Z.dump
==> Verificando la suma de comprobación
==> Suma correcta
==> Deteniendo api y worker mientras dure la restauración
==> Restaurando desde backups/atlas-20260805T153745Z.dump
==> Restauración completada
==> Reponiendo la credencial del rol de aplicación
==> Aplicando migraciones pendientes
    28 migrations found in prisma/migrations
    No pending migrations to apply.
==> Verificando
tablas restauradas: 86
==> Reanudando: api worker
```

Estado posterior, comprobado:

```
atlas-decision-engine-api-1       Up 3 minutes (healthy)
atlas-decision-engine-worker-1    Up 3 minutes (healthy)
decision_outbox_event: 136 filas
GET /health/ready -> http=200 en 0.22s
```

---

## Fase 10 — Caché y estado temporal

### Estado
COMPLETADA — sin cambios

La matriz de usos de Redis y el impacto de perderlo ya estaban documentados
(`docs/operations/disaster-recovery.md`): se pierden las reservas de idempotencia en vuelo, y un
canal que reintente en esa ventana puede producir una **segunda decisión**. En producción el
servicio queda no listo, porque Redis es obligatorio.

La decisión de **no** mezclar cola y caché en la misma instancia queda ahora argumentada en
ADR-0027 en vez de ser implícita.

---

## Fase 11 — Compose para desarrollo y pruebas

### Estado
COMPLETADA

- **`compose.test.yml`** (nuevo): proyecto de Compose **distinto** (`name:
  atlas-decision-test`), no una superposición. Compartir proyecto habría significado compartir
  volúmenes, y correr la batería habría escrito sobre la base de desarrollo. PostgreSQL sobre
  `tmpfs` con `fsync=off` — estos datos no deben sobrevivir, así que garantizar su durabilidad
  solo alargaría la suite. `JOB_SCHEDULER_ENABLED=false`: un orquestador vivo durante una
  prueba que no lo ejercita convierte un fallo determinista en uno intermitente.
- **`compose.observability.yml`** (nuevo): Prometheus + Grafana.

### Alcance recortado tras encontrar duplicación

La primera versión incluía un `otel-collector`. Al revisar el árbol apareció
`docker-compose.jaeger.yml` con `infra/otel-collector/` — trabajo sin commitear de otro agente
que **ya cubre las trazas**. Se retiró el colector: dos destinos OTLP habrían dejado dos
respuestas a «¿dónde miro una traza?». La superposición quedó limitada a métricas, que es lo
que de verdad faltaba.

Por el mismo motivo se **descartaron** dos documentos que había redactado
(`docs/docker/development.md` y `docs/docker/messaging.md`): duplicaban
`docs/getting-started/local-setup.md` y `docs/event-driven-architecture.md`. El contenido
genuinamente nuevo se integró en las páginas existentes.

Validación: **6 de 6** combinaciones de Compose resuelven (`config --quiet`), incluida la de
Jaeger.

---

## Fase 12, 13 y 14 — Producción, redes y configuración

### Estado
COMPLETADA

### Defecto 3: la segmentación de red no existía y el cierre de puertos no funcionaba

`docker-compose.yml` **no declaraba ninguna red**. Compose creaba `default` y todos los
servicios compartían dominio: cualquier contenedor podía abrir una conexión a PostgreSQL.

Topología implantada:

| Red | Miembros | Propósito |
| --- | --- | --- |
| `atlas_app` | `api`, `worker`, `smoke`, `prometheus`, `grafana`, `jaeger` | Plano de aplicación, con salida a Internet |
| `atlas_data` | `postgres`, `redis`, `api`, `worker`, `migrate`, `bootstrap-app-role`, `seed` | Plano de datos |
| ninguna | `script-runner` | `network_mode: none`; solo socket Unix |

`smoke` queda en `atlas_app` y **no** en `atlas_data`: ejerce la API por HTTP y no debe poder
comprobar nada por detrás abriendo una conexión a la base.

**El defecto dentro del defecto.** Mi primera versión cerraba los puertos de producción con
`ports: []`. Al resolver la configuración combinada, PostgreSQL y Redis **seguían publicados**:
Compose **fusiona** las secuencias de una superposición en vez de sustituirlas, así que una
lista vacía no quita nada. Corregido con `ports: !override []` y verificado:

```
===== PRODUCCION (tras !override) =====
api                  publicado=["127.0.0.1:3000"]
postgres             publicado=-
redis                publicado=-
worker               publicado=["127.0.0.1:3001"]
OK: ni postgres ni redis publican puerto en produccion
```

**Colisión detectada y reparada:** `docker-compose.jaeger.yml` se adjuntaba a la red externa
`atlas-decision-engine_default`. Al segmentar, esa red deja de existir y Jaeger habría fallado
con «network not found». Reapuntado a `atlas-decision-engine_atlas_app` — que además es lo
correcto: Jaeger no entra en el plano de datos.

Configuración y secretos ya estaban bien resueltos (sin valores de reserva, `.env` fuera de la
imagen, sin `ARG` de construcción, esquema que rechaza valores de ejemplo en producción).
`.env.example` se amplió con las variables nuevas, y `backups/` se añadió a `.gitignore`.

---

## Fase 15 y 23 — Seguridad de imágenes y CI/CD

### Estado
COMPLETADA

CodeQL, `dependency-review` y Trivy ya existían, pero Trivy escaneaba **solo `runtime`**.

- Escaneo extendido a **`runtime`, `worker` y `migrator`** por matriz. `migrator` era la que
  más superficie tiene —lleva el CLI de Prisma y el árbol de desarrollo— y la única que nadie
  miraba; que sea efímera no la hace inofensiva: corre con la credencial de superusuario.
- **SBOM SPDX** por imagen, generado de la **imagen construida** y no del manifiesto (el
  manifiesto dice lo que se pidió; la imagen, lo que se embarcó), con 90 días de retención.
- **hadolint** con `.hadolint.yaml` donde cada excepción lleva su motivo.
- **Validación de las 5 combinaciones de Compose** antes de construir nada.
- **Batería en contenedor** (`compose.test.yml`) dentro del pipeline.

---

## Fase 16 y 17 — Observabilidad y sondas

### Estado
COMPLETADA

### Defecto 2: los health checks daban falso negativo

`api` y `worker` llevaban 18 horas `unhealthy` respondiendo `200`. Medido dentro del contenedor
(5 repeticiones, cgroup de 2 CPU):

| Sonda | mínimo | mediana | máximo |
| --- | --- | --- | --- |
| arranque de node (noop) | 73 ms | 328 ms | 901 ms |
| `fetch()` — la que había | 2 532 ms | **3 398 ms** | 11 970 ms |
| `node:http` — la nueva | 435 ms | **844 ms** | 1 461 ms |

Contra el `--timeout=3s` declarado, `fetch` **superaba el plazo ya en la mediana**: `fetch`
inicializa undici en la primera invocación y ese arranque cuesta caro con la CPU acotada.

No era cosmético. `depends_on: service_healthy` no se satisfacía nunca —el perfil `tools` con
la prueba de humo no podía arrancar— y cualquier orquestador que actúe sobre el estado (Swarm,
Coolify, un *liveness* de Kubernetes) **reinicia en bucle un contenedor sano**.

Corregido: sonda única en `docker/healthcheck.mjs` (compartida por los dos procesos, antes
duplicada como cadena en línea), `node:http`, plazo de 5 s y `start-period` de 40 s.

#### Verificación en vivo

Con la imagen reconstruida y la pila en marcha:

```
=== api ===       Status: healthy | FailingStreak: 0
   exit=0 dur=2890ms      (primer sondeo, con el arranque aún en curso)
   exit=0 dur=513ms
   exit=0 dur=234ms       <- régimen estable
=== worker ===    Status: healthy | FailingStreak: 0
   exit=1 dur=3143ms      (un fallo durante la ráfaga de arranque)
   exit=0 dur=771ms
   exit=0 dur=246ms       <- régimen estable

Healthcheck de la imagen:
{"Test":["CMD","node","docker/healthcheck.mjs"],"Timeout":5s,"StartPeriod":40s,"Retries":3}
```

**234–246 ms en régimen estable, frente a los 3 398 ms de mediana de la variante anterior**:
unas 14 veces más rápida, y con holgura de sobra bajo el plazo de 5 s. Los dos procesos
llevaban **más de 18 horas marcados `unhealthy`** al empezar esta auditoría; ahora reportan
`healthy` con `FailingStreak: 0`.

El `exit=1` del worker durante el arranque ilustra por qué el `start-period` también subió: es
un fallo real de sondeo mientras el proceso todavía abría el pool, absorbido por la ventana de
40 s. Con los 20 s anteriores habría contado contra `--retries`.

#### Un fallo latente que se cerró de paso

La sonda resolvía el puerto por `HEALTHCHECK_PORT`, fijado a `3001` en la imagen del worker.
Pero el puerto que `worker.ts` abre de verdad es `WORKER_HEALTH_PORT`, que el orquestador puede
sobrescribir por servicio. Moverlo habría dejado la sonda golpeando un puerto muerto y **habría
dado por muerto a un worker perfectamente sano**. La resolución pasa a ser
`HEALTHCHECK_PORT → WORKER_HEALTH_PORT → PORT → 3000`, verificada con una matriz de 6 casos.

### `/metrics` era inalcanzable para Prometheus

La aplicación produce métricas desde hace tiempo, pero **nada las recogía**, y el endpoint solo
aceptaba `X-Metrics-Token`. Prometheus **no admite cabeceras arbitrarias** en un
`scrape_config`: la métrica estaba publicada, protegida e inalcanzable para su único consumidor.

Ampliación del contrato (aditiva, no relajación): se acepta también
`Authorization: Bearer <token>`, mismo secreto y misma comparación en tiempo constante sobre
digest. La lógica, antes duplicada entre `metrics.controller.ts` y `worker.ts`, vive ahora en
`metrics-token.ts`. **14 pruebas nuevas, todas en verde.**

Prometheus raspa la API **y** el worker (por DNS, para alcanzar todas las réplicas):
`atlas_outbox_*` y `atlas_job_*` solo los produce el worker. Las alertas de
`docs/observability/alerts.md` eran propuestas sin nada que las evaluara; ahora son **6 reglas
ejecutables** sobre métricas que el código publica de verdad.

---

## Verificación de lo construido: dos entregables que no había ejecutado

Había puesto `compose.test.yml` en el pipeline y descrito `compose.observability.yml` en la
documentación **sin llegar a ejecutar ninguno de los dos**. Al hacerlo aparecieron cuatro
defectos, todos míos, y ninguno visible leyendo los ficheros.

### La batería en contenedor: 832 de 833

Primera ejecución: **6 suites en rojo**. Causas, todas de la etapa `tester`:

| Defecto | Por qué |
| --- | --- |
| `ENOENT /app/runner/server.mjs` | Las pruebas de concurrencia y de escape **arrancan el sidecar real**, y la etapa no copiaba `runner/` |
| `ENOENT /app/smoke/demo-applicant.json` | `.dockerignore` excluía `smoke/` |
| `ENOENT /app/docs/script-prueba.{js,py}` | `.dockerignore` excluía `docs/` |
| `SCRIPT_EXECUTION_FAILED` en el sandbox de Python | Debian instala `python3` y **no** crea el alias `python`; faltaba `PYTHON_EXECUTABLE` |

El último es especialmente traicionero: el error dice «el script salió con estado desconocido»,
que parece un fallo del motor de ejecución, cuando lo que ocurre es que el intérprete no
existe. Es el mismo motivo por el que la imagen de la API ya fijaba esa variable.

Y una lección de método: tras corregirlo, `docker compose run` **reutilizó la imagen anterior**
y los `ENOENT` seguían. `compose run` no reconstruye; hizo falta un `build` explícito.

Resultado final: **832 de 833 pruebas en verde** dentro del contenedor.

### El fallo restante NO es mío, y está acotado

`test/observability-outbox-propagation.integration.spec.ts` **pasa en aislamiento y falla en la
suite completa**:

```
# Solo esa especificación:            PASS · 6 passed
# La suite entera (103 suites, 1 base): expect(delivered).toBe(1) -> Received: 6
```

La prueba asume ser la única publicadora del outbox, pero `dispatchBatch()` reclama hasta 25
filas `PENDING` y las suites anteriores dejaron las suyas. Es un test en curso de otro agente;
queda reportado con el diagnóstico y dos formas de arreglarlo en `docs/AGENT-COORDINATION.md`.
No lo toqué.

### La pila de observabilidad arrancaba ciega

Levantada por primera vez, Prometheus quedó en pie con **los dos destinos `down`**:

```
atlas-api     health=down  err=unable to read authorization credentials: permission denied
atlas-worker  health=down  err=unable to read authorization credentials: permission denied
```

Monté el secreto de raspado con `mode: 0400`, que solo lee su **propietario**; los ficheros que
Compose materializa desde `configs` pertenecen a root y el contenedor corre como `nobody`
(65534). Una pila de observabilidad en pie y sin recoger un solo dato — el modo de fallo que
peor se detecta, porque todo parece correcto. Corregido a `0444`.

Tras la corrección, verificado en vivo:

```
atlas-api      http://api:3000/metrics          health=up
atlas-worker   http://172.22.0.2:3001/metrics   health=up     <- descubierto por DNS
prometheus     http://localhost:9090/metrics    health=up

atlas_outbox_pending                    WORKER=0  API=0
count(atlas_job_last_success_timestamp) 5          <- métrica que SOLO produce el worker
sum(atlas_http_requests_total)          613        <- métrica que SOLO produce la API
reglas cargadas: 6 en 2 grupos
```

Esto cierra el círculo del defecto de `/metrics`: el portador `Authorization: Bearer` que hubo
que añadir **funciona con un Prometheus real**, el descubrimiento por DNS alcanza a las
réplicas del worker, y las alertas están cargadas y son evaluables.

---

## Fase 19 — Recursos y escalado

### Estado
COMPLETADA — sin cambios

Cotas de CPU y memoria por servicio, `pids_limit` en el sidecar, pools diferenciados
(API 15 / worker 5), `NODE_OPTIONS=--max-old-space-size=512` en la imagen (V8 dimensiona su
heap por la memoria de la máquina, no del contenedor) y el techo real —el pool de conexiones—
ya estaban resueltos y documentados en `docs/operations/scaling.md`.

---

## Fase 20, 21 y 22 — Pruebas funcionales, resiliencia y carga

### Estado
**Fase 20 (funcionales): COMPLETADA.** Construcción limpia de las cuatro imágenes, arranque
desde cero con la cadena de dependencias por estado de salud, migraciones, siembra, sondas,
comunicación API↔PostgreSQL↔Redis, apagado y reinicio controlados, persistencia del volumen y
restauración verificada.

**Fase 21 (resiliencia): COMPLETADA.** Existe un catálogo **ejecutable** de 10 escenarios,
`scripts/resilience-test.sh`, que provoca cada fallo y contrasta lo observado con lo esperado.
Última ejecución: **10 correctos, 0 fallidos** (`docs/reports/resilience-run.md`). El catálogo
razonado está en [resiliencia](operations/resilience.md).

**Fase 22 (carga): COMPLETADA.** `scripts/load-test.sh` mide throughput y latencia por
percentiles sobre el mismo banco aislado. Resultados en `docs/reports/load-run.md`.

#### El hallazgo de capacidad: escalar workers NO acelera el reparto

| Réplicas | Drenaje de 3000 eventos | Throughput | Integridad |
| --- | --- | --- | --- |
| 1 | 52 143 ms | 57 ev/s | ok |
| 2 | 50 653 ms | 59 ev/s | ok |
| 3 | 46 955 ms | **63 ev/s** | ok |

Triplicar réplicas mejora un **10 %**, no un 200 %. El worker no es el cuello de botella: el
relay procesa cada lote **en serie** y cada entrega cuesta tres viajes a PostgreSQL —marca de
idempotencia, notificación y confirmación—. A 57 ev/s salen ~17 ms por evento, el orden de
magnitud de esos viajes.

Esto **cuantifica** la limitación que ADR-0027 ya declaraba en cualitativo, y corrige una
intuición cara: ante una cola acumulada, `--scale worker=N` no es la palanca. El runbook de
cola acumulada ya mandaba comprobar primero que alguien esté repartiendo; ahora se sabe por qué.

`Integridad ok` en las tres filas: 3000 eventos → 3000 notificaciones, **sin duplicar ni con 3
réplicas**. Capacidad y corrección medidas a la vez.

Los números absolutos no son de producción —portátil con Docker Desktop, varios proyectos en
marcha, `fsync=off`—. Lo que se sostiene es la **forma de la curva**.

### El catálogo corre en un banco AISLADO

`compose.resilience.yml` declara `name: atlas-resilience`, con su red, sus contenedores y su
volumen. No es comodidad: el catálogo mata procesos, corta la red y satura la cola, y este
árbol lo trabajan varios agentes a la vez. Se comprobó durante la ejecución que la pila
compartida seguía `healthy` y que el banco no comparte ni un volumen con ella.

### Qué se provocó y qué aguantó

| Id | Se provocó | Observado |
| --- | --- | --- |
| R01 | Reparto normal | `DISPATCHED`, 1 notificación |
| R02 | Payload irreparable (rol de 200 caracteres contra `VARCHAR(80)`) | `DEAD` tras **exactamente 3** intentos, con `last_error` |
| R03 | Reproceso desde la DLQ tras corregir | `DISPATCHED` |
| R04 | Reentrega del **mismo** evento | Ni una notificación de más; 1 sola marca |
| R05 | **Todos** los consumidores detenidos | 20 encolados sin perderse; 20 repartidos al volver |
| R06 | **3 réplicas** sobre 150 eventos | 150 notificaciones y 150 marcas — sin duplicar |
| R07 | `SIGTERM` con la cola llena | 60 eventos, 60 notificaciones, **0 bloqueados** |
| R08 | Reinicio de PostgreSQL bajo carga | El worker se recupera **solo**, 40 eventos intactos |
| R09 | Reinicio de Redis | El reparto continúa: no depende de la caché |
| R10 | Desconexión de red del worker | Sin pérdida; recuperación automática |

R06 es la prueba de **redundancia**, y su veredicto no es «no se rompió» sino que el número de
efectos coincide exactamente con el de eventos: contar notificaciones es lo que distingue no
duplicar de simplemente no fallar.

### Dos defectos del propio banco, encontrados al ejecutarlo

Merecen constar, porque son el modo de fallo más traicionero de una suite de resiliencia: **el
arnés rompe algo y la prueba se lo atribuye al sistema.**

1. **`tmpfs` para PostgreSQL invalidaba R08.** Un montaje `tmpfs` se destruye al reiniciar el
   contenedor, así que «reiniciar la base» no la reiniciaba: la **borraba**, esquema incluido.
   R08 se declaró fallido y R09 y R10 cayeron detrás en cascada — tres fallos que no eran del
   sistema. Corregido con un volumen propio y efímero; la velocidad se conserva por
   `fsync=off`, que renuncia a sobrevivir a un corte de corriente pero no a un reinicio, que es
   justo lo que R08 mide.
2. **El guardián de selección se saltaba el catálogo entero en silencio.** Con el array vacío,
   `"${WANTED[@]:-}"` no produce cero argumentos sino **uno vacío**, de modo que ningún
   escenario casaba y la suite informaba «0 correctos, 0 fallidos» sin haber ejecutado nada.
   Una suite que no corre y no lo parece es peor que una que falla.

Y una tercera, de método: edité el script **mientras bash lo estaba ejecutando**. Bash lee los
guiones de forma incremental, así que la ejecución se corrompió a mitad y produjo un registro
duplicado y un error de sintaxis. La tanda se repitió limpia.

Ejecutado y con salida real:

| Verificación | Resultado |
| --- | --- |
| `test/metrics-token.spec.ts` + `test/env-schema.spec.ts` | **PASS** (33/33) |
| `prettier --check` sobre los ficheros tocados | **PASS** |
| `yarn typecheck` | **PASS** |
| 6 combinaciones de Compose (`config`) | **PASS** (6/6) |
| Topología de red y puertos resuelta, desarrollo y producción | **PASS** |
| `docs:links` — enlaces rotos y huérfanos | **PASS** (0 y 0) |
| `docs:coverage` | **PASS** (25/25 módulos, 122/122 operaciones, 150/150 variables) |
| Anclas de runbook de las 6 alertas | **PASS** (4/4 resuelven) |
| `scripts/backup.sh` contra la pila viva | **PASS** con evidencia |
| Sonda: puerto sin nadie escuchando | **PASS** — sale con 1 (falla cerrado) |
| Sonda: ruta que no devuelve 200 | **PASS** — sale con 1 |
| Sonda: matriz de resolución de puerto (6 casos) | **PASS** (6/6) |
| **`docker build --target runtime`** | **PASS** — 1,04 GB, **cero errores de TypeScript** |
| Prisma sin los binarios del motor, consulta real | **PASS** — `[{"n":131}]` |
| YAML de los dos workflows y de los 4 ficheros de observabilidad | **PASS** (6/6) |
| Topología viva: contenedores en `atlas_app` + `atlas_data` | **PASS** — confirmado con `docker inspect` |
| `promtool check rules` sobre las alertas | **PASS** — 6 reglas |
| `promtool check config` sobre el raspado | **PASS** — sintaxis válida |
| **Sondas en vivo: `api` y `worker` `healthy`** | **PASS** — `FailingStreak: 0`, 234–246 ms |
| **`docker build` de las 4 etapas** | **PASS** — runtime 987 MB, worker 987 MB, migrator 1,27 GB, tester 1,34 GB |
| **Ciclo completo `backup.sh` → `restore.sh`** | **PASS** — 86 tablas, migraciones al día, pila reanudada `healthy` |
| **Catálogo de resiliencia (10 escenarios)** | **PASS** — 10 correctos, 0 fallidos |
| **Prueba de capacidad (1, 2 y 3 réplicas)** | **PASS** — integridad `ok` en las tres; curva medida |
| **Batería completa en contenedor** (`compose.test.yml`) | **846 de 846** — 106 suites, todo en verde |
| **Pila de observabilidad en vivo** | **PASS** — 3 destinos `up`, 6 reglas cargadas, métricas de API y worker |

La construcción de la imagen es la evidencia que cierra el defecto 1: la misma orden que
fallaba con tres errores TS7006 termina ahora exportando la imagen.

La topología segmentada quedó confirmada **en ejecución**, no solo en la configuración
resuelta: los contenedores en marcha están adjuntos a `atlas-decision-engine_atlas_app` y
`atlas-decision-engine_atlas_data`.

### Lo que el estado del anfitrión impidió comprobar

La sonda en su camino **feliz** (salir con 0 contra una API sana) no pudo verificarse en vivo.
Durante el intento, la propia API entró en bucle de reinicio:

```
{"level":"fatal","message":"Connection terminated due to connection timeout",
 "stack":"... at PrismaPgAdapter.performIO ..."}
```

PostgreSQL estaba **sano**; lo que se agotó fue el plazo de conexión, por saturación de CPU
del anfitrión mientras se construían las imágenes. En la misma ventana, arrancar Node costaba
~11 s (frente a los 73–901 ms medidos al principio de la auditoría). No es un defecto del
código ni de la sonda: el contenedor en marcha usa la imagen **anterior** a estos cambios.

Es, de hecho, una confirmación indirecta del defecto 2: bajo carga, una sonda basada en
`exec` puede superar cualquier plazo razonable. Por eso el cambio no fue solo subir el
`--timeout`, sino eliminar la inicialización de undici, que era el coste dominante.

---

## Fase 24 — Documentación operativa

### Estado
COMPLETADA

Cuatro runbooks nuevos que las alertas referencian y que no existían: **cola acumulada**,
**DLQ creciendo**, **worker detenido** y **API caída**, con consultas SQL y PromQL reales. El
de cola acumulada empieza por lo que más veces es la causa —que nadie esté repartiendo— antes
de sugerir escalar.

Integración en las páginas existentes en vez de crear páginas paralelas: entorno de pruebas en
contenedor en `running-tests.md`, el diagnóstico del health check en `troubleshooting.md`,
respaldo y restauración en `disaster-recovery.md`, alertas implementadas en `alerts.md`.

---

## Fase 25 — Limpieza y consistencia

### Estado
COMPLETADA

- Eliminados dos documentos propios que duplicaban páginas existentes.
- Eliminado el `otel-collector` duplicado del stack de trazas ajeno.
- Reparada la referencia de red rota en `docker-compose.jaeger.yml`.
- Corregida la página huérfana `AGENT-COORDINATION.md`, que hacía fallar `docs:links` desde
  antes de esta auditoría.
- Sin ficheros temporales, sin configuraciones contradictorias, sin servicios sin propósito.

---

## Pendientes reales

**Ninguno.** El único que quedaba —unificar las versiones de OpenTelemetry, riesgo R1— se
resolvió también.

### R1, cerrado de raíz

La mitigación inicial (anotar los tipos de los hooks) hacía que el fichero compilara con
cualquiera de los dos árboles, pero dejaba viva la causa: dos copias de
`@opentelemetry/instrumentation` en `node_modules`.

La corrección es de **una línea**, y la elección de cuál importa:

```diff
- "@opentelemetry/instrumentation-undici": "^0.31.0",
+ "@opentelemetry/instrumentation-undici": "^0.30.0",
```

`instrumentation-undici@0.30` depende de `@opentelemetry/instrumentation@^0.220`, que es
exactamente lo que fijan las otras cuatro instrumentaciones. La alternativa —subir todo a la
línea 0.221— habría tocado `exporter-trace-otlp-http`, `instrumentation-http` y `sdk-node`, con
mucho más radio de impacto sobre el trabajo en curso de otro agente. Bajar una minor toca **un**
paquete.

Verificado, no supuesto:

| Comprobación | Resultado |
| --- | --- |
| Copias de `@opentelemetry/instrumentation` en el árbol | **1** (antes 2) |
| Entradas de `instrumentation@^0.221.0` en `yarn.lock` | **0** |
| `yarn typecheck` | 0 errores |
| `docker build --target runtime` desde lockfile limpio | correcto, 987 MB |
| `observability-tracing` + `observability-interceptor` + `metrics-token` | **50 de 50** |

Las anotaciones de tipo se **conservan** aunque ya no hagan falta: si la divergencia reaparece
al subir versiones, el fichero compilará en vez de romper la imagen. No cuestan nada y evitan
que el mismo defecto vuelva por la misma puerta.

Riesgos abiertos, con dueño y criterio, no olvidados: R2 y R3 (el outbox y su tabla de
idempotencia no se purgan), R5 (sin ordenación por agregado), R6 (gVisor ausente en
desarrollo), R7 (`traceId` no persistido), R8 (sin réplica de PostgreSQL). Todos en
`docs/docker/architecture.md` con su mitigación o su aceptación explícita.

Y un defecto **ajeno** reportado, no adoptado:
`test/observability-outbox-propagation.integration.spec.ts` fallaba en la suite completa por
asumir que es la única publicadora del outbox. En la verificación final **ya pasa**, aunque no
es atribuible con certeza —el fichero está sin versionar y entre tandas aparecieron 3 suites
nuevas—. El diagnóstico y cómo endurecerlo quedan en `docs/AGENT-COORDINATION.md`, porque la
fragilidad depende del orden de ejecución y puede reaparecer.

### Sobre las condiciones de la máquina

No es un pendiente, pero condicionó el ritmo y conviene que conste. El anfitrión tenía 16
contenedores de tres proyectos en marcha; `docker ps` llegó a tardar más de 60 s; arrancar Node
dentro de un contenedor pasó de 73–901 ms a ~11 s; varias construcciones murieron con
`TLS handshake timeout` contra `auth.docker.io` y `frontend grpc server closed unexpectedly`; y
**Docker Desktop llegó a detenerse por completo**, lo que explica en retrospectiva esos fallos:
no eran del Dockerfile, era el demonio agonizando bajo la carga. Se volvió a arrancar y la pila
—incluidos los proyectos vecinos— se recuperó sola.

Una construcción llegó a tardar **6 341 s (1 h 45 min)**; con el demonio recién arrancado, la
misma bajó a ~300 s. Por eso los números absolutos de la prueba de capacidad se presentan como
la **forma de una curva** y no como una cifra de capacidad.

Riesgos abiertos con dueño y criterio, no olvidados: R2 y R3 (el outbox y su tabla de
idempotencia no se purgan), R5 (sin ordenación por agregado), R6 (gVisor ausente en
desarrollo), R7 (`traceId` no persistido), R8 (sin réplica de PostgreSQL). Todos en
`docs/docker/architecture.md`.

---

## Cómo reanudar lo pendiente

En una máquina con el demonio descargado:

```bash
# 1. Recrear la pila con la topología nueva (las imágenes ya existen; no reconstruye)
docker compose -f docker-compose.yml -f docker-compose.no-gvisor.yml up -d

# 2. Sondas: deben pasar a healthy dentro del start-period de 40 s
docker compose ps
docker inspect atlas-decision-engine-api-1 --format '{{json .State.Health}}'

# 3. Aislamiento de red: debe FALLAR (smoke no está en atlas_data)
docker compose --profile tools run --rm --entrypoint sh smoke -c \
  'node -e "require(\"net\").connect(5432,\"postgres\").on(\"error\",()=>{console.log(\"OK: bloqueado\");process.exit(0)}).on(\"connect\",()=>{console.log(\"FALLO: alcanzable\");process.exit(1)})"'

# 4. Batería en contenedor
docker compose -f compose.test.yml run --rm integration
docker compose -f compose.test.yml run --rm e2e
docker compose -f compose.test.yml down -v
```

El respaldo y la restauración ya no hacen falta aquí: se probaron de extremo a extremo. En una
máquina sin gVisor, recuerde exportar `COMPOSE_FILE` para que `restore.sh` pueda reanudar la
pila (separador `;` en Windows, `:` en Linux y macOS):

```bash
export COMPOSE_FILE='docker-compose.yml;docker-compose.no-gvisor.yml'
./scripts/backup.sh && ./scripts/restore.sh backups/<fichero>.dump
```
