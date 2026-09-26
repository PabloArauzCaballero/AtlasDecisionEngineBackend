/**
 * Alta, consulta, retirada y borrado de templates por la API (el «CRUD»).
 *
 * **Por qué no es un CRUD literal.** «Actualizar» un template publicado sería reescribir el
 * pasado: un informe archivado declara con qué `id@version` salió, y esa declaración sólo
 * significa algo si esa versión no cambia nunca. Así que:
 *
 *   Crear      → `publish()` da de alta una pareja `id@version` nueva.
 *   Leer       → `source()` devuelve el paquete completo, listo para editar y volver a subir.
 *   Actualizar → publicar OTRA versión. Editar una existente responde `TEMPLATE_IMMUTABLE`
 *                con la siguiente versión sugerida, que es lo que quien edita quería hacer.
 *   Borrar     → `deprecate()` es lo normal: el template deja de recomendarse pero sigue
 *                generando, así que lo ya emitido se puede reproducir. `remove()` borra de
 *                verdad y existe para deshacer una publicación equivocada.
 *
 * Los templates INCORPORADOS no se tocan por aquí. Viajan en la imagen, se versionan con el
 * código y cambiarlos en caliente rompería la correspondencia entre lo desplegado y lo que
 * hace: `TEMPLATE_BUILTIN_PROTECTED`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { StoredTemplate, TemplateBundle } from '../../../domain/contracts/template-bundle';
import type { TemplateSummary } from '../../../domain/contracts/template-contract';
import { summarize } from '../../../domain/contracts/template-contract';
import {
  TemplateBuiltinProtectedError,
  TemplateImmutableError,
  TemplateVersionNotFoundError,
} from '../../../domain/errors/pdf-worker.errors';
import { compareVersions } from '../../../domain/value-objects/template-ref';
import { LOGGER_PORT, type LoggerPort } from '../../ports/runtime.ports';
import { TEMPLATE_STORE_PORT, type TemplateStorePort } from '../../ports/template-store.port';
import {
  TEMPLATE_REPOSITORY_PORT,
  type TemplateRepositoryPort,
} from '../../ports/template-repository.port';
import { TEMPLATE_ENGINE_PORT, type TemplateEnginePort } from '../../ports/template-engine.port';
import {
  TEMPLATE_BUNDLE_COMPILER_PORT,
  type TemplateBundleCompilerPort,
} from '../../ports/template-bundle-compiler.port';

export interface TemplateInventoryEntry extends TemplateSummary {
  readonly origin: 'builtin' | 'custom';
  readonly status: 'published' | 'deprecated';
  readonly createdAt?: string;
  readonly createdBy?: string;
  readonly checksum?: string;
}

@Injectable()
export class ManageTemplatesUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY_PORT) private readonly registry: TemplateRepositoryPort,
    @Inject(TEMPLATE_STORE_PORT) private readonly store: TemplateStorePort,
    @Inject(TEMPLATE_ENGINE_PORT) private readonly engine: TemplateEnginePort,
    @Inject(TEMPLATE_BUNDLE_COMPILER_PORT) private readonly compiler: TemplateBundleCompilerPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  /**
   * Carga al arrancar lo que haya en el almacén.
   *
   * Un fallo con UN template no puede impedir que carguen los demás ni que arranque el
   * worker: se registra y se sigue. Lo contrario significa que un JSON editado a mano deja el
   * servicio entero sin arrancar.
   */
  async restore(): Promise<number> {
    let cargados = 0;
    for (const stored of await this.store.list()) {
      try {
        const { contract } = this.compiler.compile(stored.bundle);
        this.registry.register(contract);
        cargados += 1;
      } catch (error) {
        this.logger.error('No se pudo restaurar un template publicado por la API', {
          templateId: stored.bundle?.manifest?.id,
          version: stored.bundle?.manifest?.version,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return cargados;
  }

  async publish(input: unknown, createdBy?: string): Promise<StoredTemplate> {
    const { contract, bundle } = this.compiler.compile(input);

    // Si la versión ya existe se responde IMMUTABLE y no ALREADY_REGISTERED: el primero dice
    // qué hacer —publicar la siguiente— y el segundo sólo constata el choque.
    if (this.registry.hasTemplate(contract.id, contract.version)) {
      throw new TemplateImmutableError(
        contract.id,
        contract.version,
        this.nextVersion(contract.id, contract.version),
      );
    }

    // Se compila la plantilla ANTES de guardar nada. Es lo que convierte un ayudante mal
    // escrito en un rechazo al publicar, en vez de en un 500 la primera vez que alguien la use.
    this.engine.compile(`preflight:${contract.id}@${contract.version}`, bundle.template);

    const stored = await this.store.save(bundle, { createdBy });
    this.registry.register(contract);
    this.logger.info('Template publicado por la API', {
      template: `${contract.id}@${contract.version}`,
      createdBy,
      checksum: stored.checksum,
    });
    return stored;
  }

  async inventory(): Promise<readonly TemplateInventoryEntry[]> {
    const persistidos = new Map<string, StoredTemplate>();
    for (const stored of await this.store.list()) {
      persistidos.set(`${stored.bundle.manifest.id}@${stored.bundle.manifest.version}`, stored);
    }
    return this.registry.listTemplates().flatMap((contract) =>
      this.registry.listVersions(contract.id).map((version) => {
        const stored = persistidos.get(`${contract.id}@${version}`);
        const resumen = summarize(this.registry.getTemplate(contract.id, version));
        return {
          ...resumen,
          origin: stored ? ('custom' as const) : ('builtin' as const),
          status: stored?.status ?? ('published' as const),
          createdAt: stored?.createdAt,
          createdBy: stored?.createdBy,
          checksum: stored?.checksum,
        };
      }),
    );
  }

  /** El paquete tal cual se subió: se descarga, se edita y se vuelve a publicar como otra versión. */
  async source(templateId: string, version: string): Promise<TemplateBundle> {
    const stored = await this.store.get(templateId, version);
    if (!stored) {
      // Distinguir «no existe» de «existe pero es incorporado» importa: lo segundo se
      // resuelve mirando el repositorio, y lo primero comprobando el identificador.
      if (this.registry.hasTemplate(templateId, version)) {
        throw new TemplateBuiltinProtectedError(templateId, version);
      }
      throw new TemplateVersionNotFoundError(
        templateId,
        version,
        this.registry.listVersions(templateId),
      );
    }
    return stored.bundle;
  }

  async deprecate(templateId: string, version: string): Promise<StoredTemplate> {
    await this.assertCustom(templateId, version);
    return this.store.setStatus(templateId, version, 'deprecated');
  }

  async republish(templateId: string, version: string): Promise<StoredTemplate> {
    await this.assertCustom(templateId, version);
    return this.store.setStatus(templateId, version, 'published');
  }

  /**
   * Borra una versión de verdad.
   *
   * Existe para deshacer una publicación equivocada, no para hacer sitio. Quien la use sobre
   * una versión con documentos emitidos pierde la capacidad de reproducirlos, y por eso el
   * camino recomendado —y el que documenta la API— es `deprecate`.
   */
  async remove(templateId: string, version: string): Promise<void> {
    await this.assertCustom(templateId, version);
    await this.store.remove(templateId, version);
    this.registry.unregister(templateId, version);
    this.logger.warn('Template retirado del catálogo', { template: `${templateId}@${version}` });
  }

  private async assertCustom(templateId: string, version: string): Promise<StoredTemplate> {
    const stored = await this.store.get(templateId, version);
    if (stored) return stored;
    if (this.registry.hasTemplate(templateId, version)) {
      throw new TemplateBuiltinProtectedError(templateId, version);
    }
    throw new TemplateVersionNotFoundError(
      templateId,
      version,
      this.registry.listVersions(templateId),
    );
  }

  /** Siguiente versión de parche sobre la mayor publicada, para sugerirla en el error. */
  private nextVersion(templateId: string, intentada: string): string {
    const publicadas = [...this.registry.listVersions(templateId), intentada].sort(compareVersions);
    const [major, minor, patch] = (publicadas.at(-1) ?? intentada).split('.').map(Number);
    return `${major}.${minor}.${patch + 1}`;
  }
}
