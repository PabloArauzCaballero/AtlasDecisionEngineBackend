/**
 * Embebe en el documento las fuentes que encuentre en `templates/shared/fonts/` (§23).
 *
 * Convención de nombres: `<familia>-<peso>[-italic].woff2`, en minúsculas. `atlas-sans-700.woff2`
 * publica la familia «Atlas Sans» con peso 700. El nombre de la familia se deriva del archivo,
 * así que añadir un peso es copiar un archivo — no tocar código.
 *
 * **Este repositorio no incluye ningún archivo de fuente**, y no es un olvido: una tipografía
 * es un artefacto con licencia y meterla en el árbol de código convierte cada clon del
 * repositorio en una redistribución. Con la carpeta vacía el worker sigue funcionando y lo
 * DICE —`embedded: []`, que `/health` publica—, apoyándose en la pila de respaldo que el
 * Dockerfile instala (Liberation y DejaVu). Esa pila es idéntica en desarrollo, CI y
 * producción mientras todos usen la imagen; lo que no es idéntico es ejecutar fuera de ella,
 * y por eso el estado se publica en vez de suponerse.
 */
import { Injectable } from '@nestjs/common';
import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { FontFaceBundle, FontProviderPort } from '../../application/ports/font-provider.port';

/** Respaldos que el contenedor garantiza; ver el Dockerfile. */
const FALLBACK_SANS = "'Liberation Sans', 'DejaVu Sans', Arial, Helvetica, sans-serif";
const FALLBACK_MONO = "'Liberation Mono', 'DejaVu Sans Mono', 'Courier New', monospace";

const FONT_FILE = /^([a-z0-9-]+?)-(\d{3})(-italic)?\.(woff2|woff|ttf)$/;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/** 900 KiB por archivo: una `woff2` latina completa ronda los 30–60 KiB. */
const MAX_FONT_BYTES = 900 * 1024;

@Injectable()
export class FontRegistryAdapter implements FontProviderPort {
  private bundle?: Promise<FontFaceBundle>;

  constructor(private readonly root: string) {}

  load(): Promise<FontFaceBundle> {
    this.bundle ??= this.build();
    return this.bundle;
  }

  private async build(): Promise<FontFaceBundle> {
    const files = await readdir(this.root).catch(() => [] as string[]);
    const faces: string[] = [];
    const families = new Set<string>();
    let totalBytes = 0;

    for (const file of files.sort()) {
      const match = FONT_FILE.exec(file.toLowerCase());
      const mimeType = MIME_BY_EXTENSION[extname(file).toLowerCase()];
      if (!match || !mimeType) continue;

      const bytes = await readFile(join(this.root, file));
      // Se OMITE en vez de fallar: una fuente enorme degrada el documento, no lo impide, y
      // abortar el arranque por un archivo que alguien dejó ahí sería peor que ignorarlo.
      if (bytes.byteLength > MAX_FONT_BYTES) continue;

      const family = titleCase(match[1]);
      families.add(family);
      totalBytes += bytes.byteLength;
      faces.push(
        [
          '@font-face {',
          `  font-family: '${family}';`,
          `  font-style: ${match[3] ? 'italic' : 'normal'};`,
          `  font-weight: ${match[2]};`,
          // `block` y no `swap`: en pantalla `swap` evita el texto invisible, pero al imprimir
          // no hay «después» — si la fuente llega tarde, el PDF sale ya maquetado con la de
          // respaldo y con otras métricas. Aquí el archivo es local, así que bloquear no cuesta.
          '  font-display: block;',
          `  src: url(data:${mimeType};base64,${bytes.toString('base64')}) format('${formatOf(mimeType)}');`,
          '}',
        ].join('\n'),
      );
    }

    const sansFamily = [...families].find((family) => family.toLowerCase().includes('sans'));
    const monoFamily = [...families].find((family) => family.toLowerCase().includes('mono'));

    return {
      css: faces.join('\n'),
      embedded: [...families].sort(),
      fontFamily: sansFamily ? `'${sansFamily}', ${FALLBACK_SANS}` : FALLBACK_SANS,
      monoFamily: monoFamily ? `'${monoFamily}', ${FALLBACK_MONO}` : FALLBACK_MONO,
      totalBytes,
    };
  }
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatOf(mimeType: string): string {
  if (mimeType === 'font/woff2') return 'woff2';
  if (mimeType === 'font/woff') return 'woff';
  return 'truetype';
}

/** Nombre del archivo sin extensión, útil para los mensajes de diagnóstico. */
export function fontFamilyOf(file: string): string {
  return basename(file, extname(file));
}
