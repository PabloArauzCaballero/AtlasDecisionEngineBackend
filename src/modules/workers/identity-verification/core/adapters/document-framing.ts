import sharp from 'sharp';

/**
 * Dónde está la TARJETA dentro de la fotografía.
 *
 * ## Por qué no basta con `trim`
 *
 * El encuadre lo resolvía `sharp.trim()`, que recorta el borde uniforme a partir
 * del color de las esquinas. Sobre un fondo liso funciona; sobre lo que la gente
 * fotografía de verdad, no dispara casi nunca. Medido sobre cinco cédulas
 * bolivianas auténticas, `trim` recortó algo en dos de diez imágenes y en las
 * demás devolvió la foto entera — incluida la peor de todas: una cédula que
 * ocupa el 40 % de un encuadre vertical sobre **papel cuadriculado**. Ese fondo
 * no es uniforme (la cuadrícula tiene bordes por todas partes) así que `trim` lo
 * daba por contenido, el reconocedor leía la hoja entera, y la clasificación
 * salía `UNKNOWN`: la verificación **se rechazaba entera** sobre una cédula
 * legible.
 *
 * ## Qué mide esto en su lugar
 *
 * Que una tarjeta de identidad es un objeto de COLOR distinto del sitio donde se
 * la apoya. No busca bordes —la cuadrícula tiene más bordes que la cédula— sino
 * PERTENENCIA AL FONDO: se estima el color del fondo con la mediana de las
 * cuatro franjas del borde de la foto, se marca cada píxel que se aparta de él
 * más que una tolerancia, y la tarjeta es la región densa que queda.
 *
 * Elegir el color por la MEDIANA y no por la media es lo que hace que la
 * cuadrícula no cuente: las líneas azules son una minoría de los píxeles del
 * borde y la mediana las ignora, mientras que la media las arrastraría y
 * ensancharía la tolerancia hasta tragarse media tarjeta.
 *
 * ## Lo que NO hace
 *
 * No busca las cuatro esquinas ni corrige la perspectiva. Un recorte rectangular
 * alineado con los ejes es lo que el reconocedor necesita —trabaja por renglones
 * horizontales— y las cuatro esquinas exigirían una transformación proyectiva
 * que `sharp` no hace. Una cédula muy inclinada seguirá leyéndose peor; lo que
 * esto arregla es la cédula pequeña dentro de un encuadre grande, que es el caso
 * frecuente y el que hoy se rechaza.
 *
 * Y no decide nada: devuelve una caja o `null`. Quien la aplica es el adaptador
 * de imagen, que además impone el suelo de área, y quien se juega la lectura es
 * el pipeline, que vuelve a leer la imagen ENTERA si lo recortado no clasifica.
 */

/**
 * Lado largo al que se reduce la imagen para buscar la tarjeta.
 *
 * La pregunta —«¿qué parte de esta foto no es la mesa?»— se contesta con manchas
 * de color, no con detalle, así que pagar megapíxeles aquí sería tiempo regalado
 * en el camino caliente de cada verificación. A 320 px una cédula que ocupe la
 * décima parte del encuadre sigue midiendo cien píxeles de ancho.
 */
const LADO_ANALISIS = 320;

/**
 * Suelo de la tolerancia de color, en distancia euclídea RGB sobre 0-255.
 *
 * Es un SUELO y no el valor: la tolerancia de verdad la fija cada foto (ver
 * `toleranciaDeFondo`). Existe para que una imagen de fondo perfectamente
 * uniforme —un escaneo— no acabe con una tolerancia de cero, donde el ruido de
 * compresión de un solo píxel ya contaría como documento.
 */
const TOLERANCIA_MINIMA = 20;

