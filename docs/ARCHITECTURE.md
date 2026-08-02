# Arquitectura técnica

Esta arquitectura existe para que Riesgo y Compliance puedan cambiar políticas sin perder
aprobación, reproducibilidad ni evidencia. A nivel de sistema separa autoría, compilación,
despliegue, ejecución y auditoría, de modo que cada frontera tenga controles verificables.

## 1. Separación Control Plane / Data Plane

El proyecto usa un único despliegue NestJS para facilitar el MVP, pero mantiene límites internos que permiten separar procesos más adelante:

- **Control Plane:** artefactos, catálogo de variables, validación, compilación, testing, gobierno y despliegue.
- **Data Plane:** resolución de binding, resolución de variables, ejecución determinista, idempotencia y persistencia de evidencia.

Las audiencias usan claves distintas. Esto evita que una credencial del runtime pueda modificar políticas.

## 2. Núcleo determinista

`graph/` no depende de HTTP ni de Prisma para evaluar un artefacto compilado:

- `GraphValidatorService`: comprueba inicio único, referencias, rutas terminales, ciclos y defaults.
- `CompilerService`: transforma el grafo persistido a un payload canónico e inmutable.
- `ExpressionEvaluator`: AST explícito; no usa `eval` ni ejecuta código arbitrario.
- `ExecutionEngineService`: recorre el grafo con límite de pasos y genera output, razones y trace.

El mismo engine es utilizado por el test runner y el runtime, reduciendo divergencias.

## 3. Persistencia

PostgreSQL es fuente de verdad para configuración, despliegues y evidencia. Redis es una optimización para bindings y cache; el runtime puede hacer fallback en desarrollo, pero producción exige Redis según configuración.

La evidencia de ejecución registra:

- despliegue, versión y checksum compilado;
- snapshot mínimo de entradas;
- versión/fuente/hash de cada variable;
- ruta de nodos y aristas;
- acciones y reason codes;
- errores y revisión manual;
- duración y timestamps.

## 4. Inmutabilidad y estados

Solo una versión `DRAFT` puede editarse. La actualización del grafo usa `If-Match`/lock version para evitar pérdida de cambios. Tras validar y compilar se conserva checksum canónico. Versiones aprobadas o desplegadas se cambian mediante clonación, no edición.

El ciclo se concentra en `VersionStateService`; controladores y repositorios no inventan transiciones por su cuenta.

## 5. Gobierno

El flujo de revisión crea pasos por rol y conserva decisiones/evidencias. Se aplican controles de separación de funciones:

- el autor no puede autoaprobar su propio paso;
- el autor no puede desplegar por sí solo la misma versión;
- producción requiere evidencia de pruebas y aprobaciones completas.

## 6. Seguridad

La autenticación establece un `AuthenticatedPrincipal` antes de ejecutar controladores:

- JWT RS256 validado con JWKS, issuer, audience, vigencia, tenant y roles;
- proveedor de identidad externo con perfil verificado;
- clientes de integración persistidos con credenciales, audiencia, scopes y tenants;
- API keys distintas para management y runtime;
- roles declarativos mediante decorators y guard global;
- `PLATFORM_ADMIN` como comodín solo para identidades firmadas;
- rate limiting separado para intentos fallidos de autenticación;
- Helmet, CORS cerrado, DTOs estrictos y respuestas normalizadas.

Una API key no puede definir `x-principal-id` ni `x-roles`. `x-tenant-id` únicamente selecciona un tenant que ya figure en `integration_tenant_access`.

Producción exige un modo con identidad firmada y no permite `AUTH_MODE=API_KEY`.

## 7. Auditoría

Los eventos se encadenan por tenant con HMAC. Un advisory lock transaccional serializa escritores del mismo tenant para evitar bifurcaciones concurrentes. `AuditService.append` acepta la transacción del dominio para que la mutación y su evidencia confirmen o reviertan juntas. `/v1/audit/chain/verify` recalcula la cadena y reporta cualquier alteración.

Las denegaciones 401, 403 y 429 se registran desde el filtro global porque los guards se ejecutan antes que los interceptors. Este registro es best-effort: una caída de auditoría no modifica la respuesta de seguridad.

Para cumplimiento fuerte, los eventos deben replicarse adicionalmente a almacenamiento WORM externo.

## 8. Idempotencia

La clave se limita por tenant + artefacto y se vincula a un hash criptográfico del request. Estados:

- `PROCESSING`: la petición está en curso;
- `COMPLETED`: devuelve la respuesta persistida;
- `FAILED`: devuelve el resultado fallido persistido;
- misma clave con payload diferente: conflicto 409.

El hash incluye el ambiente de ejecución. Las fallas transitorias liberan la reserva para permitir un reintento idéntico; los fallos de negocio deterministas permanecen persistidos.

## 9. Privacidad

El catálogo indica sensibilidad. En runtime:

- variables sensibles: `value_json = null`, se conserva hash;
- `subjectReference`: HMAC, no texto original;
- el snapshot de entrada sustituye sensibles por hash/fuente;
- información no declarada en el contrato no se incorpora a snapshots de variable.

La política final de retención necesita decisión legal por categoría antes de automatizar purgas.

## 10. Escalamiento

Siguientes extracciones naturales, sin reescribir dominio:

1. runtime API y workers de auditoría;
2. compiler/test runner asíncronos;
3. exportador WORM/BI;
4. IAM adapter;
5. variable provider adapters;
6. runtime de scorecards/ML como nuevo tipo de componente compilado.

## 11. Capacidades complementarias y sus límites

- **Árboles anidados:** reutilizan una versión concreta de otra política; los mapeos, ciclos,
  profundidad y timeout se validan antes y durante la ejecución.
- **Código → Flow:** transforma JavaScript/Python aceptado en un grafo gobernable cuando puede
  demostrar sus ramas y outputs. Si no puede preservar el contrato, genera un nodo `SCRIPT`
  aislado en vez de inventar semántica visual.
- **Ejecución en vivo:** es una previsualización management-only para SANDBOX/TEST. No escribe
  `DecisionExecution`, auditoría ni outbox, y por eso está desactivada por defecto.
- **Outbox y notificaciones:** publican efectos secundarios at-least-once desde la misma
  transacción de negocio. Los consumidores deben ser idempotentes; una notificación nunca es la
  fuente de verdad del estado de aprobación.
- **Testing asíncrono:** persiste una cola y cobertura reproducible contra un artefacto compilado.
  La comparación contra un baseline todavía no está implementada y la API rechaza ese parámetro
  explícitamente para no producir evidencia de regresión incompleta.
