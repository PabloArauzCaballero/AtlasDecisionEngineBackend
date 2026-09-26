import { BoliviaCiDocumentParser } from '../src/modules/workers/identity-verification/core/parsers/bolivia-ci-document.parser';
import { IdentityDocumentType } from '../src/modules/workers/identity-verification/core/domain/identity-enums';
import type { DocumentOcrResult } from '../src/modules/workers/identity-verification/core/ports/identity.ports';

/**
 * El analizador de la cédula boliviana frente al RUIDO DEL RETRATO.
 *
 * En un documento de identidad la foto va al lado del texto, y el reconocedor
 * intenta leer también ahí: devuelve glifos sueltos —`Oo o |`, `í Y`, `pa <Q`—
 * pegados al renglón que sí tiene el dato. Se vio en dos capturas de la
 * verificación real: el nombre completo salió «MARIA RENEE Oo o | RODRIGUEZ
 * GONZALEZ» y el lugar de nacimiento «SANTA CRUZ - ANDRES IBANEZ pa <Q».
 *
 * Eso no es un dato incompleto: es un dato INVENTADO con la pinta de uno leído,
 * que en un expediente de identidad es peor que un campo vacío. Y no se puede
 * filtrar por la confianza del reconocedor —medido, esos glifos llegan con 60,
 * 83 y 94 mientras que el `N°` que precede al número llega con 28—.
 *
 * Se prueba aquí, sobre texto, y no sólo con imágenes: el ruido concreto que
 * produce Tesseract depende de su versión y de la librería de imagen, así que
 * una prueba que dependiera de él mediría el entorno. Estas líneas son las que
 * salieron de verdad de una tarjeta legible.
 */

const parser = new BoliviaCiDocumentParser();

function ocr(...lineas: string[]): DocumentOcrResult {
  return {
    rawText: lineas.join('\n'),
    lines: lineas.map((text) => ({ text, confidence: 0.9 })),
    provider: 'prueba',
  };
}

const CONTEXTO = { type: IdentityDocumentType.BOLIVIA_CI, country: 'BO' };

describe('la cédula boliviana leída con ruido del retrato al lado', () => {
  it('descarta la cola de glifos pegada al NOMBRE del formato anterior', async () => {
    const parsed = await parser.parse({
      ocr: ocr(
        'CEDULA DE IDENTIDAD',
        'No 9644444 SC',
        'A: PERSONA PRUEBA DEMO SINTETICO | o',
        'Nacido el 15 de Enero de 2000',
        'En SANTA CRUZ - ANDRES IBANEZ |',
        'Valida hasta el 26 de Enero de 2035',
      ),
      context: CONTEXTO,
    });

    expect(parsed.fields.fullName?.value).toBe('PERSONA PRUEBA DEMO SINTETICO');
    // Y el apellido, que sale de partir ese nombre, deja de ser «| o».
    expect(parsed.fields.lastNames?.value).toBe('DEMO SINTETICO');
    expect(parsed.fields.placeOfBirth?.value).toBe('SANTA CRUZ - ANDRES IBANEZ');
  });

  it('descarta el ruido que cae en la misma línea que un RÓTULO del formato vigente', async () => {
    /*
     * El caso del formato con etiquetas: el reconocedor devolvió `NOMBRES í Y`,
     * y quedarse con esa cola daba el nombre completo «I Y RODRIGUEZ GONZALEZ».
     * Al descartarla se lee el renglón de debajo, que es donde está el valor.
     */
    const parsed = await parser.parse({
      ocr: ocr(
        'CEDULA DE IDENTIDAD',
        'NOMBRES í Y',
        'MARIA RENEE Oo o |',
        'APELLIDOS',
        'RODRIGUEZ GONZALEZ',
        'FECHA DE NACIMIENTO',
        '05/04/2003',
        'FECHA DE EXPIRACION',
        '01/11/2028',
        'N° 1234567',
      ),
      context: CONTEXTO,
    });

    expect(parsed.fields.firstNames?.value).toBe('MARIA RENEE');
    expect(parsed.fields.lastNames?.value).toBe('RODRIGUEZ GONZALEZ');
    expect(parsed.fields.fullName?.value).toBe('MARIA RENEE RODRIGUEZ GONZALEZ');
  });

  it('no se come palabras cortas que sí son del nombre', async () => {
    /*
     * El recorte va sólo por el FINAL y sólo mientras el último trozo sea corto.
     * Un nombre castellano no termina en una palabra de dos letras, pero sí las
     * lleva en medio, y quitarlas donde quiera que aparecieran rompería nombres
     * de verdad — que es el fallo contrario y más difícil de notar.
     */
    const parsed = await parser.parse({
      ocr: ocr('CEDULA DE IDENTIDAD', 'No 1234567 SC', 'A: JOSE DE LA CRUZ ROJAS'),
      context: CONTEXTO,
    });

    expect(parsed.fields.fullName?.value).toBe('JOSE DE LA CRUZ ROJAS');
  });

  it('la NACIONALIDAD de la MRZ se publica como deducida, no como verificada', async () => {
    /*
     * Ningún dígito de control cubre ese campo: el compuesto de una TD1 abarca
     * el número, las dos fechas y sus controles, y la nacionalidad queda fuera.
     * Marcarla «MRZ» hacía que la pantalla la enseñara VERIFICADA, y se vio en
     * una captura diciendo «B0L» con un cero — un dato mal leído, presentado
     * como comprobado.
     */
    const parsed = await parser.parse({
      ocr: ocr(
        'CEDULA DE IDENTIDAD',
        'NOMBRES',
        'MARIA RENEE',
        'APELLIDOS',
        'RODRIGUEZ GONZALEZ',
        'IDBOL1234567<<4<<<<<<<<<<<<<<<',
        '0304052F2811017B0L<<<<<<<<<<<0',
        'RODRIGUEZ<GONZALEZ<<MARIA<RENE',
      ),
      context: CONTEXTO,
    });

    expect(parsed.fields.nationality?.source).toBe('DERIVED');
    expect(parsed.fields.nationality?.value).not.toBe('B0L');
  });
});
