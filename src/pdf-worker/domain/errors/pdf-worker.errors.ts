/**
 * Catálogo cerrado de fallos del generador documental.
 *
 * El dominio NO conoce HTTP: `httpStatus` es un número, no el enum `HttpStatus` de Nest.
 * Esa distinción no es cosmética — es lo que permite que estos errores viajen por la cola
 * asíncrona, por el SDK en proceso y por el controlador REST sin que ninguno de los tres
 * arrastre a los otros dos. Quien habla HTTP los traduce en `presentation/http`.
 *
 * Cada error lleva `code` estable (el que se publica al consumidor y el que etiqueta la
 * métrica) y `details` estructurado. `throw new Error('error')` está prohibido aquí: un
 * fallo sin código no se puede contar, ni alertar, ni explicar a quien mandó el payload.
 */

/** Códigos publicados. Se comparan por igualdad en clientes y paneles; no se renombran. */
export const PDF_ERROR_CODES = [
  'TEMPLATE_NOT_FOUND',
  'TEMPLATE_VERSION_NOT_FOUND',
  'TEMPLATE_ALREADY_REGISTERED',
  'TEMPLATE_PAYLOAD_INVALID',
  'TEMPLATE_SOURCE_INVALID',
  'TEMPLATE_RENDER_FAILED',
  'PDF_RENDER_FAILED',
  'PDF_RENDER_TIMEOUT',
  'PDF_RENDER_CAPACITY_EXCEEDED',
  'ASSET_RESOLUTION_FAILED',
  'DOCUMENT_STORAGE_FAILED',
  'INVALID_BRAND',
  'PROTECTED_OPTION_OVERRIDE',
  'IDEMPOTENT_REQUEST_IN_FLIGHT',
  // --- Administración de templates (CRUD) ---
  'TEMPLATE_BUNDLE_INVALID',
  'TEMPLATE_IMMUTABLE',
  'TEMPLATE_STORE_FAILED',
  'TEMPLATE_ADMIN_DISABLED',
  'TEMPLATE_ADMIN_UNAUTHORIZED',
  'TEMPLATE_BUILTIN_PROTECTED',
  'ARTIFACT_CONTRACT_UNAVAILABLE',
  'ARTIFACT_NOT_FOUND',
  // --- Acceso al servicio, sólo cuando corre como proceso suelto ---
  'SERVICE_UNAUTHORIZED',
] as const;

export type PdfErrorCode = (typeof PDF_ERROR_CODES)[number];

export abstract class PdfWorkerError extends Error {
  abstract readonly code: PdfErrorCode;

  /** Sugerencia de estado HTTP. La traducción real vive en la capa de presentación. */
  abstract readonly httpStatus: number;

  protected constructor(
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
    options?: { cause?: unknown },
  ) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
    // `Error` no restaura el prototipo al transpilar a ES5/ES2022 con `extends`; sin esto,
    // `instanceof PdfWorkerError` puede fallar según el `target`, y el filtro de excepciones
    // caería al caso genérico convirtiendo un 400 explicativo en un 500 mudo.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

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

/**
 * Otra invocación con la MISMA clave de idempotencia está en curso (§31).
 *
 * Se responde 409 y no se espera indefinidamente: quien reenvía una petición por impaciencia
 * no gana nada bloqueando un carril de renderizado, y un 409 con `Retry-After` le dice
 * exactamente qué hacer. Devolverle un documento nuevo sería romper la promesa entera.
 */
export class IdempotentRequestInFlightError extends PdfWorkerError {
  readonly code = 'IDEMPOTENT_REQUEST_IN_FLIGHT' as const;
  readonly httpStatus = 409;

  constructor(idempotencyKey: string) {
    super(
      'Ya hay una generación en curso con esta clave de idempotencia; reintente en unos segundos.',
      { idempotencyKey },
    );
  }
}

export class InvalidBrandError extends PdfWorkerError {
  readonly code = 'INVALID_BRAND' as const;
  readonly httpStatus = 400;

  constructor(brandId: string, reason: string) {
    super(`La identidad visual «${brandId}» no es utilizable: ${reason}`, { brandId, reason });
  }
}

/**
 * La petición intentó sobrescribir una opción marcada como protegida (§13).
 *
 * Se rechaza en vez de ignorarse en silencio: ignorar produce un documento que no es el que
 * el cliente pidió y nadie se entera hasta que alguien lo abre.
 */
export class ProtectedOptionOverrideError extends PdfWorkerError {
  readonly code = 'PROTECTED_OPTION_OVERRIDE' as const;
  readonly httpStatus = 403;

