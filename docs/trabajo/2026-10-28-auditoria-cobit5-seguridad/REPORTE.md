> **AVANCE: 25 / 26 — 96,2 %.** Mide las microtareas del plan, no la cobertura de la auditoría: H3.S1.M5 (suite unitaria completa) queda A MEDIAS y los hallazgos SEC-09 y OBS-01 a OBS-07 siguen abiertos.

# Reporte — Auditoría de seguridad con mapeo COBIT 5 · AtlasDecisionEngineBackend

- Fecha: 2026-10-28 · Plan: [PLAN.md](./PLAN.md) · Rama: `claude/gallant-thompson-wp8f28` · Commit de código: `7488e02` (local al escribir este reporte)
- Peldaño de evidencia alcanzado: **TESTED** (pruebas dirigidas en verde; fallan sin el cambio donde se indica). No VERIFIED: no se ejercitó la API viva ni las suites de integración/e2e.
- Aclaración: COBIT 5 es un marco de gobierno de TI, no una norma de código. Este reporte entrega el mapeo hallazgo → proceso COBIT 5 y la evidencia técnica; **no es una certificación ni una evaluación de capacidad**.
- Nota de procedencia: el agente auditor no pudo escribir este archivo (la herramienta de escritura se lo rechazó para subagentes y no lo eludió). Lo redactó la sesión coordinadora a partir de su informe y de `evidencia/`. No se re-ejecutó ningún gate al redactarlo.

## Completado

Ocho hallazgos corregidos con prueba. Detalle de cada microtarea y su salida literal en [PLAN.md](./PLAN.md) y `evidencia/`.

| ID | Qué se logró | Verificación | Resultado |
|---|---|---|---|
| SEC-01 | La guardia de la consola SQL bloquea `pg_advisory_lock*`, `pg_notify`, `lo_*`, `inet_*` | guardia SQL 71/71 | PASS. Reproducción previa en `evidencia/sql-console-poc-*` |
| SEC-02 | `GET /v1/audit/access-runs` filtra por tenant | prueba dirigida | PASS; falla sin el cambio |
| SEC-03 | `/pdf/artifacts`, `/sample`, `/compatibility` toman el tenant del contexto de la petición y cierran si falta | prueba dirigida | PASS; falla sin el cambio |
| SEC-04 | El envoltorio del sandbox ya no permite saltar `"use strict"` ni el preámbulo con `}), (function(){` | sandbox 2 suites, 31/31 | PASS; 10 fallan sin el cambio. `evidencia/sandbox-poc-*` |
| SEC-05 | `Intl.DateTimeFormat().format()` ya no lee el reloj dentro del sandbox | idem | PASS |
| SEC-06 | Python: `str.format` y `'{0.__class__.__mro__}'.format` dejan de esquivar el rechazo | idem | PASS |
| SEC-07 | Reidentificación: la actualización lleva precondición, así que dos decisiones no se pisan (control de dos personas) | prueba dirigida | PASS; falla sin el cambio |
| SEC-08 | Dependencias: `body-parser`, `zod`, `multer`, `qs` actualizadas dentro del rango | `yarn audit` | de 4 altos + 8 moderados a 0 altos + 1 moderado |

Gates con exit 0 según el agente: `yarn typecheck`, `yarn lint`, `yarn format:check`; 5 suites dirigidas 42/42.

## A medias

### H3.S1.M5 — Suite unitaria completa (`yarn test:unit`)
- Qué anda: 267 de 279 suites corrieron en la pasada completa; las 12 restantes corrieron aparte (10 en verde, 2 omitidas por el propio repo).
- Qué no anda: `test/pdf-visual-regression.spec.ts` falla igual en `HEAD` sin los cambios de esta auditoría (misma huella recibida; `evidencia/jest-pdf-visual-baseline-HEAD.txt`), clasificado ENVIRONMENT. El proceso de jest en banda agotó el heap (`FatalProcessOutOfMemory`) tras 267 suites, también ENVIRONMENT.
- Qué falta exactamente: reproducir la huella visual en la imagen del repo (Chromium y fuentes) y repetir la suite completa con más heap.
- Dónde quedó: `7488e02`, compila; sin skip ni cambios en esos tests.

## Pendiente

| ID | Estado | Qué lo destraba |
|---|---|---|
| SEC-09 | NO CORREGIDO | `@opentelemetry/instrumentation-pg` 0.72.0 expone el usuario de la BD (GHSA-qqmp-wf37-98f9). El arreglo 0.73.0 queda fuera de `^0.72.0`: exige cambiar `package.json` y necesita aprobación. Es el único aviso moderado que queda. |
| OBS-01 | NO CORREGIDO | `variable-resolution.service.ts:219`: `VARIABLE_BACKEND` sin credencial; su respuesta alimenta decisiones de crédito. Decisión de arquitectura. |
| OBS-02 | NO CORREGIDO | `atlas-callback.dispatcher.ts:166`: `fetch` sigue redirecciones con `x-engine-callback-key`; producción no exige HTTPS para `ATLAS_BACKEND_BASE_URL`; `ENGINE_CALLBACK_API_KEY` es `min(1)`. Exigir HTTPS rompería el `http://atlas-backend` interno: confirmar. |
| OBS-03 | NO CORREGIDO | `semantic-model-settings.controller.ts:48,59`: un ajuste GLOBAL editable por `RISK_ANALYST`/`OPERATIONS` de cualquier tenant. Ambigüedad single/multi-tenant. |
| OBS-04 | NO CORREGIDO | `pdf-template-admin.controller.ts:165`: `createdBy` sale de la cabecera `x-requested-by` (ya exige clave admin en tiempo constante). |
| OBS-05 | NO CORREGIDO | `/health/*` públicos publican commit, nombres de trabajos y enrutamiento de datos. Decisión de red. |
| OBS-06 | NO CORREGIDO | `docker-compose.yml:72`: `MINIO_ROOT_PASSWORD` por omisión `atlasatlas` (solo 127.0.0.1, desarrollo). |
| OBS-07 | NO CORREGIDO | `code-import/syntax-analyzer.service.ts` usa el mismo envoltorio textual y no detecta el cierre de cuerpo al importar (el runner ya lo rechaza). |

