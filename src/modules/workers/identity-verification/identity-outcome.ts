import {
  IdentityArbitrationMode,
  IdentityRejectionReason,
  IdentityReviewReason,
  WorkerRunStatus,
} from '@prisma/client';
import { IdentityDecision } from './core/domain/identity-enums';
import { IdentityDomainError } from './core/domain/identity-domain.error';

/**
 * El único sitio donde se decide en qué estado termina una verificación que no
 * llegó a producir veredicto.
 *
 * Está aparte del worker por lo mismo que `statement-outcome.ts`: qué se
 * rechaza, qué se pregunta y qué se reintenta es una regla de negocio que se
 * discute y se recalibra, y repartida entre `catch` no había forma de responder
 * «¿por qué acabó esto en la cola?» sin leer el worker entero. Además se prueba
 * sin base de datos y sin imágenes.
 *
 * Tres invariantes que el resto del módulo da por ciertas:
 *
 * 1. `DOCUMENT_REJECTED` **siempre** lleva `rejectionReason` y **nunca**
 *    `reviewReason`, así que jamás aparece en la cola. Es la regla que impide que
 *    la cola se convierta en el basurero de lo que el motor no entendió.
 * 2. `PENDING_REVIEW` **siempre** lleva `reviewReason`. Un pendiente sin motivo
 *    no se puede categorizar, y una lista sin categorías vuelve a ser la tabla
 *    gigante que la pestaña existe para no ser.
 * 3. La prioridad se DERIVA del motivo. Puesta a mano acabaría siendo «alta»
 *    siempre, que es lo mismo que no tenerla.
 */
export interface IdentityRunOutcome {
  readonly status: WorkerRunStatus;
  readonly reviewReason: IdentityReviewReason | null;
  readonly rejectionReason: IdentityRejectionReason | null;
  readonly arbitrationMode: IdentityArbitrationMode | null;
  /** 1 alta · 2 media · 3 baja. `null` cuando el caso no entra en la cola. */
  readonly reviewPriority: number | null;
}

/**
 * Prioridad por motivo, y el criterio es cuánto cuesta NO mirarlo.
 *
 * Arriba lo que tiene a una persona esperando para entrar a la aplicación; en
 * medio lo que ya tiene lectura y sólo falta confirmarla; abajo lo que
 * probablemente no sea ni un documento —barato de descartar, y descartarlo no
 * desbloquea a nadie—.
 */
const PRIORIDAD_POR_MOTIVO: Readonly<Record<IdentityReviewReason, number>> = {
  [IdentityReviewReason.AMBIGUOUS_FACE_MATCH]: 1,
  [IdentityReviewReason.TIMEOUT]: 1,
  [IdentityReviewReason.UNRECOGNIZED_DOCUMENT_TYPE]: 2,
  [IdentityReviewReason.LOW_IMAGE_QUALITY]: 2,
  [IdentityReviewReason.MANUAL_REQUEST]: 2,
  [IdentityReviewReason.DOUBTFUL_DOCUMENT]: 3,
  // Arriba del todo: es una persona con su documento en regla esperando a que alguien firme lo
  // que el worker no puede firmar. No mirarlo es dejarla fuera por una carencia nuestra.
  [IdentityReviewReason.UNCALIBRATED_DECISION]: 1,
  [IdentityReviewReason.INCONCLUSIVE_LIVENESS]: 2,
};

/**
 * Los motivos de revisión que puede levantar un VEREDICTO, por orden de precedencia.
 *
 * El orden no es estético: quien abre la bandeja decide qué mirar por el motivo, así que cuando
 * un caso arrastra varios códigos gana el que mejor describe por qué nadie pudo firmarlo. Un
 * `THRESHOLD_PROFILE_MISSING` con un aviso de calidad encima no es un problema de calidad: es que
 * el worker no tiene con qué decidir, y etiquetarlo «baja resolución» manda a esa persona al
 * fondo de la cola por un motivo falso.
 */
const MOTIVO_POR_CODIGO: ReadonlyArray<readonly [string, IdentityReviewReason]> = [
  ['THRESHOLD_PROFILE_MISSING', IdentityReviewReason.UNCALIBRATED_DECISION],
  ['LIVENESS_PROFILE_UNCALIBRATED', IdentityReviewReason.UNCALIBRATED_DECISION],
  ['AMBIGUOUS_MATCH', IdentityReviewReason.AMBIGUOUS_FACE_MATCH],
  ['LIVENESS_UNCERTAIN', IdentityReviewReason.INCONCLUSIVE_LIVENESS],
  ['LOW_DOCUMENT_CONFIDENCE', IdentityReviewReason.LOW_IMAGE_QUALITY],
  ['LOW_FACE_QUALITY', IdentityReviewReason.LOW_IMAGE_QUALITY],
  ['DOCUMENT_FIELD_INCONSISTENCY', IdentityReviewReason.DOUBTFUL_DOCUMENT],
  ['DOCUMENT_EXPIRY_UNKNOWN', IdentityReviewReason.DOUBTFUL_DOCUMENT],
];

