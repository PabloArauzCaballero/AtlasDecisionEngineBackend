import type { ArtifactGraphSnapshot } from '../graph.types';

export interface GraphLookups {
  nodeKeys: Set<string>;
  conditionCodes: Set<string>;
  actionCodes: Set<string>;
  variableCodes: Set<string>;
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
    terminalActionCodes,
    isTerminalNode,
  };
}
