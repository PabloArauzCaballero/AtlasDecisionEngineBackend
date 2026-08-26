/**
 * Lo que la imagen delata sobre sí misma, mirando los píxeles y no el texto.
 *
 * ## El ataque que el resto del worker no ve
 *
 * Todo lo demás —el catálogo, el clasificador semántico, el analizador de
 * campos— trabaja sobre el TEXTO leído. Contra eso, el fraude más barato que
 * existe no compite: consiste en no tener la tarjeta. Se descarga una foto de
 * una cédula ajena, se abre en la pantalla del portátil y se fotografía con el
 * móvil; o se coge una cédula real y se le pega encima otro retrato. En los dos
 * casos el texto es impecable, porque el texto es el de un documento auténtico.
 *
 * Lo que cambia son los píxeles, y de formas que se pueden medir:
 *
 * - **La rejilla de la pantalla.** Un panel LCD tiene subpíxeles en cuadrícula
 *   regular. Fotografiarlo produce una periodicidad de período corto que ninguna
 *   superficie impresa tiene. Es la señal más específica de todas: una tarjeta
 *   de plástico no puede producirla.
 * - **La huella de la recompresión.** Un JPEG guardado dos veces conserva rastro
 *   de la primera cuantización. Si además una REGIÓN se pegó desde otra imagen,
 *   esa región llega con un historial de compresión distinto del resto y su
 *   residuo al recomprimir se separa del de sus vecinos.
 * - **El ruido que no es continuo.** El sensor de una cámara deja un grano
 *   parecido en toda la escena. Un recorte pegado trae el grano de OTRA cámara,
 *   o ninguno si se generó por software.
 * - **El marco.** Una foto de una pantalla casi siempre lleva alrededor el borde
 *   negro del dispositivo o del visor.
 *
 * ## Ninguna de estas señales rechaza a nadie por su cuenta
 *
 * Y es deliberado. Todas tienen falsos positivos honestos: una cédula plastificada
 * bajo un fluorescente produce muaré, una foto muy comprimida por la app de
 * mensajería produce residuos raros, un fondo liso produce ruido no uniforme. Lo
 * que hacen es SUMAR al puntaje de fraude, y quien decide es
 * `identity-fraud.scorer.ts`. Acusar de falsificación con una heurística de
 * píxeles a solas sería la peor decisión posible de este módulo.
 *
 * Todo es best-effort: si `sharp` no puede con la imagen, esto devuelve
 * `disponible: false` y el fusor lo trata como una prueba que falta, no como una
 * prueba superada.
 */

import sharp from 'sharp';

export interface SenalDeManipulacion {
  readonly codigo: string;
  readonly detalle: string;
  /** Cuánto suma al riesgo, en `[0, 1]`. */
  readonly peso: number;
}

export interface AnalisisDeManipulacion {
  readonly disponible: boolean;
  readonly senales: readonly SenalDeManipulacion[];
  /** Las medidas crudas, para la traza: sin ellas un veredicto no se puede discutir. */
  readonly medidas: {
    readonly periodicidad: number | null;
    readonly residuoMaximoRelativo: number | null;
    readonly bloquesAtipicos: number | null;
    readonly variacionDelRuido: number | null;
    readonly marcoUniforme: number | null;
  };
  readonly indisponibilidad?: string;
}

/** Lado al que se reduce la imagen para analizarla. */
const LADO_ANALISIS = 512;
/** Tamaño del bloque en el que se trocea la imagen para las medidas locales. */
const BLOQUE = 32;

const SIN_MEDIDAS = {
  periodicidad: null,
  residuoMaximoRelativo: null,
  bloquesAtipicos: null,
  variacionDelRuido: null,
  marcoUniforme: null,
} as const;

/**
 * Analiza una imagen ya normalizada y devuelve sus señales de manipulación.
 *
 * Se le pasa el buffer NORMALIZADO y no el original a propósito: el original
 * puede venir en cualquier formato y a cualquier resolución, y las medidas de
 * periodicidad y de residuo dependen de la escala. Midiendo siempre sobre la
 * misma reducción, los números de dos ejecuciones son comparables — que es la
 * condición para poder calibrar un umbral con ellos.
 */
