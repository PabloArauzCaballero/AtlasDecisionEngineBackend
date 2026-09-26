# Informe final de documentación del backend

!!! info "Este documento tiene dos revisiones"
    La revisión de **2026-07-31** (abajo) construyó el sistema documental y cerró sus cuatro
    bloqueantes. La revisión de **2026-08-04** —[al final del documento](#revisión-2026-08-04-workers-adicionales)—
    lo contrasta con los dos workers que entraron después y **cambia el veredicto**. Léase esa
    primero si lo que se busca es el estado de hoy.

---

**Fecha:** 2026-07-31 · **Alcance:** separación de procesos de fondo, dockerización y sistema
documental completo del backend de decisión.

## 1. Resumen ejecutivo

Se abordaron dos trabajos con una relación directa: el sistema no se podía **operar**
(los trabajos de fondo competían con las decisiones en línea) ni **describir** (el contrato de
API no existía como artefacto y 24 módulos, 68 entidades y 118 variables de configuración no
estaban catalogados).

Ambos se cerraron con evidencia ejecutada, y los cuatro requisitos que quedaron abiertos en la
primera revisión se cerraron después: la deuda de esquemas de respuesta bajó de 70 operaciones
a **cero**, y las tres decisiones de negocio se tomaron y quedaron registradas en ADR
revisables. El veredicto pasó de `NO APTO` a **`APTO` con alcance declarado**.

El principio que gobernó todo el trabajo: **nunca fabricar información que no existe**. Donde la
forma real de una respuesta era incómoda, se documentó como es; donde una decisión pertenecía a
otra persona, se dijo; y donde una prueba dependía del reloj de la máquina, se cambió por una
que no puede mentir.

## 2. Estado inicial

Ver [línea base](baseline.md). Lo esencial: puertas de código en verde, pero contrato de API
inexistente como artefacto, sin gobierno, sin portal, sin modelo de amenazas, sin matriz de
trazabilidad y sin validación documental automática.

## 3. Hallazgos de Graphify

2724 nodos, 6056 relaciones, 295 comunidades. **Cero ciclos entre módulos de dominio** —
consecuencia directa de la regla de pasar las colaboraciones opcionales como argumento de
llamada. **Cero ficheros** referenciados por el grafo ausentes en disco: el grafo está alineado
con el árbol.

Detalle en [auditoría Graphify](graphify-audit.md), reproducible con
`node scripts/docs/analyze-graphify.mjs`.

## 4. Cambios realizados

### Procesos de fondo

| Cambio | Efecto |
| --- | --- |
| `WORKER_ROLE` (`ALL`/`API`/`WORKER`) | Un solo interruptor decide qué corre dónde |
| `src/worker.ts` | Proceso sin adaptador HTTP: **no puede** atender una decisión |
| `TEST_RUN_WORKER_ENABLED` | El worker de corridas era el único trabajo **sin interruptor** |
| `HealthProbeService` compartido | Una sola definición de «listo» para API y worker |
| Fallo al arrancar con `WORKER_ROLE=API` en el worker | Un error de configuración deja de producir un contenedor vivo que no procesa nada |

### Dockerización

Target `worker` sobre una base común (`runtime-base`), servicio `worker` en Compose con
escalado independiente, `worker-deployment.yaml` con estrategia `Recreate` y 60 s de gracia, y
perfil `docs` para el portal. **Una sola imagen** para las dos cargas.

### Documentación

Contrato generado de la aplicación real, referencia interactiva con Scalar, gobierno con
Redocly, portal MkDocs en modo estricto, seis catálogos generados del código, auditoría del
grafo, modelo de amenazas STRIDE, matriz de trazabilidad, 3 ADR nuevos y CI/CD documental
bloqueante.

## 5. Arquitectura documental implementada

136 páginas en el portal, de las cuales las de módulos, endpoints, entidades, eventos, errores,
variables de entorno y dependencias **se generan del código**. Ver
[ADR-0023](../adr/ADR-0023-generated-documentation.md).

## 6. Cobertura del contrato

```
Rutas: 97  Operaciones: 109  Esquemas: 221
operationId: 109/109 · summary: 109/109 · etiqueta: 109/109
seguridad: 105/105 autenticadas (+4 sondas públicas)
respuesta con esquema: 109/109 (sin deuda: la regla es fallo duro)
```

La deuda de esquemas de respuesta llegó a cero y la regla **dejó de ser un trinquete**: un
endpoint nuevo que no describa su cuerpo rompe CI. En ningún caso se fabricó un esquema
aproximado — donde la forma real era incómoda (el agregado crudo de Prisma en
`/v1/audit/metrics`, un array desnudo en los casos de suite, un retorno sin tipo fijo en un
campo calculado) se documentó **como es**, no como debería ser.

## 7. Validación con Redocly

De **217 errores** en la primera ejecución a **0**. Quedan 4 avisos, todos del mismo caso: las
cuatro sondas de salud no pueden devolver ningún `4xx` —son públicas y saltan el límite de
tasa—, así que la regla exigiría documentar un error imposible. Los 96 avisos de descripción de
parámetro se cerraron resolviéndolos **por nombre** en un mapa central, no endpoint a endpoint.

## 8. Portal MkDocs

Compila en **modo estricto**, sin enlaces rotos y sin páginas huérfanas. Se construye en
contenedor para que la versión de MkDocs forme parte del resultado.

## 9. Arquitectura C4 y ADR

Contexto, contenedores, componentes y despliegue, en Mermaid dentro del portal y en
`structurizr/workspace.dsl` como definición estructural versionable. ADR-0021 (separación de
procesos), ADR-0022 (OpenAPI como fuente de verdad) y ADR-0023 (documentación generada).

## 10. Catálogo de datos y eventos

68 entidades desde el esquema; 6 tipos de evento con su productor y consumidor reales, más
`asyncapi/asyncapi.yaml` con los payloads v1.

## 11. Seguridad

STRIDE con 24 amenazas, mitigación implementada y riesgo residual explícito. Cuatro riesgos
residuales **aceptados y justificados**. Ningún riesgo crítico sin mitigación.

## 12. Observabilidad y operación

21 métricas catalogadas, alertas propuestas con su acción, tableros especificados, SLO
propuestos y 4 runbooks. La alerta de mayor valor —relay detenido— cubre el fallo más
silencioso del nuevo reparto de procesos.

## 13. Pruebas y CI/CD

Puerta documental separada de la de código, que además detecta un contrato o unos catálogos
desactualizados comparando el resultado regenerado con lo confirmado.

## 14. Métricas finales

| Métrica | Valor | Objetivo |
| --- | ---: | ---: |
| Endpoints documentados | 100 % (109/109) | 100 % |
| Operaciones con `operationId` | 100 % | 100 % |
| Operaciones con seguridad definida | 100 % | 100 % |
| **Operaciones con esquema de respuesta** | **100 %** (era 35,2 %) | 100 % |
| Parámetros con descripción | 100 % (eran 117 sin ella) | 100 % |
| Ejemplos válidos | 100 % | 100 % |
| Módulos críticos documentados | 100 % (24/24) | 100 % |
| Entidades catalogadas | 100 % (68) | 100 % |
| Eventos documentados | 100 % (6) | 100 % |
| Variables de entorno documentadas | 100 % (118/118) | 100 % |
| Enlaces internos válidos | 100 % | 100 % |
| Páginas huérfanas | 0 | 0 |
| Errores de Redocly | 0 | 0 |
| Errores de compilación de MkDocs | 0 | 0 |
| Marcadores `TODO`/`TBD` en el portal | 0 | 0 |
| Runbooks críticos | 4 | — |
| **Riesgos críticos abiertos** | **0** | 0 |

Calculadas automáticamente: ver [métricas documentales](documentation-metrics.md).

## 15. Evidencias de comandos ejecutados

```
yarn format:check          → All matched files use Prettier code style!
yarn typecheck             → Done
yarn build                 → Done
yarn test                  → 87 suites · 692 passed · 2 skipped
yarn test:e2e              → 13 suites · 67 passed
node scripts/smoke.mjs     → 5/5 passed contra instancia real
mkdocs build --strict      → Documentation built (0 avisos)

yarn docs:openapi:generate → 97 rutas, 109 operaciones, 221 esquemas
yarn docs:openapi:check    → 109/109 con esquema de respuesta · Contrato conforme
yarn docs:openapi:lint     → Your API description is valid. 0 errores, 4 avisos
yarn docs:catalog          → 24 módulos, 109 endpoints, 68 entidades, 6 eventos,
                             164 códigos de error, 118 variables
node analyze-graphify.mjs  → 2724 nodos, 6056 relaciones, 0 ciclos, 0 ausentes
yarn docs:coverage         → 24/24 módulos · 109/109 operaciones · 118/118 variables
yarn docs:links            → 0 enlaces rotos · 0 huérfanos
structurizr validate       → exit 0
docker compose config      → OK

jest contract-conformance  → 5 passed · la respuesta real cumple el esquema declarado
jest sidecar-concurrency   → 4 passed · concurrencia probada por solapamiento, sin reloj
node dist/worker.js        → role WORKER · /health/ready {"database":"ok","cache":"redis"}
node dist/main.js (API)    → "Outbox relay not started: WORKER_ROLE=API" (y los otros dos)
GET /docs/v1/reference     → 200, la página monta el visor Scalar
```

## 16. Riesgos residuales

Los siete de la revisión anterior están cerrados o aceptados con justificación:

| # | Riesgo | Estado final |
| --- | --- | --- |
| R1 | Operaciones sin esquema del cuerpo de respuesta | **Cerrado**: 70 → 0; la regla pasó de trinquete a fallo duro |
| R2 | SLO, RTO y RPO no acordados | **Cerrado**: adoptados en ADR-0024 con revisión trimestral |
| R3 | Propietarios sin asignar | **Cerrado**: propiedad funcional por rol + `CODEOWNERS` con reserva efectiva |
| R4 | Umbral de archivado de ejecuciones | **Cerrado**: 7 años desde `executedAt` (ADR-0025) |
| R5 | Prueba de concurrencia sensible al reloj | **Cerrado**: la aserción pasó de un cociente de tiempos a **solapamiento de intervalos**, que no depende de la velocidad del equipo |
| R6 | Sin arnés de carga sostenida | **Aceptado**: pieza de infraestructura aparte, con ambiente y presupuesto propios |
| R7 | Vistas de Structurizr no renderizadas | **Cerrado con alcance reducido**: se valida el DSL en CI; el render se descartó porque la CLI que lo hacía está descontinuada y ya no produce ficheros |

### Limitaciones que quedan registradas

| # | Limitación | Por qué se acepta |
| --- | --- | --- |
| L1 | El job que archiva ejecuciones no existe todavía | La decisión está tomada y el mecanismo disponible; escribirlo es ingeniería de seguimiento, no una decisión bloqueada |
| L2 | Los equipos de GitHub de `CODEOWNERS` aún no existen | La revisión obligatoria ya es efectiva con el propietario de reserva |
| L3 | `GET /v1/audit/metrics` filtra el agregado crudo de Prisma | Documentado tal cual; limpiarlo es incompatible y exige deprecación previa |

## 17. Declaración de preparación para producción

> ## APTO PARA PRODUCCIÓN
>
> **con el alcance que se declara abajo**

Los cuatro requisitos que bloqueaban la revisión anterior están cerrados **con evidencia
ejecutada**, no con una afirmación:

| Bloqueante | Antes | Ahora | Evidencia |
| --- | --- | --- | --- |
| R1 · Esquema del cuerpo de respuesta | 38/108 | **109/109** | `docs:openapi:check`; la regla es fallo duro |
| R2 · SLO, RTO y RPO | Propuestos | **Adoptados** | ADR-0024, revisión trimestral |
| R3 · Propiedad y `CODEOWNERS` | Sin asignar | **Definida por función** | `.github/CODEOWNERS` efectivo |
| R4 · Archivado de ejecuciones | Sin decidir | **7 años desde `executedAt`** | ADR-0025 |

Y el contrato ya no solo se **declara**: se **verifica** contra las respuestas reales
(`contract-conformance.e2e-spec.ts`, 5/5).

### Qué cubre exactamente esta declaración

Cubre **el software, su documentación y su gobierno automático**: que el sistema hace lo que
dice, que está descrito con fidelidad, y que una regresión documental o contractual rompe CI.

**No** cubre lo que no pertenece a este repositorio y sigue siendo responsabilidad del proceso
de puesta en producción:

- Infraestructura administrada real (PostgreSQL, Redis, ingress, TLS, gestor de secretos).
- gVisor instalado en el anfitrión: **sin él, `runc` no es una frontera del sistema operativo** y el aislamiento del código importado deja de ser el que este documento describe.
- Un pentest y una prueba de restauración ejecutados sobre esa infraestructura.
- Las aprobaciones de Riesgo y Cumplimiento sobre el contenido de las políticas, que este sistema gobierna pero no juzga.
- Los tres puntos de la tabla de limitaciones (L1–L3), aceptados por escrito.

### Por qué el veredicto cambió

No porque se hayan relajado los criterios, sino porque el trabajo se hizo: la deuda de esquemas
pasó de 70 operaciones a cero declarando DTO reales —nunca fabricando uno aproximado—, las tres
decisiones de negocio se tomaron y quedaron en ADR revisables, y la última prueba que dependía
del reloj se sustituyó por una que no puede mentir.

Donde la forma real era incómoda, se documentó **como es**: el agregado crudo de Prisma en
`/v1/audit/metrics`, el array desnudo de los casos de suite, el retorno sin tipo fijo de un
campo calculado. Un contrato que reconoce una fealdad es utilizable; uno que la maquilla, no.

---

# Revisión 2026-08-04 — workers adicionales

**Alcance:** contrastar el sistema documental con los dos workers que entraron con
[ADR-0026](../adr/ADR-0026-additional-workers-integration.md) —análisis semántico y extractos
bancarios— y cerrar lo que faltara.

## 1. Resumen ejecutivo

La revisión no encontró documentación *ausente*, sino documentación que iba a ser **falsa**. El
código afirmaba tres cosas que no eran ciertas, y describirlas tal cual habría producido un
portal impecable sobre un sistema que no existe. Por eso el trabajo empezó corrigiendo el
producto:

1. **El motor no arrancaba sin `OPENAI_API_KEY`.** El módulo de workers construía el proveedor
   de OpenAI al cablearse, y su fábrica valida la credencial al construir. Cualquier proceso sin
   esa variable moría al iniciar — incluida una réplica de API con el worker apagado. El
   generador del contrato era una de esas víctimas: **fallaba en silencio** (código de salida 0,
   sin una línea de salida) y dejaba publicado un contrato al que le faltaban las 12 operaciones
   de `/v1/workers`, mientras el validador de calidad informaba «110/110, contrato conforme».
2. **La retención del texto analizado no se ejecutaba nunca.** La política estaba completa en el
   código y no la invocaba nadie. El texto que los usuarios envían —y que con proveedor alojado
   ya salió del perímetro una vez— se conservaba indefinidamente.
3. **El presupuesto de tiempo por defecto es incoherente**, así que la primera clasificación
   siempre falla. Se deja registrada y asignada, no corregida: la decisión es de otro dueño.

Además, la auditoría de Graphify informaba «alineado» porque solo miraba en una dirección.
Mirando en la otra, el grafo desconoce **111 de 361** ficheros de `src/` y el módulo `workers`
**entero**.

## 2. Estado inicial de esta revisión

| Puerta | Resultado al empezar |
| --- | --- |
| `yarn prisma:validate` | ✅ |
| `yarn typecheck` | ✅ |
| `yarn build` | ✅ |
| `yarn test` | ✅ |
| `generate-openapi.mjs` | ❌ **fallo silencioso** — `ZodError: OPENAI_API_KEY` |
| `yarn docs:openapi:check` | ✅ *pero sobre un contrato obsoleto* |
| `yarn docs:coverage` | ❌ módulo `workers` sin página; 21 variables sin documentar |
| `yarn docs:links` | ❌ 19 páginas huérfanas |

La sexta fila es la lección de la revisión: **una puerta en verde sobre un artefacto obsoleto
no dice nada**. El validador del contrato comprobaba con rigor un fichero que llevaba días sin
reflejar el código.

## 3. Hallazgos de Graphify

`node scripts/docs/analyze-graphify.mjs`, con la comprobación en las dos direcciones ya añadida:

```text
5003 nodos, 10304 relaciones, 25 módulos, 1 ciclo entre módulos, 14 huérfanos,
2 ficheros ausentes en disco, 111/361 ficheros de src/ ausentes del grafo
(módulos sin cubrir: workers)
```

El grafo es anterior a la fusión de los workers y el CLI `graphify` no está instalado en este
entorno, así que **no se pudo regenerar**. La auditoría lo declara en vez de disimularlo, y los
catálogos del portal se siguen generando del código y del contrato —nunca del grafo—, que es
justamente lo que impide que este desfase contamine la documentación.

## 4. Cambios realizados

| Ruta | Cambio |
| --- | --- |
| `semantic-analysis/semantic-model-provider.bridge.ts` | **nuevo** — proveedor perezoso; traduce `SEMANTIC_ANALYSIS_PROVIDER` al nombre del núcleo |
| `semantic-analysis/semantic-retention-sweeper.service.ts` | **nuevo** — trabajo `semantic-retention` |
| `workers.module.ts` | proveedor perezoso; registro de `AuditRetentionService` y del barrendero |
| `workers.dto.ts` | descripción del parámetro `format`, contrastada contra el serializador real |
| `common/openapi/openapi-document.ts` | descripción de las tres etiquetas `Workers*` |
| `common/config/env.schema.ts` | +3 variables de retención semántica, antes indeclaradas |
| `common/jobs/job-names.ts` | +`SemanticRetention` |
| `scripts/docs/analyze-graphify.mjs` | divergencia disco → grafo; verifica el registro en `app.module.ts` |
| `test/semantic-model-provider-bridge.spec.ts` | **nueva** — 5 pruebas |
| `test/semantic-retention-sweeper.spec.ts` | **nueva** — 6 pruebas |
| `docs/security/threat-model.md` | fronteras F6/F7, amenazas I7–I10 y D7–D8, dos secciones, 4 riesgos residuales |
| `docs/data/classification.md` | datos que no pasan por el contrato de variables |
| `docs/data/retention.md` | retención del texto analizado; lo que todavía no vence |
| `docs/architecture/integration-map.md` | el proveedor de modelos como salida con contenido en claro |
| `docs/AGENT-COORDINATION.md` | bitácora y deudas asignadas por nombre |

## 5. Cobertura del contrato

| Métrica | Antes | Después |
| --- | ---: | ---: |
| Rutas | 98 | **108** |
| Operaciones | 110 | **122** |
| Esquemas | 222 | **227** |
| Operaciones de `/v1/workers` | **0** | **12** |
| Etiquetas | 22 | **25** |

```text
$ node scripts/docs/generate-openapi.mjs
openapi/openapi.json escrito: 108 rutas, 122 operaciones, 227 esquemas.

$ yarn docs:openapi:check
operationId: 122/122 · summary: 122/122 · etiqueta: 122/122
seguridad: 118/118 (+4 públicas) · respuesta con esquema: 122/122
Contrato OpenAPI conforme.
```

## 6. Validaciones Redocly

```text
$ npx redocly lint openapi/openapi.json
Woohoo! Your API description is valid. 🎉
You have 4 warnings.
```

De **8 avisos a 4**. Los cuatro que quedan son las sondas de salud sin respuesta `4xx`, un caso
justificado por escrito en `redocly.yaml`: son públicas y no pueden devolver un `4xx`, así que
la regla exigiría documentar un error imposible. **Cero avisos nuevos** de los workers.

## 7. Cobertura documental

```text
$ yarn docs:coverage
Módulos documentados: 25/25
Operaciones en el catálogo: 122/122
Variables documentadas: 150/150
Runbooks: 4
Cobertura documental completa.
```

## 8. Seguridad

El modelo de amenazas se revisó porque **su propia cláusula lo exigía** —«al añadir una
integración saliente o una tabla con datos personales»— y ADR-0026 hizo ambas cosas sin que se
revisara.

- **F6 · Worker → proveedor de modelos.** La primera salida de la plataforma por la que viaja
  contenido de negocio **en claro**. Con `openai` el texto sale íntegro del perímetro; con
  `ollama` no sale. Vacío —el valor por defecto— deja el worker sin registrar.
- **F7 · Analista → worker de extractos.** Un documento bancario real. Verificado en el código:
  `file_bytes` se anula al cerrar la ejecución (éxito, fallo permanente y cancelación), la
  cuenta solo se publica enmascarada, y el CSV neutraliza la inyección de fórmulas.
- **I7–I10** y **D7–D8**, cada una con su riesgo residual, más cuatro riesgos residuales
  nuevos aceptados explícitamente.

Verificado y no supuesto: las seis tablas nuevas tenant-scoped llevan `ENABLE ROW LEVEL
SECURITY` y su política `tenant_isolation` en el SQL de la migración.

## 9. Datos

`decision_semantic_analysis_run.input_text` y `decision_bank_statement_run.file_bytes` no pasan
por el contrato de variables, así que no tienen `sensitivityClass` y su tratamiento se fija por
tabla en [clasificación](../data/classification.md). La retención del texto quedó documentada
**con su mecanismo**, no solo con su intención — precisamente porque el mecanismo faltaba.

## 10. Pruebas

11 pruebas nuevas, todas ejecutadas:

```text
$ node scripts/run-jest.mjs --runInBand semantic-retention-sweeper semantic-model-provider-bridge
Test Suites: 2 passed, 2 total
Tests:       11 passed, 11 total
```

Una de ellas no comprueba que algo funcione, sino que fija la aritmética del desajuste de G32,
para que el día que alguien lo corrija la prueba se lo diga.

## 11. Métricas finales

| Métrica | Objetivo | Real |
| --- | ---: | ---: |
| Endpoints documentados | 100 % | **122/122** ✅ |
| Operaciones con `operationId` | 100 % | **122/122** ✅ |
| Operaciones con seguridad definida | 100 % | **118/118** (+4 públicas) ✅ |
| Respuestas con esquema | 100 % | **122/122** ✅ |
| Módulos documentados | 100 % | **25/25** ✅ |
| Variables de entorno documentadas | 100 % | **150/150** ✅ |
| Reglas Redocly con **error** | 0 | **0** ✅ |
| Avisos de Redocly | — | 4, justificados por escrito |
| Enlaces internos válidos | 100 % | **4 rotos** ❌ |
| Páginas huérfanas | 0 | **7** ❌ |
| MkDocs `--strict` | compila | **no compila** ❌ |
| Brechas `BLOCKER` abiertas | 0 | **0** ✅ |
| Brechas `HIGH` abiertas | 0 | **2** ❌ |

## 12. Riesgos residuales de esta revisión

| Riesgo | Naturaleza | Estado |
| --- | --- | --- |
| El presupuesto por defecto del proveedor no cuadra con el lease (G32) | Producto | Asignado al dueño del worker; aritmética fijada en una prueba |
| 4 enlaces rotos y 7 huérfanas del trabajo de observabilidad (G33) | Documental | Asignado a su autor |
| El grafo de Graphify desconoce el 31 % de `src/` | Documental | Declarado; el CLI no está instalado en este entorno |
| Las evidencias se tomaron sobre un **árbol compartido en movimiento** | Metodológico | Declarado abajo |
| El PDF de una ejecución que nunca se procesa no vence | Producto | Documentado en retención y en el modelo de amenazas |

!!! warning "Sobre la reproducibilidad de estas evidencias"
    Otro agente escribía en el mismo árbol de trabajo mientras se ejecutaban estas puertas, y se
    pidió continuar aun así. Las salidas de arriba son reales y se tomaron después de cada
    cambio, pero **no son reproducibles bit a bit** sobre un árbol que cambiaba entre comandos.
    La forma de reproducirlas es ejecutar `yarn docs:validate` sobre un árbol quieto.

## 13. Declaración de preparación para producción

> ## NO APTO PARA PRODUCCIÓN
>
> **y lo que lo bloquea es exactamente esto:**

| # | Requisito del encargo | Estado | Quién lo cierra |
| --- | --- | --- | --- |
| 6 | «MkDocs compila estrictamente sin enlaces rotos» | ❌ 4 enlaces rotos, 7 páginas huérfanas | Agente de observabilidad (G33) |
| — | `yarn typecheck` en verde | ❌ `runtime-failed-audit.spec.ts:59` pasa 11 argumentos a un constructor que pide 12 | Agente de observabilidad |
| 15 | «Toda limitación restante registrada, justificada y **aceptada**» | ❌ G32 registrada y justificada; falta la aceptación | Dueño del worker semántico |

**Ninguno de los tres es de este agente**, y ninguno se ha maquillado para poder declarar el
cierre. Los tres son concretos, tienen dueño nombrado en
[`AGENT-COORDINATION.md`](../AGENT-COORDINATION.md) y se cierran en horas, no en semanas.

### Lo que sí queda cerrado

El contrato describe el 100 % de la superficie HTTP real y vuelve a generarse; el sistema
arranca sin credenciales de terceros; el texto de los usuarios deja de retenerse para siempre;
las dos fronteras de confianza nuevas están modeladas con su riesgo residual; y la auditoría del
grafo dejó de afirmar una alineación que no existía.

### Por qué el veredicto bajó de `APTO` a `NO APTO`

No porque el sistema haya empeorado, sino porque **entró código nuevo entre una revisión y la
siguiente** y la anterior no lo cubría. Es exactamente el comportamiento que se le pide a este
mecanismo: que una capacidad nueva sin su contrato, su modelo de amenazas y su documentación
**rompa el cierre** en vez de pasar desapercibida.

Declararlo `APTO` con la puerta documental en rojo habría sido el fallo que el encargo prohíbe:
cerrar por apariencia en lugar de por evidencia.
