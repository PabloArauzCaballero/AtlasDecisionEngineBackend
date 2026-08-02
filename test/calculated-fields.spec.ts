import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { CalculatedFieldExecutorService } from '../src/modules/calculated-fields/calculated-field-executor.service';
import { validateCalculatedFieldContract } from '../src/modules/calculated-fields/calculated-field-contract.validator';
import {
  guardCalculatedFieldCode,
  MAX_EXECUTABLE_LINES,
} from '../src/modules/calculated-fields/code-guard';
import { evaluateOperation } from '../src/modules/calculated-fields/operation-evaluator';
import { OPERATIONS, OPERATIONS_BY_ID } from '../src/modules/calculated-fields/operation-catalog';
import {
  allowedFunctionsFor,
  buildPrelude,
  isPreludeAvailable,
} from '../src/modules/libraries/library-preludes';
import type { CreateCalculatedFieldVersionDto } from '../src/modules/calculated-fields/calculated-field.dto';

/**
 * Un campo calculado es una función pequeña, segura y reutilizable (§5). Las pruebas
 * fijan las tres fronteras que lo mantienen así: el catálogo cerrado de operaciones,
 * el límite de tres líneas y el contrato de retorno que gobierna el resultado.
 */
describe('constructor visual de operaciones', () => {
  const inputs = { ingreso: 1200, deuda: 450, nombre: ' Ana ', notas: [1, 2, 3, 4] };

  it('evalúa un árbol anidado usando solo el catálogo', () => {
    const tree = {
      operation: 'ROUND',
      args: [
        { operation: 'DIVIDE', args: [{ input: 'deuda' }, { input: 'ingreso' }] },
        { literal: 3 },
      ],
    };
    expect(evaluateOperation(tree, inputs)).toBe(0.375);
  });

  it('rechaza una operación que no está en el catálogo', () => {
    expect(() => evaluateOperation({ operation: 'SYSTEM_EXEC', args: [] }, inputs)).toThrow(
      /no está en el catálogo autorizado/,
    );
  });

  it('rechaza una entrada no provista', () => {
    expect(() =>
      evaluateOperation({ operation: 'ABS', args: [{ input: 'inexistente' }] }, inputs),
    ).toThrow(/no fue provista/);
  });

  it('lanza o devuelve null en la división por cero según la política', () => {
    const tree = { operation: 'DIVIDE', args: [{ literal: 1 }, { literal: 0 }] };
    expect(() => evaluateOperation(tree, inputs)).toThrow(/División entre cero/);
    expect(evaluateOperation(tree, inputs, { divisionByZeroReturnsNull: true })).toBeNull();
  });

  it('valida el tipo de cada argumento en vez de coaccionarlo', () => {
    expect(() =>
      evaluateOperation({ operation: 'ABS', args: [{ input: 'nombre' }] }, inputs),
    ).toThrow(/espera un número/);
  });

  it('corta un árbol excesivamente profundo', () => {
    let tree: unknown = { literal: 1 };
    for (let index = 0; index < 40; index += 1) tree = { operation: 'ABS', args: [tree] };
    expect(() => evaluateOperation(tree as never, inputs)).toThrow(/profundidad máxima/);
  });

  it('cubre estadística, texto, fechas y agregación', () => {
    expect(evaluateOperation({ operation: 'AVERAGE', args: [{ input: 'notas' }] }, inputs)).toBe(
      2.5,
    );
    expect(evaluateOperation({ operation: 'MEDIAN', args: [{ input: 'notas' }] }, inputs)).toBe(
      2.5,
    );
    expect(evaluateOperation({ operation: 'SUM', args: [{ input: 'notas' }] }, inputs)).toBe(10);
    expect(evaluateOperation({ operation: 'TRIM', args: [{ input: 'nombre' }] }, inputs)).toBe(
      'Ana',
    );
    expect(
      evaluateOperation(
        { operation: 'AGE_YEARS', args: [{ literal: '1990-05-01' }, { literal: '2026-04-30' }] },
        inputs,
      ),
    ).toBe(35);
    expect(
      evaluateOperation({ operation: 'TO_PERCENTAGE', args: [{ literal: 0.375 }] }, inputs),
    ).toBe(37.5);
  });

  it('toda operación del catálogo tiene implementación', () => {
    // Sin esta prueba, el panel puede ofrecer una operación que revienta al ejecutarse.
    for (const operation of OPERATIONS) {
      expect(OPERATIONS_BY_ID.get(operation.id)).toBeDefined();
      expect(operation.args.length).toBeGreaterThan(0);
      expect(operation.example).toBeTruthy();
    }
  });
});

