/**
 * Sonda del generador documental (§35).
 *
 * Comprueba lo que de verdad puede faltar, y cada comprobación existe porque su ausencia
 * produce un fallo que no se parece a su causa:
 *
 *  - **Motor de impresión**: sin Chromium, cada generación responde 502. El proceso de Node
 *    sigue vivo y verde, así que sin esta sonda la réplica parece sana.
 *  - **Catálogo**: cero templates registrados significa que el `template-catalog.ts` no llegó a
 *    la imagen. Los `404` que produce parecen un error del llamante.
 *  - **Recursos**: un `PDF_ORG_LOGO` que apunta a un archivo inexistente rompe TODOS los
 *    documentos de esa marca, y el error habla de un recurso, no del membrete.
 *  - **Fuentes**: no rompe nada, pero cambia el aspecto. Se publica `embedded: []` para que se
 *    vea que el documento depende del respaldo del sistema (§23).
 *  - **Almacenamiento**: un directorio sin permiso de escritura se descubre al guardar el
 *    primer PDF, es decir, con el documento ya generado y a punto de perderse.
 *
 * Nunca lanza. Una sonda que falla con una excepción no informa de nada.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  ASSET_RESOLVER_PORT,
  type AssetResolverPort,
} from '../../application/ports/asset-resolver.port';
import {
  BRAND_REPOSITORY_PORT,
  type BrandRepositoryPort,
} from '../../application/ports/brand-repository.port';
import {
  DOCUMENT_STORAGE_PORT,
  type DocumentStoragePort,
} from '../../application/ports/document-storage.port';
import {
  FONT_PROVIDER_PORT,
  type FontProviderPort,
} from '../../application/ports/font-provider.port';
import { PDF_RENDERER_PORT, type PdfRendererPort } from '../../application/ports/pdf-renderer.port';
import { PDF_WORKER_SETTINGS, type PdfWorkerSettings } from '../../application/ports/settings.port';
import {
  TEMPLATE_REPOSITORY_PORT,
  type TemplateRepositoryPort,
} from '../../application/ports/template-repository.port';

export interface HealthCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface PdfHealthReport {
  readonly status: 'ok' | 'degraded';
  readonly renderer: string;
  readonly templateEngine: string;
  readonly checks: readonly HealthCheck[];
  readonly timestamp: string;
}

@Injectable()
export class PdfHealthService {
  constructor(
    @Inject(PDF_RENDERER_PORT) private readonly renderer: PdfRendererPort,
    @Inject(TEMPLATE_REPOSITORY_PORT) private readonly templates: TemplateRepositoryPort,
    @Inject(BRAND_REPOSITORY_PORT) private readonly brands: BrandRepositoryPort,
    @Inject(ASSET_RESOLVER_PORT) private readonly assets: AssetResolverPort,
    @Inject(FONT_PROVIDER_PORT) private readonly fonts: FontProviderPort,
    @Inject(DOCUMENT_STORAGE_PORT) private readonly storage: DocumentStoragePort,
    @Inject(PDF_WORKER_SETTINGS) private readonly settings: PdfWorkerSettings,
    private readonly templateEngineName: string,
  ) {}

  async report(): Promise<PdfHealthReport> {
    const checks = await Promise.all([
      this.checkRenderer(),
      this.checkTemplates(),
      this.checkBrand(),
      this.checkFonts(),
      this.checkStorage(),
    ]);
    return {
      // Sólo el motor de impresión y el catálogo son bloqueantes: sin fuentes embebidas o sin
      // almacenamiento el worker sigue produciendo documentos correctos.
      status:
        checks.filter((check) => !check.ok && check.name !== 'fonts').length === 0
          ? 'ok'
          : 'degraded',
      renderer: this.renderer.name,
      templateEngine: this.templateEngineName,
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkRenderer(): Promise<HealthCheck> {
    try {
      const health = await this.renderer.health();
      return {
        name: 'renderer',
        ok: health.available,
        detail: health.available
          ? `${health.engineVersion ?? 'sin versión'} · ${health.activeRenders ?? 0}/${health.maxConcurrency ?? 0} carriles`
          : health.detail,
      };
    } catch (error) {
      return { name: 'renderer', ok: false, detail: reasonOf(error) };
    }
  }

  private async checkTemplates(): Promise<HealthCheck> {
    const registered = this.templates.size;
    return {
      name: 'templates',
      ok: registered > 0,
      detail: `${registered} pareja(s) id@versión registradas`,
    };
  }

  /** El logotipo de la marca por defecto se resuelve de verdad; no basta con que esté declarado. */
  private async checkBrand(): Promise<HealthCheck> {
    try {
      const brand = this.brands.getDefault();
      if (!brand.letterhead.logo) {
        return { name: 'brand', ok: true, detail: `${brand.id} · sin logotipo` };
      }
      const asset = await this.assets.resolve(brand.letterhead.logo);
      return {
        name: 'brand',
        ok: true,
        detail: `${brand.id} · ${asset.reference} (${asset.sizeBytes} B)`,
      };
    } catch (error) {
      return { name: 'brand', ok: false, detail: reasonOf(error) };
    }
  }

  private async checkFonts(): Promise<HealthCheck> {
    try {
      const bundle = await this.fonts.load();
      return {
        name: 'fonts',
        ok: bundle.embedded.length > 0,
        detail:
          bundle.embedded.length > 0
            ? `embebidas: ${bundle.embedded.join(', ')} (${bundle.totalBytes} B)`
            : 'ninguna fuente embebida; se depende de la pila de respaldo del sistema',
      };
    } catch (error) {
      return { name: 'fonts', ok: false, detail: reasonOf(error) };
    }
  }

  private async checkStorage(): Promise<HealthCheck> {
    if (!this.settings.storageEnabled) {
      return { name: 'storage', ok: true, detail: 'desactivado (PDF_STORAGE_ENABLED=false)' };
    }
    try {
      const health = await this.storage.health();
      return {
        name: 'storage',
        ok: health.available,
        detail: `${health.provider} · ${health.detail ?? 'ok'}`,
      };
    } catch (error) {
      return { name: 'storage', ok: false, detail: reasonOf(error) };
    }
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
