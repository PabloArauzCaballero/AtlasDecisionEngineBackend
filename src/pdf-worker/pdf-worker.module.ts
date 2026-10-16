/**
 * Composición del generador documental.
 *
 * Es la ÚNICA pieza que conoce a la vez los puertos y sus implementaciones. Cambiar de motor de
 * impresión, de motor de plantillas o de almacenamiento se hace aquí (o en
 * `infrastructure/config/pdf-worker.providers.ts`); nada más del árbol se entera.
 *
 * Se registra como módulo dinámico para poder acoplarlo de dos maneras (§44):
 *
 *   PdfWorkerModule.register()                    → API HTTP + SDK en proceso
 *   PdfWorkerModule.register({ http: false })     → sólo el SDK, sin exponer rutas
 *
 * `PdfWorkerModule` NO importa nada del motor anfitrión. Esa ausencia es lo que permite
 * arrancarlo como proceso suelto (`src/pdf-worker.ts`) y lo que hará que sacarlo a su propio
 * despliegue sea mover una carpeta, no desenredar dependencias.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { BRAND_REPOSITORY_PORT } from './application/ports/brand-repository.port';
import { TEMPLATE_REPOSITORY_PORT } from './application/ports/template-repository.port';
import { ManageTemplatesUseCase } from './application/use-cases/manage-templates/manage-templates.use-case';
import { loadPdfWorkerEnv, type PdfWorkerEnv } from './infrastructure/config/pdf-worker.env';
import { resolvePaths } from './infrastructure/config/pdf-worker.providers';
import { PdfMetricsAdapter } from './infrastructure/observability/pdf-metrics.adapter';
import { PdfHealthService } from './presentation/health/pdf-health.service';
import { PdfCatalogController } from './presentation/http/pdf-catalog.controller';
import { PdfGenerationController } from './presentation/http/pdf-generation.controller';
import { PdfTemplateAdminController } from './presentation/http/pdf-template-admin.controller';
import { LocalPdfGeneratorAdapter } from './sdk/local-pdf-generator.adapter';
import { PDF_GENERATOR_PORT } from './sdk/pdf-generator.port';
import { buildPdfWorkerProviders } from './pdf-worker.providers';
import { PDF_WORKER_ENV, type PdfWorkerModuleOptions } from './pdf-worker.options';

export { PDF_WORKER_ENV, type PdfWorkerModuleOptions };

@Module({})
export class PdfWorkerModule {
  static register(options: PdfWorkerModuleOptions = {}): DynamicModule {
    const env = loadPdfWorkerEnv(options.env ?? process.env);
    const paths = resolvePaths(env);

    const providers = buildPdfWorkerProviders(options, env, paths);

    return {
      module: PdfWorkerModule,
      providers,
      controllers:
        options.http === false
          ? []
          : [PdfGenerationController, PdfCatalogController, PdfTemplateAdminController],
      exports: [
        PDF_GENERATOR_PORT,
        LocalPdfGeneratorAdapter,
        PdfHealthService,
        PdfMetricsAdapter,
        TEMPLATE_REPOSITORY_PORT,
        BRAND_REPOSITORY_PORT,
        ManageTemplatesUseCase,
      ],
    };
  }
}

export type { PdfWorkerEnv };