describe('límite de tres líneas y análisis estático', () => {
  it('acepta hasta tres líneas ejecutables e ignora los comentarios', () => {
    const source = [
      '// calcula el DTI',
      'const dti = variables.deuda / variables.ingreso;',
      '',
      'return dti;',
    ].join('\n');
    const result = guardCalculatedFieldCode(source, 'JAVASCRIPT');
    expect(result.executableLines).toBe(2);
    expect(result.ok).toBe(true);
  });

  it('rechaza más de tres líneas ejecutables', () => {
    const source = Array.from({ length: 4 }, (_, i) => `const a${i} = ${i};`)
      .concat('return a0;')
      .join('\n');
    const result = guardCalculatedFieldCode(source, 'JAVASCRIPT');
    expect(result.executableLines).toBeGreaterThan(MAX_EXECUTABLE_LINES);
    expect(result.violations.map((v) => v.code)).toContain('CODE_TOO_LONG');
  });

  it('no deja burlar el límite metiendo sentencias con punto y coma', () => {
    const source = 'const a = 1; const b = 2; const c = 3; const d = 4; return d;';
    expect(guardCalculatedFieldCode(source, 'JAVASCRIPT').violations.map((v) => v.code)).toContain(
      'CODE_TOO_MANY_STATEMENTS',
    );
  });

  it.each([
    ['require("fs")', 'IMPORT_FORBIDDEN'],
    ['return eval("1+1")', 'DYNAMIC_EVAL_FORBIDDEN'],
    ['for (;;) {}; return 1', 'LOOP_FORBIDDEN'],
    ['return process.env.SECRET', 'HOST_ACCESS_FORBIDDEN'],
    ['return Date.now()', 'CLOCK_ACCESS_FORBIDDEN'],
    ['return {}.__proto__', 'DUNDER_FORBIDDEN'],
  ])('rechaza %s', (source, expected) => {
    expect(guardCalculatedFieldCode(source, 'JAVASCRIPT').violations.map((v) => v.code)).toContain(
      expected,
    );
  });

  it('no se deja engañar por una prohibición dentro de una cadena', () => {
    const result = guardCalculatedFieldCode('return "no uses require aquí";', 'JAVASCRIPT');
    expect(result.violations.map((v) => v.code)).not.toContain('IMPORT_FORBIDDEN');
  });

  it('exige asignar result en Python y return en JavaScript', () => {
    expect(
      guardCalculatedFieldCode('variables.a + 1', 'PYTHON').violations.map((v) => v.code),
    ).toContain('PYTHON_RESULT_NOT_ASSIGNED');
    expect(
      guardCalculatedFieldCode('const a = 1;', 'JAVASCRIPT').violations.map((v) => v.code),
    ).toContain('JS_RETURN_MISSING');
  });

  it('rechaza import y try en Python', () => {
    const codes = guardCalculatedFieldCode('import os\nresult = 1', 'PYTHON').violations.map(
      (v) => v.code,
    );
    expect(codes).toContain('IMPORT_FORBIDDEN');
  });
});

