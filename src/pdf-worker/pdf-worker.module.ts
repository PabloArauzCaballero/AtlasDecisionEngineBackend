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
import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ARTIFACT_CONTRACT_PORT } from './application/ports/artifact-contract.port';
import {
  ASSET_RESOLVER_PORT,
  type AssetResolverPort,
} from './application/ports/asset-resolver.port';
import {
  BRAND_REPOSITORY_PORT,
  type BrandRepositoryPort,
} from './application/ports/brand-repository.port';
import {
  DOCUMENT_STORAGE_PORT,
  type DocumentStoragePort,
} from './application/ports/document-storage.port';
import { EVENT_PUBLISHER_PORT } from './application/ports/event-publisher.port';
import { FONT_PROVIDER_PORT, type FontProviderPort } from './application/ports/font-provider.port';
import { IDEMPOTENCY_STORE_PORT } from './application/ports/idempotency-store.port';
import { PDF_JOB_QUEUE_PORT } from './application/ports/job-queue.port';
import { PDF_RENDERER_PORT, type PdfRendererPort } from './application/ports/pdf-renderer.port';
import {
  CLOCK_PORT,
  LOGGER_PORT,
  PDF_METRICS_PORT,
  type ClockPort,
} from './application/ports/runtime.ports';
import { PDF_WORKER_SETTINGS, type PdfWorkerSettings } from './application/ports/settings.port';
import { TEMPLATE_ENGINE_PORT } from './application/ports/template-engine.port';
import {
  TEMPLATE_REPOSITORY_PORT,
  type TemplateRepositoryPort,
} from './application/ports/template-repository.port';
import { TEMPLATE_SOURCE_LOADER_PORT } from './application/ports/template-source-loader.port';
import { TEMPLATE_STORE_PORT } from './application/ports/template-store.port';
import { TEMPLATE_BUNDLE_COMPILER_PORT } from './application/ports/template-bundle-compiler.port';
import { DocumentComposer } from './application/services/document-composer';
import { ArtifactBindingUseCase } from './application/use-cases/artifact-binding/artifact-binding.use-case';
import { ComposeHtmlUseCase } from './application/use-cases/compose-html/compose-html.use-case';
import { ManageTemplatesUseCase } from './application/use-cases/manage-templates/manage-templates.use-case';
import { GeneratePdfUseCase } from './application/use-cases/generate-pdf/generate-pdf.use-case';
import { GetTemplateDefinitionUseCase } from './application/use-cases/get-template-definition/get-template-definition.use-case';
import { PreviewTemplateUseCase } from './application/use-cases/preview-template/preview-template.use-case';
import { ValidatePayloadUseCase } from './application/use-cases/validate-template/validate-payload.use-case';
import { NullArtifactContractAdapter } from './infrastructure/artifacts/null-artifact-contract.adapter';
import { FilesystemAssetResolverAdapter } from './infrastructure/assets/filesystem-asset-resolver.adapter';
import { FontRegistryAdapter } from './infrastructure/assets/font-registry.adapter';
import { brandFromEnv } from './infrastructure/config/default-brand';
import { loadPdfWorkerEnv, type PdfWorkerEnv } from './infrastructure/config/pdf-worker.env';
import { PdfWorkerLifecycle } from './infrastructure/config/pdf-worker.lifecycle';
import {
  PDF_WORKER_PATHS,
  createRenderer,
  createStorage,
  resolvePaths,
  settingsFrom,
} from './infrastructure/config/pdf-worker.providers';
import { LoggingEventPublisherAdapter } from './infrastructure/events/logging-event-publisher.adapter';
import { InMemoryIdempotencyStoreAdapter } from './infrastructure/idempotency/in-memory-idempotency-store.adapter';
import { NestLoggerAdapter, SystemClock } from './infrastructure/observability/nest-logger.adapter';
import { PdfMetricsAdapter } from './infrastructure/observability/pdf-metrics.adapter';
import { InMemoryPdfQueueAdapter } from './infrastructure/queue/in-memory-pdf-queue.adapter';
import { BrandRegistry } from './infrastructure/registry/brand-registry';
import { TemplateRegistry } from './infrastructure/registry/template-registry';
import {
  FilesystemTemplateLoader,
  TEMPLATES_ROOT_TOKEN,
} from './infrastructure/templates/filesystem-template-loader';
import { HandlebarsTemplateEngineAdapter } from './infrastructure/templates/handlebars/handlebars-template-engine.adapter';
import { BundleCompilerAdapter } from './infrastructure/templates/bundle-compiler.adapter';
import { FilesystemTemplateStoreAdapter } from './infrastructure/store/filesystem-template-store.adapter';
import { PdfHealthService } from './presentation/health/pdf-health.service';
import { PdfCatalogController } from './presentation/http/pdf-catalog.controller';
import { PdfGenerationController } from './presentation/http/pdf-generation.controller';
import { PdfTemplateAdminController } from './presentation/http/pdf-template-admin.controller';
import {
  assertServiceAuthConfigured,
  SERVICE_AUTH_CONFIG,
  ServiceAuthGuard,
} from './presentation/http/service-auth.guard';
import {
  TEMPLATE_ADMIN_CONFIG,
  TemplateAdminGuard,
} from './presentation/http/template-admin.guard';
import { PdfQueueGateway } from './presentation/workers/pdf-queue.gateway';
import { LocalPdfGeneratorAdapter } from './sdk/local-pdf-generator.adapter';
import { PDF_GENERATOR_PORT } from './sdk/pdf-generator.port';
import { TEMPLATE_CATALOG } from './templates/template-catalog';
import type { TemplateContract } from './domain/contracts/template-contract';
import type { DocumentBrand } from './domain/value-objects/document-brand';

