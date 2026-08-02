/**
 * Reglas de las invocaciones a campos calculados desde el grafo (§5.1, §8).
 *
 * Un campo calculado es reutilizable precisamente porque su contrato se comprueba en
 * cada punto donde se usa: aquí se verifica que las entradas se alimenten con datos que
 * el grafo tiene de verdad y que el valor devuelto quepa donde se guarda.
 */
import { isTypeAssignable, normalizeDataTypeOrString } from '../../../common/contracts/data-types';
import type {
  ArtifactGraphSnapshot,
  CalculatedFieldCallSnapshot,
  ValidationIssue,
} from '../graph.types';
import type { GraphLookups } from './graph-lookups';
import { issue } from './validation-issue';

export interface GraphCalculatedFieldResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

interface ContractInput {
  id: string;
  dataType: string;
  required: boolean;
}

export function validateGraphCalculatedFields(
  snapshot: ArtifactGraphSnapshot,
  lookups: GraphLookups,
): GraphCalculatedFieldResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const intermediatesByCode = new Map(
    snapshot.intermediates.map((intermediate) => [intermediate.code, intermediate]),
  );
  const outputsByCode = new Map(
    snapshot.variables
      .filter((variable) => String(variable.usageType ?? '').startsWith('OUTPUT'))
      .map((variable) => [variable.code, variable]),
  );

  const seenCallKeys = new Set<string>();
  for (const node of snapshot.nodes) {
    for (const call of node.calculatedFieldCalls ?? []) {
      const label = `${node.key}/${call.callKey}`;
      if (seenCallKeys.has(label)) {
        errors.push(
          issue(
            'CALCULATED_FIELD_CALL_DUPLICATE',
            `El nodo ${node.key} declara dos veces la llamada ${call.callKey}`,
            'NODE',
            node.key,
          ),
        );
      }
      seenCallKeys.add(label);

      if (!call.calculatedFieldVersionId) {
        errors.push(
          issue(
            'CALCULATED_FIELD_VERSION_UNPINNED',
            `La llamada ${label} no fija una versión del campo calculado; una decisión dejaría de ser reproducible`,
            'NODE',
            node.key,
          ),
        );
      }

      const contract = (call.definition?.contract ?? {}) as {
        inputs?: ContractInput[];
        returns?: { dataType?: string; nullable?: boolean };
      };
      const inputs = Array.isArray(contract.inputs) ? contract.inputs : [];
      if (!call.definition?.implementationKind) {
        errors.push(
          issue(
            'CALCULATED_FIELD_DEFINITION_MISSING',
            `La llamada ${label} no lleva embebida la definición del campo calculado`,
            'NODE',
            node.key,
          ),
        );
        continue;
      }

      validateInputMapping({ node, call, label, inputs, lookups, intermediatesByCode, errors });
      validateTarget({
        node,
        call,
        label,
        returnType: String(contract.returns?.dataType ?? 'STRING'),
        intermediatesByCode,
        outputsByCode,
        errors,
        warnings,
      });
    }
  }

  return { errors, warnings };
}

interface InputMappingContext {
  node: ArtifactGraphSnapshot['nodes'][number];
  call: CalculatedFieldCallSnapshot;
  label: string;
  inputs: ContractInput[];
  lookups: GraphLookups;
  intermediatesByCode: Map<string, ArtifactGraphSnapshot['intermediates'][number]>;
  errors: ValidationIssue[];
}

