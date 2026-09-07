/**
 * El ENCUADRE del documento y las comprobaciones de vida de la SELFIE.
 *
 * Las dos piezas nacieron del mismo día de medición —cinco cédulas bolivianas
 * auténticas, anverso y reverso— y las dos cierran un fallo que la batería
 * anterior no podía ver, porque toda ella corre sobre los ejemplares que el
 * propio código dibuja: una tarjeta sintética ya viene encuadrada y una selfie
 * sintética no se puede confundir con un carnet.
 *
 * Aquí no hay ninguna imagen de un documento real. Las escenas se construyen con
 * `sharp` a partir de rectángulos de color, que es todo lo que estas dos piezas
 * miran: el encuadre busca la región que no es el fondo, y la prueba de vida
 * compara dos imágenes entre sí.
 */

import sharp from 'sharp';
import { detectarCajaDelDocumento } from '../src/modules/workers/identity-verification/core/adapters/document-framing';
import {
  analizarVidaDeLaSelfie,
  SENALES_DE_VIDA,
} from '../src/modules/workers/identity-verification/core/forensics/selfie-liveness';

const LIMITE_PIXELES = 25_000_000;

/**
 * Una escena: un rectángulo con TEXTURA sobre un fondo, opcionalmente con
 * cuadrícula.
 *
 * La textura del rectángulo no es un detalle: el detector no busca color sino
 * DENSIDAD de píxeles que no son fondo, precisamente para que una hoja
 * cuadriculada —que tiene bordes por todas partes pero muy repartidos— no se
 * haga pasar por documento. Un rectángulo de color liso no es una tarjeta para
 * este detector, y no debe serlo.
 */
async function escena(opciones: {
  ancho: number;
  alto: number;
  fondo: { r: number; g: number; b: number };
  tarjeta: { left: number; top: number; width: number; height: number } | null;
  cuadricula?: boolean;
}): Promise<Buffer> {
  const { ancho, alto, fondo, tarjeta, cuadricula } = opciones;
  const pixeles = Buffer.alloc(ancho * alto * 3);
  for (let y = 0; y < alto; y += 1) {
    for (let x = 0; x < ancho; x += 1) {
      const i = (y * ancho + x) * 3;
      pixeles[i] = fondo.r;
      pixeles[i + 1] = fondo.g;
      pixeles[i + 2] = fondo.b;
      // La cuadrícula: líneas finas y separadas. Muchos bordes, poca densidad.
      if (cuadricula && (x % 24 === 0 || y % 24 === 0)) {
        pixeles[i] = 150;
        pixeles[i + 1] = 160;
        pixeles[i + 2] = 200;
      }
      if (
        tarjeta &&
        x >= tarjeta.left &&
        x < tarjeta.left + tarjeta.width &&
        y >= tarjeta.top &&
        y < tarjeta.top + tarjeta.height
      ) {
        // Textura densa, como la de una tarjeta impresa: la mitad de los
        // píxeles se apartan del fondo, no uno de cada veinticuatro.
        const oscuro = (x + y) % 2 === 0;
        pixeles[i] = oscuro ? 40 : 230;
        pixeles[i + 1] = oscuro ? 45 : 225;
        pixeles[i + 2] = oscuro ? 50 : 215;
      }
    }
  }
  return sharp(pixeles, { raw: { width: ancho, height: alto, channels: 3 } }).png().toBuffer();
}

describe('encuadre del documento', () => {
  /*
   * El caso que motivó todo esto: una cédula que ocupa el 40 % de un encuadre
   * vertical sobre papel CUADRICULADO. `sharp.trim()` no recortaba nada —el
   * fondo no es uniforme— así que el reconocedor leía la hoja entera y la
   * clasificación salía `UNKNOWN`: la verificación se rechazaba sobre una cédula
   * perfectamente legible.
   */
  it('encuentra la tarjeta sobre papel cuadriculado', async () => {
    const imagen = await escena({
      ancho: 480,
      alto: 640,
      fondo: { r: 235, g: 235, b: 240 },
      cuadricula: true,
      tarjeta: { left: 20, top: 200, width: 440, height: 280 },
    });
    const caja = await detectarCajaDelDocumento(imagen, LIMITE_PIXELES);
    expect(caja).not.toBeNull();
    // El margen que se añade puede sacar la caja unos píxeles por fuera de la
    // tarjeta; lo que se comprueba es que la contiene y que no se lleva la hoja.
    expect(caja!.top).toBeLessThanOrEqual(200);
    expect(caja!.top + caja!.height).toBeGreaterThanOrEqual(480);
    expect(caja!.height).toBeLessThan(640 * 0.75);
  });

  /*
   * Y el fallo inverso, que llegó a producirse: cuando el documento YA llena el
   * encuadre, el color «del fondo» sale de la propia tarjeta, sólo su texto
   * cuenta como no-fondo y el perfil devuelve un trozo arbitrario del interior.
   * Medido sobre una cédula real, eso recortaba a la mitad del área y la
   * cobertura del catálogo caía a cero: el documento dejaba de reconocerse.
   */
  it('no recorta nada cuando el documento ya llena el encuadre', async () => {
    const imagen = await escena({
      ancho: 600,
      alto: 380,
      fondo: { r: 235, g: 232, b: 225 },
      tarjeta: { left: 8, top: 8, width: 584, height: 364 },
    });
    expect(await detectarCajaDelDocumento(imagen, LIMITE_PIXELES)).toBeNull();
  });

  /*
   * Una región con forma de columna no es una tarjeta ID-1 (85,6 × 54 mm,
   * proporción 1,585). Recortar por ella perdería el número de la cédula, que es
   * el fallo caro de este detector.
   */
  it('descarta un recorte cuya proporción no es la de una tarjeta', async () => {
    const imagen = await escena({
      ancho: 480,
      alto: 640,
      fondo: { r: 30, g: 30, b: 35 },
      tarjeta: { left: 200, top: 40, width: 70, height: 560 },
    });
    expect(await detectarCajaDelDocumento(imagen, LIMITE_PIXELES)).toBeNull();
  });
});

