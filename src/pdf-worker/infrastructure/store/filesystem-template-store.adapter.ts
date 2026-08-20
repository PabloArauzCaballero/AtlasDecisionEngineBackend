/**
 * Almacén de templates publicados por la API, sobre disco.
 *
 * Un archivo JSON por versión: `<id>@<version>.json`. Plano y legible a propósito — se puede
 * abrir, diferenciar y copiar a otro despliegue sin herramientas. Un formato binario o una
 * base de datos ahorrarían poco y quitarían justo eso.
 *
 * El nombre del archivo se construye SÓLO con `id` y `version`, que ya vienen validados contra
 * sus expresiones regulares antes de llegar aquí, y aun así se comprueba la contención de
 * ruta: es el mismo razonamiento que en el resolutor de recursos —la barrera se pone donde
 * ocurre el daño, no donde se confía—.
 */
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { TemplateStorePort } from '../../application/ports/template-store.port';
import type { StoredTemplate, TemplateBundle } from '../../domain/contracts/template-bundle';
import {
  TemplateAlreadyRegisteredError,
  TemplateStoreError,
  TemplateVersionNotFoundError,
} from '../../domain/errors/pdf-worker.errors';
import {
  TEMPLATE_ID_PATTERN,
  TEMPLATE_VERSION_PATTERN,
} from '../../domain/value-objects/template-ref';

@Injectable()
export class FilesystemTemplateStoreAdapter implements TemplateStorePort {
  constructor(private readonly root: string) {}

  async list(): Promise<readonly StoredTemplate[]> {
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch {
      // Que el directorio no exista es el estado normal de un despliegue que nunca publicó
      // nada por la API. No es un error, es «no hay ninguno».
      return [];
    }
    const stored: StoredTemplate[] = [];
    for (const entry of entries.filter((name) => name.endsWith('.json'))) {
      const raw = await readFile(join(this.root, entry), 'utf8').catch(() => undefined);
      if (!raw) continue;
      try {
        stored.push(JSON.parse(raw) as StoredTemplate);
      } catch {
        // Un archivo corrupto no puede impedir que carguen los demás: se omite y el arranque
        // lo delata por diferencia entre lo que hay en disco y lo que quedó registrado.
        continue;
      }
    }
    return stored;
  }

  async get(templateId: string, version: string): Promise<StoredTemplate | undefined> {
    const raw = await readFile(this.pathOf(templateId, version), 'utf8').catch(() => undefined);
    return raw ? (JSON.parse(raw) as StoredTemplate) : undefined;
  }

  async save(bundle: TemplateBundle, meta: { createdBy?: string }): Promise<StoredTemplate> {
    const { id, version } = bundle.manifest;
    if (await this.get(id, version)) {
      throw new TemplateAlreadyRegisteredError(id, version);
    }
    const now = new Date().toISOString();
    const stored: StoredTemplate = {
      bundle,
      origin: 'custom',
      status: 'published',
      createdAt: now,
      updatedAt: now,
      createdBy: meta.createdBy,
      checksum: checksumOf(bundle),
    };
    await this.write(id, version, stored, 'wx');
    return stored;
  }

  async setStatus(
    templateId: string,
    version: string,
    status: StoredTemplate['status'],
  ): Promise<StoredTemplate> {
    const current = await this.get(templateId, version);
    if (!current) throw new TemplateVersionNotFoundError(templateId, version, []);
    // Se reescribe la ficha entera pero el `bundle` y su `checksum` no se tocan: cambiar el
    // estado no puede alterar lo que el template produce, o dejaría de ser el mismo documento.
    const updated: StoredTemplate = { ...current, status, updatedAt: new Date().toISOString() };
    await this.write(templateId, version, updated, 'w');
    return updated;
  }

  async remove(templateId: string, version: string): Promise<void> {
    await rm(this.pathOf(templateId, version), { force: true });
  }

  private async write(
    templateId: string,
    version: string,
    stored: StoredTemplate,
    flag: 'w' | 'wx',
  ): Promise<void> {
    try {
      await mkdir(resolve(this.root), { recursive: true });
      await writeFile(this.pathOf(templateId, version), `${JSON.stringify(stored, null, 2)}\n`, {
        encoding: 'utf8',
        flag,
      });
    } catch (error) {
      if (error instanceof TemplateAlreadyRegisteredError) throw error;
      throw new TemplateStoreError(
        'guardar',
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
  }

  private pathOf(templateId: string, version: string): string {
    if (!TEMPLATE_ID_PATTERN.test(templateId) || !TEMPLATE_VERSION_PATTERN.test(version)) {
      throw new TemplateStoreError(
        'localizar',
        `identificador o versión inválidos: ${templateId}@${version}`,
      );
    }
    const path = resolve(join(this.root, `${templateId}@${version}.json`));
    const rel = relative(resolve(this.root), path);
    if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
      throw new TemplateStoreError('localizar', 'la ruta resuelta cae fuera del almacén.');
    }
    return path;
  }
}

/**
 * Huella del paquete.
 *
 * Sirve para dos cosas: detectar que alguien editó el JSON por debajo del worker, y para que
 * dos despliegues puedan compararse sin diferenciar archivos enteros.
 */
export function checksumOf(bundle: TemplateBundle): string {
  return createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
}
