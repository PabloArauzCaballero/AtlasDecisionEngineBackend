import { DomainException } from '../../common/errors/domain-exception';
import type {
  WorkerServiceInvoker,
  WorkerServiceOutcome,
  WorkerServiceRequest,
} from '../graph/graph.types';

/**
 * Dobles de worker para un caso de prueba.
 *
 * Un nodo `WORKER` llama a un servicio de verdad: leer un carnet, analizar un extracto. En una
 * suite eso hace el caso irrepetible —depende de un modelo, de un PDF, de que el worker esté
 * encendido— y, sobre todo, deja sin probar las ramas que dependen de lo que el servicio
 * RESPONDE: con una entrada de mentira el servicio falla siempre y el grafo sólo recorre la rama
 * del fallo. Así ni IDENTIDAD_CARNET_MOVIL ni EXTRACTO_CAPACIDAD_PAGO podían llegar al 80 % de
 * nodos que exige la revisión, y en TEST no tenían ninguna suite (visto el 2026-10-07).
 *
 * El caso declara, por nodo, qué habría respondido el servicio:
 *
 *   input: {
 *     variables: { … },
 *     workerDoubles: { VERIFICAR_IDENTIDAD: { result: { decision: 'VERIFIED', similarity: 0.91 } } }
 *   }
 *
 * `status: 'FAILED'` simula el fallo de la llamada (con `errorCode` opcional). Un nodo sin doble
 * sigue llamando al servicio real: los dobles no cambian nada en las suites que no los declaran.
 * Sólo existen en la ejecución de PRUEBAS; el runtime y la simulación no los leen.
 */
export interface WorkerDouble {
  status?: 'SUCCEEDED' | 'SUCCEEDED_WITH_WARNINGS' | 'FAILED';
  errorCode?: string;
  result?: Record<string, unknown>;
  warnings?: string[];
}

export type WorkerDoubles = Record<string, WorkerDouble>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lee `workerDoubles` del `inputJson` de un caso. Lo que no tenga forma de doble se ignora. */
export function readWorkerDoubles(rawInput: Record<string, unknown>): WorkerDoubles {
  const raw = rawInput.workerDoubles;
  if (!isRecord(raw)) return {};
  const doubles: WorkerDoubles = {};
  for (const [nodeKey, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const status = value.status;
    doubles[nodeKey] = {
      status: status === 'FAILED' || status === 'SUCCEEDED_WITH_WARNINGS' ? status : 'SUCCEEDED',
      errorCode: typeof value.errorCode === 'string' ? value.errorCode : undefined,
      result: isRecord(value.result) ? value.result : {},
      warnings: Array.isArray(value.warnings) ? value.warnings.map(String) : [],
    };
  }
  return doubles;
}

/** Un invocador que responde con el doble del nodo y, si no lo hay, delega en el real. */
export function withWorkerDoubles(
  doubles: WorkerDoubles,
  real: WorkerServiceInvoker | undefined,
): WorkerServiceInvoker | undefined {
  if (!Object.keys(doubles).length) return real;
  return {
    // `async`: el fallo de un doble tiene que llegar como promesa rechazada, igual que el del servicio.
    async invoke(request: WorkerServiceRequest): Promise<WorkerServiceOutcome> {
      const double = doubles[request.nodeKey];
      if (!double) {
        if (real) return real.invoke(request);
        throw new DomainException(
          'WORKER_SERVICE_NOT_CONFIGURED',
          `El nodo ${request.nodeKey} llama al servicio ${request.service} y el caso no trae un doble para él`,
        );
      }
      if (double.status === 'FAILED') {
        throw new DomainException(
          double.errorCode ?? 'WORKER_SERVICE_FAILED',
          `Doble de prueba: la llamada de ${request.nodeKey} falla a propósito`,
        );
      }
      return {
        status: double.status ?? 'SUCCEEDED',
        result: double.result ?? {},
        warnings: double.warnings ?? [],
        durationMs: 0,
      };
    },
  };
}