describe('validación del contrato del campo calculado', () => {
  const base: CreateCalculatedFieldVersionDto = {
    implementationKind: 'OPERATION',
    inputs: [
      {
        id: 'deuda',
        name: 'Deuda',
        description: 'Deuda mensual',
        dataType: 'DECIMAL',
        required: true,
      },
      {
        id: 'ingreso',
        name: 'Ingreso',
        description: 'Ingreso mensual',
        dataType: 'DECIMAL',
        required: true,
      },
    ],
    returns: {
      dataType: 'DECIMAL',
      nullable: false,
      precision: 4,
      nullConditions: [],
      divisionByZero: 'FAIL',
      missingData: 'FAIL',
      outOfRange: 'FAIL',
      errorCode: 'DTI_NOT_COMPUTABLE',
    },
    operation: { operation: 'DIVIDE', args: [{ input: 'deuda' }, { input: 'ingreso' }] },
  };

  const issueCodes = (dto: CreateCalculatedFieldVersionDto, fns: string[] = []) =>
    validateCalculatedFieldContract(dto, fns).issues.map((issue) => issue.code);

  it('acepta un contrato coherente', () => {
    expect(validateCalculatedFieldContract(base).valid).toBe(true);
  });

  it('rechaza RETURN_NULL sobre un retorno no nulo', () => {
    const dto = { ...base, returns: { ...base.returns, divisionByZero: 'RETURN_NULL' as const } };
    expect(issueCodes(dto)).toContain('NULL_POLICY_ON_NON_NULLABLE');
  });

  it('exige documentar cuándo devuelve null', () => {
    const dto = { ...base, returns: { ...base.returns, nullable: true } };
    expect(issueCodes(dto)).toContain('NULL_CONDITIONS_UNDOCUMENTED');
  });

  it('rechaza RETURN_DEFAULT sin valor por defecto', () => {
    const dto = { ...base, returns: { ...base.returns, outOfRange: 'RETURN_DEFAULT' as const } };
    expect(issueCodes(dto)).toContain('DEFAULT_POLICY_WITHOUT_DEFAULT');
  });

  it('rechaza precisión sobre un tipo no decimal', () => {
    const dto = { ...base, returns: { ...base.returns, dataType: 'STRING', precision: 2 } };
    expect(issueCodes(dto)).toContain('PRECISION_ON_NON_DECIMAL');
  });

  it('rechaza un árbol que referencia una entrada no declarada', () => {
    const dto = { ...base, operation: { operation: 'ABS', args: [{ input: 'fantasma' }] } };
    expect(issueCodes(dto)).toContain('OPERATION_INPUT_UNKNOWN');
  });

  it('rechaza aridad incorrecta en una operación', () => {
    const dto = { ...base, operation: { operation: 'DIVIDE', args: [{ input: 'deuda' }] } };
    expect(issueCodes(dto)).toContain('OPERATION_ARITY_INVALID');
  });

  it('rechaza mezclar modalidad visual con código', () => {
    const dto = { ...base, sourceCode: 'return 1;' };
    expect(issueCodes(dto)).toContain('CODE_ON_OPERATION_KIND');
  });

  it('rechaza código que usa una entrada no declarada', () => {
    const dto: CreateCalculatedFieldVersionDto = {
      ...base,
      implementationKind: 'JAVASCRIPT',
      operation: undefined,
      sourceCode: 'return variables.fantasma * 2;',
    };
    expect(issueCodes(dto)).toContain('CODE_INPUT_UNKNOWN');
  });

  it('rechaza código que usa una librería no seleccionada', () => {
    const dto: CreateCalculatedFieldVersionDto = {
      ...base,
      implementationKind: 'JAVASCRIPT',
      operation: undefined,
      sourceCode: 'return statistics.mean([variables.deuda, variables.ingreso]);',
    };
    expect(issueCodes(dto)).toContain('LIBRARY_NOT_SELECTED');
    expect(issueCodes(dto, ['statistics.mean'])).not.toContain('LIBRARY_NOT_SELECTED');
  });

  it('sugiere convertir en artefacto lo que ya no es un campo calculado', () => {
    const dto: CreateCalculatedFieldVersionDto = {
      ...base,
      timeoutMs: 900,
      inputs: Array.from({ length: 12 }, (_, index) => ({
        id: `entrada_${index}`,
        name: `Entrada ${index}`,
        description: 'x',
        dataType: 'DECIMAL',
        required: true,
      })),
      operation: { operation: 'ABS', args: [{ input: 'entrada_0' }] },
    };
    const codes = issueCodes(dto);
    expect(codes).toContain('TOO_MANY_INPUTS');
    expect(codes).toContain('TIMEOUT_TOO_HIGH');
  });
});

