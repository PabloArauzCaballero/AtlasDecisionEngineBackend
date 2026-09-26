/**
 * Casar un documento con un artefacto, a nivel de datos.
 *
 * La regla que se comprueba aquí es la que pidió el negocio: **lo que el
 * artefacto RESPONDE lo tiene que aceptar el documento**. Y su recíproca, que es
 * la que se olvida: que sobren campos NO es un problema, porque un artefacto
 * alimenta varios documentos y cada uno cuenta una parte.
 */
import {
  checkCompatibility,
  type ArtifactFieldView,
} from '../src/pdf-worker/domain/services/artifact-compatibility';
import type { TemplateFieldDescriptor } from '../src/pdf-worker/domain/contracts/template-contract';

const campos = (
  entries: Record<string, Partial<TemplateFieldDescriptor> & { type: string }>,
): Record<string, TemplateFieldDescriptor> =>
  Object.fromEntries(
    Object.entries(entries).map(([name, spec]) => [
      name,
      { required: false, ...spec } as TemplateFieldDescriptor,
    ]),
  );

const salida = (fields: readonly Partial<ArtifactFieldView>[]): ArtifactFieldView[] =>
  fields.map((field) => ({
    fieldCode: field.fieldCode ?? 'x',
    type: field.type ?? 'string',
    required: field.required ?? true,
    allowedValues: field.allowedValues,
  }));

function comprobar(
  templateFields: Record<string, TemplateFieldDescriptor>,
  artifactFields: ArtifactFieldView[],
) {
  return checkCompatibility({
    templateId: 'informe',
    templateVersion: '1.0.0',
    templateFields,
    artifactId: 'riesgo-credito',
    artifactVersion: '2.1.0',
    artifactFields,
  });
}

describe('Compatibilidad entre artefacto y documento', () => {
  it('acepta cuando el artefacto publica todo lo que el documento exige', () => {
    const report = comprobar(
      campos({
        customerName: { type: 'string', required: true },
        score: { type: 'number', required: true },
      }),
      salida([
        { fieldCode: 'customerName', type: 'string' },
        { fieldCode: 'score', type: 'number' },
      ]),
    );

    expect(report.compatible).toBe(true);
    expect([...report.matched].sort()).toEqual(['customerName', 'score']);
    expect(report.findings).toHaveLength(0);
  });

  it('RECHAZA si falta un campo obligatorio del documento', () => {
    const report = comprobar(
      campos({
        customerName: { type: 'string', required: true },
        score: { type: 'number', required: true },
      }),
      salida([{ fieldCode: 'customerName', type: 'string' }]),
    );

    expect(report.compatible).toBe(false);
    expect(report.findings).toEqual([
      expect.objectContaining({ field: 'score', severity: 'error' }),
    ]);
  });

  it('un campo OPCIONAL que el artefacto no publica no rompe nada', () => {
    // El documento sale sin esa sección; para eso es opcional.
    const report = comprobar(
      campos({ customerName: { type: 'string', required: true }, subtitle: { type: 'string' } }),
      salida([{ fieldCode: 'customerName', type: 'string' }]),
    );

    expect(report.compatible).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it('que SOBREN campos del artefacto no es un problema', () => {
    // Es la mitad que se olvida: exigir que el documento use toda la salida
    // obligaría a un documento por artefacto, que es justo lo contrario de lo
    // que se busca — un artefacto puede tener varios documentos.
    const report = comprobar(
      campos({ score: { type: 'number', required: true } }),
      salida([
        { fieldCode: 'score', type: 'number' },
        { fieldCode: 'debtRatio', type: 'number' },
        { fieldCode: 'internalFlag', type: 'boolean' },
      ]),
    );

    expect(report.compatible).toBe(true);
    expect([...report.unusedByTemplate].sort()).toEqual(['debtRatio', 'internalFlag']);
    expect(report.findings).toHaveLength(0);
  });

  describe('tipos', () => {
    it('un entero cabe donde se espera un número, pero no al revés', () => {
      expect(
        comprobar(
          campos({ v: { type: 'number', required: true } }),
          salida([{ fieldCode: 'v', type: 'integer' }]),
        ).compatible,
      ).toBe(true);
      expect(
        comprobar(
          campos({ v: { type: 'integer', required: true } }),
          salida([{ fieldCode: 'v', type: 'number' }]),
        ).compatible,
      ).toBe(false);
    });

    it('un tipo que el motor no pudo resolver se ADVIERTE, no se rechaza', () => {
      // El contrato de salida hereda el tipo de la variable que lo produce y no
      // siempre se puede seguir esa pista. Rechazar por eso sería castigar una
      // limitación del emisor; decir «no se comprobó» es la verdad.
      const report = comprobar(
        campos({ v: { type: 'number', required: true } }),
        salida([{ fieldCode: 'v', type: 'unknown' }]),
      );

      expect(report.compatible).toBe(true);
      expect(report.findings[0]).toEqual(
        expect.objectContaining({ severity: 'warning', found: 'unknown' }),
      );
    });

    it('rechaza un tipo que no encaja', () => {
      const report = comprobar(
        campos({ score: { type: 'number', required: true } }),
        salida([{ fieldCode: 'score', type: 'boolean' }]),
      );

      expect(report.compatible).toBe(false);
      expect(report.findings[0]).toEqual(
        expect.objectContaining({ field: 'score', expected: 'number', found: 'boolean' }),
      );
    });
  });

  it('rechaza si el artefacto puede emitir valores que el documento no admite', () => {
    // El caso real: el documento pinta tres veredictos y el artefacto tiene un
    // cuarto. Sin esta comprobación el fallo llega el día que sale ese cuarto.
    const report = comprobar(
      campos({ decision: { type: 'enum', required: true, values: ['APPROVED', 'REJECTED'] } }),
      salida([
        { fieldCode: 'decision', type: 'enum', allowedValues: ['APPROVED', 'REJECTED', 'REVIEW'] },
      ]),
    );

    expect(report.compatible).toBe(false);
    expect(report.findings[0]).toEqual(
      expect.objectContaining({ field: 'decision', found: 'REVIEW' }),
    );
  });

  it('advierte si el documento exige un campo que el artefacto puede no emitir', () => {
    const report = comprobar(
      campos({ score: { type: 'number', required: true } }),
      salida([{ fieldCode: 'score', type: 'number', required: false }]),
    );

    // Compatible, pero habrá decisiones concretas que no se puedan imprimir.
    expect(report.compatible).toBe(true);
    expect(report.findings[0]).toEqual(expect.objectContaining({ severity: 'warning' }));
  });
});
