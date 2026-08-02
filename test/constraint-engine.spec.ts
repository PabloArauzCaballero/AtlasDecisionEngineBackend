import {
  isRequiredIn,
  parseConstraints,
  resolveConstraints,
  validateAgainstConstraints,
} from '../src/common/contracts/constraint-engine';
import {
  checkTypeShape,
  isTypeAssignable,
  normalizeDataType,
  normalizeDataTypeOrString,
} from '../src/common/contracts/data-types';

/**
 * El motor de restricciones es la única validación autoritativa del contrato (§1.2).
 * Si una restricción falla abierta aquí, un valor fuera de contrato entra al motor de
 * decisión, así que cada eje configurable queda fijado con una prueba.
 */
describe('catálogo de tipos', () => {
  it('normaliza los alias históricos al tipo canónico', () => {
    expect(normalizeDataType('NUMBER')).toBe('DECIMAL');
    expect(normalizeDataType('text')).toBe('STRING');
    expect(normalizeDataType('ARRAY')).toBe('LIST');
    expect(normalizeDataType('UUID')).toBe('IDENTIFIER');
    expect(normalizeDataType('inexistente')).toBeUndefined();
    expect(normalizeDataTypeOrString('inexistente')).toBe('STRING');
  });

  it('distingue entero de decimal y rechaza un porcentaje fuera de rango', () => {
    expect(checkTypeShape('INTEGER', 5).ok).toBe(true);
    expect(checkTypeShape('INTEGER', 5.5).ok).toBe(false);
    expect(checkTypeShape('PERCENTAGE', 42).ok).toBe(true);
    // 0.42 es la fracción mal escalada que este chequeo existe para atrapar.
    expect(checkTypeShape('PERCENTAGE', 120).ok).toBe(false);
  });

  it('valida formatos de fecha, hora y fecha-hora', () => {
    expect(checkTypeShape('DATE', '2026-07-30').ok).toBe(true);
    expect(checkTypeShape('DATE', '30/07/2026').ok).toBe(false);
    expect(checkTypeShape('TIME', '23:59').ok).toBe(true);
    expect(checkTypeShape('TIME', '25:00:00').ok).toBe(true); // el rango lo cubre una restricción
    expect(checkTypeShape('DATETIME', '2026-07-30T10:00:00Z').ok).toBe(true);
  });

  it('solo admite ampliaciones seguras de tipo entre contratos encadenados', () => {
    expect(isTypeAssignable('INTEGER', 'DECIMAL')).toBe(true);
    expect(isTypeAssignable('DECIMAL', 'INTEGER')).toBe(false);
    expect(isTypeAssignable('ENUM', 'STRING')).toBe(true);
    expect(isTypeAssignable('STRING', 'ENUM')).toBe(false);
  });
});

describe('parseConstraints', () => {
  it('acepta tanto la forma normalizada como el JSON Schema legado', () => {
    expect(parseConstraints({ minimum: 1, maximum: 9, enum: ['A'] })).toEqual({
      min: 1,
      max: 9,
      allowedValues: ['A'],
    });
    expect(parseConstraints({ min: 1, allowedValues: ['A'] })).toEqual({
      min: 1,
      allowedValues: ['A'],
    });
  });

  it('ignora valores con forma inesperada en vez de romper la validación', () => {
    expect(parseConstraints({ min: 'diez', pattern: 5 })).toEqual({});
    expect(parseConstraints(null)).toEqual({});
  });
});