describe('registro de librerías: preludes', () => {
  it('solo hay librerías con implementación revisada en el repositorio', () => {
    expect(isPreludeAvailable('math', 'JAVASCRIPT')).toBe(true);
    expect(isPreludeAvailable('statistics', 'PYTHON')).toBe(true);
    expect(isPreludeAvailable('numpy', 'PYTHON')).toBe(false);
  });

  it('construir un prelude con una librería sin implementación falla cerrado', () => {
    expect(buildPrelude(['math'], 'JAVASCRIPT')).toContain('const math');
    expect(buildPrelude(['numpy'], 'PYTHON')).toBeNull();
  });

  it('las funciones expuestas dependen del lenguaje', () => {
    expect(allowedFunctionsFor(['math'], 'JAVASCRIPT')).toContain('math.sqrt');
    expect(allowedFunctionsFor(['math'], 'PYTHON')).toContain('math_sqrt');
  });

  it('ningún prelude introduce importaciones ni aleatoriedad', () => {
    for (const language of ['JAVASCRIPT', 'PYTHON'] as const) {
      for (const name of ['math', 'statistics', 'finance', 'dates']) {
        const source = buildPrelude([name], language) ?? '';
        expect(source).not.toMatch(/\brequire\s*\(|\bimport\b/);
        expect(source).not.toMatch(/Math\.random|\brandom\b/);
      }
    }
  });
});

describe('ejecución con el contrato de retorno', () => {
  const config = new ConfigService({ SCRIPT_NODES_ENABLED: false });
  const executor = new CalculatedFieldExecutorService(
    new ScriptNodeRunnerService(config),
    new MetricsService(),
  );

  const field = (overrides: Record<string, unknown> = {}) => ({
    fieldCode: 'dti',
    implementationKind: 'OPERATION' as const,
    contract: {
      inputs: [
        { id: 'deuda', name: 'Deuda', description: '', dataType: 'DECIMAL', required: true },
        { id: 'ingreso', name: 'Ingreso', description: '', dataType: 'DECIMAL', required: true },
      ],
      returns: {
        dataType: 'DECIMAL',
        nullable: false,
        precision: 3,
        nullConditions: [],
        divisionByZero: 'FAIL' as const,
        missingData: 'FAIL' as const,
        outOfRange: 'FAIL' as const,
        errorCode: 'DTI_NOT_COMPUTABLE',
      },
    },
    operation: { operation: 'DIVIDE', args: [{ input: 'deuda' }, { input: 'ingreso' }] },
    libraryPackages: [],
    ...overrides,
  });

  it('aplica la precisión declarada al resultado', async () => {
    const result = await executor.execute(field(), { deuda: 450, ingreso: 1200 });
    expect(result.value).toBe(0.375);
    expect(result.outcome).toBe('VALID');
  });

  it('rechaza una entrada que incumple su contrato', async () => {
    await expect(executor.execute(field(), { deuda: 'x', ingreso: 1200 })).rejects.toThrow(
      /must be of type/,
    );
  });

  it('rechaza una entrada obligatoria ausente', async () => {
    await expect(executor.execute(field(), { deuda: 450 })).rejects.toThrow(/requiere la entrada/);
  });

  it('devuelve el valor por defecto cuando la política lo indica', async () => {
    const withDefault = field({
      contract: {
        ...field().contract,
        returns: { ...field().contract.returns, missingData: 'RETURN_DEFAULT' as const },
      },
      defaultValue: 1,
    });
    const result = await executor.execute(withDefault, { ingreso: 1200 });
    expect(result).toMatchObject({ value: 1, outcome: 'DEFAULTED' });
  });

  it('rechaza un resultado fuera de las restricciones declaradas', async () => {
    const bounded = field({
      contract: {
        ...field().contract,
        returns: { ...field().contract.returns, constraints: { max: 0.3 } },
      },
    });
    await expect(executor.execute(bounded, { deuda: 450, ingreso: 1200 })).rejects.toThrow(
      /is above maximum/,
    );
  });

  it('la división por cero respeta la política de retorno nulo', async () => {
    const nullable = field({
      contract: {
        ...field().contract,
        returns: {
          ...field().contract.returns,
          nullable: true,
          nullConditions: ['ingreso = 0'],
          divisionByZero: 'RETURN_NULL' as const,
        },
      },
    });
    const result = await executor.execute(nullable, { deuda: 450, ingreso: 0 });
    expect(result).toMatchObject({ value: null, outcome: 'NULL_BY_POLICY' });
  });

  /**
   * `missingData` describe qué hacer cuando falta un dato, no cuando se rompe la
   * infraestructura. Antes el catch de executeCalculatedField era universal: con
   * RETURN_DEFAULT, un sandbox caído o un script agotando su tiempo devolvía el valor por
   * defecto y la decisión seguía adelante como si el cálculo hubiera salido bien.
   */
  it('no tapa un fallo del sandbox con la política de datos faltantes', async () => {
    const codeField = field({
      implementationKind: 'JAVASCRIPT' as const,
      operation: undefined,
      sourceCode: 'return variables.deuda / variables.ingreso;',
      defaultValue: 1,
      contract: {
        ...field().contract,
        returns: { ...field().contract.returns, missingData: 'RETURN_DEFAULT' as const },
      },
    });
    // SCRIPT_NODES_ENABLED=false hace que el runner rechace la ejecución: es un fallo de
    // configuración/infraestructura, exactamente lo que no debe defaultearse.
    await expect(executor.execute(codeField, { deuda: 450, ingreso: 1200 })).rejects.toThrow(
      /Script RESULT nodes are disabled/,
    );
  });

  it('sigue aplicando la política cuando el dato ausente es la causa real', async () => {
    const withDefault = field({
      contract: {
        ...field().contract,
        returns: { ...field().contract.returns, missingData: 'RETURN_DEFAULT' as const },
      },
      defaultValue: 1,
    });
    const result = await executor.execute(withDefault, { deuda: 450 });
    expect(result).toMatchObject({ value: 1, outcome: 'DEFAULTED' });
  });
});
