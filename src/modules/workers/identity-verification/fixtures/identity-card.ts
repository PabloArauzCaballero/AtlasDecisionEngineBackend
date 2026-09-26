import sharp, { type OverlayOptions } from 'sharp';
import { retrato } from './identity-faces';

/**
 * Dibuja una cédula sintética **con texto de verdad**, en el formato VIGENTE.
 *
 * El diseño sigue el de la cédula boliviana actual: campos ROTULADOS en el
 * anverso (`NOMBRES`, `APELLIDOS`, `FECHA DE NACIMIENTO`, `FECHA DE
 * EXPIRACION`, `N°`, `SERIE`, `SECCION`) y, en el reverso, la zona de lectura
 * mecánica. La primera versión copiaba el formato ANTERIOR —`A: <nombre>`,
 * `Nacido el`, `Válida hasta el`—, que el analizador absorbido entiende pero que
 * ya casi nadie lleva encima: los escenarios probaban un documento que hoy no se
 * presenta.
 *
 * No se parece a una cédula real y no debe parecerse: no lleva holograma, ni
 * fondo de seguridad, ni escudo. Lo que ejercita es el camino —OCR,
 * clasificación, rótulos, fechas y MRZ—, no el diseño del documento.
 */

/**
 * Los datos de la tarjeta.
 *
 * Las fechas van dos veces —en letra para el anverso, en ISO para la MRZ—
 * porque el documento real también las lleva dos veces y en dos formatos: es lo
 * que permite que el contraste entre lo impreso y la zona mecánica signifique
 * algo.
 */
export interface CedulaSintetica {
  readonly numero: string;
  readonly serie: string;
  readonly seccion: string;
  readonly nombres: string;
  readonly apellidos: string;
  readonly nacimiento: string;
  readonly nacimientoIso: string;
  readonly emision: string;
  readonly expiracion: string;
  readonly expiracionIso: string;
  readonly sexo: 'M' | 'F';
  readonly lugarNacimiento: string;
  readonly domicilio: string;
  readonly profesion: string;
  readonly estadoCivil: string;
  readonly grupoSanguineo: string;
  /** Cuando es cierto, el número y el nombre salen ilegibles a propósito. */
  readonly ilegible?: boolean;
  /**
   * Qué persona de la población sintética lleva el retrato.
   *
   * Es lo que hace real la comparación: la biometría ya no responde a una pista
   * de escenario, así que si el documento no trae una CARA no hay nada que
   * comparar. Cambiar esta semilla cambia de titular, y ése es el mecanismo con
   * el que un escenario aprueba y otro rechaza.
   */
  readonly rostro: number;
  /**
   * La tarjeta sale SIN retrato utilizable: el recuadro va vacío.
   *
   * Es una fotocopia, o una foto en la que el retrato se perdió. Aquí se
   * intentó primero degradarlo —pixelarlo, quemarlo, dejar sólo la foto
   * fantasma— para provocar un «no se pudo comparar», y NO se consigue: en
   * cuanto el detector encuentra el rostro, el descriptor devuelve rasgos
   * igualmente. Medido: pixelado a 64 px ya no se detecta nada, y quemado a
   * ×3,4 seguía comparando a 0,79. Así que ese escenario no era alcanzable y
   * anunciarlo habría sido volver a prometer algo que el motor no hace.
   *
   * Lo que sí ocurre de verdad, y es lo que este caso enseña, es que un
   * documento sin retrato se RECHAZA antes de comparar: el motor no se inventa
   * una comparación que no puede hacer.
   */
  readonly sinRetrato?: boolean;
}

/** Tamaño generoso: el OCR pierde precisión con letra pequeña remuestreada. */
const ANCHO = 1400;
const ALTO = 900;

