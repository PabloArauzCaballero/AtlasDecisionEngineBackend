import type { PrismaClient } from '@prisma/client';
import { type SemanticCategorySeed, expenseCategoryTree } from './expense-category-tree.data';
import { TENANT_ID } from './helpers';

/**
 * Siembra del catálogo del worker semántico (ADR-0026).
 *
 * Sin categorías sembradas el worker responde `UNKNOWN` a todo, y eso no es un
 * fallo sino su comportamiento correcto: se niega a clasificar contra un
 * catálogo vacío. Pero deja la pantalla sin nada que enseñar, así que un
 * despliegue nuevo necesita un punto de partida.
 *
 * El contenido —el árbol de gastos e ingresos— vive en
 * `expense-category-tree.data.ts`. Aquí sólo está lo que hace falta para
 * escribirlo: el orden de inserción, la comprobación de que el árbol se sostiene
 * y los alias de entidades.
 */

export { expenseCategoryTree as semanticCategoryCatalog };

/** Alias de entidades bolivianas que el resolutor debe reconocer. */
export const semanticEntityAliasCatalog: readonly {
  alias: string;
  canonicalName: string;
  entityType: string;
}[] = [
  /*
   * La lista de instituciones no es decorativa: `TextNormalizer.forClassification`
   * usa el TIPO para decidir qué se quita del texto antes de clasificar, y el
   * banco de la contraparte es ruido —`BANCO DE CREDITO DE BOLIVIA S.A.` son
   * seis palabras que no dicen nada del rubro—. Cada banco que falte aquí es
   * ruido que sí llega al clasificador, así que están los siete que aparecen en
   * los extractos reales verificados y los que comparten plaza con ellos.
   */
  { alias: 'BNB', canonicalName: 'Banco Nacional de Bolivia', entityType: 'INSTITUCION' },
  { alias: 'BEC', canonicalName: 'Banco Económico', entityType: 'INSTITUCION' },
  { alias: 'Banco Economico', canonicalName: 'Banco Económico', entityType: 'INSTITUCION' },
  { alias: 'BISA', canonicalName: 'Banco BISA', entityType: 'INSTITUCION' },
  { alias: 'FIE', canonicalName: 'Banco FIE', entityType: 'INSTITUCION' },
  { alias: 'Banco Fassil', canonicalName: 'Banco Fassil', entityType: 'INSTITUCION' },
  { alias: 'Tigo Money', canonicalName: 'Tigo Money', entityType: 'INSTITUCION' },
  { alias: 'Banco Prodem', canonicalName: 'Banco Prodem', entityType: 'INSTITUCION' },
  { alias: 'Banco Fortaleza', canonicalName: 'Banco Fortaleza', entityType: 'INSTITUCION' },
  {
    alias: 'Banco Nacional',
    canonicalName: 'Banco Nacional de Bolivia',
    entityType: 'INSTITUCION',
  },
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
 * Ordena el árbol de modo que todo padre se inserte antes que sus hijos.
 *
 * La clave foránea `(tenant_id, parent_code)` lo exige, y el orden de
 * declaración del catálogo no tiene por qué respetarlo: quien añade una rama
 * la escribe donde le resulta legible, no al principio del archivo.
 *
 * Un ciclo —o un padre inexistente— deja categorías fuera del recorrido, y se
 * denuncia en vez de sembrar a medias: un catálogo parcial es peor que ninguno,
 * porque el worker clasifica contra él sin saber que le falta la mitad.
 */
export function sortByDepth(
  categories: readonly SemanticCategorySeed[],
): readonly SemanticCategorySeed[] {
  const pending = new Map(categories.map((category) => [category.code, category]));
  const placed = new Set<string>();
  const ordered: SemanticCategorySeed[] = [];

  let progressed = true;
  while (progressed && placed.size < categories.length) {
    progressed = false;
    for (const category of pending.values()) {
      if (placed.has(category.code)) continue;
      const parent = category.parentCode;
      if (parent !== null && !placed.has(parent)) continue;
      ordered.push(category);
      placed.add(category.code);
      progressed = true;
    }
  }

  if (ordered.length !== categories.length) {
    const huerfanas = categories
      .filter((category) => !placed.has(category.code))
      .map((category) => `${category.code} → ${String(category.parentCode)}`);
    throw new Error(
      `El árbol de categorías no se sostiene: hay un ciclo o un padre inexistente en ${huerfanas.join(', ')}.`,
    );
  }

  return ordered;
}

/**
 * Agrupa el árbol por NIVELES: la raíz, luego sus hijos, luego los hijos de esos.
 *
 * `sortByDepth` ya devuelve un orden válido para insertar, pero es una lista
 * plana y sembrarla implica esperar una escritura antes de empezar la siguiente.
 * Con 83 categorías eso era medio segundo de arranque y nadie lo notaba; con el
 * catálogo ampliado son varios centenares de idas y vueltas a la base en el
 * camino crítico del arranque, que es justo lo que no debe crecer al enriquecer
 * el catálogo.
 *
 * Dentro de un nivel las categorías son independientes entre sí —ninguna es
 * padre de otra— así que se pueden escribir a la vez. Entre niveles no: la clave
 * foránea `(tenant_id, parent_code)` exige que el padre ya esté.
 */
function groupByLevel(
  categories: readonly SemanticCategorySeed[],
): readonly (readonly SemanticCategorySeed[])[] {
  const ordered = sortByDepth(categories);
  const levelOf = new Map<string, number>();
  const levels: SemanticCategorySeed[][] = [];

  for (const category of ordered) {
    const parent = category.parentCode;
    // `sortByDepth` garantiza que el padre ya pasó por aquí; si no está, es una
    // raíz. Ninguno de los dos casos puede dejar un nivel sin definir.
    const level = parent === null ? 0 : (levelOf.get(parent) ?? -1) + 1;
    levelOf.set(category.code, level);
    (levels[level] ??= []).push(category);
  }

  return levels;
}

/**
 * Escrituras simultáneas dentro de un nivel.
 *
 * El pool de Prisma es finito y el arranque compite con las demás semillas: más
 * paralelismo del que hay conexiones no acelera nada y encola trabajo en un
 * recurso compartido. Veinte cubre la latencia de ida y vuelta sin acaparar.
 */
const SIEMBRA_SIMULTANEA = 20;

/**
 * Siembra el catálogo. Idempotente por `(tenant, code)`: reejecutar actualiza en
 * vez de duplicar, que es lo que permite correrlo en cada arranque.
 *
 * Se escribe por niveles y en tandas: el orden que la clave foránea exige se
 * respeta entre niveles, y dentro de cada uno las categorías van a la vez.
 */
export async function seedSemanticCatalog(
  prisma: PrismaClient,
): Promise<{ categories: number; aliases: number }> {
  for (const level of groupByLevel(expenseCategoryTree)) {
    for (let offset = 0; offset < level.length; offset += SIEMBRA_SIMULTANEA) {
      await Promise.all(
        level
          .slice(offset, offset + SIEMBRA_SIMULTANEA)
          .map((seed) => upsertCategory(prisma, seed)),
      );
    }
  }

  for (const alias of semanticEntityAliasCatalog) {
    await prisma.semanticEntityAlias.upsert({
      where: {
        tenantId_entityType_alias: {
          tenantId: TENANT_ID,
          entityType: alias.entityType,
          alias: alias.alias,
        },
      },
      create: { tenantId: TENANT_ID, ...alias, isActive: true },
      update: { canonicalName: alias.canonicalName, isActive: true },
    });
  }

  return {
    categories: expenseCategoryTree.length,
    aliases: semanticEntityAliasCatalog.length,
  };
}

async function upsertCategory(prisma: PrismaClient, seed: SemanticCategorySeed): Promise<void> {
  const data = {
    name: seed.name,
    description: seed.description,
    parentCode: seed.parentCode,
    positiveExamples: [...seed.positiveExamples],
    counterExamples: [...seed.counterExamples],
    restrictions: [...seed.restrictions],
    relatedCategoryCodes: [...seed.relatedCategoryCodes],
    acceptanceThreshold: seed.acceptanceThreshold,
    isActive: true,
  };
  await prisma.semanticCategory.upsert({
    where: { tenantId_code: { tenantId: TENANT_ID, code: seed.code } },
    create: { tenantId: TENANT_ID, code: seed.code, ...data },
    // La versión NO se toca al actualizar: la sube quien cambie el significado de
    // la categoría, no una reejecución de la semilla. Si subiera sola, la
    // auditoría diría que la categoría cambió cada vez que arranca el motor.
    update: data,
  });
}
