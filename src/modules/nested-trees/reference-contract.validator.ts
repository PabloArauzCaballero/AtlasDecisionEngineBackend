/**
 * Compatibilidad de contratos entre artefacto padre e hijo (§9.2).
 *
 * Reglas puras, sin base de datos: el servicio carga los dos contratos y esta función
 * decide si el mapeo es válido. Ejecutarlo al guardar evita el fallo que antes solo
 * aparecía en producción — un hijo esperando `ingreso_mensual` y un padre mandándole
 * `ingreso`, o un tipo que no encaja.
 */
import { isTypeAssignable, normalizeDataTypeOrString } from '../../common/contracts/data-types';

export interface ContractVariable {
  code: string;
  dataType: string;
  required: boolean;
  nullable: boolean;
}

export interface ReferenceContractInput {
  /** Entradas y salidas declaradas por el artefacto hijo. */
  childInputs: ContractVariable[];
  childOutputs: ContractVariable[];
  /** Variables e intermedias que el padre puede ofrecer como origen. */
  parentContext: ContractVariable[];
  inputMapping: Array<{
    childVariableCode: string;
    source: 'VARIABLE' | 'LITERAL' | 'EXPRESSION';
    path?: string;
    value?: unknown;
  }>;
  outputMapping: Array<{ childOutputCode: string }>;
}

export interface ReferenceContractIssue {
  code: string;
  message: string;
  entity?: string;
}

/**
 * Claves que el motor añade SIEMPRE al sobre de salida, declare o no el artefacto una
 * variable con ese nombre (ver `EngineExecutionResult.output`). Un padre puede
 * consumirlas legítimamente —un hijo que solo fija `outcome` con una acción terminal es
 * el caso más común—, así que no pueden tratarse como salidas inexistentes.
 */
export const IMPLICIT_CHILD_OUTPUTS = ['outcome', 'score', 'riskBand', 'limit'] as const;

