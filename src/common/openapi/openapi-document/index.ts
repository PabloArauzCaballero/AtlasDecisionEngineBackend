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
export { buildOpenApiDocument, operationIdFactory } from './build';
export { PUBLIC_OPENAPI_PATHS } from './identity';
export type { OpenApiIdentity } from './identity';