export async function analizarManipulacion(imagen: Buffer): Promise<AnalisisDeManipulacion> {
  try {
    const gris = await sharp(imagen)
      .removeAlpha()
      .greyscale()
      .resize(LADO_ANALISIS, LADO_ANALISIS, { fit: 'inside', withoutEnlargement: false })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = gris;
    const ancho = info.width;
    const alto = info.height;
    if (ancho < BLOQUE * 2 || alto < BLOQUE * 2) {
      return { disponible: false, senales: [], medidas: SIN_MEDIDAS, indisponibilidad: 'IMAGE_TOO_SMALL_FOR_FORENSICS' };
    }

    const periodicidad = medirPeriodicidad(data, ancho, alto);
    const marcoUniforme = medirMarco(data, ancho, alto);
    const ruido = medirRuidoPorBloque(data, ancho, alto);
    const residuo = await medirResiduoDeRecompresion(imagen, ancho, alto);

    const senales: SenalDeManipulacion[] = [];

    /*
     * 0,28 de periodicidad.
     *
     * La medida es la autocorrelación máxima del gradiente horizontal en los
     * desfases de 2 a 10 píxeles, que es la banda donde cae la rejilla de un
     * panel fotografiado a la distancia a la que se fotografía una pantalla.
     * Una superficie impresa lisa da valores por debajo de 0,15; el texto de la
     * propia tarjeta —que también es periódico, renglón a renglón— sube hasta
     * 0,25 largos. Por encima de 0,28 la periodicidad ya no la explica el texto.
     */
    if (periodicidad !== null && periodicidad > 0.28) {
      senales.push({
        codigo: 'SCREEN_REPHOTOGRAPH_SUSPECTED',
        detalle: `La imagen tiene un patrón periódico de período corto (${periodicidad.toFixed(3)}), compatible con la foto de una pantalla.`,
        peso: 0.35,
      });
    }

    if (marcoUniforme !== null && marcoUniforme > 0.7) {
      senales.push({
        codigo: 'UNIFORM_DARK_BORDER',
        detalle: `El ${(marcoUniforme * 100).toFixed(0)} % del perímetro es un marco liso y oscuro, típico de una captura de pantalla o del visor de otro dispositivo.`,
        peso: 0.2,
      });
    }

    /*
     * El ruido: se mide la DISPERSIÓN de la energía de alta frecuencia entre
     * bloques, normalizada por su mediana. Un mismo sensor deja un grano
     * parecido en toda la escena; un recorte pegado trae el de otra cámara —o
     * ninguno—. Por encima de 1,6 de coeficiente de variación hay dos regímenes
     * de ruido conviviendo en una tarjeta, que es una superficie plana y
     * uniforme donde eso no debería pasar.
     */
    if (ruido.variacion !== null && ruido.variacion > 1.6) {
      senales.push({
        codigo: 'NOISE_DISCONTINUITY',
        detalle: `El grano de la imagen no es homogéneo (variación ${ruido.variacion.toFixed(2)}): hay regiones con un historial distinto del resto.`,
        peso: 0.25,
      });
    }

    /*
     * Las dos señales de recompresión son EXCLUYENTES, y a propósito.
     *
     * Miden lo mismo por dos caminos —un bloque muy fuera de rango y varios
     * bloques fuera de rango— así que emitir las dos duplica la misma evidencia,
     * y dos pesos de 0,3 y 0,25 componen 0,475: por encima del umbral de
     * revisión. O sea, una sola familia de señales de píxeles podría mandar a
     * una persona a revisar un caso ella sola.
     *
     * Eso no se sostiene con lo que hoy se puede afirmar. Estos cortes están
     * medidos contra la cédula sintética de `fixtures/` y contra imágenes que no
     * son documentos; **no hay ninguna calibración contra fotos reales de
     * cédulas reales**, porque este repositorio no debe guardarlas.
     *
     * Con esa incertidumbre, 0,25: por DEBAJO del umbral de revisión por defecto
     * (0,3), de modo que la recompresión sola nunca manda a nadie a una cola
     * humana. Hace falta que algo más la acompañe — otra señal de píxeles, un
     * rótulo que falte, una fecha que no cuadre—. Es una diferencia de cinco
     * centésimas y decide si una foto que la aplicación de mensajería recomprimió
     * dos veces le cuesta a alguien una revisión.
     *
     * El muaré (0,35) SÍ cruza solo, y es deliberado: una superficie impresa no
     * puede producir la rejilla de un panel LCD, así que es la única señal de este
     * archivo que afirma algo que no tiene una explicación inocente frecuente.
     * Aun así sólo llega a REVISIÓN: ninguna señal de píxeles alcanza sola el
     * umbral de sospecha (0,6).
     *
     * Cuando haya un corpus real medido, esto se revisa. Mientras tanto, un
     * falso positivo aquí manda a revisión a alguien que no hizo nada mal.
     */
    if (residuo.bloquesAtipicos !== null && residuo.bloquesAtipicos >= 6) {
      senales.push({
        codigo: 'RECOMPRESSION_PATCHWORK',
        detalle: `${residuo.bloquesAtipicos} bloques se apartan del residuo esperado: la imagen parece compuesta por partes de distinta procedencia.`,
        peso: 0.25,
      });
    } else if (residuo.maximoRelativo !== null && residuo.maximoRelativo > 6) {
      senales.push({
        codigo: 'RECOMPRESSION_RESIDUAL_OUTLIER',
        detalle: `Al recomprimir, un bloque deja un residuo ${residuo.maximoRelativo.toFixed(1)} veces el de la mediana: es la firma de una región pegada desde otra imagen.`,
        peso: 0.25,
      });
    }

    return {
      disponible: true,
      senales,
      medidas: {
        periodicidad: redondear(periodicidad),
        residuoMaximoRelativo: redondear(residuo.maximoRelativo),
        bloquesAtipicos: residuo.bloquesAtipicos,
        variacionDelRuido: redondear(ruido.variacion),
        marcoUniforme: redondear(marcoUniforme),
      },
    };
  } catch (error) {
    return {
      disponible: false,
      senales: [],
      medidas: SIN_MEDIDAS,
      indisponibilidad: error instanceof Error ? error.message.slice(0, 160) : 'FORENSICS_FAILED',
    };
  }
}

