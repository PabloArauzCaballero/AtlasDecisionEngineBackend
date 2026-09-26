/**
 * Identidad visual institucional, separada del contenido (§12).
 *
 * Un template describe QUÉ dice el documento; una marca describe CÓMO se ve la organización
 * que lo firma. Mantenerlos separados es lo que permite que el mismo `generic-result-report`
 * salga con el membrete de dos filiales sin duplicar una sola línea de plantilla — que es el
 * fallo que aparece siempre que el logotipo se escribe dentro del template.
 */
import type { DocumentClassification, LetterheadMode } from '../enums/document.enums';
import { InvalidBrandError } from '../errors/pdf-worker.errors';
import { CSS_LENGTH_PATTERN, type PageSetupOverrides } from './page-setup';

/**
 * Referencia a un recurso, NO una URL.
 *
 * La resuelve `AssetResolverPort` contra un catálogo cerrado y la convierte en `data:` URI.
 * El tipo es una cadena porque atraviesa JSON, pero la forma admitida es `asset:<nombre>`;
 * cualquier `http(s)://` se rechaza en la resolución, que es la barrera contra SSRF (§24).
 */
export type AssetReference = string;

export interface LetterheadConfig {
  readonly organizationName: string;
  readonly logo?: AssetReference;
  readonly legalName?: string;
  readonly taxId?: string;
  readonly address?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly website?: string;
  readonly secondaryText?: string;
  /** `every-page` lo pinta el motor de impresión en el margen superior de todas las hojas. */
  readonly mode: LetterheadMode;
}

export interface FooterConfig {
  readonly institutionalText?: string;
  readonly showGeneratedAt: boolean;
  readonly showDocumentId: boolean;
  readonly showPageNumbers: boolean;
  readonly classification?: DocumentClassification;
}

export interface BrandPalette {
  readonly ink: string;
  readonly inkMuted: string;
  readonly accent: string;
  readonly surface: string;
  readonly surfaceMuted: string;
  readonly line: string;
  readonly positive: string;
  readonly caution: string;
  readonly critical: string;
}

export interface BrandTypography {
  /**
   * Pila de fuentes. La primera familia debe estar EMBEBIDA (ver `FontRegistry`); las demás
   * son el respaldo cuando el despliegue no ha incorporado ninguna. Sin fuente embebida el
   * documento depende de lo que tenga instalado el sistema, y deja de ser reproducible (§23).
   */
  readonly fontFamily: string;
  readonly monoFamily: string;
  readonly baseSizePt: number;
  readonly lineHeight: number;
}

export interface BrandSpacing {
  readonly blockGap: string;
  readonly sectionGap: string;
  readonly cellPaddingY: string;
  readonly cellPaddingX: string;
}

export interface DocumentBrand {
  readonly id: string;
  readonly name: string;
  readonly letterhead: LetterheadConfig;
  readonly footer: FooterConfig;
  readonly palette: BrandPalette;
  readonly typography: BrandTypography;
  readonly spacing: BrandSpacing;
  /** Geometría por defecto de esta marca; el template todavía puede afinarla. */
  readonly page?: PageSetupOverrides;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Longitud máxima de cualquier texto del membrete: cabe en la banda y acota el log. */
const MAX_TEXT = 160;

function assertText(value: string | undefined, field: string, brandId: string): void {
  if (value === undefined) return;
  if (value.length > MAX_TEXT) {
    throw new InvalidBrandError(brandId, `«${field}» supera los ${MAX_TEXT} caracteres.`);
  }
  // El membrete se inyecta en la plantilla de cabecera del motor de impresión, que es HTML
  // aparte y NO pasa por el escapado de Handlebars. Se escapa al componer, y además se
  // rechaza aquí: dos barreras, porque la marca la configura un operador y no un usuario.
  if (/[<>]/.test(value)) {
    throw new InvalidBrandError(brandId, `«${field}» no puede contener «<» ni «>».`);
  }
}

function assertColor(value: string, field: string, brandId: string): void {
  if (!HEX_COLOR.test(value)) {
    throw new InvalidBrandError(
      brandId,
      `«${field}» debe ser un color #rrggbb (llegó «${value}»).`,
    );
  }
}

function assertLength(value: string, field: string, brandId: string): void {
  if (!CSS_LENGTH_PATTERN.test(value)) {
    throw new InvalidBrandError(
      brandId,
      `«${field}» debe ser una longitud CSS (llegó «${value}»).`,
    );
  }
}

/** Valida una marca completa. Se ejecuta al registrarla, no al usarla: falla en el arranque. */
export function assertBrand(brand: DocumentBrand): void {
  const { id } = brand;
  if (!brand.letterhead.organizationName.trim()) {
    throw new InvalidBrandError(id, 'el membrete necesita al menos «organizationName».');
  }
  const { letterhead } = brand;
  assertText(letterhead.organizationName, 'letterhead.organizationName', id);
  assertText(letterhead.legalName, 'letterhead.legalName', id);
  assertText(letterhead.taxId, 'letterhead.taxId', id);
  assertText(letterhead.address, 'letterhead.address', id);
  assertText(letterhead.phone, 'letterhead.phone', id);
  assertText(letterhead.email, 'letterhead.email', id);
  assertText(letterhead.website, 'letterhead.website', id);
  assertText(letterhead.secondaryText, 'letterhead.secondaryText', id);
  assertText(brand.footer.institutionalText, 'footer.institutionalText', id);

  // `Object.entries` sobre una interfaz sin índice devuelve el valor como `any`. Se acota a
  // `Record<string, string>` en vez de confiar en la firma: la marca puede llegar de un JSON de
  // configuración —no sólo de un literal comprobado por el compilador— y estas dos funciones
  // producen el texto que acaba dentro de un `<style>`.
  const palette = brand.palette as unknown as Record<string, string>;
  for (const [field, color] of Object.entries(palette)) {
    assertColor(color, `palette.${field}`, id);
  }
  const spacing = brand.spacing as unknown as Record<string, string>;
  for (const [field, length] of Object.entries(spacing)) {
    assertLength(length, `spacing.${field}`, id);
  }
  const { baseSizePt, lineHeight } = brand.typography;
  if (baseSizePt < 6 || baseSizePt > 24) {
    throw new InvalidBrandError(id, `«typography.baseSizePt» fuera de 6–24 (llegó ${baseSizePt}).`);
  }
  if (lineHeight < 1 || lineHeight > 2.5) {
    throw new InvalidBrandError(
      id,
      `«typography.lineHeight» fuera de 1–2.5 (llegó ${lineHeight}).`,
    );
  }
  if (letterhead.logo && !letterhead.logo.startsWith('asset:')) {
    throw new InvalidBrandError(
      id,
      'el logotipo debe referenciarse como «asset:<nombre>»; no se admiten URL externas.',
    );
  }
}
