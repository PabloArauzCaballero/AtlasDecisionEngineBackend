import { Injectable, Logger } from '@nestjs/common';
import type {
  IdentityArbitrationPort,
  IdentityArbitrationRequest,
  IdentityArbitrationVerdict,
} from '../ports/identity.ports';

/**
 * Los dos árbitros de la franja de duda.
 *
 * Se implementan aquí, juntos, por lo mismo que los puertos viven en un solo
 * archivo: leídos a la vez son el contrato completo de «quién cierra una duda»,
 * y quien vaya a enchufar un modelo necesita ver qué se espera de él sin
 * recorrer el módulo entero.
 */

/**
 * El árbitro humano: deja el caso abierto y no finge un veredicto.
 *
 * **Contestar `DEFERRED` no es no hacer nada.** Es la afirmación exacta de lo
 * que ocurre: una persona no responde dentro de la petición HTTP que le
 * pregunta. El caso queda en `PENDING_REVIEW` con su motivo, las imágenes se
 * conservan porque la ejecución NO está cerrada, y quien lo resuelve lo hace
 * después desde la pestaña del portal.
 *
 * La alternativa —bloquear la petición esperando a un humano— no es una opción
 * peor, es una imposible: el flujo móvil consulta el estado, y una petición
 * colgada durante horas se la lleva por delante cualquier intermediario.
 */
@Injectable()
export class HumanIdentityArbitrationAdapter implements IdentityArbitrationPort {
  readonly mode = 'HUMAN' as const;

  arbitrate(request: IdentityArbitrationRequest): Promise<IdentityArbitrationVerdict> {
    return Promise.resolve({
      outcome: 'DEFERRED',
      decidedBy: 'HUMAN',
      provider: 'portal-review-queue',
      rationale: `Derivado a revisión humana: ${request.detail}`,
    });
  }

  health(): Promise<{ ready: boolean; detail?: string }> {
    // La cola siempre está lista: es una tabla y una pantalla, no un proveedor
    // externo que pueda estar caído.
    return Promise.resolve({ ready: true, detail: 'bandeja del portal' });
  }
}

/**
 * El árbitro de IA, declarado y todavía sin modelo detrás.
 *
 * Existe porque el seam tiene que ser real desde hoy: si el puerto no tuviera
 * más que una implementación, «es hexagonal» sería una afirmación sin comprobar,
 * y el día que llegue el modelo habría que descubrir a la vez qué contrato
 * necesitaba y por qué el pipeline no lo respetaba.
 *
 * **Falla hacia la cola, nunca hacia la aceptación.** Sin modelo configurado
 * devuelve `DEFERRED`, que deja el caso donde estaba —delante de una persona— en
 * vez de dejar pasar un documento que nadie miró. Y lo dice en `health()`, para
 * que un despliegue mal configurado se vea en el estado del worker y no sólo
 * como una cola humana que crece sin que nadie sepa por qué.
 */
@Injectable()
export class AiIdentityArbitrationAdapter implements IdentityArbitrationPort {
  private readonly logger = new Logger(AiIdentityArbitrationAdapter.name);
  readonly mode = 'AI' as const;

  constructor() {
    this.logger.warn(
      'IDENTITY_ARBITRATION_MODE=AI está seleccionado pero no hay modelo de arbitraje configurado: ' +
        'las dudas seguirán derivándose a la bandeja humana.',
    );
  }

  arbitrate(request: IdentityArbitrationRequest): Promise<IdentityArbitrationVerdict> {
    return Promise.resolve({
      outcome: 'DEFERRED',
      decidedBy: 'AI',
      provider: 'ai-unconfigured',
      rationale:
        'No hay modelo de arbitraje configurado; el caso se deriva a la bandeja humana. ' +
        `Motivo original: ${request.detail}`,
    });
  }

  health(): Promise<{ ready: boolean; detail?: string }> {
    return Promise.resolve({
      ready: false,
      detail: 'modo AI seleccionado sin modelo configurado; se arbitra por humano',
    });
  }
}
