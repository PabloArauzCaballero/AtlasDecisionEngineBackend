/**
 * La API del generador documental, de punta a punta y con Chromium de verdad.
 *
 * Es la prueba que respalda el criterio de aceptación del §53: se hace una petición HTTP real y
 * lo que vuelve es un PDF que abre. Todo lo demás —el registro, los contratos, la composición—
 * puede estar bien y el documento seguir sin llegar, porque entre el caso de uso y el cliente
 * quedan la serialización de la respuesta, las cabeceras y el búfer.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PdfWorkerModule } from '../../src/pdf-worker/pdf-worker.module';
import { PdfWorkerExceptionFilter } from '../../src/pdf-worker/presentation/http/pdf-worker-exception.filter';
import { genericResultReportFixture } from '../../src/pdf-worker/templates/documents/generic-result-report/1.0.0/preview.fixture';

jest.setTimeout(240_000);

describe('PDF Generator Worker (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PdfWorkerModule.register({
          env: {
            PDF_ORG_NAME: 'Cooperativa Nuñez & Peñaranda',
            PDF_ORG_TAX_ID: 'NIT 1023456789',
            PDF_ORG_ADDRESS: 'Av. Ballivián 1234, La Paz',
            PDF_STORAGE_ENABLED: 'true',
            PDF_STORAGE_PROVIDER: 'memory',
            PDF_QUEUE_ENABLED: 'true',
            PDF_RENDER_CONCURRENCY: '2',
          },
        }),
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new PdfWorkerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /pdf/generate', () => {
    it('devuelve un PDF real cuando se pide con Accept: application/pdf', async () => {
      const response = await request(app.getHttpServer())
        .post('/pdf/generate')
        .set('accept', 'application/pdf')
        .send({ templateId: 'generic-result-report', payload: genericResultReportFixture() })
        .expect(200);

      expect(response.headers['content-type']).toBe('application/pdf');
      const body = response.body as Buffer;
      expect(Buffer.isBuffer(body)).toBe(true);
      // Firma del formato: unos bytes con tamaño no son un PDF.
      expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(body.byteLength).toBeGreaterThan(5_000);
      expect(Number(response.headers['content-length'])).toBe(body.byteLength);

      // Cabeceras de trazabilidad: conciliar el archivo con el registro sin abrirlo.
      expect(response.headers['x-document-id']).toMatch(/^DOC-[0-9A-F]{12}$/);
      expect(response.headers['x-document-checksum']).toMatch(/^[0-9a-f]{64}$/);
      expect(response.headers['x-template']).toBe('generic-result-report@1.0.0');
      expect(response.headers['content-disposition']).toContain("filename*=UTF-8''");
    });

    it('devuelve la ficha en JSON cuando no se pide el binario', async () => {
      const response = await request(app.getHttpServer())
        .post('/pdf/generate')
        .send({
          templateId: 'credit-analysis-report',
          templateVersion: '1.0.0',
          payload: { customerName: 'Juan Pérez Añez', score: 782, decision: 'REVIEW' },
          options: { persist: true },
        })
        .expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({
          template: { id: 'credit-analysis-report', version: '1.0.0' },
          mimeType: 'application/pdf',
          status: 'GENERATED',
          classification: 'CONFIDENTIAL',
        }),
      );
      expect(response.body.storage).toEqual(
        expect.objectContaining({ provider: 'memory', key: expect.stringMatching(/\.pdf$/) }),
      );
      // El búfer NO viaja en el JSON: inflaría la respuesta un 33 % para quien no lo pidió.
      expect(response.body.content).toBeUndefined();
    });

    it('rechaza el payload inválido con campo, problema y regla esperada', async () => {
      const response = await request(app.getHttpServer())
        .post('/pdf/generate')
        .send({
          templateId: 'credit-analysis-report',
          payload: { customerName: 'Ana', score: 700, decision: 'APROBADO' },
        })
        .expect(422);

      expect(response.body.title).toBe('TEMPLATE_PAYLOAD_INVALID');
      const issues = response.body.errors.issues as Array<Record<string, string>>;
      expect(issues).toContainEqual(
        expect.objectContaining({
          field: 'decision',
          problem: 'valor fuera del conjunto admitido',
          expected: expect.stringContaining('APPROVED'),
        }),
      );
    });

    it('rechaza una opción protegida en vez de ignorarla', async () => {
      const response = await request(app.getHttpServer())
        .post('/pdf/generate')
        .send({
          templateId: 'generic-result-report',
          payload: { title: 'x', sections: [{ title: 's' }] },
          options: { page: { scale: 3 } },
        })
        .expect(422);
      // El sobre lo valida Zod con `strictObject`, así que la clave protegida no llega ni al
      // caso de uso: se contesta con la ruta exacta del campo rechazado.
      expect(response.body.title).toBe('TEMPLATE_PAYLOAD_INVALID');
    });

    it('404 con la lista de templates disponibles cuando el template no existe', async () => {
      const response = await request(app.getHttpServer())
        .post('/pdf/generate')
        .send({ templateId: 'no-existe', payload: {} })
        .expect(404);

      expect(response.body.title).toBe('TEMPLATE_NOT_FOUND');
      expect(response.body.errors.available).toContain('generic-result-report');
    });

    it('repone el mismo documento ante una clave de idempotencia repetida', async () => {
      const payload = {
        templateId: 'generic-result-report',
        payload: { title: 'Idempotente', sections: [{ title: 'S' }] },
        metadata: { idempotencyKey: 'e2e-clave-estable-0001' },
      };
      const first = await request(app.getHttpServer())
        .post('/pdf/generate')
        .send(payload)
        .expect(200);
      const second = await request(app.getHttpServer())
        .post('/pdf/generate')
        .send(payload)
        .expect(200);

      expect(second.body.status).toBe('REPLAYED');
      expect(second.body.documentId).toBe(first.body.documentId);
      expect(second.body.checksum).toBe(first.body.checksum);
    });
  });

  describe('POST /pdf/preview', () => {
    it('devuelve un PDF usando el fixture del template, sin payload', async () => {
      const response = await request(app.getHttpServer())
        .post('/pdf/preview')
        .send({ templateId: 'credit-analysis-report' })
        .expect(200);

      expect(response.headers['content-type']).toBe('application/pdf');
      expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect(response.headers['content-disposition']).toContain('inline');
    });
  });

  describe('descubrimiento', () => {
    it('GET /pdf/templates lista los templates publicados', async () => {
      const response = await request(app.getHttpServer()).get('/pdf/templates').expect(200);
      const ids = (response.body.templates as Array<{ id: string; version: string }>).map(
        (template) => `${template.id}@${template.version}`,
      );
      expect(ids).toEqual(['credit-analysis-report@1.1.0', 'generic-result-report@1.0.0']);
    });

    it('GET /pdf/templates/:id/schema publica lo que hay que mandar', async () => {
      const response = await request(app.getHttpServer())
        .get('/pdf/templates/credit-analysis-report/schema?version=1.0.0')
        .expect(200);

      expect(response.body.fields.decision).toEqual(
        expect.objectContaining({
          type: 'enum',
          required: true,
          values: ['APPROVED', 'REJECTED', 'REVIEW'],
        }),
      );
      expect(response.body.jsonSchema.type).toBe('object');
      expect(response.body.example.customerName).toEqual(expect.any(String));
    });

    it('GET /pdf/templates/:id/versions conserva las versiones antiguas', async () => {
      const response = await request(app.getHttpServer())
        .get('/pdf/templates/credit-analysis-report/versions')
        .expect(200);
      expect(response.body.versions).toEqual(['1.0.0', '1.1.0']);
    });

    it('POST /pdf/templates/:id/validate responde 200 con el veredicto', async () => {
      const response = await request(app.getHttpServer())
        .post('/pdf/templates/credit-analysis-report/validate')
        .send({ payload: { customerName: 'Ana' } })
        .expect(200);

      // Aquí «inválido» es la RESPUESTA a la pregunta, no un fallo de la llamada.
      expect(response.body.valid).toBe(false);
      expect(response.body.issues.length).toBeGreaterThan(0);
    });
  });

  describe('GET /pdf/health', () => {
    it('informa del motor, del catálogo y de las fuentes', async () => {
      const response = await request(app.getHttpServer()).get('/pdf/health').expect(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.renderer).toBe('playwright-chromium');
      expect(response.body.templateEngine).toBe('handlebars');

      const checks = response.body.checks as Array<{ name: string; ok: boolean; detail?: string }>;
      expect(checks.find((check) => check.name === 'renderer')?.ok).toBe(true);
      expect(checks.find((check) => check.name === 'templates')?.ok).toBe(true);
      // Sin fuentes embebidas el documento sigue saliendo, pero la sonda lo DICE (§23).
      expect(checks.find((check) => check.name === 'fonts')).toBeDefined();
    });
  });

  describe('POST /pdf/generate/async', () => {
    it('acepta el trabajo con 202 y lo procesa contra el mismo caso de uso', async () => {
      const response = await request(app.getHttpServer())
        .post('/pdf/generate/async')
        .send({
          templateId: 'generic-result-report',
          payload: { title: 'Asíncrono', sections: [{ title: 'S' }] },
          metadata: { correlationId: 'e2e-async-1' },
        })
        .expect(202);

      expect(response.body).toEqual(
        expect.objectContaining({ status: 'QUEUED', jobId: expect.any(String) }),
      );
    });
  });
});

/**
 * Administración de templates por HTTP.
 *
 * Monta una segunda aplicación con la administración ENCENDIDA, porque la del resto del
 * archivo la tiene apagada — que es el valor por omisión y el que hay que comprobar también.
 */
