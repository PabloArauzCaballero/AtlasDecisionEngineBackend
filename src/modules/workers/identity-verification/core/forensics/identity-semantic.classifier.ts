/**
 * El modelo de transformers puesto a trabajar sobre la identidad.
 *
 * ## Qué pregunta contesta, y por qué no la contestaban las expresiones regulares
 *
 * Los anclajes del catálogo (`template-conformance.ts`) buscan literales: o está
 * escrito «SERVICIO GENERAL DE IDENTIFICACIÓN PERSONAL» o no está. Eso es exacto
 * y es frágil a la vez — el reconocedor devuelve `SERVIClO GENFRAL DE
 * IDENTIFICACION PERS0NAL` sobre una tarjeta perfectamente legítima y el anclaje
 * falla, mientras que un falsificador que copie el rótulo letra a letra lo pasa.
 * O sea: la parte que es fácil de falsificar es justo la que la expresión regular
 * mide bien.
 *
 * El codificador mide otra cosa: si el CONJUNTO del texto leído se parece a cómo
 * se lee una cédula boliviana, y si se parece MÁS a eso que a un pasaporte, a una
 * licencia, a un documento de otro país o a una plantilla de internet. Un texto
 * con dos letras mal leídas sigue estando cerca en el espacio vectorial; una
 * plantilla con los rótulos perfectos pero el resto del contenido de otro país,
 * no.
 *
 * Las dos medidas son complementarias y por eso las dos entran al puntaje: los
 * literales atrapan lo que el codificador tolera y el codificador atrapa lo que
 * los literales no ven.
 *
 * ## Por qué un codificador y no un modelo generativo
 *
 * Un codificador MIDE, no obedece. El texto que entra aquí lo eligió quien sube
 * la foto —basta imprimir una frase en una tarjeta— y con un modelo generativo
 * eso es un canal de instrucciones dentro del dato analizado. Al proyectar y
 * comparar vectores no hay prompt que secuestrar: es la misma razón por la que el
 * worker semántico eligió esta arquitectura, escrita en
 * `transformer-classifier.ts`.
 *
 * ## Cómo falla
 *
 * Hacia arriba. Si el servidor de embeddings no contesta, esto devuelve
 * `disponible: false` y NO devuelve un puntaje neutro: un 0,5 inventado se
 * sumaría al fusor como si fuera evidencia y dejaría pasar documentos que nadie
 * miró. Sin la medida, el fusor escala a revisión humana — que es lo que hay que
 * hacer cuando falta una de las pruebas.
 */

import { SONDAS_BOLIVIA_CI, type SondaDeCatalogo } from '../catalog/bolivia-ci.catalog';

/** Lo que el clasificador necesita del mundo exterior: vectores. */
export interface IdentityEmbedderPort {
  /** Proyecta los textos. Los vectores llegan NORMALIZADOS (norma 1). */
  embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]>;
  /** Nombre del modelo servido, para que el resultado diga con qué se midió. */
  readonly model: string;
}

export interface UmbralesSemanticos {
  /**
   * Coseno por debajo del cual el parecido con la mejor sonda positiva no
   * sostiene nada. Es la ABSTENCIÓN, y es propiedad del MODELO, no del dominio:
   * al cambiar de familia de modelos hay que volver a medirlo.
   *
   * 0,80 sobre `multilingual-e5-small`. La familia e5 comprime el rango útil del
   * coseno en la banda alta —el worker semántico midió su suelo en 0,87 sobre
   * frases limpias— y aquí los textos son SUCIOS: salen de un OCR sobre una
   * tarjeta, con glifos de la foto metidos entre los rótulos. Ese ruido desplaza
   * todas las similitudes hacia abajo a la vez, así que heredar el 0,87 del otro
   * worker abstendría sobre cédulas legítimas.
   */
  readonly sueloDeParecido: number;
  /**
   * Cuánto tiene que ganarle la mejor sonda POSITIVA a la mejor NEGATIVA para
   * que el parecido signifique algo.
   *
   * Es el número que hace el trabajo. Todos los documentos oficiales se parecen
   * entre sí, así que un coseno alto contra «cédula boliviana» no dice nada si el
   * coseno contra «documento de identidad de otro país sudamericano» es igual de
   * alto. Lo que separa es el MARGEN.
   */
  readonly margenMinimo: number;
}

export const UMBRALES_SEMANTICOS_POR_DEFECTO: UmbralesSemanticos = {
  sueloDeParecido: 0.8,
  margenMinimo: 0.015,
};

export interface AnalisisSemantico {
  /** `false` cuando no se pudo medir. Nunca se sustituye por un valor neutro. */
  readonly disponible: boolean;
  /** Conformidad semántica en `[0, 1]`. `null` cuando no se pudo medir. */
  readonly conformidad: number | null;
  readonly mejorPositiva: { readonly id: string; readonly parecido: number } | null;
  readonly mejorNegativa: { readonly id: string; readonly parecido: number } | null;
  /** `mejorPositiva − mejorNegativa`. Puede ser negativo: eso es una contradicción. */
  readonly margen: number | null;
  /** `true` cuando alguna sonda negativa le gana a todas las positivas. */
  readonly contradicho: boolean;
  readonly modelo: string | null;
  /** Por qué no se pudo medir, cuando no se pudo. */
  readonly indisponibilidad?: string;
}

/** Lo que no se pudo medir, con su motivo puesto. */
function noDisponible(motivo: string): AnalisisSemantico {
  return {
    disponible: false,
    conformidad: null,
    mejorPositiva: null,
    mejorNegativa: null,
    margen: null,
    contradicho: false,
    modelo: null,
    indisponibilidad: motivo,
  };
}

