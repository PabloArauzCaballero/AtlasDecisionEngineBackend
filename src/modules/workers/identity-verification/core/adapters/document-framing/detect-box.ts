import sharp from 'sharp';
import { colorDelBorde, toleranciaDeFondo } from './border-color';
import { contrasteDeLaCaja, tramoDenso } from './box-contrast';
import {
  LADO_ANALISIS,
  LADO_DE_BLOQUE,
  MARGEN,
  PROPORCION_MAXIMA,
  PROPORCION_MINIMA,
} from './constants';

export interface CajaDeDocumento {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Busca la tarjeta y devuelve su caja en coordenadas de la imagen ENTREGADA, o
 * `null` si no hay una región que se comporte como una tarjeta.
 *
 * `null` no es un fallo: es la respuesta correcta para una foto donde el
 * documento ya llena el encuadre —no hay nada que quitar— y para una foto que no
 * es un documento. En los dos casos el que llama se queda con la imagen entera,
 * que es lo que había antes de que esto existiera.
 */
export async function detectarCajaDelDocumento(
  entrada: Buffer,
  limiteDePixeles: number,
): Promise<CajaDeDocumento | null> {
  const original = sharp(entrada, { limitInputPixels: limiteDePixeles });
  const metadatos = await original.metadata();
  const anchoOriginal = metadatos.width ?? 0;
  const altoOriginal = metadatos.height ?? 0;
  if (anchoOriginal === 0 || altoOriginal === 0) return null;

  const { data, info } = await sharp(entrada, { limitInputPixels: limiteDePixeles })
    .rotate()
    .resize({ width: LADO_ANALISIS, height: LADO_ANALISIS, fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ancho = info.width;
  const alto = info.height;
  const canales = info.channels;
  if (ancho < 8 || alto < 8) return null;

  const fondo = colorDelBorde(data, ancho, alto, canales);
  const tolerancia = toleranciaDeFondo(data, ancho, alto, canales, fondo);

  /*
   * Mapa de DENSIDAD por bloques, y sobre él dos perfiles unidimensionales.
   *
   * Los perfiles proyectados sobre cada eje bastan porque la caja que hace falta
   * está alineada con los ejes; una segmentación por componentes conexas daría
   * lo mismo y costaría bastante más. Lo que no basta es proyectar píxeles
   * sueltos: ahí es donde una cuadrícula se hace pasar por documento.
   */
  const bloquesEnX = Math.floor(ancho / LADO_DE_BLOQUE);
  const bloquesEnY = Math.floor(alto / LADO_DE_BLOQUE);
  if (bloquesEnX < 3 || bloquesEnY < 3) return null;

  const porFila = new Array<number>(bloquesEnY).fill(0);
  const porColumna = new Array<number>(bloquesEnX).fill(0);
  const limite = tolerancia * tolerancia;
  for (let by = 0; by < bloquesEnY; by += 1) {
    for (let bx = 0; bx < bloquesEnX; bx += 1) {
      let fuera = 0;
      for (let y = by * LADO_DE_BLOQUE; y < (by + 1) * LADO_DE_BLOQUE; y += 1) {
        for (let x = bx * LADO_DE_BLOQUE; x < (bx + 1) * LADO_DE_BLOQUE; x += 1) {
          const base = (y * ancho + x) * canales;
          const dr = (data[base] ?? 0) - fondo.r;
          const dg = (data[base + 1] ?? 0) - fondo.g;
          const db = (data[base + 2] ?? 0) - fondo.b;
          if (dr * dr + dg * dg + db * db > limite) fuera += 1;
        }
      }
      const densidad = fuera / (LADO_DE_BLOQUE * LADO_DE_BLOQUE);
      porFila[by] += densidad;
      porColumna[bx] += densidad;
    }
  }

  const filas = tramoDenso(porFila);
  const columnas = tramoDenso(porColumna);
  if (!filas || !columnas) return null;

  /*
   * LA GUARDA QUE IMPIDE RECORTAR UN DOCUMENTO QUE YA LLENA EL ENCUADRE.
   *
   * Todo lo de arriba da por hecho que el borde de la foto es el sitio donde se
   * apoyó la tarjeta. Cuando no lo es —una captura ya recortada, un escaneo, una
   * foto donde la cédula ocupa el 95 %— el color «del fondo» sale de la PROPIA
   * TARJETA, así que sólo su texto cuenta como no-fondo y el perfil devuelve un
   * trozo arbitrario del interior. Medido: sobre una cédula que llena su
   * encuadre, esto recortaba a la mitad del área y la cobertura del catálogo
   * caía de 0,234 a 0,000 — el documento dejaba de reconocerse.
   *
   * La comprobación es la que define un recorte útil: DENTRO tiene que haber
   * bastante más densidad que FUERA. Si las dos se parecen, lo de fuera es
   * documento también y no hay nada que quitar.
   */
  const contraste = contrasteDeLaCaja(porFila, porColumna, filas, columnas);
  if (contraste === null) return null;

  const escalaX = (anchoOriginal / ancho) * LADO_DE_BLOQUE;
  const escalaY = (altoOriginal / alto) * LADO_DE_BLOQUE;
  const anchoDetectado = (columnas.fin - columnas.inicio + 1) * escalaX;
  const altoDetectado = (filas.fin - filas.inicio + 1) * escalaY;
  if (anchoDetectado < 1 || altoDetectado < 1) return null;

  const proporcion =
    Math.max(anchoDetectado, altoDetectado) / Math.min(anchoDetectado, altoDetectado);
  if (proporcion < PROPORCION_MINIMA || proporcion > PROPORCION_MAXIMA) return null;

  const margenX = anchoDetectado * MARGEN;
  const margenY = altoDetectado * MARGEN;
  const left = Math.max(0, Math.round(columnas.inicio * escalaX - margenX));
  const top = Math.max(0, Math.round(filas.inicio * escalaY - margenY));
  const width = Math.min(anchoOriginal - left, Math.round(anchoDetectado + 2 * margenX));
  const height = Math.min(altoOriginal - top, Math.round(altoDetectado + 2 * margenY));
  if (width < 1 || height < 1) return null;

  // Recortar la imagen entera no es recortar: se declara «no hay nada que
  // quitar» y quien llama se queda con lo que tenía.
  if (left === 0 && top === 0 && width >= anchoOriginal && height >= altoOriginal) return null;

  return { left, top, width, height };
}
