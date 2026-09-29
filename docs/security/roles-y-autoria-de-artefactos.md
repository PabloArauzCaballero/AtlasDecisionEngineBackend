# Roles y autoría de artefactos

Quién **da de alta** un artefacto, quién **escribe** su regla, quién la **aprueba** y quién la
**despliega**. La fuente de verdad es la doc de segregación del portal del Motor
(`AtlasDecisionEngineFrontend/docs/usuarios-roles-y-permisos.md`, con
`src/auth/business-rules.ts` y `src/auth/access-policies.ts`), y el servidor la impone con
`@Roles(...)`: ocultar un botón no autoriza nada.

## Las tres reglas

1. **Sólo `PLATFORM_ADMIN` crea artefactos.** Abrir una familia de versiones nueva no lo decide
   nadie más.
2. **La autoría es de `QA_ANALYST` y `FRAUD_ANALYST`**: grafo, versiones nuevas, notas, validar y
   compilar, referencias a subárboles, importación de código, suites, simulador, QA Lab, campos
   calculados, variables, reason codes y envío a revisión.
3. **`RISK_ANALYST` consulta; no programa.** Lee artefactos, versiones, grafos, ambientes,
   ejecuciones y auditoría, y resuelve casos de revisión manual. Fijar objetivos de negocio es
   de `COMPLIANCE`.

`PLATFORM_ADMIN` pasa cualquier ruta con identidad firmada (JWT/IdP); con API key sólo donde se
nombra explícitamente.

## Separación de funciones

El autor de una versión no firma sus pasos de aprobación ni la despliega. **Autor** es quien
creó la versión **o quien guardó su grafo** (`decision_change_log`,
`src/modules/artifacts/version-contributors.ts`). Hasta 2026-09-29 sólo contaba `createdBy`:
con el alta en `PLATFORM_ADMIN` y la autoría en QA/FRAUD, quien escribía la regla habría podido
firmar el paso de QA de su propia regla.

## Matriz (antes → ahora)

Leyenda: RA `RISK_ANALYST` · FA `FRAUD_ANALYST` · QA `QA_ANALYST` · PA `PLATFORM_ADMIN` ·
CO `COMPLIANCE` · AU `AUDITOR` · OP `OPERATIONS` · RP `RISK_APPROVER`. «Portal» es lo que el
frontend ofrece (`access-policies.ts` / `business-rules.ts`).

| Método y ruta | Antes | Ahora | Portal |
| --- | --- | --- | --- |
| `POST /v1/artifacts` | RA, FA | **PA** | PA (`ARTIFACT_CREATE_ROLES`) |
| `POST /v1/artifact-versions/:id/clone` | RA, FA | **QA, FA** | QA, FA (`CHANGE_PROPOSAL_ROLES`) |
| `PUT /v1/artifact-versions/:id/graph` | RA, FA | **QA, FA** | QA, FA (`graphAuthoring`) |
| `PATCH /v1/artifact-versions/:id/notes` | RA, FA | **QA, FA** | QA, FA (editor del grafo) |
| `PATCH /v1/artifact-versions/:id/processing-basis` | RA, FA, CO | **QA, FA, CO** | sin pantalla |
| `POST /v1/artifact-versions/:id/validate` · `/compile` · `/validate-and-compile` | RA, FA, QA | **QA, FA** | QA, FA (`artifactCompile`) |
| `POST /v1/artifact-versions/:id/submit-for-review` | RA, FA | **QA, FA** | QA, FA |
| `POST·PUT·DELETE /v1/artifact-versions/:id/references[/:ref]` | RA, FA | **QA, FA** | QA, FA (editor del grafo) |
| `POST /v1/code-imports` · `/:id/save-draft` · `/:id/confirm` · `/:id/cancel` | RA, FA | **QA, FA** | QA, FA (`codeImport`) |
| `POST /v1/artifact-versions/:id/test-suites` · `/v1/test-suites/:id/cases[/import]` · `/runs` | QA, RA, FA | **QA, FA** | QA, FA (`qualityAuthoring`) |
| `POST /v1/simulations/:code[/sample-inputs]` | RA, FA, QA | **QA, FA** | QA, FA (`simulator`) |
| `SSE /v1/live-executions` | RA, FA, QA | **QA, FA** | QA, FA (`simulator`) |
| `POST /v1/qa-lab/versions/:id/runs` · `/sample-inputs` · `/counterexamples/:id/replay` | QA, RA, FA, PA | **QA, FA, PA** | QA, FA (`qaLab`) |
| `POST /v1/calculated-fields` · `/:id/versions` · `preview/*` · `versions/:id/{try,sample-inputs,outcomes,test}` | RA, FA, PA (+QA en algunas) | **QA, FA, PA** | QA, FA (`canProposeArtifactChange`) |
| `POST /v1/calculated-fields/versions/:id/promote` | RA, FA, CO, PA | **QA, FA, CO, PA** | QA, FA |
| `POST /v1/variables` · `/v1/variables/:id/versions` | RA, FA, PA | **QA, FA, PA** | QA, FA (`createRoles`) |
| `POST /v1/reason-codes` | RA, FA, CO | **QA, FA** | QA, FA (`createRoles`) |
| `POST /v1/traceability/objectives` | RA, CO | **CO** | CO (`OBJECTIVE_AUTHORING_ROLES`) |
| `POST /v1/approval-steps/:id/decisions` | QA, RP, CO | sin cambio (+ el `requiredRole` del paso) | según paso |
| `POST /v1/artifact-versions/:id/deployments` · `rollback` · `suspend` | PA | sin cambio | ver «Discrepancia abierta» |
| Todas las lecturas (`GET` de artefactos, versiones, grafo, diff, suites, referencias, variables, ambientes, despliegues) | — | sin cambio | — |

## Discrepancia abierta

**Promover a un ambiente de trabajo.** La doc de segregación y el portal
(`canPromoteToEnvironment`) dejan a QA/FA promover a `DEV`/`STAGING`, pero
`POST /v1/artifact-versions/:id/deployments` exige `PLATFORM_ADMIN` para cualquier ambiente. Aquí
el servidor es **más estricto** que la doc, así que no hay agujero: QA/FA ven el botón y reciben
403. Abrirlo es ampliar un permiso de despliegue y lo decide el dueño.

## Cómo se comprueba

- `test/e2e/artifact-authoring-roles.e2e-spec.ts`: RA/FA/QA reciben 403 al crear; PA crea; RA
  recibe 403 al guardar el grafo, clonar, validar, compilar, enviar a revisión y anotar; QA/FA
  pasan la autorización; RA sigue leyendo.
- `test/governance-approval-guards.spec.ts`: quien guardó el grafo no firma su paso.
