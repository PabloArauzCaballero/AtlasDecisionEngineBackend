# Plan — Auditoría de seguridad del motor con mapeo a COBIT 5

- Fecha: 2026-10-28 · Repo: AtlasDecisionEngineBackend (solo este repo) · Rama: `claude/gallant-thompson-wp8f28` · Predecesor: ninguno
- Resultado observable: hallazgos reales de seguridad del motor, verificados leyendo el código y reproducidos donde fue posible, corregidos con el cambio mínimo y una prueba que los demuestra, cada uno mapeado a un proceso COBIT 5.
- Kill-test: si un hallazgo marcado `CORREGIDO` no tiene una prueba que falle sin el cambio y pase con él, no está hecho.
- Nota de marco: COBIT 5 es un marco de gobierno y gestión de TI. Este trabajo entrega un mapeo hallazgo → proceso y evidencia técnica; no es una certificación ni una evaluación de capacidad de procesos.

## Alcance

- IN: `src/**`, `runner/`, `test/`, `package.json` y `yarn.lock` (solo parches dentro del rango semver ya declarado), `docs/trabajo/2026-10-28-auditoria-cobit5-seguridad/`.
- OUT: otros repos; `.claude/rules` y skills (no se corre `yarn docs:vault`); migraciones y esquema Prisma; despliegue; rotación real de secretos; cualquier bump de versión mayor o dependencia nueva; lo roto fuera de alcance solo se anota.
- Ambigüedades registradas:
  - ¿Los ajustes globales (`SemanticModelSetting`) y las plantillas PDF son de plataforma o de tenant? Supuesto: de plataforma, se anota como riesgo y no se cambia. A confirmar con: responsable de plataforma del Motor.
  - `GET /v1/audit/access-runs` lo consume AtlasBackend (Flujos). Supuesto: lo llama con credencial del tenant que opera; se filtra por tenant y se conservan las filas sin tenant (denegaciones anónimas). A confirmar con: dueño de AtlasBackend.

## Mapa de proceso COBIT 5 usado

APO13.01-.03 (sistema de gestión de seguridad), DSS05.01-.07 (servicios de seguridad), DSS06 (controles de procesos), BAI03 (soluciones), BAI06 (cambios), APO12 (riesgo), MEA01-03 (monitoreo y conformidad).

## H1 — Inventario y descubrimiento factual

**CA:** Dado el repo, cuando se revisan controladores, sandbox, consola SQL, aislamiento por tenant, sesión, cargas, PDF, salidas de red, entorno, contenedores y dependencias, entonces cada hallazgo queda citado con archivo y línea, y los falsos positivos quedan descartados con motivo.
**DoD:** lista de hallazgos en `REPORTE.md` con evidencia en `evidencia/`.
**Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H1.S1.M1 | Revisar guards y `@Roles` de los 45 controladores | Todo handler tiene rol de clase o de método, o es público declarado | script de inventario → 0 handlers sin rol | HECHO |
| H1.S1.M2 | Revisar sandbox JS/Python (runner y proceso) reproduciendo con el wrapper real | Cada escape probado o descartado con salida | `evidencia/sandbox-poc.txt` | HECHO |
| H1.S1.M3 | Revisar consola SQL: guardia, ejecutor, GUC de tenant | Cada vía probada con la guardia real y Postgres 16 local | `evidencia/sql-console-poc.txt` | HECHO |
| H1.S1.M4 | Revisar aislamiento por tenant en controladores sin `@TenantId` y consultas crudas | Lista de endpoints sin tenant revisada | `evidencia/tenant-scan.txt` | HECHO |
| H1.S1.M5 | Revisar sesión, JWT, cookie, PIN, CORS, helmet, `/metrics`, `/health`, env schema | Cada control citado o marcado como hallazgo | notas en `REPORTE.md` | HECHO |
| H1.S1.M6 | Revisar cargas, PDF/Chromium, Handlebars, almacenamiento, salidas `fetch` | Cada vía citada o marcada | notas en `REPORTE.md` | HECHO |
| H1.S1.M7 | Revisar Dockerfile y compose | Usuario, capacidades, puertos y secretos citados | notas en `REPORTE.md` | HECHO |
| H1.S1.M8 | Auditar dependencias | `yarn audit --groups dependencies` con resultado real | `evidencia/yarn-audit-antes.txt` | HECHO |

