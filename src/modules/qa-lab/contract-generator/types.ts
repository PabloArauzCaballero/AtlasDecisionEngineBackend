/** Clase de caso generado. Determina qué se espera de la ejecución. */
export type CaseKind = 'VALID' | 'BOUNDARY' | 'INVALID';

export interface GeneratedCase {
  index: number;
  kind: CaseKind;
  /** Qué se manipuló para hacerlo inválido/frontera, para el informe. */
  mutation?: string;
  input: Record<string, unknown>;
  /**
   * Códigos cuyo contrato es contradictorio y para los que NINGÚN valor es válido
   * (`format: EMAIL` con `maxLength: 4`, `min` mayor que `max`…). Se declara en vez de
   * silenciarse: el caso se entrega igual, pero quien lo lea sabe que ese campo no
   * describe una entrada legítima y que lo que hay que arreglar es el contrato.
   */
  unsatisfiable?: string[];
}

export interface GenerationMix {
  /** Porcentajes; se normalizan si no suman 100. */
  validPercent: number;
  invalidPercent: number;
  boundaryPercent: number;
}
