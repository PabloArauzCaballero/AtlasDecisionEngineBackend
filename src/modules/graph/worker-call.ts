/**
 * Interpretación de la llamada a servicio que declara un nodo `WORKER`.
 *
 * Vive fuera del motor y fuera del validador porque los dos necesitan leer exactamente lo
 * mismo: si el validador aceptara una forma y el motor entendiera otra, un grafo aprobado
 * podría fallar en producción por un campo que nadie comprobó. Aquí se interpreta una vez
 * y se falla cerrado ante cualquier forma que no se entienda.
 */
import { DomainException } from '../../common/errors/domain-exception';
import type {
  GraphNodeSnapshot,
  WorkerArgumentBinding,
  WorkerCallSnapshot,
  WorkerOutputBinding,
} from './graph.types';

/** Orígenes admitidos para un argumento de la llamada. */
const ARGUMENT_SOURCES = new Set<WorkerArgumentBinding['source']>([
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
const PATH_ROOTS = new Set(['result', 'call']);

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

function parseArguments(
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

function parseOutputs(
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

/**
 * Intermedias que un nodo LEE para alimentar los argumentos de su llamada.
 *
 * Se nombran sin el prefijo `intermediate.`, igual que las entradas de un campo calculado,
 * así que el validador de intermedias no las descubre recorriendo cadenas y necesita
 * preguntarlas aparte.
 */
export function workerArgumentIntermediatesOf(node: GraphNodeSnapshot): string[] {
  if (node.type !== 'WORKER') return [];
  const raw = (node.config as { arguments?: unknown }).arguments;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.values(raw as Record<string, unknown>)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const binding = entry as Record<string, unknown>;
      if (String(binding.source ?? '').toUpperCase() !== 'INTERMEDIATE') return '';
      return String(binding.path ?? '')
        .trim()
        .split('.')[0];
    })
    .filter((code) => code.length > 0);
}

/**
 * Intermedias que un nodo escribe por llamar a un servicio.
 *
 * El validador de intermedias las necesita para saber quién es el productor de cada
 * variable; se lee desde la configuración cruda y sin fallar, porque un nodo mal
 * configurado ya lo reporta `parseWorkerCall` y aquí solo interesa el destino.
 */
export function workerOutputCodesOf(node: GraphNodeSnapshot): string[] {
  if (node.type !== 'WORKER') return [];
  const raw = (node.config as { outputs?: unknown }).outputs;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) =>
      entry && typeof entry === 'object'
        ? String((entry as Record<string, unknown>).intermediateCode ?? '').trim()
        : '',
    )
    .filter((code) => code.length > 0);
}
