import { TransformerSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/transformer/transformer-semantic.provider';
import { TransformerEmbeddingProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/transformer/transformer-embedding.provider';
import { buildProbes } from '../src/modules/workers/semantic-analysis/core/infrastructure/transformer/transformer-classifier';
import type {
  ModelClassificationInput,
  SemanticCategory,
} from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.types';
import type { EmbeddingProvider } from '../src/modules/workers/semantic-analysis/core/application/ports';
import {
  SemanticConfigurationError,
  SemanticProviderError,
} from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.errors';

/**
 * El clasificador de transformers, probado sin servidor.
 *
 * Toda la decisión —qué se compara, cuándo se sostiene una categoría, cuándo
 * queda contradicha y cómo se calibra la confianza— es aritmética sobre
 * vectores. Aquí se le dan vectores escritos a mano, de modo que lo que se mide
 * es el criterio y no la calidad de un modelo concreto: un fallo en verde aquí y
 * en rojo en producción significaría que el modelo no separa los conceptos, que
 * es un problema del catálogo, no de este código.
 */

/**
 * Vectores unitarios sobre tres ejes, uno por concepto.
 *
 * Con vectores normalizados el producto escalar es el coseno, que es justo lo
 * que el adaptador pide al servidor (`normalize: true`). Una mezcla de dos ejes
 * produce un coseno intermedio y controlado, que es lo que hace falta para
 * situar un caso justo por encima o por debajo del suelo.
 */
const EJES: Record<string, readonly number[]> = {
  supermercado: [1, 0, 0],
  restaurante: [0, 1, 0],
  ninguno: [0, 0, 1],
};

/** Vector cuyo coseno contra el eje `supermercado` vale exactamente `objetivo`. */
function casiParalelo(objetivo: number): readonly number[] {
  const resto = Math.sqrt(1 - objetivo * objetivo);
  return [objetivo, 0, resto];
}

function mezcla(principal: keyof typeof EJES, peso: number): readonly number[] {
  const eje = EJES[principal];
  const otro = EJES['ninguno'];
  const norma = Math.hypot(peso, 1 - peso);
  return eje.map((value, index) => (value * peso + otro[index] * (1 - peso)) / norma);
}

/** Mapa explícito de texto a vector: nada se infiere, todo se declara. */
function embeddingsDe(
  mapa: Record<string, readonly number[]>,
): EmbeddingProvider & { calls: number } {
  const provider = {
    model: 'modelo-de-prueba',
    calls: 0,
    embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
      provider.calls += 1;
      return Promise.resolve(
        texts.map((text) => {
          const vector = mapa[text];
          if (vector === undefined) throw new Error(`Texto sin vector declarado: ${text}`);
          return vector;
        }),
      );
    },
  };
  return provider;
}

function categoria(
  code: string,
  name: string,
  extra: Partial<SemanticCategory> = {},
): SemanticCategory {
  return {
    id: code,
    code,
    name,
    description: `Descripción de ${name}.`,
    parentCode: 'GASTOS.ALIMENTACION',
    positiveExamples: [],
    counterExamples: [],
    restrictions: [],
    relatedCategoryCodes: [],
    acceptanceThreshold: 0.6,
    version: 1,
    ...extra,
  };
}

const SUPERMERCADO = categoria('GASTOS.ALIMENTACION.SUPERMERCADO', 'Supermercado', {
  positiveExamples: ['COMPRA EN SUPERMERCADO'],
  counterExamples: ['CONSUMO EN RESTAURANTE'],
});
const RESTAURANTES = categoria('GASTOS.ALIMENTACION.RESTAURANTES', 'Restaurantes', {
  positiveExamples: ['PEDIDO DELIVERY'],
  counterExamples: [],
});

function entrada(
  normalizedText: string,
  categories = [SUPERMERCADO, RESTAURANTES],
): ModelClassificationInput {
  return {
    originalText: normalizedText,
    normalizedText,
    entities: [],
    candidates: categories.map((category) => ({ category, retrievalScore: 0.5 })),
  };
}

const UMBRALES = {
  similarityFloor: 0.87,
  temperature: 0.01,
  contradictionMargin: 0.02,
};

function proveedor(embeddings: EmbeddingProvider) {
  return new TransformerSemanticProvider({
    embeddings,
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
    ...UMBRALES,
  });
}

/** Vectores para las sondas de un nivel, resueltos con el mismo prefijo que el adaptador. */
function sondasDe(
  input: ModelClassificationInput,
  tier: 'FAST' | 'DEEP',
  eje: (source: string) => readonly number[],
) {
  const mapa: Record<string, readonly number[]> = {};
  for (const probe of buildProbes(input, tier, 'passage: ')) {
    mapa[probe.text] = eje(probe.source);
  }
  return mapa;
}

describe('TransformerSemanticProvider', () => {
  it('sostiene la categoría cuyo ejemplo se parece más y descarta la ajena', async () => {
    const input = entrada('COMPRA EN SUPERMERCADO SUCURSAL NORTE');
    const embeddings = embeddingsDe({
      'query: COMPRA EN SUPERMERCADO SUCURSAL NORTE': EJES['supermercado'],
      ...sondasDe(input, 'DEEP', (source) =>
        source.includes('SUPERMERCADO') || source.startsWith('Supermercado')
          ? EJES['supermercado']
          : EJES['restaurante'],
      ),
    });

    const { assessments } = await proveedor(embeddings).classify(input, 'DEEP');
    const supermercado = assessments.find((a) => a.categoryCode === SUPERMERCADO.code);
    const restaurantes = assessments.find((a) => a.categoryCode === RESTAURANTES.code);

    expect(supermercado?.supported).toBe(true);
    expect(supermercado?.confidence).toBe(1);
    // Ortogonal: coseno 0, muy por debajo del suelo. Es una abstención sobre esa
    // categoría, no una contradicción — nada afirma que NO lo sea.
    expect(restaurantes?.supported).toBe(false);
    expect(restaurantes?.contradicted).toBe(false);
    expect(restaurantes?.confidence).toBe(0);
  });

  /**
   * La abstención es ABSOLUTA y vive en `supported`, no en la confianza.
   *
   * La confianza reparte 1 entre los candidatos, así que siempre hay una que se
   * lleva la mayor parte — incluso cuando nada encaja. Lo que impide aceptarla es
   * el suelo, que compara el coseno crudo. Sin esta separación, un texto sin
   * categoría posible produciría una ganadora con confianza alta y el motor la
   * daría por buena en vez de responder `UNKNOWN`.
   */
  it('no sostiene ninguna categoría cuando nada supera el suelo, aunque reparta confianza', async () => {
    const input = entrada('MOVIMIENTO VARIOS REF 000918237');
    const embeddings = embeddingsDe({
      'query: MOVIMIENTO VARIOS REF 000918237': EJES['ninguno'],
      ...sondasDe(input, 'FAST', () => mezcla('supermercado', 0.9)),
    });

    const { assessments } = await proveedor(embeddings).classify(input, 'FAST');

    expect(assessments).toHaveLength(2);
    expect(assessments.every((a) => !a.supported)).toBe(true);
    // La confianza suma 1 pase lo que pase: es un reparto, no una medida de
    // encaje. Exigirle que valga 0 aquí sería pedirle algo que no significa.
    expect(assessments.reduce((total, a) => total + a.confidence, 0)).toBeCloseTo(1, 3);
  });

  /**
   * La propiedad que obligó a abandonar la escala absoluta.
   *
   * Medido contra el modelo real, las bandas de aciertos y de errores se solapan:
   * el peor acierto puntúa 0,8923 y el mejor error 0,8995. Ningún umbral absoluto
   * separa esos dos números. Dentro de un mismo texto, en cambio, la categoría
   * correcta gana siempre — y ese margen es lo que la confianza tiene que
   * amplificar. Aquí las dos superan el suelo y aun así una se lleva la decisión.
   */
  it('separa al ganador de la segunda aunque las dos superen el suelo', async () => {
    const input = entrada('COMPRA EN SUPERMERCADO');
    const embeddings = embeddingsDe({
      'query: COMPRA EN SUPERMERCADO': EJES['supermercado'],
      ...sondasDe(input, 'FAST', (source) =>
        // 0,93 contra 0,89: las dos por encima del suelo, con el margen real
        // que se mide entre la categoría correcta y la siguiente.
        source.startsWith('Supermercado') ? mezcla('supermercado', 0.999) : casiParalelo(0.89),
      ),
    });

    const { assessments } = await proveedor(embeddings).classify(input, 'FAST');
    const ganador = assessments.find((a) => a.categoryCode === SUPERMERCADO.code);
    const segunda = assessments.find((a) => a.categoryCode === RESTAURANTES.code);

    expect(ganador?.supported).toBe(true);
    expect(segunda?.supported).toBe(true);
    // Las dos se sostienen, pero la confianza no se reparte a medias: el motor
    // de decisión acepta una sola porque sólo una supera su umbral.
    expect(ganador?.confidence).toBeGreaterThan(0.9);
    expect(segunda?.confidence).toBeLessThan(0.1);
  });

  it('declara contradicha la categoría cuyo contraejemplo gana al mejor positivo', async () => {
    const input = entrada('CONSUMO EN RESTAURANTE ALMUERZO', [SUPERMERCADO]);
    const embeddings = embeddingsDe({
      'query: CONSUMO EN RESTAURANTE ALMUERZO': EJES['restaurante'],
      ...sondasDe(input, 'DEEP', (source) =>
        source === 'CONSUMO EN RESTAURANTE' ? EJES['restaurante'] : mezcla('restaurante', 0.5),
      ),
    });

    const [assessment] = (await proveedor(embeddings).classify(input, 'DEEP')).assessments;

    expect(assessment?.contradicted).toBe(true);
    expect(assessment?.supported).toBe(false);
    expect(assessment?.rationale).toContain('contraejemplo');
  });

  /**
   * La contradicción es concluyente para el motor de decisión, así que no puede
   * emitirse desde el nivel barato: `FAST` no mira los contraejemplos.
   */
  it('el nivel rápido usa una sonda por categoría y ninguna negativa', () => {
    const input = entrada('COMPRA EN SUPERMERCADO');

    const fast = buildProbes(input, 'FAST', '');
    const deep = buildProbes(input, 'DEEP', '');

    expect(fast).toHaveLength(2);
    expect(fast.every((probe) => probe.positive)).toBe(true);
    // Enunciado + 1 positivo + 1 contraejemplo, y enunciado + 1 positivo.
    expect(deep).toHaveLength(5);
    expect(deep.filter((probe) => !probe.positive)).toHaveLength(1);
  });

  it('pide todos los vectores en una sola llamada', async () => {
    const input = entrada('COMPRA EN SUPERMERCADO');
    const embeddings = embeddingsDe({
      'query: COMPRA EN SUPERMERCADO': EJES['supermercado'],
      ...sondasDe(input, 'DEEP', () => EJES['supermercado']),
    });

    await proveedor(embeddings).classify(input, 'DEEP');

    expect(embeddings.calls).toBe(1);
  });

  /**
   * El ahorro que hace utilizable la clasificación de un extracto entero.
   *
   * Las sondas son texto del CATÁLOGO y no cambian entre glosas, así que
   * recalcularlas en cada una era pedir nueve vectores —cincuenta en `DEEP`—
   * para aprovechar uno. A partir de la segunda glosa la petición lleva
   * exactamente un texto: el que se está clasificando.
   */
  it('no vuelve a pedir los vectores de sonda ya calculados', async () => {
    const primera = entrada('COMPRA EN SUPERMERCADO');
    const segunda = entrada('CONSUMO EN RESTAURANTE ZONA SUR');
    const pedidos: (readonly string[])[] = [];
    const mapa: Record<string, readonly number[]> = {
      'query: COMPRA EN SUPERMERCADO': EJES['supermercado'],
      'query: CONSUMO EN RESTAURANTE ZONA SUR': EJES['restaurante'],
      ...sondasDe(primera, 'DEEP', () => EJES['supermercado']),
    };
    const embeddings: EmbeddingProvider = {
      model: 'modelo-de-prueba',
      embed(texts) {
        pedidos.push([...texts]);
        return Promise.resolve(texts.map((text) => mapa[text] ?? EJES['ninguno']));
      },
    };
    const adaptador = proveedor(embeddings);

    await adaptador.classify(primera, 'DEEP');
    await adaptador.classify(segunda, 'DEEP');

    expect(pedidos[0]?.length).toBeGreaterThan(1);
    expect(pedidos[1]).toEqual(['query: CONSUMO EN RESTAURANTE ZONA SUR']);
  });

  /**
   * La caché no puede cambiar ni un veredicto: si lo hiciera sería una función
   * distinta con el mismo nombre. Se clasifica dos veces la misma glosa y se
   * compara el resultado entero.
   */
  it('devuelve el mismo veredicto con la caché fría y caliente', async () => {
    const input = entrada('COMPRA EN SUPERMERCADO');
    const embeddings = embeddingsDe({
      'query: COMPRA EN SUPERMERCADO': EJES['supermercado'],
      ...sondasDe(input, 'FAST', (source) =>
        source.startsWith('Supermercado') ? EJES['supermercado'] : EJES['restaurante'],
      ),
    });
    const adaptador = proveedor(embeddings);

    const fria = await adaptador.classify(input, 'FAST');
    const caliente = await adaptador.classify(input, 'FAST');

    expect(caliente).toEqual(fria);
  });

  /** Con la caché apagada se vuelve al comportamiento anterior, sin sorpresas. */
  it('recalcula las sondas en cada glosa cuando la caché está desactivada', async () => {
    const input = entrada('COMPRA EN SUPERMERCADO');
    const mapa: Record<string, readonly number[]> = {
      'query: COMPRA EN SUPERMERCADO': EJES['supermercado'],
      ...sondasDe(input, 'FAST', () => EJES['supermercado']),
    };
    const pedidos: number[] = [];
    const adaptador = new TransformerSemanticProvider({
      embeddings: {
        model: 'modelo-de-prueba',
        embed(texts) {
          pedidos.push(texts.length);
          return Promise.resolve(texts.map((text) => mapa[text] ?? EJES['ninguno']));
        },
      },
      queryPrefix: 'query: ',
      passagePrefix: 'passage: ',
      probeCacheSize: 0,
      ...UMBRALES,
    });

    await adaptador.classify(input, 'FAST');
    await adaptador.classify(input, 'FAST');

    expect(pedidos[0]).toBeGreaterThan(1);
    expect(pedidos[1]).toBe(pedidos[0]);
  });

  /**
   * La evidencia cita el texto analizado, nunca el catálogo. Y sólo acompaña a
   * lo que se sostiene: junto a un `supported: false` se leería como respaldo de
   * algo que no lo tiene.
   */
  it('cita el texto analizado sólo en las categorías que se sostienen', async () => {
    const input = entrada('COMPRA EN SUPERMERCADO');
    const embeddings = embeddingsDe({
      'query: COMPRA EN SUPERMERCADO': EJES['supermercado'],
      ...sondasDe(input, 'FAST', (source) =>
        source.startsWith('Supermercado') ? EJES['supermercado'] : EJES['restaurante'],
      ),
    });

    const { assessments } = await proveedor(embeddings).classify(input, 'FAST');

    expect(assessments.find((a) => a.supported)?.evidence).toEqual(['COMPRA EN SUPERMERCADO']);
    expect(assessments.find((a) => !a.supported)?.evidence).toEqual([]);
  });

  it('aborta antes de llamar cuando el presupuesto ya está agotado', async () => {
    const embeddings = embeddingsDe({});
    const abortado = AbortSignal.abort();

    await expect(
      proveedor(embeddings).classify(entrada('COMPRA EN SUPERMERCADO'), 'FAST', abortado),
    ).rejects.toThrow(/presupuesto/iu);
    expect(embeddings.calls).toBe(0);
  });
});

describe('TransformerEmbeddingProvider', () => {
  function respuesta(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response;
  }

  /**
   * Es el error de configuración más probable del adaptador: el mismo servidor
   * publica `/v1/embeddings` además de `/embed`, y apuntar a `…/v1` produciría un
   * 404 indistinguible de «el servidor no está levantado».
   */
  it('rechaza la URL de la capa compatible con OpenAI al construirse', () => {
    expect(() => new TransformerEmbeddingProvider({ baseUrl: 'http://tei:80/v1' })).toThrow(
      SemanticConfigurationError,
    );
  });

  it('parte la petición en lotes del tamaño configurado', async () => {
    const lotes: number[] = [];
    const provider = new TransformerEmbeddingProvider({
      batchSize: 2,
      fetchImplementation: ((_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { inputs: string[] };
        lotes.push(body.inputs.length);
        return Promise.resolve(respuesta(body.inputs.map(() => [1, 0])));
      }) as unknown as typeof fetch,
    });

    const vectores = await provider.embed(['a', 'b', 'c', 'd', 'e']);

    expect(lotes).toEqual([2, 2, 1]);
    expect(vectores).toHaveLength(5);
  });

  /**
   * Una respuesta más corta desplazaría cada vector una posición y la similitud
   * se calcularía contra la categoría equivocada, sin que nada lo señalara.
   */
  it('rechaza una respuesta con menos vectores que textos', async () => {
    const provider = new TransformerEmbeddingProvider({
      fetchImplementation: (() => Promise.resolve(respuesta([[1, 0]]))) as unknown as typeof fetch,
    });

    await expect(provider.embed(['a', 'b'])).rejects.toThrow(SemanticProviderError);
  });

  it('no reintenta un lote rechazado por tamaño: el 413 es permanente', async () => {
    const provider = new TransformerEmbeddingProvider({
      fetchImplementation: (() =>
        Promise.resolve(respuesta(undefined, 413))) as unknown as typeof fetch,
    });

    await expect(provider.embed(['a'])).rejects.toMatchObject({ retryable: false });
  });

  it('marca reintentable la saturación del servidor', async () => {
    const provider = new TransformerEmbeddingProvider({
      maxAttempts: 1,
      fetchImplementation: (() =>
        Promise.resolve(respuesta(undefined, 429))) as unknown as typeof fetch,
    });

    await expect(provider.embed(['a'])).rejects.toMatchObject({ retryable: true });
  });

  /**
   * El fallo que se veía en pantalla como «No se pudo» en media tabla.
   *
   * El servidor devuelve 503 mientras carga el modelo o drena su cola; sin
   * reintento, ese hipo tumbaba el análisis entero y la fila del extracto
   * quedaba marcada como fallo de clasificación, que es lo que no había pasado.
   */
  it('reintenta un fallo pasajero y devuelve el resultado del intento bueno', async () => {
    let intentos = 0;
    const provider = new TransformerEmbeddingProvider({
      retryBackoffMs: 0,
      sleepImplementation: () => Promise.resolve(),
      fetchImplementation: (() => {
        intentos += 1;
        return Promise.resolve(intentos < 3 ? respuesta(undefined, 503) : respuesta([[1, 0]]));
      }) as unknown as typeof fetch,
    });

    await expect(provider.embed(['a'])).resolves.toEqual([[1, 0]]);
    expect(intentos).toBe(3);
  });

  /** Lo permanente falla al primer intento: insistir sólo retiene el turno. */
  it('no reintenta un fallo permanente', async () => {
    let intentos = 0;
    const provider = new TransformerEmbeddingProvider({
      sleepImplementation: () => Promise.resolve(),
      fetchImplementation: (() => {
        intentos += 1;
        return Promise.resolve(respuesta(undefined, 413));
      }) as unknown as typeof fetch,
    });

    await expect(provider.embed(['a'])).rejects.toMatchObject({ retryable: false });
    expect(intentos).toBe(1);
  });

  /** Insistir nunca puede rebasar el presupuesto de tiempo del análisis. */
  it('deja de insistir cuando el presupuesto del análisis se agota', async () => {
    let intentos = 0;
    const control = new AbortController();
    const provider = new TransformerEmbeddingProvider({
      sleepImplementation: () => {
        control.abort();
        return Promise.resolve();
      },
      fetchImplementation: (() => {
        intentos += 1;
        return Promise.resolve(respuesta(undefined, 503));
      }) as unknown as typeof fetch,
    });

    await expect(provider.embed(['a'], control.signal)).rejects.toThrow(SemanticProviderError);
    expect(intentos).toBe(2);
  });
});
