import { Injectable } from '@nestjs/common';
import type { DecisionBranch } from './branch-extractor.service';
import type { CodeImportIR, GeneratedGraphPreview } from './code-import.types';

const START_KEY = 'START';
const RESULT_KEY = 'CODE_IMPORT_RESULT';

/**
 * Convierte la IR en el grafo que se escribirá en el artefacto.
 *
 * Cuando el análisis logró derivar las ramas del código (ver
 * branch-extractor.service.ts) se genera un ÁRBOL DE DECISIÓN de verdad: una
 * condición por cada `if/elif` y un nodo RESULT por cada rama, encadenados por la
 * salida "no" de cada condición. Eso es lo que hace que el algoritmo importado se
 * pueda revisar, cubrir con pruebas y explicar nodo a nodo.
 *
 * Si el código usa algo fuera del subconjunto traducible se mantiene el
 * comportamiento anterior: START -> RESULT en modo SCRIPT, que reutiliza tal cual
 * el runner de scripts del motor. Ver docs/code-to-flow-specification.md.
 */
@Injectable()
export class GraphGeneratorService {
  /**
   * @param knownReasonCodes códigos del catálogo de motivos del tenant. Cuando el
   * valor literal que escribe una rama coincide con uno, se genera la acción que
   * lo EMITE de verdad en vez de dejarlo como una cadena suelta en la salida.
   */
  generate(
    ir: CodeImportIR,
    knownReasonCodes: ReadonlySet<string> = new Set(),
  ): GeneratedGraphPreview {
    const dependencies = this.dependencies(ir);
    const branches = ir.branches ?? [];
    return branches.length
      ? { dependencies, ...this.decisionTree(branches, ir.contract, knownReasonCodes) }
      : { dependencies, ...this.scriptGraph(ir) };
  }

  private dependencies(ir: CodeImportIR): GeneratedGraphPreview['dependencies'] {
    const contract = ir.contract;
    const primaryOutputId = contract.primaryOutputId ?? contract.outputs[0]?.id;
    return [
      ...contract.inputs.map((variable) => ({
        variableCode: variable.id,
        usageType: 'INPUT' as const,
        dependencyPath: `input.${variable.id}`,
        dataType: variable.type,
        required: variable.required,
      })),
      ...contract.outputs.map((variable) => ({
        variableCode: variable.id,
        usageType: (variable.id === primaryOutputId ? 'OUTPUT_PRIMARY' : 'OUTPUT') as
          'OUTPUT_PRIMARY' | 'OUTPUT',
        dependencyPath: `output.${variable.id}`,
        dataType: variable.type,
        required: variable.required,
      })),
    ];
  }

  private scriptGraph(ir: CodeImportIR): Omit<GeneratedGraphPreview, 'dependencies'> {
    return {
      nodes: [
        { key: START_KEY, type: 'START', label: 'Inicio', config: {} },
        {
          key: RESULT_KEY,
          type: 'RESULT',
          label: 'Código importado',
          config: {
            mode: 'SCRIPT',
            script: { language: ir.language, source: ir.scriptBody },
          },
        },
      ],
      edges: [{ key: 'START_CODE_IMPORT_RESULT', from: START_KEY, to: RESULT_KEY, default: true }],
      conditions: [],
    };
  }