describe('validateAgainstConstraints', () => {
  it('reporta todas las violaciones, no solo la primera', () => {
    const violations = validateAgainstConstraints(
      'STRING',
      { minLength: 5, pattern: '^\\d+$' },
      'ab',
    );
    expect(violations.map((entry) => entry.code).sort()).toEqual(['PATTERN_MISMATCH', 'TOO_SHORT']);
  });

  it('corta en el tipo: sin la forma correcta no compara rangos', () => {
    const violations = validateAgainstConstraints('INTEGER', { min: 10 }, 'x');
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('TYPE_MISMATCH');
  });

  it('aplica precisión y escala a los números', () => {
    expect(validateAgainstConstraints('DECIMAL', { scale: 2 }, 1.234)[0].code).toBe(
      'SCALE_EXCEEDED',
    );
    expect(validateAgainstConstraints('DECIMAL', { scale: 2 }, 1.23)).toHaveLength(0);
    expect(validateAgainstConstraints('DECIMAL', { precision: 3 }, 12345)[0].code).toBe(
      'PRECISION_EXCEEDED',
    );
  });

  it('aplica cardinalidad, unicidad y tipo de elemento en listas', () => {
    expect(validateAgainstConstraints('LIST', { maxItems: 2 }, [1, 2, 3])[0].code).toBe(
      'TOO_MANY_ITEMS',
    );
    expect(validateAgainstConstraints('LIST', { unique: true }, [1, 1])[0].code).toBe(
      'DUPLICATE_ITEMS',
    );
    expect(validateAgainstConstraints('LIST', { itemType: 'INTEGER' }, [1, 'x'])[0].code).toBe(
      'ITEM_TYPE_MISMATCH',
    );
  });

  it('valida formatos semánticos', () => {
    expect(validateAgainstConstraints('STRING', { format: 'EMAIL' }, 'no-es-correo')[0].code).toBe(
      'FORMAT_INVALID',
    );
    expect(validateAgainstConstraints('STRING', { format: 'EMAIL' }, 'a@b.com')).toHaveLength(0);
  });

  it('exige las dependencias declaradas con dependsOn', () => {
    const violations = validateAgainstConstraints('STRING', { dependsOn: ['pais'] }, 'x', {
      siblings: {},
    });
    expect(violations[0].code).toBe('DEPENDENCY_MISSING');
    expect(
      validateAgainstConstraints('STRING', { dependsOn: ['pais'] }, 'x', {
        siblings: { pais: 'BO' },
      }),
    ).toHaveLength(0);
  });
});

describe('restricciones acotadas por eje de despliegue', () => {
  const base = {
    min: 0,
    byCountry: [{ match: ['BO'], constraints: { min: 100 } }],
    byEnvironment: [{ match: ['PROD'], constraints: { max: 500 } }],
  };

  it('solo aplica el tramo que corresponde al contexto', () => {
    expect(resolveConstraints(base, { siblings: {}, country: 'PE' }).min).toBe(0);
    expect(resolveConstraints(base, { siblings: {}, country: 'BO' }).min).toBe(100);
    expect(
      resolveConstraints(base, { siblings: {}, country: 'BO', environmentCode: 'PROD' }),
    ).toMatchObject({ min: 100, max: 500 });
  });

  it('un valor válido en DEV puede ser inválido en PROD', () => {
    const scope = { siblings: {}, environmentCode: 'PROD' as const };
    expect(validateAgainstConstraints('DECIMAL', base, 900, { siblings: {} })).toHaveLength(0);
    expect(validateAgainstConstraints('DECIMAL', base, 900, scope)[0].code).toBe('ABOVE_MAXIMUM');
  });
});

describe('obligatoriedad condicional', () => {
  const constraints = {
    conditional: [
      { whenField: 'tipo', operator: 'EQUALS' as const, value: 'EMPRESA', required: true },
      {
        whenField: 'pais',
        operator: 'IN' as const,
        value: ['BO'],
        constraints: { minLength: 8 },
      },
    ],
  };

  it('vuelve obligatorio un campo opcional cuando la condición se cumple', () => {
    expect(isRequiredIn(false, constraints, { siblings: { tipo: 'PERSONA' } })).toBe(false);
    expect(isRequiredIn(false, constraints, { siblings: { tipo: 'EMPRESA' } })).toBe(true);
  });

  it('añade restricciones extra cuando la condición se cumple', () => {
    expect(
      validateAgainstConstraints('STRING', constraints, 'corto', { siblings: { pais: 'PE' } }),
    ).toHaveLength(0);
    expect(
      validateAgainstConstraints('STRING', constraints, 'corto', { siblings: { pais: 'BO' } })[0]
        .code,
    ).toBe('TOO_SHORT');
  });
});
