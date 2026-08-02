# Informe final de documentación del backend

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
