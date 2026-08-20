# Fase 18 — Política de privacidad de las trazas

Este motor decide crédito, riesgo y fraude. Sus entradas son datos financieros personales. Un
sistema de trazas suele tener **menos** controles de acceso que la base de datos: sin una
política explícita, Jaeger acaba siendo la copia sin proteger de lo que la base de datos
protege.

La regla de fondo: **una traza dice qué pasó y cuánto tardó, nunca con qué datos**.

## Datos prohibidos

Nunca en un atributo, evento, nombre de span, descripción de estado ni excepción registrada:

| Categoría | Ejemplos en este motor |
| --- | --- |
| Credenciales | `MANAGEMENT_API_KEY`, `RUNTIME_API_KEY`, `AUDIT_HASH_SECRET`, `METRICS_TOKEN`, cabecera `authorization`, cookie `atlas_refresh`, JWT |
| Variables de decisión | `dto.variables`, `dto.context`, `input_snapshot` — ingresos, deudas, scores |
| Identidad del sujeto | `subjectReference`, documentos de identidad, identificadores fiscales |
| Datos bancarios | Contenido de extractos (`file_bytes`), números de cuenta, movimientos |
| Texto analizado | `input_text` del worker semántico |
| Cuerpos completos | Peticiones, respuestas, payloads de eventos, ficheros |
| SQL con valores | Parámetros de sentencias |
| Entorno | Variables de proceso, cadenas de conexión |
| Errores hacia el cliente | Stack traces (ya bloqueados por `DomainExceptionFilter` en producción) |

## Datos permitidos

| Categoría | Ejemplos |
| --- | --- |
| Identificadores opacos del motor | `app.entity.id`, `messaging.message.id`, id de ejecución |
| Códigos de catálogo | `decision.artifact.code`, `decision.environment`, `decision.outcome` |
| Estructura | `app.module`, `app.operation`, `app.job.name`, `app.event.type` |
| Recuentos | `decision.steps.count`, `app.job.processed.count` |
| Códigos de error estables | `error.type` (`VARIABLE_MISSING_OR_INVALID`, `SEMANTIC_TIMEOUT`) |
| Convenciones semánticas | `db.system`, `db.operation.name`, `server.address`, `http.route`, `url.path` |
| Tenant | `app.tenant.id` — necesario para aislar un incidente por cliente |

`app.entity.id` es la única concesión a cardinalidad alta, deliberada: sin él no se puede ir de
un incidente concreto a su traza. Es un identificador del motor, no un dato personal.

## Estrategia de redacción — tres capas

Una sola capa falla el día que alguien añade una instrumentación nueva.

### 1. En origen (código)

- Ningún span recibe payloads; los atributos permitidos están enumerados en
  [`telemetry.constants.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/common/observability/telemetry.constants.ts).
- `recordSpanError` usa el **código estable** del error como descripción del estado, nunca su
  mensaje, que puede llevar fragmentos de la entrada. Un valor lanzado que no sea `Error` se
  sustituye por su código antes de registrarse.
- El logger ya redacta agresivamente (`SENSITIVE_KEYS` en
  [`structured-logger.service.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/common/observability/structured-logger.service.ts)),
  con sobre-redacción deliberada de todo lo que tenga forma de decisión.

### 2. En la instrumentación

- `PgInstrumentation({ enhancedDatabaseReporting: false })` — se captura el texto de la
  sentencia, **nunca los valores de los parámetros**.
- `HttpInstrumentation` **sin** `headersToSpanAttributes`: no se captura ninguna cabecera, y por
  tanto tampoco `authorization`, `cookie` ni `x-api-key`.
- `IORedisInstrumentation` con un serializador que emite sólo el comando, no el valor.
- Rutas de sonda excluidas (`UNTRACED_HTTP_PATHS`).

### 3. En el Collector

[`infra/otel-collector/otel-collector.config.yml`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/infra/otel-collector/otel-collector.config.yml)
borra cabeceras sensibles, parámetros SQL y `url.query` antes de persistir. Es la red que
recoge lo que se cuele por una biblioteca actualizada.

## El portador de traza

La columna `trace_carrier` guarda únicamente cabeceras W3C (`traceparent`, `tracestate`,
`baggage`) generadas por OpenTelemetry. **No transporta datos de la solicitud.** No se debe usar
`baggage` para llevar identificadores de negocio: se propaga a todos los servicios aguas abajo y
acabaría en trazas de terceros.

## Retención

| Entorno | Retención | Motivo |
| --- | --- | --- |
| development | En memoria, se pierde al reiniciar | No hay nada que conservar |
| staging | 7 días | Suficiente para investigar una regresión |
| production | **30 días máximo** | Diagnóstico operativo; para la evidencia de una decisión está la cadena de auditoría, que es la fuente legal |

Una traza **no** es evidencia de una decisión. La evidencia es `DecisionAuditEvent`, append-only
y encadenada por hash. Ampliar la retención de trazas «por si acaso» sólo aumenta la superficie
de exposición sin aportar valor probatorio.

## Acceso

- La UI de Jaeger **no se publica en Internet**: red privada y autenticación delante.
- El Collector escucha sólo en la interfaz interna del despliegue.
- En local todos los puertos van a `127.0.0.1`, igual que el resto del repositorio.
- El acceso se concede a operación e ingeniería de plataforma; no es una herramienta de negocio.

## Auditoría

- `yarn jaeger:verify` comprueba, entre otras cosas, que **ninguna** traza almacenada contiene
  atributos con `authorization`, `cookie`, `x-api-key`, `password`, `token` o `secret`.
- La prueba unitaria *«no deja el mensaje del error como descripción del estado»*
  ([observability-interceptor.spec.ts](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/test/observability-interceptor.spec.ts)) fija por
  contrato que el mensaje de una excepción no llega al span.
- Toda instrumentación nueva se revisa contra esta lista antes de habilitarse.

## Procedimiento ante una filtración

1. **Contener.** Deshabilitar la instrumentación culpable (`OTEL_ENABLED=false` si no se puede
   acotar) y desplegar.
2. **Delimitar.** Qué atributo, desde qué versión, cuántas trazas.
3. **Purgar.** Eliminar el índice o el almacenamiento del periodo afectado. Con almacenamiento
   por índice diario, borrar los índices del rango.
4. **Reducir la ventana.** Bajar la retención mientras dure la investigación.
5. **Revocar.** Retirar los accesos a la UI que no sean imprescindibles.
6. **Corregir.** Redacción en el Collector como parche inmediato; corrección en el código como
   arreglo de fondo. Añadir una prueba que impida la regresión.
7. **Documentar.** Incidente y cronología, según el procedimiento de
   [runbooks/OPERATIONS.md](../runbooks/OPERATIONS.md).

## Responsables

| Función | Responsabilidad |
| --- | --- |
| Ingeniería de plataforma | Instrumentación, configuración del Collector, retención |
| Operación / SRE | Acceso a la UI, purga ante incidente |
| Cumplimiento | Revisión periódica de esta política y de los atributos publicados |
