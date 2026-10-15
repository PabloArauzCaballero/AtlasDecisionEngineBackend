/**
 * Ejecuta la llamada que declara un nodo `WORKER` del grafo.
 *
 * Es el puente entre el motor de decisión y los dos workers absorbidos (ADR-0026). Lo que
 * un nodo invoca aquí es el NÚCLEO del worker —el motor de extractos, el pipeline
 * semántico—, no su cola: la decisión necesita la respuesta en el mismo instante en que la
 * pide, y una cola sirve justo para lo contrario. La cola sigue siendo el camino de las
 * conversiones que se piden por HTTP y que nadie está esperando en línea; ambos usos
 * conviven porque comparten el núcleo, que no sabe de ninguno de los dos.
 *
 * Se pasa a `ExecutionEngineService.execute()` como argumento de llamada —vía `bind()`—,
 * nunca como dependencia de constructor, para que `GraphModule` no dependa de este módulo.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import type {
  WorkerServiceInvoker,
  WorkerServiceOutcome,
  WorkerServiceRequest,
} from '../graph/graph.types';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { AudioSpeakCallHandler } from './service-calls/audio-speak-call.handler';
import { BankStatementCallHandler } from './service-calls/bank-statement-call.handler';
import { IdentityVerificationCallHandler } from './service-calls/identity-verification-call.handler';
import { SemanticClassificationCallHandler } from './service-calls/semantic-classification-call.handler';
import type { WorkerServiceHandler } from './service-calls/worker-call';

@Injectable()
export class WorkerServiceInvokerService {
  private readonly handlers: ReadonlyMap<string, WorkerServiceHandler>;

  constructor(
    bankStatement: BankStatementCallHandler,
    semanticClassification: SemanticClassificationCallHandler,
    audioSpeak: AudioSpeakCallHandler,
    identityVerification: IdentityVerificationCallHandler,
  ) {
    this.handlers = new Map(
      [bankStatement, semanticClassification, audioSpeak, identityVerification].map((handler) => [
        handler.key,
        handler,
      ]),
    );
  }

  /**
   * Ata el invocador al tenant, al principal y al CONTEXTO de UNA ejecución, para
   * `engine.execute()`.
   *
   * El contexto es el `context` de la petición de decisión, el mismo que ya entra
   * en su huella de idempotencia. Hasta ahora no pasaba de ahí: el motor de grafo
   * sólo entrega a los nodos las variables del artefacto. Viaja por aquí, y no
   * como variable, porque lo que trae son datos de CÓMO llegó la petición —hoy
   * sólo el origen de la captura del carnet— y una variable nueva en un artefacto
   * gobernado exige una versión firmada por dos personas. Cada servicio lee de él
   * sólo la clave que conoce y la valida; lo demás lo ignora.
   */
  bind(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    context?: Readonly<Record<string, unknown>> | null,
  ): WorkerServiceInvoker {
    return { invoke: (request) => this.invoke(tenantId, principal, request, context ?? null) };
  }

  private async invoke(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    request: WorkerServiceRequest,
    context: Readonly<Record<string, unknown>> | null,
  ): Promise<WorkerServiceOutcome> {
    const started = Date.now();
    const key = `${request.service}.${request.operation}`;
    const handler = this.handlers.get(key);
    if (!handler) {
      // El validador de grafo ya rechaza un servicio desconocido al aprobar el
      // artefacto. Llegar aquí significa que el catálogo del validador y el de este
      // servicio se separaron, y eso no puede resolverse adivinando.
      throw new DomainException(
        'WORKER_SERVICE_UNKNOWN',
        `El nodo ${request.nodeKey} invoca ${key}, que este motor no sabe ejecutar`,
        HttpStatus.NOT_IMPLEMENTED,
      );
    }
    return handler.handle({ tenantId, principal, request, started, context });
  }
}
