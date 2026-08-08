/**
 * Construcción del documento OpenAPI, en un solo sitio.
 *
 * Lo consumen dos caminos que DEBEN producir el mismo contrato: el arranque HTTP
 * (`main.ts`, que lo sirve en vivo) y el generador de artefactos
 * (`scripts/docs/generate-openapi.mjs`, que lo escribe a `openapi/` para Redocly, Scalar y
 * el portal). Si cada uno lo construyera por su cuenta, el contrato publicado y el servido
 * se separarían sin que ninguna prueba lo notara — y el contrato publicado es justamente el
 * que un integrador usa para escribir su cliente.
 */
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

export interface OpenApiIdentity {
  /** Versión del CONTRATO (`API_VERSION`), no del build. */
  apiVersion: string;
  buildVersion: string;
  commitSha: string;
  /**
   * URL pública del despliegue, cuando se conoce. Sin ella se publica solo el servidor
   * relativo: un contrato con la URL de otro ambiente hace que un cliente generado apunte
   * al sitio equivocado, que es peor que no decir nada.
   */
  publicUrl?: string;
}

/**
 * Rutas públicas por diseño: son las sondas del orquestador y deben poder consultarse sin
 * credencial. Se listan aquí para poder vaciarles la seguridad heredada del documento.
 */
export const PUBLIC_OPENAPI_PATHS = ['/health', '/health/live', '/health/ready', '/ready'];

/**
 * Errores que TODA operación autenticada puede devolver, porque los produce el filtro global
 * (`DomainExceptionFilter`) y no el controlador. Documentarlos aquí, una vez, evita que cada
 * endpoint tenga que repetirlos —y evita el resultado real de no hacerlo: un contrato en el
 * que ninguna operación declara qué pasa cuando falla.
 */
const UNIVERSAL_ERRORS: Array<[string, string]> = [
  ['401', 'Credencial ausente, inválida o revocada.'],
  ['403', 'El principal está autenticado pero carece del rol exigido, o el tenant no coincide.'],
  ['429', 'Se superó el límite de peticiones de la ventana vigente. Ver cabecera `retry-after`.'],
  ['500', 'Error no controlado. El cuerpo no revela detalle interno en producción.'],
];

/** Se añade solo donde hay algo que validar: cuerpo, parámetros de ruta o de consulta. */
const VALIDATION_ERROR: [string, string] = [
  '400',
  'La petición no supera la validación del contrato de entrada.',
];

/**
 * Forma EXACTA que emite `DomainExceptionFilter`. Es RFC 7807 con un sobre `error` propio;
 * se describe tal cual y no como un RFC 7807 canónico, porque un consumidor que lea `detail`
 * en vez de `error.message` no encontraría nada.
 */
function registerErrorModel(document: OpenAPIObject): void {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ProblemDetails = {
    type: 'object',
    description:
      'Respuesta de error uniforme de la plataforma, emitida por el filtro global de excepciones.',
    required: ['type', 'title', 'status', 'requestId', 'error'],
    properties: {
      type: {
        type: 'string',
        format: 'uri',
        description: 'Identificador estable del tipo de error.',
        example: 'https://atlas.local/errors/variable_missing_or_invalid',
      },
      title: {
        type: 'string',
        description: 'Código del error, en mayúsculas.',
        example: 'VARIABLE_MISSING_OR_INVALID',
      },
      status: { type: 'integer', example: 422 },
      requestId: {
        type: 'string',
        description:
          'Correlación con los registros del servidor. Es el mismo valor de la cabecera `x-request-id`.',
        example: '01J8ZQ2M5K9V3S7T1XW4YB6CDE',
      },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', example: 'VARIABLE_MISSING_OR_INVALID' },
          message: { type: 'string' },
          details: {
            // Sin `type`: el contenido depende del código de error (una lista de campos
            // inválidos, los tenants autorizados, las comprobaciones de la sonda…).
            // Declararlo como objeto sería falso para los códigos que devuelven una lista.
            description: 'Contexto adicional del error; su forma depende del código.',
          },
        },
      },
    },
  };

  document.components.responses ??= {};
  for (const [status, description] of [...UNIVERSAL_ERRORS, VALIDATION_ERROR]) {
    document.components.responses[`Error${status}`] = {
      description,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
      },
    };
  }
}

