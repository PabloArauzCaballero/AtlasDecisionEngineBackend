# Análisis de brechas documentales

Cada brecha detectada frente al estándar objetivo, con su evidencia, su acción concreta y su
estado. Sin acciones vagas del tipo «mejorar la documentación».

## Clasificación

| Nivel | Significado |
| --- | --- |
| `BLOCKER` | Impide afirmar que está listo para producción |
| `CRITICAL` | Riesgo alto de integración, seguridad u operación |
| `HIGH` | Ausencia relevante de claridad o trazabilidad |
| `MEDIUM` | Mejora necesaria, no bloqueante |
| `LOW` | Optimización editorial |

---

## Brechas cerradas

| ID | Área | Elemento real | Evidencia | Brecha | Riesgo | Acción ejecutada | Validación | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G01 | API | 108 operaciones | Swagger solo en runtime | Sin artefacto de contrato versionado | `BLOCKER` | `generate-openapi.mjs` genera `openapi/openapi.json` de la app real | `yarn docs:openapi:generate` | ✅ |
| G02 | API | Contrato generado | 217 errores de Redocly | Sin gobierno del contrato | `CRITICAL` | `redocly.yaml` + etiquetas globales + errores universales centralizados | `yarn docs:openapi:lint` → 0 errores | ✅ |
| G03 | API | `/health` y `/health/live` | Mismo `operationId` | Un cliente generado sobrescribiría un método | `CRITICAL` | Métodos separados con identificadores propios | `docs:openapi:check` | ✅ |
| G04 | API | 108 operaciones | Sin `operationId` estable | Clientes generados frágiles | `HIGH` | `operationIdFactory` derivado del código | 108/108 | ✅ |
| G05 | API | Errores | Sin modelo documentado | El integrador no sabe qué manejar | `CRITICAL` | `ProblemDetails` + 401/403/429/500 inyectados | `docs:openapi:check` | ✅ |
| G06 | Operación | 3 trabajos de fondo | Corrían en cada réplica de API | No se podía escalar el plano de decisión | `CRITICAL` | `WORKER_ROLE` + `dist/worker.js` + sondas | `worker-role.spec.ts`, salida real | ✅ |
| G07 | Operación | Worker de corridas | **Sin interruptor** | Imposible una réplica solo-API | `HIGH` | `TEST_RUN_WORKER_ENABLED` + rol | Salida real del proceso | ✅ |
| G08 | Arquitectura | 24 módulos | Sin catálogo | Nadie sabía qué hace cada uno | `HIGH` | Página por módulo generada del código | `docs:coverage` 24/24 | ✅ |
| G09 | Datos | 68 entidades | Sin catálogo | Modelo de datos opaco | `HIGH` | Catálogo generado del esquema | `docs:catalog` | ✅ |
| G10 | Eventos | 6 tipos | Sin catálogo ni AsyncAPI | Integraciones asíncronas a ciegas | `HIGH` | Catálogo con productor y consumidor + `asyncapi.yaml` | `docs:catalog` | ✅ |
| G11 | Configuración | 105 variables | Sin documentar | Configuración por prueba y error | `HIGH` | Catálogo generado del esquema | `docs:coverage` 105/105 | ✅ |
| G12 | Seguridad | — | Sin modelo de amenazas | Riesgos no evaluados | `CRITICAL` | STRIDE con 24 amenazas y riesgo residual | Revisión | ✅ |
| G13 | Gobierno | — | Sin matriz de trazabilidad | Afirmaciones sin respaldo | `HIGH` | Matriz negocio → código → contrato → datos → prueba | Revisión | ✅ |
| G14 | Documentación | — | Sin portal | Documentos sueltos e inencontrables | `HIGH` | MkDocs Material dockerizado, modo estricto | `docs:build` | ✅ |
| G15 | Documentación | — | Sin validación automática | La documentación envejecía en silencio | `CRITICAL` | `docs:validate` en CI | Ejecutado | ✅ |
| G16 | Observabilidad | 21 métricas | Sin catálogo ni alertas | Métricas sin lectura operativa | `HIGH` | Catálogo, alertas y tableros propuestos | Revisión | ✅ |
| G17 | Operación | — | Sin runbooks de contratos/campos/QA | Procedimientos improvisados | `HIGH` | 3 runbooks nuevos | Revisión | ✅ |
| G18 | Arquitectura | Grafo Graphify | Sin contraste con el disco | Documentación derivada de un grafo desfasado | `MEDIUM` | Auditoría reproducible: 0 ficheros ausentes | `analyze-graphify.mjs` | ✅ |

