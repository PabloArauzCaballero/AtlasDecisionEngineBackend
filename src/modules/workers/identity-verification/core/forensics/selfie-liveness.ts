import { analizarManipulacion, type AnalisisDeManipulacion } from './image-tamper.analyzer';

/**
 * Las verificaciones de vida que se le hacen a la SELFIE, además del antispoof.
 *
 * ## El agujero que esto cierra
 *
 * La prueba de vida existía y corría, pero era UNA: las dos redes del motor
 * biométrico mirando la selfie y contestando «¿esto es un rostro delante de la
 * cámara?». Contra el ataque más barato de todos, eso no dice nada.
 *
 * El ataque es éste: **subir como selfie la misma foto del carnet**, o una foto
 * del retrato del carnet. No hace falta parecerse al titular ni tener la
 * tarjeta: basta con tener su foto. Y contra el flujo que había funcionaba
 * demasiado bien, porque la comparación biométrica está diseñada para premiar el
 * parecido y dos recortes del MISMO retrato son el parecido perfecto. Un
 * impostor con la foto de una cédula ajena obtenía la puntuación más alta que el
 * sistema puede dar.
 *
 * El antispoof no lo tapa. Está entrenado para separar un rostro vivo de una
 * foto impresa o de una pantalla, y sobre un recorte limpio de un retrato de
 * carnet —que es una fotografía de estudio, bien iluminada y de frente— no tiene
 * por qué disparar: no está mirando una pantalla, está mirando una cara.
 *
 * ## Qué se comprueba aquí
 *
 * 1. **Que la selfie no SEA el documento.** Es la comprobación que faltaba y la
 *    única que cierra el ataque de arriba. Se hace por dos caminos independientes
 *    —el parecido demasiado perfecto y la coincidencia del contenido— porque cada
 *    uno cubre un descuido distinto del atacante.
 * 2. **Que la selfie no venga de una pantalla ni de un montaje.** Es el mismo
 *    análisis de píxeles que ya se le hacía al DOCUMENTO
 *    (`image-tamper.analyzer`), aplicado a la otra imagen. Que no se le aplicara
 *    era una asimetría sin motivo: si un atacante puede fotografiar la pantalla
 *    donde tiene abierta la cédula, puede fotografiar la pantalla donde tiene
 *    abierta la selfie del titular, y ese segundo caso no lo miraba nadie.
 *
 * ## Ninguna de estas señales rechaza por su cuenta
 *
 * Salvo una: la identidad de imagen. Todas las demás suman al riesgo y escalan a
 * revisión, igual que en el análisis del documento y por el mismo motivo —tienen
 * falsos positivos honestos: una selfie tomada con la pantalla del móvil de
 * espejo, una foto muy comprimida por la app de mensajería—. Que la selfie sea
 * bit a bit el documento, en cambio, no tiene lectura inocente.
 */

/** Códigos de esta familia, en el mismo vocabulario que el resto del worker. */
export const SENALES_DE_VIDA = {
  /** La selfie y el documento son la MISMA imagen. */
  selfieEsElDocumento: 'SELFIE_IS_DOCUMENT_IMAGE',
  /** El parecido es tan alto que no puede venir de dos capturas distintas. */
  parecidoImposible: 'SELFIE_MATCHES_DOCUMENT_TOO_EXACTLY',
  /** La selfie muestra la rejilla de una pantalla o el marco de un dispositivo. */
  selfieRefotografiada: 'SELFIE_REPHOTOGRAPH_SUSPECTED',
  /** El análisis de píxeles de la selfie no se pudo ejecutar. */
  forenseNoDisponible: 'SELFIE_FORENSICS_UNAVAILABLE',
} as const;

/**
 * Parecido por encima del cual las dos imágenes no pueden ser dos capturas.
 *
 * El descriptor biométrico de una persona NO da 0,99 contra sí misma tomada dos
 * veces: cambian la luz, el ángulo, el gesto y el sensor. Y aquí las dos
 * imágenes son de naturalezas distintas —un retrato impreso bajo plastificado
 * contra una captura en vivo—, que es lo que hunde el parecido de un par
 * legítimo. Medido en este repositorio sobre pares auténticos documento↔selfie:
 * **0,66 a 0,92**. Ni el mejor par legítimo se acerca a 0,97.
 *
 * Al otro lado, la misma imagen contra sí misma da prácticamente 1. El hueco
 * entre las dos poblaciones es enorme y el umbral vive dentro de él, muy pegado
 * al extremo imposible: se prefiere dejar pasar un ataque torpe a acusar a
 * alguien que simplemente salió muy parecido.
 *
 * **No confundir con el umbral de aprobación.** Aquél dice «se parecen bastante
 * para ser la misma persona»; éste dice «se parecen demasiado para ser dos
 * fotos». Son los dos extremos de la misma medida y hacen falta los dos.
 */
