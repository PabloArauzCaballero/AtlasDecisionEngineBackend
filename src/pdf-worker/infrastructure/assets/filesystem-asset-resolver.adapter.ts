/**
 * Resuelve recursos desde un directorio del disco y los devuelve como `data:` URI (§22).
 *
 * Tres barreras, y ninguna sobra:
 *
 *  1. **Sólo `asset:<nombre>`.** Una URL —`http://169.254.169.254/…`, la dirección de
 *     metadatos de cualquier nube— se rechaza aquí, no en el navegador. Es la forma más
 *     directa de SSRF en un generador de PDF y la más fácil de pasar por alto, porque «poner
 *     el logotipo por URL» parece de lo más razonable.
 *  2. **Nombre sin rutas.** Se prohíbe `/`, `\` y `..` ANTES de tocar el disco, y después se
 *     comprueba que la ruta resuelta cuelga de la raíz. Comprobar sólo lo segundo bastaría,
 *     pero el mensaje de error resultante no diría qué se intentó.
 *  3. **Tope de tamaño.** Un recurso enorme se convierte en base64 —un 33 % más— dentro del
 *     HTML de CADA documento que lo use.
 */
import { Injectable } from '@nestjs/common';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { AssetResolverPort, ResolvedAsset } from '../../application/ports/asset-resolver.port';
import { AssetResolutionError } from '../../domain/errors/pdf-worker.errors';

export const ASSETS_ROOT_TOKEN = Symbol('PdfAssetsRoot');

/** 2 MiB: un logotipo institucional razonable pesa menos de 100 KiB. */
const MAX_ASSET_BYTES = 2 * 1024 * 1024;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

@Injectable()
export class FilesystemAssetResolverAdapter implements AssetResolverPort {
  private readonly cache = new Map<string, ResolvedAsset>();

  constructor(private readonly root: string) {}

  async resolve(reference: string): Promise<ResolvedAsset> {
    const cached = this.cache.get(reference);
    if (cached) return cached;

    const name = this.assertReference(reference);
    const path = resolve(join(this.root, name));
    const rootAbsolute = resolve(this.root);
    const rel = relative(rootAbsolute, path);
    if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
      throw new AssetResolutionError(
        reference,
        'la ruta resuelta cae fuera del directorio de recursos.',
      );
    }

    const mimeType = MIME_BY_EXTENSION[extname(name).toLowerCase()];
    if (!mimeType) {
      throw new AssetResolutionError(
        reference,
        `extensión no admitida. Admitidas: ${Object.keys(MIME_BY_EXTENSION).join(', ')}.`,
      );
    }

    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) {
      const available = await this.listAvailable().catch(() => []);
      throw new AssetResolutionError(
        reference,
        `no existe en ${rootAbsolute}. Disponibles: ${available.join(', ') || 'ninguno'}.`,
      );
    }
    if (info.size > MAX_ASSET_BYTES) {
      throw new AssetResolutionError(
        reference,
        `pesa ${info.size} bytes y el máximo son ${MAX_ASSET_BYTES}.`,
      );
    }

    const bytes = await readFile(path);
    const resolved: ResolvedAsset = {
      reference,
      mimeType,
      dataUri: `data:${mimeType};base64,${bytes.toString('base64')}`,
      sizeBytes: bytes.byteLength,
    };
    this.cache.set(reference, resolved);
    return resolved;
  }

  async warmup(references: readonly string[]): Promise<void> {
    // En serie y no en paralelo: son un puñado de archivos y el primer fallo debe señalar
    // exactamente cuál, no llegar mezclado con otros cuatro rechazos simultáneos.
    for (const reference of references) await this.resolve(reference);
  }

  async listAvailable(): Promise<readonly string[]> {
    try {
      const entries = await readdir(resolve(this.root));
      return entries.filter((entry) => extname(entry).toLowerCase() in MIME_BY_EXTENSION).sort();
    } catch {
      return [];
    }
  }

  private assertReference(reference: string): string {
    if (!reference.startsWith('asset:')) {
      throw new AssetResolutionError(
        reference,
        'debe declararse como «asset:<nombre>». No se admiten URL ni rutas del sistema de archivos.',
      );
    }
    const name = reference.slice('asset:'.length);
    if (!SAFE_NAME.test(name) || name.includes('..')) {
      throw new AssetResolutionError(
        reference,
        'el nombre sólo admite letras, dígitos, punto, guion y guion bajo, sin separadores de ruta.',
      );
    }
    return name;
  }
}