---

## Brechas abiertas

| ID | Área | Elemento real | Brecha | Riesgo | Acción concreta | Validación | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| G19 | API | **0** de 109 operaciones (eran 70) | El cuerpo de la respuesta no estaba descrito en el contrato | `CRITICAL` | **Cerrada.** Envoltorios compartidos (`ApiPagedResponse`, `ApiKeysetResponse`, `ApiItemsResponse`, `ApiArrayResponse`) más un DTO de respuesta por módulo. En ningún caso se fabricó un esquema aproximado: un contrato que miente sobre la forma es peor que uno que reconoce no describirla | `109/109`. El trinquete llegó a 0 y la regla **pasó a fallo duro**: un endpoint nuevo sin esquema rompe CI | ✅ Cerrada |
| G20 | Pruebas | Contrato | No se verificaba que la respuesta real **coincidiera** con el esquema declarado | `HIGH` | `test/e2e/contract-conformance.e2e-spec.ts` valida cuerpos reales contra `openapi/openapi.json` con Ajv: sondas, envoltorio de paginación, DTO propios y el sobre de error del filtro global | La propia suite; ya detectó un endpoint cuyo esquema faltaba en el contrato publicado | ✅ Cerrada |
| G21 | Pruebas | Carga sostenida | Sin arnés k6/Gatling con umbrales de SLO | `MEDIUM` | Pieza de infraestructura aparte; requiere ambiente y presupuesto propios | — | 🔴 Abierta por decisión |
| G22 | Pruebas | `sidecar-concurrency.spec.ts` | La concurrencia se afirmaba con un **cociente de tiempos de pared** (`cuatro < una × 2.5`), que mide también la carga de la máquina: fallaba por ~5 % de margen sin ninguna regresión | `MEDIUM` | Sustituida por **solapamiento de intervalos**: si el servidor ejecutara en serie, ningún par podría solaparse por rápido o lento que sea el equipo. La aserción dejó de depender del reloj | `lastStart < firstFinish` | ✅ Cerrada |
| G23 | Operación | Objetivos de servicio | Propuestos, no acordados | `HIGH` | Adoptados formalmente en [ADR-0024](../adr/ADR-0024-slo-rto-rpo-adoption.md), sujetos a revisión trimestral | ADR aceptado | ✅ Cerrada |
| G24 | Datos | `decision_execution` | Umbral de archivado sin decidir | `MEDIUM` | 7 años desde `executedAt`, configurable por tenant, en [ADR-0025](../adr/ADR-0025-execution-archival-threshold.md) | ADR aceptado | ✅ Cerrada |
| G25 | Gobierno | Propiedad | Áreas definidas, propietarios sin asignar | `HIGH` | Propiedad **funcional** por rol de plataforma más `.github/CODEOWNERS` con reserva efectiva hoy | Fichero en el repositorio | ✅ Cerrada |
| G26 | API | 117 parámetros | Sin descripción (aviso de Redocly) | `LOW` | **Cerrada de forma centralizada**, no endpoint a endpoint: `COMMON_PARAMETER_DESCRIPTIONS` en `openapi-document.ts` describe por NOMBRE los parámetros que se repiten (`versionId` sale en 23 operaciones, `search` en 7). Nunca pisa una descripción existente, así que un endpoint con un matiz propio gana; y un nombre no listado sigue produciendo aviso, que es la presión que mantiene la lista viva | `redocly lint`: 96 → **0** avisos de `parameter-description` | ✅ Cerrada |
| G27 | Arquitectura | Structurizr | El workspace DSL no se comprobaba en CI | `LOW` | **Cerrada como validación, no como render.** `structurizr/cli validate` corre en CI (exit 0 verificado). El `export` **no** se añadió: esa CLI está descontinuada y su exportación ya no produce ficheros —sale con código 0 y sin salida, comprobado— y renderizar sería redundante porque los diagramas que se leen viven como Mermaid en el portal. Lo que el DSL aporta es ser la definición estructural versionable, y eso es lo que `validate` protege | Paso de CI | ✅ Cerrada con alcance reducido y justificado |

---

## Brechas de la revisión del 2026-08-04 (workers adicionales)