function validateInputMapping(context: InputMappingContext): void {
  const { node, call, label, inputs, lookups, intermediatesByCode, errors } = context;
  const mapping = call.inputMapping ?? {};

  for (const input of inputs) {
    const entry = mapping[input.id];
    if (!entry) {
      if (input.required) {
        errors.push(
          issue(
            'CALCULATED_FIELD_INPUT_UNMAPPED',
            `La llamada ${label} no alimenta la entrada obligatoria ${input.id}`,
            'NODE',
            node.key,
          ),
        );
      }
      continue;
    }
    if (entry.source === 'VARIABLE') {
      const code = String(entry.path ?? '').split('.')[0];
      if (!code || !lookups.variableCodes.has(code)) {
        errors.push(
          issue(
            'CALCULATED_FIELD_INPUT_SOURCE_MISSING',
            `La llamada ${label} alimenta ${input.id} desde ${entry.path || '(vacío)'}, que no es una variable declarada`,
            'NODE',
            node.key,
          ),
        );
      }
    }
    if (entry.source === 'INTERMEDIATE') {
      const code = String(entry.path ?? '');
      const intermediate = intermediatesByCode.get(code);
      if (!intermediate) {
        errors.push(
          issue(
            'CALCULATED_FIELD_INPUT_SOURCE_MISSING',
            `La llamada ${label} alimenta ${input.id} desde la intermedia ${code || '(vacía)'}, que no está declarada`,
            'NODE',
            node.key,
          ),
        );
      } else if (
        !isTypeAssignable(
          normalizeDataTypeOrString(intermediate.dataType),
          normalizeDataTypeOrString(input.dataType),
        )
      ) {
        errors.push(
          issue(
            'CALCULATED_FIELD_INPUT_TYPE_MISMATCH',
            `La intermedia ${code} es ${intermediate.dataType} y la entrada ${input.id} espera ${input.dataType}`,
            'NODE',
            node.key,
          ),
        );
      }
    }
  }

  // Alimentar algo que el campo no declara suele significar que el contrato cambió y el
  // grafo se quedó con el mapeo antiguo.
  const declared = new Set(inputs.map((input) => input.id));
  for (const key of Object.keys(mapping)) {
    if (!declared.has(key)) {
      errors.push(
        issue(
          'CALCULATED_FIELD_INPUT_UNKNOWN',
          `La llamada ${label} mapea ${key}, que el campo calculado no declara como entrada`,
          'NODE',
          node.key,
        ),
      );
    }
  }
}

interface TargetContext {
  node: ArtifactGraphSnapshot['nodes'][number];
  call: CalculatedFieldCallSnapshot;
  label: string;
  returnType: string;
  intermediatesByCode: Map<string, ArtifactGraphSnapshot['intermediates'][number]>;
  outputsByCode: Map<string, ArtifactGraphSnapshot['variables'][number]>;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function validateTarget(context: TargetContext): void {
  const { node, call, label, returnType, intermediatesByCode, outputsByCode, errors } = context;
  const target = call.target;
  if (!target?.code) {
    errors.push(
      issue(
        'CALCULATED_FIELD_TARGET_MISSING',
        `La llamada ${label} no indica dónde guardar el resultado`,
        'NODE',
        node.key,
      ),
    );
    return;
  }

  const from = normalizeDataTypeOrString(returnType);
  if (target.kind === 'INTERMEDIATE') {
    const intermediate = intermediatesByCode.get(target.code);
    if (!intermediate) {
      errors.push(
        issue(
          'CALCULATED_FIELD_TARGET_MISSING',
          `La llamada ${label} guarda en la intermedia ${target.code}, que no está declarada`,
          'NODE',
          node.key,
        ),
      );
      return;
    }
    // Escribir una intermedia sigue las mismas reglas que cualquier otra escritura: solo
    // su nodo productor puede hacerlo (§2.3).
    if (intermediate.producerNodeKey !== node.key) {
      errors.push(
        issue(
          'INTERMEDIATE_WRITE_UNAUTHORIZED',
          `Solo ${intermediate.producerNodeKey} puede escribir ${target.code}; lo intenta la llamada ${label}`,
          'NODE',
          node.key,
        ),
      );
    }
    assertAssignable(from, intermediate.dataType, label, target.code, node.key, errors);
    return;
  }

  const output = outputsByCode.get(target.code);
  if (!output) {
    errors.push(
      issue(
        'CALCULATED_FIELD_TARGET_MISSING',
        `La llamada ${label} guarda en la salida ${target.code}, que no está declarada`,
        'NODE',
        node.key,
      ),
    );
    return;
  }
  assertAssignable(from, output.dataType, label, target.code, node.key, errors);
}

function assertAssignable(
  from: ReturnType<typeof normalizeDataTypeOrString>,
  rawTo: string,
  label: string,
  targetCode: string,
  nodeKey: string,
  errors: ValidationIssue[],
): void {
  const to = normalizeDataTypeOrString(rawTo);
  if (!isTypeAssignable(from, to)) {
    errors.push(
      issue(
        'CALCULATED_FIELD_RETURN_TYPE_MISMATCH',
        `La llamada ${label} devuelve ${from} y ${targetCode} es ${to}`,
        'NODE',
        nodeKey,
      ),
    );
  }
}

/** Códigos de intermedia que escribe una llamada a campo calculado en este nodo. */
export function calculatedFieldTargets(node: ArtifactGraphSnapshot['nodes'][number]): string[] {
  return (node.calculatedFieldCalls ?? [])
    .filter((call) => call.target?.kind === 'INTERMEDIATE')
    .map((call) => call.target.code);
}