/**
 * A cuánto se dibuja de verdad la tarjeta, sobre el sistema de coordenadas de
 * arriba.
 *
 * El normalizador del pipeline lleva toda imagen a 1800 px de lado largo, así
 * que una tarjeta dibujada a 1400 se AMPLÍA, y ampliar no añade detalle:
 * inventa píxeles. El retrato impreso llegaba al comparador con 290 px de
 * origen estirados a 373, y el parecido del escenario limpio quedaba a trece
 * diezmilésimas del umbral de aprobación —medido en el contenedor, 0,8837
 * contra 0,8824—. Un margen así no es un producto: basta otra versión de la
 * librería de imagen para que la demo cambie de veredicto.
 *
 * Dibujándola ya a 1800 el retrato tiene 373 px REALES. Y es además lo
 * realista: la foto de una cédula con un móvil actual trae muchísimo más
 * detalle del que tenía este escenario.
 *
 * Se aplica con `viewBox`, así que las coordenadas del dibujo siguen siendo las
 * mismas y no hay que reescribir el diseño entero.
 */
const ESCALA = 1800 / ANCHO;

/**
 * Resolución de origen de TODO rostro sintético de este archivo, tanto el
 * impreso en la tarjeta como el de la selfie. Ver `retratosDe`: si difieren, el
 * grano de cada uno cae a una escala distinta y el comparador lo mide como si
 * fuera una diferencia de la cara.
 */
const ORIGEN_RETRATO = 900;

const escalar = (valor: number): number => Math.round(valor * ESCALA);

