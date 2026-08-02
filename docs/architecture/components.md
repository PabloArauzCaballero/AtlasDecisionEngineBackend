# Componentes (C4 nivel 3)

Componentes del contenedor `api`, agrupados por responsabilidad. El detalle por módulo, con
sus endpoints y roles reales, está en el [índice de módulos](../modules/index.md) y se genera
del código.

## Frontera HTTP

| Componente | Responsabilidad | Fichero |
| --- | --- | --- |
| Bootstrap | Validación global, CORS, helmet, compresión, correlación, apagado ordenado | `src/main.ts` |
| `AuthenticationGuard` | Resuelve el principal según `AUTH_MODE`; **nunca** desde cabeceras del llamante | `common/security/authentication.guard.ts` |
| `RolesGuard` | Aplica `@Roles(...)`; el comodín `PLATFORM_ADMIN` solo en identidades firmadas | `common/security/roles.guard.ts` |
| `RateLimitGuard` | Límite por ventana, separado para gestión y runtime | `common/security/rate-limit.guard.ts` |
| `DomainExceptionFilter` | Traduce toda excepción al sobre único de error y alimenta métricas y auditoría de denegaciones | `common/errors/domain-exception.filter.ts` |
| `RequestTimeoutInterceptor` | Corta una petición que excede su presupuesto | `common/observability/request-timeout.interceptor.ts` |

## Núcleo de decisión

| Componente | Responsabilidad |
| --- | --- |
| `ExecutionEngineService` | Recorre el artefacto compilado, evalúa condiciones, escribe intermedias y produce la traza |
| `ExpressionEvaluator` | Evalúa expresiones JSON-AST; resuelve el espacio `variables.*` igual que el validador |
| `IntermediateScope` | Ciclo de vida de las intermedias de **una** ejecución; muere con ella |
| `ScriptNodeRunnerService` | Ejecuta nodos de script: en proceso (desarrollo) o delegando en el sidecar (producción) |
| `CompilerService` | Convierte el grafo validado en artefacto inmutable con checksum |
| `GraphValidatorService` | Estructura, expresiones, determinismo, contrato de salida y dominancia de intermedias |

## Contratos y datos

| Componente | Responsabilidad |
| --- | --- |
| `VariableResolutionService` | Resuelve entradas de petición, proveedor y valores por defecto; produce el snapshot de evidencia |
| `constraint-engine` | Evaluación **autoritativa** de las restricciones; ninguna vive solo en el frontend |
| `PrismaService` | Cliente único con adaptador `pg` y proxy que fija el GUC de tenant en cada consulta |

## Gobierno y ejecución en línea

| Componente | Responsabilidad |
| --- | --- |
| `GovernanceService` | Envío a revisión, votos, segregación de funciones, transiciones terminales |
| `DeploymentResolverService` | Resuelve el despliegue activo por artefacto y ambiente, con caché por tenant |
| `IdempotencyService` | Reserva y libera la clave con lease corto |
| `ExecutionWriterService` | Persiste ejecución, snapshot, traza, razones y revisión manual en **una** transacción |

## Transversales

| Componente | Responsabilidad |
| --- | --- |
| `AuditService` | Escribe el evento encadenado por hash dentro de la transacción del cambio |
| `OutboxPublisherService` + `EventBus` | Publica el evento en la misma transacción; el relay lo despacha después |
| `MetricsService` | Registro Prometheus por instancia (histogramas, contadores, gauges) |
| `StructuredLoggerService` | Registro estructurado con redacción de credenciales y PII |
| `CacheService` | Redis con clave siempre por tenant; en producción prohíbe la caída a memoria |

## Regla de composición

Un servicio que necesita colaborar con otro dominio **de forma opcional** lo recibe como
argumento de llamada, no como dependencia de constructor. Es lo que permite que el motor no
dependa del módulo de árboles anidados ni del stream en vivo, y que quien no los usa siga
funcionando sin cambios.
