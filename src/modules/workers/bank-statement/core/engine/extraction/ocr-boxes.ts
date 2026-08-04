import type { TextToken } from '../../domain/models';
import type { OcrLine } from './ocr-port';

/**
 * Caja de texto tal como la devuelve un motor de OCR: **píxeles** de la imagen
 * rasterizada, con el origen **arriba a la izquierda**.
 *
 * Es la forma nativa de Tesseract y de la práctica totalidad de los motores, y
 * es exactamente la contraria a la que usa este módulo —puntos PDF, origen
 * abajo—. Convertirla a mano es el único error de integración que el puerto de
 * OCR permite cometer sin que salte nada: las filas salen invertidas y el
 * extracto se lee del revés.
 */
export interface OcrBox {
  readonly text: string;
  /** Distancia al borde izquierdo de la imagen, en píxeles. */
  readonly left: number;
  /** Distancia al borde **superior** de la imagen, en píxeles. */
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface OcrPageBoxes {
  readonly pageNumber: number;
  /** Ancho de la imagen rasterizada, en píxeles. */
  readonly imageWidth: number;
  /** Alto de la imagen rasterizada, en píxeles. */
  readonly imageHeight: number;
  /** Ancho de la página en puntos: el que el motor recibió en la solicitud. */
  readonly pageWidth: number;
  /**
   * Alto de la página en puntos. Si se omite se deriva de la proporción de la
   * imagen, que es correcta siempre que se rasterizara la página completa.
   */
  readonly pageHeight?: number;
  readonly boxes: readonly OcrBox[];
}

/**
 * Tolerancia vertical para considerar que dos cajas están en el mismo renglón.
 * Es la misma que usa el lector de PDF, de modo que el texto reconocido se
 * agrupa igual que el nativo.
 */
const LINE_TOLERANCE = 2;

/**
 * Traduce las cajas de un motor de OCR a las líneas que espera el puerto.
 *
 * Se ofrece **hecho** en lugar de documentado porque la conversión tiene tres
 * trampas y las tres son silenciosas: el eje vertical va al revés, la escala es
 * de píxeles a puntos, y la referencia de una ficha de PDF es su **línea base**
 * —el borde inferior de la caja—, no su borde superior. Con este adaptador, un
 * anfitrión que integre OCR solo tiene que entregar lo que su motor ya devuelve.
 */
export function ocrLinesFromBoxes(page: OcrPageBoxes): OcrLine[] {
  if (page.imageWidth <= 0 || page.boxes.length === 0) return [];

  const scale = page.pageWidth / page.imageWidth;
  const pageHeight = page.pageHeight ?? page.imageHeight * scale;

  const tokens: TextToken[] = page.boxes
    .filter((box) => box.text.trim().length > 0)
    .map((box) => ({
      text: box.text.trim(),
      x: box.left * scale,
      // Del borde superior en píxeles a la línea base en puntos, contando desde
      // abajo: la convención del resto del módulo.
      y: pageHeight - (box.top + box.height) * scale,
      width: box.width * scale,
    }));

  const grouped: TextToken[][] = [];
  for (const token of [...tokens].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = grouped.find(
      (candidate) => Math.abs((candidate[0]?.y ?? 0) - token.y) <= LINE_TOLERANCE,
    );
    if (line) line.push(token);
    else grouped.push([token]);
  }

  return grouped.map((line) => {
    const ordered = [...line].sort((a, b) => a.x - b.x);
    return {
      page: page.pageNumber,
      pageWidth: page.pageWidth,
      y: ordered[0]?.y ?? 0,
      tokens: ordered,
    };
  });
}
