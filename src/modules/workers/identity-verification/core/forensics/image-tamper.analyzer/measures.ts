import sharp from 'sharp';
import { BLOQUE } from './types';

/**
 * La periodicidad de período corto, por autocorrelación del gradiente.
 *
 * Se deriva primero —el gradiente quita la iluminación, que es de período largo
 * y taparía la señal— y se autocorrelaciona en los desfases de 2 a 10 píxeles.
 * La rejilla de una pantalla cae ahí; la iluminación y la forma de la tarjeta,
 * mucho más arriba.
 */
export function medirPeriodicidad(data: Buffer, ancho: number, alto: number): number | null {
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
export function medirMarco(data: Buffer, ancho: number, alto: number): number | null {
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
  for (let x = ancho - banda; x < ancho; x += 1)
    for (let y = banda; y < alto - banda; y += 2) contar(x, y);

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
export function medirRuidoPorBloque(
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
export async function medirResiduoDeRecompresion(
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

export function redondear(valor: number | null): number | null {
  return valor === null ? null : Number(valor.toFixed(4));
}
