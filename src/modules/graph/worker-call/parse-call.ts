import { DomainException } from '../../../common/errors/domain-exception';
import type { GraphNodeSnapshot, WorkerCallSnapshot } from '../graph.types';
import { WorkerCallParseResult, WorkerCallProblem } from './constants';
import { parseArguments } from './parse-arguments';
import { parseOutputs } from './parse-outputs';

/**
 * Lee la configuración de un nodo `WORKER` y acumula TODOS sus problemas.
 *
 * Acumula en vez de abortar en el primero porque el consumidor principal es el validador
 * de grafo, y a un autor le sirve de poco arreglar un error por validación cuando tiene
 * cuatro.
 */
export function parseWorkerCall(node: GraphNodeSnapshot): WorkerCallParseResult {
  const problems: WorkerCallProblem[] = [];
  const config = node.config ?? {};

  const service = String(config.service ?? '').trim();
  if (!service) {
    problems.push({
      code: 'WORKER_SERVICE_MISSING',
      message: `El nodo ${node.key} no declara qué servicio llama`,
      path: 'service',
    });
  }

  const operation = String(config.operation ?? '').trim();
  if (!operation) {
    problems.push({
      code: 'WORKER_OPERATION_MISSING',
      message: `El nodo ${node.key} no declara qué operación del servicio ${service || '?'} invoca`,
      path: 'operation',
    });
  }

  const onErrorRaw = String(config.onError ?? 'FAIL').toUpperCase();
  if (onErrorRaw !== 'FAIL' && onErrorRaw !== 'CONTINUE') {
    problems.push({
      code: 'WORKER_ON_ERROR_INVALID',
      message: `La política de error ${onErrorRaw} del nodo ${node.key} no existe; use FAIL o CONTINUE`,
      path: 'onError',
    });
  }
  const onError: WorkerCallSnapshot['onError'] = onErrorRaw === 'CONTINUE' ? 'CONTINUE' : 'FAIL';

  const timeoutMs = config.timeoutMs === undefined ? undefined : Number(config.timeoutMs);
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    problems.push({
      code: 'WORKER_TIMEOUT_INVALID',
      message: `El tiempo máximo del nodo ${node.key} debe ser un número de milisegundos mayor que cero`,
      path: 'timeoutMs',
    });
  }

  const args = parseArguments(node, config.arguments, problems);
  const outputs = parseOutputs(node, config.outputs, onError, problems);

  if (problems.length) return { problems };
  return {
    call: { service, operation, arguments: args, outputs, onError, timeoutMs },
    problems,
  };
}

/**
 * Igual que `parseWorkerCall`, pero para el motor: en ejecución un problema de
 * configuración ya no es un aviso al autor sino una decisión que no se puede tomar.
 */
export function requireWorkerCall(node: GraphNodeSnapshot): WorkerCallSnapshot {
  const parsed = parseWorkerCall(node);
  if (!parsed.call) {
    const first = parsed.problems[0];
    throw new DomainException(first.code, first.message);
  }
  return parsed.call;
}
