import { IdentityDocumentType } from '../core/domain/identity-enums';
import { reconocerCedulaBoliviana } from '../core/catalog/bolivia-ci.recognizer';
import type { DocumentClassificationResult, DocumentOcrResult } from '../core/ports/identity.ports';

/**
 * Lado largo de las SONDAS de orientación, en píxeles.
 *
 * No es el tamaño con el que se lee un documento: es el tamaño con el que se
 * decide si hay que leerlo. Va en 800 porque ahí sigue habiendo de sobra para
 * la parte del texto que clasifica —el rótulo es lo más grande impreso en la
 * tarjeta— y porque es donde el coste deja de doler.
 *
 * Medido con `scripts/medir-rechazo-identidad.ts` sobre una foto de móvil que
 * no es un documento: 6516 ms a 1350x1800, 2435 ms a 900x1200, 1038 ms a
 * 600x800. Y en el otro lado, la cédula sintética reducida a 1000 px de lado
 * largo entrega LAS MISMAS señales y la misma evidencia (0,75) que entera.
 *
 * Bajarlo más no compra casi nada —de 600x800 a 450x600 son 140 ms— y empieza a
 * arriesgar el rótulo de una cédula fotografiada pequeña dentro del encuadre.
 */
export const ORIENTATION_PROBE_LONG_EDGE = 600;

/** Lo que sale de leer una o las dos caras y clasificarlas juntas. */
export interface Lectura {
  ocr: DocumentOcrResult;
  front: DocumentOcrResult;
  back: DocumentOcrResult | null;
  classification: DocumentClassificationResult;
}

/** El par de imágenes que se está leyendo. El reverso es opcional siempre. */
export interface CarasDelDocumento {
  readonly anverso: Buffer;
  readonly reverso: Buffer | null;
}

/** Clasificar recibe las dos caras POR SEPARADO: el catálogo sitúa cada anclaje en la suya. */
export type Clasificador = (
  anverso: string,
  reverso: string,
) => Promise<DocumentClassificationResult>;

/**
 * Cuánta plantilla de cédula boliviana se reconoce en una lectura, en `[0, 1]`.
 *
 * Es la MISMA medida que usa el clasificador para nombrar el documento y la
 * misma que después juzga `identity-fraud.scorer.ts`, y que sea la misma es
 * deliberado: con dos escalas distintas, una lectura podría ser «suficiente»
 * para elegir una orientación y «plantilla incompleta» para el análisis de
 * fraude en la misma ejecución.
 *
 * Aquí se usa como PUNTAJE RELATIVO y no contra un umbral. Es lo que permite
 * elegir orientación a 600 px, donde ninguna lectura llega a cruzar ningún
 * umbral y aun así sólo una de las cuatro saca algo distinto de cero.
 */
export function puntuarLectura(lectura: Lectura): number {
  return reconocerCedulaBoliviana({
    textoAnverso: lectura.front.rawText,
    textoReverso: lectura.back?.rawText ?? '',
  }).mejor.cobertura;
}

/**
 * ¿Hay motivo para seguir gastando reconocedor en esta imagen?
 *
 * Es la condición que sustituye a «el clasificador no supo decir qué es». Aquélla
 * era binaria y a tamaño barato contestaba que no sobre cédulas perfectamente
 * legibles, de modo que el reintento sin recorte y la búsqueda de orientación
 * —las dos vías que rescatan una foto— se disparaban o no según un umbral que la
 * foto real no alcanzaba nunca.
 *
 * Basta CUALQUIERA de las dos: que el clasificador ya sepa el tipo, o que el
 * catálogo reconozca aunque sea un anclaje. La segunda es la que rescata la foto
 * tumbada; la primera, la que evita medir dos veces lo que ya está decidido.
 */
export function hayIndicioDeDocumento(lectura: Lectura): boolean {
  if (lectura.classification.type !== IdentityDocumentType.UNKNOWN) return true;
  return puntuarLectura(lectura) > 0;
}

/**
 * Une la lectura de las dos caras en una sola.
 *
 * Las dos caras de una cédula llevan campos distintos —el número delante, el
 * nombre y las fechas detrás— y el analizador busca sus anclajes sobre el texto
 * completo. Está extraído porque el reintento sin recorte tiene que unirlas
 * igual: dos versiones de esta costura acabarían separándose.
 */
export function unirCaras(front: DocumentOcrResult, back: DocumentOcrResult): DocumentOcrResult {
  return {
    ...front,
    rawText: `${front.rawText}\n${back.rawText}`,
    lines: [...front.lines, ...back.lines],
  };
}

/** Cuánto entregó el reconocedor por cara, para la traza: volumen y confianza media. */
export function resumenOcr(cara: DocumentOcrResult): {
  chars: number;
  lines: number;
  meanConfidence: number | null;
} {
  const conConfianza = cara.lines.filter((linea) => linea.confidence !== null);
  const media =
    conConfianza.length > 0
      ? conConfianza.reduce((suma, linea) => suma + (linea.confidence ?? 0), 0) /
        conConfianza.length
      : null;
  return {
    chars: cara.rawText.length,
    lines: cara.lines.length,
    meanConfidence: media === null ? null : Number(media.toFixed(3)),
  };
}
