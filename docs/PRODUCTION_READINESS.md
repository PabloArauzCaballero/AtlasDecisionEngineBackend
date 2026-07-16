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
3. El editor gráfico necesita escritura transaccional y ETag/If-Match.
4. No existe aún una política legal final de retención por país/tipo de dato.
5. Falta validar volumen real y comportamiento bajo saturación.
6. El seed es demostrativo y no sustituye aprobación formal de políticas crediticias.
7. La cobertura unitaria global actual es 17.55%; antes del Go-Live deben cubrirse servicios con DB/Redis, seguridad, idempotencia, gobierno, despliegues y runtime end-to-end.
