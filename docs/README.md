# Documentación del backend

Esta carpeta existe para convertir la implementación del motor en conocimiento operativo y
auditable. A nivel de negocio, permite que Riesgo, Fraude, Compliance, QA y Operaciones entiendan
qué garantías ofrece la plataforma y qué decisiones siguen requiriendo aprobación humana. A nivel
de sistema, describe contratos, límites, despliegue, seguridad y procedimientos que no deben
inferirse únicamente leyendo código.

## Documentos vigentes

| Documento | Justificación de negocio | Responsabilidad de sistema |
|---|---|---|
| `ARCHITECTURE.md` | Explica cómo se gobiernan y reproducen decisiones reguladas. | Define límites entre control plane, data plane, persistencia, seguridad y observabilidad. |
| `API_EXAMPLES.md` | Facilita integraciones verificables para portales y clientes técnicos. | Muestra autenticación, cabeceras, payloads y respuestas HTTP válidas. |
| `COMANDOS.md` | Reduce errores en desarrollo, soporte y entrega. | Es la referencia de comandos Yarn, Prisma, pruebas y ejecución. |
| `DEPLOYMENT.md` | Separa un entorno demostrativo de un Go-Live aprobado. | Documenta configuración, migraciones, rol RLS, contenedores y controles productivos. |
| `PRODUCTION_READINESS.md` | Hace visibles los gates y riesgos que necesitan dueño. | Define condiciones técnicas mínimas, SLO propuesto y dependencias externas. |
| `CONFIGURABLE_OUTPUTS.md` | Permite productos y políticas con salidas explícitas y explicables. | Especifica contratos `RESULT`, mapeos y ejecución aislada de scripts. |
| `code-to-flow-specification.md` | Convierte reglas existentes en activos gobernables sin ocultar ambigüedad. | Describe contrato, análisis estático, IR, derivación de ramas y fallback a sandbox. |
| `event-driven-architecture.md` | Desacopla notificaciones y procesos secundarios de la transacción principal. | Define outbox, entrega at-least-once, idempotencia, reintentos y dead-letter. |
| `worker-orchestration.md` | Permite escalar el plano de decisión sin multiplicar el trabajo de fondo ni su costo al ralentí. | Define el orquestador central de trabajos, el despertar por `LISTEN`/`NOTIFY`, el reparto API/WORKER y sus métricas. |
| `flowchart-user-guide.md` | Ayuda al autor de políticas a construir y validar grafos. | Documenta el contrato que consume el editor visual. |
| `live-execution.md` | Permite observar una simulación sin crear evidencia productiva falsa. | Define SSE, feature flag, heartbeat, seguridad y prohibición de PROD. |
| `nested-decision-trees.md` | Reutiliza políticas aprobadas sin duplicarlas. | Define referencias versionadas, mapeos, ciclos, profundidad, timeout y trazabilidad. |
| `notifications.md` | Entrega trabajo pendiente a los roles correctos. | Documenta proyección desde eventos, visibilidad e idempotencia. |
| `security-review.md` | Da a Seguridad una vista reproducible de controles y hallazgos. | Describe agregación, RBAC, exportación y fuentes de evidencia. |
| `tutorials.md` | Conserva el avance de aprendizaje por usuario y tenant. | Define el recurso de progreso; el contenido pedagógico permanece en el frontend. |
| `IMPLEMENTATION_MATRIX.md` | Relaciona objetivos de diseño con evidencia implementada. | Mapea diagramas a módulos, migraciones y brechas reales. |
| `VISTAS_POR_FASES.md` | Alinea el portal interno con roles y procesos de negocio. | Es un catálogo UX; no sustituye el contrato OpenAPI. |
| `runbooks/OPERATIONS.md` | Reduce tiempo de diagnóstico y recuperación. | Contiene procedimientos de despliegue, incidentes, rollback y auditoría. |
| `plantuml/README.md` | Permite revisar arquitectura con audiencias no técnicas y técnicas. | Indexa y compila los diagramas versionados. |
| `verification-2026-07-28.md` | Da a los responsables una fotografía honesta de la calidad revisada durante la noche. | Registra entorno aislado, fixes, gates, cobertura, OpenAPI, smoke e imagen runtime. |
| `audit-2026-07-30-hardening.md` | Recorre el backend por las siete fases de endurecimiento y deja cada hallazgo con su evidencia reproducida y su corrección. | Punto de partida de la siguiente auditoría; los pendientes conocidos que lista siguen abiertos. |

## Evidencia fechada e histórica

Estos archivos preservan decisiones y resultados de una fecha concreta; no deben leerse como
estado actual sin contrastarlos con este índice y con los gates vigentes.

| Documento | Razón de conservación | Uso correcto |
|---|---|---|
| `SECURITY_AUDIT.md` | Mantiene trazabilidad de hallazgos y correcciones de la auditoría inicial. | Evidencia histórica; repetir los gates antes de un release. |
| `testing-report.md` | Conserva la salida de pruebas de las rebanadas 2–5. | Referencia histórica, no certificación permanente. |
| `final-implementation-report.md` | Registra el alcance e integración de las rebanadas originales. | Contexto de evolución del producto. |
| `verification-2026-07-24.md` | Evidencia la verificación integral de esa fecha. | Comparar con el reporte de verificación más reciente. |
| `claude/*.md` | Registra cómo se configuró la asistencia de desarrollo. | Gobernanza de herramientas; no arquitectura de runtime. |
| `AtlasDecisionEngineContext.docx` | Conserva el contexto de negocio fuente. | Entrada documental, no contrato ejecutable. |
| `script-prueba.js` / `script-prueba.py` | Ofrecen ejemplos legibles de código importable. | Fixtures manuales; las garantías reales están en las pruebas automatizadas. |

## Regla de mantenimiento

Un cambio funcional debe actualizar el documento de dominio, las anotaciones OpenAPI y el README
de la carpeta afectada. Una afirmación de “PASS” debe incluir fecha y salida real; los documentos
históricos no se reescriben para simular que siempre describieron el estado actual.