export function validateReferenceContract(input: ReferenceContractInput): ReferenceContractIssue[] {
  const issues: ReferenceContractIssue[] = [];
  const childInputsByCode = new Map(input.childInputs.map((entry) => [entry.code, entry]));
  const childOutputCodes = new Set<string>([
    ...input.childOutputs.map((entry) => entry.code),
    ...IMPLICIT_CHILD_OUTPUTS,
  ]);
  const parentByCode = new Map(input.parentContext.map((entry) => [entry.code, entry]));

  const mapped = new Set<string>();
  for (const entry of input.inputMapping) {
    if (mapped.has(entry.childVariableCode)) {
      issues.push({
        code: 'REFERENCE_INPUT_MAPPED_TWICE',
        message: `La entrada ${entry.childVariableCode} del hijo está mapeada más de una vez`,
        entity: entry.childVariableCode,
      });
    }
    mapped.add(entry.childVariableCode);

    const target = childInputsByCode.get(entry.childVariableCode);
    if (!target) {
      issues.push({
        code: 'REFERENCE_INPUT_UNKNOWN',
        message: `El artefacto hijo no declara la entrada ${entry.childVariableCode}`,
        entity: entry.childVariableCode,
      });
      continue;
    }

    if (entry.source === 'VARIABLE') {
      const code = normalizePath(entry.path ?? '');
      if (!code) {
        issues.push({
          code: 'REFERENCE_INPUT_PATH_MISSING',
          message: `El mapeo de ${entry.childVariableCode} es por variable pero no indica la ruta`,
          entity: entry.childVariableCode,
        });
        continue;
      }
      // `decision.*` y `output.*` son estado de ejecución del padre: existen siempre,
      // así que solo se comprueban las rutas que apuntan a su contrato de datos.
      if (code.scope === 'CONTEXT') continue;
      const origin = parentByCode.get(code.code);
      if (!origin) {
        issues.push({
          code: 'REFERENCE_INPUT_SOURCE_MISSING',
          message: `El padre no declara ${code.code}, origen de la entrada ${entry.childVariableCode}`,
          entity: entry.childVariableCode,
        });
        continue;
      }
      const from = normalizeDataTypeOrString(origin.dataType);
      const to = normalizeDataTypeOrString(target.dataType);
      if (!isTypeAssignable(from, to)) {
        issues.push({
          code: 'REFERENCE_INPUT_TYPE_MISMATCH',
          message: `${code.code} es ${from} y la entrada ${entry.childVariableCode} del hijo espera ${to}`,
          entity: entry.childVariableCode,
        });
      }
      if (target.required && !origin.required && !origin.nullable) {
        issues.push({
          code: 'REFERENCE_INPUT_MAY_BE_ABSENT',
          message: `${code.code} es opcional en el padre pero la entrada ${entry.childVariableCode} del hijo es obligatoria`,
          entity: entry.childVariableCode,
        });
      }
    }

    if (entry.source === 'LITERAL') {
      const literalType = typeOfLiteral(entry.value);
      const to = normalizeDataTypeOrString(target.dataType);
      if (entry.value === null || entry.value === undefined) {
        if (target.required && !target.nullable) {
          issues.push({
            code: 'REFERENCE_INPUT_LITERAL_NULL',
            message: `La entrada obligatoria ${entry.childVariableCode} está mapeada a un literal nulo`,
            entity: entry.childVariableCode,
          });
        }
      } else if (literalType && !isTypeAssignable(literalType, to)) {
        issues.push({
          code: 'REFERENCE_INPUT_TYPE_MISMATCH',
          message: `El literal de ${entry.childVariableCode} es ${literalType} y el hijo espera ${to}`,
          entity: entry.childVariableCode,
        });
      }
    }
  }

  // Toda entrada obligatoria del hijo tiene que quedar satisfecha.
  for (const childInput of input.childInputs) {
    if (childInput.required && !mapped.has(childInput.code)) {
      issues.push({
        code: 'REFERENCE_REQUIRED_INPUT_UNMAPPED',
        message: `La entrada obligatoria ${childInput.code} del artefacto hijo no está mapeada`,
        entity: childInput.code,
      });
    }
  }

  // Las salidas consumidas tienen que existir en el hijo.
  const consumed = new Set<string>();
  for (const entry of input.outputMapping) {
    if (consumed.has(entry.childOutputCode)) {
      issues.push({
        code: 'REFERENCE_OUTPUT_MAPPED_TWICE',
        message: `La salida ${entry.childOutputCode} está declarada más de una vez`,
        entity: entry.childOutputCode,
      });
    }
    consumed.add(entry.childOutputCode);
    if (!childOutputCodes.has(entry.childOutputCode)) {
      issues.push({
        code: 'REFERENCE_OUTPUT_UNKNOWN',
        message: `El artefacto hijo no declara la salida ${entry.childOutputCode}`,
        entity: entry.childOutputCode,
      });
    }
  }
  if (!input.outputMapping.length) {
    issues.push({
      code: 'REFERENCE_OUTPUT_EMPTY',
      message: 'La referencia no expone ninguna salida del hijo: no aportaría nada al padre',
    });
  }

  return issues;
}

/** Interpreta una ruta del padre: `variables.x`, `intermediate.x`, `decision.x`, `x`. */
function normalizePath(path: string): { scope: 'DATA' | 'CONTEXT'; code: string } | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('decision.') || trimmed.startsWith('output.')) {
    return { scope: 'CONTEXT', code: trimmed };
  }
  const withoutPrefix = trimmed.startsWith('variables.')
    ? trimmed.slice('variables.'.length)
    : trimmed.startsWith('intermediate.')
      ? trimmed.slice('intermediate.'.length)
      : trimmed;
  return { scope: 'DATA', code: withoutPrefix.split('.')[0] };
}

function typeOfLiteral(value: unknown): ReturnType<typeof normalizeDataTypeOrString> | null {
  if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'DECIMAL';
  if (typeof value === 'string') return 'STRING';
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (Array.isArray(value)) return 'LIST';
  if (value && typeof value === 'object') return 'OBJECT';
  return null;
}
