import {
  ancestryOf,
  buildCategoryPaths,
  leavesOf,
} from '../src/modules/workers/semantic-analysis/core/domain/category-tree';
import type { SemanticCategory } from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.types';
import { expenseCategoryTree } from '../src/modules/seeding/data/expense-category-tree.data';
import { sortByDepth } from '../src/modules/seeding/data/semantic-catalog.data';

/**
 * El árbol de categorías, por los dos lados que puede romperse.
 *
 * Arriba, el recorrido: tiene que sobrevivir a un catálogo mal formado sin
 * colgarse, porque el catálogo son datos que alguien edita en caliente y una
 * clasificación no debe fallar porque una rama esté a medio mover.
 *
 * Abajo, el catálogo sembrado: es lo único que garantiza que las categorías con
 * las que arranca un despliegue nuevo formen realmente un árbol y no una lista
 * con punteros rotos.
 */

function nodo(code: string, parentCode: string | null): SemanticCategory {
  return {
    id: code,
    code,
    name: code.split('.').at(-1) as string,
    description: '',
    parentCode,
    positiveExamples: [],
    counterExamples: [],
    restrictions: [],
    relatedCategoryCodes: [],
    acceptanceThreshold: 0.6,
    version: 1,
  };
}

const ARBOL = [
  nodo('GASTOS', null),
  nodo('GASTOS.VIVIENDA', 'GASTOS'),
  nodo('GASTOS.VIVIENDA.ALQUILER', 'GASTOS.VIVIENDA'),
  nodo('GASTOS.IMPUESTOS', 'GASTOS'),
];

describe('recorrido del árbol de categorías', () => {
  it('devuelve la ruta de la raíz a la hoja', () => {
    expect(buildCategoryPaths(ARBOL, ['GASTOS.VIVIENDA.ALQUILER'])).toEqual({
      'GASTOS.VIVIENDA.ALQUILER': ['GASTOS', 'VIVIENDA', 'ALQUILER'],
    });
  });

  /**
   * Una clave presente con valor `[]` se leería como «esta categoría está en la
   * raíz», que es una afirmación sobre algo de lo que no se sabe nada.
   */
  it('omite los códigos que no están en el catálogo en vez de darles ruta vacía', () => {
    expect(buildCategoryPaths(ARBOL, ['NO_EXISTE'])).toEqual({});
  });

  it('corta la cadena en el primer padre inexistente en vez de fallar', () => {
    const huerfana = [nodo('HOJA', 'PADRE_QUE_NO_ESTA')];

    expect(buildCategoryPaths(huerfana, ['HOJA'])).toEqual({ HOJA: ['HOJA'] });
  });

  /** Un ciclo en la base no puede convertirse en un recorrido infinito. */
  it('sobrevive a un ciclo sin colgarse ni repetir la rama', () => {
    const ciclo = [nodo('A', 'B'), nodo('B', 'A')];

    const linaje = ancestryOf(ciclo[0], new Map(ciclo.map((c) => [c.code, c])));

    expect(linaje.map((c) => c.code)).toEqual(['B', 'A']);
  });

  it('las hojas son las categorías que no son padre de ninguna otra', () => {
    expect(leavesOf(ARBOL).map((category) => category.code)).toEqual([
      'GASTOS.VIVIENDA.ALQUILER',
      'GASTOS.IMPUESTOS',
    ]);
  });

  /**
   * Propiedad que hace el cambio retrocompatible: en un catálogo plano —ninguna
   * categoría con padre— todas son hojas, así que restringir la recuperación a
   * las hojas no cambia nada de lo que ya funcionaba.
   */
  it('en un catálogo plano todas las categorías son hojas', () => {
    const plano = [nodo('UNA', null), nodo('OTRA', null)];

    expect(leavesOf(plano)).toHaveLength(2);
  });
});

