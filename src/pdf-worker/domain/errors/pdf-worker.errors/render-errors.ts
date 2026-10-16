import { PdfWorkerError } from './codes-and-base';

export class PdfRenderError extends PdfWorkerError {
  readonly code = 'PDF_RENDER_FAILED' as const;
  readonly httpStatus = 502;

  constructor(reason: string, context: Readonly<Record<string, unknown>> = {}, cause?: unknown) {
    super(`El motor de impresión no produjo un PDF: ${reason}`, { reason, ...context }, { cause });
  }
}

export class PdfRenderTimeoutError extends PdfWorkerError {
  readonly code = 'PDF_RENDER_TIMEOUT' as const;
  readonly httpStatus = 504;

  constructor(timeoutMs: number, context: Readonly<Record<string, unknown>> = {}) {
    super(`El renderizado superó el plazo de ${timeoutMs} ms y se abortó.`, {
      timeoutMs,
      ...context,
    });
  }
}

/**
 * Se alcanzó el techo de renders concurrentes y la espera en cola agotó su plazo.
 *
 * Se responde 429 y no 503: el servicio está sano, lo que falta es capacidad instantánea, y
 * esa diferencia es la que decide si el cliente reintenta con retroceso o si el orquestador
 * saca la réplica de rotación.
 */
export class RenderCapacityExceededError extends PdfWorkerError {
  readonly code = 'PDF_RENDER_CAPACITY_EXCEEDED' as const;
  readonly httpStatus = 429;

  constructor(concurrency: number, queueTimeoutMs: number) {
    super(`Los ${concurrency} carriles de renderizado siguen ocupados tras ${queueTimeoutMs} ms.`, {
      concurrency,
      queueTimeoutMs,
    });
  }
}

export class AssetResolutionError extends PdfWorkerError {
  readonly code = 'ASSET_RESOLUTION_FAILED' as const;
  readonly httpStatus = 500;

  constructor(reference: string, reason: string, cause?: unknown) {
    super(
      `No se pudo resolver el recurso «${reference}»: ${reason}`,
      { reference, reason },
      {
        cause,
      },
    );
  }
}

export class DocumentStorageError extends PdfWorkerError {
  readonly code = 'DOCUMENT_STORAGE_FAILED' as const;
  readonly httpStatus = 500;

  constructor(provider: string, reason: string, cause?: unknown) {
    super(
      `El proveedor de almacenamiento «${provider}» falló: ${reason}`,
      { provider, reason },
      {
        cause,
      },
    );
  }
}
