# Trazas

## Qué está instrumentado

OpenTelemetry con exportador OTLP/HTTP e instrumentaciones de `http`, `express`, `pg` e
`ioredis`. Con eso, una traza cubre el camino completo: petición → controlador → consulta →
caché.

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `OTEL_ENABLED` | `false` | **Nada se parchea** si está apagado |
| `OTEL_SERVICE_NAME` | `atlas-decision-engine` | Nombre del servicio |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | — | Sin él se usa el destino OTLP por defecto |

## Dos detalles del arranque que no son opcionales

!!! important "El orden de importación"
    `startTracing()` se llama **antes** de cargar Nest. Las instrumentaciones parchean
    `http`/`express`/`pg`/`ioredis` **en el momento en que esos módulos se requieren**: arrancar
    después de que Nest los haya cargado produce cero spans. Por eso `main.ts` y `worker.ts`
    importan el módulo de trazas en primer lugar.

!!! important "El vaciado al apagar"
    El SDK arranca antes que Nest y vive **fuera** de su ciclo de vida, así que
    `enableShutdownHooks` no lo vacía. Sin el `stopTracing()` explícito en `SIGINT`/`SIGTERM` se
    perderían los spans todavía en memoria — justo los de la ventana de apagado, que es cuando
    una petición fallida es más interesante.

## Privacidad

`enhancedDatabaseReporting` está **desactivado**: los parámetros de las consultas nunca se
capturan. Un span con los parámetros de un `insert` de evidencia contendría datos personales
en el sistema de trazas, que rara vez tiene los controles de la base de datos.

Las rutas de salud y de métricas están excluidas: son ruido de alta frecuencia sin valor
diagnóstico.

## Correlación con los registros

El `requestId` está en cada línea de registro y en el cuerpo de todo error. Al investigar,
empiece por el `requestId` de la respuesta y cruce con la traza por marca temporal y ruta.

## Verificación

Comprobado en ambos sentidos contra un colector de prueba: con `OTEL_ENABLED=true` se reciben
lotes OTLP; con `false`, ninguno.

```bash
OTEL_ENABLED=true OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces node dist/main.js
```

## Qué mirar en una traza

| Síntoma | Qué buscar |
| --- | --- |
| Latencia alta con CPU baja | Spans de `pg` largos: consulta sin índice o bloqueo |
| Latencia con picos | Spans de proveedor externo cerca del timeout |
| Decisión lenta y consultas rápidas | Tiempo en el motor: cadena de artefactos o nodos de script |
| Errores intermitentes | Spans de `ioredis`: reservas de idempotencia en disputa |
