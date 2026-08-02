/**
 * Coherencia del contrato de un campo calculado antes de persistirlo (§5.3, §8).
 *
 * Separado del servicio a propósito: son reglas puras sobre el contrato, sin base de
 * datos, y así se pueden probar y reutilizar desde QA sin levantar Nest.
 */
import { normalizeDataTypeOrString } from '../../common/contracts/data-types';
import { OPERATIONS_BY_ID } from './operation-catalog';
import { guardCalculatedFieldCode, type CodeGuardResult } from './code-guard';
import type { CreateCalculatedFieldVersionDto } from './calculated-field.dto';

export interface ContractIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ContractValidationResult {
  valid: boolean;
  issues: ContractIssue[];
  codeGuard?: CodeGuardResult;
}

/** Señales de que lo que se está guardando debería ser un artefacto, no un campo (§8). */
const ARTIFACT_SMELLS: Array<{
  test: (dto: CreateCalculatedFieldVersionDto) => boolean;
  code: string;
  message: string;
}> = [
  {
    test: (dto) => dto.inputs.length > 10,
    code: 'TOO_MANY_INPUTS',
    message:
      'más de 10 entradas indica un proceso de negocio, no un cálculo reutilizable: modélalo como artefacto',
  },
  {
    test: (dto) => (dto.timeoutMs ?? 50) > 250,
    code: 'TIMEOUT_TOO_HIGH',
    message:
      'un campo calculado debe resolverse en milisegundos; si necesita más tiempo, es un artefacto',
  },
];

export function validateCalculatedFieldContract(
  dto: CreateCalculatedFieldVersionDto,
  /** Funciones que las librerías seleccionadas ponen a disposición. */
  allowedLibraryFunctions: readonly string[] = [],
): ContractValidationResult {
  const issues: ContractIssue[] = [];

  const inputIds = new Set<string>();
  for (const input of dto.inputs) {
    if (inputIds.has(input.id)) {
      issues.push({
        code: 'DUPLICATE_INPUT',
        message: `la entrada ${input.id} está repetida`,
        path: `inputs.${input.id}`,
      });
    }
    inputIds.add(input.id);
    if (!input.required && input.defaultValue === undefined && dto.returns.missingData === 'FAIL') {
      issues.push({
        code: 'OPTIONAL_INPUT_WITHOUT_FALLBACK',
        message: `la entrada opcional ${input.id} no tiene valor por defecto y la política ante datos faltantes es FAIL`,
        path: `inputs.${input.id}`,
      });
    }
  }

  // §5.3: no se puede guardar sin un contrato de retorno coherente.
  if (!dto.returns.nullable) {
    for (const [field, policy] of [
      ['divisionByZero', dto.returns.divisionByZero],
      ['missingData', dto.returns.missingData],
      ['outOfRange', dto.returns.outOfRange],
    ] as const) {
      if (policy === 'RETURN_NULL') {
        issues.push({
          code: 'NULL_POLICY_ON_NON_NULLABLE',
          message: `${field} devuelve null pero el retorno está declarado como no nulo`,
          path: `returns.${field}`,
        });
      }
      if (policy === 'RETURN_DEFAULT' && dto.defaultValue === undefined) {
        issues.push({
          code: 'DEFAULT_POLICY_WITHOUT_DEFAULT',
          message: `${field} devuelve el valor por defecto, pero no hay ninguno declarado`,
          path: `returns.${field}`,
        });
      }
    }
  }
  if (dto.returns.nullable && !dto.returns.nullConditions.length) {
    issues.push({
      code: 'NULL_CONDITIONS_UNDOCUMENTED',
      message: 'si el retorno admite null hay que documentar en qué condiciones ocurre',
      path: 'returns.nullConditions',
    });
  }

  const returnType = normalizeDataTypeOrString(dto.returns.dataType);
  if (
    dto.returns.precision !== undefined &&
    !['DECIMAL', 'PERCENTAGE', 'CURRENCY'].includes(returnType)
  ) {
    issues.push({
      code: 'PRECISION_ON_NON_DECIMAL',
      message: `la precisión solo aplica a tipos decimales, no a ${returnType}`,
      path: 'returns.precision',
    });
  }

  for (const smell of ARTIFACT_SMELLS) {
    if (smell.test(dto)) issues.push({ code: smell.code, message: smell.message });
  }

  let codeGuard: CodeGuardResult | undefined;
  if (dto.implementationKind === 'OPERATION') {
    if (!dto.operation) {
      issues.push({
        code: 'OPERATION_TREE_MISSING',
        message: 'la modalidad visual exige un árbol de operaciones',
        path: 'operation',
      });
    } else {
      issues.push(...validateOperationTree(dto.operation, inputIds));
    }
    if (dto.sourceCode) {
      issues.push({
        code: 'CODE_ON_OPERATION_KIND',
        message: 'una implementación visual no puede traer código',
        path: 'sourceCode',
      });
    }
  } else {
    if (!dto.sourceCode?.trim()) {
      issues.push({
        code: 'CODE_MISSING',
        message: 'la modalidad por código exige el código fuente',
        path: 'sourceCode',
      });
    } else {
      codeGuard = guardCalculatedFieldCode(
        dto.sourceCode,
        dto.implementationKind,
        allowedLibraryFunctions,
      );
      issues.push(
        ...codeGuard.violations.map((violation) => ({ ...violation, path: 'sourceCode' })),
      );
      issues.push(...validateCodeReferences(dto.sourceCode, inputIds, allowedLibraryFunctions));
    }
    if (dto.operation) {
      issues.push({
        code: 'OPERATION_ON_CODE_KIND',
        message: 'una implementación por código no puede traer árbol de operaciones',
        path: 'operation',
      });
    }
  }

  return { valid: issues.length === 0, issues, codeGuard };
}

