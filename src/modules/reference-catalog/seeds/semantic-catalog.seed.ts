/**
 * Siembra del árbol de categorías y de los alias de entidades del worker semántico (catálogo de referencia).
 *
 * Sin categorías el worker responde `UNKNOWN` a todo —se niega a clasificar contra un catálogo vacío, que es lo
 * correcto— y la pestaña «Categorías» del portal queda en blanco. Eso pasaba en TEST (2026-10-15): el catálogo
 * se movió del repositorio a una rama de PostgreSQL de semillas (`c4084c9`, 2026-08-31) y un entorno sin
 * `SEED_SOURCE_*` no lo recibía nunca.
 *
 * Sólo CREA lo que falta: una categoría que alguien editó en el portal no se toca, y una que se dio de baja no
 * vuelve. Es la misma regla que el padrón de entidades (`FinancialInstitutionService.syncSeed`).
 */
import type { PrismaClient } from '@prisma/client';
import { type SemanticCategorySeed, expenseCategoryTree } from './expense-category-tree.data';

/** Alias de entidades bolivianas que el resolutor debe reconocer (los quita del texto antes de clasificar). */
export const semanticEntityAliasCatalog: readonly {
  alias: string;
  canonicalName: string;
  entityType: string;
}[] = [
  { alias: 'BNB', canonicalName: 'Banco Nacional de Bolivia', entityType: 'INSTITUCION' },
  {
    alias: 'Banco Nacional',
    canonicalName: 'Banco Nacional de Bolivia',
    entityType: 'INSTITUCION',
  },
  { alias: 'BEC', canonicalName: 'Banco Económico', entityType: 'INSTITUCION' },
  { alias: 'Banco Economico', canonicalName: 'Banco Económico', entityType: 'INSTITUCION' },
  { alias: 'BISA', canonicalName: 'Banco BISA', entityType: 'INSTITUCION' },
  { alias: 'FIE', canonicalName: 'Banco FIE', entityType: 'INSTITUCION' },
  { alias: 'Banco Fassil', canonicalName: 'Banco Fassil', entityType: 'INSTITUCION' },
  { alias: 'Tigo Money', canonicalName: 'Tigo Money', entityType: 'INSTITUCION' },
  { alias: 'Banco Prodem', canonicalName: 'Banco Prodem', entityType: 'INSTITUCION' },
  { alias: 'Banco Fortaleza', canonicalName: 'Banco Fortaleza', entityType: 'INSTITUCION' },
  { alias: 'BCP', canonicalName: 'Banco de Crédito de Bolivia', entityType: 'INSTITUCION' },
  { alias: 'Banco Ganadero', canonicalName: 'Banco Ganadero', entityType: 'INSTITUCION' },
  { alias: 'BancoSol', canonicalName: 'Banco Solidario', entityType: 'INSTITUCION' },
  { alias: 'Banco Unión', canonicalName: 'Banco Unión', entityType: 'INSTITUCION' },
  { alias: 'Mercantil', canonicalName: 'Banco Mercantil Santa Cruz', entityType: 'INSTITUCION' },
  { alias: 'Bs', canonicalName: 'Boliviano', entityType: 'MONEDA' },
  { alias: 'bolivianos', canonicalName: 'Boliviano', entityType: 'MONEDA' },
  { alias: 'USD', canonicalName: 'Dólar estadounidense', entityType: 'MONEDA' },
  {
    alias: 'SOAT',
    canonicalName: 'Seguro Obligatorio de Accidentes de Tránsito',
    entityType: 'SERVICIO',
  },
  { alias: 'IVA', canonicalName: 'Impuesto al Valor Agregado', entityType: 'IMPUESTO' },
  { alias: 'RC-IVA', canonicalName: 'Régimen Complementario al IVA', entityType: 'IMPUESTO' },
];

/**
 * Agrupa el árbol por niveles (raíces, hijos, nietos…): la clave foránea `(tenant_id, parent_code)` exige que el
 * padre exista antes que el hijo. Un ciclo o un padre inexistente se denuncia en vez de sembrar a medias: un
 * catálogo parcial es peor que ninguno, porque el worker clasifica contra él sin saber que le falta la mitad.
 */
export function levelsOf(
  categories: readonly SemanticCategorySeed[],
): readonly (readonly SemanticCategorySeed[])[] {
  const levelOf = new Map<string, number>();
  const levels: SemanticCategorySeed[][] = [];
  let pending = [...categories];
  while (pending.length > 0) {
    const next: SemanticCategorySeed[] = [];
    for (const category of pending) {
      const parent = category.parentCode;
      if (parent === null) levelOf.set(category.code, 0);
      else if (levelOf.has(parent)) levelOf.set(category.code, (levelOf.get(parent) ?? 0) + 1);
      else {
        next.push(category);
        continue;
      }
      (levels[levelOf.get(category.code) ?? 0] ??= []).push(category);
    }
    if (next.length === pending.length) {
      throw new Error(
        `El árbol de categorías no se sostiene: hay un ciclo o un padre inexistente en ${next.map((c) => `${c.code} → ${String(c.parentCode)}`).join(', ')}.`,
      );
    }
    pending = next;
  }
  return levels;
}

type CatalogPrisma = Pick<PrismaClient, 'semanticCategory' | 'semanticEntityAlias'>;

/** Crea en el tenant las categorías y los alias que falten. Devuelve cuántos creó de cada uno. */
export async function seedSemanticCatalog(
  prisma: CatalogPrisma,
  tenantId: bigint,
  tree: readonly SemanticCategorySeed[] = expenseCategoryTree,
): Promise<{ categories: number; aliases: number }> {
  let categories = 0;
  for (const level of levelsOf(tree)) {
    const { count } = await prisma.semanticCategory.createMany({
      data: level.map((seed) => ({
        tenantId,
        code: seed.code,
        name: seed.name,
        description: seed.description,
        parentCode: seed.parentCode,
        positiveExamples: [...seed.positiveExamples],
        counterExamples: [...seed.counterExamples],
        restrictions: [...seed.restrictions],
        relatedCategoryCodes: [...seed.relatedCategoryCodes],
        acceptanceThreshold: seed.acceptanceThreshold,
        isActive: true,
      })),
      skipDuplicates: true,
    });
    categories += count;
  }
  const { count: aliases } = await prisma.semanticEntityAlias.createMany({
    data: semanticEntityAliasCatalog.map((alias) => ({ tenantId, ...alias, isActive: true })),
    skipDuplicates: true,
  });
  return { categories, aliases };
}
