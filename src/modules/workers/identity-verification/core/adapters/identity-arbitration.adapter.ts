import { Injectable, Logger } from '@nestjs/common';
import { LlmCreditsExhaustedError } from '../../../../../common/llm/llm-provider.error';
import type { OpenRouterChatClient } from '../../../../../common/llm/openrouter-chat.client';
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
 * El árbitro de IA, **cableado contra OpenRouter**.
 *
 * Hasta el 2026-09-07 este adaptador estaba declarado y vacío: contestaba
 * `DEFERRED` sin llamar a nadie. Existía para que el seam fuera real, y cumplió
 * su función; lo que sigue explica qué hace ahora y, sobre todo, qué NO puede
 * hacer, porque eso último no cambió y no es una limitación temporal.
 *
 * ## Sólo puede escalar, y el esquema lo impone
 *
 * El modelo elige entre `REJECT_DOCUMENT` y `DEFERRED`. **`ACCEPT_DOCUMENT` no
 * está en la enumeración que se le ofrece**, así que no puede proponerlo.
 *
 * El pipeline ya degradaba un `ACCEPT_DOCUMENT` automático a «sigue en la cola»
 * (`identity-pipeline.service.ts`), y esa regla se queda donde está: es la
 * defensa que aguanta aunque este adaptador tenga un fallo o lo sustituya otro.
 * Pero pedirle a un modelo una respuesta que se va a tirar es pagar tokens por
 * una opción muerta y, peor, invitar a que alguien la lea como una aprobación en
 * los registros. Si no vale, no se pregunta.
 *
 * La razón de fondo no es desconfianza: lo que separa una cédula legítima de una
 * falsificada está en los píxeles —`core/forensics/`—, y el texto de una
 * falsificación es el de un documento auténtico porque se copió de uno. Este
 * árbitro ve el DICTAMEN de la puerta, no el documento. El día que un árbitro
 * mire los píxeles, la regla cambia en el pipeline y el esquema aquí, los dos a
 * la vez y a propósito.
 *
 * ## Falla hacia la cola, y dice por qué
 *
 * Ninguna avería del proveedor puede sacar un caso de la bandeja humana, así que
 * cualquier fallo termina en `DEFERRED`. Lo que sí cambia es el `provider` con
 * el que se firma, y esa es la diferencia con la versión vacía:
 *
 * - `openrouter:<modelo>` — contestó el modelo.
 * - `openrouter-sin-creditos` — la cuenta se quedó sin saldo. **Es el único
 *   fallo que no se arregla tocando el motor**, y por eso tiene su propia firma:
 *   desde la bandeja, «no hay créditos» y «el modelo no contestó» eran
 *   indistinguibles y tienen dueños distintos.
 * - `openrouter-no-disponible` — cualquier otra avería (red, 5xx, plazo).
 *
 * Un despliegue con `IDENTITY_ARBITRATION_MODE=AI` y sin `OPENROUTER_API_KEY` ya
 * no llega hasta aquí: el esquema de entorno se niega a arrancar. La firma
 * `ai-unconfigured` desapareció con él, que era la que hacía pasar una
 * configuración rota por una decisión.
 */
@Injectable()
export class OpenRouterIdentityArbitrationAdapter implements IdentityArbitrationPort {
  private readonly logger = new Logger(OpenRouterIdentityArbitrationAdapter.name);
  readonly mode = 'AI' as const;

  public constructor(private readonly client: OpenRouterChatClient) {}

  public async arbitrate(request: IdentityArbitrationRequest): Promise<IdentityArbitrationVerdict> {
    try {
      const { output, respondedBy } = await this.client.complete({
        system: SYSTEM_PROMPT,
        user: JSON.stringify(payloadOf(request)),
        schemaName: 'identity_arbitration',
        schema: ARBITRATION_SCHEMA,
      });
      const outcome = output.outcome === 'REJECT_DOCUMENT' ? 'REJECT_DOCUMENT' : 'DEFERRED';
      const rationale =
        typeof output.rationale === 'string' && output.rationale.trim().length > 0
          ? output.rationale.trim()
          : 'El árbitro no explicó su decisión.';

      return {
        outcome,
        decidedBy: 'AI',
        provider: `openrouter:${respondedBy}`,
        rationale:
          outcome === 'REJECT_DOCUMENT'
            ? rationale
            : `El árbitro automático no pudo descartarlo; sigue en la bandeja. ${rationale}`,
      };
    } catch (error: unknown) {
      return this.deferOnFailure(request, error);
    }
  }

