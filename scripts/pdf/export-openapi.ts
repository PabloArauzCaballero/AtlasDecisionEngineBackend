/**
 * Exporta el contrato OpenAPI del generador documental SIN compilar el motor entero.
 *
 * Monta únicamente `PdfWorkerModule` con `ts-node`, así que no depende de que el resto del
 * backend compile. No es una comodidad: el contrato del worker no tiene por qué quedar
 * bloqueado porque otro módulo esté a medias, y esa independencia es la misma que permite
 * desplegarlo aparte.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PdfWorkerModule } from '../../src/pdf-worker/pdf-worker.module';

async function main(): Promise<void> {
  const app = await NestFactory.create(
    // La administración se enciende SÓLO para documentarla: sin esto sus rutas existen pero
    // el guardia las tapa, y el contrato publicado no las mencionaría.
    PdfWorkerModule.register({
      env: {
        PDF_ORG_NAME: 'ATLAS Decision Engine',
        PDF_TEMPLATE_ADMIN_ENABLED: 'true',
        PDF_TEMPLATE_ADMIN_KEY: 'solo-para-generar-la-documentacion-0001',
      },
    }),
    { logger: ['error'] },
  );
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ATLAS PDF Generator Worker')
      .setDescription(
        'Plataforma documental interna: los artefactos entregan datos estructurados y este ' +
          'servicio valida, maqueta, aplica la identidad institucional y devuelve el PDF.',
      )
      .setVersion('1.0.0')
      .addTag('pdf')
      .addTag('pdf-templates')
      .addApiKey({ type: 'apiKey', name: 'x-pdf-admin-key', in: 'header' }, 'admin')
      .build(),
  );
  const salida = resolve('openapi/pdf-worker.openapi.json');
  await mkdir(resolve('openapi'), { recursive: true });
  await writeFile(salida, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `OpenAPI escrito en ${salida} (${Object.keys(document.paths).length} rutas)\n`,
  );
  await app.close();
}

void main().catch((error: unknown) => {
  process.stderr.write(`✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
