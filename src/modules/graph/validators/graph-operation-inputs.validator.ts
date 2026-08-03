/**
 * Cobertura de variables: el árbol debe declarar lo que sus operaciones consumen.
 *
 * Regla: las variables de entrada declaradas por el algoritmo deben contener, como
 * mínimo, TODAS las que exigen los campos calculados invocados en sus nodos. El
 * árbol puede declarar más, nunca menos.
 *
 * Es distinta de la validación del mapeo (`graph-calculated-field.validator`), que
 * comprueba que cada entrada del campo esté alimentada y con el tipo correcto. Aquí
 * se mira el contrato PÚBLICO del artefacto: de nada sirve un mapeo coherente si el
 * dato nunca entra a la decisión, porque en ejecución llegaría vacío.
 *
 * Los mensajes nombran el campo calculado y la variable concreta: un
 * «datos inválidos» obligaría a adivinar cuál de veinte entradas falta.
 */
import type { ArtifactGraphSnapshot, ValidationIssue } from '../graph.types';
import type { GraphLookups } from './graph-lookups';
import { issue } from './validation-issue';

export interface GraphOperationInputsResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

interface ContractInput {
  id: string;
  dataType: string;
  required: boolean;
}

export function validateOperationInputs(
  snapshot: ArtifactGraphSnapshot,
  lookups: GraphLookups,
): GraphOperationInputsResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  for (const node of snapshot.nodes) {
    for (const call of node.calculatedFieldCalls ?? []) {
      const name = call.fieldCode || call.callKey;
      const contract = (call.definition?.contract ?? {}) as { inputs?: ContractInput[] };
      const inputs = Array.isArray(contract.inputs) ? contract.inputs : [];

      for (const input of inputs) {
        const entry = call.inputMapping?.[input.id];
        // Sin mapeo lo reporta el validador del mapeo; aquí sólo interesan las
        // que sí apuntan a una variable del contrato del artefacto.
        if (!entry || entry.source !== 'VARIABLE') continue;

        const code = String(entry.path ?? '').split('.')[0];
        if (!code) continue;

        if (lookups.inputCodes.has(code)) continue;

        if (lookups.outputCodes.has(code)) {
          errors.push(
            issue(
              'OPERATION_INPUT_IS_OUTPUT',
              `El campo calculado «${name}» toma «${code}» como entrada, pero «${code}» está declarada como SALIDA del algoritmo: todavía no tiene valor cuando el nodo ${node.key} se ejecuta.`,
              'VARIABLE',
              code,
            ),
          );
          continue;
        }

        errors.push(
          issue(
            'OPERATION_INPUT_NOT_DECLARED',
            `El campo calculado «${name}» requiere la variable «${code}», pero esa variable no está declarada como entrada del algoritmo. Añádela a las variables de entrada del árbol.`,
            'VARIABLE',
            code,
          ),
        );
      }

      // Una entrada opcional sin alimentar no rompe la ejecución, pero suele ser
      // un descuido al añadir la llamada: se avisa sin bloquear la publicación.
      for (const input of inputs) {
        if (input.required) continue;
        if (call.inputMapping?.[input.id]) continue;
        warnings.push(
          issue(
            'OPERATION_OPTIONAL_INPUT_UNMAPPED',
            `El campo calculado «${name}» declara la entrada opcional «${input.id}» y el nodo ${node.key} no la alimenta: se usará su valor por defecto.`,
            'NODE',
            node.key,
            'WARNING',
          ),
        );
      }
    }
  }

  return { errors, warnings };
}