/**
 * El desenlace de una ejecución que TERMINÓ, a partir de su veredicto.
 *
 * Hasta el 2026-09-11 esto no existía y el estado salía de un ternario: `VERIFIED` a `SUCCEEDED`
 * y todo lo demás a `SUCCEEDED_WITH_WARNINGS`. El efecto es que un `REVIEW_REQUIRED` —que
 * significa literalmente «esto lo decide una persona»— terminaba en un estado TERMINAL y fuera
 * de toda bandeja. La cola existía, funcionaba, y sólo la alimentaban los errores de la puerta;
 * medido contra una cédula auténtica, devolvía cero elementos mientras la única verificación del
 * día esperaba a que alguien la mirara.
 *
 * Un `NOT_VERIFIED` sigue siendo terminal: es una decisión del worker, no trabajo pendiente. Y un
 * `INCONCLUSIVE` también, porque lo que falta ahí es una señal, no un juicio.
 */
export function outcomeForIdentityVerdict(
  decision: IdentityDecision,
  reasonCodes: readonly string[],
): IdentityRunOutcome {
  if (decision === IdentityDecision.VERIFIED) {
    return {
      status: WorkerRunStatus.SUCCEEDED,
      reviewReason: null,
      rejectionReason: null,
      arbitrationMode: null,
      reviewPriority: null,
    };
  }

  if (decision !== IdentityDecision.REVIEW_REQUIRED) {
    return {
      status: WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
      reviewReason: null,
      rejectionReason: null,
      arbitrationMode: null,
      reviewPriority: null,
    };
  }

  const codigos = new Set(reasonCodes);
  const reviewReason =
    MOTIVO_POR_CODIGO.find(([codigo]) => codigos.has(codigo))?.[1] ??
    // Un veredicto de revisión sin código conocido sigue siendo trabajo de una persona: entra en
    // la cola con el motivo más genérico antes que quedarse fuera de toda bandeja.
    IdentityReviewReason.MANUAL_REQUEST;

  return {
    status: WorkerRunStatus.PENDING_REVIEW,
    reviewReason,
    rejectionReason: null,
    // Lo decide una persona: el arbitraje por IA no firma veredictos de identidad.
    arbitrationMode: IdentityArbitrationMode.HUMAN,
    reviewPriority: PRIORIDAD_POR_MOTIVO[reviewReason],
  };
}

/**
 * Rechazos por código, para los errores que ya existían.
 *
 * `IDENTITY_DOCUMENT_UNSUPPORTED` está aquí porque es el código histórico que
 * cargaba con todo: el día que este mapa exista, lo que llegue por ahí es un
 * documento que el clasificador no supo nombrar y que la puerta no mandó a
 * revisión. Sigue siendo un rechazo, y ahora se cuenta como tal en vez de como
 * una avería del worker.
 */
const RECHAZO_POR_CODIGO: Readonly<Record<string, IdentityRejectionReason>> = {
  IDENTITY_DOCUMENT_UNSUPPORTED: IdentityRejectionReason.NOT_AN_IDENTITY_DOCUMENT,
  IDENTITY_DOCUMENT_NOT_IDENTITY: IdentityRejectionReason.NOT_AN_IDENTITY_DOCUMENT,
  IDENTITY_DOCUMENT_TYPE_NOT_ACCEPTED: IdentityRejectionReason.UNSUPPORTED_DOCUMENT_TYPE,
};

/** Los motivos que el propio error puede nombrar, validados contra el enum. */
function motivoDeRevision(valor: unknown): IdentityReviewReason | null {
  return typeof valor === 'string' && valor in IdentityReviewReason
    ? (valor as IdentityReviewReason)
    : null;
}

function motivoDeRechazo(valor: unknown): IdentityRejectionReason | null {
  return typeof valor === 'string' && valor in IdentityRejectionReason
    ? (valor as IdentityRejectionReason)
    : null;
}

/**
 * El desenlace de un error, o `null` si ese error NO es de la puerta.
 *
 * Devolver `null` es importante: significa «esto es un fallo de verdad» y deja
 * intacto el camino de reintentos que ya existía. Un proveedor caído no puede
 * acabar en la cola de revisión —nadie puede resolver desde una pantalla que
 * el servicio biométrico esté saturado— ni marcado como documento rechazado.
 */
export function outcomeForIdentityError(error: unknown): IdentityRunOutcome | null {
  if (!(error instanceof IdentityDomainError)) return null;

  if (error.code === 'IDENTITY_ARBITRATION_PENDING') {
    const reviewReason =
      motivoDeRevision(error.details.reviewReason) ?? IdentityReviewReason.DOUBTFUL_DOCUMENT;
    const arbitrationMode =
      error.details.arbitrationMode === IdentityArbitrationMode.AI
        ? IdentityArbitrationMode.AI
        : IdentityArbitrationMode.HUMAN;
    return {
      status: WorkerRunStatus.PENDING_REVIEW,
      reviewReason,
      rejectionReason: null,
      arbitrationMode,
      reviewPriority: PRIORIDAD_POR_MOTIVO[reviewReason],
    };
  }

  const rejectionReason =
    motivoDeRechazo(error.details.rejectionReason) ?? RECHAZO_POR_CODIGO[error.code];
  if (rejectionReason === undefined) return null;

  return {
    status: WorkerRunStatus.DOCUMENT_REJECTED,
    reviewReason: null,
    rejectionReason,
    arbitrationMode: null,
    reviewPriority: null,
  };
}

/**
 * Los dos estados en los que un caso está EN la cola.
 *
 * Se exporta para que toda consulta de la cola acote por aquí y por nada más:
 * es lo que garantiza, por construcción, que un `DOCUMENT_REJECTED` no pueda
 * aparecer en una bandeja de revisión ni por un filtro mal escrito.
 */
export const IDENTITY_REVIEW_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.PENDING_REVIEW,
  WorkerRunStatus.IN_REVIEW,
];