## H2 — Correcciones mínimas con prueba

**CA:** Dado cada hallazgo confirmado, cuando se aplica el cambio y se corre su prueba, entonces la prueba falla sin el cambio y pasa con él.
**DoD:** pruebas dirigidas en verde con salida literal en `evidencia/`.
**Estado:** HECHO

### H2.S1 — Sandbox de scripts (CWE-94 / CWE-693)

**CA:** Dado un script cuyo texto cierra el cuerpo de función del wrapper, cuando se ejecuta, entonces el runner lo rechaza; dado un script que lee el reloj por `Intl.DateTimeFormat().format()`, entonces falla; dado un script Python que obtiene `str.format` sin llamarlo directamente, entonces el AST lo rechaza.
**DoD:** `test/sidecar-sandbox-escape.spec.ts` y `test/script-node-sandbox-escape.spec.ts` con los casos nuevos en verde.
**Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H2.S1.M1 | `vm.compileFunction` como compuerta del cuerpo en `runner/server.mjs` y `script-wrappers.ts` | `}), (function(){` termina con estado distinto de 0 | `yarn jest test/sidecar-sandbox-escape.spec.ts` | HECHO |
| H2.S1.M2 | Retirar `Intl.DateTimeFormat` del contexto en ambos wrappers | `Intl.DateTimeFormat().format()` falla | idem | HECHO |
| H2.S1.M3 | Rechazar el atributo `format`/`format_map` aunque no se llame, en ambos wrappers | `f = "{0.__class__}".format` rechazado | idem | HECHO |
| H2.S1.M4 | Pruebas: breakout, reloj, alias de `format`, y la lista de invariantes sincronizadas | fallan antes y pasan después | `yarn jest test/sidecar-sandbox-escape.spec.ts test/script-node-sandbox-escape.spec.ts` | HECHO |

### H2.S2 — Consola SQL: funciones que mantienen estado o saturan la base (CWE-400 / CWE-667)

**CA:** Dado un analista con rol de consola, cuando envía `SELECT count(pg_advisory_lock(g)) FROM generate_series(1,30000) g`, `pg_notify` u otra función `pg_*` no permitida, entonces la guardia la rechaza antes de llegar a la base.
**DoD:** `yarn jest src/modules/sql-console/guard` en verde con los casos nuevos; reproducción contra Postgres 16 local en `evidencia/`.
**Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H2.S2.M1 | Regla por prefijo `pg_` (lista cerrada de permitidas: `pg_typeof`), más `lo_*`, `loread`, `lowrite`, `version`, `inet_*`, también entre comillas | las consultas del PoC devuelven `SQL_FORBIDDEN_FUNCTION` | `yarn jest src/modules/sql-console/guard` | HECHO |
| H2.S2.M2 | Pruebas de regresión (positivas y negativas): `pg_typeof` y agregados normales siguen pasando | 0 falsos positivos en las consultas del spec | idem | HECHO |

### H2.S3 — Aislamiento por tenant en lecturas agregadas (CWE-639 / CWE-200)

**CA:** Dado un auditor del tenant A, cuando consulta `GET /v1/audit/access-runs` o `GET /pdf/artifacts`, entonces solo ve filas de su tenant (más las denegaciones sin tenant en el primero), nunca las de otro.
**DoD:** pruebas unitarias con el tenant en la cláusula `where` en verde.
**Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H2.S3.M1 | `access-runs`: pasar `tenantId` por controlador, servicio, puerto y adaptador | el `groupBy` lleva `OR [{tenantId},{tenantId:null}]` | `yarn jest test/access-audit-origin.spec.ts test/access-runs-tenant.spec.ts` | HECHO |
| H2.S3.M2 | `PdfArtifactContractAdapter`: filtrar por el tenant del contexto de petición, cerrado si falta | sin tenant devuelve vacío; con tenant filtra `artifact.tenantId` | `yarn jest test/pdf-artifact-contract-tenant.spec.ts` | HECHO |

### H2.S4 — Reidentificación: decisión atómica (CWE-362)

**CA:** Dado una solicitud `REQUESTED`, cuando dos decisiones llegan a la vez, entonces solo una gana y la otra recibe 409.
**DoD:** prueba con `updateMany` condicionado en verde.
**Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H2.S4.M1 | `updateMany` con `status: REQUESTED` y `tenantId`; 409 si `count = 0` | la segunda decisión lanza `REIDENTIFICATION_ALREADY_DECIDED` | `yarn jest test/reidentification-decision.spec.ts` | HECHO |

