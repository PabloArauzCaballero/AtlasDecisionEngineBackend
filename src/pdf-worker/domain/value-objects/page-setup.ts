/**
 * Geometría de la página: formato, orientación, márgenes y fondo.
 *
 * Los márgenes se expresan como longitud CSS (`18mm`) y no como número, porque es lo que
 * entiende el motor de impresión y porque un número obliga a fijar la unidad en algún sitio,
 * que es donde luego aparece el documento con márgenes de 18 píxeles.
 *
 * `assertPageSetup` valida la longitud contra una expresión estricta. No es paranoia
 * decorativa: estos valores acaban dentro de las opciones del motor y, en el caso del
 * membrete, dentro de una plantilla HTML. Una cadena arbitraria ahí es la primera pieza de
 * una inyección (§24).
 */
import {
  PAGE_FORMATS,
  PAGE_ORIENTATIONS,
  type PageFormat,
  type PageOrientation,
} from '../enums/document.enums';
import { InvalidBrandError } from '../errors/pdf-worker.errors';

/** Número decimal + unidad de impresión. `pt` y `px` se admiten; `%` y `em` no tienen sentido aquí. */
export const CSS_LENGTH_PATTERN = /^(0|[0-9]{1,4}(\.[0-9]{1,3})?)(mm|cm|in|pt|px)$/;

export interface PageMargins {
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly left: string;
}

export interface PageSetup {
  readonly format: PageFormat;
  readonly orientation: PageOrientation;
  readonly margins: PageMargins;
  /** Sin esto, Chromium descarta fondos y bordes de color: las tablas salen sin cebra. */
  readonly printBackground: boolean;
  /** Escala del contenido, 0.1–2. Última salida para un documento que se pasa por poco. */
  readonly scale: number;
}

export type PageSetupOverrides = Partial<Omit<PageSetup, 'margins'>> & {
  readonly margins?: Partial<PageMargins>;
};

/**
 * Márgenes por defecto.
 *
 * Superior e inferior son GRANDES a propósito: ahí es donde el motor de impresión dibuja el
 * membrete y el pie corridos, y esos dos no empujan el contenido — se pintan ENCIMA. Con los
 * 10 mm habituales, el membrete tapaba la primera línea de cada página y el defecto sólo se
 * veía a partir de la segunda, que es cuando ya nadie está mirando.
 */
export const DEFAULT_PAGE_SETUP: PageSetup = Object.freeze({
  format: 'A4',
  orientation: 'portrait',
  margins: Object.freeze({ top: '32mm', right: '16mm', bottom: '22mm', left: '16mm' }),
  printBackground: true,
  scale: 1,
});

function assertLength(value: string, field: string, owner: string): void {
  if (!CSS_LENGTH_PATTERN.test(value)) {
    throw new InvalidBrandError(
      owner,
      `«${field}» debe ser una longitud de impresión (p. ej. «18mm»), y llegó «${value}».`,
    );
  }
}

/** Valida un `PageSetup` ya fusionado. Lanza `InvalidBrandError` con el campo exacto. */
export function assertPageSetup(setup: PageSetup, owner: string): void {
  if (!PAGE_FORMATS.includes(setup.format)) {
    throw new InvalidBrandError(owner, `formato «${setup.format}» desconocido.`);
  }
  if (!PAGE_ORIENTATIONS.includes(setup.orientation)) {
    throw new InvalidBrandError(owner, `orientación «${setup.orientation}» desconocida.`);
  }
  if (!Number.isFinite(setup.scale) || setup.scale < 0.1 || setup.scale > 2) {
    throw new InvalidBrandError(
      owner,
      `la escala debe estar entre 0.1 y 2 (llegó ${setup.scale}).`,
    );
  }
  assertLength(setup.margins.top, 'margins.top', owner);
  assertLength(setup.margins.right, 'margins.right', owner);
  assertLength(setup.margins.bottom, 'margins.bottom', owner);
  assertLength(setup.margins.left, 'margins.left', owner);
}

/** Fusiona capas de configuración respetando el orden de precedencia de §13. */
export function mergePageSetup(
  base: PageSetup,
  ...layers: readonly (PageSetupOverrides | undefined)[]
): PageSetup {
  return layers.reduce<PageSetup>((accumulated, layer) => {
    if (!layer) return accumulated;
    return {
      format: layer.format ?? accumulated.format,
      orientation: layer.orientation ?? accumulated.orientation,
      printBackground: layer.printBackground ?? accumulated.printBackground,
      scale: layer.scale ?? accumulated.scale,
      margins: { ...accumulated.margins, ...layer.margins },
    };
  }, base);
}
