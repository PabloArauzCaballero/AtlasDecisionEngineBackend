# ATLAS Decision Engine Backend 2.0 — Entrega final de fase

**Fecha de cierre técnico:** 2026-07-16

**Fase:** endurecimiento de seguridad, auditoría, determinismo y operación

**Commit base:** `4973f7f`

## Declaración de entrega

La fase queda consolidada como un entregable técnico único: el código contiene los contratos TSDoc vigentes, el README describe el comportamiento real y este documento concentra alcance, evidencia y límites.

Se retiraron reportes históricos, bitácoras de progreso y manifiestos globales que ya no representaban el árbol actual. Este cierre no declara un Go-Live productivo.

## Alcance entregado

| Área | Resultado |
|---|---|
| Identidad de API keys | Registro persistente de clientes, credenciales, scopes y acceso por tenant. El llamante ya no declara principal ni roles. |
| Autorización | `PLATFORM_ADMIN` funciona como comodín solo para identidades firmadas; clientes técnicos requieren roles explícitos. |
| Credenciales | Rechazo opaco y uniforme de claves desconocidas, revocadas, expiradas, suspendidas o de audiencia incorrecta. |
| Denegaciones | Persistencia best-effort de 401, 403 y 429 con request, recurso, IP, status y principal cuando existe. |
| Rate limiting | Presupuesto específico para intentos de autenticación fallidos antes de los guards posteriores. |
| JWT/JWKS | Selección restringida a claves RSA de firma compatibles con RS256. |
| Configuración | Producción exige TLS para proveedores, Swagger deshabilitado y niveles de log no diagnósticos. |
| Auditoría transaccional | `AuditService.append` acepta la transacción del llamante; las 22 llamadas en los 11 servicios de negocio la propagan — cada mutación y su evidencia de auditoría confirman o revierten juntas. |
| Runtime | El ambiente forma parte del hash idempotente; fallas transitorias liberan la reserva y las deterministas se conservan. |
| Evidencia de ejecución | El writer puede participar en la transacción que confirma ejecución, idempotencia y auditoría. |
| Determinismo | Comparación de strings independiente del locale; fechas inválidas y `min`/`max` vacíos fallan cerrado. |
| Validación regex | Mitigación de ReDoS mediante rechazo estructural y límite de entrada. |
| Proveedor de variables | Timeout, indisponibilidad y respuestas HTTP fallidas generan métrica y log estructurado. |
| Logging | Stdout es el destino por defecto; archivo es opt-in y no derriba el proceso si falla. |
| Datos | Corrección del filtro temporal de auditoría y migración de deriva entre baseline y schema. |
| Despliegue | NetworkPolicy permite DNS; Docker Compose entrega al seed las credenciales y scopes bootstrap. |
| Higiene del repositorio | `backend.zip` se retiró y los ZIP/builds quedaron ignorados. |
| Aislamiento de RESULT nodes | Se cerró un escape confirmado del sandbox `vm` en modo `IN_PROCESS` (ver hallazgo abajo). |

## Cambios de datos

Las migraciones de la fase son:

1. `20260716042805_add_integration_client_registry`
2. `20260716183141_audit_access_denials`
3. `20260716184106_fix_baseline_drift`

Una instalación nueva aplica primero `20260712190000_init` y después estas tres migraciones.

El seed registra clientes bootstrap de gestión y runtime de forma idempotente. Los roles de gestión por defecto son explícitos:

```text
AUDITOR, COMPLIANCE, FRAUD_ANALYST, OPERATIONS, PLATFORM_ADMIN,
QA_ANALYST, RISK_ANALYST, RISK_APPROVER
```

## Contratos operativos definitivos

- `x-principal-id` y `x-roles` no forman parte del contrato de autenticación.
- `x-tenant-id` solo selecciona un tenant previamente autorizado para la credencial.
- Las credenciales management y runtime son distintas y tienen audiencias separadas.
- Los rechazos de seguridad nunca se convierten en 500 por una falla de auditoría.
- `LOG_OUTPUT=stdout` es el modo compatible con contenedores read-only.
- El archivo de log requiere `LOG_OUTPUT=stdout_and_file` y un volumen escribible.
- Una clave idempotente no puede reutilizarse con otro payload o ambiente.
- Una falla transitoria puede reintentarse con la misma clave idempotente.
- Los errores de negocio deterministas conservan una respuesta reproducible.

## Documentación oficial

La documentación vigente queda reducida a:

- `README.md`: operación y contrato de uso.
- `docs/ARCHITECTURE.md`: decisiones de diseño.
- `docs/API_EXAMPLES.md`: ejemplos HTTP.
- `docs/DEPLOYMENT.md`: preparación y despliegue.
- `docs/runbooks/OPERATIONS.md`: respuesta operativa.
- `docs/CONFIGURABLE_OUTPUTS.md`: salidas y scripts.
- `docs/IMPLEMENTATION_MATRIX.md`: trazabilidad entre diseño e implementación.
- `docs/plantuml/`: diagramas de diseño.
- `SECURITY.md`: política de reporte y controles mínimos.
- comentarios TSDoc en servicios, tipos y funciones públicas críticas.

`docs/VISTAS_POR_FASES.md` se conserva únicamente como backlog de producto para una fase de interfaz; no define el contrato actual del backend.

