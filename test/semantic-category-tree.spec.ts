import {
  ancestryOf,
  buildCategoryPaths,
  leavesOf,
} from '../src/modules/workers/semantic-analysis/core/domain/category-tree';
import type { SemanticCategory } from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.types';
import { expenseCategoryTree } from '../src/modules/seeding/data/expense-category-tree.data';
import { sortByDepth } from '../src/modules/seeding/data/semantic-catalog.data';
import { LexicalCandidateRetriever } from '../src/modules/workers/semantic-analysis/core/application/lexical-candidate-retriever';
import { loadTransformerProviderOptions } from '../src/modules/workers/semantic-analysis/core/config/transformer-provider.config';

/** El mismo `SEMANTIC_ANALYSIS_CANDIDATE_LIMIT` que usa el pipeline por omisión. */
const CANDIDATOS_POR_GLOSA = 8;

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

  /**
   * El árbol se declara en cinco archivos, y la siembra es idempotente por
   * `(tenant, code)`: dos entradas con el mismo código no fallarían al sembrar,
   * la segunda pisaría a la primera en silencio y el catálogo perdería una
   * categoría entera sin que nada lo dijera.
   */
  it('ningún código se declara dos veces', () => {
    const codigos = expenseCategoryTree.map((seed) => seed.code);

    expect(codigos).toHaveLength(new Set(codigos).size);
  });

  /**
   * Una glosa en dos hojas es un empate provocado: las dos casan igual de bien,
   * el reparto de confianza las deja a las dos por debajo de su umbral y un
   * movimiento identificable sale SIN DETERMINAR. Es el fallo que el árbol ya
   * documenta con `PAGO SERVICIOS`, y no se detecta leyendo un archivo porque
   * las dos hojas suelen vivir en archivos distintos.
   *
   * Las dos excepciones vienen del dialecto observado y se dejan a propósito:
   * son glosas que los bancos imprimen de verdad para las dos cosas, y quitarlas
   * de una de las hojas perdería un caso real en vez de ganar precisión. La
   * lista es explícita para que añadir una tercera sea una decisión y no un
   * descuido.
   */
  it('una misma glosa no se reparte entre dos hojas', () => {
    const CONVIVENCIAS_ACEPTADAS = new Set([
      // Cabecera real del QR: el instrumento y el destino se escriben igual.
      'DEBITO ACH QR',
      // La papelería de la casa y la de la oficina se compran en el mismo sitio.
      'COMPRA MATERIAL DE ESCRITORIO',
    ]);
    const porGlosa = new Map<string, Set<string>>();
    for (const seed of expenseCategoryTree) {
      for (const ejemplo of seed.positiveExamples) {
        const clave = ejemplo.trim().toUpperCase();
        const duenos = porGlosa.get(clave) ?? new Set<string>();
        duenos.add(seed.code);
        porGlosa.set(clave, duenos);
      }
    }

    const compartidas = [...porGlosa]
      .filter(([glosa, duenos]) => duenos.size > 1 && !CONVIVENCIAS_ACEPTADAS.has(glosa))
      .map(([glosa, duenos]) => `${glosa} → ${[...duenos].join(', ')}`);

    expect(compartidas).toEqual([]);
  });

  /**
   * Ningún ejemplo se repite DENTRO de su propia hoja.
   *
   * En `DEEP` cada ejemplo es una sonda que se embebe y se compara, así que una
   * copia cuesta lo mismo que el original y no aporta nada: el parecido con un
   * texto y con su gemelo es el mismo número. El ensamblado del árbol deduplica
   * al unir los cuatro diccionarios de vocabulario; esta prueba es lo que
   * garantiza que siga haciéndolo.
   */
  it('ninguna hoja repite un ejemplo consigo misma', () => {
    const conRepetidos = expenseCategoryTree
      .filter((seed) => new Set(seed.positiveExamples).size !== seed.positiveExamples.length)
      .map((seed) => seed.code);

    expect(conRepetidos).toEqual([]);
  });

  /**
   * Cada hoja se reconoce a sí misma por LÉXICO.
   *
   * Es la única propiedad del catálogo que se puede comprobar sin levantar el
   * servidor de embeddings, y cubre el riesgo real de ampliarlo: una familia de
   * hojas nuevas que se canibalizan entre sí. Si el propio ejemplo de una hoja
   * no la trae de vuelta entre las candidatas, el modelo NUNCA llega a verla y
   * la hoja es inalcanzable por muy bien escrita que esté.
   *
   * El listón no es del 100 % y no puede serlo: la puntuación léxica divide por
   * el tamaño del vocabulario de la categoría, así que las hojas con muchísimos
   * ejemplos —transferencias, con más de cincuenta— pierden contra otra que diga
   * lo mismo con menos palabras. Esas se rescatan por vector, que es justamente
   * lo que el recuperador híbrido añade. Lo que esta prueba impide es el
   * derrumbe: que una ampliación deje a decenas de hojas fuera de su propio
   * alcance.
   */
  it('los ejemplos de una hoja la recuperan a ella misma', () => {
    const catalogo = expenseCategoryTree.map((seed) => ({
      ...nodo(seed.code, seed.parentCode),
      name: seed.name,
      description: seed.description,
      positiveExamples: [...seed.positiveExamples],
      relatedCategoryCodes: [...seed.relatedCategoryCodes],
    }));
    const hojas = new Set(leavesOf(catalogo).map((categoria) => categoria.code));
    const recuperador = new LexicalCandidateRetriever();

    let probados = 0;
    let perdidos = 0;
    for (const categoria of catalogo) {
      if (!hojas.has(categoria.code)) continue;
      for (const ejemplo of categoria.positiveExamples) {
        probados += 1;
        const candidatas = recuperador.retrieveSync(ejemplo, catalogo, CANDIDATOS_POR_GLOSA);
        if (!candidatas.some((c) => c.category.code === categoria.code)) perdidos += 1;
      }
    }

    expect(probados).toBeGreaterThan(1_000);
    expect(perdidos / probados).toBeLessThan(0.02);
  });

  /**
   * El catálogo entero cabe en la caché de sondas.
   *
   * En `DEEP` cada categoría candidata aporta su enunciado más cada ejemplo y
   * cada contraejemplo. Si la suma supera la caché, la LRU expulsa vectores que
   * va a volver a pedir en la glosa siguiente y la caché deja de servir de
   * golpe: memoria ocupada y ninguna llamada ahorrada. No hay ninguna señal que
   * lo avise salvo la latencia, así que lo dice esta prueba.
   */
  it('cabe entero en la caché de sondas del adaptador', () => {
    const sondas = expenseCategoryTree.reduce(
      (total, seed) => total + 1 + seed.positiveExamples.length + seed.counterExamples.length,
      0,
    );

    expect(sondas).toBeLessThanOrEqual(loadTransformerProviderOptions({}).probeCacheSize);
  });
});