export async function renderCedula(datos: CedulaSintetica): Promise<Buffer> {
  const numero = datos.ilegible ? '####### ##' : `N° ${datos.numero}`;
  const nombres = datos.ilegible ? '·········' : datos.nombres;
  const apellidos = datos.ilegible ? '·········· ·········' : datos.apellidos;

  /*
   * `font-family` explícito y no el de omisión: sharp compone el SVG con
   * fontconfig, y en una imagen sin fuentes el texto se dibuja VACÍO —la
   * tarjeta sale en blanco y el escenario falla por «no se pudo leer», que
   * parece un fallo del lector—. Las imágenes de este repositorio instalan
   * DejaVu justamente para esto (ver Dockerfile).
   */
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${escalar(ANCHO)}" height="${escalar(ALTO)}" viewBox="0 0 ${ANCHO} ${ALTO}">
  <rect width="${ANCHO}" height="${ALTO}" fill="#eef2ee"/>
  <rect x="20" y="20" width="${ANCHO - 40}" height="${ALTO - 40}" fill="#ffffff" stroke="#2f6b3f" stroke-width="4"/>
  <g font-family="DejaVu Sans, sans-serif" fill="#111111">
    <text x="60" y="92" font-size="34" fill="#2f6b3f">ESTADO PLURINACIONAL DE BOLIVIA</text>
    <text x="${ANCHO - 60}" y="92" font-size="34" fill="#2f6b3f" text-anchor="end">CEDULA DE IDENTIDAD</text>
    <text x="60" y="136" font-size="26" fill="#555555">SERVICIO GENERAL DE IDENTIFICACION PERSONAL</text>

    <text x="60" y="205" font-size="22" fill="#666666">SERIE</text>
    <text x="60" y="243" font-size="34">${escapar(datos.serie)}</text>
    <text x="330" y="205" font-size="22" fill="#666666">SECCION</text>
    <text x="330" y="243" font-size="34">${escapar(datos.seccion)}</text>

    <text x="60" y="315" font-size="22" fill="#666666">NOMBRES</text>
    <text x="60" y="357" font-size="40">${escapar(nombres)}</text>
    <text x="60" y="425" font-size="22" fill="#666666">APELLIDOS</text>
    <text x="60" y="467" font-size="40">${escapar(apellidos)}</text>

    <text x="60" y="537" font-size="22" fill="#666666">FECHA DE NACIMIENTO</text>
    <text x="60" y="579" font-size="36">${escapar(datos.nacimiento)}</text>

    <text x="60" y="649" font-size="22" fill="#666666">FECHA DE EMISION</text>
    <text x="60" y="691" font-size="34">${escapar(datos.emision)}</text>
    <text x="470" y="649" font-size="22" fill="#666666">FECHA DE EXPIRACION</text>
    <text x="470" y="691" font-size="34">${escapar(datos.expiracion)}</text>

    <text x="60" y="790" font-size="46" fill="#1d5b8f">${escapar(numero)}</text>
    <text x="${ANCHO - 60}" y="${ALTO - 40}" font-size="24" fill="#888888" text-anchor="end">DOCUMENTO SINTETICO - SOLO PARA PRUEBAS</text>
  </g>
  <rect x="${RETRATO.x}" y="${RETRATO.y}" width="${RETRATO.w}" height="${RETRATO.h}" fill="#d8dcd6" stroke="#2f6b3f" stroke-width="3"/>
  <rect x="${FANTASMA.x}" y="${FANTASMA.y}" width="${FANTASMA.w}" height="${FANTASMA.h}" fill="#e6eae4"/>
</svg>`;

  return sharp(Buffer.from(svg))
    .composite(await retratosDe(datos))
    .png()
    .toBuffer();
}

/** Dónde va el retrato del titular y dónde la foto fantasma, en píxeles. */
const RETRATO = { x: ANCHO - 380, y: 180, w: 290, h: 360 };
const FANTASMA = { x: ANCHO - 380, y: 580, w: 116, h: 144 };

/**
 * El retrato del titular y su copia pequeña.
 *
 * La cédula boliviana vigente lleva las dos, y ponerlas aquí no es decorado: es
 * lo que hace que los escenarios ejerciten la regla que descarta un segundo
 * rostro por tamaño. Sin la fantasma, esa regla no la probaría nada, y con ella
 * mal dimensionada cada cédula auténtica se iría a revisión manual por
 * «MULTIPLE_FACES» — que fue justamente el riesgo que obligó a escribirla.
 */
async function retratosDe(datos: CedulaSintetica): Promise<OverlayOptions[]> {
  // Sin retrato no se compone nada: el recuadro gris del SVG queda a la vista, y
  // es exactamente lo que se ve en una fotocopia de una cédula.
  if (datos.sinRetrato) return [];

  /*
   * El retrato se genera a la MISMA resolución de origen que la selfie.
   *
   * No es un detalle: el grano que da textura a estos rostros se dibuja píxel a
   * píxel sobre el lienzo de origen, así que generarlos a tamaños distintos les
   * da granos de escalas distintas, y el descriptor mide esa diferencia como si
   * fuera de la cara. Medido sobre el mismo par: origen 512 → 0,8958; 720 →
   * 0,8718; 900 → 0,9044; 1024 → 0,8626. Ese vaivén no dice nada sobre el
   * parecido de dos personas —dos fotos de la misma cámara comparten su ruido—,
   * así que igualarlo quita un artefacto en vez de maquillar un resultado.
   *
   * Se compone al tamaño YA ESCALADO del lienzo: los recuadros del SVG van en
   * coordenadas de diseño, pero un `composite` se pega en píxeles reales.
   */
  const original = await retrato(datos.rostro, 0, ORIGEN_RETRATO);
  return [
    {
      input: await sharp(original)
        .resize(escalar(RETRATO.w), escalar(RETRATO.h), { fit: 'cover' })
        .png()
        .toBuffer(),
      left: escalar(RETRATO.x),
      top: escalar(RETRATO.y),
    },
    {
      input: await sharp(original)
        .resize(escalar(FANTASMA.w), escalar(FANTASMA.h), { fit: 'cover' })
        .modulate({ brightness: 1.25, saturation: 0.35 })
        .png()
        .toBuffer(),
      left: escalar(FANTASMA.x),
      top: escalar(FANTASMA.y),
    },
  ];
}

/**
 * El REVERSO del formato vigente, con su zona de lectura mecánica.
 *
 * La MRZ es lo que hace útil a este reverso: es la única parte del documento
 * que trae dígitos de control, y por tanto la única fuente sobre la que el
 * motor puede decir «lo leí bien» en vez de «lo leí». Se compone con los mismos
 * datos que el anverso para que el contraste entre caras signifique algo.
 */
export async function renderCedulaReverso(datos: CedulaSintetica): Promise<Buffer> {
  const mrz = construirMrzTd1(datos);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${escalar(ANCHO)}" height="${escalar(ALTO)}" viewBox="0 0 ${ANCHO} ${ALTO}">
  <rect width="${ANCHO}" height="${ALTO}" fill="#eef2ee"/>
  <rect x="20" y="20" width="${ANCHO - 40}" height="${ALTO - 40}" fill="#ffffff" stroke="#2f6b3f" stroke-width="4"/>
  <g font-family="DejaVu Sans, sans-serif" fill="#111111">
    <text x="60" y="100" font-size="22" fill="#666666">LUGAR DE NACIMIENTO</text>
    <text x="60" y="142" font-size="32">${escapar(datos.lugarNacimiento)}</text>
    <text x="60" y="212" font-size="22" fill="#666666">DOMICILIO</text>
    <text x="60" y="254" font-size="32">${escapar(datos.domicilio)}</text>
    <text x="60" y="324" font-size="22" fill="#666666">PROFESION</text>
    <text x="60" y="366" font-size="32">${escapar(datos.profesion)}</text>
    <text x="60" y="436" font-size="22" fill="#666666">ESTADO CIVIL</text>
    <text x="60" y="478" font-size="32">${escapar(datos.estadoCivil)}</text>
    <text x="620" y="436" font-size="22" fill="#666666">GRUPO SANGUINEO</text>
    <text x="620" y="478" font-size="32">${escapar(datos.grupoSanguineo)}</text>
  </g>
  <!-- La MRZ va en monoespaciada: el reconocedor la lee como una rejilla de
       posiciones fijas, y una proporcional desplaza los campos. -->
  <g font-family="DejaVu Sans Mono, monospace" font-size="40" fill="#111111">
    <text x="60" y="${ALTO - 190}">${escapar(mrz[0] ?? '')}</text>
    <text x="60" y="${ALTO - 130}">${escapar(mrz[1] ?? '')}</text>
    <text x="60" y="${ALTO - 70}">${escapar(mrz[2] ?? '')}</text>
  </g>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * La misma cédula, fotografiada SOBRE UN ESCRITORIO.
 *
 * Es el escenario que ejercita el recorte del fondo: la tarjeta ocupa poco más
 * de un tercio del encuadre y el resto es mesa. Sin recortar, el reconocedor
 * trabaja sobre una imagen en la que el documento es minoría; recortando, sobre
 * la tarjeta.
 *
 * El fondo es de un tono uniforme a propósito: es lo que `trim` sabe reconocer
 * como borde. Un escritorio con textura no se recorta —y no pasa nada, porque
 * el pipeline lee igual la imagen entera—.
 */
export async function renderCedulaSobreEscritorio(datos: CedulaSintetica): Promise<Buffer> {
  const tarjeta = await renderCedula(datos);
  // En píxeles del lienzo YA escalado, no en coordenadas de diseño: la tarjeta
  // que se pega encima mide `escalar(ANCHO)`, y con el margen sin escalar la
  // proporción entre documento y mesa cambiaba al subir la resolución.
  const MARGEN = escalar(420);
  return sharp({
    create: {
      width: escalar(ANCHO) + MARGEN * 2,
      height: escalar(ALTO) + MARGEN * 2,
      channels: 3,
      background: { r: 96, g: 78, b: 62 },
    },
  })
    .composite([{ input: tarjeta, top: MARGEN, left: MARGEN }])
    .png()
    .toBuffer();
}

/** Gris plano: pasa el filtro de formato y falla el de calidad, a propósito. */
export async function renderPlano(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } },
  })
    .png()
    .toBuffer();
}

/**
 * Una foto que NO es un documento: formas grandes y lisas, sin una sola letra.
 *
 * La primera versión usaba ruido pseudoaleatorio y Tesseract le sacaba 640
 * caracteres de basura: el rechazo salía igual, pero por la rama equivocada
 * («tiene texto y no es un documento») y el escenario dejaba de parecerse a lo
 * que dice ser. Un cielo, un horizonte y dos colinas no tienen nada que un
 * reconocedor pueda confundir con una letra, y siguen dando contraste y bordes
 * de sobra para pasar la medida de calidad — que es lo que hace útil a este
 * escenario: se rechaza por no ser un documento, no por ser mala foto.
 */
export async function renderPaisaje(seed: string): Promise<Buffer> {
  const width = 1200;
  const height = 800;
  const tono = hashSeed(seed) % 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="cielo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgb(${60 + tono},${130 + tono},${210 - tono})"/>
      <stop offset="100%" stop-color="rgb(${190 - tono},${220 - tono},${240 - tono})"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#cielo)"/>
  <circle cx="${260 + tono * 4}" cy="170" r="86" fill="rgb(252,236,150)"/>
  <path d="M0 560 L340 330 L640 560 Z" fill="rgb(${70 + tono},${104 + tono},${68 + tono})"/>
  <path d="M420 560 L820 300 L1200 560 Z" fill="rgb(${52 + tono},${86 + tono},${54 + tono})"/>
  <rect y="560" width="${width}" height="${height - 560}" fill="rgb(${44 + tono},${72 + tono},${40 + tono})"/>
  <rect y="640" width="${width}" height="26" fill="rgb(${96 + tono},${74 + tono},${48 + tono})"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * La selfie: OTRA TOMA de una persona de la población, no ruido.
 *
 * Antes esto devolvía píxeles aleatorios, y podía permitírselo porque el
 * comparador simulado no miraba las imágenes. Con biometría real, una selfie sin
 * cara no produce «no se parece»: produce un error de captura, y los escenarios
 * no llegarían nunca a la comparación que pretenden enseñar.
 *
 * La variante es siempre distinta de cero: documento y selfie tienen que ser dos
 * tomas de la misma cara, no el mismo archivo dos veces.
 */
export async function renderSelfie(rostro: number, variante = 1): Promise<Buffer> {
  return sharp(await retrato(rostro, variante, ORIGEN_RETRATO))
    .resize(720, 720, { fit: 'cover' })
    .png()
    .toBuffer();
}

/**
 * Arma una MRZ TD1 válida —con sus dígitos de control— a partir de los datos.
 *
 * Se calculan de verdad y no se escriben a mano: el analizador los comprueba, y
 * una MRZ inventada haría que el escenario probara la rama del fallo creyendo
 * probar la del acierto.
 */
function construirMrzTd1(datos: CedulaSintetica): string[] {
  const relleno = (texto: string, largo: number) => texto.padEnd(largo, '<').slice(0, largo);
  const aammdd = (iso: string) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);

  const numero = relleno(datos.numero, 9);
  const nacimiento = aammdd(datos.nacimientoIso);
  const caducidad = aammdd(datos.expiracionIso);

  const l1 = relleno(`IDBOL${numero}${control(numero)}`, 30);
  const cuerpo2 =
    nacimiento + control(nacimiento) + datos.sexo + caducidad + control(caducidad) + 'BOL';
  const l2sinControl = relleno(cuerpo2, 29);
  const compuesto = control(
    l1.slice(5, 30) +
      l2sinControl.slice(0, 7) +
      l2sinControl.slice(8, 15) +
      l2sinControl.slice(18, 29),
  );
  const l2 = l2sinControl + compuesto;
  const l3 = relleno(
    `${datos.apellidos.replace(/\s+/g, '<')}<<${datos.nombres.replace(/\s+/g, '<')}`,
    30,
  );
  return [l1, l2, l3];
}

/** Dígito de control de ICAO 9303: pesos 7-3-1, letras 10..35, relleno cero. */
function control(valor: string): string {
  const pesos = [7, 3, 1];
  let suma = 0;
  for (let i = 0; i < valor.length; i += 1) {
    const caracter = valor[i] ?? '<';
    let peso = 0;
    if (caracter >= '0' && caracter <= '9') peso = caracter.charCodeAt(0) - 48;
    else if (caracter >= 'A' && caracter <= 'Z') peso = caracter.charCodeAt(0) - 55;
    suma += peso * (pesos[i % 3] ?? 1);
  }
  return String(suma % 10);
}

function escapar(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hashSeed(seed: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash;
}