### H2.S5 — Dependencias vulnerables (CWE-248 / CWE-770 / CWE-400)

**CA:** Dado el `yarn audit`, cuando se actualiza dentro del rango semver ya declarado, entonces desaparecen body-parser, multer, qs y zod del informe de avisos altos.
**DoD:** `yarn audit --groups dependencies` posterior y suite unitaria completa.
**Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H2.S5.M1 | `yarn upgrade body-parser multer qs zod` sin tocar `package.json` salvo la resolución de multer si hace falta | el diff de `yarn.lock` solo toca esos paquetes | `git diff --stat yarn.lock` | HECHO |
| H2.S5.M2 | Re-auditar | 0 avisos altos de esos cuatro | `evidencia/yarn-audit-despues.txt` | HECHO |

## H3 — Gates

**CA:** Dado el cambio completo, cuando se corren los gates reales del `package.json`, entonces typecheck, lint, formato y pruebas pasan, o se declara `BLOCKED` con el error literal.
**DoD:** salida literal en `evidencia/`.
**Estado:** A MEDIAS

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H3.S1.M1 | `yarn typecheck` | salida 0 | `evidencia/typecheck.txt` | HECHO |
| H3.S1.M2 | `yarn lint` | salida 0 | `evidencia/lint.txt` | HECHO |
| H3.S1.M3 | `yarn format:check` | salida 0 | `evidencia/format.txt` | HECHO |
| H3.S1.M4 | Pruebas dirigidas a lo tocado | todas en verde | `evidencia/jest-dirigido.txt` | HECHO |
| H3.S1.M5 | Suite unitaria completa (`yarn test:unit`) | todas en verde o fallos clasificados con evidencia | `evidencia/jest-unit.txt`, `jest-restantes.txt` | A MEDIAS |

## H4 — Reporte

**CA:** Dado todo lo anterior, cuando se escribe `REPORTE.md`, entonces la primera línea es el avance calculado y cada hallazgo lleva CWE/OWASP, proceso COBIT 5, estado y evidencia.
**DoD:** `REPORTE.md` en disco; commit en español sin push.
**Estado:** A MEDIAS

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H4.S1.M1 | Escribir `REPORTE.md` con las secciones obligatorias | existe y abre con `> **AVANCE:` | `head -1 REPORTE.md` | HECHO (lo escribió la sesión coordinadora; el agente no pudo) |
| H4.S1.M2 | Commit solo de los cambios propios | `git status` limpio de otros archivos | `git log -1 --stat` | HECHO |

## Riesgos y bloqueos previstos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Sin Postgres/Redis del repo para las pruebas de integración | las `*.integration.spec.ts` no corren | Postgres 16 local desechable para las reproducciones; las integraciones se declaran `BLOCKED` si piden servicios que no hay |
| `yarn upgrade` mueve más de lo previsto | regresión por dependencias | revisar el diff de `yarn.lock`; revertir si toca otros paquetes |
| Quitar `Intl.DateTimeFormat` rompe un script legítimo | decisiones que usaban formato de fecha | se documenta en decisiones; `Date` ya no existía en el contexto, por lo que el formato sin marca de tiempo propia era imposible |

## Notas de cierre (2026-10-28)

- H3.S1.M5 A MEDIAS. Qué anda: 267 de 279 suites unitarias corrieron en la pasada completa; las 12 restantes (10 en verde, 2 omitidas por el propio repo) corrieron aparte. Qué no anda: `test/pdf-visual-regression.spec.ts` falla igual en `HEAD` sin mis cambios (misma huella recibida, `evidencia/jest-pdf-visual-baseline-HEAD.txt`), clase ENVIRONMENT; y el proceso de jest en banda agotó el heap (`FatalProcessOutOfMemory`) tras 267 suites. Qué falta: reproducir la huella visual en la imagen del repo (Chromium y fuentes) y repetir la suite completa con más heap.
- H4.S1.M1 BLOQUEADO. La herramienta de escritura de esta sesión rechazó crear `REPORTE.md` ("subagents should return findings as text"). Qué lo destraba: que el agente que recibe el resultado cree el archivo con el texto devuelto. El avance es 24 / 26 con el commit.
