import { CORTE_DEL_PERFIL } from './constants';

/**
 * Hasta cuánto puede bajar el perfil DENTRO de la tarjeta sin que cuente como
 * salir de ella, en tanto por uno de la longitud del perfil.
 *
 * Existe porque una tarjeta de identidad no es densa de manera uniforme, y eso
 * partía el tramo por la mitad. Medido sobre una cédula boliviana auténtica del
 * formato anterior: la banda de la firma y el fondo liso de la mitad inferior
 * dejan dos renglones de bloques por debajo del corte, así que el tramo contiguo
 * más largo era la mitad SUPERIOR de la tarjeta y el recorte se llevaba por
 * delante `Válida hasta el`, el código de barras y la línea del número —o sea,
 * el dato por el que existe todo esto—.
 *
 * Un 8 % de un perfil de cuarenta renglones son tres, que es lo que mide la
 * banda lisa más ancha de las dos generaciones. No más: por encima de eso, el
 * hueco que se cierra deja de ser una zona lisa de la tarjeta y pasa a ser el
 * espacio que la separa de otra cosa que hay en la foto.
 */
const HUECO_INTERIOR = 0.08;

/**
 * Cuántas veces más denso tiene que ser el interior de la caja que su exterior
 * para que el recorte se dé por bueno.
 *
 * Tres. No es un umbral delicado porque no hay población intermedia: cuando el
 * recorte sirve, fuera está la mesa y la razón se va a decenas o a infinito;
 * cuando no sirve, fuera está el propio documento y la razón ronda uno.
 */
const CONTRASTE_MINIMO = 3;

/**
 * El tramo del perfil que ACUMULA MÁS densidad, cerrando antes los huecos
 * interiores.
 *
 * Dos decisiones, y las dos vienen de fallos medidos:
 *
 * 1. **Se cierran los huecos cortos** antes de buscar tramos, porque las zonas
 *    lisas de la propia tarjeta —la banda de la firma, el fondo del reverso—
 *    caen por debajo del corte y partían la tarjeta en dos.
 * 2. **Gana el tramo de más ENERGÍA, no el más largo.** Una foto trae a menudo
 *    más de una cosa: el borde de la mesa, una sombra dura, otro papel. Esos
 *    dejan tramos largos y flojos, y con el criterio de longitud uno de ellos
 *    podía ganarle a la tarjeta. La energía —la suma del perfil dentro del
 *    tramo— es lo que distingue una región densa de una región extensa, y la
 *    tarjeta es siempre la densa.
 */
/**
 * ¿Es lo de dentro de la caja bastante más denso que lo de fuera?
 *
 * Devuelve `null` cuando no, que es la señal de «aquí no hay nada que recortar».
 *
 * Se mide sobre los perfiles y no sobre el mapa de bloques porque es la misma
 * información proyectada y ya está calculada. El factor de tres no es delicado:
 * en las fotos donde el recorte sirve, lo de fuera es la mesa y da casi cero; en
 * las que no sirve, lo de fuera es el propio documento y da lo mismo que lo de
 * dentro. No hay población en medio.
 */
export function contrasteDeLaCaja(
  porFila: number[],
  porColumna: number[],
  filas: { inicio: number; fin: number },
  columnas: { inicio: number; fin: number },
): number | null {
  const media = (perfil: number[], desde: number, hasta: number): number => {
    let suma = 0;
    let n = 0;
    for (let i = 0; i < perfil.length; i += 1) {
      if (i < desde || i > hasta) continue;
      suma += perfil[i] ?? 0;
      n += 1;
    }
    return n === 0 ? 0 : suma / n;
  };
  const fuera = (perfil: number[], desde: number, hasta: number): number => {
    let suma = 0;
    let n = 0;
    for (let i = 0; i < perfil.length; i += 1) {
      if (i >= desde && i <= hasta) continue;
      suma += perfil[i] ?? 0;
      n += 1;
    }
    return n === 0 ? 0 : suma / n;
  };

  const dentro = Math.max(
    media(porFila, filas.inicio, filas.fin),
    media(porColumna, columnas.inicio, columnas.fin),
  );
  const afuera = Math.max(
    fuera(porFila, filas.inicio, filas.fin),
    fuera(porColumna, columnas.inicio, columnas.fin),
  );
  if (dentro <= 0) return null;
  // Sin nada fuera, el contraste es total: es el caso del documento sobre una
  // mesa lisa, y ahí el recorte es exactamente lo que hace falta.
  if (afuera <= 0) return Infinity;
  const razon = dentro / afuera;
  return razon >= CONTRASTE_MINIMO ? razon : null;
}

export function tramoDenso(perfil: number[]): { inicio: number; fin: number } | null {
  const maximo = Math.max(...perfil);
  if (maximo <= 0) return null;
  const corte = maximo * CORTE_DEL_PERFIL;
  const huecoMaximo = Math.max(1, Math.round(perfil.length * HUECO_INTERIOR));

  const dentro = perfil.map((valor) => valor >= corte);
  // Cerrar los huecos: un tramo corto por debajo del corte, con densidad a los
  // DOS lados, es una zona lisa de la tarjeta y no el final de la tarjeta.
  for (let i = 0; i < dentro.length; i += 1) {
    if (dentro[i]) continue;
    let fin = i;
    while (fin < dentro.length && !dentro[fin]) fin += 1;
    const hueco = fin - i;
    if (i > 0 && fin < dentro.length && hueco <= huecoMaximo) {
      for (let j = i; j < fin; j += 1) dentro[j] = true;
    }
    i = fin - 1;
  }

  let mejor: { inicio: number; fin: number; energia: number } | null = null;
  let inicioActual = -1;
  for (let i = 0; i <= dentro.length; i += 1) {
    const activo = i < dentro.length && dentro[i];
    if (activo && inicioActual < 0) inicioActual = i;
    if (!activo && inicioActual >= 0) {
      const fin = i - 1;
      let energia = 0;
      for (let j = inicioActual; j <= fin; j += 1) energia += perfil[j] ?? 0;
      if (!mejor || energia > mejor.energia) mejor = { inicio: inicioActual, fin, energia };
      inicioActual = -1;
    }
  }
  return mejor ? { inicio: mejor.inicio, fin: mejor.fin } : null;
}
