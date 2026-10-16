import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { attachStandardErrorResponses, registerErrorModel } from './error-model';
import { OpenApiIdentity, PUBLIC_OPENAPI_PATHS } from './identity';
import { describeCommonParameters } from './parameters';
import { declareGlobalTags } from './tags';

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