describe('catálogo sembrado de gastos e ingresos', () => {
  const porCodigo = new Map(expenseCategoryTree.map((seed) => [seed.code, seed]));

  it('cada padre declarado existe en el propio catálogo', () => {
    const rotos = expenseCategoryTree
      .filter((seed) => seed.parentCode !== null && !porCodigo.has(seed.parentCode))
      .map((seed) => seed.code);

    expect(rotos).toEqual([]);
  });

  it('se puede ordenar de modo que todo padre se inserte antes que sus hijos', () => {
    const ordenado = sortByDepth(expenseCategoryTree);
    const vistos = new Set<string>();

    for (const seed of ordenado) {
      if (seed.parentCode !== null) expect(vistos.has(seed.parentCode)).toBe(true);
      vistos.add(seed.code);
    }
    expect(ordenado).toHaveLength(expenseCategoryTree.length);
  });

  it('denuncia un ciclo en vez de sembrar el catálogo a medias', () => {
    const conCiclo = [
      { ...expenseCategoryTree[0], code: 'A', parentCode: 'B' },
      { ...expenseCategoryTree[0], code: 'B', parentCode: 'A' },
    ];

    expect(() => sortByDepth(conCiclo)).toThrow(/ciclo o un padre inexistente/u);
  });

  /**
   * Las hojas son el conjunto sobre el que se decide, y una hoja sin ejemplos no
   * puede sostenerse: el clasificador mide parecido con lo que alguien escribió.
   * Las ramas, al revés, no llevan ninguno a propósito.
   *
   * Con UNA excepción, que no es una laguna sino el diseño: las hojas CAJÓN
   * (`GASTOS.OTROS`, `INGRESOS.OTROS`) llevan umbral 1 —inalcanzable por
   * similitud— precisamente para que no se llegue a ellas parecièndose a nada.
   * Darles ejemplos las convertiría en un imán: el cajón empezaría a robarle
   * movimientos a las hojas reales, que es justo lo contrario de lo que se
   * quiere. Su vacío es la afirmación «aquí sólo se llega a propósito».
   *
   * La excepción se detecta por el UMBRAL y no por el nombre del código: es la
   * propiedad estructural que la hace un cajón, y así una hoja cajón nueva
   * queda cubierta sin tocar esta prueba.
   */
  it('toda hoja trae ejemplos y contraejemplos, salvo los cajones, y ninguna rama los trae', () => {
    const arbol = expenseCategoryTree.map((seed) => nodo(seed.code, seed.parentCode));
    const hojas = new Set(leavesOf(arbol).map((category) => category.code));
    const esCajon = (seed: (typeof expenseCategoryTree)[number]) => seed.acceptanceThreshold >= 1;

    for (const seed of expenseCategoryTree) {
      if (!hojas.has(seed.code)) {
        expect(seed.positiveExamples).toEqual([]);
        continue;
      }
      if (esCajon(seed)) {
        // Un cajón con ejemplos sería un defecto, no una mejora.
        expect(seed.positiveExamples).toEqual([]);
        continue;
      }
      expect(seed.positiveExamples.length).toBeGreaterThan(0);
      expect(seed.counterExamples.length).toBeGreaterThan(0);
    }
  });

  /**
   * El umbral de una rama es inalcanzable a propósito: la recuperación ya se
   * limita a las hojas, y esto es el segundo cierre para que una rama reactivada
   * como candidata siga sin poder convertirse en el destino de lo que no encaja
   * en ninguna de sus hojas.
   */
  it('ninguna rama puede aceptarse: su umbral es inalcanzable', () => {
    const arbol = expenseCategoryTree.map((seed) => nodo(seed.code, seed.parentCode));
    const hojas = new Set(leavesOf(arbol).map((category) => category.code));

    for (const seed of expenseCategoryTree.filter((s) => !hojas.has(s.code))) {
      expect(seed.acceptanceThreshold).toBe(1);
    }
  });

  it('cada categoría relacionada apunta a una que existe', () => {
    const rotas = expenseCategoryTree.flatMap((seed) =>
      seed.relatedCategoryCodes
        .filter((code) => !porCodigo.has(code))
        .map((code) => `${seed.code} → ${code}`),
    );

    expect(rotas).toEqual([]);
  });

  it('describe las dos direcciones del dinero', () => {
    expect(porCodigo.has('INGRESOS')).toBe(true);
    expect(porCodigo.has('GASTOS')).toBe(true);
  });
});