describe('prueba de vida de la selfie', () => {
  const rojo = { r: 200, g: 60, b: 60 };

  const imagenPlana = (ancho: number, alto: number, color: typeof rojo): Promise<Buffer> =>
    sharp({ create: { width: ancho, height: alto, channels: 3, background: color } })
      .jpeg()
      .toBuffer();

  /*
   * EL ATAQUE QUE ESTO CIERRA, y el motivo de que exista el archivo entero.
   *
   * Subir como selfie la misma foto del carnet no fallaba contra la comparación
   * biométrica: GANABA. Dos recortes del mismo retrato son el parecido perfecto,
   * o sea la puntuación más alta que el worker puede dar, y el antispoof no lo
   * tapa porque el retrato de un carnet es una fotografía de estudio de una
   * cara, no una pantalla.
   */
  it('detecta que la selfie es la misma imagen que el documento', async () => {
    const imagen = await imagenPlana(200, 200, rojo);
    const analisis = await analizarVidaDeLaSelfie({
      selfie: imagen,
      documento: imagen,
      parecido: 1,
      entradaGenerada: false,
    });
    expect(analisis.selfieEsElDocumento).toBe(true);
    expect(analisis.senales).toContain(SENALES_DE_VIDA.selfieEsElDocumento);
  });

  /*
   * El atacante que recorta el retrato del carnet, o que vuelve a fotografiar la
   * pantalla donde lo tiene abierto: los archivos son distintos y el contenido
   * es el mismo. El único que lo ve es el descriptor biométrico, diciendo lo
   * contrario de lo que parece — un par legítimo documento↔selfie mide entre
   * 0,66 y 0,92 en este repositorio, porque el retrato va tras el plastificado.
   */
  it('marca un parecido tan alto que no puede venir de dos capturas', async () => {
    const analisis = await analizarVidaDeLaSelfie({
      selfie: await imagenPlana(200, 200, rojo),
      documento: await imagenPlana(200, 200, { r: 60, g: 90, b: 200 }),
      parecido: 0.994,
      entradaGenerada: false,
    });
    expect(analisis.selfieEsElDocumento).toBe(false);
    expect(analisis.senales).toContain(SENALES_DE_VIDA.parecidoImposible);
  });

  /*
   * Y el techo natural de un par legítimo queda muy por debajo del umbral. Sin
   * esta comprobación, la verificación mejor puntuada del sistema sería la que
   * hay que rechazar.
   */
  it('no marca un parecido alto pero posible', async () => {
    const analisis = await analizarVidaDeLaSelfie({
      selfie: await imagenPlana(200, 200, rojo),
      documento: await imagenPlana(200, 200, { r: 60, g: 90, b: 200 }),
      parecido: 0.92,
      entradaGenerada: false,
    });
    expect(analisis.senales).not.toContain(SENALES_DE_VIDA.parecidoImposible);
  });

  /*
   * Una entrada fabricada por el motor no tiene sensor detrás, así que las
   * medidas de píxeles no significan nada sobre ella. Es la misma regla que ya
   * gobierna la prueba de vida: se declara NO EJECUTADA en vez de fingir que se
   * superó.
   */
  it('no mide nada sobre una entrada generada por el motor', async () => {
    const imagen = await imagenPlana(200, 200, rojo);
    const analisis = await analizarVidaDeLaSelfie({
      selfie: imagen,
      documento: imagen,
      parecido: 1,
      entradaGenerada: true,
    });
    expect(analisis.senales).toEqual([]);
    expect(analisis.selfieEsElDocumento).toBe(false);
  });
});