export const PDF_WORKER_ENV = Symbol('PdfWorkerEnv');

export interface PdfWorkerModuleOptions {
  /** Expone `POST /pdf/generate` y compañía. `false` deja sólo el SDK en proceso. */
  readonly http?: boolean;
  /** Templates adicionales, además del catálogo incorporado. */
  readonly templates?: readonly TemplateContract[];
  /** Marcas adicionales; la del entorno se registra siempre y es la de por defecto. */
  readonly brands?: readonly DocumentBrand[];
  /** Entorno alternativo; por omisión, `process.env`. Lo usan las pruebas. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Quién sabe qué publica un artefacto.
   *
   * Lo provee el ANFITRIÓN: el adaptador real lee `decision_output_contract_field`
   * con Prisma y por eso vive en `src/modules/artifacts/`, fuera de este árbol.
   * Sin él, casar documentos con artefactos no está disponible y se dice con un
   * 503 explicado, en vez de con una lista vacía que se leería como «este motor
   * no tiene artefactos».
   */
  readonly artifactContract?: Provider;

  /**
   * ¿Corre como PROCESO SUELTO, sin nadie delante que autentique?
   *
   * Sólo entonces se registra `ServiceAuthGuard` como guardia global. Dentro del motor
   * (`app.module.ts`) el `APP_GUARD` del anfitrión ya cubre estas rutas —lo demostró que la
   * misma `GET /pdf/templates` respondiera 401 por el puerto del motor y 200 por el del
   * worker—, así que registrarlo también aquí obligaría al motor a mandarse una credencial a
   * sí mismo.
   *
   * Por omisión `false`, y eso NO es un valor por omisión inseguro: el único sitio del
   * repositorio que monta este módulo sin anfitrión es `src/pdf-worker.ts`, y allí se declara
   * `true`. Lo que sí viene encendido por omisión es `PDF_SERVICE_AUTH_ENABLED`, de modo que
   * declararse suelto y no configurar clave aborta el arranque.
   */
  readonly standalone?: boolean;

  /**
   * Reloj alternativo. Con `FixedClock` la composición se vuelve determinista, que es lo que
   * permite comparar la huella visual de dos ejecuciones (§46) y afirmar sobre `createdAt` en
   * las pruebas sin margen de un segundo.
   */
  readonly clock?: ClockPort;
}

