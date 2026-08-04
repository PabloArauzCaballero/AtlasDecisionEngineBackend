# ADR-0026: Integración de dos workers adicionales (semántico y extractos bancarios)

## Estado

Aceptado — 2026-08-04

## Contexto

Llegan dos workers como repositorios independientes, con el encargo de
absorberlos como capacidades adicionales del producto sin reemplazar ni romper
lo existente:

- **Worker A**, `@business/semantic-analysis-worker`: clasificación semántica
  híbrida con recuperación de candidatos, escalamiento por niveles y auditoría.
- **Worker B**, `@cpa/bolivia-bank-statement-worker`: conversión de extractos
  bancarios bolivianos en PDF a un contrato normalizado.

El análisis previo está en
[`../workers/additional-workers-integration-analysis.md`](../workers/additional-workers-integration-analysis.md).

Los dos llegan con supuestos de infraestructura que **no coinciden** con los del
motor, y en direcciones opuestas: el worker A trae infraestructura de sobra —
su propia cola (pg-boss), su propio ORM (Sequelize), su propia telemetría — y el
worker B no trae ninguna: es un motor en memoria, síncrono, expuesto por HTTP.

El motor, por su parte, ya tiene un procedimiento de workers completo y en
producción (`src/common/jobs/` + el trabajo `test-run` del módulo `testing`):
cola sobre PostgreSQL con reclamo atómico, despertar por `LISTEN`/`NOTIFY`,
leases con latido, recuperación de leases vencidos, métricas `atlas_job_*` y
apagado drenado.

## Fuerzas y restricciones

- El encargo prohíbe explícitamente duplicar infraestructura, crear un segundo
  sistema de seguimiento de jobs, introducir otra tecnología de colas, cambiar
  el ORM o cambiar el proveedor de almacenamiento.
- El encargo también exige conservar la lógica funcional válida de los workers
  y no reescribirla: hay que adaptar los bordes, no el núcleo.
- Los dos workers deben quedar independientes entre sí: cola propia, contrato
  propio, configuración propia, métricas propias, pruebas propias.
- Ambos deben poder ejecutarse como procesos persistentes separados del API.
- El worker B necesita recibir archivos, y **el motor no ha manejado archivos
  nunca**: no hay `multer`, ni columnas `Bytes`, ni proveedor de almacenamiento.
- El worker A no puede clasificar sin credenciales de un proveedor de modelo, y
  un despliegue sin ellas no debe impedir arrancar el motor.

## Opciones consideradas

### Cola

| Opción                                            | Por qué no                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Conservar pg-boss para el worker A                 | Segunda tecnología de colas y segundo sistema de seguimiento de jobs; prohibido por el encargo. Además parte el panel de operación en dos |
| Migrar todo el motor a pg-boss                     | Reescribe tres trabajos en producción para acomodar uno nuevo; riesgo desproporcionado          |
| Un único trabajo compartido por los dos workers    | Prohibido: cada worker debe conservar cola y processor identificables                            |
| **Un `BackgroundJob` por worker, patrón del motor** | **Elegida**                                                                                     |

### Almacenamiento del archivo del worker B

| Opción                                    | Por qué no                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| S3 / MinIO / Cloudinary                    | Introduce un proveedor de almacenamiento nuevo; prohibido por el encargo                                   |
| Disco local del contenedor                 | No sobrevive al reinicio ni se comparte entre réplicas; el worker que reclama el job puede no ser el que recibió la carga |
| Sólo en memoria, procesamiento síncrono    | Contradice el requisito de worker persistente y pierde el trabajo ante un reinicio                         |
| **Columna `Bytes` en PostgreSQL**          | **Elegida**                                                                                                |

## Decisión

### 1. Dos trabajos independientes sobre el procedimiento estándar

Se añaden dos nombres a `JobName`, cada uno con su servicio, su tabla de
ejecución, su configuración y sus métricas:

```ts
SemanticAnalysis: 'semantic-analysis'
BankStatement:    'bank-statement'
```

Ambos implementan `BackgroundJob` y se registran en `JobSchedulerService`. Se
reclaman con `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`,
renuevan lease con latido, recuperan leases vencidos y drenan en
`onModuleDestroy`. Ninguno de los dos escribe un `setTimeout` propio.

### 2. Los núcleos se conservan; sólo cambian los adaptadores

El worker A tiene arquitectura hexagonal: `application/ports.ts` deja toda la
infraestructura detrás de símbolos de inyección. Se conserva íntegro
`domain/` y `application/` —normalizador, resolutor de entidades, recuperadores
de candidatos, motor de decisión, pipeline, constructor de resultado, caché de
catálogo, guardián de presupuesto— y se reimplementan los adaptadores contra
Prisma, contra el `MetricsService` del motor y contra su orquestador de trabajos.