/**
 * Redocly exige que toda etiqueta usada esté declarada globalmente, y con razón: sin la
 * declaración el visor no puede ordenar ni describir las secciones. Se derivan de las
 * etiquetas realmente usadas en vez de mantenerse a mano, para que una etiqueta nueva no
 * exija recordar un segundo sitio donde registrarla.
 */
/**
 * Qué hace cada sección de la API. Un visor sin esto muestra una lista de nombres sin
 * contexto, y el integrador tiene que abrir endpoints al azar para entender qué agrupa cada
 * uno. Una etiqueta nueva sin entrada aquí sale sin descripción y Redocly lo avisa.
 */
const TAG_DESCRIPTIONS: Record<string, string> = {
  Health: 'Sondas de vida y disponibilidad para el orquestador. Públicas y sin límite de tasa.',
  'Portal Session': 'Inicio y cierre de sesión del portal contra el proveedor de identidad.',
  'Variable Catalog':
    'Catálogo global de variables y sus versiones inmutables, con contrato, restricciones y ejemplos (§1).',
  'Approved Libraries':
    'Registro de librerías autorizadas. Una fila solo HABILITA un prelude ya revisado en el repositorio (§7).',
  'Calculated Fields':
    'Funciones pequeñas, gobernadas y reutilizables, con contrato de retorno obligatorio (§5–§8).',
  'Decision Artifacts':
    'Algoritmos de decisión, sus versiones y el grafo que las define. Solo un borrador es editable.',
  'Nested Decision Trees':
    'Referencias de un artefacto a otro, con presupuesto, reintentos y política de fallo (§9).',
  'Code to Flow Import':
    'Importación de código existente y su conversión asistida a un grafo (§5).',
  'Decision Testing': 'Suites de regresión, casos y corridas deterministas por versión.',
  'QA Lab': 'Generación masiva guiada por contrato y contraejemplos reproducibles (§10).',
  'Decision Governance':
    'Envío a revisión, aprobaciones y segregación de funciones sobre una versión.',
  'Decision Deployments': 'Ambientes, despliegues activos y reversión a una versión anterior.',
  'Decision Runtime': 'Ejecución en línea de una decisión, idempotente y con evidencia persistida.',
  'Decision Simulation':
    'Ejecución de prueba sin persistir nada, con comparación opcional contra PROD (§12).',
  'Live Execution': 'Vista paso a paso de una ejecución no productiva por SSE. Opt-in.',
  'Manual Review': 'Cola de casos derivados a revisión humana y su resolución.',
  Notifications: 'Bandeja persistente alimentada por el outbox transaccional.',
  'Audit and Observability':
    'Consulta de ejecuciones y de la cadena de auditoría append-only, y su verificación.',
  'Requirements Traceability': 'Objetivos de negocio y su cobertura por artefactos y pruebas.',
  'Security Review': 'Revisión de seguridad de una versión antes de su promoción.',
  'Read Model Views': 'Vistas de solo lectura que alimentan catálogos y selectores del portal.',
  Tutorials: 'Contenido guiado del portal.',
  Observability: 'Exposición de métricas Prometheus, protegida por token.',
  Workers:
    'Catálogo de los workers adicionales, con sus límites y su disponibilidad en este despliegue (ADR-0026).',
  'Workers · Análisis semántico':
    'Clasificación de texto libre contra el catálogo de categorías, con entidades y evidencia. Asíncrono: se encola y se consulta.',
  'Workers · Extractos bancarios':
    'Conversión de un extracto bancario en PDF a movimientos normalizados. Asíncrono; el documento no se conserva y la cuenta se publica enmascarada.',
};

function declareGlobalTags(document: OpenAPIObject): void {
  const used = new Set<string>();
  for (const item of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(item ?? {})) {
      if (operation && typeof operation === 'object' && 'tags' in operation) {
        for (const tag of (operation as { tags?: string[] }).tags ?? []) used.add(tag);
      }
    }
  }
  const declared = new Map((document.tags ?? []).map((tag) => [tag.name, tag]));
  document.tags = [...used]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const existing = declared.get(name);
      const description = TAG_DESCRIPTIONS[name];
      return description ? { name, description, ...existing } : (existing ?? { name });
    });
}

/**
 * Inyecta las respuestas de error que el filtro global garantiza, sin pisar ninguna que el
 * controlador ya declare explícitamente: si un endpoint documentó su propio 409, ese texto
 * es más preciso que cualquier valor genérico.
 */