/**
 * La periodicidad de período corto, por autocorrelación del gradiente.
 *
 * Se deriva primero —el gradiente quita la iluminación, que es de período largo
 * y taparía la señal— y se autocorrelaciona en los desfases de 2 a 10 píxeles.
 * La rejilla de una pantalla cae ahí; la iluminación y la forma de la tarjeta,
 * mucho más arriba.
 */
function medirPeriodicidad(data: Buffer, ancho: number, alto: number): number | null {
  // Una fila de cada cuatro: la señal de una rejilla está en TODAS las filas, y
  // recorrerlas todas cuadruplicaría el coste sin cambiar el número.
  const filas: number[] = [];
  for (let y = 0; y < alto; y += 4) filas.push(y);
  if (filas.length === 0) return null;

  let maximo = 0;
  for (let desfase = 2; desfase <= 10; desfase += 1) {
    let numerador = 0;
    let denominador = 0;
    for (const y of filas) {
      const base = y * ancho;
      for (let x = 1; x < ancho - desfase - 1; x += 1) {
        const g1 = (data[base + x + 1] ?? 0) - (data[base + x - 1] ?? 0);
        const g2 = (data[base + x + desfase + 1] ?? 0) - (data[base + x + desfase - 1] ?? 0);
        numerador += g1 * g2;
        denominador += g1 * g1;
      }
    }
    if (denominador > 0) maximo = Math.max(maximo, numerador / denominador);
  }
  return Math.max(0, Math.min(1, maximo));
}

/**
 * Cuánto del perímetro es un marco liso y oscuro.
 *
 * Se recorre una banda del 4 % del lado en los cuatro bordes y se cuenta la
 * proporción de píxeles oscuros y de baja varianza local. Una foto de una cédula
 * sobre una mesa tiene fondo, pero no un fondo NEGRO Y LISO; una captura de
 * pantalla o la foto de un móvil dentro de otro móvil, sí.
 */
function medirMarco(data: Buffer, ancho: number, alto: number): number | null {
  const banda = Math.max(2, Math.round(Math.min(ancho, alto) * 0.04));
  let oscuros = 0;
  let total = 0;

  const contar = (x: number, y: number): void => {
    const valor = data[y * ancho + x] ?? 0;
    total += 1;
    if (valor < 48) oscuros += 1;
  };

  for (let y = 0; y < banda; y += 1) for (let x = 0; x < ancho; x += 2) contar(x, y);
  for (let y = alto - banda; y < alto; y += 1) for (let x = 0; x < ancho; x += 2) contar(x, y);
  for (let x = 0; x < banda; x += 1) for (let y = banda; y < alto - banda; y += 2) contar(x, y);
  for (let x = ancho - banda; x < ancho; x += 1) for (let y = banda; y < alto - banda; y += 2) contar(x, y);

  return total === 0 ? null : oscuros / total;
}

/**
 * La energía de alta frecuencia por bloque, y cuánto varía entre bloques.
 *
 * Los bloques PLANOS se descartan antes de medir la dispersión. Es la corrección
 * que evita el falso positivo más obvio: el fondo liso sobre el que se apoya la
 * tarjeta tiene ruido casi nulo, y compararlo con el texto impreso daría una
 * variación altísima en toda foto normal. Lo que interesa es si entre las zonas
 * CON contenido hay dos regímenes distintos.
 */