La integración de los dos workers (ADR-0026) entró después de la tanda anterior. Revisar el
sistema real contra el portal sacó cinco brechas nuevas, tres de ellas por delante de la
documentación: eran defectos del producto que la documentación se habría limitado a describir
mal.

| ID | Área | Elemento real | Evidencia | Brecha | Riesgo | Acción | Validación | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G29 | API / Arranque | 12 operaciones de `/v1/workers` | `generate-openapi.mjs` salía con código 0 y **sin escribir**; `openapi.json` se quedó en 110 operaciones | `workers.module.ts` construía el proveedor de OpenAI al cablear el módulo y su fábrica valida `OPENAI_API_KEY` al construir: **ningún proceso arrancaba sin esa clave**, ni una réplica de API con el worker apagado | `BLOCKER` | `semantic-model-provider.bridge.ts`: construcción perezosa en la primera clasificación, y traducción de `SEMANTIC_ANALYSIS_PROVIDER` al nombre que lee el núcleo | `generate-openapi.mjs` → 122 operaciones; `semantic-model-provider-bridge.spec.ts` | ✅ |
| G30 | Datos / Privacidad | `decision_semantic_analysis_run.input_text` | `AuditRetentionService` implementado y **no registrado**; ningún trabajo lo invocaba | El texto analizado —que con proveedor alojado ya salió del perímetro— se conservaba **indefinidamente**. Sus dos variables ni siquiera estaban en `env.schema.ts`, así que ajustarlas no hacía nada | `CRITICAL` | Trabajo `semantic-retention` (`semantic-retention-sweeper.service.ts`) + 3 variables declaradas | `semantic-retention-sweeper.spec.ts` (6 pruebas); `docs:coverage` 150/150 | ✅ |
| G31 | Seguridad | Fronteras F6 y F7 | El propio modelo exige revisarse «al añadir una integración saliente o una tabla con datos personales»; ADR-0026 añadió ambas y no se revisó | Sin amenazas para la salida de texto a un tercero ni para el PDF bancario | `CRITICAL` | F6/F7, amenazas I7–I10 y D7–D8, secciones propias y 4 riesgos residuales; tratamiento por tabla en clasificación y retención | Revisión contra el código, no contra la intención | ✅ |
| G32 | Configuración | Presupuesto de tiempo del proveedor | `assertProviderTimeoutFitsAnalysis` exige `timeout × intentos × 2 ≤ analysisTimeoutSeconds`. Por defecto: OpenAI 30 s × 3 × 2 = **180 s** contra un presupuesto de **110 s** (lease 120 − 10). Ollama, 120 s contra 110 s | Con los valores por defecto la primera clasificación **siempre** falla con `SemanticConfigurationError` | `HIGH` | **No corregida aquí.** Mover el lease o los tiempos del proveedor tiene efectos distintos sobre la recuperación de ejecuciones muertas: la decisión es del dueño del worker. Registrada en `docs/AGENT-COORDINATION.md` | La aritmética queda fijada en `semantic-model-provider-bridge.spec.ts` | 🔴 Abierta y asignada |
| G33 | Documentación | `docs/docker/`, `docs/observability/00-`, `01-`, `ADR-0027` | `docs:links`: 4 enlaces rotos, 7 páginas huérfanas | Páginas en curso de otro agente que enlazan a 4 ficheros que aún no existen; `mkdocs build --strict` no pasa | `HIGH` | **No corregida aquí.** Inventar esas páginas o meterlas en la navegación sería documentar lo que no existe y pisar trabajo ajeno. Registrada en `docs/AGENT-COORDINATION.md` | `yarn docs:links` | 🔴 Abierta y asignada |
| G34 | Arquitectura | Auditoría de Graphify | Solo comprobaba grafo → disco, y por eso informaba «alineado» | La dirección que hace daño es la contraria: **111 de 361** ficheros de `src/` no están en el grafo, incluido el módulo `workers` **entero**. Consultarlo sobre ellos devuelve vacío, que se lee igual que «no existe» | `MEDIUM` | `analyze-graphify.mjs` comprueba las dos direcciones, informa la cobertura real y verifica el registro en `app.module.ts` en vez de afirmarlo | Salida real del script | ✅ |