function attachStandardErrorResponses(document: OpenAPIObject): void {
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    const isPublic = PUBLIC_OPENAPI_PATHS.includes(path);
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!['get', 'put', 'post', 'delete', 'patch'].includes(method)) continue;
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
      const target = operation as {
        responses: Record<string, unknown>;
        parameters?: unknown[];
        requestBody?: unknown;
      };

      // Las sondas son públicas: no pueden devolver 401/403 y declararlo confundiría al
      // operador que las cablea.
      const applicable = isPublic
        ? [UNIVERSAL_ERRORS[3]]
        : [
            ...UNIVERSAL_ERRORS,
            ...(target.parameters?.length || target.requestBody ? [VALIDATION_ERROR] : []),
          ];

      for (const [status] of applicable) {
        target.responses[status] ??= { $ref: `#/components/responses/Error${status}` };
      }
    }
  }
}

/**
 * Descripción de los parámetros que se repiten por toda la API.
 *
 * `versionId` aparece en 23 operaciones, `search` en 7, `status` en 7. Documentarlos endpoint
 * a endpoint significaba más de cincuenta decoradores que dirían lo mismo y que el siguiente
 * endpoint volvería a olvidar. Aquí se declaran una vez, se aplican por nombre y un parámetro
 * nuevo lo hereda sin que nadie se acuerde.
 *
 * NO pisa una descripción existente: si un endpoint documentó su parámetro con algo más
 * preciso —porque en su contexto significa algo distinto— ese texto gana. Y un nombre que no
 * esté aquí sigue saliendo como aviso de Redocly, que es la presión que mantiene la lista viva.
 */
const COMMON_PARAMETER_DESCRIPTIONS: Record<string, string> = {
  // --- Identificadores de ruta ---
  versionId: 'Identificador de la versión del artefacto.',
  artifactId: 'Identificador del artefacto de decisión.',
  artifactCode: 'Código único del artefacto en el tenant (p. ej. `BNPL_CREDIT_DECISION`).',
  definitionId: 'Identificador de la definición de variable del catálogo.',
  fieldId: 'Identificador del campo calculado.',
  suiteId: 'Identificador de la suite de pruebas.',
  runId: 'Identificador de la corrida.',
  caseId: 'Identificador del caso de revisión manual.',
  policyId: 'Identificador del requisito de política.',
  objectiveId: 'Identificador del objetivo de negocio.',
  executionId: 'Identificador de la ejecución de decisión.',
  deploymentId: 'Identificador del despliegue.',
  requestId:
    'Identificador de correlación de la petición; el mismo que viaja en la cabecera `x-request-id`.',
  referenceId: 'Identificador de la referencia a otro artefacto.',
  counterexampleId: 'Identificador del contraejemplo archivado.',
  tutorialId: 'Identificador del tutorial.',
  leftVersionId: 'Versión que se toma como lado izquierdo de la comparación.',
  rightVersionId: 'Versión que se toma como lado derecho de la comparación.',
  id: 'Identificador del recurso.',

  // --- Filtros de consulta ---
  page: 'Página solicitada, empezando en 1.',
  pageSize: 'Elementos por página; se acota por `MAX_PAGE_SIZE`.',
  cursor:
    'Cursor opaco devuelto como `nextCursor` por la página anterior. Ausente en la primera página.',
  search: 'Coincidencia parcial sobre el código o el nombre del recurso.',
  status: 'Filtra por estado exacto del recurso.',
  category: 'Filtra por categoría del catálogo.',
  environmentCode: 'Ambiente de decisión (`SANDBOX`, `TEST`, `PROD`…).',
  eventType: 'Filtra por tipo de evento.',
  from: 'Límite inferior del rango temporal, inclusive (ISO 8601).',
  to: 'Límite superior del rango temporal, inclusive (ISO 8601).',
  usage: 'Sentido en que los algoritmos usan la variable: `INPUT` u `OUTPUT`.',
  language: 'Filtra por lenguaje de implementación.',
  environment: 'Filtra por ambiente en el que el recurso está habilitado.',
  unreadOnly: 'Devuelve solo las notificaciones sin leer.',
  artifactVersionId: 'Acota el resultado a una versión concreta.',
  actorId: 'Filtra por el principal que provocó el hecho.',
  aggregateType: 'Filtra por el tipo de agregado al que pertenece el evento.',
  outcome: 'Filtra por el resultado de negocio de la decisión.',
  subjectReference:
    'Referencia del sujeto de la decisión. Se compara contra su HMAC: el valor en claro no se persiste.',
  queueCode: 'Cola de revisión manual a la que pertenece el caso.',
  assignedTo: 'Filtra por el analista al que está asignado el caso.',
  implementationKind: 'Modalidad de implementación: `OPERATION`, `JAVASCRIPT` o `PYTHON`.',
  stepId: 'Identificador del paso de la traza de ejecución.',
  group: 'Grupo de opciones del catálogo que se quiere resolver.',
  q: 'Término de búsqueda libre.',
  limit: 'Máximo de elementos devueltos.',
};

