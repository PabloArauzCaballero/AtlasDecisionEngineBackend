import {
  triageByConfidence,
  normalizeThresholds,
  type TriageThresholds,
} from '../../../../../common/triage/confidence-triage';
import { IdentityDocumentType } from '../domain/identity-enums';
import type { EvidenciaDeIdentidad } from './identity-evidence';

/**
 * La puerta de entrada del worker: qué se hace con la foto que llegó.
 *
 * Rechazar y preguntar NO son lo mismo, y hasta ahora lo eran. Cualquier imagen
 * que el clasificador no supiera nombrar salía por `UNSUPPORTED_DOCUMENT`, así
 * que la cédula fotografiada de noche y la foto de un recibo recibían la misma
 * respuesta. Con una sola frontera no hay forma de hacerlo mejor: hacen falta
 * dos, y son las que este archivo aplica.
 *
 * - **Rechazo.** Hay evidencia suficiente para negarse: un contraindicador
 *   decisivo —la factura lleva código de control— o sencillamente nada que se
 *   parezca a un documento. Es terminal y **no entra en ninguna cola**: poner
 *   delante de una persona la foto de un paisaje le cuesta el mismo minuto que
 *   un caso real y no mueve nada, porque el trabajo que arregla eso sólo puede
 *   hacerlo quien subió la foto.
 * - **Duda.** Se parece a un documento y las señales no bastaron. Esto y sólo
 *   esto se delega a un factor externo —hoy una persona, mañana un modelo— por
 *   `IdentityArbitrationPort`.
 * - **Aceptación.** Adelante con el analizador y la biometría.
 *
 * El tipo aceptado es una decisión aparte y posterior: un pasaporte legítimo es
 * un documento de identidad excelente y aun así puede no ser lo que este flujo
 * pidió. Rechazarlo por «no es un documento» sería mentir sobre el motivo, y el
 * motivo es lo único que le dice a quien sube la foto qué tiene que hacer.
 */

/** Por qué un documento espera a un factor externo. */
export type IdentityReviewReason =
  | 'DOUBTFUL_DOCUMENT'
  | 'UNRECOGNIZED_DOCUMENT_TYPE'
  | 'AMBIGUOUS_FACE_MATCH'
  | 'LOW_IMAGE_QUALITY'
  | 'TIMEOUT'
  | 'MANUAL_REQUEST';

/** Por qué un documento se rechaza sin preguntar a nadie. */
export type IdentityRejectionReason =
  | 'NOT_AN_IDENTITY_DOCUMENT'
  | 'UNSUPPORTED_DOCUMENT_TYPE'
  | 'UNREADABLE_DOCUMENT';

export type IdentityGateOutcome =
  | { readonly verdict: 'ACCEPT'; readonly documentType: IdentityDocumentType }
  | { readonly verdict: 'REVIEW'; readonly reason: IdentityReviewReason; readonly detail: string }
  | { readonly verdict: 'REJECT'; readonly reason: IdentityRejectionReason; readonly detail: string };

/**
 * Fronteras por defecto de la evidencia de identidad.
 *
 * `accept` en 0,55 exige al menos dos señales fuertes —rótulo y autoridad
 * emisora, o rótulo y MRZ—: una sola no basta porque cualquiera de ellas puede
 * salir de un reflejo mal leído.
 *
 * `review` en 0,25 se sitúa donde deja de haber duda razonable. Por encima cabe
 * todavía una señal fuerte suelta, o dos débiles: es exactamente la cédula que
 * el reconocedor leyó a medias. Por debajo no queda nada que un humano pudiera
 * confirmar mirando, y ahí preguntar es gastarle el tiempo a alguien.
 *
 * Los dos se recalibran por entorno (`IDENTITY_DOCUMENT_*_CONFIDENCE`) porque
 * son lo primero que hay que mover con documentos reales de otro país.
 */
/**
 * Las señales que SÓLO lleva un documento de identidad.
 *
 * La lista está aquí y no en `identity-evidence.ts` porque no describe cómo se
 * mide sino cómo se decide: son las que autorizan a decir «había un documento y
 * no se pudo leer» en vez de «esto no era un documento».
 */
const SENALES_FUERTES: readonly string[] = [
  'identity-title',
  'issuing-authority',
  'machine-readable-zone',
  'personal-fields',
];

