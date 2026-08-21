import type { OpenAPIObject } from '@nestjs/swagger';
import { OpenApiDocumentRegistry } from '../src/modules/platform-catalog/openapi-document.registry';
import {
  contractFromRequestBody,
  contractsFromParameters,
  contractFromSchema,
  successStatusCodes,
} from '../src/modules/platform-catalog/openapi-contract.util';

/**
 * El manifiesto de bloque publica el CONTRATO de cada endpoint en el formato abreviado que ATLAS
 * ingiere (`{ campo: 'tipo|required' }`).
 *
 * Sin él, ATLAS cataloga los 217 endpoints de este bloque sin un solo campo, y el generador de
 * datos de prueba de su laboratorio de QA no tiene de dónde derivar un payload: hay que escribirlo
 * a mano, que es exactamente lo que hace que nadie pruebe el caso inválido.
 */

function documentWith(schemas: Record<string, unknown> = {}): OpenAPIObject {
  return {
    openapi: '3.0.0',
    info: { title: 'DE', version: '1' },
    paths: {},
    components: { schemas },
  } as OpenAPIObject;
}

describe('contrato del manifiesto de bloque', () => {
  it('traduce un esquema de objeto a campos con tipo y obligatoriedad', () => {
    const contract = contractFromSchema(documentWith(), {
      type: 'object',
      properties: {
        artifactCode: { type: 'string' },
        environmentCode: { type: 'string' },
        dryRun: { type: 'boolean' },
      },
      required: ['artifactCode', 'environmentCode'],
    });

    expect(contract).toEqual({
      artifactCode: 'string|required',
      environmentCode: 'string|required',
      dryRun: 'boolean|optional',
    });
  });

  it('resuelve `$ref` hasta el esquema apuntado', () => {
    const document = documentWith({
      SimulateDto: {
        type: 'object',
        properties: { input: { type: 'object' } },
        required: ['input'],
      },
    });

    expect(contractFromSchema(document, { $ref: '#/components/schemas/SimulateDto' })).toEqual({
      input: 'object|required',
    });
  });

  /** Nest compone la herencia de DTOs con `allOf`; sin aplanarlo el cuerpo sale sin campos. */
  it('aplana `allOf`', () => {
    const document = documentWith({
      Base: {
        type: 'object',
        properties: { tenantId: { type: 'string' } },
        required: ['tenantId'],
      },
    });

    const contract = contractFromSchema(document, {
      allOf: [
        { $ref: '#/components/schemas/Base' },
        { type: 'object', properties: { nota: { type: 'string' } } },
      ],
    });

    expect(contract).toEqual({ tenantId: 'string|required', nota: 'string|optional' });
  });

  it('separa query, ruta y cabeceras exigidas', () => {
    const result = contractsFromParameters(
      documentWith(),
      [{ in: 'query', name: 'limit', required: false, schema: { type: 'integer' } }],
      [{ in: 'path', name: 'code', required: true, schema: { type: 'string' } }],
    );

    expect(result.query).toEqual({ limit: 'integer|optional' });
    expect(result.path).toEqual({ code: 'string|required' });
  });

  it('lee el cuerpo `application/json`', () => {
    const contract = contractFromRequestBody(documentWith(), {
      content: {
        'application/json': {
          schema: { type: 'object', properties: { seed: { type: 'string' } } },
        },
      },
    });

    expect(contract).toEqual({ seed: 'string|optional' });
  });

  /** Un `400` documentado describe el fallo, no el contrato de salida. */
  it('publica sólo los códigos de éxito', () => {
    expect(successStatusCodes({ '200': {}, '202': {}, '422': {} })).toEqual([200, 202]);
  });

  it('sin códigos declarados no se supone un 200', () => {
    expect(successStatusCodes({})).toEqual([]);
  });
});

describe('OpenApiDocumentRegistry', () => {
  /**
   * Con `SWAGGER_ENABLED=false` el documento no se construye. El manifiesto debe salir SIN
   * contratos —como salía antes— en vez de romper la federación: es una mejora que se degrada.
   */
  it('sin documento devuelve null en vez de un objeto vacío', () => {
    expect(new OpenApiDocumentRegistry().get()).toBeNull();
  });

  it('devuelve el documento depositado', () => {
    const registry = new OpenApiDocumentRegistry();
    const document = documentWith();
    registry.set(document);

    expect(registry.get()).toBe(document);
  });
});
