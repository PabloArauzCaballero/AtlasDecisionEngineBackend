# Configuración

## Principio

Toda la configuración viene del **entorno**, validada al arrancar contra un esquema Zod. Un
valor ausente o fuera de rango **detiene el arranque**; nunca degrada el comportamiento en
caliente.

El catálogo completo —105 variables, con obligatoriedad, valor por defecto y propósito— se
genera del esquema: [variables de entorno](../getting-started/environment-variables.md).

## Por qué la validación es estricta

!!! example "El fallo que motivó la regla"
    `IDEMPOTENCY_LEASE_SECONDS` estaba en `.env` pero **no** declarada en el esquema. Como el
    esquema descarta las claves desconocidas, el valor se ignoraba en silencio y el servicio caía
    a sus 60 s por defecto. Nadie lo notó hasta investigar otra cosa.

    De ahí la regla: **toda variable que el código lee debe estar declarada**, aunque se lea con
    `process.env` (es el caso de las de OpenTelemetry, que se leen antes de que exista el
    contenedor de Nest).

## Familias

| Familia | Ejemplos |
| --- | --- |
| Proceso | `NODE_ENV`, `PORT`, `WORKER_ROLE`, `WORKER_HEALTH_PORT`, `BUILD_VERSION` |
| Datos | `DATABASE_URL`, `DATABASE_POOL_MAX`, timeouts |
| Caché | `REDIS_URL`, `REDIS_PREFIX`, `REQUIRE_REDIS_IN_PRODUCTION` |
| Autenticación | `AUTH_MODE`, claves de API, JWT, proveedor de identidad |
| Frontera HTTP | CORS, límite de cuerpo, timeouts, proxy |
| Tasa | ventana y cupos por ámbito |
| Observabilidad | Swagger, métricas, nivel y salida de registro, OpenTelemetry |
| Motor | pasos máximos, nodos de script, cotas de cadena, importación de código |
| Runtime | idempotencia, retención, paginación |
| Eventos | outbox: cadencia, lote, intentos, lease |
| Siembra | `STARTUP_SEED_ENABLED`, `BOOTSTRAP_*` |

## Precedencia

1. Variables del entorno del proceso.
2. `.env` del repositorio (desarrollo; en el smoke, lo ya exportado gana sobre el fichero).
3. Valores por defecto del esquema.

Los valores por defecto del esquema son **la** referencia. Donde el código repite uno con `??`,
es una defensa ante un `ConfigService` construido a mano en una prueba, no una segunda fuente
de verdad.

## `get<number>` no convierte nada

`ConfigService.get<T>()` **no valida ni convierte**: el genérico es un cast de TypeScript sobre lo
que haya. Con el esquema activo el valor llega coercido —`z.coerce.number()`, `z.coerce.boolean()`—
y todo cuadra. Pero en cuanto el valor se lee sin pasar por el esquema (un `ConfigService`
construido a mano en una prueba, o un ajuste que el esquema no cubra), lo que sale de `process.env`
es **una cadena**, y TypeScript afirma que es un número sin que nadie lo haya comprobado.

Las dos formas en que eso se rompe, medidas en este repositorio el 19-ago-2026:

| Lectura | Con cadena | Consecuencia |
|---|---|---|
| `AbortSignal.timeout(get<number>(…))` | `AbortSignal.timeout('12000')` | Lanza `TypeError`. Ocurría **dentro** del `try` del `fetch`, así que el cliente de identidad lo leía como «el proveedor no contesta» y devolvía `503`: el login entero fallaba culpando a un proveedor sano |
| `get<number>(…) + 1` | `'2' + 1 === '21'` | El contador de reintentos pasaba a **veintiún** intentos contra el proveedor, con su backoff, por cada login |
| `get<boolean>(…) ?? true` | `'false'` es *truthy* | Apagar un interruptor por variable de entorno lo dejaba encendido |

La regla, entonces: **cualquier ajuste que se vaya a usar como número o booleano se normaliza en el
punto de lectura**, no se confía en el genérico. `Number(...)` con caída al valor por defecto si el
resultado no es finito; para booleanos, comparar explícitamente contra `'false'`. Cuesta una
función y quita las tres trampas. Ver `numeroDeConfig` en `identity-provider.client.ts` y el getter
`enabled` de `job-signal.service.ts`.

## Configuración por rol de proceso

| Variable | `API` | `WORKER` |
| --- | --- | --- |
| `PORT` | usada | ignorada |
| `WORKER_HEALTH_PORT` | ignorada | usada |
| `OUTBOX_RELAY_ENABLED` y demás de fondo | sin efecto | efectivas |
| Claves y modo de autenticación | efectivas | se validan igual, aunque no autentique nada |

El worker valida el mismo esquema porque carga el **mismo** `AppModule`: es lo que impide que
las dos configuraciones se separen.

## Verificar antes de desplegar

```bash
yarn build && yarn production:config:check
```

Valida el entorno actual contra el esquema real, sin arrancar el servidor.
