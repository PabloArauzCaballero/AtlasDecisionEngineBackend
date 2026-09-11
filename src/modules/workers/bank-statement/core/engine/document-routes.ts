/**
 * Qué se hace con cada CLASE de documento, que no es lo mismo que si es falso.
 *
 * ## El problema que resuelve
 *
 * Quien sube un archivo a un flujo de crédito sube lo que tiene a mano, y lo que
 * tiene a mano casi nunca es un extracto de tres meses: es el comprobante de la
 * última transferencia, el certificado de saldo que le dieron en ventanilla, la
 * boleta de pago del mes, el resumen de su tarjeta. Ninguno de esos documentos
 * es falso y ninguno sirve para lo mismo, y hasta ahora los cuatro recibían la
 * misma respuesta: «el documento no reúne señales suficientes de ser un estado
 * de cuenta».
 *
 * Esa frase es verdadera y es inútil. No dice qué hacer.
 *
 * ## Qué añade esto
 *
 * La RUTA del corpus: la razón por la que ese documento no sirve, dicha en
 * términos de lo que le falta. Un comprobante de transferencia no cubre un
 * periodo; un certificado de saldo es una foto y no una historia; un resumen de
 * tarjeta es evidencia de DEUDA y no de ingreso —y el límite disponible de una
 * tarjeta no es dinero de nadie—; una boleta de pago respalda el ingreso pero no
 * demuestra que ese dinero llegara a una cuenta.
 *
 * Nada de esto es una acusación. El corpus lo dice en el `caution` de cada tipo,
 * y la distinción importa: un documento mal elegido se arregla subiendo otro; un
 * documento falso se arregla de otra manera muy distinta.
 */

import { TIPOS_DE_DOCUMENTO } from '../corpus/corpus-extractos.generated';

/** Qué puede hacer el motor con un documento de esta clase. */
export type DocumentRoute =
  | 'CANDIDATE_FOR_CASH_FLOW_MEASUREMENT'
  | 'INSUFFICIENT_PERIOD_COVERAGE'
  | 'NOT_ACCOUNT_HISTORY'
  | 'DEBT_EVIDENCE_NOT_DEPOSIT_INCOME'
  | 'ASSET_AND_FLOW_EVIDENCE_WITH_PRODUCT_CONTEXT'
  | 'POTENTIALLY_VALID_NOT_AUTO_REJECT'
  | 'INCOME_SUPPORT_NOT_ACCOUNT_HISTORY'
  | 'ASSET_SNAPSHOT_NOT_CASH_FLOW_HISTORY'
  | 'HUMAN_REVIEW';

/**
 * Del tipo que produce el clasificador al tipo conceptual del corpus.
 *
 * Son dos vocabularios y se mantienen separados a propósito: el del clasificador
 * describe lo que se leyó en la carátula —«resumen de tarjeta»— y el del corpus
 * describe qué clase de evidencia es eso. Traducir en un solo sitio es lo que
 * permite cambiar los rótulos que se buscan sin tocar la política.
 */
const TIPO_DEL_CORPUS: Readonly<Record<string, string>> = {
  BANK_STATEMENT: 'DEPOSIT_ACCOUNT_STATEMENT',
  ACCOUNT_STATEMENT: 'DEPOSIT_ACCOUNT_STATEMENT',
  TRANSACTION_HISTORY: 'DEPOSIT_ACCOUNT_STATEMENT',
  CARD_SUMMARY: 'CREDIT_CARD_STATEMENT',
  TRANSFER_RECEIPT: 'TRANSFER_RECEIPT',
  BALANCE_CERTIFICATE: 'BALANCE_CERTIFICATE',
  PAYSLIP: 'PAYSLIP',
  WALLET_STATEMENT: 'MOBILE_WALLET_STATEMENT',
  INVESTMENT_STATEMENT: 'INVESTMENT_STATEMENT',
  UTILITY_RECEIPT: 'UTILITY_PAYMENT_RECEIPT',
  INVOICE: 'NONFINANCIAL_INVOICE',
  UNREADABLE: 'UNREADABLE_OR_IMAGE_ONLY',
};

export interface DocumentRouting {
  /** El identificador conceptual del corpus. */
  readonly corpusType: string;
  readonly route: DocumentRoute;
  /** La advertencia literal del corpus para esa clase. */
  readonly caution: string;
  /** Qué decirle a quien subió el archivo. Accionable y sin acusar. */
  readonly guidance: string;
}

/** Lo que se le dice a una persona por cada ruta. Una frase, una acción. */
const GUIA: Readonly<Record<DocumentRoute, string>> = {
  CANDIDATE_FOR_CASH_FLOW_MEASUREMENT: 'El documento sirve para medir el flujo de la cuenta.',
  INSUFFICIENT_PERIOD_COVERAGE:
    'Es el comprobante de una operación, no la historia de una cuenta: hace falta el extracto del periodo.',
  NOT_ACCOUNT_HISTORY:
    'Es el comprobante de un pago, no la historia de una cuenta: hace falta el extracto de su banco.',
  DEBT_EVIDENCE_NOT_DEPOSIT_INCOME:
    'Un resumen de tarjeta describe deuda, no ingreso. Sirve como evidencia de compromisos; ' +
    'para medir el ingreso hace falta el extracto de la cuenta donde lo cobra.',
  ASSET_AND_FLOW_EVIDENCE_WITH_PRODUCT_CONTEXT:
    'Es un estado de inversiones: describe tenencias. Un rescate de capital no es ingreso ganado.',
  POTENTIALLY_VALID_NOT_AUTO_REJECT:
    'Es el estado de cuenta de una billetera con operador licenciado. Se puede usar; hay que ' +
    'comprobar titularidad, cobertura del periodo y contrapartes.',
  INCOME_SUPPORT_NOT_ACCOUNT_HISTORY:
    'Una boleta de pago respalda el ingreso, pero no demuestra que ese dinero llegara a una cuenta ' +
    'ni qué obligaciones se pagan desde ella.',
  ASSET_SNAPSHOT_NOT_CASH_FLOW_HISTORY:
    'Un certificado de saldo es una foto de un día, no una historia: no permite ver regularidad.',
  HUMAN_REVIEW: 'El documento no es legible automáticamente y lo mira una persona.',
};

/**
 * La ruta de un tipo de documento, o `undefined` si no se reconoció ninguno.
 *
 * `undefined` es distinto de `HUMAN_REVIEW`: el primero significa que no se sabe
 * qué clase de documento es, y el segundo que sí se sabe y hay que mirarlo.
 */
export function routeForDocumentType(documentType: string): DocumentRouting | undefined {
  const corpusType = TIPO_DEL_CORPUS[documentType];
  if (!corpusType) return undefined;
  const registro = TIPOS_DE_DOCUMENTO.find((tipo) => tipo.id === corpusType);
  if (!registro) return undefined;
  const route = registro.ruta as DocumentRoute;
  return {
    corpusType,
    route,
    caution: registro.cuidado,
    guidance: GUIA[route] ?? registro.cuidado,
  };
}

/** Los tipos del corpus, para quien quiera enumerarlos sin importar el catálogo. */
export const CORPUS_DOCUMENT_TYPES = TIPOS_DE_DOCUMENTO;
