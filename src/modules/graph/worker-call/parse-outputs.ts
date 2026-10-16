import type { GraphNodeSnapshot, WorkerCallSnapshot, WorkerOutputBinding } from '../graph.types';
import { PATH_ROOTS, WorkerCallProblem } from './constants';

export function parseOutputs(
  node: GraphNodeSnapshot,
  raw: unknown,
  onError: WorkerCallSnapshot['onError'],
  problems: WorkerCallProblem[],
): WorkerOutputBinding[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push({
      code: 'WORKER_OUTPUTS_EMPTY',
      message:
        `El nodo ${node.key} llama a un servicio pero no guarda nada de su respuesta; ` +
        'una llamada cuyo resultado no se proyecta no puede influir en la decisión',
      path: 'outputs',
    });
    return [];
  }

  const outputs: WorkerOutputBinding[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const at = `outputs[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push({
        code: 'WORKER_OUTPUT_INVALID',
        message: `La proyección ${index} del nodo ${node.key} no es un objeto`,
        path: at,
      });
      return;
    }
    const binding = entry as Record<string, unknown>;
    const intermediateCode = String(binding.intermediateCode ?? '').trim();
    if (!intermediateCode) {
      problems.push({
        code: 'WORKER_OUTPUT_TARGET_MISSING',
        message: `La proyección ${index} del nodo ${node.key} no dice a qué variable intermedia escribe`,
        path: `${at}.intermediateCode`,
      });
      return;
    }
    if (seen.has(intermediateCode)) {
      problems.push({
        code: 'WORKER_OUTPUT_DUPLICATED',
        message: `El nodo ${node.key} proyecta dos veces sobre la variable intermedia ${intermediateCode}`,
        path: `${at}.intermediateCode`,
      });
      return;
    }
    seen.add(intermediateCode);

    const source = String(binding.source ?? 'PATH').toUpperCase();
    if (source !== 'PATH' && source !== 'EXPRESSION') {
      problems.push({
        code: 'WORKER_OUTPUT_SOURCE_INVALID',
        message: `El origen ${source} de la proyección ${intermediateCode} del nodo ${node.key} no existe`,
        path: `${at}.source`,
      });
      return;
    }
    const path = String(binding.path ?? '').trim();
    if (source === 'PATH') {
      if (!path) {
        problems.push({
          code: 'WORKER_OUTPUT_PATH_MISSING',
          message: `La proyección ${intermediateCode} del nodo ${node.key} no declara la ruta que lee`,
          path: `${at}.path`,
        });
        return;
      }
      if (!PATH_ROOTS.has(path.split('.')[0])) {
        problems.push({
          code: 'WORKER_OUTPUT_PATH_ROOT_INVALID',
          message:
            `La ruta ${path} de la proyección ${intermediateCode} del nodo ${node.key} debe ` +
            'empezar por result. (la respuesta del servicio) o call. (los metadatos de la llamada)',
          path: `${at}.path`,
        });
        return;
      }
    }
    if (source === 'EXPRESSION' && binding.expression === undefined) {
      problems.push({
        code: 'WORKER_OUTPUT_EXPRESSION_MISSING',
        message: `La proyección ${intermediateCode} del nodo ${node.key} se declara como expresión pero no la trae`,
        path: `${at}.expression`,
      });
      return;
    }
    // Con `CONTINUE` el grafo sigue aunque el servicio falle, y entonces la respuesta no
    // existe. Sin un valor por defecto declarado, la intermedia se quedaría sin escribir y
    // el primer nodo que la leyera reventaría por un motivo que ya no menciona al servicio.
    if (onError === 'CONTINUE' && binding.defaultValue === undefined) {
      problems.push({
        code: 'WORKER_OUTPUT_DEFAULT_REQUIRED',
        message:
          `La proyección ${intermediateCode} del nodo ${node.key} necesita defaultValue: ` +
          'el nodo continúa ante un fallo del servicio y el grafo tiene que poder decidir sin respuesta',
        path: `${at}.defaultValue`,
      });
      return;
    }

    outputs.push({
      intermediateCode,
      source: source as WorkerOutputBinding['source'],
      path: path || undefined,
      expression: binding.expression,
      defaultValue: binding.defaultValue,
    });
  });
  return outputs;
}