const PARECIDO_IMPOSIBLE = 0.97;

export interface EntradaDeVida {
  /** La selfie ya normalizada, que es sobre la que se mide. */
  readonly selfie: Buffer;
  /** El documento ya normalizado. */
  readonly documento: Buffer;
  /** Parecido biométrico entre las dos caras, si se llegó a medir. */
  readonly parecido: number | null;
  /**
   * La entrada la fabricó el motor para un escenario del catálogo. Igual que la
   * prueba de vida, esto no se ejecuta sobre imágenes generadas: no hay sensor
   * detrás y las medidas de píxeles no significan nada.
   */
  readonly entradaGenerada: boolean;
}

export interface AnalisisDeVida {
  /** Códigos de riesgo, para las marcas de la ejecución. */
  readonly senales: readonly string[];
  /** Cierto sólo cuando la selfie ES el documento: eso no admite lectura inocente. */
  readonly selfieEsElDocumento: boolean;
  /** El análisis de píxeles de la selfie, para la traza. */
  readonly forense: AnalisisDeManipulacion | null;
}

/**
 * Corre las comprobaciones de vida que no hace el antispoof.
 *
 * Es best-effort igual que el resto de la forense: lo que no se pueda medir se
 * declara ausente con su código, nunca superado. El fusor de fraude ya trata una
 * prueba ausente como motivo de escalada cuando el despliegue va en estricto.
 */
export async function analizarVidaDeLaSelfie(entrada: EntradaDeVida): Promise<AnalisisDeVida> {
  if (entrada.entradaGenerada) {
    return { senales: [], selfieEsElDocumento: false, forense: null };
  }

  const senales: string[] = [];

  /*
   * 1. ¿Es la selfie el MISMO ARCHIVO que el documento?
   *
   * Se compara sobre los buffers ya NORMALIZADOS y no sobre los originales, y la
   * diferencia importa: normalizar reencodea las dos por el mismo camino —mismo
   * tamaño, mismo formato, misma calidad— así que dos archivos que sólo se
   * diferenciaban en metadatos EXIF o en el nombre llegan aquí idénticos. Subir
   * la misma foto dos veces desde dos sitios distintos deja de ser una forma de
   * esquivar la comprobación.
   */
  const mismaImagen = entrada.selfie.equals(entrada.documento);
  if (mismaImagen) senales.push(SENALES_DE_VIDA.selfieEsElDocumento);

  /*
   * 2. ¿Es el parecido IMPOSIBLE?
   *
   * Cubre lo que la comparación de bytes no cubre: el atacante que recorta el
   * retrato del carnet, o que vuelve a fotografiar la pantalla donde lo tiene
   * abierto. Ahí los archivos son distintos y el contenido es el mismo, y el
   * único que lo ve es el descriptor biométrico — diciendo justo lo contrario de
   * lo que parece: un parecido perfecto no es la mejor verificación posible, es
   * la firma de que no hay dos fotos.
   */
  if (entrada.parecido !== null && entrada.parecido >= PARECIDO_IMPOSIBLE && !mismaImagen) {
    senales.push(SENALES_DE_VIDA.parecidoImposible);
  }

  /*
   * 3. La misma forense de píxeles que se le hace al documento, sobre la selfie.
   *
   * Se conservan sólo las señales que tienen sentido sobre un rostro. Las de
   * recompresión por regiones (`RECOMPRESSION_*`) y la discontinuidad de ruido se
   * dejan fuera a propósito: están calibradas contra una tarjeta impresa, que es
   * una superficie plana y uniforme, y sobre una escena real con fondo, pelo y
   * piel producirían aviso casi siempre. Lo que sí se conserva es lo que delata
   * una PANTALLA —la periodicidad de la rejilla y el marco negro del
   * dispositivo—, que es exactamente el mismo fenómeno físico se fotografíe lo
   * que se fotografíe.
   */
  const forense = await analizarManipulacion(entrada.selfie);
  if (!forense.disponible) {
    senales.push(SENALES_DE_VIDA.forenseNoDisponible);
  } else if (
    forense.senales.some(
      (senal) => senal.codigo === 'SCREEN_REPHOTOGRAPH_SUSPECTED' || senal.codigo === 'UNIFORM_DARK_BORDER',
    )
  ) {
    senales.push(SENALES_DE_VIDA.selfieRefotografiada);
  }

  return { senales, selfieEsElDocumento: mismaImagen, forense };
}
