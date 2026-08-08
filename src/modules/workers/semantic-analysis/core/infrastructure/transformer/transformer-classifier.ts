import {
  AnalysisTier,
  CategoryAssessment,
  ModelClassificationInput,
  SemanticCategory,
} from '../../domain/semantic-analysis.types';

/**
 * Criterio de clasificación del adaptador de transformers, sin una sola llamada
 * de red.
 *
 * Todo lo que decide vive aquí: qué textos representan a cada categoría, cómo se
 * mide el parecido y cómo se convierte ese parecido en una confianza. El
 * adaptador se limita a pedir los vectores y a llamar a estas funciones, de modo
 * que el criterio se puede probar entero con vectores escritos a mano.
 *
 * No hay generación de texto en ningún punto. El clasificador es un
 * codificador: proyecta el texto y cada sonda del catálogo al mismo espacio y
 * compara. Esa es la razón de que no haya prompt, ni gramática de salida, ni
 * necesidad de defenderse de instrucciones incrustadas en el texto analizado —
 * un codificador no obedece, mide.
 */

/** Una sonda: un texto del catálogo con el que se compara el texto analizado. */
export interface CategoryProbe {
  readonly categoryCode: string;
  readonly text: string;
  /** `false` en los contraejemplos, que miden el parecido con lo que NO es. */
  readonly positive: boolean;
  /** Texto sin el prefijo del modelo, para poder citarlo en la explicación. */
  readonly source: string;
}

export interface ClassifierThresholds {
  /**
   * Parecido por debajo del cual la categoría no se sostiene. Es la ABSTENCIÓN.
   *
   * Valor de coseno, propiedad del MODELO y no del dominio. Medido sobre
   * `multilingual-e5-small` con el árbol de gastos sembrado
   * (`scripts/semantic-calibration.mjs` y la medición que lo acompaña):
   *
   *   pares correctos    min 0,8923   media 0,9214   max 0,9553
   *   pares incorrectos  min 0,8452   media 0,8731   max 0,8995
   *   textos sin categoría posible, mejor parecido: 0,8631
   *
   * De ahí 0,87: por encima de todo lo que debe abstenerse y por debajo de todo
   * lo que debe acertar. Al cambiar de modelo hay que volver a medirlo — un
   * suelo heredado de otra familia de modelos no significa nada.
   */
  readonly similarityFloor: number;
  /**
   * Temperatura del reparto de confianza entre candidatos.
   *
   * Más baja ⇒ más tajante. 0,01 sale de la misma medición: los márgenes reales
   * entre la categoría correcta y la siguiente van de 0,017 a 0,066, y a esta
   * temperatura el margen más estrecho todavía separa al ganador lo suficiente
   * para superar el umbral de aceptación de su categoría.
   */
  readonly temperature: number;
  /**
   * Cuánto tiene que superar un contraejemplo al mejor ejemplo positivo para
   * declarar la categoría contradicha. Un margen de cero convertiría cualquier
   * empate en una contradicción.
   */
  readonly contradictionMargin: number;
}

/**
 * Sondas de cada categoría candidata para el nivel indicado.
 *
 * `FAST` usa sólo el enunciado de la categoría —nombre y descripción—, que es
 * una sonda por categoría. `DEEP` añade cada ejemplo positivo y cada
 * contraejemplo: multiplica el coste por unas seis veces y es lo que permite
 * distinguir «pago del alquiler» de «pago de la hipoteca», cuya descripción se
 * parece pero cuyos ejemplos no.
 *
 * Los contraejemplos sólo entran en `DEEP` a propósito. Son los que detectan la
 * contradicción, y una contradicción es concluyente: emitirla desde el nivel
 * rápido, con menos evidencia, cerraría el análisis sin darle ocasión de
 * escalar.
 */
