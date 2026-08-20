import { HttpStatus } from '@nestjs/common';
import { StatementRejectionReason } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { DomainException } from '../../../common/errors/domain-exception';

/** Entrada ya validada y lista para persistirse. */
export interface ValidatedStatementInput {
  readonly fileName: string;
  readonly fileHash: string;
  readonly bytes: Buffer;
}

/**
 * Firma de un PDF. Son los cinco primeros bytes de todo archivo conforme a la
 * especificación, y es lo único que un cliente no puede falsear renombrando.
 */
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');

/**
 * Nombre de archivo aceptable: sin separadores de ruta, sin caracteres de
 * control y sin la secuencia `..`. No se busca «un nombre bonito» sino que el
 * valor no signifique nada distinto al reflejarlo en una cabecera
 * `Content-Disposition` o al escribirlo en un log.
 */
// Los caracteres de control son EXACTAMENTE lo que esta expresión busca; la regla advierte
// de que suelen colarse por error, y aquí son el propósito.
// eslint-disable-next-line no-control-regex
const UNSAFE_FILE_NAME = /[\x00-\x1f\x7f/\\]|\.\./;

/**
 * Valida un archivo subido antes de que exista ninguna ejecución.
 *
 * El orden importa: primero lo que es barato y rechaza más (tamaño), y sólo
 * después se mira el contenido. Un archivo de 300 MB no debe llegar a que le
 * calculemos el SHA-256 para descubrir que sobra.
 *
 * **La extensión y el `Content-Type` declarados por el cliente no se creen.**
 * Los dos los elige quien llama, así que sólo describen una intención. Lo que
 * decide es la firma real del contenido.
 *
 * Lo que se rechaza AQUÍ no deja fila, y la frontera es deliberada: esto mira el
 * SOBRE —hay archivo, pesa lo que puede pesar, empieza por `%PDF-`— y lo que no
 * pasa ni siquiera es un PDF. Registrar cada uno de esos intentos daría a
 * cualquiera con credencial una forma de llenar la tabla subiendo basura, que es
 * peor abuso que el que el registro pretendía vigilar. Lo que sí queda
 * registrado como `PDF_INVALID` es el PDF legítimo cuyo CONTENIDO no es un
 * extracto: ése llegó a analizarse, y es el que interesa medir.
 *
 * Cada rechazo viaja con su `rejectionReason` del vocabulario común
 * (`StatementRejectionReason`) para que el portal pueda anunciar los dos
 * caminos —el de la puerta y el del análisis— con el mismo mensaje.
 */
export function validateStatementUpload(
  file: { originalname?: string; buffer?: Buffer; size?: number } | undefined,
  maxBytes: number,
): ValidatedStatementInput {
  if (!file?.buffer) {
    throw new DomainException(
      'BANK_STATEMENT_FILE_REQUIRED',
      'Se requiere un archivo PDF del extracto.',
      HttpStatus.BAD_REQUEST,
      { rejectionReason: StatementRejectionReason.EMPTY_DOCUMENT },
    );
  }

  const bytes = file.buffer;

  if (bytes.byteLength === 0) {
    throw new DomainException(
      'BANK_STATEMENT_FILE_EMPTY',
      'El archivo recibido está vacío.',
      HttpStatus.BAD_REQUEST,
      { rejectionReason: StatementRejectionReason.EMPTY_DOCUMENT },
    );
  }

  if (bytes.byteLength > maxBytes) {
    throw new DomainException(
      'BANK_STATEMENT_FILE_TOO_LARGE',
      `El archivo supera el máximo permitido de ${Math.floor(maxBytes / 1_048_576)} MiB.`,
      HttpStatus.PAYLOAD_TOO_LARGE,
      {
        maxBytes,
        receivedBytes: bytes.byteLength,
        rejectionReason: StatementRejectionReason.UNSUPPORTED_FILE,
      },
    );
  }

  // `subarray` y no `slice`: sobre un Buffer grande, copiar sólo para comparar
  // cinco bytes es gasto puro.
  if (!bytes.subarray(0, PDF_SIGNATURE.byteLength).equals(PDF_SIGNATURE)) {
    throw new DomainException(
      'BANK_STATEMENT_FILE_NOT_PDF',
      'El archivo no es un PDF. Se comprueba su contenido, no su extensión.',
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      { rejectionReason: StatementRejectionReason.UNSUPPORTED_FILE },
    );
  }

  const fileName = sanitizeFileName(file.originalname);

  return {
    fileName,
    // La huella identifica el documento. El nombre no identifica nada: dos
    // personas suben `extracto.pdf` el mismo día y no son el mismo archivo.
    fileHash: createHash('sha256').update(bytes).digest('hex'),
    bytes,
  };
}

function sanitizeFileName(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return 'extracto.pdf';
  if (UNSAFE_FILE_NAME.test(trimmed)) {
    throw new DomainException(
      'BANK_STATEMENT_FILE_NAME_INVALID',
      'El nombre del archivo contiene caracteres no permitidos.',
      HttpStatus.BAD_REQUEST,
      { rejectionReason: StatementRejectionReason.UNSUPPORTED_FILE },
    );
  }
  return trimmed.slice(0, 255);
}

/**
 * Identificador público de una ejecución. Es lo que viaja al frontend, a los
 * logs y a las trazas; el `id` numérico de la fila no sale del motor, para que
 * nadie pueda enumerar ejecuciones ajenas contando hacia arriba.
 */
export function newRequestId(): string {
  return randomUUID();
}
