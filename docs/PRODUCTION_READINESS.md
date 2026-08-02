# ATLAS Decision Engine 2.0 — Production Readiness

## Estado honesto

Esta versión está **endurecida y preparada como release candidate**, pero no debe declararse “producción definitiva” hasta completar IAM/JWT real, pruebas de carga, recuperación, pentest, observabilidad externa, secretos administrados y validación de migraciones contra la infraestructura objetivo.

## Mejoras incorporadas en 2.0

- JWT RS256/JWKS con issuer, audience, tenant y roles; modo híbrido para transición.
- Rate limiting distribuido en Redis por tenant, principal, audiencia y ruta.
- Contexto de request mediante AsyncLocalStorage y logging JSON estructurado.
- Métricas Prometheus, latencias, decisiones, errores y endpoint protegido.
- Timeouts de solicitud, límites de body, CORS allowlist, Helmet y shutdown ordenado.
- Pool PostgreSQL explícito con límites y timeouts de conexión/sentencia.
- Redis obligatorio en producción, namespace y fallback solo fuera de producción.
- Errores estilo problem-details sin filtrar stack traces en producción.
- Health/liveness/readiness separados.
- Paginación del servidor en inventarios y auditoría.
- Contenedores separados para migración y runtime; la API no ejecuta seeds al arrancar.
- Runtime no root, filesystem de solo lectura y capacidades Linux eliminadas en Compose.
- RLS forzado por tenant mediante el rol de aplicación no-superusuario `atlas_app`.
- Outbox transaccional, relay con lease/dead-letter y proyección idempotente de notificaciones.
- Árboles anidados versionados, importación Code → Flow y previsualización SSE opt-in.
- Catálogo de vistas, controles operativos y brechas de API documentados.

## Gates obligatorios antes de Go-Live

| Gate | Evidencia requerida | Responsable |
|---|---|---|
| IAM | Tokens reales validados por JWKS, rotación y revocación probadas. | Seguridad/Plataforma |
| Base de datos | Migración ensayada en clon productivo y rollback documentado. | DBA/Backend |
| Performance | Prueba de carga con p95/p99 y tasa de error dentro de SLO. | QA/SRE |
| Resiliencia | Caída de Redis/DB, reinicio, timeout y retry probados. | SRE |
| Seguridad | SAST, dependencias, contenedor, DAST y pentest sin hallazgos críticos/altos abiertos. | Seguridad |
| Backups | Restore completo medido; RPO/RTO aprobados. | DBA/SRE |
| Auditoría | Cadena verificada, retención y legal hold definidos. | Compliance |
| Privacidad | Clasificación, minimización, mascarado y DPIA/criterio legal. | Legal/Compliance |
| Operación | Alertas, dashboards, runbooks y guardia definidos. | Operaciones/SRE |
| Negocio | Políticas, cutoffs, overrides y reason codes aprobados. | Riesgo |

## SLO inicial propuesto

- Disponibilidad mensual del runtime: **99.9%** durante el piloto.
- Latencia de decisión: p95 **< 500 ms** sin proveedores externos; cada proveedor tendrá presupuesto propio.
- Error técnico: **< 0.5%** en ventanas de 15 minutos.
- Decisiones sin resultado (`NO_DECISION`): umbral de alerta definido por artefacto.
- RPO: **≤ 15 minutos**. RTO: **≤ 60 minutos** para el MVP, sujeto a aprobación.

## Riesgos abiertos

1. IAM/JWKS real aún depende del proveedor elegido.
2. Buró, KYC, bancos, QR y notificaciones requieren contratos y sandbox.
3. La comparación automática de un test run contra otro artefacto baseline aún no está
   implementada; la API rechaza el parámetro reservado para no generar evidencia incompleta.
4. No existe aún una política legal final de retención por país/tipo de dato.
5. Falta validar volumen real y comportamiento bajo saturación.
6. El seed es demostrativo y no sustituye aprobación formal de políticas crediticias.
7. La cobertura Jest unitaria/integración medida el 2026-07-28 es 50.14% de statements; los
   controladores y wiring se verifican principalmente en 58 pruebas E2E, pero conviene elevar la
   cobertura directa de servicios de despliegue, artefactos y runtime antes del Go-Live.

La evidencia reproducible más reciente está en `verification-2026-07-28.md`. Un release posterior
debe volver a ejecutar los gates: el porcentaje y los resultados no son una certificación permanente.
