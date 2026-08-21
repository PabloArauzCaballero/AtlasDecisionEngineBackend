import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Traduce un esquema de OpenAPI al formato ABREVIADO del catálogo del portal: `{ campo: 'tipo|required' }`.
 *
 * Ése es el formato que el manifiesto de bloque publica y que lee el generador de datos de prueba
 * del portal interno de ATLAS. Este bloque lo produce; ATLAS Backend lo ingiere. Se conserva a propósito en lugar de guardar el JSON Schema entero: el catálogo
 * describe QUÉ campos entran y si son obligatorios, no reproduce el validador. Un `minPayloadSchema`
 * con el JSON Schema completo —con sus `$ref`, sus `allOf` y sus `discriminator`— haría que el
 * portal tuviera que implementar medio validador para pintar un formulario.
 *
 * Lo que se pierde en la traducción (rangos, enums, expresiones regulares) NO se finge: el portal
 * avisa de que los valores derivan del contrato publicado y no de las reglas del backend.
 */

type SchemaLike = {
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: unknown;
  items?: unknown;
  allOf?: unknown[];
  oneOf?: unknown[];
  anyOf?: unknown[];
  $ref?: string;
};

export type ContractMap = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `#/components/schemas/Foo` → el esquema apuntado. Sin resolverlo, un `$ref` no aporta un campo. */
function resolveRef(document: OpenAPIObject, schema: SchemaLike, depth = 0): SchemaLike {
  if (!schema.$ref || depth > 5) return schema;
  const name = schema.$ref.split('/').pop();
  if (!name) return schema;
  const target = (document.components?.schemas as Record<string, unknown> | undefined)?.[name];
  // La profundidad acota los ciclos: un esquema recursivo (un árbol de nodos, por ejemplo) haría
  // girar esto para siempre y el arranque del catálogo se colgaría sin decir por qué.
  return isRecord(target) ? resolveRef(document, target as SchemaLike, depth + 1) : schema;
}

/**
 * Aplana `allOf`, que es como Nest compone la herencia de DTOs. Sin esto, un cuerpo declarado como
 * `allOf: [Base, Extra]` se cataloga sin un solo campo, que es indistinguible de un endpoint que no
 * recibe cuerpo.
 */
function flatten(document: OpenAPIObject, schema: SchemaLike, depth = 0): SchemaLike {
  const resolved = resolveRef(document, schema, depth);
  const parts = resolved.allOf ?? resolved.oneOf ?? resolved.anyOf;
  if (!Array.isArray(parts) || depth > 5) return resolved;

  const merged: SchemaLike = { type: 'object', properties: {}, required: [] };
  for (const part of parts) {
    if (!isRecord(part)) continue;
    const flat = flatten(document, part as SchemaLike, depth + 1);
    Object.assign(merged.properties as Record<string, unknown>, flat.properties ?? {});
    if (Array.isArray(flat.required)) {
      (merged.required as string[]).push(...flat.required.map(String));
    }
  }
  // `oneOf`/`anyOf` describen alternativas: fundirlas marca como obligatorio lo que sólo lo es en
  // una de las ramas. Se queda con los campos y descarta la obligatoriedad, que es lo honesto.
  if (!resolved.allOf) merged.required = [];
  return merged;
}

function typeOf(document: OpenAPIObject, value: unknown, depth = 0): string {
  if (!isRecord(value)) return 'unknown';
  const schema = flatten(document, value as SchemaLike, depth);
  const raw = Array.isArray(schema.type) ? schema.type.find((entry) => entry !== 'null') : schema.type;
  if (raw === 'integer') return 'integer';
  if (raw === 'number') return 'number';
  if (raw === 'boolean') return 'boolean';
  if (raw === 'array') return 'array';
  if (raw === 'object') return 'object';
  if (raw === 'string') return 'string';
  // Sin `type` declarado pero con propiedades, es un objeto: OpenAPI 3.1 permite omitirlo.
  return schema.properties ? 'object' : 'unknown';
}

/** Convierte un esquema de objeto en el mapa abreviado. Devuelve `{}` si no hay campos que declarar. */
export function contractFromSchema(document: OpenAPIObject, schema: unknown): ContractMap {
  if (!isRecord(schema)) return {};
  const flat = flatten(document, schema as SchemaLike);
  const properties = flat.properties;
  if (!isRecord(properties)) return {};

  const required = new Set(Array.isArray(flat.required) ? flat.required.map(String) : []);
  const contract: ContractMap = {};
  for (const [name, definition] of Object.entries(properties)) {
    contract[name] = `${typeOf(document, definition, 1)}|${required.has(name) ? 'required' : 'optional'}`;
  }
  return contract;
}

type ParameterLike = { in?: string; name?: string; required?: boolean; schema?: unknown; $ref?: string };

/**
 * Los parámetros de una operación, separados por dónde viajan. Se mezclan los de la ruta con los de
 * la operación porque OpenAPI permite declararlos en cualquiera de los dos sitios y quien consume
 * el contrato ve la unión.
 */
export function contractsFromParameters(
  document: OpenAPIObject,
  operationParameters: unknown,
  pathParameters: unknown,
): { query: ContractMap; path: ContractMap; headers: ContractMap } {
  const query: ContractMap = {};
  const path: ContractMap = {};
  const headers: ContractMap = {};

  for (const source of [pathParameters, operationParameters]) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (!isRecord(entry)) continue;
      const parameter = (entry.$ref ? resolveRef(document, entry as SchemaLike) : entry) as ParameterLike;
      const name = parameter.name;
      if (!name) continue;
      const declared = `${typeOf(document, parameter.schema, 1)}|${parameter.required ? 'required' : 'optional'}`;
      if (parameter.in === 'query') query[name] = declared;
      else if (parameter.in === 'path') path[name] = declared;
      // Sólo las cabeceras que el endpoint EXIGE. Publicar `Authorization` o `Accept` llenaría el
      // catálogo de ruido que no distingue un endpoint de otro.
      else if (parameter.in === 'header' && parameter.required) headers[name] = declared;
    }
  }
  return { query, path, headers };
}

/** El cuerpo `application/json` de una operación. Es el único medio que el catálogo describe. */
export function contractFromRequestBody(document: OpenAPIObject, requestBody: unknown): ContractMap {
  if (!isRecord(requestBody)) return {};
  const resolved = requestBody.$ref ? (resolveRef(document, requestBody as SchemaLike) as unknown as Record<string, unknown>) : requestBody;
  const content = resolved.content;
  if (!isRecord(content)) return {};
  const json = content['application/json'];
  if (!isRecord(json)) return {};
  return contractFromSchema(document, json.schema);
}

/**
 * Los códigos de éxito que la operación declara.
 *
 * Sólo 2xx: un `400` documentado describe el fallo, no el contrato de salida, y meterlo en
 * «códigos esperados» haría que el laboratorio de QA diera por buena una petición rechazada.
 */
export function successStatusCodes(responses: unknown): number[] {
  if (!isRecord(responses)) return [];
  return Object.keys(responses)
    .map((code) => Number(code))
    .filter((code) => Number.isInteger(code) && code >= 200 && code < 300)
    .sort((left, right) => left - right);
}
