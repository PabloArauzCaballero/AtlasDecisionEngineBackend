<!-- Generado desde AtlasBackend/src/modules/workflow-catalog/definitions (plan de procesos 2026-09-26). No editar a mano: se regenera. -->

# Procesos que pasan por AtlasDecisionEngineBackend

La fuente de los procesos de Atlas es **AtlasBackend** (`src/modules/workflow-catalog/definitions/`, validada por gates en CI) y se consulta en el portal admin, sección **Procesos**. Aquí sólo están los pasos que ejecuta este bloque: 14 procesos. Si un paso de esta lista cambia de ruta, hay que cambiar también su proceso en AtlasBackend (`check:process-steps` lo detecta en la siguiente regeneración de Flujos).

## P-03 · Verificación de identidad (carnet + selfie) con el Motor y arbitraje humano

`identity_verification` · prioridad **P0** · dueño `RISK_ANALYST` · ficha: [AtlasBackend/docs/processes/identity_verification.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/identity_verification.md)

| Etapa | Paso | Operación |
|---|---|---|
| Decisión automática del Motor | Ejecutar el artefacto de identidad | `POST /v1/decisions/:artifactCode` |
| Decisión automática del Motor | Lectura, autenticidad y comparación de rostros | external: Lo invoca el propio grafo del artefacto dentro del Motor; Atlas no hace una llamada HTTP separada al worker. |
| Revisión humana en la cola IDENTIDAD del Motor | Listar los casos abiertos | `GET /v1/manual-reviews` |
| Revisión humana en la cola IDENTIDAD del Motor | Abrir el caso | `GET /v1/manual-reviews/:caseId` |
| Revisión humana en la cola IDENTIDAD del Motor | Ver las imágenes de la ejecución | `GET /v1/workers/identity-verification/runs/:requestId/images/:kind` |
| Revisión humana en la cola IDENTIDAD del Motor | Tomar o asignar el caso | `POST /v1/manual-reviews/:caseId/assign` |
| Revisión humana en la cola IDENTIDAD del Motor | Resolver el caso | `POST /v1/manual-reviews/:caseId/resolve` |

## P-04 · Evaluación de riesgo del alta (Motor → ruleset local → heurística)

`onboarding_risk_assessment` · prioridad **P0** · dueño `RISK_ANALYST` · ficha: [AtlasBackend/docs/processes/onboarding_risk_assessment.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/onboarding_risk_assessment.md)

| Etapa | Paso | Operación |
|---|---|---|
| Decisión del Motor | Ejecutar el artefacto de riesgo | `POST /v1/decisions/:artifactCode` |
| Revisión en la bandeja del Motor | Abrir el caso en el Motor | `GET /v1/manual-reviews/:caseId` |
| Revisión en la bandeja del Motor | Asignarse el caso | `POST /v1/manual-reviews/:caseId/assign` |
| Revisión en la bandeja del Motor | Resolver el caso | `POST /v1/manual-reviews/:caseId/resolve` |

## P-06 · Línea de crédito, solicitud y decisión de crédito por el Motor

`credit_line_and_application` · prioridad **P0** · dueño `RISK_MANAGER` · ficha: [AtlasBackend/docs/processes/credit_line_and_application.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/credit_line_and_application.md)

| Etapa | Paso | Operación |
|---|---|---|
| Cálculo de la línea de crédito | El Motor calcula la línea | `POST /v1/decisions/:artifactCode` |
| Decisión del Motor | El Motor decide la solicitud | `POST /v1/decisions/:artifactCode` |
| Revisión humana en el Motor | Tomar el caso en el Motor | `POST /v1/manual-reviews/:caseCode/assign` |
| Revisión humana en el Motor | Resolver el caso en el Motor | `POST /v1/manual-reviews/:caseCode/resolve` |

## P-07 · Extracto bancario → capacidad de pago → recálculo de línea

`bank_statement_capacity` · prioridad **P1** · dueño `RISK_ANALYST` · ficha: [AtlasBackend/docs/processes/bank_statement_capacity.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/bank_statement_capacity.md)

| Etapa | Paso | Operación |
|---|---|---|
| El Motor lee el extracto | Enviar el PDF al worker del Motor | `POST /v1/workers/bank-statement/runs` |
| El Motor lee el extracto | Consultar la ejecución | `GET /v1/workers/bank-statement/runs/:requestId` |
| Revisión humana en el Motor | Ver la cola de extractos en revisión | `GET /v1/workers/bank-statement/reviews` |
| Revisión humana en el Motor | Tomar una revisión | `POST /v1/workers/bank-statement/reviews/:requestId/claim` |
| Revisión humana en el Motor | Resolver la revisión | `POST /v1/workers/bank-statement/reviews/:requestId/resolve` |
| Revisión humana en el Motor | Reprocesar el extracto | `POST /v1/workers/bank-statement/reviews/:requestId/reprocess` |
| Aplicar la capacidad y recalcular la línea | El Motor recalcula la línea | `POST /v1/decisions/:artifactCode` |

