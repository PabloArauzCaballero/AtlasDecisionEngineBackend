/**
 * Arranque del generador documental como PROCESO SUELTO.
 *
 * Hermano de `main.ts` y `worker.ts`, y deliberadamente mucho más pequeño: monta
 * `PdfWorkerModule` y NADA del motor —ni Prisma, ni Redis, ni el catálogo de variables—. Eso no
 * es una simplificación, es la prueba de que el acoplamiento prometido en el §1 es real: si el
 * worker necesitara algo del anfitrión, este archivo no compilaría.
 *
 * Se despliega aparte por un motivo concreto: Chromium pesa ~400 MiB y consume memoria en
 * ráfagas al rasterizar. Mezclarlo con el proceso que atiende decisiones en línea significa que
 * un informe de doscientas páginas compite por la memoria del camino sensible a la latencia.
 * Con dos procesos, el generador se escala —y se cae— por su cuenta.
 *
 * Dentro del motor, el mismo módulo se importa desde `app.module.ts` y comparte proceso. Los
 * dos modos son válidos; lo que no es válido es tener dos implementaciones.
 */
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PdfWorkerModule } from './pdf-worker/pdf-worker.module';
import { PdfWorkerExceptionFilter } from './pdf-worker/presentation/http/pdf-worker-exception.filter';

const PORT = Number.parseInt(process.env.PDF_WORKER_PORT ?? '3100', 10);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(PdfWorkerModule.register(), {
    bufferLogs: true,
    forceCloseConnections: true,
  });

  // El generador no acepta ningún DTO de `class-validator`; la validación la hace Zod en la
  // frontera. `whitelist` queda igualmente porque cuesta cero y cierra el caso de que alguien
  // añada mañana un controlador con decoradores y olvide el pipe.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new PdfWorkerExceptionFilter());

  // Cuerpos grandes: un informe con dos mil filas de tabla llega en un JSON de varios megas, y
  // el límite por omisión de Express (100 KiB) lo rechazaría con un 413 que no explica nada.
  const { json } = await import('express');
  app.use(json({ limit: process.env.PDF_MAX_REQUEST_SIZE ?? '8mb' }));

  if (process.env.PDF_SWAGGER_ENABLED !== 'false') {
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
        .build(),
    );
    SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'openapi.json' });
  }

  // Sin esto, `onApplicationShutdown` no se ejecuta y el navegador queda huérfano al parar
  // el contenedor. Ver `PdfWorkerLifecycle`.
  app.enableShutdownHooks();
  await app.listen(PORT, '0.0.0.0');
  Logger.log(
    { message: 'PDF Generator Worker escuchando', port: PORT, docs: `http://0.0.0.0:${PORT}/docs` },
    'PdfWorkerBootstrap',
  );
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'fatal',
      context: 'PdfWorkerBootstrap',
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exit(1);
});
