export interface ReadArm {
  /** Texto de la condición; ausente en el `else` final. */
  condition?: string;
  body: ReadStatement[];
  line: number;
}

export type ReadStatement =
  | { kind: 'assign'; name: string; expression: string; line: number }
  | { kind: 'return'; expression: string; line: number }
  | { kind: 'if'; arms: ReadArm[]; line: number }
  | { kind: 'unsupported'; text: string; line: number };
