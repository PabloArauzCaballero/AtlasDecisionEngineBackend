/**
 * Precedencia de configuración y qué puede tocar una petición (§13).
 *
 *     defaults globales  →  marca  →  template  →  petición
 *
 * La parte que importa no es el orden, que es obvio, sino el FILTRO: la petición sólo puede
 * mover una lista corta y publicada. Sin ese filtro, cualquier consumidor podría fijar la
 * tipografía, el pie institucional o los márgenes, y a partir de ese momento el generador
 * dejaría de poder cambiar el diseño sin romperle el informe a alguien — que es exactamente
 * la plataforma que el §51 dice NO querer.
 *
 * Un intento de sobrescribir algo protegido se RECHAZA. Ignorarlo produce un documento que no
 * es el que se pidió, y nadie lo descubre hasta que lo abre.
 */
import {
  DOCUMENT_CLASSIFICATIONS,
  type DocumentClassification,
} from '../../domain/enums/document.enums';
import { ProtectedOptionOverrideError } from '../../domain/errors/pdf-worker.errors';
import type { DocumentBrand } from '../../domain/value-objects/document-brand';
import type { TemplateContract } from '../../domain/contracts/template-contract';
import {
  DEFAULT_PAGE_SETUP,
  assertPageSetup,
  mergePageSetup,
  type PageSetup,
} from '../../domain/value-objects/page-setup';
import type { GenerationOptions } from '../dto/generate-pdf.command';

/**
 * Lo único que una petición puede fijar. `page` admite dos claves y ninguna más.
 *
 * Los márgenes quedan FUERA aunque parezcan inocentes: el membrete y el pie corridos se
 * pintan dentro del margen superior e inferior, así que reducirlos desde la petición hace que
 * la cabecera tape el contenido. Es un fallo que sólo se ve al abrir el PDF y que el llamante
 * no puede prever, porque no sabe qué alto tiene el membrete de esa marca.
 */
export const OVERRIDABLE_REQUEST_OPTIONS = Object.freeze([
  'persist',
  'filename',
  'classification',
  'returnContent',
  'page.format',
  'page.orientation',
]);

/** Publicado en la documentación y en `GET /pdf/templates/:id`, para que no haya sorpresas. */
export const PROTECTED_OPTIONS = Object.freeze([
  'page.margins',
  'page.printBackground',
  'page.scale',
  'letterhead',
  'footer',
  'brand',
  'styles',
  'html',
  'template',
  'assets',
  'layout',
]);

const ALLOWED_TOP_LEVEL = new Set([
  'persist',
  'filename',
  'classification',
  'returnContent',
  'page',
]);
const ALLOWED_PAGE_KEYS = new Set(['format', 'orientation']);

/**
 * Comprueba el objeto `options` TAL COMO LLEGÓ, antes de tipar nada.
 *
 * Se hace sobre el JSON crudo porque el tipo `GenerationOptions` no existe en ejecución: un
 * cliente puede mandar `{"page":{"scale":3}}` y TypeScript no se entera de nada.
 */
export function assertOnlyOverridable(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProtectedOptionOverrideError(['options']);
  }
  const attempted: string[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) {
      attempted.push(key);
      continue;
    }
    if (key !== 'page' || value === undefined || value === null) continue;
    if (typeof value !== 'object' || Array.isArray(value)) {
      attempted.push('page');
      continue;
    }
    for (const pageKey of Object.keys(value as Record<string, unknown>)) {
      if (!ALLOWED_PAGE_KEYS.has(pageKey)) attempted.push(`page.${pageKey}`);
    }
  }
  if (attempted.length > 0) throw new ProtectedOptionOverrideError(attempted);
}

/** Geometría efectiva: defaults → marca → template → petición (sólo formato y orientación). */
export function resolvePageSetup(
  brand: DocumentBrand,
  contract: TemplateContract,
  options: GenerationOptions | undefined,
): PageSetup {
  const requested = options?.page
    ? { format: options.page.format, orientation: options.page.orientation }
    : undefined;
  const setup = mergePageSetup(DEFAULT_PAGE_SETUP, brand.page, contract.page, requested);
  assertPageSetup(setup, `${brand.id}/${contract.id}`);
  return setup;
}

/**
 * Clasificación efectiva: la MÁS restrictiva de las tres.
 *
 * La petición puede subirla, nunca bajarla. Un template que se declara `CONFIDENTIAL` lo hace
 * porque el documento que produce lo es; permitir que una petición lo rebaje a `PUBLIC`
 * convertiría el rótulo en una preferencia del llamante, y entonces no significa nada.
 */
export function resolveClassification(
  brand: DocumentBrand,
  contract: TemplateContract,
  requested: DocumentClassification | undefined,
): DocumentClassification | undefined {
  const candidates = [brand.footer.classification, contract.classification, requested].filter(
    (value): value is DocumentClassification => value !== undefined,
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((strictest, candidate) =>
    DOCUMENT_CLASSIFICATIONS.indexOf(candidate) > DOCUMENT_CLASSIFICATIONS.indexOf(strictest)
      ? candidate
      : strictest,
  );
}

/** Membrete efectivo: la marca manda, el template puede afinar textos secundarios. */
export function resolveLetterhead(brand: DocumentBrand, contract: TemplateContract) {
  return { ...brand.letterhead, ...contract.letterhead };
}

export function resolveFooter(
  brand: DocumentBrand,
  contract: TemplateContract,
  classification: DocumentClassification | undefined,
) {
  return { ...brand.footer, ...contract.footer, classification };
}
