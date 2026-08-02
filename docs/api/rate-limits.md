# Límites de tasa

## Ventanas separadas

| Ámbito | Variable | Por defecto | Por qué separado |
| --- | --- | --- | --- |
| Gestión | `RATE_LIMIT_MANAGEMENT_REQUESTS` | 300 / ventana | Tráfico humano del portal |
| Runtime | `RATE_LIMIT_RUNTIME_REQUESTS` | 1500 / ventana | Tráfico de máquina; un pico de decisiones no debe agotar el presupuesto del portal |
| Fallos de autenticación | `AUTH_FAILURE_RATE_LIMIT` | 20 / ventana | Acota el ensayo de credenciales |
| Sesión del portal | `IDENTITY_SESSION_RATE_LIMIT` | 20 / ventana | Acota los intentos de inicio de sesión |

La ventana la fija `RATE_LIMIT_WINDOW_SECONDS` (60 s). Todo se desactiva con
`RATE_LIMIT_ENABLED=false`, que **no** debe usarse en producción.

## Respuesta

```http
HTTP/1.1 429 Too Many Requests
retry-after: 23
x-ratelimit-limit: 1500
x-ratelimit-remaining: 0
x-ratelimit-reset: 1735689600
```

Las cabeceras `x-ratelimit-*` viajan también en las respuestas satisfactorias, para que un
cliente pueda regular su ritmo **antes** de ser rechazado.

## Estado compartido

El contador vive en Redis, no en memoria del proceso. Con contadores por réplica, el límite
real sería el configurado multiplicado por el número de réplicas y variaría con cada escalado.
Es una de las razones por las que **producción exige Redis**: sin él, idempotencia y límite de
tasa serían inconsistentes entre réplicas y el arranque se rechaza.

## Exenciones

Las sondas de salud llevan `@SkipRateLimit()`: limitarlas haría que el orquestador reiniciara
contenedores sanos justo durante un pico de tráfico, que es cuando menos conviene.

## Recomendaciones para el integrador

1. Respete `retry-after`; no reintente en bucle cerrado.
2. Use retroceso exponencial con jitter para no sincronizar a todos sus reintentos.
3. Vigile `x-ratelimit-remaining` y reduzca el ritmo antes de agotarlo.
4. Un `429` no es una decisión: **reintentar con la misma clave de idempotencia es seguro** y devuelve la misma ejecución si ya se había producido.