## Evidencia de verificación

Verificación ejecutada sobre PostgreSQL 16 y Redis 7 locales:

| Gate | Resultado |
|---|---|
| `prisma validate` | OK |
| Cadena de migraciones | 4 migraciones, 50 modelos/tablas, 13 enums y 134 constraints/índices nombrados |
| TypeScript | Typecheck OK |
| NestJS | Build OK |
| Unitarias e integración | 17 suites; 84 aprobadas y 2 omitidas |
| Cobertura | 31.99% statements, 28.65% branches, 33.75% functions, 31.95% lines |
| End-to-end | 6 suites; 26/26 aprobadas |
| Seed | Dos ejecuciones consecutivas con el mismo catálogo, clientes y tenants |
| Smoke runtime | 5/5 escenarios: health, decisión, replay, catálogo y cadena de auditoría |
| Docker Compose | Configuración válida |
| Dependencias productivas | 0 vulnerabilidades reportadas por `npm audit --omit=dev --audit-level=critical` |

## Límites y acciones externas

No forman parte del código cerrable de esta fase:

- integración y pruebas con IAM/JWKS productivo;
- infraestructura administrada, TLS, WAF, KMS y almacenamiento WORM;
- pruebas de carga y saturación con SLO aprobados;
- restore drill con RPO/RTO medidos;
- pentest y revisión legal de retención;
- aprobación formal de políticas, reason codes y thresholds;
- purga del historial Git y rotación de cualquier secreto que hubiera estado dentro de `backend.zip`.

Las 22 llamadas a `AuditService.append` en los 11 servicios que mutan estado (artefactos, grafo, variables, testing, gobierno, despliegues, runtime, revisión manual, trazabilidad) ya propagan la transacción de negocio — no queda ningún sitio donde la auditoría confirme de forma independiente a la acción que registra. Verificado con `typecheck`, `build`, la suite unitaria/integración (17 suites, 84 pruebas aprobadas, 2 omitidas) y e2e (6 suites, 26/26) en verde tras el cambio.

La cobertura global subió respecto del estado histórico, pero 31.99% todavía no debe tratarse como gate suficiente para producción. Las suites e2e emiten además una advertencia de compatibilidad futura de `pg` sobre consultas concurrentes; no afecta el resultado actual, pero debe resolverse antes de adoptar `pg` 9.

### Hallazgo nuevo, no previsto — escape del sandbox `vm` en `ScriptNodeRunnerService` (modo `IN_PROCESS`)

**Confirmado explotable con una prueba de concepto no destructiva** (`test/script-node-sandbox-escape.spec.ts`, antes de la corrección): un script `RESULT` en JavaScript podía ejecutar `variables.constructor.constructor("return process")()` y obtener una referencia viva al `process` del proceso hijo — es decir, ejecución de código arbitrario fuera del sandbox, con acceso a filesystem, red y capacidad de lanzar más procesos dentro del contenedor.

**Causa raíz:** `codeGeneration.strings: false` en `vm.createContext` solo restringe la generación de código *nativa de ese contexto* (`eval`/`new Function` invocados desde dentro del sandbox). No protege contra objetos creados en el realm externo e inyectados al sandbox (`variables`, `decision`, `output`, y el `Math` derivado con `Object.create(Math)`): su cadena de prototipos apunta al `Object`/`Function` del proceso externo, alcanzable vía `.constructor.constructor`, sin pasar por la restricción. Es la técnica de escape de `node:vm` más documentada — la razón por la que Node advierte explícitamente que el módulo "no es un mecanismo de seguridad".

**Corrección:** `variables`/`decision`/`output` se copian recursivamente a objetos de prototipo nulo (`Object.create(null)`) antes de entrar al contexto — como son datos JSON puros, sin funciones, esto cierra la ruta sin perder funcionalidad. `Math.random` ya no se bloquea inyectando un `Math` derivado del realm externo; se sobreescribe con `Object.defineProperty` ejecutado *dentro* del propio contexto vm, operando sobre el `Math` nativo de ese contexto — sin exponer ninguna referencia externa. `Date`/`setTimeout`/`setInterval` se dejan como antes (propiedades del objeto sandbox con valor `undefined`, definidas antes de crear el contexto: son primitivos, no hay referencia que escape).

**Alcance real del riesgo:** `SCRIPT_NODES_ENABLED` es `false` por defecto y `env.schema.ts` impide `SCRIPT_RUNNER_MODE=IN_PROCESS` cuando `NODE_ENV=production` (exige el sidecar aislado por gVisor). El vector solo era alcanzable si alguien habilitaba scripts en un ambiente no productivo — pero de haberlo hecho, la ejecución de código arbitrario en el proceso hijo era completa, no la simple "comparte filesystem/red del contenedor" que documentaba el comentario original.

**Evidencia:** `test/script-node-sandbox-escape.spec.ts` (3/3, incluye el PoC original convertido en guarda de regresión), `test/script-node-runner.spec.ts` sin cambios de comportamiento (7 pruebas, 2 omitidas en Windows por el socket Unix), suite completa (18 suites/89 pruebas) y e2e (6/6) en verde tras el cambio.

## Estado final

**Entregable técnico de fase: completado.**

**Autorización de producción: no incluida.**
