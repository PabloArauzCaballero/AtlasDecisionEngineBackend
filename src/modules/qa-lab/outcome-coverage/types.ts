export interface OutcomeCase {
  index: number;
  kind: 'OUTCOME';
  /** Nodo terminal que el caso persigue. */
  nodeKey: string;
  /** Cómo se llama ese desenlace en la pantalla: la etiqueta del nodo o su acción. */
  outcome: string;
  /** Camino de nodos, para explicar por qué se espera ese final. */
  path: string[];
  input: Record<string, unknown>;
  /** Condiciones que no se pueden forzar desde la entrada; ver la nota de cabecera. */
  unresolved: string[];
  unsatisfiable?: string[];
}