@Module({})
export class PdfWorkerModule {
  static register(options: PdfWorkerModuleOptions = {}): DynamicModule {
    const env = loadPdfWorkerEnv(options.env ?? process.env);
    const paths = resolvePaths(env);

    const providers: Provider[] = [
      { provide: PDF_WORKER_ENV, useValue: env },
      { provide: PDF_WORKER_PATHS, useValue: paths },
      { provide: TEMPLATES_ROOT_TOKEN, useValue: paths.templates },
      { provide: PDF_WORKER_SETTINGS, useValue: settingsFrom(env) },

      // --- Registros ---
      {
        provide: TemplateRegistry,
        useFactory: () => {
          const registry = new TemplateRegistry();
          for (const contract of [...TEMPLATE_CATALOG, ...(options.templates ?? [])]) {
            registry.register(contract);
          }
          return registry;
        },
      },
      { provide: TEMPLATE_REPOSITORY_PORT, useExisting: TemplateRegistry },
      {
        provide: BrandRegistry,
        useFactory: () => {
          const registry = new BrandRegistry();
          registry.register(brandFromEnv(env));
          for (const brand of options.brands ?? []) registry.register(brand);
          // Explícito aunque la del entorno se registre primero: si mañana el orden cambia,
          // la marca por defecto debe seguir siendo la que dice la configuración.
          registry.setDefault(env.PDF_BRAND_ID);
          return registry;
        },
      },
      { provide: BRAND_REPOSITORY_PORT, useExisting: BrandRegistry },

      // --- Adaptadores ---
      { provide: TEMPLATE_ENGINE_PORT, useClass: HandlebarsTemplateEngineAdapter },
      { provide: TEMPLATE_BUNDLE_COMPILER_PORT, useClass: BundleCompilerAdapter },
      options.artifactContract ?? {
        provide: ARTIFACT_CONTRACT_PORT,
        useClass: NullArtifactContractAdapter,
      },
      {
        provide: TEMPLATE_STORE_PORT,
        useFactory: () => new FilesystemTemplateStoreAdapter(paths.customTemplates),
      },
      {
        provide: TEMPLATE_SOURCE_LOADER_PORT,
        useFactory: () => new FilesystemTemplateLoader(paths.templates),
      },
      { provide: PDF_RENDERER_PORT, useFactory: () => createRenderer(env) },
      {
        provide: ASSET_RESOLVER_PORT,
        useFactory: () => new FilesystemAssetResolverAdapter(paths.assets),
      },
      { provide: FONT_PROVIDER_PORT, useFactory: () => new FontRegistryAdapter(paths.fonts) },
      { provide: DOCUMENT_STORAGE_PORT, useFactory: () => createStorage(env, paths) },
      // Con `useClass`, Nest intentaría inyectar el `maxEntries` del constructor —que tiene
      // valor por omisión pero sigue siendo un parámetro— y fallaría al resolverlo.
      { provide: IDEMPOTENCY_STORE_PORT, useFactory: () => new InMemoryIdempotencyStoreAdapter() },
      { provide: EVENT_PUBLISHER_PORT, useClass: LoggingEventPublisherAdapter },
      { provide: LOGGER_PORT, useClass: NestLoggerAdapter },
      options.clock
        ? { provide: CLOCK_PORT, useValue: options.clock }
        : { provide: CLOCK_PORT, useClass: SystemClock },
      PdfMetricsAdapter,
      { provide: PDF_METRICS_PORT, useExisting: PdfMetricsAdapter },

      // --- Aplicación ---
      DocumentComposer,
      GeneratePdfUseCase,
      PreviewTemplateUseCase,
      ValidatePayloadUseCase,
      GetTemplateDefinitionUseCase,
      ComposeHtmlUseCase,
      ManageTemplatesUseCase,
      ArtifactBindingUseCase,

      // --- Presentación ---
      PdfQueueGateway,
      {
        provide: PdfHealthService,
        inject: [
          PDF_RENDERER_PORT,
          TEMPLATE_REPOSITORY_PORT,
          BRAND_REPOSITORY_PORT,
          ASSET_RESOLVER_PORT,
          FONT_PROVIDER_PORT,
          DOCUMENT_STORAGE_PORT,
          PDF_WORKER_SETTINGS,
        ],
        useFactory: (
          renderer: PdfRendererPort,
          templates: TemplateRepositoryPort,
          brands: BrandRepositoryPort,
          assets: AssetResolverPort,
          fonts: FontProviderPort,
          storage: DocumentStoragePort,
          settings: PdfWorkerSettings,
        ) =>
          new PdfHealthService(
            renderer,
            templates,
            brands,
            assets,
            fonts,
            storage,
            settings,
            env.PDF_TEMPLATE_ENGINE,
          ),
      },
      PdfWorkerLifecycle,
      TemplateAdminGuard,
      {
        provide: TEMPLATE_ADMIN_CONFIG,
        useValue: {
          enabled: env.PDF_TEMPLATE_ADMIN_ENABLED,
          apiKey: env.PDF_TEMPLATE_ADMIN_KEY ?? '',
          header: env.PDF_TEMPLATE_ADMIN_HEADER,
        },
      },

      // --- SDK ---
      LocalPdfGeneratorAdapter,
      { provide: PDF_GENERATOR_PORT, useExisting: LocalPdfGeneratorAdapter },
    ];

    if (env.PDF_QUEUE_ENABLED) {
      providers.push({
        provide: PDF_JOB_QUEUE_PORT,
        useFactory: () =>
          new InMemoryPdfQueueAdapter(env.PDF_QUEUE_CAPACITY, env.PDF_RENDER_CONCURRENCY),
      });
    }

    // La puerta del servicio, sólo sin anfitrión delante. Va como `APP_GUARD` y no colgada de
    // cada controlador a propósito: un controlador nuevo nace protegido en vez de nacer abierto
    // y esperar a que alguien se acuerde del decorador — que es exactamente cómo `/pdf/generate`
    // llegó a responder 422 sin credencial.
    if (options.standalone) {
      // Antes de construir nada: sin clave no se arranca. El fallo aquí es de arranque y con
      // nombre de variable; el fallo que evita sería un 200 anónimo en producción.
      assertServiceAuthConfigured({
        enabled: env.PDF_SERVICE_AUTH_ENABLED,
        apiKey: env.PDF_SERVICE_API_KEY,
      });
      providers.push(
        {
          provide: SERVICE_AUTH_CONFIG,
          useValue: {
            enabled: env.PDF_SERVICE_AUTH_ENABLED,
            apiKey: env.PDF_SERVICE_API_KEY ?? '',
            header: env.PDF_SERVICE_HEADER,
          },
        },
        { provide: APP_GUARD, useClass: ServiceAuthGuard },
      );
    }

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
