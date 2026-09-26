# Modelo de amenazas (STRIDE)

Alcance: el backend de decisión, sus contenedores y sus integraciones. Cada amenaza indica la
mitigación **implementada** y el riesgo residual real.

## Fronteras de confianza

| # | Frontera | Qué la cruza |
| --- | --- | --- |
| F1 | Internet → API | Peticiones de canales, integraciones y portal |
| F2 | API → PostgreSQL | Todo el estado |
| F3 | API → sidecar de scripts | Código importado por un analista |
| F4 | API → proveedores externos | Variables e identidad |
| F5 | Operador → contenedores | Configuración y secretos |
| F6 | Worker → proveedor de modelos | **Texto de negocio en claro**, cuando el proveedor es alojado (ADR-0026) |
| F7 | Analista → worker de extractos | Un documento bancario real, en PDF (ADR-0026) |

!!! danger "F6 es la única frontera por la que sale contenido de negocio en claro"
    Las demás salidas llevan identificadores, credenciales o telemetría. Con
    `SEMANTIC_ANALYSIS_PROVIDER=openai` el texto que se clasifica se envía **íntegro** a
    `api.openai.com`, fuera del perímetro y bajo el tratamiento de datos de un tercero. Con
    `transformer` no sale del despliegue. La elección es de cumplimiento antes que técnica:
    si el texto puede contener datos personales, `transformer` es la opción que mantiene la
    frontera cerrada. Ver [aislamiento del análisis semántico](#f6-análisis-semántico-y-datos-de-terceros).

---

## S · Suplantación

| ID | Amenaza | Mitigación | Riesgo residual |
| --- | --- | --- | --- |
| S1 | Un llamante declara ser otro con una cabecera | `x-principal-id`/`x-roles` no existen; la identidad sale del registro o del token | **Bajo** |
| S2 | Reutilización de una API key filtrada | Hash en reposo, audiencia acotada, tenants explícitos, rotación que invalida la anterior | **Medio** — una clave filtrada sirve hasta que se rota. Requiere vigilar `decision_access_audit` |
| S3 | Token falsificado | Verificación contra JWKS: emisor, audiencia, expiración, desfase | **Bajo** |
| S4 | Suplantación del proveedor de identidad | HTTPS obligatorio en producción | **Bajo**, sujeto a la PKI de la organización |

## T · Manipulación

| ID | Amenaza | Mitigación | Riesgo residual |
| --- | --- | --- | --- |
| T1 | Alterar una decisión ya emitida | Auditoría append-only con disparadores y permisos revocados | **Muy bajo** |
| T2 | Modificar un artefacto aprobado | Solo el borrador es editable; el compilado lleva checksum | **Bajo** |
| T3 | Inyección por entrada | Validación estricta; Prisma parametriza; `safe-regex` contra ReDoS | **Bajo** |
| T4 | Escape del sandbox para alterar el proceso | Prototipo nulo, dunder y `str.format` bloqueados, sin red, gVisor, cotas | **Medio** — un sandbox es una carrera permanente; el contenedor sin red acota el daño |
| T5 | Manipular el esquema desde la aplicación | El rol de aplicación no puede alterar el esquema | **Bajo** |

## R · Repudio

| ID | Amenaza | Mitigación | Riesgo residual |
| --- | --- | --- | --- |
| R1 | «Yo no aprobé esa versión» | Evento de auditoría en la misma transacción que el voto, encadenado por hash | **Muy bajo** |
| R2 | «Esa decisión no se tomó así» | Snapshot de entradas, traza y artefacto compilado inmutable | **Muy bajo** |
| R3 | Pérdida del secreto de firma | Rotación con clave identificada por evento y secretos retirados para verificar | **Medio** — perder el secreto **y** su respaldo deja la cadena inverificable |

## I · Divulgación de información

| ID | Amenaza | Mitigación | Riesgo residual |
| --- | --- | --- | --- |
| I1 | Un tenant lee datos de otro | RLS + rol no superusuario + tenants permitidos; recurso ajeno responde `404` | **Bajo** |
| I2 | PII en registros | Redacción de credenciales y PII; sin `stderr` crudo de subprocesos | **Bajo** |
| I3 | PII en la evidencia | HMAC, no hash desnudo | **Bajo** |
| I4 | Detalle interno en un error | En producción el `500` no lleva mensaje interno; `/health/ready` no revela el fallo del driver | **Bajo** |
| I5 | Superficie de API expuesta | Swagger prohibido en producción | **Bajo** |
| I6 | Secretos en el contrato publicado | El validador falla si detecta un patrón con forma de secreto | **Bajo** |
| I7 | El texto analizado sale del perímetro hacia un proveedor alojado | Es el funcionamiento pedido, no un fallo: se acota eligiendo `SEMANTIC_ANALYSIS_PROVIDER=transformer`, que resuelve en local | **Alto con `openai`, muy bajo con `transformer`** — con proveedor alojado el control pasa a ser contractual, no técnico |
| I8 | El texto analizado se retiene para siempre en la base | Barrida periódica: se minimiza a su huella a los `SEMANTIC_ANALYSIS_MINIMIZE_AFTER_DAYS` y se purga a los `SEMANTIC_ANALYSIS_AUDIT_RETENTION_DAYS` | **Bajo** — la política existía y no se ejecutaba; ver la nota de retención más abajo |
| I9 | El PDF del extracto queda almacenado tras procesarse | `file_bytes` se anula al terminar (éxito, fallo permanente o cancelación); solo persiste el contrato normalizado, ya enmascarado | **Medio** — una ejecución que se queda en `QUEUED` porque el worker está apagado conserva su PDF sin plazo |
| I10 | El número de cuenta completo llega al cliente o a una descarga | El contrato normalizado solo expone `accountNumberMasked`; los serializadores del paquete original, que publicaban la cuenta entera, se eliminaron | **Bajo** |

## D · Denegación de servicio

| ID | Amenaza | Mitigación | Riesgo residual |
| --- | --- | --- | --- |
| D1 | Inundación de peticiones | Límite por ventana con estado compartido | **Medio** — sin WAF por delante, el límite es de aplicación |
| D2 | Script que consume CPU o memoria | Timeout, cotas de memoria, pids y CPU; admisión con 503 | **Bajo** |
| D3 | Consulta que agota la memoria | Paginación acotada; auditoría recorrida por lotes; sin filtrado genérico | **Bajo** |
| D4 | Cadena de artefactos desbocada | Presupuesto: artefactos, tiempo total, por salto, tamaño y memoria retenida | **Bajo** |
| D5 | Crecimiento sin cota de idempotencia | Purga por lotes con margen | **Bajo** |
| D6 | Cuerpo de petición enorme | `BODY_LIMIT_BYTES` | **Bajo** |
| D7 | Un tenant agota la cuota del proveedor de modelos —y su coste— para todos | Presupuesto por tenant y ventana (`SEMANTIC_ANALYSIS_BUDGET_MAX_ANALYSES`), cota de intentos y `SEMANTIC_ANALYSIS_MAX_TEXT_LENGTH` | **Medio** — el presupuesto acota el número de análisis, no lo que cada uno cuesta en tokens |
| D8 | Un PDF manipulado agota CPU o memoria al parsearse | Cota de tamaño (`BANK_STATEMENT_MAX_UPLOAD_BYTES`), un solo archivo por petición, tipo MIME fijo y lease con reintentos acotados | **Medio** — el parseo corre en el proceso del worker, no en el sandbox aislado de los scripts |

## E · Elevación de privilegios

| ID | Amenaza | Mitigación | Riesgo residual |
| --- | --- | --- | --- |
| E1 | Una API key se atribuye `PLATFORM_ADMIN` | El comodín solo se honra en identidad firmada; cubierto por prueba | **Muy bajo** |
| E2 | Autor aprueba su propia versión | Segregación de funciones en el servidor, 20 pruebas | **Muy bajo** |
| E3 | Escape del contenedor | Sin privilegios, capacidades eliminadas, raíz de solo lectura, gVisor | **Medio** — depende de que gVisor esté realmente instalado en el anfitrión |
| E4 | Escalada por dependencia vulnerable | `yarn audit` en CI, CodeQL, Trivy, revisión de dependencias | **Medio** — vulnerabilidades de día cero |

---

## F6 · Análisis semántico y datos de terceros

El worker de análisis semántico (ADR-0026) es la primera capacidad de la plataforma que
**envía contenido de negocio a un servicio ajeno**. Conviene tratarlo como una decisión de
cumplimiento con dos configuraciones posibles, no como un detalle de despliegue.

| | `SEMANTIC_ANALYSIS_PROVIDER=transformer` | `SEMANTIC_ANALYSIS_PROVIDER=openai` |
| --- | --- | --- |
| Dónde se resuelve | En el despliegue | En `api.openai.com` |
| Qué sale del perímetro | Nada | El texto a clasificar, íntegro |
| Control sobre la retención del tercero | No aplica | Contractual, no técnico |
| Credencial | `TRANSFORMER_API_KEY` (opcional) | `OPENAI_API_KEY` (obligatoria) |
| Apto para texto con datos personales | Sí | **Solo con base legal y encargo de tratamiento** |

Vacío —el valor por defecto— significa que el worker **no se registra**: la capacidad viene
apagada y encenderla es un acto explícito.

!!! warning "La retención de este texto no se ejecutaba"
    `AuditRetentionService` implementaba la política completa —minimizar primero, purgar
    después— pero nada la invocaba: el planificador que la disparaba en el paquete original se
    descartó al absorberlo. En la práctica `input_text` se conservaba **indefinidamente**, y
    las dos variables que lo gobiernan ni siquiera estaban declaradas en el esquema de entorno.
    Corregido con el trabajo de fondo `semantic-retention`
    ([`semantic-retention-sweeper.service.ts`](https://github.com/)), que aplica ambos plazos y
    se registra en las réplicas que corren trabajos de fondo.

## F7 · Extractos bancarios

Un extracto es el dato más sensible que entra a la plataforma: identifica a una persona, su
entidad y su comportamiento financiero completo.

- **El documento no se conserva.** `file_bytes` se anula al cerrar la ejecución —con éxito,
  con fallo permanente o por cancelación—. Lo que persiste es el contrato normalizado.
- **La cuenta se publica enmascarada** en el resultado, en la descarga y en el catálogo.
- **Subir exige más rol que ejecutar un escenario.** Un fixture es sintético y versionado; un
  archivo es un documento real. Los escenarios, además, dependen de `WORKERS_FIXTURES_ENABLED`.
- **La idempotencia va por SHA-256 del contenido**, no por el nombre: reenviar el mismo
  documento devuelve la ejecución existente en vez de volver a almacenarlo.
- **El CSV neutraliza la inyección de fórmulas** (`=`, `+`, `-`, `@`): la glosa de un
  movimiento es texto que escribió un tercero y acaba en una hoja de cálculo.

## Riesgos residuales aceptados

| Riesgo | Por qué se acepta | Qué lo compensa |
| --- | --- | --- |
| Una API key filtrada sirve hasta rotarse | Es la naturaleza de un secreto compartido | Auditoría de accesos, alcance acotado, rotación documentada |
| El sandbox es una carrera permanente | Ninguna defensa de sandbox es definitiva | Contenedor sin red y con cotas: el daño queda contenido aunque el escape ocurra |
| Sin WAF, D1 depende del límite de aplicación | Corresponde a la infraestructura de la organización | Límite por ventana y `AUTH_FAILURE_RATE_LIMIT` |
| gVisor debe existir en el anfitrión | La plataforma no controla el clúster | Documentado como requisito de producción |
| Con `openai`, la retención en el tercero es contractual | Es inherente a delegar la inferencia | `transformer` mantiene la frontera cerrada; la capacidad viene apagada por defecto |
| El presupuesto por tenant cuenta análisis, no tokens | Un texto largo cuesta más que uno corto y el contador no lo distingue | `SEMANTIC_ANALYSIS_MAX_TEXT_LENGTH` acota el peor caso por análisis |
| El PDF de una ejecución que nunca se procesa no vence | No hay barrida para `QUEUED` huérfanos del worker de extractos | Encolar exige rol; la cota de tamaño y la unicidad por hash limitan la acumulación |
| El PDF se parsea en el proceso del worker | `pdfjs-dist` no corre en el sandbox de gVisor que aísla los scripts | Cota de tamaño y de intentos; el worker es un proceso aparte de la API |

## Revisión

Este modelo se revisa al añadir un endpoint que exponga datos nuevos, una integración saliente,
una tabla con datos personales o un mecanismo de ejecución de código.