/**
 * Percentil de las distancias del BORDE que marca dónde acaba el fondo.
 *
 * La tolerancia sale de la propia foto y no de una constante, y ésa es la
 * corrección que hace que esto funcione sobre papel cuadriculado. Con un umbral
 * fijo, medido sobre una cédula real fotografiada sobre cuadrícula: el 30 % de
 * los píxeles de la imagen quedaban por encima —las líneas de la cuadrícula, el
 * ruido de compresión y el sombreado de la hoja— y el perfil no separaba nada.
 * Con el percentil 85 de lo que hay EN EL BORDE, la cuadrícula queda dentro del
 * fondo por construcción: si el borde de la foto es cuadrícula, la cuadrícula es
 * fondo.
 *
 * 85 y no 95: por encima empieza a tragarse una esquina de la propia tarjeta
 * cuando el documento ya llena el encuadre, que es cuando no hay que recortar
 * nada y da igual, pero también cuando la tarjeta toca un borde, que sí importa.
 */
const PERCENTIL_DE_FONDO = 0.85;

/**
 * Lado del bloque sobre el que se mide la densidad, en píxeles de análisis.
 *
 * **Es la pieza que separa una cédula de una cuadrícula**, y no el color.
 *
 * Contando píxeles sueltos, una hoja cuadriculada y una tarjeta impresa dan la
 * misma respuesta: las dos tienen píxeles que no son el fondo. Lo que las separa
 * es cómo están REPARTIDOS. Las líneas de una cuadrícula son finas y aisladas y
 * dejan un bloque de 8×8 al 10-15 %; el texto, el retrato y el guilloché de una
 * cédula dejan el mismo bloque al 50-90 %.
 *
 * Ocho píxeles sobre un lado de análisis de 320 es la vigésima parte del lado
 * corto de una tarjeta que llene el encuadre: fino para seguir el borde y grueso
 * para que una línea de un píxel no llene el bloque.
 */
const LADO_DE_BLOQUE = 8;

/**
 * Qué parte de cada franja del borde se toma para estimar el fondo.
 *
 * Un veinteavo por lado. Más estrecho y una sombra pegada al marco decide sola;
 * más ancho y empieza a entrar la propia tarjeta cuando está bien encuadrada
 * —que es justo cuando este detector no debe recortar nada—.
 */
const FRANJA_DE_BORDE = 0.05;

/**
 * Fracción del máximo del perfil por debajo de la cual un renglón de bloques
 * —o una columna— deja de ser tarjeta.
 *
 * Dentro de la tarjeta el perfil está cerca de su máximo y fuera cae a casi
 * cero, así que el corte no es delicado: cualquier valor entre un cuarto y la
 * mitad separa las dos poblaciones. 0,35 deja margen para la fila del borde
 * redondeado, que sí es tarjeta y tiene menos densidad que el centro.
 */
const CORTE_DEL_PERFIL = 0.35;

/**
 * Proporciones admisibles del recorte, lado largo entre lado corto.
 *
 * Una tarjeta ID-1 mide 85,6 × 54 mm: proporción 1,585. El intervalo la rodea
 * con holgura para la perspectiva de una foto de móvil y para el margen que se
 * añade, y sirve para lo único que tiene que servir: si lo detectado tiene forma
 * de columna o de banda, no es una cédula y el recorte se descarta. Es barato y
 * evita el fallo caro —recortar el sitio equivocado y perder el número—.
 */
const PROPORCION_MINIMA = 1.1;
const PROPORCION_MAXIMA = 2.6;

/**
 * Margen que se deja alrededor de la caja detectada, en tanto por uno de su lado.
 *
 * La detección se queda corta por definición: el borde de la tarjeta es blanco y
 * el papel de debajo también, así que los últimos milímetros cuentan como fondo.
 * Un 2 % los devuelve, y perderlos importa: en la cédula vigente el número va
 * pegado al margen derecho y en la anterior el de control va pegado al inferior.
 */
const MARGEN = 0.02;

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
function colorDelBorde(
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
function toleranciaDeFondo(
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
function contrasteDeLaCaja(
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

function tramoDenso(perfil: number[]): { inicio: number; fin: number } | null {
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
