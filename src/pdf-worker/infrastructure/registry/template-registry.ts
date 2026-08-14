/**
 * El catálogo de templates en memoria (§8).
 *
 * Un `Map<id, Map<version, contrato>>` y ni un solo `switch (templateId)` en todo el worker.
 * Esa ausencia es el §50 hecho estructura: añadir el vigésimo documento es registrar un
 * contrato más, no ampliar un condicional que ya nadie lee entero.
 *
 * Registrar dos veces la misma pareja `id@version` FALLA. Es la decisión del §9 y tiene una
 * consecuencia que se ve en el archivo: un informe emitido hace un año declara con qué
 * template salió, y esa declaración sólo significa algo si esa versión no ha cambiado desde
 * entonces. Publicar una corrección es publicar `1.0.1`, no reescribir `1.0.0`.
 */
import { Injectable } from '@nestjs/common';
import type { TemplateContract } from '../../domain/contracts/template-contract';
import {
  TemplateAlreadyRegisteredError,
  TemplateNotFoundError,
  TemplateVersionNotFoundError,
} from '../../domain/errors/pdf-worker.errors';
import {
  TEMPLATE_ID_PATTERN,
  TEMPLATE_VERSION_PATTERN,
  compareVersions,
  latestVersion,
} from '../../domain/value-objects/template-ref';
import type { TemplateRepositoryPort } from '../../application/ports/template-repository.port';

@Injectable()
export class TemplateRegistry implements TemplateRepositoryPort {
  private readonly versionsById = new Map<string, Map<string, TemplateContract>>();

  register(contract: TemplateContract): void {
    if (!TEMPLATE_ID_PATTERN.test(contract.id)) {
      throw new TemplateNotFoundError(contract.id, this.templateIds());
    }
    if (!TEMPLATE_VERSION_PATTERN.test(contract.version)) {
      throw new TemplateVersionNotFoundError(contract.id, contract.version, []);
    }
    const versions = this.versionsById.get(contract.id) ?? new Map<string, TemplateContract>();
    if (versions.has(contract.version)) {
      throw new TemplateAlreadyRegisteredError(contract.id, contract.version);
    }
    versions.set(contract.version, contract);
    this.versionsById.set(contract.id, versions);
  }

  getTemplate(templateId: string, version?: string): TemplateContract {
    const versions = this.versionsById.get(templateId);
    if (!versions) throw new TemplateNotFoundError(templateId, this.templateIds());

    const resolved = version ?? latestVersion([...versions.keys()]);
    const contract = resolved ? versions.get(resolved) : undefined;
    if (!contract) {
      throw new TemplateVersionNotFoundError(
        templateId,
        version ?? '(última)',
        this.listVersions(templateId),
      );
    }
    return contract;
  }

  /**
   * Retira una versión del registro en memoria.
   *
   * Sólo lo usa la administración, y sólo para templates publicados por la API. Es una
   * operación deliberadamente cruda —el registro no sabe de orígenes ni de permisos—: quién
   * puede retirar qué lo decide el caso de uso, que es quien tiene esa información.
   */
  unregister(templateId: string, version: string): void {
    const versions = this.versionsById.get(templateId);
    if (!versions?.delete(version)) {
      throw new TemplateVersionNotFoundError(templateId, version, this.listVersions(templateId));
    }
    if (versions.size === 0) this.versionsById.delete(templateId);
  }

  hasTemplate(templateId: string, version?: string): boolean {
    const versions = this.versionsById.get(templateId);
    if (!versions) return false;
    return version === undefined ? versions.size > 0 : versions.has(version);
  }

  /** Un contrato por template: siempre el de su última versión. */
  listTemplates(): readonly TemplateContract[] {
    return [...this.versionsById.keys()].sort().map((id) => this.getTemplate(id));
  }

  listVersions(templateId: string): readonly string[] {
    const versions = this.versionsById.get(templateId);
    if (!versions) return [];
    return [...versions.keys()].sort(compareVersions);
  }

  getLatestVersion(templateId: string): string {
    const versions = this.listVersions(templateId);
    const latest = latestVersion(versions);
    if (!latest) throw new TemplateNotFoundError(templateId, this.templateIds());
    return latest;
  }

  /** Número de PAREJAS `id@version`, no de templates: es lo que hay que cargar al arrancar. */
  get size(): number {
    let total = 0;
    for (const versions of this.versionsById.values()) total += versions.size;
    return total;
  }

  private templateIds(): readonly string[] {
    return [...this.versionsById.keys()].sort();
  }
}
