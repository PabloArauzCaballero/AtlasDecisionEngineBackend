# Trazas

Página de referencia rápida. Para aprender a usarlas, [README](README.md); para el diseño,
[01-architecture-design.md](01-architecture-design.md).

## Qué está instrumentado

OpenTelemetry con exportador **OTLP/HTTP** y cinco instrumentaciones elegidas una a una
([telemetry.instrumentations.ts](../../src/common/observability/telemetry.instrumentations.ts)):

| Instrumentación | Qué cubre |
| --- | --- |
| `http` | Peticiones entrantes al API y salientes por el módulo `http` |
| `express` | Enrutado y middleware bajo NestJS |
| `pg` | Toda consulta de Prisma — usa `@prisma/adapter-pg` sobre un `Pool` de `pg` |
| `ioredis` | Caché, límites de tasa y reservas de idempotencia |
| `undici` | **`fetch` global**: proveedor de identidad y variables externas |

No se usa `auto-instrumentations-node`: activaría más de cuarenta parches (`fs`, `dns`, `net`…)
que enterrarían la operación de negocio bajo ruido. Tampoco hay instrumentación de Prisma: el
adaptador ya pasa por `pg` y añadirla duplicaría cada consulta en dos spans.

Encima de eso, los spans de negocio del
[catálogo](02-business-spans-catalog.md): `decision.execute`, `outbox.publish`,
`outbox.dispatch`, `semantic.consume`, `bank-statement.process`, `job.run`.

## Configuración

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `OTEL_ENABLED` | `false` | **Nada se parchea** si está apagado |
| `OTEL_SERVICE_NAME` | `atlas-api` / `atlas-worker` | Uno POR PROCESO |
| `OTEL_SERVICE_NAMESPACE` | `atlas` | Agrupa los dos procesos |
| `OTEL_SERVICE_VERSION` | `BUILD_VERSION` | |
| `OTEL_DEPLOYMENT_ENVIRONMENT` | `NODE_ENV` | |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | destino OTLP por defecto | `http://jaeger:4318/v1/traces` dentro de Docker |
| `OTEL_EXPORT_TIMEOUT_MS` | `10000` | |
| `OTEL_TRACES_SAMPLER` | `parentbased_traceidratio` | |
| `OTEL_TRACES_SAMPLER_ARG` | `1.0` | Bajar en producción |
| `OTEL_PROPAGATORS` | `tracecontext,baggage` | W3C |
| `OTEL_DIAG_LOG_LEVEL` | `ERROR` | Diagnóstico interno del SDK |

## Tres detalles del arranque que no son opcionales

!!! important "El orden de importación"
    `startTracing()` se llama **antes** de cargar Nest. Las instrumentaciones parchean los
    módulos **en el momento en que se requieren**: arrancar después de que Nest los haya
    cargado produce cero spans y ningún error que lo explique. Por eso `main.ts` y `worker.ts`
    importan el módulo de trazas en primer lugar.

!!! important "El vaciado al apagar"
    El SDK arranca antes que Nest y vive **fuera** de su ciclo de vida, así que
    `enableShutdownHooks` no lo vacía. Sin el `stopTracing()` explícito en `SIGINT`/`SIGTERM` se
    perderían los spans todavía en memoria — justo los de la ventana de apagado, que es cuando
    una petición fallida es más interesante.

!!! important "El nombre por proceso"
    API y worker **no** comparten `OTEL_SERVICE_NAME`. Compartirlo dejaría el grafo de
    dependencias de Jaeger con un solo nodo hablando consigo mismo.

## Privacidad

- `enhancedDatabaseReporting` **desactivado**: los valores de los parámetros de las consultas
  nunca se capturan.
- Sin `headersToSpanAttributes`: no se capturan `authorization`, `cookie` ni `x-api-key`.
- Rutas de sonda y de métricas excluidas: ruido de alta frecuencia sin valor diagnóstico.
- Ningún atributo transporta variables de decisión, texto analizado ni contenido de extractos.

Política completa: [04-data-privacy-policy.md](04-data-privacy-policy.md).

## Correlación

Cada línea de registro lleva `trace_id`, `span_id` y `trace_flags` tomados del **contexto activo
de OpenTelemetry**, nunca de una cabecera del cliente. Las respuestas HTTP llevan `x-trace-id`.
El `requestId` sigue existiendo y sigue siendo la correlación de negocio.

## Propagación entre procesos

El trabajo cruza de la API al worker como **fila en PostgreSQL**, no como mensaje de un broker.
El contexto se persiste en la columna `trace_carrier` al publicar y se extrae al consumir
(migración `20260804160000_trace_carrier_propagation`). Una fila sin portador abre una traza
raíz y se procesa igual.

## Verificación

```bash
yarn jaeger:up          # Jaeger local en http://localhost:16686
yarn jaeger:verify      # comprueba la cadena completa y falla con un diagnóstico concreto
```

## Qué mirar en una traza

| Síntoma | Qué buscar |
| --- | --- |
| Latencia alta con CPU baja | Spans de `pg` largos: consulta sin índice o bloqueo |
| Latencia con picos | Spans de `undici` cerca del timeout: proveedor externo |
| Decisión lenta y consultas rápidas | Tiempo entre `variables.resolved` y `engine.completed` |
| Errores intermitentes | Spans de `ioredis`: reservas de idempotencia en disputa |
| Evento que no llega | `outbox.publish` sin su `outbox.dispatch` en la misma traza |
