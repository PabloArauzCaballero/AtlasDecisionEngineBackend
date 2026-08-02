# Verificación integral del backend — 2026-07-28

Este reporte existe para que Producto, Riesgo, Compliance y Plataforma sepan qué evidencia técnica
respalda el backend y qué riesgos todavía necesitan una decisión externa. A nivel de sistema congela
el entorno, los defectos corregidos y la salida real de los gates; no equivale a una autorización de
Go-Live ni reemplaza IAM real, pentest, carga, restore o aprobación de políticas.

## Entorno aislado

- Proyecto Compose temporal: `atlas-doc-audit`.
- PostgreSQL 16: `localhost:55434`, base `atlas_decision_doc_audit`.
- Redis 7: `localhost:6381`.
- Migraciones/seed: rol administrador `atlas`; aplicación/pruebas: rol no-superusuario `atlas_app`
  para ejercer RLS real.
- API local: `localhost:3101`; imagen de producción: `localhost:3102`.
- La infraestructura compartida existente en 55432/6379 no se modificó.

## Defectos detectados y corregidos

1. El build emitía `dist/src/main.js`, pero package, Docker y CI arrancaban `dist/main.js`. El build
   ahora incluye sólo `src/**` y se verificó el entrypoint real.
2. Las etapas Docker compartían un cache Yarn concurrente y podían corromper tarballs; luego
   `yarn cache clean` fallaba al intentar borrar el mount activo. Se separaron caches, se retiró la
   limpieza inútil y se instaló OpenSSL donde Prisma genera/ejecuta tooling.
3. `@opentelemetry/api` era sólo una dependencia transitiva pese a ser peer requerido; ahora forma
   parte explícita del contrato productivo.
4. Los secretos completos de `.env.example` eludían la protección productiva por una comparación
   exacta contra prefijos más cortos. La validación ahora rechaza cualquier valor de ejemplo y
   valida al arrancar el mapa JSON de claves HMAC retiradas.
5. Tres opciones operativas usadas por auditoría (`ACCESS_AUDIT_QUEUE_MAX`,
   `ACCESS_AUDIT_RETRY_SECONDS`, `AUDIT_VERIFY_BATCH_SIZE`) no pertenecían al schema, por lo que la
   configuración era descartada silenciosamente. Ya están validadas y documentadas.
6. Live execution y el timeout de análisis Code → Flow estaban declarados pero no aplicados. El
   stream ahora es opt-in, emite heartbeat, valida que variables sea un objeto, prohíbe PROD y
   redacta errores; Python respeta el timeout configurado.
7. Code → Flow podía traducir ramas que omitían outputs requeridos. Ahora conserva todos los
   outputs o degrada explícitamente a `SCRIPT`, sin inventar un grafo incompleto.
8. IDs, tenant claims, cursores y `If-Match` podían exceder BIGINT/INTEGER y llegar a Prisma como
   500. Los límites se validan en la frontera; además los DTOs respetan las longitudes `VarChar`.
9. Un perfil de identidad fuera del rango de PostgreSQL se trataba como credencial inválida o podía
   fallar después. Ahora es un contrato upstream 502, mientras JWT inválido permanece 401.
10. Una entrada Redis corrupta derribaba la decisión. El resolver la invalida y consulta la fuente
    de verdad PostgreSQL.
11. `baselineCompiledArtifactId` era aceptado pero ignorado. Hasta que exista persistencia de
    comparación, devuelve 422 para impedir evidencia de regresión falsa.
12. El validador de migraciones comprobaba deriva, pero no cobertura RLS. Ahora exige `ENABLE`,
    `FORCE` y policy `tenant_isolation` para toda tabla del schema con `tenant_id`.
13. Smoke y runtime E2E usaban el contrato antiguo de siete variables, mientras la demo gobierna
    KYC, fraude, crédito, capacidad de pago y AML. Comparten un solicitante sintético completo y una
    prueba evita que el fixture vuelva a divergir.
14. Live/outbox E2E dependían accidentalmente de flags del shell. Los overrides se aplican dentro
    del contenedor Nest antes de `app.init()`, por lo que las suites son autosuficientes.

## Gates y evidencia real

| Gate | Resultado | Evidencia |
|---|---|---|
| `yarn prisma:validate` | PASS | Schema Prisma válido. |
| `yarn migration:validate` | PASS | 24 migraciones, 58 modelos/tablas, 16 enums y 173 constraints/índices; RLS cubierto. |
| Migración desde vacío | PASS | Las 24 migraciones aplicaron en PostgreSQL 16 aislado. |
| `yarn format:check` | PASS | Todo `src`, `test` y `prisma` cumple Prettier. |
| `yarn typecheck` | PASS | TypeScript estricto sin errores. |
| `yarn build` | PASS | `dist/main.js` generado y `dist/src/main.js` ausente. |
| `yarn test:cov` | PASS | 63 suites; 406 tests PASS, 2 SKIP declarados; 50.14% statements, 53.13% branches, 48.36% functions, 50.57% lines. |
| `yarn test:e2e` | PASS | 11 suites; 58 tests PASS contra PostgreSQL/Redis reales. |
| `yarn security:audit` | PASS | 0 vulnerabilidades en dependencias productivas auditadas. |
| OpenAPI vivo | PASS | 88 operaciones; 0 sin summary; 0 `operationId` duplicados. |
| Smoke vivo | PASS | 5/5: health, decisión, replay idempotente, catálogo y cadena de auditoría. |
| Imagen runtime | PASS | Build multi-stage; contenedor en `NODE_ENV=production`, usuario `node`, health Docker healthy, DB y Redis ready. |
| Documentación estructural | PASS | Cada carpeta mantenida tiene Markdown; 184 archivos productivos TS/MJS contienen JSDoc; enlaces relativos válidos. |

## Límites que permanecen abiertos

- La comparación automática contra un compiled artifact baseline sigue fuera del modelo actual.
- El buffer de denegaciones sobrevive caídas breves de DB, no reinicios de proceso; la durabilidad
  regulatoria fuerte requiere un sink externo/WORM.
- Retención legal por país/categoría, IAM/JWKS real, proveedores, carga, restore, DAST/pentest y
  observabilidad administrada requieren infraestructura, credenciales y responsables externos.
- La cobertura global no es un objetivo por sí sola: priorizar los servicios de artefactos,
  despliegue y runtime con menor cobertura directa, además de mantener el E2E existente.

La API y la imagen superan los gates ejecutables dentro del repositorio, pero el estado correcto es
**release candidate verificado**, no “producción definitiva”.
