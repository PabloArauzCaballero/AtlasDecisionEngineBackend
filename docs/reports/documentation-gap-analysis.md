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
| ✅ Cerradas | 25 |
| 🔴 Abiertas | 2 |

Las dos abiertas son:

| ID | Qué falta | Por qué sigue abierta |
| --- | --- | --- |
| G21 | Arnés de carga sostenida (k6/Gatling con umbrales de SLO) | Fuera de alcance por decisión: es una pieza de infraestructura con su propio ambiente y presupuesto, y montarla a medias produce números que nadie se cree |
| G28 | Descripción de parámetros que no están en el mapa común | Aparecerá como aviso de Redocly en cuanto alguien añada un nombre nuevo. Es la presión que mantiene la lista viva, no una deuda pendiente |

**No queda ninguna brecha `BLOCKER` ni `CRITICAL` abierta.**
