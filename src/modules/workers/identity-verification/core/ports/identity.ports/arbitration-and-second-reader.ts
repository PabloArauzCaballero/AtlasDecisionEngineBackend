import type { IdentityDocumentType } from '../../domain/identity-enums';

/**
 * Quién resuelve lo que la puerta de documentos no supo resolver sola.
 *
 * Es un PUERTO y no una llamada directa a la bandeja por una razón concreta: el
 * factor que decide va a cambiar. Hoy es una persona mirando la foto en el
 * portal; mañana puede ser un modelo que la clasifique en un segundo, y el día
 * que eso ocurra el pipeline no debería enterarse. Lo único que el pipeline sabe
 * es que hay una duda razonable y que alguien —humano o no— tiene que cerrarla.
 *
 * Nótese que un veredicto puede ser DIFERIDO, y no es un fallo del adaptador: un
 * humano no contesta dentro de la petición HTTP que le pregunta. El adaptador
 * humano deja el caso en la cola y contesta `DEFERRED`; el resultado del worker
 * queda en `REVIEW_REQUIRED` y se cierra más tarde, desde la pestaña. Un
 * adaptador de IA sí podría contestar en línea, y por eso el contrato admite las
 * dos formas en vez de obligar a la más pobre.
 */
export interface IdentityArbitrationRequest {
  readonly correlationId: string;
  /** Por qué se pregunta, con el vocabulario cerrado de la cola. */
  readonly reason: string;
  /** Qué vio la puerta, en una frase que una persona pueda leer. */
  readonly detail: string;
  readonly documentType: IdentityDocumentType;
  readonly evidenceConfidence: number;
  readonly signals: readonly string[];
}

export type IdentityArbitrationOutcome =
  /** Sí es un documento admisible: el worker sigue. */
  | 'ACCEPT_DOCUMENT'
  /** No lo es: el worker rechaza, con el motivo del árbitro. */
  | 'REJECT_DOCUMENT'
  /** Nadie ha contestado todavía. El caso queda abierto en la cola. */
  | 'DEFERRED';

export interface IdentityArbitrationVerdict {
  readonly outcome: IdentityArbitrationOutcome;
  readonly decidedBy: 'HUMAN' | 'AI';
  /** Adaptador concreto que contestó, para la traza y el tablero. */
  readonly provider: string;
  readonly rationale: string;
}

export interface IdentityArbitrationPort {
  readonly mode: 'HUMAN' | 'AI';
  arbitrate(request: IdentityArbitrationRequest): Promise<IdentityArbitrationVerdict>;
  health(): Promise<{ ready: boolean; detail?: string }>;
}

// --- Segundo lector de campos ----------------------------------------------

/**
 * Lo que un modelo multimodal PROPONE tras mirar el documento.
 *
 * «Propone» es literal: nada de lo que hay aquí entra en el resultado sin pasar
 * por `reconcileSecondReading`, que lo contrasta con lo que ya se leyó y con la
 * MRZ. El puerto devuelve cadenas crudas —no `ExtractedField`— justamente para
 * que no se pueda confundir con un dato extraído.
 */
export interface SecondReadingProposal {
  readonly documentNumber?: string;
  readonly firstNames?: string;
  readonly lastNames?: string;
  /** ISO `YYYY-MM-DD`. */
  readonly dateOfBirth?: string;
  /** ISO `YYYY-MM-DD`, o `INDEFINIDO` para las cédulas que no caducan. */
  readonly expirationDate?: string;
}

export interface SecondReadingRequest {
  readonly correlationId: string;
  /** Imágenes del documento en `data:` URL. Anverso primero. */
  readonly images: readonly string[];
  /** Qué campos no pudo leer el analizador. Se le dice para no pagar por el resto. */
  readonly missingFields: readonly string[];
}

/**
 * Un segundo par de ojos sobre el documento, para los campos que el OCR no sacó.
 *
 * Existe porque los defectos medidos contra cédulas reales fueron de LECTURA y
 * no de juicio —rótulos pegados al retrato, basura delante de la MRZ, una
 * caducidad `INDEFINIDO` que no estaba contemplada—, y cada uno acababa igual:
 * al caso le faltaba un campo y caía en la bandeja humana.
 */
export interface IdentitySecondReaderPort {
  readonly provider: string;
  /** `null` cuando no se pudo consultar. Nunca lanza: no leer no es un fallo del caso. */
  read(request: SecondReadingRequest): Promise<SecondReadingProposal | null>;
  health(): Promise<{ ready: boolean; detail?: string }>;
}

// --- Imagen ----------------------------------------------------------------