!!! note "Por qué tres de estas brechas se corrigieron en el código y no en la documentación"
    G29, G30 y G32 no eran documentación ausente: eran afirmaciones **falsas** que el código
    ya hacía. El esquema decía que el texto «se minimiza al vencer el plazo»; el módulo decía
    que el proveedor «se construye pero nunca se invoca». Documentar eso tal cual habría
    producido un portal impecable describiendo un sistema que no existe. La regla del encargo
    —corregir el código o registrar la deuda— se aplicó en ese orden.

---

## Desviaciones deliberadas del árbol documental propuesto

| Propuesto | Implementado | Razón |
| --- | --- | --- |
| `modules/<nombre>/` con 11 ficheros por módulo | Una página por módulo con las mismas secciones | 24 × 11 = 264 ficheros; generados serían casi vacíos. La misma información, navegable y auto-actualizada |
| `data/data-dictionary.md` separado | Fusionado en el catálogo de entidades | El diccionario campo a campo **es** el catálogo; separarlos duplicaría la fuente |
| `openapi/overlays/` | No creado | No hay hoy ninguna sobrecarga que aplicar. Crear la carpeta vacía sería un marcador sin contenido |

## Cómo se cerró G19

| Familia | Forma declarada |
| --- | --- |
| Listados por desplazamiento | Envoltorio `PageMetaDto` + `items`, con DTO de elemento por módulo |
| Listado por cursor | Envoltorio `KeysetMetaDto` (sin `total`, a propósito) |
| Catálogos cerrados | `{ items }` no paginado, con DTO de elemento |
| Array desnudo | Array sin envoltorio: describirlo con `{items}` habría mentido |
| Respuestas propias | DTO específico por operación (sondas, contadores, verificación de cadena, métricas, preludes, catálogo de operaciones, detalle de cada dominio) |

Tres hallazgos al declararlas. El contrato ahora refleja **lo que es**, no lo que debería ser:

- `GET /v1/audit/metrics` filtra el agregado de Prisma sin mapear (`latencyMs._avg.durationMs`). Se documenta tal cual; renombrarlo rompería a los consumidores actuales y describirlo con nombres limpios haría que el contrato mintiera. Candidato a cambio **con deprecación previa**.
- `GET /v1/test-suites/{suiteId}/cases` devuelve un array desnudo, no un envoltorio. Por eso existe `ApiArrayResponse`: un cliente generado a partir de `{items}` buscaría una propiedad que no llega.
- `CalculatedFieldTryRunDto.value` se declaraba `type: object` con `example: 0.42` — el esquema contradecía a su propio ejemplo, y Redocly lo rechazó. El retorno de un campo calculado puede ser número, texto, booleano, objeto o lista según su `dataType`, así que ahora se declara como `oneOf` de esas ramas, con la nulabilidad **dentro** de cada una (OpenAPI 3.0 exige un `type` junto a `nullable`).

## Resumen

| Estado | Cantidad |
| --- | --- |
| ✅ Cerradas | 29 |
| 🔴 Abiertas | 4 |

Las cuatro abiertas son:

| ID | Qué falta | Riesgo | Por qué sigue abierta |
| --- | --- | --- | --- |
| G21 | Arnés de carga sostenida (k6/Gatling con umbrales de SLO) | `MEDIUM` | Fuera de alcance por decisión: es una pieza de infraestructura con su propio ambiente y presupuesto, y montarla a medias produce números que nadie se cree |
| G28 | Descripción de parámetros que no están en el mapa común | `LOW` | Aparecerá como aviso de Redocly en cuanto alguien añada un nombre nuevo. Es la presión que mantiene la lista viva, no una deuda pendiente |
| G32 | Presupuesto por defecto del proveedor de modelos incoherente con el lease | `HIGH` | Es una decisión de diseño del dueño del worker semántico, no una omisión documental. La aritmética está fijada en una prueba y anotada en la bitácora de coordinación |
| G33 | 4 enlaces rotos y 7 páginas huérfanas del trabajo de observabilidad en curso | `HIGH` | Son páginas de otro agente, a medias en el árbol compartido. Completarlas o esconderlas de la navegación sería documentar lo inexistente o pisar su trabajo |

**No queda ninguna brecha `BLOCKER` abierta.** Las dos `HIGH` abiertas (G32 y G33) están
asignadas nominalmente en [`docs/AGENT-COORDINATION.md`](../AGENT-COORDINATION.md); ninguna
de las dos es de este agente y ambas impiden hoy declarar el cierre — ver el
[informe final](final-validation.md).