## P-08 · Compra con QR del comercio y desembolso del préstamo

`purchase_and_disbursement` · prioridad **P0** · dueño `OPERATIONS_MANAGER` · ficha: [AtlasBackend/docs/processes/purchase_and_disbursement.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/purchase_and_disbursement.md)

| Etapa | Paso | Operación |
|---|---|---|
| Decisión del Motor | Ejecutar el artefacto de crédito | `POST /v1/decisions/:artifactCode` |

## P-10 · Cartera: pagos, reversos, castigo, mora y calificación

`loan_servicing_collections` · prioridad **P0** · dueño `OPERATIONS_MANAGER` · ficha: [AtlasBackend/docs/processes/loan_servicing_collections.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/loan_servicing_collections.md)

| Etapa | Paso | Operación |
|---|---|---|
| Entrega de desenlaces al Motor | El Motor registra los créditos | `POST /v1/outcomes/facilities` |
| Entrega de desenlaces al Motor | El Motor recibe el lote de desenlaces | `POST /v1/outcomes/batch` |
| Medida del acierto en el Motor | Ventanas pendientes de desenlace | `GET /v1/outcomes/pending` |
| Medida del acierto en el Motor | Matriz de cosechas | `GET /v1/outcomes/vintage` |

## P-11 · Derechos del titular (ARCO), retención y supresión

`customer_privacy_dsr` · prioridad **P0** · dueño `DATA_GOVERNANCE_MANAGER` · ficha: [AtlasBackend/docs/processes/customer_privacy_dsr.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/customer_privacy_dsr.md)

| Etapa | Paso | Operación |
|---|---|---|
| Solicitud sobre decisiones automatizadas en el Motor | Registrar y resolver la solicitud en el Motor | `POST /v1/data-subject-requests` |
| Solicitud sobre decisiones automatizadas en el Motor | Consultar el historial de solicitudes del titular | `POST /v1/data-subject-requests/history` |

## P-16 · Alta de comercio: ERP pide → Motor decide (KYB) → Portal concede → ERP acusa y opera

`merchant_onboarding_chain` · prioridad **P0** · dueño `OPERATIONS_MANAGER` · ficha: [AtlasBackend/docs/processes/merchant_onboarding_chain.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/merchant_onboarding_chain.md)

| Etapa | Paso | Operación |
|---|---|---|
| El Motor decide | Ejecutar PARTNER_KYB_REVIEW | `POST /v1/decisions/:artifactCode` |
| Un analista del Motor resuelve lo dudoso | Ver la cola de revisión manual | `GET /v1/manual-reviews` |
| Un analista del Motor resuelve lo dudoso | Tomar el caso | `POST /v1/manual-reviews/:caseId/assign` |
| Un analista del Motor resuelve lo dudoso | Resolver el caso | `POST /v1/manual-reviews/:caseId/resolve` |
| El veredicto vuelve al expediente y al caso | Leer un caso del Motor | `GET /v1/manual-reviews/:caseId` |

## P-26 · Gobierno de artefactos del Motor: versión, compilación, suite bloqueante, dos firmas, despliegue y binding

`decision_artifact_governance` · prioridad **P1** · dueño `MOTOR:RISK_APPROVER` · ficha: [AtlasBackend/docs/processes/decision_artifact_governance.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/decision_artifact_governance.md)

