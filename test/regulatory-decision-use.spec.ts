import { validateDecisionUse } from '../src/modules/graph/validators/graph-decision-use.validator';
import { graphSnapshot } from './graph.fixture';
import type { ArtifactGraphSnapshot } from '../src/modules/graph/graph.types';

/**
 * Licitud de uso de los datos que alimentan una decisión.
 *
 * El catálogo clasificaba la sensibilidad de cada variable pero nada impedía que un artefacto
 * consumiera la etnia o la religión del solicitante: `sensitivityClass` responde a «cuánto hay
 * que proteger este dato», no a «puede este dato influir en el resultado». Estas pruebas fijan
 * el segundo eje, y sobre todo fijan que las dos restricciones NO se tratan igual, porque las
 * normas no dicen lo mismo.
 */
describe('Licitud de uso en decisiones automatizadas', () => {
  function snapshotWith(
    restriction: string,
    options: { legalBasis?: string | null; purpose?: string | null; usageType?: string } = {},
  ): ArtifactGraphSnapshot {
    const snapshot = graphSnapshot();
    snapshot.version.legalBasis = options.legalBasis ?? null;
    // `in` y no `??`: el caso que importa es `purpose: null` —una versión que NO la declara—,
    // y con coalescencia se lo tragaría el valor por defecto.
    snapshot.version.processingPurpose =
      'purpose' in options ? options.purpose : 'Originación de crédito al consumo';
    snapshot.variables = [
      {
        ...snapshot.variables[0],
        code: 'etnia',
        usageType: options.usageType ?? 'INPUT',
        decisionUseRestriction: restriction,
      },
    ];
    return snapshot;
  }

  const codes = (snapshot: ArtifactGraphSnapshot) =>
    validateDecisionUse(snapshot).errors.map((error) => error.code);

  describe('base prohibida (ECOA §1002.6(b)(9) / Regulation B)', () => {
    it('rechaza una entrada marcada como base prohibida', () => {
      const report = validateDecisionUse(snapshotWith('PROHIBITED_BASIS'));
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].code).toBe('PROHIBITED_BASIS_VARIABLE');
      expect(report.errors[0].entityKey).toBe('etnia');
      expect(report.errors[0].severity).toBe('ERROR');
    });

    it('la prohibición es absoluta: declarar una base legal NO la habilita', () => {
      // Es la diferencia normativa que este validador existe para respetar. La LGPD condiciona
      // el dato sensible; ECOA prohíbe la base prohibida, sin excepción por configuración.
      expect(codes(snapshotWith('PROHIBITED_BASIS', { legalBasis: 'CREDIT_PROTECTION' }))).toEqual([
        'PROHIBITED_BASIS_VARIABLE',
      ]);
    });

    it('no confunde la restricción con la sensibilidad', () => {
      // Un dato muy protegido y perfectamente utilizable: `SENSITIVE_PII` no bloquea nada por
      // sí solo, y ése era exactamente el hueco.
      const snapshot = snapshotWith('NONE');
      snapshot.variables[0].sensitivityClass = 'SENSITIVE_PII';
      expect(validateDecisionUse(snapshot).errors).toEqual([]);
    });
  });

  describe('categoría especial (LGPD art. 11)', () => {
    it('rechaza consumirla sin base legal declarada', () => {
      const report = validateDecisionUse(snapshotWith('SPECIAL_CATEGORY'));
      expect(report.errors[0].code).toBe('SPECIAL_CATEGORY_WITHOUT_LEGAL_BASIS');
    });

    it('la admite cuando la versión declara su base legal', () => {
      // El art. 11 no prohíbe el dato sensible: lo condiciona. Lo que no puede ocurrir es que
      // se use sin que nadie haya afirmado bajo qué amparo.
      expect(
        validateDecisionUse(snapshotWith('SPECIAL_CATEGORY', { legalBasis: 'HEALTH_PROTECTION' }))
          .errors,
      ).toEqual([]);
    });

    it('una base legal en blanco no cuenta como declarada', () => {
      expect(codes(snapshotWith('SPECIAL_CATEGORY', { legalBasis: '   ' }))).toEqual([
        'SPECIAL_CATEGORY_WITHOUT_LEGAL_BASIS',
      ]);
    });
  });

  describe('alcance', () => {
    it('solo mira las ENTRADAS: una salida no es un dato ajeno que se consume', () => {
      expect(
        validateDecisionUse(snapshotWith('PROHIBITED_BASIS', { usageType: 'OUTPUT' })).errors,
      ).toEqual([]);
      expect(
        validateDecisionUse(snapshotWith('PROHIBITED_BASIS', { usageType: 'OUTPUT_PRIMARY' }))
          .errors,
      ).toEqual([]);
    });

    it('sin restricción declarada no bloquea nada: el valor por defecto es permitir', () => {
      const snapshot = graphSnapshot();
      snapshot.version.processingPurpose = 'Originación';
      // Ninguna variable declara `decisionUseRestriction`, como todo el catálogo existente.
      expect(validateDecisionUse(snapshot).errors).toEqual([]);
    });

    it('acumula un error por cada variable, no se detiene en la primera', () => {
      const snapshot = snapshotWith('PROHIBITED_BASIS');
      snapshot.variables.push({
        ...snapshot.variables[0],
        code: 'religion',
        decisionUseRestriction: 'PROHIBITED_BASIS',
      });
      // Corregir de una en una obligaría al autor a publicar tantas veces como variables.
      expect(validateDecisionUse(snapshot).errors).toHaveLength(2);
    });
  });

  describe('finalidad del tratamiento (LGPD art. 6 I)', () => {
    it('advierte —no bloquea— cuando la versión no la declara', () => {
      // Hay versiones anteriores a que el campo existiera; convertirlo en error las dejaría
      // sin poder republicarse.
      const report = validateDecisionUse(snapshotWith('NONE', { purpose: null }));
      expect(report.errors).toEqual([]);
      expect(report.warnings.map((w) => w.code)).toEqual(['PROCESSING_PURPOSE_NOT_DECLARED']);
      expect(report.warnings[0].severity).toBe('WARNING');
    });

    it('con finalidad declarada no advierte', () => {
      expect(validateDecisionUse(snapshotWith('NONE')).warnings).toEqual([]);
    });
  });
});
