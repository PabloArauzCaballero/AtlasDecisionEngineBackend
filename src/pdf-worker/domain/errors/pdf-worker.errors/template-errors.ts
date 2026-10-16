import { PdfWorkerError } from './codes-and-base';

export class TemplateNotFoundError extends PdfWorkerError {
  readonly code = 'TEMPLATE_NOT_FOUND' as const;
  readonly httpStatus = 404;

  constructor(templateId: string, available: readonly string[] = []) {
    super(`No existe ningún template con identificador «${templateId}».`, {
      templateId,
      available,
    });
  }
}

export class TemplateVersionNotFoundError extends PdfWorkerError {
  readonly code = 'TEMPLATE_VERSION_NOT_FOUND' as const;
  readonly httpStatus = 404;

  constructor(templateId: string, version: string, availableVersions: readonly string[]) {
    super(
      `El template «${templateId}» existe, pero no en la versión «${version}». ` +
        `Versiones registradas: ${availableVersions.join(', ') || 'ninguna'}.`,
      { templateId, version, availableVersions },
    );
  }
}

/**
 * Registrar dos veces el mismo `id@version`.
 *
 * Es un error y no una sobreescritura silenciosa a propósito (§9): un documento archivado
 * declara con qué template y versión se generó, y esa afirmación sólo vale si la pareja
 * `id@version` es inmutable. Sobrescribir haría que un informe de hace un año dijese que se
 * produjo con un template cuyo contenido ya nadie puede reconstruir.
 */
export class TemplateAlreadyRegisteredError extends PdfWorkerError {
  readonly code = 'TEMPLATE_ALREADY_REGISTERED' as const;
  readonly httpStatus = 409;

  constructor(templateId: string, version: string) {
    super(
      `El template «${templateId}@${version}» ya está registrado. Publique una versión nueva ` +
        'en lugar de sobrescribir una existente.',
      { templateId, version },
    );
  }
}

/** Un problema concreto del payload, en el vocabulario de quien lo mandó. */
export interface PayloadIssue {
  /** Ruta con notación de punto: `sections.0.fields.2.label`. */
  readonly field: string;
  /** Qué está mal, en lenguaje llano. */
  readonly problem: string;
  /** Qué se esperaba (tipo, enum, longitud…). */
  readonly expected?: string;
  /**
   * Valor recibido, YA saneado. Nunca se copia el valor entero: un payload puede contener
   * datos personales y este error acaba en un log y en una respuesta HTTP.
   */
  readonly received?: string;
}

export class TemplatePayloadValidationError extends PdfWorkerError {
  readonly code = 'TEMPLATE_PAYLOAD_INVALID' as const;
  readonly httpStatus = 422;

  constructor(
    readonly templateId: string,
    readonly version: string,
    readonly issues: readonly PayloadIssue[],
  ) {
    super(
      `El payload no cumple el contrato de «${templateId}@${version}»: ` +
        `${issues.length} problema(s).`,
      { templateId, version, issues },
    );
  }
}

/** El template registrado no se puede cargar o compilar: es un defecto del worker, no del cliente. */
export class TemplateSourceError extends PdfWorkerError {
  readonly code = 'TEMPLATE_SOURCE_INVALID' as const;
  readonly httpStatus = 500;

  constructor(templateId: string, reason: string, cause?: unknown) {
    super(
      `No se pudo preparar el template «${templateId}»: ${reason}`,
      { templateId, reason },
      {
        cause,
      },
    );
  }
}

export class TemplateRenderError extends PdfWorkerError {
  readonly code = 'TEMPLATE_RENDER_FAILED' as const;
  readonly httpStatus = 500;

  constructor(templateId: string, reason: string, cause?: unknown) {
    super(
      `Fallo al componer el HTML de «${templateId}»: ${reason}`,
      { templateId, reason },
      {
        cause,
      },
    );
  }
}
