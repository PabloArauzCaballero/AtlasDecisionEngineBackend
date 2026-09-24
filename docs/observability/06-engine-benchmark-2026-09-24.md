# Benchmark propio del runtime de decisiones — 2026-09-24 (P-16 · B18)

!!! warning "Esto es un Mac de desarrollo, no un SLO de producción"
    Todas las cifras son de **una** máquina de desarrollo compartida con otras sesiones (carga
    media del sistema 4–6 durante la medición), con Postgres y Redis en Docker Desktop en la misma
    máquina. Sirven para comparar escenarios entre sí y para fijar un **límite operativo inicial**
    respaldado por medición; no son una cota de producción ni sustituyen una medición en el
    entorno objetivo (eso queda BLOCKED, ver al final).

Sustituye como evidencia de rendimiento del motor a la cifra trasladada de AtlasBackend de
[`05-performance-results.md`](05-performance-results.md), que sólo mide el coste de la telemetría.

## Qué se midió y cómo

| Campo | Valor |
|---|---|
| SHA medido | `70cddc2` (rama `cumplimiento/operacion`, base `cumplimiento/integracion`) |
| Máquina | Apple M5, 10 núcleos, 16 GB; macOS 26.5.2; Docker 29.6.2 (10 CPU, 12,5 GB); Node 22.23.2 |
| Servicio | `node dist/main.js` (API compilada, **un** proceso), `NODE_ENV=test`, `OTEL_ENABLED=false`, log `info` |
| Dependencias | `postgres:16-alpine` y `redis:7-alpine` efímeros y propios (`cumpl-op-eng-*`) |
| Artefacto | `BNPL_CREDIT_DECISION` provisionado por la batería e2e (`test/e2e/support/demo-artifact.ts`): alta, grafo, validación, suite bloqueante, gobierno de dos firmas y despliegue DEV→STAGING→PROD |
| Ruta | `POST /v1/decisions/BNPL_CREDIT_DECISION`, credencial runtime con `RUNTIME_DECISION_ROLE`, `environmentCode=PROD` |
| Mezcla | ~80 % APPROVED, ~9 % DECLINED (KYC), ~5 % MANUAL_REVIEW (PEP), **5 % 422 de negocio** (falta `requested_amount` → `NO_DECISION`) |
| Limitador | `RATE_LIMIT_RUNTIME_REQUESTS=100000` para medir capacidad; el escenario «limitador» usa el valor por omisión (1.500/min por cliente) |
| Calentamiento | 30 peticiones descartadas por escenario |

Reproducir (levanta sus propios contenedores, migra, provisiona, arranca la API y corre todo):

```bash
yarn build
bash scripts/perf/decision-bench.sh                       # todos los escenarios
SCENARIOS="sustained" CONCURRENCY=4 bash scripts/perf/decision-bench.sh
# sólo el generador, contra una API ya levantada:
node scripts/perf/decision-load.mjs --base-url http://127.0.0.1:3000 --api-key <runtime> \
  --concurrency 8 --duration 120 --pid <pid API> --metrics-token <token> --out r.json
```

`decision-load.mjs` separa **servidas** (200 + 422 de negocio) de **429** (limitador),
**409** (idempotencia) y **técnicos** (5xx o sin respuesta). La latencia de la tabla es la de las
peticiones servidas. RSS y CPU salen de `ps` sobre el PID de la API; el pool, de
`atlas_database_pool_connections` en `/metrics`.

## Escalado (30 s por nivel)

| Concurrencia | Servidas/s | p50 | p95 | p99 | máx | 422 negocio | Técnicos | Pool en espera (máx) | RSS máx | CPU máx |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 15,5 | 61 ms | 103 ms | 229 ms | 370 ms | 23 | 0 | 0 | 353 MB | 67 % |
| 4 | 38,1 | 92 ms | 197 ms | 306 ms | 475 ms | 57 | 0 | 0 | 557 MB | 108 % |
| 8 | 47,7 | 129 ms | 405 ms | 655 ms | 1.047 ms | 72 | 0 | 0 | 668 MB | 126 % |
| 16 | 35,3 | 349 ms | 1.187 ms | 1.955 ms | 3.730 ms | 53 | 0 | 2 | 669 MB | 110 % |
| 32 | 40,5 | 690 ms | 1.487 ms | 2.045 ms | 2.794 ms | 62 | 0 | 28 | 666 MB | 100 % |

Lectura: el techo de **un** proceso está en ~40–50 decisiones/s. A partir de 8 en vuelo la CPU
del proceso se clava en ~100–125 % (un hilo de JavaScript más el trabajo de E/S) y la latencia crece
por cola, no por errores: **cero** técnicos en todos los niveles. Con 32 en vuelo el pool de Prisma
(15 conexiones por conexión lógica) se agota y llegan a esperar 28 peticiones; ahí la cola se
traslada a la base.

## Carga sostenida (180 s)

| Concurrencia | Decisiones | Servidas/s | p50 | p95 | p99 | máx | Técnicos | Claves con 2 ejecuciones (base) | Reservas colgadas |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | 7.780 | 43,2 | 80 ms | **174 ms** | 276 ms | 759 ms | 0 | 0 | 0 |
| 8 | 6.098 | 33,8 | 184 ms | **575 ms** | 868 ms | 1.789 ms | 0 | 0 | 0 |

Memoria: RSS en diente de sierra entre ~470 y ~665 MB (c=4: 305 MB al arrancar → 665 MB a los
40 s → 474 MB tras un GC a los 100 s → 576 MB al final). No se observa crecimiento sostenido en
3 minutos; eso no descarta una fuga lenta — hace falta un soak de horas en el entorno objetivo.
El pool no tuvo peticiones en espera en ninguna de las dos.

