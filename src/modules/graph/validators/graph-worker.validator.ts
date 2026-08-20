/**
 * Reglas estáticas de los nodos que llaman a un servicio de worker.
 *
 * Un nodo `WORKER` es la única parte del grafo que ejecuta trabajo fuera del motor durante
 * la decisión, así que su configuración se comprueba entera al validar y no al ejecutar:
 * descubrir en producción que una proyección apunta a una intermedia inexistente cuesta
 * una decisión abortada, y el autor ya no está delante para arreglarlo.
 */
import type { ArtifactGraphSnapshot, ValidationIssue } from '../graph.types';
import { parseWorkerCall } from '../worker-call';
import type { GraphLookups } from './graph-lookups';
import { issue } from './validation-issue';

export interface GraphWorkerResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/**
 * Servicios y operaciones que un nodo puede invocar.
 *
 * Es un catálogo cerrado y comprobado al validar, no una cadena libre resuelta en
 * ejecución: un nodo que nombra un servicio inexistente tiene que impedir la aprobación
 * del artefacto, no abortar la primera decisión que lo alcance. Los códigos son los mismos
 * que publica `GET /v1/workers`.
 */
export const WORKER_SERVICE_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  'bank-statement': ['normalize'],
  'semantic-analysis': ['classify'],
  // `speak` y no `synthesize`: lo que el nodo pide es que ALGO se diga en voz
  // alta, y la mayoría de las veces no se sintetiza nada porque ya estaba
  // locutado. Nombrar la operación por el mecanismo prometería una llamada al
  // proveedor en cada decisión.
  'audio-tts': ['speak'],
};

export function validateGraphWorkerCalls(
  snapshot: ArtifactGraphSnapshot,
  lookups: GraphLookups,
): GraphWorkerResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const workerNodes = snapshot.nodes.filter((node) => node.type === 'WORKER');
  if (!workerNodes.length) return { errors, warnings };

  const intermediates = new Map(snapshot.intermediates.map((entry) => [entry.code, entry]));

  for (const node of workerNodes) {
    // Un nodo de servicio es un paso intermedio del algoritmo: llama, guarda y continúa.
    // Si fuera terminal, la respuesta que acaba de traer no la leería nadie.
    if (node.terminal) {
      errors.push(
        issue(
          'WORKER_NODE_TERMINAL',
          `El nodo ${node.key} llama a un servicio y además es terminal; su respuesta no la usaría ningún nodo`,
          'NODE',
          node.key,
        ),
      );
    }
    if (!snapshot.edges.some((edge) => edge.from === node.key)) {
      errors.push(
        issue(
          'WORKER_NODE_WITHOUT_EXIT',
          `El nodo ${node.key} llama a un servicio pero no tiene ninguna arista de salida`,
          'NODE',
          node.key,
        ),
      );
    }

    const parsed = parseWorkerCall(node);
    for (const problem of parsed.problems) {
      errors.push({
        ...issue(problem.code, problem.message, 'NODE', node.key),
        path: problem.path,
      });
    }
    const call = parsed.call;
    if (!call) continue;

    const operations = WORKER_SERVICE_OPERATIONS[call.service];
    if (!operations) {
      errors.push(
        issue(
          'WORKER_SERVICE_UNKNOWN',
          `El servicio ${call.service} que invoca el nodo ${node.key} no existe; disponibles: ${Object.keys(WORKER_SERVICE_OPERATIONS).join(', ')}`,
          'NODE',
          node.key,
        ),
      );
    } else if (!operations.includes(call.operation)) {
      errors.push(
        issue(
          'WORKER_OPERATION_UNKNOWN',
          `El servicio ${call.service} no ofrece la operación ${call.operation}; disponibles: ${operations.join(', ')}`,
          'NODE',
          node.key,
        ),
      );
    }

    for (const [name, binding] of Object.entries(call.arguments)) {
      if (binding.source !== 'VARIABLE') continue;
      // El contrato de entrada declara qué variables recibe el artefacto. Alimentar un
      // argumento desde una que no está declarada produciría `undefined` en ejecución, y
      // el servicio rechazaría la llamada sin decir de dónde venía el hueco.
      const root = String(binding.path ?? '')
        .replace(/^variables\./, '')
        .split('.')[0];
      if (!lookups.inputCodes.has(root)) {
        errors.push(
          issue(
            'WORKER_ARGUMENT_VARIABLE_UNKNOWN',
            `El argumento ${name} del nodo ${node.key} lee la variable ${root}, que el artefacto no declara como entrada`,
            'NODE',
            node.key,
          ),
        );
      }
    }

    for (const output of call.outputs) {
      const target = intermediates.get(output.intermediateCode);
      if (!target) {
        errors.push(
          issue(
            'WORKER_OUTPUT_INTERMEDIATE_UNKNOWN',
            `El nodo ${node.key} proyecta la respuesta del servicio sobre ${output.intermediateCode}, que no está declarada como variable intermedia`,
            'NODE',
            node.key,
          ),
        );
        continue;
      }
      // La autorización de escritura la comprueba también el validador de intermedias,
      // pero allí el mensaje habla de una asignación; aquí nombra al servicio, que es lo
      // que el autor tiene delante cuando se equivoca de nodo productor.
      if (target.producerNodeKey !== node.key) {
        errors.push(
          issue(
            'WORKER_OUTPUT_PRODUCER_MISMATCH',
            `La variable intermedia ${output.intermediateCode} declara como productor a ${target.producerNodeKey}, pero la escribe la llamada del nodo ${node.key}`,
            'NODE',
            node.key,
          ),
        );
      }
      // `CONTINUE` deja pasar una decisión tomada sin respuesta del servicio. Que la
      // variable admita nulo y el defecto sea nulo es legítimo, pero conviene verlo.
      if (call.onError === 'CONTINUE' && output.defaultValue === null && !target.nullable) {
        errors.push(
          issue(
            'WORKER_OUTPUT_DEFAULT_NOT_NULLABLE',
            `El valor por defecto de ${output.intermediateCode} es nulo y la variable no admite nulos`,
            'NODE',
            node.key,
          ),
        );
      }
    }

    if (call.onError === 'CONTINUE') {
      warnings.push(
        issue(
          'WORKER_CALL_CONTINUES_ON_ERROR',
          `El nodo ${node.key} continúa la decisión aunque el servicio ${call.service} falle; verifique que las ramas posteriores contemplan call.status = FAILED`,
          'NODE',
          node.key,
          'WARNING',
        ),
      );
    }
  }

  return { errors, warnings };
}
