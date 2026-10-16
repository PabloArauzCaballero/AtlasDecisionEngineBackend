/**
 * Interpretación de la llamada a servicio que declara un nodo `WORKER`.
 *
 * Vive fuera del motor y fuera del validador porque los dos necesitan leer exactamente lo
 * mismo: si el validador aceptara una forma y el motor entendiera otra, un grafo aprobado
 * podría fallar en producción por un campo que nadie comprobó. Aquí se interpreta una vez
 * y se falla cerrado ante cualquier forma que no se entienda.
 */
export type { WorkerCallParseResult, WorkerCallProblem } from './constants';
export { parseWorkerCall, requireWorkerCall } from './parse-call';
export { workerArgumentIntermediatesOf, workerOutputCodesOf } from './queries';
