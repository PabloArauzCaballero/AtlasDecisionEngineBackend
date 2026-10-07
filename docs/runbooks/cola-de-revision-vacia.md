# La cola de Revisión Manual sale vacía y el expediente del comercio no aparece

## Qué pasó

El 2026-10-07 Pablo abrió la «Cola de Revisión Manual» del Motor de TEST y estaba vacía: ninguna de
las solicitudes que Atlas manda «a decisión humana» se veía, y un comercio que esperaba aprobación
no tenía su expediente para decidirlo. Eran **tres causas independientes**; basta una para que la
cola esté vacía.

| #   | Causa                                                                                                                                                                                                                                                                                                               | Síntoma                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | El Motor sólo abre caso desde un nodo `MANUAL_REVIEW` del grafo. AtlasBackend **retiene** veredictos que el grafo aprobó (`DECISION_ENGINE_AUTO_APPLY`, por omisión sólo `credit`), y la versión base de `PARTNER_KYB_REVIEW` tiene `REVISAR` como `RESULT`: el desenlace dice `REVISION_MANUAL` pero no crea nada. | El comercio queda `under_review` con `manual_review_case_code` nulo; la cola del Motor no lo tiene. |
| 2   | AtlasBackend pregunta por el caso con su **código** (`GET /v1/manual-reviews/MR-…`) y la ruta sólo aceptaba el id numérico: 400 `INVALID_ID` siempre.                                                                                                                                                               | Lo que una persona decide en el Motor nunca vuelve; el expediente queda «en revisión» para siempre. |
| 3   | `PARTNER_KYB_REVIEW` sin despliegue activo en el ambiente (en TEST, `STAGING`): el Motor responde 422/`ACTIVE_DEPLOYMENT_NOT_FOUND`.                                                                                                                                                                                | «Enviar a revisión» falla; no hay ejecución, así que tampoco hay caso.                              |

## La garantía (qué lo impide de ahora en adelante)

- **Un expediente en revisión siempre tiene caso.** AtlasBackend, tras evaluar, pide el caso al Motor
  por la vía que ya usaba identidad —`PUT /v1/manual-reviews/by-execution/:executionId/onboarding-dossier`
  con `openIfMissing` (cola `MERCHANT_KYB`, prioridad 50, 24 h)—. Es idempotente por ejecución. Si el
  Motor no responde, `sync_partner_kyb_reviews` (cada pasada) abre los que faltan: log
  `partner_kyb_case_opened`, contador `opened` en el resultado del job.
- **El caso se lee por código o por id.** `GET|POST /v1/manual-reviews/:caseId` acepta `MR-…`.
- Un caso **cerrado o cancelado no se reabre** (el Motor responde 409): cancelar devuelve el
  expediente a la decisión local a propósito.
- La causa 3 no la arregla código: es un artefacto sin publicar. Ver
  [artefactos en un entorno nuevo](artefactos-en-un-entorno-nuevo.md).

## Diagnóstico (sólo lectura)

1. ¿Hay despliegue activo? `MANAGEMENT_API_KEY=… node scripts/verificar-artefactos-publicados.mjs --base <Motor>`
   (sale 0 sólo si todos están desplegados).
2. ¿Qué grafo corre? Si `REVISAR` es `RESULT`, falta la versión que abre caso:
   `node scripts/kyb-revision-manual.mjs` (publica la versión con nodo `MANUAL_REVIEW` en la cola
   `MERCHANT_KYB`; la firman dos personas y se despliega). Ya no es imprescindible para que el caso
   exista, pero sí para que el Motor lo abra con la traza del grafo.
3. Expedientes sin caso, en la base de AtlasBackend:
   `SELECT id, decision_outcome, decision_execution_id FROM partner_profiles WHERE onboarding_status='under_review' AND manual_review_case_code IS NULL AND decision_execution_id IS NOT NULL;`
   Con el job activo deben irse a cero en una pasada. Si no, el Motor no responde o la llave de
   ejecución (`DECISION_ENGINE_API_KEY`) no tiene el rol `DECISION_RUNTIME`.
4. Casos de comercios en el Motor: la cola `MERCHANT_KYB` del portal, o
   `SELECT case_code, status FROM decision_manual_review_case WHERE queue_code='MERCHANT_KYB';`

## Qué NO hacer

- No aprobar el comercio «a mano» en Atlas mientras exista caso: el job lo sobrescribiría con lo que
  decida el Motor (y la consola ya lo rechaza con `PARTNER_DECISION_DELEGADA_AL_MOTOR`).
- No dar un entorno por listo porque «Enviar a revisión» devolvió 200: comprobar que el caso aparece
  en la cola.