| Etapa | Paso | Operación |
|---|---|---|
| Crear el artefacto o clonar una versión | Crear el artefacto | `POST /v1/artifacts` |
| Crear el artefacto o clonar una versión | Clonar una versión | `POST /v1/artifact-versions/:versionId/clone` |
| Editar el grafo | Leer el grafo | `GET /v1/artifact-versions/:versionId/graph` |
| Editar el grafo | Guardar el grafo | `PUT /v1/artifact-versions/:versionId/graph` |
| Editar el grafo | Notas de la versión | `PATCH /v1/artifact-versions/:versionId/notes` |
| Validar y compilar | Validar | `POST /v1/artifact-versions/:versionId/validate` |
| Validar y compilar | Compilar | `POST /v1/artifact-versions/:versionId/compile` |
| Validar y compilar | Validar y compilar de una vez | `POST /v1/artifact-versions/:versionId/validate-and-compile` |
| Suite de regresión bloqueante | Crear la suite | `POST /v1/artifact-versions/:versionId/test-suites` |
| Suite de regresión bloqueante | Añadir casos | `POST /v1/test-suites/:suiteId/cases` |
| Suite de regresión bloqueante | Lanzar la corrida | `POST /v1/test-suites/:suiteId/runs` |
| Suite de regresión bloqueante | Ejecutar la corrida | job `test-run` |
| Suite de regresión bloqueante | Ver el resultado | `GET /v1/test-runs/:runId` |
| Enviar a revisión | Enviar la versión a revisión | `POST /v1/artifact-versions/:versionId/submit-for-review` |
| Firmar la aprobación | Bandeja de solicitudes | `GET /v1/approval-requests` |
| Firmar la aprobación | Leer la solicitud | `GET /v1/approval-requests/:requestId` |
| Firmar la aprobación | Firmar el paso | `POST /v1/approval-steps/:stepId/decisions` |
| Desplegar por ambiente | Ambientes | `GET /v1/environments` |
| Desplegar por ambiente | Desplegar la versión | `POST /v1/artifact-versions/:versionId/deployments` |
| Desplegar por ambiente | Despliegues | `GET /v1/deployments` |
| Desplegar por ambiente | Revertir | `POST /v1/deployments/:deploymentId/rollback` |
| Desplegar por ambiente | Suspender | `POST /v1/deployments/:deploymentId/suspend` |

## P-27 · Ejecución de una decisión y revisión manual en el Motor con callback a Atlas

`decision_execution_and_manual_review` · prioridad **P0** · dueño `MOTOR:RISK_ANALYST` · ficha: [AtlasBackend/docs/processes/decision_execution_and_manual_review.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/decision_execution_and_manual_review.md)

| Etapa | Paso | Operación |
|---|---|---|
| Pedir la decisión | Ejecutar el artefacto | `POST /v1/decisions/:artifactCode` |
| Guardar la ejecución y abrir el caso | Abrir el caso de revisión | event: Ocurre dentro de la misma transacción que guarda la ejecución (execution-writer.service.ts); no es una llamada aparte. |
| Tomar el caso | Cola de revisión | `GET /v1/manual-reviews` |
| Tomar el caso | Leer el caso | `GET /v1/manual-reviews/:caseId` |
| Tomar el caso | Asignarse el caso | `POST /v1/manual-reviews/:caseId/assign` |
| Resolver el caso | Resolver | `POST /v1/manual-reviews/:caseId/resolve` |

## P-28 · Calidad de decisiones: desenlaces observados, monitoreo de modelo y reclamaciones

`decision_quality_and_monitoring` · prioridad **P1** · dueño `MOTOR:RISK_ANALYST` · ficha: [AtlasBackend/docs/processes/decision_quality_and_monitoring.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/decision_quality_and_monitoring.md)

| Etapa | Paso | Operación |
|---|---|---|
| Registrar los créditos desembolsados | Alta de créditos en el Motor | `POST /v1/outcomes/facilities` |
| Entregar los desenlaces | Cargar desenlaces por crédito | `POST /v1/outcomes/batch` |
| Entregar los desenlaces | Cargar desenlaces por ejecución (camino antiguo) | `POST /v1/model-monitoring/outcomes` |
| Evaluar la degradación | Evaluación periódica | job `monitoring-evaluation` |
| Revisar la calidad de las decisiones | Ventanas pendientes | `GET /v1/outcomes/pending` |
| Revisar la calidad de las decisiones | Matriz de cosechas | `GET /v1/outcomes/vintage` |
| Revisar la calidad de las decisiones | Cobertura de desenlaces | `GET /v1/model-monitoring/coverage` |
| Revisar la calidad de las decisiones | Análisis de corte | `GET /v1/model-monitoring/cutoff-analysis` |
| Monitoreo del modelo | Rendimiento | `POST /v1/model-monitoring/performance` |
| Monitoreo del modelo | Estabilidad | `POST /v1/model-monitoring/stability` |
| Monitoreo del modelo | Comparación A/B | `GET /v1/model-monitoring/ab` |
| Monitoreo del modelo | Cargar atributos protegidos | `POST /v1/model-monitoring/attributes` |
| Monitoreo del modelo | Impacto adverso | `POST /v1/model-monitoring/adverse-impact` |
| Responder a una reclamación | Buscar la ejecución | `GET /v1/audit/executions` |
| Responder a una reclamación | Recuperar la ejecución | `GET /v1/audit/executions/:executionId` |
| Responder a una reclamación | Verificar la cadena de auditoría | `GET /v1/audit/chain/verify` |

