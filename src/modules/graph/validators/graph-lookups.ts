/** Precomputed graph indexes keep validation rules linear and consistent about terminal nodes. */
import type { ArtifactGraphSnapshot } from '../graph.types';

export interface GraphLookups {
  nodeKeys: Set<string>;
  conditionCodes: Set<string>;
  actionCodes: Set<string>;
  variableCodes: Set<string>;
  /**
   * Códigos declarados como ENTRADA del artefacto.
   *
   * Se separan de `variableCodes` porque una salida no está disponible para
   * alimentar un cálculo: aún no existe cuando el nodo se ejecuta. Comprobar
   * contra el conjunto completo dejaba pasar esa confusión.
   */
  inputCodes: Set<string>;
  /** Códigos de variable intermedia declarados por este grafo (§2). */
  intermediateCodes: Set<string>;
  /** Códigos declarados como salida pública del artefacto. */
  outputCodes: Set<string>;
  terminalActionCodes: Set<string>;
  isTerminalNode: (node: ArtifactGraphSnapshot['nodes'][number]) => boolean;
}

export function buildGraphLookups(snapshot: ArtifactGraphSnapshot): GraphLookups {
  const terminalActionCodes = new Set(
    snapshot.actions.filter((action) => action.terminal).map((action) => action.code),
  );
  const isTerminalNode = (node: ArtifactGraphSnapshot['nodes'][number]): boolean =>
    node.terminal ||
    node.type === 'END' ||
    node.type === 'RESULT' ||
    node.type === 'MANUAL_REVIEW' ||
    node.actions.some((reference) => terminalActionCodes.has(reference.code));

  return {
    nodeKeys: new Set(snapshot.nodes.map((node) => node.key)),
    conditionCodes: new Set(snapshot.conditions.map((condition) => condition.code)),
    actionCodes: new Set(snapshot.actions.map((action) => action.code)),
    variableCodes: new Set(snapshot.variables.map((variable) => variable.code)),
    inputCodes: new Set(
      snapshot.variables
        .filter((variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'))
        .map((variable) => variable.code),
    ),
    intermediateCodes: new Set(snapshot.intermediates.map((intermediate) => intermediate.code)),
    outputCodes: new Set(
      snapshot.variables
        .filter((variable) => String(variable.usageType ?? '').startsWith('OUTPUT'))
        .map((variable) => variable.code),
    ),
    terminalActionCodes,
    isTerminalNode,
  };
}
