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

## «Nueva versión» del KYB sale con 18 errores (v12)

Es la vía normal de publicar la versión del KYB que abre caso en la cola (`kyb-revision-manual.mjs`
hace lo mismo por guion). El 2026-10-07 el borrador de `PARTNER_KYB_REVIEW` (v12, «Validación con
errores») no compilaba: `UNDECLARED_INTERMEDIATE_REFERENCE` / `INTERMEDIATE_NOT_DECLARED` sobre
`requisitos_faltantes` y `senales_operativas`, más los avisos de contrato de salida y finalidad.

**Causa:** `ArtifactService.cloneVersion` copiaba nodos, condiciones, acciones y aristas, pero no lo que
la versión **declara**: variables intermedias, contrato de salida, scripts de nodo, campos calculados,
ni la finalidad, la base legal y la política de sujeto. Cualquier «Nueva versión» de un artefacto con
intermedias salía inservible.

**Arreglo:** la clonación copia las cuatro tablas y esas columnas
(`test/artifact-clone-declarations.spec.ts`). **Un borrador ya creado antes del arreglo NO se
repara solo**: hay que descartarlo y volver a hacer «Nueva versión» desde la versión desplegada.

## Cómo se arregla la causa 0 (probado el 2026-10-07)

1. Publicar la versión que abre caso: `MANAGEMENT_API_KEY=… node scripts/kyb-revision-manual.mjs --base <Motor> --environments STAGING`
   (clona la vigente, convierte `REVISAR` en `MANUAL_REVIEW` de la cola `MERCHANT_KYB`, corre la suite de 9 casos y la manda a revisión).
2. Firman **dos personas distintas** en el portal del Motor (Gobierno → Revisiones): `QA_ANALYST` y luego `RISK_APPROVER`. Quien corrió el guion no puede firmar.
3. Desplegar: `… node scripts/kyb-revision-manual.mjs --deploy <versionId> --environments STAGING`.
4. En ≤5 minutos el job `sync_partner_kyb_reviews` reevalúa los expedientes pendientes y el caso aparece en la cola.

## El candado

`node scripts/verificar-artefactos-publicados.mjs --base <Motor> --environments STAGING --exigir-despliegue`
sale 1 con `SIN BANDEJA PARTNER_KYB_REVIEW (REVISAR es RESULT)` si la versión DESPLEGADA no abre caso.
Antes sólo comprobaba «publicado» y «desplegado», y los dos estaban en verde con este defecto.
Hay que correrlo al dar por listo un entorno.
