/**
 * Núcleo de ejecución de un campo calculado, **puro y sin Nest** (§5.3, §6).
 *
 * Vive fuera del servicio a propósito: el motor de grafo necesita ejecutar campos
 * calculados embebidos en el artefacto compilado, y si dependiera del módulo de campos
 * calculados —que a su vez depende de GraphModule por el sandbox— habría un ciclo de
 * módulos. Este archivo no importa nada de `graph/`, así que ambos lo pueden usar.
 *
 * La única pieza que sigue en el servicio es la cola con base de datos, métricas y
 * sandbox; las reglas del contrato están aquí y se prueban sin levantar la aplicación.
 */
import {
  parseConstraints,
  validateAgainstConstraints,
} from '../../common/contracts/constraint-engine';
import { DomainException } from '../../common/errors/domain-exception';
import { buildPrelude } from '../libraries/library-preludes';
import { evaluateOperation } from './operation-evaluator';
import type {
  CalculatedFieldContract,
  CalculatedFieldExecutionResult,
  MissingDataPolicy,
  OperationNode,
} from './calculated-field.types';

/**
 * Todo lo necesario para ejecutar un campo calculado, sin consultar la base de datos.
 * Es también la forma en la que se congela dentro del artefacto compilado, de modo que
 * una decisión sigue siendo reproducible aunque el campo se deprecie después.
 */
export interface ExecutableCalculatedField {
  fieldCode: string;
  /** Versión fijada. Se guarda para la traza y para poder auditar qué se ejecutó. */
  versionNumber?: number;
  implementationKind: 'OPERATION' | 'JAVASCRIPT' | 'PYTHON';
  contract: CalculatedFieldContract;
  operation?: OperationNode;
  sourceCode?: string;
  /** Nombres de paquete de las librerías autorizadas seleccionadas. */
  libraryPackages: string[];
  defaultValue?: unknown;
  timeoutMs?: number;
}

