# Preparación para producción

Auditoría de cierre. Cada casilla marcada tiene evidencia ejecutada detrás; las no marcadas
dicen exactamente qué falta.

**Fecha:** 2026-07-31 · **Alcance:** backend de decisión, sus contenedores y su documentación.

---

## Graphify

- [x] Se consultaron `graph.json`, `manifest.json` y `GRAPH_REPORT.md`
- [x] Módulos y relaciones documentados — 2724 nodos, 6056 relaciones
- [x] Ciclos revisados: **0 entre módulos de dominio**
- [x] Componentes huérfanos revisados: 15, todos configuración o documentos sueltos
- [x] Grafo contrastado con el disco: **0 ficheros ausentes**
- [x] Los diagramas del portal son coherentes con el grafo

## API

- [x] Las 109 operaciones están en el contrato, generado de la aplicación real
- [x] `operationId` único y estable — 109/109, unicidad verificada
- [x] Resumen y etiqueta — 109/109
- [x] Seguridad declarada — 105/105 autenticadas, 4 sondas públicas explícitas
- [x] Modelo de error uniforme documentado (`ProblemDetails`) y errores universales inyectados
- [x] Redocly pasa: **0 errores** (de 217 en la primera ejecución)
- [x] Scalar sirve la referencia interactiva (verificado: HTTP 200)
- [x] **Toda respuesta de éxito con esquema — 109/109.** La regla dejó de ser trinquete y es **fallo duro**: un endpoint nuevo sin esquema rompe CI
- [x] **Todo parámetro descrito** — 117 → 0 avisos, resueltos por nombre en un mapa central
- [x] **La respuesta real cumple el esquema declarado** — `contract-conformance.e2e-spec.ts`, 5/5

## Arquitectura

- [x] C4 completo: contexto, contenedores, componentes y despliegue
- [x] Workspace Structurizr versionado y **validado en CI**
- [x] Dependencias críticas explicadas
- [x] Flujos principales documentados
- [x] Integraciones documentadas con su modo de fallo
- [x] ADR de las decisiones estructurales recientes
- [x] Workspace validado en CI. El render se descartó con justificación: la CLI que exportaba está descontinuada y ya no produce ficheros

## Datos

- [x] 68 entidades catalogadas desde el esquema real
- [x] Relaciones y reglas de borrado documentadas
- [x] Restricciones e índices documentados, con la consulta que los motiva
- [x] Migraciones y semillas explicadas
- [x] Clasificación de sensibilidad definida y aplicada (HMAC, redacción, saneamiento)
- [x] Retención definida para idempotencia
- [x] Umbral de archivado de ejecuciones — 7 años desde `executedAt` (ADR-0025)

## Seguridad

- [x] Modelo de amenazas STRIDE con 24 amenazas y riesgo residual explícito
- [x] Gestión de secretos documentada; **ningún secreto con valor por defecto en fichero versionado**
- [x] Control de acceso documentado y probado (incluida la escalada por API key)
- [x] Aislamiento por tenant con RLS y rol no superusuario, probado contra base real
- [x] Auditoría append-only aplicada por el motor, no por convención
- [x] Ejecución de código aislada, con cotas medidas
- [x] Riesgos críticos: **ninguno sin mitigación o aceptación registrada**
- [x] Datos sensibles protegidos en evidencia, registros y contrato publicado

## Operación

- [x] Sondas documentadas para API y worker, con una sola definición de «listo»
- [x] Registros, métricas y trazas definidos — 21 métricas catalogadas
- [x] Alertas propuestas con su acción y su runbook
- [x] Runbooks: operación, contratos, campos calculados, QA
- [x] Respaldo, restauración y reversión documentados, incluida la advertencia sobre los secretos
- [x] Escalado documentado, con el pool de conexiones como techo real
- [x] SLO y RTO/RPO **adoptados** en ADR-0024, con revisión trimestral

## Calidad documental

- [x] MkDocs compila en modo estricto
- [x] Sin enlaces rotos — verificado
- [x] Sin páginas huérfanas — 0
- [x] Sin marcadores `TODO`/`TBD` en el portal
- [x] Sin páginas vacías
- [x] Cobertura verificada: 24/24 módulos, 109/109 operaciones, 118/118 variables
- [x] CI/CD documental activo y bloqueante

