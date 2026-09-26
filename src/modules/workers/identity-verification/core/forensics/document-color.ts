/**
 * ¿Tiene COLOR la imagen del documento?
 *
 * Existe por el escáner de documentos de iOS (VisionKit). No devuelve la foto
 * original y deja al usuario elegir el filtro: *Color*, *Escala de grises*,
 * *Blanco y negro* o *Foto*. Con los dos del medio el anverso llega sin color, y
 * eso quita evidencia: el retrato en color, los colores de la bandera y el fondo
 * de seguridad de la cédula dejan de estar para quien revisa el caso.
 *
 * ## Qué hace con eso: nunca aprobar ni rechazar
 *
 * Devuelve una medida y el pipeline la convierte en la marca
 * `DOCUMENT_GRAYSCALE`. No entra en la lista de marcas que escalan un
 * VERIFICADO (ver `escalantes` en `identity-pipeline.service.ts`), no entra en
 * el motor de decisión y el artefacto `IDENTIDAD_CARNET_MOVIL` no proyecta
 * `riskFlags` del resultado. Lo único que mueve, y sólo en una población no
 * medida, es un `FACE_NO_MATCH` a revisión: un retrato sin color comparado con
 * una selfie en color puede dar poco parecido siendo la misma persona (ver
 * `grisSinMedir`). El forense de píxeles ya trabaja en escala de grises
 * (`image-tamper.analyzer.ts` convierte antes de medir), así que quitarle el
 * color a la entrada no le cambia la pregunta.
 *
 * ## Cómo se mide
 *
 * Por la CROMA de cada píxel —el máximo menos el mínimo de sus tres canales—,
 * sobre una miniatura. Un JPEG en escala de grises guardado en RGB tiene
 * R = G = B salvo el redondeo de la conversión YCbCr, así que su croma no pasa
 * de unas pocas unidades. Una foto en color de una cédula tiene regiones enteras
 * muy por encima: el retrato, el escudo, la bandera.
 *
 * Se cuenta la FRACCIÓN de píxeles con color claro y no la croma media, porque
 * la mayor parte de la tarjeta es fondo claro de poca saturación: la media de
 * una cédula en color es baja igual, y lo que la distingue es que hay zonas que
 * sí lo tienen.
 *
 * Es best-effort: si `sharp` no puede con la imagen devuelve `null` y el caso
 * no lleva la marca. Una medida informativa no puede tumbar una verificación.
 */
import sharp from 'sharp';

/** Lado largo de la miniatura: el color se ve igual a 256 px que a 1800. */
const LADO_ANALISIS = 256;

/**
 * Croma a partir de la cual un píxel tiene color «claro», sobre 0-255.
 *
 * Muy por encima del redondeo de un JPEG en grises (que no pasa de 4-6) y por
 * debajo de lo que dan el retrato o la bandera de una cédula fotografiada.
 */
const CROMA_CON_COLOR = 24;

/**
 * Fracción mínima de píxeles con color para que la imagen cuente como en color.
 *
 * Un 1 %: en la cédula sintética de `fixtures/identity-card.ts` el retrato solo
 * ya ocupa bastante más. Por debajo lo que queda es ruido de compresión en los
 * bordes de las letras, no color del documento.
 *
 * SIN MEDIR contra cédulas reales: el 24 y el 1 % salen sólo de la cédula
 * dibujada. Una tarjeta real con retrato poco saturado y fondo pastel podría
 * quedar por debajo en *Color* y marcarse sin color por error. La fase 5 mide
 * `fraccionConColor` de cada escaneo real con `scripts/diagnosticar-carnets.ts`
 * (columna `color`) y el umbral se fija con esa cifra.
 */
const FRACCION_MINIMA_CON_COLOR = 0.01;

export interface ColorDelDocumento {
  /** `true` cuando la imagen no tiene color apreciable: el filtro gris o B/N. */
  readonly sinColor: boolean;
  /** Fracción de píxeles con croma ≥ `CROMA_CON_COLOR`, en `[0, 1]`, a 4 decimales. */
  readonly fraccionConColor: number;
}

export async function medirColorDelDocumento(imagen: Buffer): Promise<ColorDelDocumento | null> {
  try {
    const { data, info } = await sharp(imagen)
      .removeAlpha()
      // Una imagen de un solo canal (un JPEG gris de verdad) sale con tres
      // canales iguales, que es exactamente «sin color».
      .toColourspace('srgb')
      .resize(LADO_ANALISIS, LADO_ANALISIS, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const canales = info.channels;
    const pixeles = info.width * info.height;
    if (pixeles === 0 || canales < 3) return null;

    let conColor = 0;
    for (let i = 0; i + 2 < data.length; i += canales) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const croma = Math.max(r, g, b) - Math.min(r, g, b);
      if (croma >= CROMA_CON_COLOR) conColor += 1;
    }
    const fraccion = conColor / pixeles;
    return {
      sinColor: fraccion < FRACCION_MINIMA_CON_COLOR,
      fraccionConColor: Number(fraccion.toFixed(4)),
    };
  } catch {
    return null;
  }
}