function medirRuidoPorBloque(
  data: Buffer,
  ancho: number,
  alto: number,
): { variacion: number | null } {
  const energias: number[] = [];
  for (let by = 0; by + BLOQUE <= alto; by += BLOQUE) {
    for (let bx = 0; bx + BLOQUE <= ancho; bx += BLOQUE) {
      let suma = 0;
      let cuenta = 0;
      for (let y = by + 1; y < by + BLOQUE - 1; y += 1) {
        for (let x = bx + 1; x < bx + BLOQUE - 1; x += 1) {
          const centro = data[y * ancho + x] ?? 0;
          const laplaciano =
            4 * centro -
            (data[(y - 1) * ancho + x] ?? 0) -
            (data[(y + 1) * ancho + x] ?? 0) -
            (data[y * ancho + x - 1] ?? 0) -
            (data[y * ancho + x + 1] ?? 0);
          suma += Math.abs(laplaciano);
          cuenta += 1;
        }
      }
      if (cuenta > 0) energias.push(suma / cuenta);
    }
  }
  if (energias.length < 8) return { variacion: null };

  const conContenido = energias.filter((energia) => energia > 2);
  if (conContenido.length < 6) return { variacion: null };

  const media = conContenido.reduce((a, b) => a + b, 0) / conContenido.length;
  if (media <= 0) return { variacion: null };
  const varianza =
    conContenido.reduce((suma, valor) => suma + (valor - media) ** 2, 0) / conContenido.length;
  return { variacion: Math.sqrt(varianza) / media };
}

/**
 * El residuo de recomprimir, bloque a bloque — el «análisis de nivel de error».
 *
 * Se recomprime la imagen a una calidad conocida y se mide, por bloque, cuánto
 * se apartó del original. Un JPEG guardado una sola vez deja un residuo bastante
 * uniforme; una región traída de otra imagen —con otra historia de cuantización—
 * deja un residuo que se separa del de sus vecinos.
 *
 * Se informa RELATIVO a la mediana, nunca en valor absoluto: el residuo absoluto
 * depende de la textura y de cuánto se comprimió antes, así que un umbral
 * absoluto discriminaría por cámara y no por manipulación.
 */
async function medirResiduoDeRecompresion(
  original: Buffer,
  ancho: number,
  alto: number,
): Promise<{ maximoRelativo: number | null; bloquesAtipicos: number | null }> {
  try {
    const base = await sharp(original)
      .removeAlpha()
      .greyscale()
      .resize(ancho, alto, { fit: 'fill' })
      .raw()
      .toBuffer();
    const recomprimida = await sharp(original)
      .removeAlpha()
      .greyscale()
      .resize(ancho, alto, { fit: 'fill' })
      .jpeg({ quality: 88 })
      .toBuffer();
    const vuelta = await sharp(recomprimida).raw().toBuffer();

    const residuos: number[] = [];
    for (let by = 0; by + BLOQUE <= alto; by += BLOQUE) {
      for (let bx = 0; bx + BLOQUE <= ancho; bx += BLOQUE) {
        let suma = 0;
        let cuenta = 0;
        for (let y = by; y < by + BLOQUE; y += 1) {
          for (let x = bx; x < bx + BLOQUE; x += 1) {
            const indice = y * ancho + x;
            suma += Math.abs((base[indice] ?? 0) - (vuelta[indice] ?? 0));
            cuenta += 1;
          }
        }
        if (cuenta > 0) residuos.push(suma / cuenta);
      }
    }
    if (residuos.length < 8) return { maximoRelativo: null, bloquesAtipicos: null };

    const ordenados = [...residuos].sort((a, b) => a - b);
    const mediana = ordenados[Math.floor(ordenados.length / 2)] ?? 0;
    // Un suelo para la mediana: sobre una imagen casi plana la mediana es ~0 y
    // cualquier residuo daría un cociente enorme. 0,5 niveles de gris es el ruido
    // de cuantización que deja incluso una recompresión sin cambios.
    const referencia = Math.max(0.5, mediana);
    const maximo = ordenados[ordenados.length - 1] ?? 0;

    return {
      maximoRelativo: maximo / referencia,
      bloquesAtipicos: residuos.filter((residuo) => residuo > referencia * 3).length,
    };
  } catch {
    return { maximoRelativo: null, bloquesAtipicos: null };
  }
}

function redondear(valor: number | null): number | null {
  return valor === null ? null : Number(valor.toFixed(4));
}
