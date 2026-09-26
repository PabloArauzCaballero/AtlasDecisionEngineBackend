import { documentSampleValue } from '../src/modules/qa-lab/document-samples';
import { generateValidValue } from '../src/modules/qa-lab/contract-generator';
import { SeededRandom } from '../src/modules/qa-lab/seeded-random';

/**
 * Los valores generados para una variable que lleva un DOCUMENTO.
 *
 * El generador razona sobre tipos, y un PDF viaja como `STRING`: sin este
 * arreglo rellenaba `extracto_pdf_base64` con letras al azar y el caso quedaba
 * inejecutable —el worker no puede leer «frocuzfzj» como PDF y la simulación
 * muere en el primer nodo sin haber probado nada de la política—.
 */
describe('valores de ejemplo para documentos', () => {
  it('entrega un PDF de verdad, no una cadena al azar', () => {
    const value = documentSampleValue('extracto_pdf_base64', 'STRING');

    expect(value).not.toBeNull();
    // `%PDF-` es la firma del formato: si esto falla, lo que se genera no es un
    // documento y el caso no se puede ejecutar.
    expect(
      Buffer.from(value as string, 'base64')
        .subarray(0, 5)
        .toString('latin1'),
    ).toBe('%PDF-');
  });

  it('el nombre de archivo acompaña al documento', () => {
    expect(documentSampleValue('extracto_nombre_archivo', 'STRING')).toMatch(/\.pdf$/);
  });

  it('no toca las variables que sólo se PARECEN a un documento', () => {
    // Un recuento de páginas es un entero, no un documento; y una cadena que no
    // nombra ni pdf ni base64 tampoco lo es.
    expect(documentSampleValue('pdf_paginas', 'INTEGER')).toBeNull();
    expect(documentSampleValue('nombre_cliente', 'STRING')).toBeNull();
  });

  it('el generador por contrato lo usa para el valor válido', () => {
    const random = new SeededRandom('semilla-fija');

    const generado = generateValidValue(
      { code: 'extracto_pdf_base64', dataType: 'STRING', required: true, nullable: false },
      random,
    );

    expect(String(generado).startsWith('JVBER')).toBe(true);
  });

  it('el resto de variables sigue generándose como antes', () => {
    const random = new SeededRandom('semilla-fija');

    const generado = generateValidValue(
      { code: 'cuota_solicitada', dataType: 'DECIMAL', required: true, nullable: false },
      random,
    );

    expect(typeof generado).toBe('number');
  });
});
