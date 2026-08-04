import { Injectable } from '@nestjs/common';
import { StatementProcessingError } from '../domain/errors';

export interface PdfUpload {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class FileValidationService {
  validate(file: PdfUpload | undefined, maxBytes: number): asserts file is PdfUpload {
    if (!file?.buffer?.length) {
      throw new StatementProcessingError(
        'EMPTY_FILE',
        'Debe adjuntar un archivo PDF no vacío.',
        400,
      );
    }
    if (file.size > maxBytes || file.buffer.length > maxBytes) {
      throw new StatementProcessingError(
        'FILE_TOO_LARGE',
        `El PDF supera el límite de ${Math.floor(maxBytes / 1_048_576)} MB.`,
        413,
      );
    }
    const extensionIsPdf = /\.pdf$/i.test(file.originalname);
    const mimeIsPdf = file.mimetype.toLowerCase() === 'application/pdf';
    const magicIsPdf = file.buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    if (!extensionIsPdf || !mimeIsPdf || !magicIsPdf) {
      throw new StatementProcessingError(
        'INVALID_PDF',
        'Solo se aceptan archivos PDF auténticos.',
        415,
        {
          extensionIsPdf,
          mimeIsPdf,
          magicIsPdf,
        },
      );
    }
  }
}
