# Sondas de salud

## Endpoints

| Endpoint | Proceso | Comprueba | Uso |
| --- | --- | --- | --- |
| `GET /health/live` (alias `/health`) | API | Nada externo | Liveness: ¿reiniciar? |
| `GET /health/ready` (alias `/ready`) | API | PostgreSQL y caché | Readiness: ¿enviar tráfico? |
| `GET /health/live`, `/health/ready` en `WORKER_HEALTH_PORT` | worker | Lo mismo | El worker no sirve negocio pero debe poder sondearse |

Son públicas y saltan el límite de tasa: limitarlas haría que el orquestador reiniciara
contenedores sanos justo en un pico de tráfico.

## Liveness

```json
{"status":"ok","service":"atlas-decision-engine-backend","role":"WORKER",
 "version":"2.0.0","commit":"a1b2c3d","uptimeSeconds":3600,"timestamp":"..."}
```

!!! tip "El campo `role` es la sonda más útil del sistema"
    Dice si ese proceso ejecuta los trabajos de fondo. Con todo desplegado como `API`, las colas
    crecen mientras la API responde con normalidad — y este campo es la forma más rápida de
    descubrirlo.

No consulta dependencias **a propósito**: si lo hiciera, una base de datos lenta provocaría
reinicios en cascada de procesos que están perfectamente vivos.

## Readiness

```json
{"status":"ready","checks":{"database":"ok","cache":"redis"},"timestamp":"..."}
```

Falla con `503` y el cuerpo dice **qué comprobación** falló, nunca por qué: es un endpoint
público y el texto de un driver revela host, puerto y versión. La causa real queda en el
registro del servidor.

## Una sola definición de «listo»

API y worker usan el **mismo** `HealthProbeService`. Reimplementar la comprobación en el
arranque del worker habría producido dos definiciones que se separan con el tiempo, y una sonda
que miente justo durante un incidente.

## Configuración de las sondas

| Sonda | Retraso inicial | Periodo | Fallos |
| --- | --- | --- | --- |
| Readiness API | 10 s | 10 s | 3 |
| Liveness API | 20 s | 20 s | 3 |
| Readiness worker | 10 s | 10 s | 3 |
| Liveness worker | 20 s | 20 s | 3 |

Los contenedores traen además su propio `HEALTHCHECK`.

## Apagado

`SIGTERM` cierra Nest —lo que drena los trabajos en vuelo— y vacía las trazas. El periodo de
gracia del worker (60 s) es mayor que el de la API (30 s): un lote de casos de prueba tarda más
en drenar que una petición HTTP, y matarlo a mitad devuelve la corrida a la cola por lease
vencido.

## Quién más consume estas sondas

Desde agosto de 2026, **`GET /health` lo consulta también el portal interno de ATLAS**, no sólo el
orquestador de contenedores. El backend de Atlas cataloga este motor como la herramienta
`DECISION_ENGINE` en su panel de sistemas y lo comprueba por HTTP, sin credenciales, contra la ruta
que le indique su variable `DECISION_ENGINE_HEALTH_PATH` (por defecto `/health`).

!!! warning "Cambiar la ruta o el código de estado rompe un panel ajeno"
    Si `/health` se mueve, se protege o pasa a devolver un no-2xx en condiciones normales, el panel
    de operaciones de Atlas marcará este motor como caído aunque esté perfectamente sano. La ruta
    es parametrizable del otro lado precisamente para absorber un cambio deliberado — pero hay que
    avisar, porque nadie mira una variable de otro repositorio hasta que algo se pone rojo.

Ese panel trata este servicio como **crítico**: cuando no responde, la decisión de crédito de Atlas
deja de automatizarse y cae a revisión manual. No es una degradación silenciosa, y por eso dispara
notificación de incidente. El detalle de cómo se comprueba está en
`AtlasBackend/docs/observability/servicios-hermanos.md`.
