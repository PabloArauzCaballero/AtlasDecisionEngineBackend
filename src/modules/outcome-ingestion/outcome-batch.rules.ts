import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';

/** Techo por carga. Una tanda de cobranza no puede abrir una transacción sin fin. */
const MAX_BATCH = 2_000;

/** Resultado de UNA fila, para que el rechazo se explique fila a fila y no en bloque. */
export interface RowResult {
  externalReference: string;
  windowDays?: number;
  accepted: boolean;
  /** Código estable del rechazo. Nulo si se aceptó. */
  code?: string;
  message?: string;
  /** Ya estaba registrada igual: aceptada sin reescribir ni contar. */
  duplicate?: boolean;
}

export function rejectRow(
  externalReference: string,
  code: string,
  message: string,
  windowDays?: number,
): RowResult {
  return { externalReference, windowDays, accepted: false, code, message };
}

export function assertBatchSize(size: number, field: string): void {
  if (size === 0) {
    throw new DomainException(
      'OUTCOME_BATCH_EMPTY',
      `El lote de ${field} está vacío`,
      HttpStatus.BAD_REQUEST,
    );
  }
  if (size > MAX_BATCH) {
    throw new DomainException(
      'OUTCOME_BATCH_TOO_LARGE',
      `Un lote admite como máximo ${MAX_BATCH} ${field}; divídalo`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

export function observationKey(executionId: bigint, windowDays: number): string {
  return `${executionId.toString()}:${windowDays}`;
}

/** Lo que identifica un desenlace a efectos de «es el mismo»: etiqueta, importe y método. */
export function fingerprint(
  label: string,
  amount: number | null,
  inferenceMethod: string | null | undefined,
): string {
  return JSON.stringify([label, amount === null ? null : Number(amount), inferenceMethod ?? null]);
}
