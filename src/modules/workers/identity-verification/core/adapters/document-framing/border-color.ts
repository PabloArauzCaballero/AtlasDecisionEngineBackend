import { FRANJA_DE_BORDE, PERCENTIL_DE_FONDO, TOLERANCIA_MINIMA } from './constants';

/**
 * El color del fondo, por la MEDIANA de las cuatro franjas del borde.
 *
 * La mediana y no la media, y es la decisión que hace que esto funcione sobre
 * papel cuadriculado: las líneas de la cuadrícula son una minoría de los píxeles
 * del borde, así que la mediana devuelve el blanco del papel y las líneas pasan
 * a contar como «no fondo» —que es lo que son, y da igual, porque son cuatro
 * píxeles por fila y el perfil las descarta—. La media, en cambio, se iría hacia
 * el azul y ensancharía la tolerancia hasta tragarse el beige de la cédula.
 *
 * Cada canal se mediana por separado. Es una aproximación —la mediana por canal
 * no es la mediana del color— y es la correcta aquí: lo que se quiere es el tono
 * dominante, no un píxel que exista.
 */
export function colorDelBorde(
  data: Buffer,
  ancho: number,
  alto: number,
  canales: number,
): { r: number; g: number; b: number } {
  const grosorX = Math.max(1, Math.round(ancho * FRANJA_DE_BORDE));
  const grosorY = Math.max(1, Math.round(alto * FRANJA_DE_BORDE));
  const rojos: number[] = [];
  const verdes: number[] = [];
  const azules: number[] = [];

  const tomar = (x: number, y: number): void => {
    const base = (y * ancho + x) * canales;
    rojos.push(data[base] ?? 0);
    verdes.push(data[base + 1] ?? 0);
    azules.push(data[base + 2] ?? 0);
  };

  for (let y = 0; y < alto; y += 1) {
    for (let x = 0; x < ancho; x += 1) {
      const enBorde = x < grosorX || x >= ancho - grosorX || y < grosorY || y >= alto - grosorY;
      if (enBorde) tomar(x, y);
    }
  }

  const mediana = (valores: number[]): number => {
    if (valores.length === 0) return 0;
    const ordenados = [...valores].sort((a, b) => a - b);
    return ordenados[Math.floor(ordenados.length / 2)] ?? 0;
  };
  return { r: mediana(rojos), g: mediana(verdes), b: mediana(azules) };
}

/**
 * Hasta dónde llega el fondo EN ESTA FOTO.
 *
 * Se mide sobre las mismas franjas del borde de las que salió el color: si el
 * borde de la fotografía es la mesa, lo que la mesa se aparta de su propia
 * mediana es la definición de «esto sigue siendo mesa». Una foto sobre madera
 * veteada obtiene una tolerancia ancha y una sobre un fondo liso, una estrecha,
 * y las dos son las correctas para su foto.
 *
 * Es lo que sustituye a la constante que había, y el motivo es medido: con un
 * umbral fijo, dos de las cinco cédulas —las fotografiadas sobre papel
 * cuadriculado— dejaban el 30 % de la imagen por encima del umbral repartido por
 * todas partes, y el perfil no distinguía la tarjeta de la hoja.
 */
export function toleranciaDeFondo(
  data: Buffer,
  ancho: number,
  alto: number,
  canales: number,
  fondo: { r: number; g: number; b: number },
): number {
  const grosorX = Math.max(1, Math.round(ancho * FRANJA_DE_BORDE));
  const grosorY = Math.max(1, Math.round(alto * FRANJA_DE_BORDE));
  const distancias: number[] = [];
  for (let y = 0; y < alto; y += 1) {
    for (let x = 0; x < ancho; x += 1) {
      if (!(x < grosorX || x >= ancho - grosorX || y < grosorY || y >= alto - grosorY)) continue;
      const base = (y * ancho + x) * canales;
      const dr = (data[base] ?? 0) - fondo.r;
      const dg = (data[base + 1] ?? 0) - fondo.g;
      const db = (data[base + 2] ?? 0) - fondo.b;
      distancias.push(Math.sqrt(dr * dr + dg * dg + db * db));
    }
  }
  if (distancias.length === 0) return TOLERANCIA_MINIMA;
  distancias.sort((a, b) => a - b);
  const percentil = distancias[Math.floor(distancias.length * PERCENTIL_DE_FONDO)] ?? 0;
  return Math.max(TOLERANCIA_MINIMA, percentil);
}
