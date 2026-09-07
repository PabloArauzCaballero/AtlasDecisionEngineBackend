import { reconcileSecondReading } from '../src/modules/workers/identity-verification/core/engine/second-reader';
import type { ExtractedIdentityData } from '../src/modules/workers/identity-verification/core/domain/extracted-identity.types';

/**
 * La reconciliación del segundo lector: **el modelo propone, la aritmética
 * decide**.
 *
 * Estas pruebas no tocan la red ni un modelo. Lo que fijan es la única razón por
 * la que es seguro enchufar un modelo aquí: que nada de lo que proponga pueda
 * aprobar un caso por sí solo, y que cuando la MRZ lo corrobora deje de ser una
 * propuesta. Si alguien afloja una de las dos, un dígito inventado con prosa
 * segura se convierte en la identidad de una persona.
 */

const MRZ_VALIDA = [
  'IDBOL1234567<<4<<<<<<<<<<<<<<<',
  '0304052F2811017B0L<<<<<<<<<<<0',
  'RODRIGUEZ<GONZALEZ<<MARIA<RENE',
].join('\n');

const SIN_MRZ = 'CEDULA DE IDENTIDAD\nNOMBRES\nMARIA RENEE';

const VACIO: ExtractedIdentityData = {};

describe('reconcileSecondReading', () => {
  it('un número corroborado por el dígito de control de la MRZ deja de ser una propuesta', () => {
    const salida = reconcileSecondReading(VACIO, { documentNumber: '1234567' }, MRZ_VALIDA);

    expect(salida.fields.documentNumber?.value).toBe('1234567');
    // `MRZ` y no `MODEL`: el dato llegó por dos caminos independientes y uno
    // lleva dígito de control. Esto sí puede sostener una aprobación.
    expect(salida.fields.documentNumber?.source).toBe('MRZ');
    expect(salida.riskFlags).toHaveLength(0);
  });

  it('un número que la MRZ desmiente se descarta entero, no se elige uno de los dos', () => {
    const salida = reconcileSecondReading(VACIO, { documentNumber: '7654321' }, MRZ_VALIDA);

    expect(salida.fields.documentNumber).toBeUndefined();
    expect(salida.riskFlags).toContain('SECOND_READER_MRZ_MISMATCH');
  });

  it('sin MRZ que lo corrobore, el número entra marcado y avisando', () => {
    const salida = reconcileSecondReading(VACIO, { documentNumber: '1234567' }, SIN_MRZ);

    expect(salida.fields.documentNumber?.value).toBe('1234567');
    expect(salida.fields.documentNumber?.source).toBe('MODEL');
    // Ésta es la marca que impide que rellenar un hueco apruebe un caso.
    expect(salida.riskFlags).toContain('FIELD_PROPOSED_BY_MODEL');
  });

  it('nunca pisa un campo que el analizador ya leyó', () => {
    const leido: ExtractedIdentityData = {
      documentNumber: { value: '1234567', confidence: 0.9, source: 'OCR' },
    };
    const salida = reconcileSecondReading(leido, { documentNumber: '9999999' }, SIN_MRZ);

    expect(salida.fields.documentNumber?.value).toBe('1234567');
    expect(salida.fields.documentNumber?.source).toBe('OCR');
    expect(salida.riskFlags).toContain('SECOND_READER_DISAGREEMENT');
  });

  it('dos lectores que coinciden no generan aviso', () => {
    const leido: ExtractedIdentityData = {
      lastNames: { value: 'RODRIGUEZ GONZALEZ', confidence: 0.8, source: 'OCR' },
    };
    const salida = reconcileSecondReading(leido, { lastNames: 'Rodríguez González' }, SIN_MRZ);

    // Acentos y separadores no son un desacuerdo: el OCR no los ve y el modelo sí.
    expect(salida.riskFlags).toHaveLength(0);
  });

  it('acepta INDEFINIDO como caducidad, que es lo que llevan las cédulas que no caducan', () => {
    const salida = reconcileSecondReading(VACIO, { expirationDate: 'indefinido' }, SIN_MRZ);
    expect(salida.fields.expirationDate?.value).toBe('INDEFINIDO');
  });

  it('descarta una fecha que no viene en ISO en vez de intentar entenderla', () => {
    const salida = reconcileSecondReading(VACIO, { dateOfBirth: '05 de marzo de 1983' }, SIN_MRZ);
    expect(salida.fields.dateOfBirth).toBeUndefined();
  });

  it('descarta un número con forma imposible', () => {
    const salida = reconcileSecondReading(VACIO, { documentNumber: 'NO_LEGIBLE' }, SIN_MRZ);
    expect(salida.fields.documentNumber).toBeUndefined();
  });
});
