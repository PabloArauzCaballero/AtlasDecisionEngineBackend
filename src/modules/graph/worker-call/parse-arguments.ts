import type { GraphNodeSnapshot, WorkerArgumentBinding } from '../graph.types';
import { ARGUMENT_SOURCES, WorkerCallProblem } from './constants';

export function parseArguments(
  node: GraphNodeSnapshot,
  raw: unknown,
  problems: WorkerCallProblem[],
): Record<string, WorkerArgumentBinding> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push({
      code: 'WORKER_ARGUMENTS_INVALID',
      message: `Los argumentos del nodo ${node.key} deben ser un objeto de nombre a origen`,
      path: 'arguments',
    });
    return {};
  }

  const bindings: Record<string, WorkerArgumentBinding> = {};
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push({
        code: 'WORKER_ARGUMENT_INVALID',
        message: `El argumento ${name} del nodo ${node.key} debe declarar su origen`,
        path: `arguments.${name}`,
      });
      continue;
    }
    const binding = entry as Record<string, unknown>;
    const source = String(binding.source ?? 'LITERAL').toUpperCase();
    if (!ARGUMENT_SOURCES.has(source as WorkerArgumentBinding['source'])) {
      problems.push({
        code: 'WORKER_ARGUMENT_SOURCE_INVALID',
        message: `El origen ${source} del argumento ${name} del nodo ${node.key} no existe`,
        path: `arguments.${name}.source`,
      });
      continue;
    }
    if (
      (source === 'VARIABLE' || source === 'INTERMEDIATE') &&
      !String(binding.path ?? '').trim()
    ) {
      problems.push({
        code: 'WORKER_ARGUMENT_PATH_MISSING',
        message: `El argumento ${name} del nodo ${node.key} lee de ${source} pero no dice de qué ruta`,
        path: `arguments.${name}.path`,
      });
      continue;
    }
    if (source === 'EXPRESSION' && binding.expression === undefined) {
      problems.push({
        code: 'WORKER_ARGUMENT_EXPRESSION_MISSING',
        message: `El argumento ${name} del nodo ${node.key} se declara como expresión pero no la trae`,
        path: `arguments.${name}.expression`,
      });
      continue;
    }
    bindings[name] = {
      source: source as WorkerArgumentBinding['source'],
      path: binding.path === undefined ? undefined : String(binding.path),
      value: binding.value,
      expression: binding.expression,
    };
  }
  return bindings;
}