export function buildProbes(
  input: ModelClassificationInput,
  tier: AnalysisTier,
  passagePrefix: string,
): readonly CategoryProbe[] {
  const probes: CategoryProbe[] = [];

  for (const { category } of input.candidates) {
    probes.push(probeOf(category.code, statementOf(category), true, passagePrefix));
    if (tier === 'FAST') continue;

    for (const example of category.positiveExamples) {
      probes.push(probeOf(category.code, example, true, passagePrefix));
    }
    for (const example of category.counterExamples) {
      probes.push(probeOf(category.code, example, false, passagePrefix));
    }
  }

  return probes;
}

/**
 * Enunciado de la categoría: lo que la define cuando no se miran sus ejemplos.
 *
 * Incluye el nombre además de la descripción porque en un árbol el nombre lleva
 * el detalle («Alquiler») y la descripción tiende a repetir el de la rama.
 */
function statementOf(category: SemanticCategory): string {
  return `${category.name}. ${category.description}`;
}

function probeOf(
  categoryCode: string,
  source: string,
  positive: boolean,
  passagePrefix: string,
): CategoryProbe {
  return { categoryCode, source, positive, text: `${passagePrefix}${source}` };
}

/**
 * Producto escalar. Con vectores normalizados —que es lo que se pide al
 * servidor— coincide con el coseno, así que no hace falta dividir por las
 * normas.
 *
 * Longitudes distintas significan vectores de modelos distintos, que no son
 * comparables: se devuelve 0 en vez de un número que parecería una similitud.
 */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
}

/**
 * Convierte los parecidos en el juicio por categoría que espera el motor de
 * decisión.
 *
 * Reparte el trabajo entre dos señales distintas, y esa separación es el diseño:
 *
 * - **`supported` es ABSOLUTO.** Sale de comparar el coseno con el suelo. Es lo
 *   único que puede decir «ninguna categoría encaja», porque no depende de
 *   contra quién se compare.
 * - **`confidence` es RELATIVA.** Reparte la certeza entre los candidatos con un
 *   softmax sobre los cosenos. Es lo que distingue a la categoría correcta de la
 *   segunda mejor.
 *
 * La primera versión usó una escala absoluta también para la confianza,
 * razonando que un softmax siempre produce una ganadora aunque nada encaje. El
 * razonamiento era correcto pero el remedio no: al medir el modelo de verdad,
 * las bandas de pares correctos e incorrectos SE SOLAPAN globalmente —el peor
 * acierto (0,8923) puntúa por debajo del mejor error (0,8995)—, de modo que
 * ningún umbral absoluto puede separarlos. Dentro de cada texto, en cambio, la
 * categoría correcta gana siempre, con márgenes de 0,017 a 0,066. Es información
 * que sólo existe al comparar candidatos entre sí, y descartarla obligaba a
 * aceptar categorías ajenas: «PAGO FACTURA DE ENERGIA ELECTRICA» se aceptaba
 * además como «Trabajo independiente».
 *
 * Lo que motivó la escala absoluta no se pierde: la abstención sigue siendo
 * absoluta, sólo que vive en `supported` en vez de en `confidence`. Y un empate
 * real sigue saliendo empatado —dos cosenos casi iguales reparten la confianza
 * casi por igual—, que es lo que `ambiguityMargin` sabe leer.
 */
export function assess(
  input: ModelClassificationInput,
  probes: readonly CategoryProbe[],
  probeVectors: readonly (readonly number[])[],
  queryVector: readonly number[],
  thresholds: ClassifierThresholds,
): readonly CategoryAssessment[] {
  const best = new Map<string, { positive?: ProbeHit; negative?: ProbeHit }>();

  probes.forEach((probe, index) => {
    const vector = probeVectors[index];
    if (vector === undefined) return;
    const similarity = cosineSimilarity(queryVector, vector);
    const entry = best.get(probe.categoryCode) ?? {};
    const side = probe.positive ? 'positive' : 'negative';
    const current = entry[side];
    if (current === undefined || similarity > current.similarity) {
      entry[side] = { similarity, source: probe.source };
      best.set(probe.categoryCode, entry);
    }
  });

  const similarities = input.candidates.map(
    ({ category }) => best.get(category.code)?.positive?.similarity ?? 0,
  );
  const confidences = softmax(similarities, thresholds.temperature);

  return input.candidates.map(({ category }, index) =>
    assessOne(category, best.get(category.code) ?? {}, confidences[index] ?? 0, thresholds),
  );
}

