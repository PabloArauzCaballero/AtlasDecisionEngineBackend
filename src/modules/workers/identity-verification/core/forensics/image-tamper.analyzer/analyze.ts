import sharp from 'sharp';
import {
  medirMarco,
  medirPeriodicidad,
  medirResiduoDeRecompresion,
  medirRuidoPorBloque,
  redondear,
} from './measures';
import {
  AnalisisDeManipulacion,
  BLOQUE,
  LADO_ANALISIS,
  SIN_MEDIDAS,
  SenalDeManipulacion,
} from './types';

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
      return {
        disponible: false,
        senales: [],
        medidas: SIN_MEDIDAS,
        indisponibilidad: 'IMAGE_TOO_SMALL_FOR_FORENSICS',
      };
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