## Hallazgos y mapeo COBIT 5

| ID | Sev. | Archivo:línea (antes) | CWE / OWASP | COBIT 5 | Estado |
|---|---|---|---|---|---|
| SEC-01 | Alta | `sql-console/guard/sql-guard/forbidden-lists.ts:70-103` | CWE-400/667, A06 | DSS05.02/.04, APO12.02 | CORREGIDO |
| SEC-02 | Media | `postgres-decision-audit-read.adapter/adapter.ts:46-91` | CWE-639/200, API1:2023 | DSS05.04, DSS06.03, APO13.01 | CORREGIDO |
| SEC-03 | Media | `artifacts/pdf-artifact-contract.adapter.ts:77-110,187` | CWE-639/200, API1 | DSS05.04, DSS06.03 | CORREGIDO |
| SEC-04 | Media | `runner/server.mjs:73-88`, `graph/script-wrappers.ts` | CWE-94/693 | BAI03.05, DSS05.02, DSS06.02 | CORREGIDO |
| SEC-05 | Baja | mismos wrappers | CWE-693 | DSS06.02, BAI03.08 | CORREGIDO |
| SEC-06 | Baja | `runner/server.mjs:127` | CWE-693/1336 | DSS05.02, BAI03.05 | CORREGIDO |
| SEC-07 | Media | `risk-governance/reidentification.service.ts:79` | CWE-362 | DSS06.03, DSS05.04 | CORREGIDO |
| SEC-08 | Alta | `yarn.lock` | CWE-248/770/400, A03 | BAI06.01, APO12.03, DSS05.01 | CORREGIDO |
| SEC-09 | Media | `@opentelemetry/instrumentation-pg` | CWE-200 | BAI06.01 | NO CORREGIDO |
| OBS-01 a OBS-07 | Media/Baja/Info | ver Pendiente | varios | DSS05.02/.03/.04, APO13.01, BAI03.05 | NO CORREGIDO |

Reproducciones: SEC-01 contra PostgreSQL 16 local con parámetros por omisión. Una transacción de solo lectura adquirió 12 000 candados de sesión que siguieron tras `COMMIT`; con 30 000, otra sesión recibió `FATAL: out of shared memory`. SEC-04/05/06 con el wrapper real.

Descartados tras leer el código: controladores sin `@Roles` (los 45 tienen rol), inyección SQL en `$queryRaw` (todo parametrizado), escape de `node:vm` (se probaron `prepareStackTrace`, `getFunction`, `callee` y errores del realm exterior; ninguno devolvió referencias externas), JWT/cookie/CORS, cargas (firma `%PDF-`, CSV con neutralización), PDF (red sellada, Handlebars cerrado), contenedores (no root, `cap_drop`, gVisor, 127.0.0.1).

## Evidencia

`evidencia/` (salida literal), entre otras: `sql-console-poc-*`, `sandbox-poc-*`, `jest-pdf-visual-baseline-HEAD.txt`, `jest-unit.txt`, `jest-restantes.txt`.

Resumen informado por el agente (no re-ejecutado al redactar este reporte): `yarn typecheck`, `yarn lint` y `yarn format:check` con exit 0; `yarn audit` tras el cambio: 0 altos y 1 moderado (SEC-09).

BLOCKED / no ejecutado: `*.integration.spec.ts` y e2e (necesitan PostgreSQL con migraciones y Redis del arnés); gVisor real.

## No cubierto

- API viva por HTTP.
- Política RLS real: los tests de tenant usan dobles de Prisma.
- PIN, intentos y enumeración de cuentas (viven en AtlasBackend; solo se verificó el límite por IP de 20/min y el `Origin`).
- Carga y fuerza bruta; imagen, Coolify, Redis y red de producción; contenido enviado a LLM o voz.
- Revisión exhaustiva de tenant en las ~1240 fuentes: barrido automatizado y lectura de los casos de riesgo.
- Los docs de contrato no se actualizaron. No se corrió `docs:vault` (no se tocaron reglas ni skills).

## Desvíos del plan

- H4.S1.M1 (este reporte) no lo escribió el agente por rechazo de la herramienta; lo escribió la sesión coordinadora.
- `package.json` quedó intacto: `yarn upgrade` lo reescribió y se revirtió; `yarn.lock` se reconcilió y `yarn install --frozen-lockfile` pasa.

## Riesgos residuales

- SEC-01: la guardia sigue siendo lista de denegación más prefijo `pg_*`. Recomendado: lista blanca de funciones, o un rol sin `EXECUTE` sobre las funciones de candados.
- Quitar `Intl.DateTimeFormat` del sandbox puede afectar scripts que lo usen con marca propia.
- `zod` subió de 4.4.3 a 4.6.7 (minor).

## Decisiones y ambigüedades

- `access-runs` filtra `OR [{tenantId}, {tenantId: null}]` para conservar las denegaciones anónimas. Confirmar con el dueño de AtlasBackend (consumidor para Flujos).
- El adaptador de PDF toma el tenant del contexto de petición y devuelve vacío si falta.
- OBS-03: confirmar si el despliegue es single-tenant o multi-tenant.
- Secretos a rotar: ninguno. Solo el valor de desarrollo `atlasatlas` (MinIO); cambiarlo si se reutiliza fuera de local.
