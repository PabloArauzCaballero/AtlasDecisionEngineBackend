import type { DistributionShape } from '../seeded-random';

/**
 * Cómo se reparten los valores de UNA variable dentro de su rango (§10.4).
 *
 * Sin esto el generador reparte uniformemente, que es justo lo que infrarrepresenta los
 * casos que más interesan: si el 3 % de la cartera real cobra el mínimo, un lote uniforme
 * apenas roza ese tramo y la política que lo rechaza mal se publica sin haberse probado.
 * La distribución NO relaja el contrato: sesga dónde caen los valores, nunca genera uno
 * que las restricciones prohíban.
 */
export interface VariableDistribution {
  shape?: DistributionShape;
  /** Pesos relativos por valor, solo para variables con enumeración cerrada. */
  valueWeights?: Record<string, number>;
}

export type DistributionMap = Readonly<Record<string, VariableDistribution>>;

export interface GeneratorContractVariable {
  code: string;
  dataType: string;
  required: boolean;
  nullable: boolean;
  defaultValue?: unknown;
  constraints?: unknown;
}

export interface ValidValueResult {
  value: unknown;
  /** `false` cuando ningún valor puede satisfacer el contrato tal como está declarado. */
  satisfied: boolean;
}