## Objetivo inicial: p95 < 500 ms sin proveedores — **a ratificar**

El objetivo viene de la documentación del motor y **no está acordado** (P-16 pide acordarlo con S
y R). Con lo medido aquí:

- **Se cumple** con ≤ 4 decisiones en vuelo por proceso (p95 174 ms sostenido, 197 ms en escalado).
- **No se cumple de forma estable** con 8 en vuelo (405 ms en 30 s, 575 ms sostenido en 3 min).
- **Límite operativo inicial propuesto para el piloto:** 4 decisiones concurrentes por réplica
  (~40 decisiones/s por réplica en esta máquina). Más carga → más réplicas, no más concurrencia
  por proceso. A ratificar por S (operación) y R (negocio) tras repetirlo en el entorno objetivo.

## Recuperación tras caídas (c=8, 90 s; dependencia detenida a los 20 s durante 30 s)

El cliente se comporta como uno correcto: reintenta con la **misma** `idempotencyKey` y el mismo
cuerpo lo técnico (5xx, red), lo limitado (429, respetando `Retry-After`) y el `409
IDEMPOTENCY_IN_PROGRESS`, durante 120 s por petición. Después se consulta la **base**: ninguna
clave con dos ejecuciones y ninguna reserva de idempotencia colgada en `PROCESSING`.

| Escenario | Decisiones lógicas | Servidas/s | p95 | Respuestas durante la caída | Reintentadas | Sin resolver al final | Claves con 2 ejecuciones | Reservas colgadas |
|---|---:|---:|---:|---|---:|---:|---:|---:|
| Postgres caído | 2.360 | 26,2 | 339 ms | 28 × `500 INTERNAL_ERROR`, 116 × `429 AUTH_RATE_LIMIT_EXCEEDED`, 103 × `409 IDEMPOTENCY_IN_PROGRESS` | 8 | **0** | **0** | **0** |
| Redis caído | 3.741 | 41,5 | 462 ms | ninguna: 0 errores | 0 | 0 | 0 | 0 |

Serie de Postgres (servidas/s por ventana de 10 s): 42 → 32 → 0 → 0 → 4,5 → 37 → 34 → 37 → 48.
El servicio vuelve en ~1 s tras arrancar el contenedor y `/health/ready` lo refleja. Las 7–8
peticiones que estaban DENTRO de una transacción al caer la base dejan su reserva en `PROCESSING`
con arrendamiento de 60 s; hasta que vence, un reintento recibe `409 IDEMPOTENCY_IN_PROGRESS`, y al
vencer el reintento la retoma y decide **una** vez. Con un cliente que no reintenta el 409 (primera
medición del día) esas 7 quedaban sin decisión y colgadas: no duplican, pero no se resuelven solas.

### Hallazgos de la recuperación (para M y S; no se cambian en este paquete)

1. **Caída de la base ⇒ 429 en vez de 503.** La clave API se valida contra Postgres; con la base
   caída la validación falla, cuenta como fallo de autenticación y, pasados 20 por IP y minuto, el
   limitador de fallos responde `429 AUTH_RATE_LIMIT_EXCEEDED`. Un cliente que no reintente 429
   pierde esas decisiones; semánticamente es indisponibilidad (503). Propuesta: no contar como fallo de
   credencial un error de infraestructura.
2. **Redis caído no se nota en `NODE_ENV=test`** porque `CacheService` cae a memoria. En
   producción (`REQUIRE_REDIS_IN_PRODUCTION=true`) ese mismo fallo es `503 REDIS_REQUIRED` en el
   limitador, es decir, **toda** decisión falla mientras Redis no esté. No se midió en modo
   producción aquí (requiere la configuración completa de producción): queda BLOCKED para el
   entorno objetivo.
3. **El limitador vive en Redis y sobrevive a reinicios de la API**: una ventana llena al
   reiniciar sigue llena (el escenario de limitador sirvió 729 en vez de 1.500 porque heredó la
   ventana de la carga anterior). Es correcto, pero hay que saberlo al diagnosticar 429 tras un
   despliegue.

## Limitador por omisión (c=8, 30 s)

Con `RATE_LIMIT_RUNTIME_REQUESTS=1500` (omisión): 729 servidas (693 + 36 de negocio) y **2.541
`429 RATE_LIMIT_EXCEEDED`**, cero técnicos. El 429 queda separado de la indisponibilidad en el
informe. Un cliente runtime tiene por omisión un techo de **25 decisiones/s** (1.500/min), por
debajo de la capacidad medida de un proceso: si el piloto necesita más por cliente, se sube por
configuración y se documenta.

## Lo que NO se midió aquí (BLOCKED, con dueño)

| Pendiente | Por qué no aquí | Dueño |
|---|---|---|
| SLO acordado y medición en el entorno objetivo (réplicas, CPU/memoria reales, red) | Requiere el entorno y el acuerdo de carga esperada | S + R |
| Redis caído en modo producción (`503 REDIS_REQUIRED`) | Requiere la configuración de producción completa | S + M |
| Proveedores externos, exportador de trazas y receptor de eventos caídos | Sin proveedores reales ni collector en el banco local | S |
| Alertas entregadas al responsable | No hay canal de alertas en local | S |
| Soak de horas (fuga lenta de memoria) | 3 minutos no bastan | S |
| Locks y backlog del relay bajo carga | El runtime no produce eventos de outbox; el relay tiene su propio banco (`scripts/load-test.sh`) | M |

Resultados crudos (JSON por escenario, con la serie temporal de RSS y pool) generados por
`scripts/perf/decision-bench.sh` en `$TMPDIR/atlas-decision-bench/<fecha>/`; no se versionan.