/**
 * Proyecta el texto del documento y las sondas del catálogo, y compara.
 *
 * El texto se recorta a `MAX_CARACTERES` antes de proyectarlo. No es una
 * optimización: el contexto del codificador es finito y un texto que lo desborde
 * se trunca por el servidor SIN avisar, de modo que la medida dependería de por
 * dónde cayó el corte. Recortando aquí, y por el principio —donde están los
 * rótulos de cabecera, que es lo que distingue una cédula—, el corte es
 * conocido y reproducible.
 */
export async function clasificarSemanticamente(input: {
  readonly embedder: IdentityEmbedderPort | null;
  readonly texto: string;
  readonly umbrales: UmbralesSemanticos;
  readonly sondas?: readonly SondaDeCatalogo[];
  readonly signal?: AbortSignal;
}): Promise<AnalisisSemantico> {
  if (!input.embedder) return noDisponible('EMBEDDER_NOT_CONFIGURED');

  const texto = normalizarParaModelo(input.texto);
  if (texto.length < MIN_CARACTERES) return noDisponible('TEXT_TOO_SHORT');

  const sondas = input.sondas ?? SONDAS_BOLIVIA_CI;
  try {
    const vectores = await input.embedder.embed(
      [texto, ...sondas.map((sonda) => sonda.texto)],
      input.signal,
    );
    const [documento, ...deSondas] = vectores;
    if (!documento || deSondas.length !== sondas.length) {
      return noDisponible('EMBEDDER_RETURNED_UNEXPECTED_SHAPE');
    }

    const parecidos = sondas.map((sonda, indice) => ({
      id: sonda.id,
      positiva: sonda.positiva,
      parecido: coseno(documento, deSondas[indice] ?? []),
    }));

    const mejorPositiva = mejor(parecidos.filter((p) => p.positiva));
    const mejorNegativa = mejor(parecidos.filter((p) => !p.positiva));
    if (!mejorPositiva) return noDisponible('NO_POSITIVE_PROBES');

    const margen = mejorNegativa
      ? mejorPositiva.parecido - mejorNegativa.parecido
      : mejorPositiva.parecido;

    return {
      disponible: true,
      conformidad: aConformidad(mejorPositiva.parecido, margen, input.umbrales),
      mejorPositiva: { id: mejorPositiva.id, parecido: redondear(mejorPositiva.parecido) },
      mejorNegativa: mejorNegativa
        ? { id: mejorNegativa.id, parecido: redondear(mejorNegativa.parecido) }
        : null,
      margen: redondear(margen),
      contradicho: margen < 0,
      modelo: input.embedder.model,
    };
  } catch (error) {
    return noDisponible(error instanceof Error ? error.message.slice(0, 160) : 'EMBEDDER_FAILED');
  }
}

/**
 * Del par (parecido, margen) a una conformidad en `[0, 1]`.
 *
 * Las dos condiciones son NECESARIAS y se multiplican en vez de promediarse: un
 * parecido altísimo con margen cero significa que el texto se parece igual a una
 * cédula boliviana y a un documento de otro país, y promediar dejaría eso en un
 * respetable 0,5 que el fusor leería como media prueba a favor. Multiplicando,
 * un margen nulo anula el resultado, que es lo que un margen nulo significa.
 *
 * Cada factor se satura en 1: pasado el umbral, más parecido no es más prueba —
 * la sonda no es el documento, y premiar el exceso sólo premiaría a los textos
 * que casualmente se redactan como la sonda.
 */
function aConformidad(parecido: number, margen: number, umbrales: UmbralesSemanticos): number {
  const porParecido = saturar(
    (parecido - umbrales.sueloDeParecido) / Math.max(1e-6, 1 - umbrales.sueloDeParecido),
  );
  const porMargen = saturar(margen / Math.max(1e-6, umbrales.margenMinimo * 3));
  return redondear(porParecido * porMargen);
}

function mejor<T extends { parecido: number }>(items: readonly T[]): T | null {
  return items.reduce<T | null>((a, b) => (a === null || b.parecido > a.parecido ? b : a), null);
}

/** Producto escalar. Con vectores de norma 1 —el adaptador los pide así— ES el coseno. */
function coseno(a: readonly number[], b: readonly number[]): number {
  const largo = Math.min(a.length, b.length);
  let producto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < largo; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    producto += x * y;
    normaA += x * x;
    normaB += y * y;
  }
  // Se renormaliza por si acaso: un servidor mal configurado puede devolver
  // vectores sin normalizar, y ahí el producto escalar crece con la longitud del
  // texto —o sea, la cédula más larga parecería más cédula—.
  const divisor = Math.sqrt(normaA) * Math.sqrt(normaB);
  return divisor === 0 ? 0 : producto / divisor;
}

const MIN_CARACTERES = 24;
const MAX_CARACTERES = 1_200;

/**
 * El texto del OCR, listo para el codificador.
 *
 * Se colapsa el espacio en blanco —el reconocedor devuelve saltos de línea por
 * cada renglón de la tarjeta y eso no significa nada para el modelo— y se
 * recorta por el principio.
 */
function normalizarParaModelo(texto: string): string {
  return texto.replace(/\s+/gu, ' ').trim().slice(0, MAX_CARACTERES);
}

function saturar(valor: number): number {
  return Math.max(0, Math.min(1, valor));
}

function redondear(valor: number): number {
  return Number(valor.toFixed(4));
}