## P-29 · Workers del Motor: identidad, extracto, semántico, PDF y audio

`motor_workers` · prioridad **P1** · dueño `MOTOR:PLATFORM_ADMIN` · ficha: [AtlasBackend/docs/processes/motor_workers.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/motor_workers.md)

| Etapa | Paso | Operación |
|---|---|---|
| Catálogo y salud de los workers | Listar workers | `GET /v1/workers` |
| Catálogo y salud de los workers | Métricas de un worker | `GET /v1/workers/:code/metrics` |
| Verificar una identidad | Encolar la verificación | `POST /v1/workers/identity-verification/runs` |
| Verificar una identidad | Procesar la verificación | job `identity-verification` |
| Verificar una identidad | Leer la corrida | `GET /v1/workers/identity-verification/runs/:requestId` |
| Verificar una identidad | Ver una imagen original | `GET /v1/workers/identity-verification/runs/:requestId/images/:kind` |
| Verificar una identidad | Cancelar la corrida | `POST /v1/workers/identity-verification/runs/:requestId/cancel` |
| Revisar una identidad dudosa | Cola de revisión de identidad | `GET /v1/workers/identity-verification/reviews` |
| Revisar una identidad dudosa | Reclamar el caso | `POST /v1/workers/identity-verification/reviews/:requestId/claim` |
| Revisar una identidad dudosa | Resolver el caso | `POST /v1/workers/identity-verification/reviews/:requestId/resolve` |
| Convertir un extracto bancario | Encolar el extracto | `POST /v1/workers/bank-statement/runs` |
| Convertir un extracto bancario | Procesar el extracto | job `bank-statement` |
| Convertir un extracto bancario | Leer el resultado | `GET /v1/workers/bank-statement/runs/:requestId` |
| Convertir un extracto bancario | Descargar la conversión | `GET /v1/workers/bank-statement/runs/:requestId/download` |
| Revisar un extracto dudoso | Cola de revisión de extractos | `GET /v1/workers/bank-statement/reviews` |
| Revisar un extracto dudoso | Reclamar el extracto | `POST /v1/workers/bank-statement/reviews/:requestId/claim` |
| Revisar un extracto dudoso | Resolver el extracto | `POST /v1/workers/bank-statement/reviews/:requestId/resolve` |
| Revisar un extracto dudoso | Reprocesar | `POST /v1/workers/bank-statement/reviews/:requestId/reprocess` |
| Clasificar textos (análisis semántico) | Encolar un texto | `POST /v1/workers/semantic-analysis/runs` |
| Clasificar textos (análisis semántico) | Clasificar | job `semantic-analysis` |
| Clasificar textos (análisis semántico) | Clasificaciones sin resolver | `GET /v1/workers/semantic-analysis/unresolved` |
| Clasificar textos (análisis semántico) | Resolver una clasificación | `POST /v1/workers/semantic-analysis/unresolved/:id/resolve` |
| Clasificar textos (análisis semántico) | Purgar el texto vencido | job `semantic-retention` |
| Sintetizar audio | Encolar el audio | `POST /v1/workers/audio-tts/runs` |
| Sintetizar audio | Sintetizar | job `audio-tts` |
| Sintetizar audio | Descargar el audio | `GET /v1/workers/audio-tts/runs/:requestId/audio` |
| Imprimir un PDF | Generar el PDF | `POST /pdf/generate` |
| Referencias al almacén | Contar referencias | `GET /v1/workers/storage/references` |

## P-30 · Catálogo de sistemas: descubrimiento, introspección, narrativas, revisión humana y federación

`systems_catalog_governance` · prioridad **P2** · dueño `DATA_GOVERNANCE_MANAGER` · ficha: [AtlasBackend/docs/processes/systems_catalog_governance.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/systems_catalog_governance.md)

| Etapa | Paso | Operación |
|---|---|---|
| Federación de bloques | Manifiesto de catálogo del Motor | `GET /v1/platform/catalog-manifest` |

## P-38 · Despliegue y release: Actions → Coolify (dev), rama test (Contabo), migraciones al desplegar, verificación desde la red de Pablo

`deploy_and_release` · prioridad **P2** · dueño `SYSTEMS_ADMIN` · ficha: [AtlasBackend/docs/processes/deploy_and_release.md](https://github.com/PabloArauzCaballero/AtlasBackend/blob/dev/docs/processes/deploy_and_release.md)

| Etapa | Paso | Operación |
|---|---|---|
| Smoke del servicio publicado | Salud del Motor | `GET /health` |