/** Ejecuta código aislado. Lo implementa `ScriptNodeRunnerService`. */
export interface SandboxRunner {
  execute(
    language: 'JAVASCRIPT' | 'PYTHON',
    source: string,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

/** Valida las entradas contra su contrato antes de que entren al cálculo. */
export function resolveCalculatedFieldInputs(
  field: ExecutableCalculatedField,
  rawInputs: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const input of field.contract.inputs) {
    const provided = rawInputs[input.id];
    const value = provided === undefined ? input.defaultValue : provided;
    if (value === undefined || value === null) {
      if (input.required) {
        throw new DomainException(
          'CALCULATED_FIELD_INPUT_MISSING',
          `El campo calculado ${field.fieldCode} requiere la entrada ${input.id}`,
        );
      }
      values[input.id] = null;
      continue;
    }
    const violations = validateAgainstConstraints(
      input.dataType,
      parseConstraints(input.constraints),
      value,
      { siblings: rawInputs },
    );
    if (violations.length) {
      throw new DomainException(
        'CALCULATED_FIELD_INPUT_INVALID',
        `La entrada ${input.id} de ${field.fieldCode} ${violations[0].message}`,
      );
    }
    values[input.id] = value;
  }
  return values;
}

/**
 * Construye el código que se manda al sandbox. El envoltorio lo pone el motor, no el
 * autor: su código sigue siendo la expresión de tres líneas que escribió, y el runner
 * siempre recibe un objeto de vuelta.
 */
export function buildSandboxSource(field: ExecutableCalculatedField): {
  language: 'JAVASCRIPT' | 'PYTHON';
  source: string;
} {
  const language = field.implementationKind === 'PYTHON' ? 'PYTHON' : 'JAVASCRIPT';
  const prelude = buildPrelude(field.libraryPackages, language);
  if (prelude === null) {
    throw new DomainException(
      'CALCULATED_FIELD_LIBRARY_UNAVAILABLE',
      `Alguna librería seleccionada no tiene implementación autorizada para ${language}`,
    );
  }
  const source =
    language === 'PYTHON'
      ? `${prelude}\n${field.sourceCode ?? ''}\nresult = {'value': result}`
      : `${prelude}\nconst __atlasValue = (() => {\n${field.sourceCode ?? ''}\n})();\nreturn { value: __atlasValue === undefined ? null : __atlasValue };`;
  return { language, source };
}

/** Aplica precisión, nulabilidad y restricciones al valor devuelto (§5.3). */
export function applyReturnContract(
  field: ExecutableCalculatedField,
  raw: unknown,
  durationMs: number,
): CalculatedFieldExecutionResult {
  const contract = field.contract.returns;

  if (raw === null || raw === undefined) {
    if (contract.nullable) return { value: null, outcome: 'NULL_BY_POLICY', durationMs };
    const fallback = applyPolicy(field, contract.divisionByZero);
    if (fallback) return { ...fallback, durationMs };
    throw new DomainException(
      contract.errorCode || 'CALCULATED_FIELD_NULL_NOT_ALLOWED',
      `El campo calculado ${field.fieldCode} no puede devolver un valor nulo`,
    );
  }

  const value =
    contract.precision !== undefined && typeof raw === 'number'
      ? roundTo(raw, contract.precision)
      : raw;

  const violations = validateAgainstConstraints(
    contract.dataType,
    parseConstraints(contract.constraints),
    value,
    { siblings: {} },
  );
  if (violations.length) {
    const fallback = applyPolicy(field, contract.outOfRange);
    if (fallback) return { ...fallback, durationMs };
    throw new DomainException(
      contract.errorCode || 'CALCULATED_FIELD_RETURN_INVALID',
      `El resultado de ${field.fieldCode} ${violations[0].message}`,
    );
  }
  return { value, outcome: 'VALID', durationMs };
}

/**
 * Errores a los que la política `missingData` puede responder: son los que describen datos
 * que faltan o no se pueden convertir, es decir lo que el contrato define como
 * "falta una entrada necesaria para el cálculo" (§5.3).
 *
 * Es una lista cerrada a propósito. Cualquier otro fallo —sandbox caído, script agotando su
 * tiempo, librería sin implementación autorizada, salida no serializable— es infraestructura o
 * configuración, no un dato ausente: devolver ahí el valor por defecto convertiría una avería
 * en una decisión de crédito silenciosamente incorrecta. Esos errores se propagan.
 */
const MISSING_DATA_ERROR_CODES: ReadonlySet<string> = new Set([
  'CALCULATED_FIELD_INPUT_MISSING',
  'CALCULATED_FIELD_ARGUMENT_INVALID',
  'CALCULATED_FIELD_CONVERSION_FAILED',
  'CALCULATED_FIELD_DIVISION_BY_ZERO',
]);

/** Traduce una política declarada a un resultado, o `null` si toca propagar el error. */
export function applyPolicy(
  field: ExecutableCalculatedField,
  policy: MissingDataPolicy,
): Omit<CalculatedFieldExecutionResult, 'durationMs'> | null {
  if (policy === 'RETURN_NULL' && field.contract.returns.nullable) {
    return { value: null, outcome: 'NULL_BY_POLICY' };
  }
  if (policy === 'RETURN_DEFAULT' && field.defaultValue !== undefined) {
    return { value: field.defaultValue, outcome: 'DEFAULTED' };
  }
  return null;
}

/** Ejecuta la modalidad visual, que no necesita sandbox porque no ejecuta código. */
export function runOperationTree(
  field: ExecutableCalculatedField,
  inputs: Record<string, unknown>,
): unknown {
  if (!field.operation) {
    throw new DomainException(
      'CALCULATED_FIELD_OPERATION_MISSING',
      `El campo calculado ${field.fieldCode} no tiene árbol de operaciones`,
    );
  }
  return evaluateOperation(field.operation, inputs, {
    divisionByZeroReturnsNull: field.contract.returns.divisionByZero !== 'FAIL',
  });
}

/**
 * Ejecución completa: valida entradas, calcula y aplica el contrato de retorno.
 * `sandbox` solo se usa en las modalidades por código.
 */
export async function executeCalculatedField(
  field: ExecutableCalculatedField,
  rawInputs: Record<string, unknown>,
  sandbox: SandboxRunner,
  now: () => number = Date.now,
): Promise<CalculatedFieldExecutionResult> {
  const started = now();
  try {
    const inputs = resolveCalculatedFieldInputs(field, rawInputs);
    let raw: unknown;
    if (field.implementationKind === 'OPERATION') {
      raw = runOperationTree(field, inputs);
    } else {
      const { language, source } = buildSandboxSource(field);
      const output = await sandbox.execute(language, source, { variables: inputs });
      raw = (output as { value?: unknown }).value ?? null;
    }
    return applyReturnContract(field, raw, now() - started);
  } catch (error) {
    // Un error de contrato del propio autor (entrada inválida) no debe quedar tapado
    // por una política pensada para datos faltantes en tiempo de ejecución. Tampoco un
    // fallo de infraestructura: la política solo cubre los códigos de dato ausente.
    if (!(error instanceof DomainException) || !MISSING_DATA_ERROR_CODES.has(error.code)) {
      throw error;
    }
    const fallback = applyPolicy(field, field.contract.returns.missingData);
    if (fallback) return { ...fallback, durationMs: now() - started };
    throw error;
  }
}

export type { CalculatedFieldContract };

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** Math.max(0, Math.trunc(decimals));
  return Math.round(value * factor) / factor;
}
