import { PdfWorkerError } from './codes-and-base';
import { PayloadIssue } from './template-errors';

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
