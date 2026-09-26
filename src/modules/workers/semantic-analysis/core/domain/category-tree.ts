import { SemanticCategory } from './semantic-analysis.types';

/**
 * Recorrido del árbol de categorías.
 *
 * El catálogo se declara con un puntero al padre por categoría, que es la forma
 * en que se guarda y la que permite añadir una rama sin reescribir las demás.
 * Leerlo, en cambio, casi siempre pide lo contrario: la ruta completa desde la
 * raíz. Estas funciones hacen esa conversión y son el único sitio donde se
 * asume algo sobre la forma del árbol.
 *
 * Todas toleran un catálogo mal formado —un padre inexistente, un ciclo— sin
 * colgarse ni lanzar: el catálogo son datos que alguien edita en caliente, y una
 * clasificación no debe fallar porque una rama esté a medio mover.
 */

/** Tope de profundidad. Corta cualquier ciclo que la base haya dejado pasar. */
const MAX_DEPTH = 16;

/**
 * Ancestros de una categoría, de la raíz hacia ella misma (incluida).
 *
 * Devuelve las CATEGORÍAS y no sus nombres para que quien llame decida qué
 * proyectar. Un padre ausente del catálogo corta la cadena en silencio: es
 * preferible una ruta incompleta —«Alquiler»— a ninguna clasificación.
 */
export function ancestryOf(
  category: SemanticCategory,
  byCode: ReadonlyMap<string, SemanticCategory>,
): readonly SemanticCategory[] {
  const lineage: SemanticCategory[] = [category];
  const visited = new Set<string>([category.code]);

  let current = category;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const parentCode = current.parentCode;
    if (parentCode === null || parentCode === '') break;
    const parent = byCode.get(parentCode);
    // Un código ya visto es un ciclo. Se corta aquí en vez de confiar sólo en
    // `MAX_DEPTH`, para que el resultado sea el mismo trozo de ruta siempre y no
    // dieciséis repeticiones de la misma rama.
    if (parent === undefined || visited.has(parent.code)) break;
    lineage.push(parent);
    visited.add(parent.code);
    current = parent;
  }

  return lineage.reverse();
}

/**
 * Ruta de nombres, de la raíz a la hoja, para cada código pedido.
 *
 * Los códigos que no están en el catálogo se omiten en lugar de aparecer con una
 * ruta vacía: una clave presente con valor `[]` se lee como «esta categoría está
 * en la raíz», que es una afirmación, y aquí no se sabe nada de ella.
 */
export function buildCategoryPaths(
  categories: readonly SemanticCategory[],
  codes: readonly string[],
): Readonly<Record<string, readonly string[]>> {
  const byCode = new Map(categories.map((category) => [category.code, category]));
  const paths: Record<string, readonly string[]> = {};

  for (const code of codes) {
    const category = byCode.get(code);
    if (category === undefined) continue;
    paths[code] = ancestryOf(category, byCode).map((step) => step.name);
  }

  return paths;
}

/**
 * Hojas del árbol: las categorías que no son padre de ninguna otra.
 *
 * Es el conjunto sobre el que tiene sentido decidir. Los nodos intermedios
 * («Vivienda») describen una rama, no un gasto concreto, y aceptarlos como
 * resultado equivale a clasificar con menos detalle del que el catálogo ofrece.
 */
export function leavesOf(categories: readonly SemanticCategory[]): readonly SemanticCategory[] {
  const parents = new Set(
    categories
      .map((category) => category.parentCode)
      .filter((code): code is string => code !== null && code !== ''),
  );
  return categories.filter((category) => !parents.has(category.code));
}