  /**
   * El estado real de la credencial y del saldo, con `GET /key`.
   *
   * No clasifica nada de prueba: una llamada de humo cuesta tokens cada vez que
   * alguien abre el tablero del worker, y este extremo contesta la pregunta que
   * importa —«¿puede este despliegue arbitrar ahora mismo?»— sin gastar ni uno.
   */
  public async health(): Promise<{ ready: boolean; detail?: string }> {
    const credits = await this.client.credits();
    return { ready: credits.ok, detail: `${this.client.model} · ${credits.detail}` };
  }

  private deferOnFailure(
    request: IdentityArbitrationRequest,
    error: unknown,
  ): IdentityArbitrationVerdict {
    const sinCreditos = error instanceof LlmCreditsExhaustedError;
    const motivo = error instanceof Error ? error.message : 'fallo desconocido';

    // WARN y no ERROR: el caso NO se pierde —queda donde estaba, delante de una
    // persona—, así que esto no despierta a nadie de madrugada. Lo que sí hace
    // es dejar la única línea que distingue «no hay saldo» de «el proveedor
    // está caído», que desde la bandeja se ven exactamente igual.
    this.logger.warn(
      `El árbitro automático no pudo resolver ${request.correlationId} (${request.reason}): ` +
        `${motivo}. El caso sigue en la bandeja humana.`,
    );

    return {
      outcome: 'DEFERRED',
      decidedBy: 'AI',
      provider: sinCreditos ? 'openrouter-sin-creditos' : 'openrouter-no-disponible',
      rationale: sinCreditos
        ? `No quedan créditos en OpenRouter, así que nadie arbitró: el caso sigue en la bandeja ` +
          `humana. Motivo original: ${request.detail}`
        : `El árbitro automático no estaba disponible (${motivo}); el caso sigue en la bandeja ` +
          `humana. Motivo original: ${request.detail}`,
    };
  }
}

/**
 * Lo que se le manda al modelo: el dictamen de la puerta, nunca el documento.
 *
 * No viaja ni una imagen ni un dato del titular —ni número, ni nombre, ni
 * fechas—. La franja de duda se abre por la FORMA de lo que se leyó, y eso es lo
 * único que hay que enseñar para decidir si vale la pena que una persona lo
 * mire. Mandar el documento a un enrutador que elige proveedor por su cuenta es
 * una decisión distinta, con consecuencias de tratamiento de datos distintas, y
 * no se toma de rebote al implementar un árbitro.
 */
function payloadOf(request: IdentityArbitrationRequest): Record<string, unknown> {
  return {
    motivo: request.reason,
    detalle: request.detail,
    tipoDocumentoPropuesto: request.documentType,
    confianzaDeEvidencia: Number(request.evidenceConfidence.toFixed(4)),
    senales: request.signals,
  };
}

const SYSTEM_PROMPT = [
  'Eres el árbitro de la franja de duda de un verificador de cédulas de identidad bolivianas.',
  'Recibes el DICTAMEN de la puerta de documentos: por qué dudó, qué señales encontró y con',
  'cuánta confianza. No recibes la imagen y no debes suponer qué contiene.',
  '',
  'Tienes exactamente dos respuestas:',
  '- REJECT_DOCUMENT: las señales demuestran que esto NO es una cédula de identidad (por',
  '  ejemplo: es un recibo, una captura de pantalla, una licencia de conducir, un documento de',
  '  otro país, o no hay ninguna señal compatible con una cédula).',
  '- DEFERRED: cualquier otro caso. Incluye la duda genuina, la evidencia escasa y la foto de',
  '  mala calidad de un documento que podría ser válido.',
  '',
  'Ante la duda, DEFERRED. Un rechazo equivocado le niega el servicio a una persona con una',
  'cédula legítima mal fotografiada; un DEFERRED equivocado sólo le cuesta a la empresa que',
  'alguien lo mire. No son simétricos.',
  '',
  'Nunca apruebas: que un documento sea auténtico se decide sobre la imagen y tú no la ves.',
  'Responde en español, en una frase, diciendo qué señal concreta sostiene tu decisión.',
].join('\n');

/**
 * `ACCEPT_DOCUMENT` NO está aquí, y su ausencia es la regla: el contrato del
 * puerto la admite porque un humano sí puede aprobar, este árbitro no.
 */
const ARBITRATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'rationale'],
  properties: {
    outcome: { type: 'string', enum: ['REJECT_DOCUMENT', 'DEFERRED'] },
    rationale: { type: 'string', minLength: 1, maxLength: 400 },
  },
};
