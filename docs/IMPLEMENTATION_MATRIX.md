# Matriz de implementación frente a los 22 diagramas

| # | Diagrama | Implementación | Estado |
|---:|---|---|---|
| 1 | Modelo relacional | `prisma/schema.prisma`, baseline SQL, índices, FKs y constraints | Implementado |
| 2 | Clases y servicios | Servicios pequeños por módulo; domain engine separado de HTTP/ORM | Implementado |
| 3 | Casos de uso y SoD | Controllers, decorators `@Roles`, guards y validaciones de autor/aprobador/desplegador | Implementado |
| 4 | Ciclo de vida end-to-end | artifact → validate → compile → test → review → approve → deploy | Implementado |
| 5 | Estados de versión | `VersionStateService` e historial persistido | Implementado |
| 6 | Edición/validación/pruebas | graph replace con optimistic lock, validator, compiler y test runner | Implementado |
| 7 | Ejecución online | deployment resolver, variable resolver, engine, execution writer y explicación | Implementado |
| 8 | Aprobación/despliegue/rollback | governance y deployment services | Implementado |
| 9 | Control Plane/Data Plane | audiencias, módulos y dependencias separadas dentro del monolito modular | Implementado, separable |
| 10 | Infraestructura segura | Dockerfile/Compose y puertos para PostgreSQL/Redis | Referencia local; AWS/WAF/KMS/WORM pendientes |
| 11 | Contexto e integraciones | Runtime API y `VARIABLE_BACKEND_URL` como puerto de integración | Contratos implementados; proveedores reales pendientes |
| 12 | Flujo crédito BNPL | seed `BNPL_CREDIT_DECISION` con KYC, consentimiento, edad, fraude, score, límite y razones | Implementado |
| 13 | Fraude/revisión manual | acción `CREATE_MANUAL_REVIEW`, cola, asignación y resolución | Implementado |
| 14 | Gobierno swimlanes | request, steps, decisions, evidence y separación de funciones | Implementado |
| 15 | Test bench/cobertura | suites, casos, assertions, runs, node/edge/terminal coverage | Implementado |
| 16 | Variables/linaje/snapshot | definitions, versions, sources, rules, dependency snapshot y hashes | Implementado |
| 17 | Auditoría/explicabilidad | trace, reason codes, access audit, audit chain, metrics y queries | Implementado |
| 18 | RBAC/multitenancy | API key audience, tenant context, roles y filtros por tenant | Implementado; IdP externo pendiente |
| 19 | Privacidad/retención | minimización, pseudonimización y no persistencia de sensibles crudos | Parcial: worker legal de retención pendiente |
| 20 | Reglas→scorecards→ML | artefactos genéricos, contratos, checksums, traffic metadata y rollback | Base preparada; entrenamiento/serving ML pendiente |
| 21 | Trazabilidad requisito-evidencia | business objectives, policy requirements, links a versiones y test suites | Implementado |
| 22 | Paquetes backend | módulos NestJS por responsabilidad y núcleo de grafo desacoplado | Implementado |

## Criterio de “pendiente”

Los pendientes no son código omitido por descuido: requieren infraestructura externa, credenciales, decisiones legales o datasets que no existen dentro del paquete PlantUML. Se mantienen como puertos explícitos para evitar acoplar el motor a proveedores ficticios.
