/**
 * El contrato de salida de un artefacto, visto desde el generador documental.
 *
 * Es un PUERTO y no una consulta a la base por el mismo motivo que todo lo demás
 * aquí: `src/pdf-worker/` no importa nada del motor, y eso es lo que permite
 * desplegarlo aparte. El adaptador que lee `decision_output_contract_field` vive
 * FUERA de esta carpeta —en `src/modules/artifacts/`— y se inyecta al componer
 * el módulo. Sin él, el worker sigue funcionando: lo que desaparece es la
 * función de casar plantillas con artefactos, no el generador.
 *
 * **El tipo lo resuelve el adaptador, no el dominio.** `decision_output_contract_field`
 * no guarda el tipo de dato: lo hereda de la variable o del nodo que produce el
 * valor. Quien tiene esa información es el motor, así que es él quien la resuelve
 * y quien puede devolver `unknown` cuando no llega a hacerlo. El dominio no
 * inventa: un tipo desconocido se compara como desconocido y se dice.
 */

/** Tipos ya normalizados al vocabulario del generador. `unknown` es una respuesta legítima. */
export type ArtifactFieldType =
  'string' | 'number' | 'integer' | 'boolean' | 'date' | 'enum' | 'array' | 'object' | 'unknown';

export interface ArtifactOutputField {
  readonly fieldCode: string;
  readonly name: string;
  readonly description?: string;
  readonly type: ArtifactFieldType;
  /** Un campo opcional del contrato puede faltar en una decisión concreta. */
  readonly required: boolean;
  /** Valores publicables, si el campo los tiene acotados. */
  readonly allowedValues?: readonly string[];
  /** Ejemplo declarado en el contrato. Es lo que alimenta el dato de prueba. */
  readonly example?: unknown;
}

export interface ArtifactOutputContract {
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly title: string;
  readonly fields: readonly ArtifactOutputField[];
}

export interface ArtifactSummary {
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly title: string;
  readonly outputFieldCount: number;
}

export interface ArtifactContractPort {
  /** `false` cuando el generador corre suelto y nadie provee el contrato. */
  readonly available: boolean;
  list(): Promise<readonly ArtifactSummary[]>;
  get(artifactId: string, version?: string): Promise<ArtifactOutputContract | undefined>;
}

export const ARTIFACT_CONTRACT_PORT = Symbol('ArtifactContractPort');
