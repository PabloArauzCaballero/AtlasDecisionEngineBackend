/**
 * Arranque y apagado del generador documental.
 *
 * **Al arrancar** se PRECARGAN los recursos que las marcas y los templates declaran, y se
 * registra un resumen. Es la diferencia entre descubrir que falta el logotipo en el momento del
 * despliegue —con el mensaje que dice cuál y dónde— y descubrirlo con el primer informe del
 * trimestre ya fallando.
 *
 * **Al apagar** se cierra el navegador. Sin esto, cada reinicio deja un proceso de Chromium
 * huérfano: en desarrollo se acumulan durante el día hasta que la máquina se queda sin memoria,
 * y en un contenedor el apagado se alarga hasta que el orquestador manda SIGKILL, que no deja
 * escribir ni una línea de registro.
 */
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
  ASSET_RESOLVER_PORT,
  type AssetResolverPort,
} from '../../application/ports/asset-resolver.port';
import {
  BRAND_REPOSITORY_PORT,
  type BrandRepositoryPort,
} from '../../application/ports/brand-repository.port';
import {
  FONT_PROVIDER_PORT,
  type FontProviderPort,
} from '../../application/ports/font-provider.port';
import { PDF_RENDERER_PORT, type PdfRendererPort } from '../../application/ports/pdf-renderer.port';
import { LOGGER_PORT, type LoggerPort } from '../../application/ports/runtime.ports';
import {
  TEMPLATE_REPOSITORY_PORT,
  type TemplateRepositoryPort,
} from '../../application/ports/template-repository.port';
import { ManageTemplatesUseCase } from '../../application/use-cases/manage-templates/manage-templates.use-case';
import { PDF_WORKER_PATHS, type PdfWorkerPaths } from './pdf-worker.providers';

@Injectable()
export class PdfWorkerLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(PDF_RENDERER_PORT) private readonly renderer: PdfRendererPort,
    @Inject(TEMPLATE_REPOSITORY_PORT) private readonly templates: TemplateRepositoryPort,
    @Inject(BRAND_REPOSITORY_PORT) private readonly brands: BrandRepositoryPort,
    @Inject(ASSET_RESOLVER_PORT) private readonly assets: AssetResolverPort,
    @Inject(FONT_PROVIDER_PORT) private readonly fonts: FontProviderPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
    @Inject(PDF_WORKER_PATHS) private readonly paths: PdfWorkerPaths,
    private readonly customTemplates: ManageTemplatesUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    const references = new Set<string>();
    for (const brand of this.brands.list()) {
      if (brand.letterhead.logo) references.add(brand.letterhead.logo);
    }
    for (const contract of this.templates.listTemplates()) {
      for (const asset of contract.assets ?? []) references.add(asset);
    }

    // Un recurso declarado y ausente rompe TODOS los documentos que lo usan. Se avisa aquí,
    // pero no se aborta el arranque: dejar sin servicio al resto de los templates por un
    // logotipo que falta es un remedio peor que la enfermedad.
    try {
      await this.assets.warmup([...references]);
    } catch (error) {
      this.logger.error('Hay recursos declarados que no se pueden resolver', {
        reason: error instanceof Error ? error.message : String(error),
        assetsPath: this.paths.assets,
      });
    }

    // Los templates publicados por la API se restauran ANTES de anunciar que el worker está
    // listo: si se hiciera después, habría una ventana en la que `/pdf/templates` no los lista
    // y una petición legítima recibiría un 404 desconcertante.
    const restaurados = await this.customTemplates.restore();

    const fonts = await this.fonts.load().catch(() => undefined);
    this.logger.info('Generador documental listo', {
      customTemplates: restaurados,
      renderer: this.renderer.name,
      templates: this.templates.size,
      brands: this.brands.list().map((brand) => brand.id),
      assets: [...references],
      // Publicado a propósito: con la lista vacía, el documento depende de la tipografía del
      // sistema y deja de ser reproducible fuera de la imagen de contenedor (§23).
      fontsEmbedded: fonts?.embedded ?? [],
      templatesPath: this.paths.templates,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.renderer.shutdown().catch(() => undefined);
  }
}
