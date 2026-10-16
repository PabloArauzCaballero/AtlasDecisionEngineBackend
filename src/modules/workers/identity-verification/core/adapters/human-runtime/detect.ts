import sharp from 'sharp';
import { motorBiometrico } from './engine';
import { RostroDetectado } from './paths';

/**
 * Los rostros de una imagen.
 *
 * La imagen se decodifica con `sharp` —ya es dependencia— porque sin
 * `tfjs-node` no hay `decodeImage`, y se entrega como tensor de enteros, que es
 * lo que Human espera de una fuente que no es un lienzo del navegador.
 */
export async function detectarRostros(imagen: Buffer): Promise<RostroDetectado[]> {
  const human = await motorBiometrico();
  const { data, info } = await sharp(imagen)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tensor = human.tf.tensor(new Uint8Array(data), [1, info.height, info.width, 3], 'int32');
  try {
    const resultado = await human.detect(tensor);
    const caras = (resultado.face ?? []) as Array<Record<string, unknown>>;
    return caras.map((cara) => {
      const caja = (cara.box as number[] | undefined) ?? [0, 0, 0, 0];
      return {
        // Human da la caja en píxeles; el puerto la quiere en proporciones, que
        // es lo único que sobrevive a un remuestreo posterior.
        box: {
          left: caja[0] / info.width,
          top: caja[1] / info.height,
          width: caja[2] / info.width,
          height: caja[3] / info.height,
        },
        score: (cara.faceScore as number | undefined) ?? (cara.score as number | undefined) ?? 0,
        embedding: Array.isArray(cara.embedding) ? (cara.embedding as number[]) : null,
        real: typeof cara.real === 'number' ? cara.real : null,
        live: typeof cara.live === 'number' ? cara.live : null,
      };
    });
  } finally {
    human.tf.dispose(tensor);
  }
}

/**
 * Parecido entre dos descriptores, como coseno en [0,1].
 *
 * Se usa el coseno y no la función de parecido que trae Human porque aquélla
 * comprime el resultado a dos decimales y aplasta el tramo que aquí decide:
 * medido sobre una población sintética, dos personas distintas daban 0,99 y la
 * misma persona 1,00. El coseno sobre el descriptor sin normalizar separa esos
 * mismos casos en 0,88 y 0,94, y es además la medida sobre la que se calibran
 * los umbrales en `scripts/calibrar-identidad.mjs`.
 */
export function parecidoCoseno(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let producto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < a.length; i += 1) {
    producto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  if (normaA === 0 || normaB === 0) return 0;
  const coseno = producto / Math.sqrt(normaA * normaB);
  // El coseno vive en [-1,1]; el puerto promete [0,1]. Se recorta en vez de
  // reescalar: un parecido negativo significa «nada que ver», no «medio».
  return Math.min(1, Math.max(0, coseno));
}