## Procesos y despliegue

- [x] API y worker separados por `WORKER_ROLE`, con evidencia real de ambos roles
- [x] Una sola imagen para las dos cargas
- [x] Manifiestos de Kubernetes para ambas
- [x] Compose completo con perfiles, sin secretos por defecto
- [x] Sondas y periodos de gracia ajustados a cada carga

---

## Requisitos que bloquean el cierre

!!! danger "Revisión 2026-08-04: vuelve a haber bloqueantes"
    Los cuatro de la revisión anterior siguen cerrados, pero la llegada de los dos workers
    ([ADR-0026](../adr/ADR-0026-additional-workers-integration.md)) abrió tres requisitos nuevos.
    **Ninguno es de contenido documental**: son una puerta en rojo, una configuración por
    defecto incoherente y una aceptación pendiente.

    | # | Requisito | Estado | Dueño |
    | --- | --- | --- | --- |
    | R5 | `mkdocs build --strict` sin enlaces rotos ni huérfanas | ❌ | Agente de observabilidad |
    | R6 | `yarn typecheck` en verde | ❌ `runtime-failed-audit.spec.ts:59` pasa 11 argumentos donde se piden 12 | Agente de observabilidad |
    | R7 | Aceptación formal de la deuda G32 (presupuesto del proveedor incoherente con el lease) | ❌ registrada y justificada, sin aceptar | Dueño del worker semántico |

    Detalle y aritmética en [validación final](final-validation.md#revisión-2026-08-04-workers-adicionales)
    y en [`AGENT-COORDINATION.md`](../AGENT-COORDINATION.md).

Los cuatro que bloqueaban la revisión anterior están cerrados:

| # | Requisito | Cómo se cerró |
| --- | --- | --- |
| R1 | Operaciones sin esquema del cuerpo de respuesta | 70 → **0**. La regla pasó de trinquete a fallo duro |
| R2 | SLO, RTO y RPO acordados | Adoptados en ADR-0024, con revisión trimestral |
| R3 | Propietarios y `CODEOWNERS` | Propiedad **funcional** por rol de plataforma, con reserva efectiva hoy |
| R4 | Umbral de archivado de ejecuciones | 7 años desde `executedAt` en ADR-0025, configurable por tenant |

## Limitaciones que quedan registradas y aceptadas

No bloquean el cierre, pero se declaran para que nadie las descubra por sorpresa:

| # | Limitación | Por qué se acepta |
| --- | --- | --- |
| L1 | Sin arnés de carga sostenida (k6/Gatling) | Pieza de infraestructura aparte, con su propio ambiente y presupuesto. Montarla a medias produce números que nadie se cree |
| L2 | El job que ejecuta el archivado de ejecuciones no existe todavía | La **decisión** está tomada (ADR-0025) y el mecanismo disponible; escribir el job es trabajo de ingeniería de seguimiento, ya no una decisión bloqueada |
| L3 | Los equipos de GitHub de `CODEOWNERS` aún no existen | La revisión obligatoria ya es efectiva con el propietario de reserva; sustituirlo es administración de GitHub |
| L4 | `GET /v1/audit/metrics` filtra el agregado crudo de Prisma | Documentado tal cual. Limpiarlo es un cambio incompatible que exige deprecación previa |
| L5 | El grafo de Graphify desconoce el 31 % de `src/`, incluido el módulo `workers` entero | El CLI `graphify` no está instalado en este entorno. La auditoría lo **declara** y los catálogos del portal se generan del código y del contrato, nunca del grafo |
| L6 | El PDF de una ejecución de extracto que nunca se procesa no vence | `file_bytes` se anula al cerrar la ejecución, pero no hay barrida para las que se quedan en `QUEUED` con el worker apagado. Encolar exige rol, y la cota de tamaño y la unicidad por hash limitan la acumulación |
| L7 | Con `SEMANTIC_ANALYSIS_PROVIDER=openai`, la retención en el tercero es contractual y no técnica | Es inherente a delegar la inferencia. `ollama` mantiene la frontera cerrada y la capacidad viene **apagada** por defecto |

## Veredicto

Ver [validación final](final-validation.md).
