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