  constructor(readonly attempted: readonly string[]) {
    super(
      `Estas opciones no se pueden fijar desde la petición: ${attempted.join(', ')}. ` +
        'Se definen en la marca o en el template.',
      { attempted },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Administración de templates.
//
// Estos seis existen porque la administración es la única superficie que ACEPTA
// plantillas del exterior, y ahí un rechazo tiene que decir exactamente qué se
// intentó: «no se pudo guardar» es indistinguible de «no tienes permiso» para
// quien está al otro lado, y las dos se arreglan de forma opuesta.
// ─────────────────────────────────────────────────────────────────────────────

/** El paquete no cumple el formato publicado. Lleva los mismos `issues` que un payload. */
export class TemplateBundleInvalidError extends PdfWorkerError {
  readonly code = 'TEMPLATE_BUNDLE_INVALID' as const;
  readonly httpStatus = 422;

  constructor(
    readonly issues: readonly PayloadIssue[],
    reason = 'El paquete de template no cumple el formato admitido.',
  ) {
    super(`${reason} Problemas: ${issues.length}.`, { issues });
  }
}

/**
 * Se intentó modificar una versión ya publicada.
 *
 * Es el §9 defendido en la API, no sólo en el registro: si una versión pudiera editarse, «este
 * informe se emitió con la 1.0.0» dejaría de significar nada. Publicar un cambio es publicar
 * una versión nueva, y el mensaje lo dice con la siguiente disponible.
 */
export class TemplateImmutableError extends PdfWorkerError {
  readonly code = 'TEMPLATE_IMMUTABLE' as const;
  readonly httpStatus = 409;

  constructor(templateId: string, version: string, sugerida: string) {
    super(
      `«${templateId}@${version}» ya está publicada y no se puede modificar. Publique una ` +
        `versión nueva, por ejemplo «${sugerida}».`,
      { templateId, version, versionSugerida: sugerida },
    );
  }
}

/** Fallo al persistir o leer el paquete. Es un problema del worker, no de quien llama. */
export class TemplateStoreError extends PdfWorkerError {
  readonly code = 'TEMPLATE_STORE_FAILED' as const;
  readonly httpStatus = 500;

  constructor(operacion: string, reason: string, cause?: unknown) {
    super(`No se pudo ${operacion} el template: ${reason}`, { operacion, reason }, { cause });
  }
}

/**
 * La administración está apagada.
 *
 * Se responde 404 y NO 403: publicar que existe una ruta administrativa desactivada es
 * decirle a quien sondea dónde volver a mirar. Con la administración apagada, la ruta no
 * existe para el mundo.
 */
export class TemplateAdminDisabledError extends PdfWorkerError {
  readonly code = 'TEMPLATE_ADMIN_DISABLED' as const;
  readonly httpStatus = 404;

  constructor() {
    super('Recurso no encontrado.', {});
  }
}

export class TemplateAdminUnauthorizedError extends PdfWorkerError {
  readonly code = 'TEMPLATE_ADMIN_UNAUTHORIZED' as const;
  readonly httpStatus = 401;

  constructor() {
    // Sin detalles: un mensaje que distinga «falta la clave» de «la clave no vale» convierte
    // el endpoint en un oráculo para quien la está adivinando.
    super('Credencial de administración ausente o inválida.', {});
  }
}

/**
 * Nadie acreditó permiso para hablar con el generador.
 *
 * Sólo existe cuando el worker corre SUELTO. Montado dentro del motor, quien autentica es el
 * `APP_GUARD` del anfitrión y este error no llega a construirse nunca — la alternativa, exigir
 * además una clave de servicio dentro del proceso que ya autenticó, obligaría a que el motor se
 * mandase una credencial a sí mismo.
 */
export class ServiceUnauthorizedError extends PdfWorkerError {
  readonly code = 'SERVICE_UNAUTHORIZED' as const;
  readonly httpStatus = 401;

  constructor() {
    // Mismo criterio que la administración: no se distingue «falta» de «no vale». Un mensaje
    // que las separe convierte el endpoint en un oráculo para quien adivina la clave.
    super('Credencial de servicio ausente o inválida.', {});
  }
}

/** Los templates incorporados se despliegan con el código; la API no los toca. */
export class TemplateBuiltinProtectedError extends PdfWorkerError {
  readonly code = 'TEMPLATE_BUILTIN_PROTECTED' as const;
  readonly httpStatus = 403;

  constructor(templateId: string, version: string) {
    super(
      `«${templateId}@${version}» es un template incorporado: se versiona con el código y no ` +
        'se puede modificar ni retirar por la API.',
      { templateId, version },
    );
  }
}

/**
 * No se puede consultar el contrato de salida de un artefacto.
 *
 * Dos situaciones con el mismo remedio distinto: el generador corre SUELTO y
 * nadie le provee el puerto: casar documentos con artefactos es una función que
 * sólo existe montado dentro del motor, que es quien tiene los contratos.
 */
export class ArtifactContractUnavailableError extends PdfWorkerError {
  readonly code = 'ARTIFACT_CONTRACT_UNAVAILABLE' as const;
  readonly httpStatus = 503;

  constructor() {
    super(
      'Este despliegue no puede consultar contratos de artefactos: el generador corre suelto y ' +
        'nadie provee ArtifactContractPort.',
      {},
    );
  }
}

/**
 * El artefacto pedido no existe, o no tiene una versión estable con contrato.
 *
 * Va aparte de `ARTIFACT_CONTRACT_UNAVAILABLE` porque son dos problemas con dos remedios
 * OPUESTOS: aquél lo arregla quien despliega —falta el proveedor—, éste quien escribió el
 * identificador. Con un solo código y un solo 503, un identificador mal escrito parecía una
 * avería del servicio y mandaba a diagnosticar al sitio equivocado.
 */
export class ArtifactNotFoundError extends PdfWorkerError {
  readonly code = 'ARTIFACT_NOT_FOUND' as const;
  readonly httpStatus = 404;

  constructor(artifactId: string, version?: string) {
    super(
      `No existe el contrato de salida de «${artifactId}${version ? `@${version}` : ''}». ` +
        'Sólo se pueden casar versiones aprobadas o desplegadas que declaren contrato.',
      { artifactId, version },
    );
  }
}