/** El árbol solo puede invocar operaciones del catálogo y entradas declaradas. */
function validateOperationTree(tree: unknown, inputIds: ReadonlySet<string>): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > 24) {
      issues.push({
        code: 'OPERATION_TREE_TOO_DEEP',
        message: 'el árbol de operaciones es demasiado profundo',
      });
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if ('literal' in record) return;
    if ('input' in record) {
      const id = String(record.input);
      if (!inputIds.has(id)) {
        issues.push({
          code: 'OPERATION_INPUT_UNKNOWN',
          message: `el árbol referencia la entrada ${id}, que no está declarada`,
        });
      }
      return;
    }
    const operationId = String(record.operation ?? '');
    const definition = OPERATIONS_BY_ID.get(operationId);
    if (!definition) {
      issues.push({
        code: 'OPERATION_UNKNOWN',
        message: `la operación ${operationId || '(vacía)'} no está en el catálogo autorizado`,
      });
      return;
    }
    const args = Array.isArray(record.args) ? record.args : [];
    const requiredCount = definition.args.filter((arg) => arg.required).length;
    if (args.length < requiredCount) {
      issues.push({
        code: 'OPERATION_ARITY_INVALID',
        message: `${operationId} necesita al menos ${requiredCount} argumentos y recibió ${args.length}`,
      });
    }
    if (!definition.variadic && args.length > definition.args.length) {
      issues.push({
        code: 'OPERATION_ARITY_INVALID',
        message: `${operationId} admite como máximo ${definition.args.length} argumentos`,
      });
    }
    for (const arg of args) walk(arg, depth + 1);
  };
  walk(tree, 0);
  return issues;
}

/**
 * El código solo puede leer `variables.<entrada>` declaradas. Una referencia a algo no
 * declarado significa que el contrato miente sobre lo que el campo necesita.
 */
function validateCodeReferences(
  source: string,
  inputIds: ReadonlySet<string>,
  allowedLibraryFunctions: readonly string[],
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const referenced = new Set<string>();
  for (const match of source.matchAll(
    /variables\s*(?:\.\s*([a-zA-Z_][a-zA-Z0-9_]*)|\[\s*['"]([^'"]+)['"]\s*\])/g,
  )) {
    referenced.add(match[1] ?? match[2]);
  }
  for (const match of source.matchAll(/variables\s*\.\s*get\s*\(\s*['"]([^'"]+)['"]/g)) {
    referenced.add(match[1]);
  }
  for (const id of referenced) {
    if (id === 'get') continue;
    if (!inputIds.has(id)) {
      issues.push({
        code: 'CODE_INPUT_UNKNOWN',
        message: `el código usa la entrada ${id}, que no está declarada en el contrato`,
        path: 'sourceCode',
      });
    }
  }
  // Uso de un espacio de nombres de librería no seleccionado.
  for (const match of source.matchAll(/\b(math|statistics|finance|dates)\s*[._]/g)) {
    const namespace = match[1];
    if (
      !allowedLibraryFunctions.some(
        (fn) => fn.startsWith(`${namespace}.`) || fn.startsWith(`${namespace}_`),
      )
    ) {
      issues.push({
        code: 'LIBRARY_NOT_SELECTED',
        message: `el código usa la librería ${namespace}, que no está seleccionada en esta versión`,
        path: 'sourceCode',
      });
    }
  }
  return issues;
}
