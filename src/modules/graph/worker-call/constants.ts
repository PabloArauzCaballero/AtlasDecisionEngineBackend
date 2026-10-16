import type { WorkerArgumentBinding, WorkerCallSnapshot } from '../graph.types';

/** Orígenes admitidos para un argumento de la llamada. */
export const ARGUMENT_SOURCES = new Set<WorkerArgumentBinding['source']>([
  'VARIABLE',
  'INTERMEDIATE',
  'LITERAL',
  'EXPRESSION',
  'TEMPLATE',
]);

/**
 * Raíces admitidas en la ruta de una proyección.
 *
 * `result` es la respuesta del servicio y `call` los metadatos de la llamada. Una ruta con
 * cualquier otra raíz se rechaza en vez de resolverse a `undefined`: sin esto, un `path`
 * mal escrito produciría una intermedia silenciosamente vacía y una decisión tomada sobre
 * un hueco.
 */
export const PATH_ROOTS = new Set(['result', 'call']);

/** Un problema en la configuración, con la ruta donde está. */
export interface WorkerCallProblem {
  code: string;
  message: string;
  path?: string;
}

export interface WorkerCallParseResult {
  call?: WorkerCallSnapshot;
  problems: WorkerCallProblem[];
}
