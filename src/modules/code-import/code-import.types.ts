import type { DecisionBranch } from './branch-extractor.service';
import type { NodeType } from '../graph/graph.types';

/**
 * Code -> Flow generator (Fase 5). See docs/code-to-flow-specification.md for the
 * full pipeline narrative and the intermediate representation (IR) this file types.
 */

export type ImportLanguage = 'JAVASCRIPT' | 'PYTHON';

/** Data types accepted in a contract variable — the same vocabulary the rest of the
 *  engine already uses for DecisionVariableVersion.dataType / RESULT output typing. */
export type ContractDataType =
  'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'DATETIME' | 'OBJECT' | 'ARRAY';

export interface ContractVariable {
  /** Stable identifier — becomes the variable code and the property name the script
   *  reads (inputs) or writes (outputs) at runtime. */
  id: string;
  name: string;
  type: ContractDataType;
  required: boolean;
  default?: unknown;
}

/** The versioned metadata contract extracted from an `@atlas-contract` block. */
export interface MetadataContract {
  contractVersion: string;
  inputs: ContractVariable[];
  outputs: ContractVariable[];
  /** id of the output written to `outcome`/the legacy primary result; defaults to the
   *  first declared output when omitted. */
  primaryOutputId?: string;
  /**
   * id de la salida que lleva el MOTIVO de la decisión (p. ej. `motivo`).
   *
   * Cuando se declara, el importador deja de tratar ese valor como una cadena
   * suelta: si coincide con un reason code del catálogo, genera una acción
   * `EMIT_REASON` que lo emite de verdad, y así la decisión importada se puede
   * filtrar por motivo, explicar al cliente y auditar. Si se omite, se busca la
   * coincidencia en cualquier salida de texto.
   */
  reasonOutputId?: string;
}

export type IssueSeverity = 'ERROR' | 'WARNING';
export type IssueSource = 'SYNTAX' | 'CONTRACT' | 'SECURITY' | 'GRAPH';

export interface LineIssue {
  source: IssueSource;
  severity: IssueSeverity;
  line: number;
  column?: number;
  message: string;
  code: string;
}

/**
 * Common intermediate representation the pipeline produces regardless of source
 * language, and from which the graph generator deterministically builds a
 * ReplaceGraphDto-shaped snapshot. Keeping this language-agnostic (rather than
 * generating JS-specific or Python-specific graph shapes) is what lets both
 * languages reuse the exact same downstream graph generation/validation/execution
 * path — the only language-specific step is contract extraction + syntax/security
 * analysis; everything after IR construction is identical.
 */
export interface CodeImportIR {
  irVersion: '1';
  language: ImportLanguage;
  sourceChecksum: string;
  contract: MetadataContract;
  /** The script body with the `@atlas-contract` header stripped, as it will be
   *  stored in the generated RESULT node's `config.script.source`. */
  scriptBody: string;
  /** Ramas derivadas del `if/elif/else` del código (branch-extractor.service.ts).
   *  Vacío o ausente cuando el código no es traducible a un árbol: entonces se
   *  genera el nodo único en modo SCRIPT. */
  branches?: DecisionBranch[];
}

export interface AnalyzeCodeImportResult {
  ir: CodeImportIR;
  issues: LineIssue[];
  /** Preview of the graph that would be written — same shape accepted by
   *  ArtifactGraphWriterService.replaceDraftGraph. */
  generatedGraph: GeneratedGraphPreview;
}

export interface GeneratedGraphPreview {
  dependencies: Array<{
    variableCode: string;
    usageType: 'INPUT' | 'OUTPUT' | 'OUTPUT_PRIMARY';
    dependencyPath: string;
    dataType: ContractDataType;
    required: boolean;
  }>;
  nodes: Array<{
    key: string;
    type: NodeType;
    label: string;
    config: Record<string, unknown>;
    /** Acciones que ejecuta el nodo, por código (sólo nodos ACTION). */
    actions?: Array<{ actionCode: string; order: number }>;
  }>;
  edges: Array<{
    key: string;
    from: string;
    to: string;
    default: boolean;
    /** Condición que habilita la arista (rama "sí" de un `if`). */
    conditionCode?: string;
  }>;
  /** Condiciones reutilizables que el grafo generado necesita declarar. */
  conditions?: Array<{ code: string; name: string; expression: unknown }>;
  /** Acciones declaradas por el grafo generado (hoy, emisión de motivos). */
  actions?: Array<{ code: string; type: 'EMIT_REASON'; reasonCode: string }>;
}