export const DEFAULT_IDENTITY_THRESHOLDS: TriageThresholds = {
  accept: 0.55,
  review: 0.25,
};

/** Los umbrales de identidad, saneados contra sus propios valores por defecto. */
export function normalizeIdentityThresholds(
  thresholds: Partial<TriageThresholds> = {},
): TriageThresholds {
  return normalizeThresholds(thresholds, DEFAULT_IDENTITY_THRESHOLDS);
}

/**
 * El veredicto de la puerta, con su motivo siempre puesto.
 *
 * El orden de las comprobaciones es la política, y no es intercambiable:
 *
 * 1. Un contraindicador decisivo cierra el caso. Da igual cuántas señales de
 *    identidad se hubieran acumulado: si el papel dice ser una factura, lo es.
 * 2. La evidencia decide entre las tres puertas.
 * 3. **Sólo entonces** se mira el tipo. Un documento de identidad que este flujo
 *    no admite se rechaza por lo que es —«ese tipo no», con su nombre— y nunca
 *    por «no es un documento»: son dos instrucciones distintas para quien está
 *    delante del móvil, y darle la equivocada le hace repetir la misma foto.
 * 4. Un documento con evidencia sobrada pero sin tipo reconocible es el caso que
 *    justifica toda esta máquina: se parece a una cédula, no se sabe cuál es, y
 *    eso lo resuelve mirando una persona en segundos.
 */
export function triageIdentityDocument(input: {
  readonly evidence: EvidenciaDeIdentidad;
  readonly documentType: IdentityDocumentType;
  readonly acceptedTypes: readonly IdentityDocumentType[];
  readonly thresholds: TriageThresholds;
}): IdentityGateOutcome {
  const { evidence, documentType, acceptedTypes, thresholds } = input;

  if (evidence.contraindicator !== null) {
    return {
      verdict: 'REJECT',
      reason: 'NOT_AN_IDENTITY_DOCUMENT',
      detail: `La imagen es otro documento: se reconoció ${evidence.contraindicator}.`,
    };
  }

  const veredicto = triageByConfidence(evidence.confidence, thresholds);

  if (veredicto === 'REJECT') {
    /*
     * «Ilegible» y «no es un documento» no se distinguen por CUÁNTAS señales
     * casaron sino por CUÁLES.
     *
     * Afirmar que había un documento y no se pudo leer exige haber visto algo
     * que sólo un documento lleva: su rótulo, su autoridad emisora, su MRZ o sus
     * campos personales. La proporción de la tarjeta y un número suelto los
     * cumple una foto de una tarjeta de fidelidad, y contestar «ilegible» ahí
     * manda a repetir una foto que nunca iba a servir. Medido con el escenario
     * `imagen-cualquiera`: casaba la proporción, y con eso bastaba para llamarlo
     * documento ilegible.
     */
    const fuertes = evidence.signals.filter((senal) => SENALES_FUERTES.includes(senal));
    return {
      verdict: 'REJECT',
      reason: fuertes.length === 0 ? 'NOT_AN_IDENTITY_DOCUMENT' : 'UNREADABLE_DOCUMENT',
      detail:
        fuertes.length === 0
          ? 'No se reconoció ninguna señal propia de un documento de identidad en la imagen.'
          : `Se reconocieron señales de documento (${fuertes.join(', ')}) pero no bastan para afirmar cuál es.`,
    };
  }

  if (documentType !== IdentityDocumentType.UNKNOWN && !acceptedTypes.includes(documentType)) {
    return {
      verdict: 'REJECT',
      reason: 'UNSUPPORTED_DOCUMENT_TYPE',
      detail: `Se reconoció ${documentType}, y este flujo sólo admite ${acceptedTypes.join(', ')}.`,
    };
  }

  if (documentType === IdentityDocumentType.UNKNOWN) {
    return {
      verdict: 'REVIEW',
      reason: 'UNRECOGNIZED_DOCUMENT_TYPE',
      detail: `Hay evidencia de un documento de identidad (${evidence.signals.join(', ')}) pero no se pudo determinar cuál.`,
    };
  }

  if (veredicto === 'REVIEW') {
    return {
      verdict: 'REVIEW',
      reason: 'DOUBTFUL_DOCUMENT',
      detail: `Se reconoció ${documentType} con evidencia ${String(evidence.confidence)}, por debajo del umbral de aceptación.`,
    };
  }

  return { verdict: 'ACCEPT', documentType };
}
