import { Prisma, WorkerRunStatus } from '@prisma/client';

/**
 * Todo lo que ocupa sitio sin mostrar nada.
 *
 * `\s` no basta: los espacios de ancho cero (U+200B–U+200D), la marca de orden
 * de bytes (U+FEFF), el guion suave (U+00AD) y las marcas de direccionalidad
 * (U+200E–U+200F, U+202A–U+202E, U+2066–U+2069) NO son espacio en blanco para
 * el motor de expresiones regulares, así que un texto compuesto sólo por ellos
 * tiene longitud y no tiene contenido. Es exactamente la entrada que hay que
 * rechazar antes de gastar una llamada al proveedor de modelos.
 *
 * Escrito con escapes y no con los caracteres literales: en el fuente son
 * invisibles, y una regla que nadie puede leer es una regla que nadie revisa.
 */
export const INVISIBLE_RUN =
  /[\s\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]+/g;

export const RUN_SELECTION = {
  requestId: true,
  status: true,
  progress: true,
  inputSource: true,
  fixtureCode: true,
  resultJson: true,
  warningsJson: true,
  errorCode: true,
  errorMessage: true,
  attemptCount: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: true,
  correlationId: true,
} satisfies Prisma.SemanticAnalysisRunSelect;

export type SemanticRunView = Prisma.SemanticAnalysisRunGetPayload<{
  select: typeof RUN_SELECTION;
}>;

export const TERMINAL_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.SUCCEEDED,
  WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
  WorkerRunStatus.FAILED,
  WorkerRunStatus.CANCELLED,
];

/**
 * Alta y consulta de análisis semánticos.
 *
 * Igual que su equivalente de extractos, no analiza nada: escribe la fila,
 * anuncia el trabajo y responde. El análisis lo hace el processor absorbido,
 * en el proceso worker.
 */