interface ProbeHit {
  readonly similarity: number;
  readonly source: string;
}

function assessOne(
  category: SemanticCategory,
  hits: { positive?: ProbeHit; negative?: ProbeHit },
  confidence: number,
  thresholds: ClassifierThresholds,
): CategoryAssessment {
  const positive = hits.positive?.similarity ?? 0;
  const negative = hits.negative?.similarity ?? 0;
  const contradicted = negative > positive + thresholds.contradictionMargin;

  return {
    categoryCode: category.code,
    confidence,
    supported: !contradicted && positive > thresholds.similarityFloor,
    contradicted,
    // La evidencia cita el texto analizado y nada más. El adaptador la rellena
    // con el fragmento real; aquí no se inventa ninguna, que es justamente lo
    // que un codificador no puede hacer.
    evidence: [],
    rationale: explain(hits, contradicted, confidence),
  };
}

/**
 * Reparte 1 entre los candidatos según su parecido.
 *
 * Resta el máximo antes de exponenciar: con temperaturas del orden de 0,01 el
 * exponente ronda 90, y `Math.exp(90)` ya está en el orden de 10^39 — dos
 * décimas más de coseno lo desbordarían a `Infinity` y todas las confianzas
 * saldrían `NaN`. Restar el máximo no cambia el resultado y mantiene el mayor
 * exponente en cero.
 *
 * Un solo candidato recibe 1: es correcto y no es peligroso, porque quien decide
 * si esa única categoría se sostiene es `supported`, que mira el coseno crudo.
 */
function softmax(values: readonly number[], temperature: number): readonly number[] {
  if (values.length === 0) return [];
  // Una temperatura de cero o negativa no define un reparto: se degrada a
  // «todo al mejor», que es su límite, en vez de dividir por cero.
  if (temperature <= 0) {
    const top = Math.max(...values);
    const winners = values.filter((value) => value === top).length;
    return values.map((value) => (value === top ? 1 / winners : 0));
  }

  const top = Math.max(...values);
  const weights = values.map((value) => Math.exp((value - top) / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0 || !Number.isFinite(total)) {
    return values.map(() => 1 / values.length);
  }
  return weights.map((weight) => Number((weight / total).toFixed(4)));
}

/**
 * Explicación determinista, en español y con los números a la vista.
 *
 * Dice a qué se pareció y cuánto, que es todo lo que un codificador puede
 * justificar. Redactar algo más elaborado exigiría un modelo generativo, y sería
 * una explicación inventada a posteriori sobre una decisión que no la usó.
 */
function explain(
  hits: { positive?: ProbeHit; negative?: ProbeHit },
  contradicted: boolean,
  confidence: number,
): string {
  const positive = hits.positive;
  if (positive === undefined) {
    return 'No se pudo medir el parecido con esta categoría.';
  }
  const parecido = `Se parece a «${positive.source}» (similitud ${format(positive.similarity)}).`;
  if (contradicted) {
    const negative = hits.negative as ProbeHit;
    return (
      `${parecido} Pero se parece más al contraejemplo «${negative.source}» ` +
      `(${format(negative.similarity)}), así que la categoría queda descartada.`
    );
  }
  // Se dice la similitud CRUDA además de la confianza a propósito: la confianza
  // está repartida entre los candidatos, así que por sí sola no dice cuánto se
  // parece el texto a esta categoría, sino cuánto más que a las otras. Quien
  // audita una decisión necesita las dos.
  return `${parecido} Confianza frente a las demás candidatas: ${format(confidence)}.`;
}

function format(value: number): string {
  return value.toFixed(2).replace('.', ',');
}
