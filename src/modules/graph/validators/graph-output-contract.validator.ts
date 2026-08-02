/**
 * Contrato de salida explícito (§4): la salida final NO se infiere del último nodo.
 * Antes de publicar, cada campo obligatorio tiene que tener un origen declarado,
 * alcanzable, del tipo correcto y producido en todos los caminos obligatorios.
 */
import { isTypeAssignable, normalizeDataTypeOrString } from '../../../common/contracts/data-types';
import type { ArtifactGraphSnapshot, GraphNodeSnapshot, ValidationIssue } from '../graph.types';
import type { GraphLookups } from './graph-lookups';
import { issue } from './validation-issue';

export interface GraphOutputContractResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function validateOutputContract(
  snapshot: ArtifactGraphSnapshot,
  lookups: GraphLookups,
): GraphOutputContractResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const outputs = snapshot.variables.filter((variable) =>
    String(variable.usageType ?? '').startsWith('OUTPUT'),
  );
  if (!snapshot.outputContract.length) {
    // Sin contrato explícito el artefacto sigue siendo válido (compatibilidad con lo
    // ya publicado), pero se avisa: es el mecanismo que §4 exige para gobernarlo.
    if (outputs.length) {
      warnings.push(
        issue(
          'OUTPUT_CONTRACT_NOT_DECLARED',
          'El artefacto declara salidas pero no un contrato de salida explícito con su origen',
        ),
      );
    }
    return { errors, warnings };
  }

  const outputsByCode = new Map(outputs.map((variable) => [variable.code, variable]));
  const nodesByKey = new Map(snapshot.nodes.map((node) => [node.key, node]));
  const intermediatesByCode = new Map(
    snapshot.intermediates.map((intermediate) => [intermediate.code, intermediate]),
  );

  // 4. No existen salidas duplicadas / 5. no existen mapeos ambiguos.
  const seen = new Set<string>();
  for (const field of snapshot.outputContract) {
    if (seen.has(field.code)) {
      errors.push(
        issue(
          'OUTPUT_CONTRACT_DUPLICATE',
          `El contrato de salida declara ${field.code} más de una vez`,
          'VARIABLE',
          field.code,
        ),
      );
    }
    seen.add(field.code);
  }

  for (const field of snapshot.outputContract) {
    const declared = outputsByCode.get(field.code);
    // 1. Todo campo del contrato de salida corresponde a una salida tipada declarada.
    if (!declared) {
      errors.push(
        issue(
          'OUTPUT_CONTRACT_UNDECLARED_FIELD',
          `El contrato de salida define ${field.code}, que no está declarado como variable de salida`,
          'VARIABLE',
          field.code,
        ),
      );
      continue;
    }
    // 2. El origen es alcanzable dentro del grafo.
    validateSource(field, declared.dataType, {
      nodesByKey,
      intermediatesByCode,
      lookups,
      errors,
    });
    // 7. No se exponen datos sensibles no autorizados.
    if (
      declared.sensitive &&
      field.tracePolicy === 'FULL' &&
      field.sensitivityClass !== 'PUBLIC' &&
      field.sensitivityClass !== 'INTERNAL'
    ) {
      warnings.push(
        issue(
          'OUTPUT_SENSITIVE_IN_TRACE',
          `El campo ${field.code} es sensible y su política de traza es FULL; considera MASKED o REDACTED`,
          'VARIABLE',
          field.code,
        ),
      );
    }
    // 9. Los caminos alternativos definen correctamente las salidas opcionales.
    if (!declared.required && !field.absenceReasons.length) {
      warnings.push(
        issue(
          'OUTPUT_ABSENCE_REASON_MISSING',
          `El campo opcional ${field.code} no documenta ningún motivo de ausencia`,
          'VARIABLE',
          field.code,
        ),
      );
    }
    if (declared.required && field.absenceReasons.length) {
      errors.push(
        issue(
          'OUTPUT_ABSENCE_ON_REQUIRED',
          `El campo ${field.code} es obligatorio: no puede declarar motivos de ausencia`,
          'VARIABLE',
          field.code,
        ),
      );
    }
  }

  // 1 (recíproco). Toda salida obligatoria tiene un origen en el contrato.
  const contractCodes = new Set(snapshot.outputContract.map((field) => field.code));
  for (const output of outputs) {
    if (!contractCodes.has(output.code)) {
      errors.push(
        issue(
          output.required ? 'REQUIRED_OUTPUT_WITHOUT_SOURCE' : 'OUTPUT_WITHOUT_SOURCE',
          `La salida ${output.code} no declara origen en el contrato de salida`,
          'VARIABLE',
          output.code,
        ),
      );
    }
  }

  // 8. Las salidas obligatorias se producen en todos los caminos terminales.
  errors.push(...validateTerminalCoverage(snapshot, outputs, lookups));

  return { errors, warnings };
}

