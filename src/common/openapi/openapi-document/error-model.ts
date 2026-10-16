import type { OpenAPIObject } from '@nestjs/swagger';
import { PUBLIC_OPENAPI_PATHS } from './identity';

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
export function registerErrorModel(document: OpenAPIObject): void {
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
 * Inyecta las respuestas de error que el filtro global garantiza, sin pisar ninguna que el
 * controlador ya declare explícitamente: si un endpoint documentó su propio 409, ese texto
 * es más preciso que cualquier valor genérico.
 */
export function attachStandardErrorResponses(document: OpenAPIObject): void {
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