function describeCommonParameters(document: OpenAPIObject): void {
  for (const item of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(item ?? {})) {
      if (!operation || typeof operation !== 'object' || !('parameters' in operation)) continue;
      for (const parameter of (operation as { parameters?: unknown[] }).parameters ?? []) {
        if (!parameter || typeof parameter !== 'object') continue;
        const target = parameter as { name?: string; description?: string };
        if (target.description || !target.name) continue;
        const description = COMMON_PARAMETER_DESCRIPTIONS[target.name];
        if (description) target.description = description;
      }
    }
  }
}

/**
 * `operationId` estable y legible a partir del controlador y el método.
 *
 * El valor por defecto de @nestjs/swagger es `ArtifactController_list`, que un generador de
 * clientes convierte en un nombre de función con guion bajo y prefijo redundante. Aquí se
 * produce `artifactList`: sigue derivándose del código —así que un endpoint nuevo obtiene el
 * suyo sin que nadie lo escriba— pero se lee como el nombre de una operación de negocio.
 *
 * La unicidad NO se asume: `scripts/docs/check-openapi-quality.mjs` falla si dos operaciones
 * comparten identificador, porque un cliente generado sobrescribiría un método con el otro.
 */
export function operationIdFactory(controllerKey: string, methodKey: string): string {
  const domain = controllerKey.replace(/Controller$/, '');
  const prefix = domain.charAt(0).toLowerCase() + domain.slice(1);
  return `${prefix}${methodKey.charAt(0).toUpperCase()}${methodKey.slice(1)}`;
}

export function buildOpenApiDocument(
  app: INestApplication,
  identity: OpenApiIdentity,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('ATLAS Decision Platform API')
    .setDescription(
      `Governed credit, risk and fraud decision platform.\n\n` +
        `Contract version **${identity.apiVersion}** — served by build ${identity.buildVersion} ` +
        `(commit ${identity.commitSha}).`,
    )
    .setVersion(identity.apiVersion)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'api-key')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-tenant-id' }, 'tenant')
    // Servidor relativo: el contrato se sirve desde el mismo host que la API, así que la
    // referencia interactiva y cualquier cliente generado apuntan por construcción al
    // ambiente que devolvió el documento.
    .addServer('/', 'El mismo host que sirve este documento')
    .build();
  if (identity.publicUrl) {
    config.servers = [
      { url: identity.publicUrl, description: 'URL pública configurada' },
      ...(config.servers ?? []),
    ];
  }

  const document = SwaggerModule.createDocument(app, config, { operationIdFactory });
  registerErrorModel(document);
  declareGlobalTags(document);
  attachStandardErrorResponses(document);
  describeCommonParameters(document);
  // Seguridad por defecto en el documento: toda operación exige credencial salvo que se la
  // vacíe explícitamente. Declararla por operación habría dejado la puerta a que un endpoint
  // nuevo naciera sin ninguna.
  document.security = [{ bearer: [] }, { 'api-key': [], tenant: [] }];
  for (const publicPath of PUBLIC_OPENAPI_PATHS) {
    const pathItem = document.paths[publicPath];
    if (!pathItem) continue;
    for (const operation of Object.values(pathItem)) {
      if (operation && typeof operation === 'object' && 'responses' in operation) {
        // `Object.values` de un PathItem devuelve la unión de todo lo que puede colgar de
        // una ruta (operaciones, `parameters`, `$ref`), así que se acota tras comprobar que
        // esto es una operación —que es lo que dice `'responses' in operation`—.
        (operation as { security?: unknown[] }).security = [];
      }
    }
  }
  return document;
}
