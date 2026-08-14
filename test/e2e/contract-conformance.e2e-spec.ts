import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';

/**
 * Conformidad entre la respuesta REAL y el esquema que el contrato declara.
 *
 * Hasta aquí, las puertas del contrato comprobaban que cada operación **declarara** un
 * esquema; ninguna comprobaba que el cuerpo devuelto lo **cumpliera**. Esa diferencia es
 * justo donde un contrato empieza a mentir: se declara un envoltorio, el servicio cambia y
 * el documento sigue prometiendo la forma antigua a quien genera su cliente a partir de él.
 *
 * Se valida contra `openapi/openapi.json`, el mismo artefacto que se publica — no contra una
 * copia escrita a mano — de modo que un desajuste solo puede significar dos cosas: o el
 * contrato quedó obsoleto, o el servicio devuelve algo que nunca prometió. Las dos son
 * defectos.
 */
describe('Conformidad respuesta ↔ contrato (e2e)', () => {
  let app: INestApplication;
  // El documento OpenAPI se recorre por rutas dinámicas ($ref, paths, schemas anidados);
  // tiparlo aquí sería reimplementar el metaesquema para no ganar nada.
  let spec: Record<string, any>;
  let ajv: Ajv;

  // Arrancar la aplicación completa excede con holgura el timeout por defecto de un hook: el
  // contexto levanta Prisma, Redis y el orquestador de trabajos antes de aceptar la primera
  // petición. Se declara explícito para que un arranque lento se distinga de una prueba
  // colgada.
  beforeAll(async () => {
    app = await createTestApp();
    spec = JSON.parse(readFileSync(join(__dirname, '..', '..', 'openapi', 'openapi.json'), 'utf8'));
    // `strict: false` porque el documento lo genera Nest y trae palabras clave que Ajv no
    // conoce (`example`, `nullable` de OpenAPI 3.0). Bloquear por eso rechazaría el contrato
    // entero sin decir nada sobre la conformidad, que es lo que aquí se mide.
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
    addFormats(ajv);
    // Los esquemas se referencian entre sí con `$ref: '#/components/schemas/...'`; se registra
    // el documento completo bajo su propio id para que esas referencias resuelvan.
    ajv.addSchema(spec, 'openapi');
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  /** Compila el esquema de la respuesta 200/201 declarada para una operación. */
  function validatorFor(path: string, method: string): ValidateFunction | null {
    const operation = spec.paths?.[path]?.[method];
    const response = operation?.responses?.['200'] ?? operation?.responses?.['201'];
    const schema = response?.content?.['application/json']?.schema;
    if (!schema) return null;
    // Se compila contra una copia con los `$ref` resueltos por el documento ya registrado.
    return ajv.compile({ ...schema, components: spec.components, $id: `${method}:${path}` });
  }

  function expectConforms(validate: ValidateFunction, body: unknown, where: string): void {
    if (validate(body)) return;
    const errors = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '(raíz)'} ${error.message}`)
      .join('; ');
    throw new Error(
      `La respuesta de ${where} no cumple el esquema que el contrato declara: ${errors}`,
    );
  }

  it('las sondas públicas devuelven exactamente la forma declarada', async () => {
    for (const path of ['/health/live', '/health/ready']) {
      const validate = validatorFor(path, 'get');
      expect(validate).not.toBeNull();
      const response = await request(app.getHttpServer()).get(path).expect(200);
      expectConforms(validate!, response.body, `GET ${path}`);
    }
  });

  it('un listado paginado cumple el envoltorio de paginación declarado', async () => {
    const validate = validatorFor('/v1/artifacts', 'get');
    expect(validate).not.toBeNull();
    const response = await request(app.getHttpServer())
      .get('/v1/artifacts?pageSize=5')
      .set(managementHeaders('e2e.author'))
      .expect(200);
    expectConforms(validate!, response.body, 'GET /v1/artifacts');
    // La forma declarada no basta si el envoltorio miente sobre sí mismo: `hasNextPage` debe
    // ser coherente con el total y la página, o un integrador pagina de forma infinita.
    expect(response.body.hasNextPage).toBe(response.body.page < response.body.totalPages);
  });

  it('el contador de no leídas cumple su DTO', async () => {
    const validate = validatorFor('/v1/notifications/unread-count', 'get');
    expect(validate).not.toBeNull();
    const response = await request(app.getHttpServer())
      .get('/v1/notifications/unread-count')
      .set(managementHeaders('e2e.author'))
      .expect(200);
    expectConforms(validate!, response.body, 'GET /v1/notifications/unread-count');
  });

  it('la verificación de la cadena de auditoría cumple su DTO', async () => {
    const validate = validatorFor('/v1/audit/chain/verify', 'get');
    expect(validate).not.toBeNull();
    const response = await request(app.getHttpServer())
      .get('/v1/audit/chain/verify')
      .set(managementHeaders('auditor', ['AUDITOR']))
      .expect(200);
    expectConforms(validate!, response.body, 'GET /v1/audit/chain/verify');
  });

  it('un error de autorización cumple el modelo de error único', async () => {
    // El sobre de error es lo que TODO integrador maneja, y lo produce el filtro global: si
    // se desviara del contrato, ningún endpoint concreto lo delataría.
    const problem = ajv.compile({
      ...spec.components.schemas.ProblemDetails,
      components: spec.components,
      $id: 'problem-details',
    });
    const response = await request(app.getHttpServer()).get('/v1/artifacts').expect(401);
    expectConforms(problem, response.body, 'un 401 de /v1/artifacts');
    expect(response.body.title).toBeTruthy();
    expect(response.body.requestId).toBeTruthy();
  });
});
