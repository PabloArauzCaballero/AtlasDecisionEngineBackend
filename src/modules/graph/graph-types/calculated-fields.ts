/**
 * Invocación de un campo calculado desde un nodo del grafo (§5.1).
 *
 * La definición del campo viaja EMBEBIDA en el artefacto compilado, no se consulta en
 * ejecución. Así una decisión sigue siendo reproducible aunque el campo se deprecie o se
 * republique después, igual que ocurre con las variables y las condiciones.
 */
export interface CalculatedFieldCallSnapshot {
  /** Identificador de la llamada dentro del nodo. */
  callKey: string;
  fieldCode: string;
  /** Versión fijada del campo calculado. */
  calculatedFieldVersionId: string;
  versionNumber: number;
  /** Cómo se alimenta cada entrada del campo: `{ [inputId]: origen }`. */
  inputMapping: Record<
    string,
    {
      source: 'VARIABLE' | 'INTERMEDIATE' | 'LITERAL' | 'EXPRESSION';
      path?: string;
      value?: unknown;
      expression?: unknown;
    }
  >;
  /** Dónde se deja el resultado. */
  target: { kind: 'INTERMEDIATE' | 'OUTPUT'; code: string };
  /** Definición congelada, lista para ejecutarse sin tocar la base de datos. */
  definition: {
    implementationKind: 'OPERATION' | 'JAVASCRIPT' | 'PYTHON';
    contract: unknown;
    operation?: unknown;
    sourceCode?: string;
    libraryPackages: string[];
    defaultValue?: unknown;
    timeoutMs?: number;
  };
}

/** Una invocación de campo calculado tal como ocurrió, para la traza (§12). */
export interface CalculatedFieldTraceEntry {
  nodeKey: string;
  callKey: string;
  fieldCode: string;
  versionNumber: number;
  target: string;
  outcome: 'VALID' | 'NULL_BY_POLICY' | 'DEFAULTED' | 'ERROR';
  durationMs: number;
  value?: unknown;
  errorCode?: string;
}