Del worker B se conserva íntegro el motor (`engine/`, `parsers/`, `pdf/`,
`csv/`, `json/`, `institutions/`, `domain/`) y se descartan sus controladores
HTTP y su interfaz propia, que duplicarían endpoints y una UI que el portal ya
provee.

### 3. El archivo de entrada vive en PostgreSQL, y se borra al terminar

El PDF se guarda como `Bytes` en la fila de ejecución. Es la única opción que
mantiene la garantía que el patrón del motor necesita: **la fila del job y su
entrada hacen commit juntas**, en la misma transacción que emite el `pg_notify`.
Con almacenamiento externo habría que publicar el aviso antes de confirmar la
subida, o confirmar la subida sin transacción — las dos formas de que un worker
reclame un job cuya entrada todavía no existe.

El tamaño está acotado por `BANK_STATEMENT_MAX_UPLOAD_BYTES` (10 MiB por
defecto), y **los bytes se borran en cuanto la ejecución termina**: lo que se
conserva es el resultado normalizado, no el documento bancario. Esto es a la vez
una decisión de privacidad y la razón por la que la tabla no crece sin cota.

### 4. Validación por contenido, no por extensión

La entrada se valida en el borde antes de crear el job: tamaño, número de
archivos, nombre seguro, y **firma real del contenido** (`%PDF-`), no la
extensión ni el `Content-Type` declarado por el cliente. El frontend valida
también, para dar respuesta inmediata, pero su validación no es autoritativa.

### 5. Idempotencia por clave estable

- Worker A: conserva su `idempotencyKey` acotada al tenant, tal como ya la
  define su contrato.
- Worker B: no tenía ninguna. Se deriva de la huella SHA-256 del archivo más el
  tenant, de modo que reenviar el mismo PDF devuelve la ejecución existente en
  vez de crear una segunda.

### 6. Ambos deshabilitados por defecto

`SEMANTIC_ANALYSIS_WORKER_ENABLED` y `BANK_STATEMENT_WORKER_ENABLED` gobiernan
el registro del trabajo, combinados con Y lógico con `WORKER_ROLE`, igual que
`TEST_RUN_WORKER_ENABLED`. El worker A además exige credenciales de proveedor:
sin ellas no se registra y lo dice en el log, en vez de arrancar y fallar en
cada job.

## Consecuencias positivas

- Un solo panel de operación: los dos workers nuevos emiten las mismas métricas
  `atlas_job_*` que los tres existentes, y se ven en el mismo `/metrics`.
- Un solo mecanismo de apagado, de reintento y de recuperación de leases, ya
  probado en producción.
- No entra ningún broker, ningún ORM adicional ni ningún proveedor de
  almacenamiento nuevo. Las dependencias que se añaden son las del dominio
  (`pdfjs-dist`, `csv-stringify` y el cliente del proveedor de modelo).
- Los núcleos de los dos workers quedan intactos, así que sus pruebas de
  dominio se portan sin reescribirlas y sirven de prueba de equivalencia
  funcional.

## Consecuencias negativas

- Hay que escribir los adaptadores que pg-boss regalaba: reintentos con
  retroceso, dead-letter, deduplicación y profundidad de cola. Son ~200 líneas
  contra las tablas del motor, pero son código nuevo que antes era una
  dependencia.
- Guardar PDFs en PostgreSQL no escala a documentos grandes ni a un volumen
  alto. Es correcto para extractos bancarios acotados a 10 MiB y con borrado al
  terminar; **deja de serlo** si el caso de uso crece.
- `pdfjs-dist` es pesada. Sólo la carga el proceso worker.

## Riesgos

| Riesgo                                                                 | Mitigación                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| La traducción de Sequelize a Prisma introduce una diferencia silenciosa | Las pruebas de dominio portadas actúan como equivalencia funcional                |
| Un PDF hostil agota memoria o tiempo en el worker                       | Presupuesto de tiempo por job y tamaño acotado; el fallo marca la ejecución, no tumba el proceso |
| El worker A gasta cuota de proveedor sin control                        | Se conserva su `tenant-budget.guard`, que degrada a `UNKNOWN` en vez de gastar    |
| Crecimiento de la tabla por bytes que no se borran                      | El borrado va en la misma transacción que cierra la ejecución                     |

## Evidencia

Pendiente de la Fase 5: pruebas unitarias, de integración, E2E y smoke, más la
prueba de no regresión de los tres trabajos existentes.

## Plan de revisión

Revisar si el volumen de extractos supera los ~10 000 documentos/mes o si
aparece un caso de uso con documentos por encima de 10 MiB: en cualquiera de los
dos casos, la decisión 3 (bytes en PostgreSQL) debe reconsiderarse a favor de un
almacenamiento de objetos, que entonces sí justificaría añadir el proveedor.
