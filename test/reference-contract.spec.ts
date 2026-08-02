import { validateReferenceContract } from '../src/modules/nested-trees/reference-contract.validator';

/**
 * Compatibilidad de contratos al encadenar artefactos (§9.2). Cada caso corresponde a
 * una forma concreta de romper una cadena en producción: una entrada obligatoria sin
 * mapear, un tipo que no encaja, una salida que el hijo no produce.
 */
const variable = (code: string, dataType: string, required = true, nullable = false) => ({
  code,
  dataType,
  required,
  nullable,
});

const base = {
  childInputs: [variable('ingreso_mensual', 'DECIMAL'), variable('edad', 'INTEGER')],
  childOutputs: [variable('decision', 'STRING'), variable('riesgo', 'STRING', false)],
  parentContext: [variable('ingreso', 'DECIMAL'), variable('edad_solicitante', 'INTEGER')],
  inputMapping: [
    {
      childVariableCode: 'ingreso_mensual',
      source: 'VARIABLE' as const,
      path: 'variables.ingreso',
    },
    { childVariableCode: 'edad', source: 'VARIABLE' as const, path: 'edad_solicitante' },
  ],
  outputMapping: [{ childOutputCode: 'decision' }],
};

const codes = (input: Parameters<typeof validateReferenceContract>[0]) =>
  validateReferenceContract(input).map((issue) => issue.code);

describe('validación del contrato de una referencia', () => {
  it('acepta un mapeo completo y compatible', () => {
    expect(validateReferenceContract(base)).toEqual([]);
  });

  it('rechaza una entrada obligatoria del hijo sin mapear', () => {
    expect(codes({ ...base, inputMapping: [base.inputMapping[0]] })).toContain(
      'REFERENCE_REQUIRED_INPUT_UNMAPPED',
    );
  });

  it('rechaza mapear una entrada que el hijo no declara', () => {
    const inputMapping = [
      ...base.inputMapping,
      { childVariableCode: 'inexistente', source: 'LITERAL' as const, value: 1 },
    ];
    expect(codes({ ...base, inputMapping })).toContain('REFERENCE_INPUT_UNKNOWN');
  });

  it('rechaza un origen que el padre no declara', () => {
    const inputMapping = [
      {
        childVariableCode: 'ingreso_mensual',
        source: 'VARIABLE' as const,
        path: 'variables.fantasma',
      },
      base.inputMapping[1],
    ];
    expect(codes({ ...base, inputMapping })).toContain('REFERENCE_INPUT_SOURCE_MISSING');
  });

  it('rechaza tipos incompatibles entre padre e hijo', () => {
    const parentContext = [variable('ingreso', 'STRING'), variable('edad_solicitante', 'INTEGER')];
    expect(codes({ ...base, parentContext })).toContain('REFERENCE_INPUT_TYPE_MISMATCH');
  });

  it('acepta ampliar un entero a decimal, pero no al revés', () => {
    const wideningOk = {
      ...base,
      parentContext: [variable('ingreso', 'INTEGER'), variable('edad_solicitante', 'INTEGER')],
    };
    expect(codes(wideningOk)).not.toContain('REFERENCE_INPUT_TYPE_MISMATCH');

    const narrowing = {
      ...base,
      childInputs: [variable('ingreso_mensual', 'INTEGER'), variable('edad', 'INTEGER')],
    };
    expect(codes(narrowing)).toContain('REFERENCE_INPUT_TYPE_MISMATCH');
  });

  it('avisa cuando un origen opcional alimenta una entrada obligatoria', () => {
    const parentContext = [
      variable('ingreso', 'DECIMAL', false),
      variable('edad_solicitante', 'INTEGER'),
    ];
    expect(codes({ ...base, parentContext })).toContain('REFERENCE_INPUT_MAY_BE_ABSENT');
  });

  it('valida el tipo de los literales', () => {
    const inputMapping = [
      { childVariableCode: 'ingreso_mensual', source: 'LITERAL' as const, value: 'mil' },
      base.inputMapping[1],
    ];
    expect(codes({ ...base, inputMapping })).toContain('REFERENCE_INPUT_TYPE_MISMATCH');
  });

  it('rechaza un literal nulo para una entrada obligatoria', () => {
    const inputMapping = [
      { childVariableCode: 'ingreso_mensual', source: 'LITERAL' as const, value: null },
      base.inputMapping[1],
    ];
    expect(codes({ ...base, inputMapping })).toContain('REFERENCE_INPUT_LITERAL_NULL');
  });

  it('rechaza consumir una salida que el hijo no produce', () => {
    expect(codes({ ...base, outputMapping: [{ childOutputCode: 'fantasma' }] })).toContain(
      'REFERENCE_OUTPUT_UNKNOWN',
    );
  });

  it('acepta consumir las salidas implícitas del motor sin declararlas', () => {
    // Un hijo que solo fija `outcome` con una acción terminal es el caso más común:
    // el motor siempre añade outcome/score/riskBand/limit al sobre de salida.
    expect(
      codes({ ...base, childOutputs: [], outputMapping: [{ childOutputCode: 'outcome' }] }),
    ).toEqual([]);
  });

  it('rechaza una referencia que no expone ninguna salida', () => {
    expect(codes({ ...base, outputMapping: [] })).toContain('REFERENCE_OUTPUT_EMPTY');
  });

  it('detecta mapeos duplicados y ambiguos', () => {
    const duplicated = {
      ...base,
      inputMapping: [...base.inputMapping, base.inputMapping[0]],
      outputMapping: [{ childOutputCode: 'decision' }, { childOutputCode: 'decision' }],
    };
    const result = codes(duplicated);
    expect(result).toContain('REFERENCE_INPUT_MAPPED_TWICE');
    expect(result).toContain('REFERENCE_OUTPUT_MAPPED_TWICE');
  });

  it('permite alimentar al hijo desde el estado de decisión del padre', () => {
    const inputMapping = [
      { childVariableCode: 'ingreso_mensual', source: 'VARIABLE' as const, path: 'decision.score' },
      base.inputMapping[1],
    ];
    expect(codes({ ...base, inputMapping })).toEqual([]);
  });

  it('permite alimentar al hijo desde una variable intermedia del padre', () => {
    const parentContext = [...base.parentContext, variable('dti', 'DECIMAL')];
    const inputMapping = [
      {
        childVariableCode: 'ingreso_mensual',
        source: 'VARIABLE' as const,
        path: 'intermediate.dti',
      },
      base.inputMapping[1],
    ];
    expect(codes({ ...base, parentContext, inputMapping })).toEqual([]);
  });
});