  /**
   * `if A -> R1 / elif B -> R2 / else -> R3` se dibuja como una escalera:
   *
   *   START → CHECK_1 --sí--> RESULT_1
   *              │no
   *              ↓
   *            CHECK_2 --sí--> RESULT_2
   *              │no
   *              ↓
   *            RESULT_3
   */
  private decisionTree(
    branches: DecisionBranch[],
    contract: CodeImportIR['contract'],
    knownReasonCodes: ReadonlySet<string>,
  ): Omit<GeneratedGraphPreview, 'dependencies'> {
    const nodes: GeneratedGraphPreview['nodes'] = [
      { key: START_KEY, type: 'START', label: 'Inicio', config: {} },
    ];
    const edges: GeneratedGraphPreview['edges'] = [];
    const conditions: NonNullable<GeneratedGraphPreview['conditions']> = [];
    const actions = new Map<string, NonNullable<GeneratedGraphPreview['actions']>[number]>();

    const conditional = branches.filter((branch) => branch.condition !== undefined);
    const fallback = branches.find((branch) => branch.condition === undefined);

    /**
     * Entrada de una rama: el nodo que se ejecuta al cumplirse su condición. Si la
     * rama emite un motivo del catálogo, delante del resultado se coloca un nodo
     * ACTION que lo EMITE (el motor sólo ejecuta acciones en nodos ACTION), y de
     * ahí se pasa al resultado.
     */
    const entryOf = (branch: DecisionBranch, resultKey: string, suffix: string): string => {
      const reasonCode = reasonOf(branch, contract, knownReasonCodes);
      if (!reasonCode) return resultKey;
      const actionCode = `EMIT_${reasonCode}`;
      const reasonKey = `REASON_${suffix}`;
      actions.set(actionCode, { code: actionCode, type: 'EMIT_REASON', reasonCode });
      nodes.push({
        key: reasonKey,
        type: 'ACTION',
        label: `Motivo: ${reasonCode}`,
        config: {},
        actions: [{ actionCode, order: 1 }],
      });
      edges.push({
        key: `E_${reasonKey}_${resultKey}`,
        from: reasonKey,
        to: resultKey,
        default: true,
      });
      return reasonKey;
    };

    conditional.forEach((branch, index) => {
      const checkKey = `CHECK_${index + 1}`;
      const resultKey = `RESULT_${index + 1}`;
      const conditionCode = `COND_${index + 1}`;
      conditions.push({
        code: conditionCode,
        name: branch.conditionSource ?? `Condición ${index + 1}`,
        expression: branch.condition,
      });
      nodes.push({
        key: checkKey,
        type: 'CONDITION',
        label: label(branch.conditionSource, `Condición ${index + 1}`),
        config: { conditionCode },
      });
      nodes.push({
        key: resultKey,
        type: 'RESULT',
        label: resultLabel(branch, index + 1),
        config: { mode: 'MAPPING', assignments: assignmentsOf(branch) },
      });
      edges.push({
        key: `E_${checkKey}_YES`,
        from: checkKey,
        to: entryOf(branch, resultKey, String(index + 1)),
        default: false,
        conditionCode,
      });
      const nextKey =
        index + 1 < conditional.length
          ? `CHECK_${index + 2}`
          : (fallbackEntry(fallback, contract, knownReasonCodes) ?? resultKey);
      if (nextKey !== resultKey) {
        edges.push({ key: `E_${checkKey}_NO`, from: checkKey, to: nextKey, default: true });
      }
    });

    if (fallback) {
      nodes.push({
        key: FALLBACK_RESULT_KEY,
        type: 'RESULT',
        label: resultLabel(fallback, 0),
        config: { mode: 'MAPPING', assignments: assignmentsOf(fallback) },
      });
      entryOf(fallback, FALLBACK_RESULT_KEY, 'DEFAULT');
    }
    const firstKey = conditional.length
      ? 'CHECK_1'
      : (fallbackEntry(fallback, contract, knownReasonCodes) ?? FALLBACK_RESULT_KEY);
    edges.unshift({ key: `E_START_${firstKey}`, from: START_KEY, to: firstKey, default: true });
    return { nodes, edges, conditions, actions: [...actions.values()] };
  }
}

const FALLBACK_RESULT_KEY = 'RESULT_DEFAULT';

/** Nodo al que entra la rama por defecto (su emisor de motivo, si lo tiene). */
function fallbackEntry(
  fallback: DecisionBranch | undefined,
  contract: CodeImportIR['contract'],
  knownReasonCodes: ReadonlySet<string>,
): string | undefined {
  if (!fallback) return undefined;
  return reasonOf(fallback, contract, knownReasonCodes) ? 'REASON_DEFAULT' : FALLBACK_RESULT_KEY;
}

/**
 * Motivo del catálogo que escribe la rama. Se mira primero la salida declarada
 * como `reasonOutputId`; si el contrato no la declara, vale cualquier salida de
 * texto cuyo literal sea un reason code existente. No se inventan motivos: un
 * literal que nadie declaró en el catálogo se queda como estaba.
 */
function reasonOf(
  branch: DecisionBranch,
  contract: CodeImportIR['contract'],
  knownReasonCodes: ReadonlySet<string>,
): string | undefined {
  if (!knownReasonCodes.size) return undefined;
  const candidates = contract.reasonOutputId
    ? branch.assignments.filter((assignment) => assignment.outputId === contract.reasonOutputId)
    : branch.assignments;
  for (const assignment of candidates) {
    if (!assignment.isLiteral || typeof assignment.literal !== 'string') continue;
    if (knownReasonCodes.has(assignment.literal)) return assignment.literal;
  }
  return undefined;
}

function assignmentsOf(branch: DecisionBranch) {
  return branch.assignments.map((assignment) =>
    assignment.isLiteral
      ? { outputCode: assignment.outputId, source: 'LITERAL', value: assignment.literal }
      : {
          outputCode: assignment.outputId,
          source: 'EXPRESSION',
          expression: assignment.expression,
        },
  );
}

/** Etiqueta legible: el primer resultado literal de la rama, o su número. */
function resultLabel(branch: DecisionBranch, index: number): string {
  const literal = branch.assignments.find(
    (assignment) => assignment.isLiteral && typeof assignment.literal === 'string',
  );
  if (literal) return `Resultado: ${String(literal.literal)}`;
  return index ? `Resultado ${index}` : 'Resultado por defecto';
}

function label(source: string | undefined, fallbackLabel: string): string {
  if (!source) return fallbackLabel;
  const clean = source.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean;
}
