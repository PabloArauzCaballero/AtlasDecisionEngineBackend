# Trazabilidad distribuida — guía para desarrolladores

Cómo usar y mantener la observabilidad de este motor. Si sólo quiere ver una traza, vaya a
[Puesta en marcha](#puesta-en-marcha-en-tres-comandos).

## Los cuatro conceptos

- **Traza** — todo lo que ocurrió a raíz de un disparo: una petición HTTP, un ciclo de un
  trabajo de fondo. Es un árbol, no una lista.
- **Span** — una operación dentro de esa traza, con inicio, duración, atributos y eventos.
  `decision.execute` es un span; también lo es cada consulta a PostgreSQL que cuelga de él.
- **Contexto** — lo que permite que un span sepa de quién es hijo. Viaja solo dentro de un
  proceso (por `AsyncLocalStorage`) y **hay que propagarlo a mano** cuando cruza a otro.
- **`trace_id` / `span_id`** — 32 y 16 caracteres hexadecimales. El `trace_id` es común a toda
  la traza y es **el identificador que soporte técnico pide al usuario**; el `span_id` es único
  por operación.

## Puesta en marcha en tres comandos

```bash
yarn jaeger:up        # Jaeger local en 127.0.0.1:16686
```

En su `.env`:

```env
OTEL_ENABLED=true
OTEL_SERVICE_NAME=atlas-api
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
OTEL_TRACES_SAMPLER_ARG=1.0
```

```bash
yarn start:dev        # el backend, ya trazado
yarn jaeger:verify    # comprueba la cadena completa de extremo a extremo
```

Abra <http://localhost:16686>, elija el servicio `atlas-api` y pulse *Find Traces*.

Dentro de Docker el endpoint es `http://jaeger:4318/v1/traces` (nombre de servicio, no
`localhost`). Para parar: `yarn jaeger:down`.

## Cómo encontrar la traza de un incidente

1. Pida al usuario la cabecera **`x-trace-id`** de la respuesta. Va en toda respuesta trazada,
   **incluidas las de error y las rechazadas por autenticación** (401/403). Esas últimas no las
   cubre el interceptor —los interceptores de NestJS no corren cuando un guard rechaza—, sino
   `DomainExceptionFilter`, que sí se ejecuta en ellas.
2. Ábrala directamente: `http://localhost:16686/trace/<trace-id>`.
3. Si sólo tiene un log, busque el campo `trace_id` de esa línea: es el mismo valor.

## Crear un span

Los servicios de dominio dependen de `TracingService`, y de nada más. **No importe paquetes de
OpenTelemetry en el dominio**: la fachada existe para que cambiar de backend de trazas no toque
la lógica de decisión.

```ts
constructor(private readonly tracing: TracingService) {}

async evaluate(applicationId: string): Promise<Decision> {
  return this.tracing.runInSpan(
    'credit.evaluate',                       // <dominio>.<acción>, SIN identificadores
    {
      [APP_ATTRIBUTES.module]: 'credit',
      [APP_ATTRIBUTES.operation]: 'evaluate',
      [APP_ATTRIBUTES.entityId]: applicationId,
    },
    async (span) => {
      span.addEvent('rules.started');
      const result = await this.rules.evaluate(input);
      span.setAttribute('credit.decision', result.decision);
      return result;
    },
  );
}
```

`TracingService` es global (`ObservabilityModule` lleva `@Global`): no hay que importar ningún
módulo para inyectarlo.

El span se finaliza **siempre**, también si la operación lanza; en ese caso se registra la
excepción, se marca el error y **se relanza sin tocarlo**.

Ejemplo real: [runtime.service.ts](../../src/modules/runtime/runtime.service.ts).

### Eventos y atributos

```ts
this.tracing.addEvent('variables.resolved', { 'decision.variables.count': 12 });
this.tracing.setAttribute(DECISION_ATTRIBUTES.environment, 'PROD');
```

Un **evento** marca un hito dentro de la operación en curso. Un **atributo** describe la
operación. Cuando dude, use un evento: no añade profundidad al árbol.

### Qué NO registrar

Nunca en un span: variables de decisión, `subjectReference`, texto analizado, contenido de
extractos, cabeceras `authorization`, cookies, API keys, cuerpos de petición o respuesta.
La lista completa y el porqué están en [04-data-privacy-policy.md](04-data-privacy-policy.md).

Los nombres de span **no llevan identificadores**: `credit.evaluate`, nunca
`credit.evaluate.387471`. Un nombre con un id crea una serie temporal por ejecución e inutiliza
cualquier agregación.

## Instrumentar un trabajo de fondo

No hay nada que hacer. `JobSchedulerService` abre un span **raíz** por lote con `app.job.name`,
`app.job.outcome` y el recuento procesado. Un trabajo nuevo lo hereda por registrarse.

Un span por **lote**, nunca uno por registro: un barrido de cien mil filas debe producir una
traza legible.

## Instrumentar un worker que consume trabajo encolado

Éste es el único punto que exige atención. El trabajo viaja como **fila en PostgreSQL**, y el
contexto no sobrevive al commit: hay que persistirlo y recuperarlo.

**Al encolar** (proceso de API):

```ts
await tx.miTablaDeTrabajo.create({
  data: {
    ...datos,
    traceCarrier: persistableCarrier(this.messagingTrace.inject()),
  },
});
```

**Al consumir** (proceso worker):

```ts
return this.messagingTrace.runAsConsumer(
  'mi-worker.process',
  fila.trace_carrier,
  {
    'messaging.system': MESSAGING_SYSTEM,
    'messaging.operation.type': 'process',
    [APP_ATTRIBUTES.jobName]: this.name,
  },
  () => this.procesar(fila.id),
);
```

Requisitos:

- Una columna `trace_carrier Json?` **anulable** (ver la migración
  `20260804160000_trace_carrier_propagation`).
- Que el `RETURNING` del reclamo la **seleccione**. Es el olvido más común: sin ella el
  consumidor recibe `undefined`, abre una traza raíz y no se queja — a propósito, porque perder
  la correlación nunca puede costar el trabajo.

Una fila sin portador funciona igual y abre traza raíz. La compatibilidad hacia atrás es por
construcción.

## Validar la correlación con los logs

Para una misma petición deben coincidir:

- la cabecera `x-trace-id` de la respuesta,
- el campo `trace_id` de cada línea de log,
- el `trace_id` de la traza en Jaeger.

```bash
# Con LOG_LEVEL=debug, filtrando por la traza
yarn start:dev | grep '"trace_id":"<trace-id>"'
```

Si los logs no lo traen, es que **no había span activo**: telemetría apagada, ruta excluida, o
código corriendo fuera del contexto asíncrono (un `setInterval`, por ejemplo). Diagnóstico en
el [runbook](06-operational-runbook.md#3-los-logs-no-traen-trace_id).

## Ejecutar las pruebas

```bash
yarn test test/observability-tracing.spec.ts       # fachada, contexto y propagación
yarn test test/observability-interceptor.spec.ts   # cabecera, errores y configuración
yarn test test/observability-outbox-propagation.integration.spec.ts   # necesita Postgres
yarn jaeger:verify                                  # extremo a extremo, necesita Jaeger
```

Las unitarias usan un **exportador en memoria**: no necesitan Jaeger ni red.

## Problemas frecuentes

| Síntoma | Causa habitual |
| --- | --- |
| No aparece ninguna traza | `OTEL_ENABLED` no es exactamente `true`/`1`/`yes` |
| El servicio no aparece en Jaeger | Endpoint equivocado: `jaeger:4318` dentro de Docker, `localhost:4318` fuera |
| Falta la cabecera `x-trace-id` | Ruta excluida (`/health`, `/metrics`) o traza no muestreada |
| Falta una traza concreta | Muestreo. Suba `OTEL_TRACES_SAMPLER_ARG` a `1.0` para reproducir |
| Los logs no traen `trace_id` | Sin span activo: fuera de contexto asíncrono o telemetría apagada |
| La traza se corta en el worker | El `RETURNING` del reclamo no selecciona `trace_carrier`, o el worker tiene la telemetría apagada |
| Cero spans pese a todo correcto | Algo importó Nest antes que `startTracing()`; debe ser la **primera** importación de `main.ts`/`worker.ts` |

## Documentos

| Documento | Para qué |
| --- | --- |
| [00 — Auditoría del estado actual](00-current-state-audit.md) | Qué había antes y qué faltaba |
| [01 — Diseño de la arquitectura](01-architecture-design.md) | Decisiones y sus alternativas descartadas |
| [02 — Catálogo de spans de negocio](02-business-spans-catalog.md) | Qué se instrumenta a mano y por qué |
| [03 — Topología de producción](03-production-topology.md) | Collector, almacenamiento, seguridad |
| [04 — Política de privacidad](04-data-privacy-policy.md) | Qué no puede entrar nunca en una traza |
| [05 — Resultados de rendimiento](05-performance-results.md) | Coste medido de la instrumentación |
| [06 — Runbook operativo](06-operational-runbook.md) | Diagnóstico cuando falla |
| [07 — Informe de implementación](07-implementation-report.md) | Qué se hizo, con qué evidencia y qué queda |
| [Trazas (visión general)](tracing.md) | Resumen operativo breve |
