import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { UpsertSemanticCategoryDto } from './semantic-category.dto';

export function noExiste(code: string): DomainException {
  return new DomainException(
    'SEMANTIC_CATEGORY_NOT_FOUND',
    `No existe la categoría ${code}.`,
    HttpStatus.NOT_FOUND,
  );
}

export function toRow(dto: UpsertSemanticCategoryDto) {
  return {
    code: dto.code,
    name: dto.name,
    description: dto.description,
    parentCode: dto.parentCode ?? null,
    positiveExamples: dto.positiveExamples ?? [],
    counterExamples: dto.counterExamples ?? [],
    restrictions: dto.restrictions ?? [],
    relatedCategoryCodes: dto.relatedCategoryCodes ?? [],
    acceptanceThreshold: new Prisma.Decimal(dto.acceptanceThreshold ?? 0.62),
    isActive: dto.isActive ?? true,
    ...(dto.version === undefined ? {} : { version: dto.version }),
  };
}

/**
 * Lo mismo, pero para una fila que YA existe: la versión sube.
 *
 * La versión no es un adorno. La firma del catálogo es
 * `code@version` por categoría (`CatalogCache.signatureOf`), y de esa firma
 * cuelgan la caché de clasificación y los vectores de sonda del recuperador.
 * Mientras no cambie, las dos siguen sirviendo lo que calcularon con los
 * ejemplos ANTERIORES.
 *
 * Sin esto, editar los ejemplos de una categoría no tenía ningún efecto
 * observable. Medido el 2026-09-01: añadir quince comercios bolivianos a dos
 * hojas y reclasificar dio CERO cambios; reiniciando el worker —lo único que
 * vacía esas cachés— los mismos quince corrigieron trece movimientos. Es la
 * peor forma del defecto, porque el import responde `updated: [...]`, la fila
 * queda escrita y todo parece haber funcionado.
 *
 * Deja de ser cierto lo que `semantic-worker.config.ts` promete de la caché de
 * clasificación —«su clave incluye la firma del catálogo, así que publicar una
 * categoría invalida lo afectado sola»— sólo si la versión sube. Ahora sube.
 *
 * Una versión explícita en el DTO sigue mandando: es la vía para reimportar un
 * conjunto con sus versiones tal cual, sin inflarlas en cada pasada.
 */
export function toUpdateRow(dto: UpsertSemanticCategoryDto) {
  const fila = toRow(dto);
  if (dto.version !== undefined) return fila;
  return { ...fila, version: { increment: 1 } };
}

export function present(fila: {
  code: string;
  name: string;
  description: string;
  parentCode: string | null;
  positiveExamples: unknown;
  counterExamples: unknown;
  restrictions: unknown;
  relatedCategoryCodes: unknown;
  acceptanceThreshold: Prisma.Decimal;
  version: number;
  isActive: boolean;
}) {
  return {
    code: fila.code,
    name: fila.name,
    description: fila.description,
    parentCode: fila.parentCode,
    positiveExamples: asStrings(fila.positiveExamples),
    counterExamples: asStrings(fila.counterExamples),
    restrictions: asStrings(fila.restrictions),
    relatedCategoryCodes: asStrings(fila.relatedCategoryCodes),
    acceptanceThreshold: Number(fila.acceptanceThreshold),
    version: fila.version,
    isActive: fila.isActive,
  };
}

/** Las columnas son `jsonb`: lo que hay dentro lo escribió una versión anterior. */
export function asStrings(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((x): x is string => typeof x === 'string') : [];
}