describe('CRUD de templates (e2e)', () => {
  const CLAVE = 'clave-de-administracion-de-pruebas-0001';
  let admin: INestApplication;
  let raiz: string;

  beforeAll(async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    raiz = await mkdtemp(join(tmpdir(), 'pdf-e2e-crud-'));

    const module = await Test.createTestingModule({
      imports: [
        PdfWorkerModule.register({
          env: {
            PDF_ORG_NAME: 'Cooperativa de pruebas',
            PDF_TEMPLATE_ADMIN_ENABLED: 'true',
            PDF_TEMPLATE_ADMIN_KEY: CLAVE,
            PDF_CUSTOM_TEMPLATE_PATH: raiz,
            PDF_RENDER_CONCURRENCY: '2',
          },
        }),
      ],
    }).compile();
    admin = module.createNestApplication();
    admin.useGlobalFilters(new PdfWorkerExceptionFilter());
    await admin.init();
  });

  afterAll(async () => {
    await admin.close();
    const { rm } = await import('node:fs/promises');
    await rm(raiz, { recursive: true, force: true });
  });

  it('el formato de ejemplo se descarga como archivo y es un paquete válido', async () => {
    const response = await request(admin.getHttpServer())
      .get('/pdf/template-format/example')
      .expect(200);

    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain('template-de-ejemplo.json');
    const bundle = JSON.parse(response.text) as { manifest: { id: string }; fields: object };
    expect(bundle.manifest.id).toBe('certificado-de-cuenta');
    expect(Object.keys(bundle.fields).length).toBeGreaterThan(5);
  });

  it('publica el JSON Schema del formato admitido', async () => {
    const response = await request(admin.getHttpServer())
      .get('/pdf/template-format/schema')
      .expect(200);
    expect(response.body.format).toBe('atlas-pdf-template-bundle/1');
    expect(response.body.jsonSchema.properties.manifest).toBeDefined();
  });

  it('publica el catálogo COMPLETO de errores', async () => {
    const response = await request(admin.getHttpServer()).get('/pdf/errors').expect(200);
    const errors = response.body.errors as Array<Record<string, unknown>>;
    expect(errors.length).toBeGreaterThanOrEqual(20);
    const capacidad = errors.find((e) => e.code === 'PDF_RENDER_CAPACITY_EXCEEDED');
    expect(capacidad).toEqual(
      expect.objectContaining({ httpStatus: 429, retryable: true, audience: 'ambos' }),
    );
  });

  it('sin credencial no se puede administrar', async () => {
    await request(admin.getHttpServer()).get('/pdf/admin/templates').expect(401);
    await request(admin.getHttpServer())
      .get('/pdf/admin/templates')
      .set('x-pdf-admin-key', 'incorrecta')
      .expect(401);
  });

  it('el ciclo completo: descargar el ejemplo, publicarlo y generar un PDF con él', async () => {
    const ejemplo = JSON.parse(
      (await request(admin.getHttpServer()).get('/pdf/template-format/example').expect(200)).text,
    ) as Record<string, unknown>;

    // 1. Publicar tal cual lo descargado. Es la comprobación que da sentido al ejemplo.
    const creado = await request(admin.getHttpServer())
      .post('/pdf/admin/templates')
      .set('x-pdf-admin-key', CLAVE)
      .set('x-requested-by', 'operador@atlas')
      .send(ejemplo)
      .expect(201);
    expect(creado.body).toEqual(
      expect.objectContaining({
        origin: 'custom',
        status: 'published',
        createdBy: 'operador@atlas',
      }),
    );

    // 2. Aparece en el catálogo público, junto a los incorporados.
    const catalogo = await request(admin.getHttpServer()).get('/pdf/templates').expect(200);
    expect((catalogo.body.templates as Array<{ id: string }>).map((t) => t.id)).toContain(
      'certificado-de-cuenta',
    );

    // 3. Publica su contrato como cualquier otro.
    const schema = await request(admin.getHttpServer())
      .get('/pdf/templates/certificado-de-cuenta/schema')
      .expect(200);
    expect(schema.body.fields.estado).toEqual(
      expect.objectContaining({
        type: 'enum',
        required: true,
        values: ['ACTIVA', 'INACTIVA', 'CERRADA'],
      }),
    );

    // 4. Y GENERA UN PDF REAL. Es el final del recorrido: un template que entró por HTTP
    //    recorre el mismo camino de composición e impresión que uno incorporado.
    const pdf = await request(admin.getHttpServer())
      .post('/pdf/generate')
      .set('accept', 'application/pdf')
      .send({
        templateId: 'certificado-de-cuenta',
        payload: {
          titular: 'María José Núñez Peñaranda',
          documento: '7845219 LP',
          numeroCuenta: '****-4821',
          estado: 'ACTIVA',
          saldo: 12480.75,
          moneda: 'BOB',
        },
      })
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // 5. Reintentar la publicación responde 409 con la versión siguiente sugerida.
    const repetido = await request(admin.getHttpServer())
      .post('/pdf/admin/templates')
      .set('x-pdf-admin-key', CLAVE)
      .send(ejemplo)
      .expect(409);
    expect(repetido.body.errors.versionSugerida).toBe('1.0.1');

    // 6. Se puede descargar su paquete para editarlo y publicar la siguiente versión.
    const fuente = await request(admin.getHttpServer())
      .get('/pdf/admin/templates/certificado-de-cuenta/1.0.0/source')
      .set('x-pdf-admin-key', CLAVE)
      .expect(200);
    expect(JSON.parse(fuente.text).manifest.version).toBe('1.0.0');

    // 7. Borrarlo lo saca del catálogo.
    await request(admin.getHttpServer())
      .delete('/pdf/admin/templates/certificado-de-cuenta/1.0.0')
      .set('x-pdf-admin-key', CLAVE)
      .expect(204);
    await request(admin.getHttpServer())
      .get('/pdf/templates/certificado-de-cuenta/schema')
      .expect(404);
  });

  it('rechaza un paquete inválido explicando cada problema', async () => {
    const roto = JSON.parse(
      (await request(admin.getHttpServer()).get('/pdf/template-format/example').expect(200)).text,
    ) as Record<string, unknown>;
    roto.template = '<p>{{{data.titular}}}</p>';

    const response = await request(admin.getHttpServer())
      .post('/pdf/admin/templates')
      .set('x-pdf-admin-key', CLAVE)
      .send(roto)
      .expect(422);
    expect(response.body.title).toBe('TEMPLATE_BUNDLE_INVALID');
    expect(response.body.errors.issues[0].problem).toMatch(/sin escapar/);
  });

  it('los templates incorporados no se pueden borrar por la API', async () => {
    await request(admin.getHttpServer())
      .delete('/pdf/admin/templates/generic-result-report/1.0.0')
      .set('x-pdf-admin-key', CLAVE)
      .expect(403);
  });
});