interface SourceContext {
  nodesByKey: Map<string, GraphNodeSnapshot>;
  intermediatesByCode: Map<string, ArtifactGraphSnapshot['intermediates'][number]>;
  lookups: GraphLookups;
  errors: ValidationIssue[];
}

function validateSource(
  field: ArtifactGraphSnapshot['outputContract'][number],
  declaredType: string,
  context: SourceContext,
): void {
  const { nodesByKey, intermediatesByCode, errors } = context;
  switch (field.sourceKind) {
    case 'NODE':
    case 'REFERENCE': {
      const nodeKey = field.sourceRef.split(':')[0];
      if (!nodesByKey.has(nodeKey)) {
        errors.push(
          issue(
            'OUTPUT_SOURCE_NODE_MISSING',
            `El campo ${field.code} declara como origen el nodo ${nodeKey}, que no existe`,
            'VARIABLE',
            field.code,
          ),
        );
      }
      break;
    }
    case 'INTERMEDIATE': {
      const intermediate = intermediatesByCode.get(field.sourceRef);
      if (!intermediate) break; // ya lo reporta el validador de intermedias
      // 3. El tipo producido coincide con el contrato.
      const from = normalizeDataTypeOrString(intermediate.dataType);
      const to = normalizeDataTypeOrString(declaredType);
      if (!isTypeAssignable(from, to)) {
        errors.push(
          issue(
            'OUTPUT_SOURCE_TYPE_MISMATCH',
            `El campo ${field.code} es ${to} pero la intermedia ${field.sourceRef} produce ${from}`,
            'VARIABLE',
            field.code,
          ),
        );
      }
      break;
    }
    case 'CONSTANT': {
      if (!field.sourceRef.trim()) {
        errors.push(
          issue(
            'OUTPUT_SOURCE_CONSTANT_EMPTY',
            `El campo ${field.code} declara origen CONSTANT sin valor`,
            'VARIABLE',
            field.code,
          ),
        );
      }
      break;
    }
    case 'EXPRESSION':
    default:
      break;
  }
}

/**
 * Cada nodo terminal alcanzable debe poder producir todas las salidas obligatorias.
 * Un nodo RESULT que solo asigna dos de las tres salidas obligatorias hace que la
 * ejecución muera con REQUIRED_OUTPUT_MISSING en producción; es preferible bloquearlo
 * en validación.
 */
function validateTerminalCoverage(
  snapshot: ArtifactGraphSnapshot,
  outputs: ArtifactGraphSnapshot['variables'],
  lookups: GraphLookups,
): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const requiredCodes = outputs
    .filter((output) => output.required && output.defaultValue === undefined)
    .map((output) => output.code);
  if (!requiredCodes.length) return errors;

  for (const node of snapshot.nodes.filter(lookups.isTerminalNode)) {
    if (node.type !== 'RESULT') continue;
    const produced = producedOutputCodes(node);
    // Un RESULT en modo SCRIPT o REFERENCE resuelve sus salidas en ejecución: no se
    // puede saber estáticamente qué claves escribirá, así que no se le exige aquí.
    if (produced === null) continue;
    const missing = requiredCodes.filter((code) => !produced.has(code));
    if (missing.length) {
      errors.push(
        issue(
          'TERMINAL_PATH_MISSING_REQUIRED_OUTPUT',
          `El nodo terminal ${node.key} no produce las salidas obligatorias: ${missing.join(', ')}`,
          'NODE',
          node.key,
        ),
      );
    }
  }
  return errors;
}

/** Códigos de salida que un RESULT escribe, o `null` si no es analizable estáticamente. */
function producedOutputCodes(node: GraphNodeSnapshot): Set<string> | null {
  const mode = String((node.config as { mode?: unknown }).mode ?? 'MAPPING').toUpperCase();
  if (mode !== 'MAPPING') return null;
  const assignments = (node.config as { assignments?: unknown }).assignments;
  if (!Array.isArray(assignments)) return new Set();
  return new Set(
    assignments
      .map((raw) => {
        const assignment = raw as Record<string, unknown>;
        return String(assignment.outputCode ?? assignment.target ?? '');
      })
      .filter(Boolean),
  );
}
