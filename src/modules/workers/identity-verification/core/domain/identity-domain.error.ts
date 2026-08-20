/**
 * Errores de dominio del worker de identidad.
 *
 * Absorbido del paquete original. La `category` es lo que separa el fallo que
 * no tiene arreglo del que sí: el servicio de fondo la lee para decidir si
 * reintenta o cierra la ejecución, igual que el worker de extractos hace con
 * `StatementProcessingError`. Colapsarlos todos a un 500 —o reintentarlos
 * todos— convierte una cola en un bucle.
 */

export type IdentityErrorCategory =
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'VALIDATION'
  | 'SECURITY'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'MALFORMED_INPUT'
  | 'INTERNAL';

export class IdentityDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly category: IdentityErrorCategory,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'IdentityDomainError';
  }
}

/**
 * Los mensajes van en español porque el portal los enseña tal cual.
 *
 * Es el único cambio respecto del paquete original, que los escribía en inglés
 * para una API sin interfaz propia: aquí el destinatario es la persona que
 * acaba de subir una foto, y «The document image quality is insufficient» no le
 * dice qué hacer.
 */
/**
 * Traduce los avisos de la medición al gesto que corrige cada uno.
 *
 * El orden importa: se contesta al defecto que más manda. Una imagen diminuta no
 * se arregla con luz por muy oscura que esté además, así que la resolución va
 * primera; sólo cuando el tamaño da se habla de exposición o de foco.
 */
function consejoDeCalidad(warnings: readonly string[]): string {
  if (warnings.includes('LOW_RESOLUTION')) {
    return 'La imagen es demasiado pequeña para leer el documento: envía la foto original de la cámara, sin recortar ni reenviar por mensajería, con la cédula llenando el encuadre.';
  }
  if (warnings.includes('UNDEREXPOSED')) return 'Está muy oscura: repítela con más luz.';
  if (warnings.includes('OVEREXPOSED')) {
    return 'Está quemada por la luz: repítela sin flash directo y sin reflejos sobre el plástico.';
  }
  if (warnings.includes('LOW_CONTRAST')) {
    return 'El documento apenas se distingue del fondo: apóyalo sobre una superficie de otro color.';
  }
  if (warnings.includes('POSSIBLE_BLUR')) {
    return 'Salió movida: sujeta el móvil con las dos manos y espera a que enfoque.';
  }
  return 'Repítela con más luz, sin reflejos y con la cédula llenando el encuadre.';
}

export const identityErrors = {
  invalidDocument: (message = 'La imagen del documento no es válida.') =>
    new IdentityDomainError('IDENTITY_DOCUMENT_INVALID', message, 'VALIDATION'),
  /**
   * El consejo sale de lo que FALLÓ, no de una plantilla.
   *
   * El mensaje era uno solo —«repítela con más luz, sin reflejos y con la cédula
   * llenando el encuadre»— y se daba también cuando el problema no tenía nada
   * que ver con la luz. Caso real: alguien sube una imagen de 445×282 px; a ese
   * tamaño el número de la cédula mide unos cinco píxeles de alto y no hay OCR
   * que valga, pero la persona lee «más luz», se va a la ventana, repite la foto
   * igual de pequeña y vuelve a fallar. Un consejo que no aplica es peor que no
   * dar ninguno: hace perder el intento siguiente.
   *
   * Las medidas ya estaban ahí (`ImageQualityAssessmentService` las publica);
   * sólo faltaba mirarlas antes de escribir la frase.
   */
  blurryDocument: (warnings: readonly string[] = []) =>
    new IdentityDomainError(
      'IDENTITY_DOCUMENT_BLURRY',
      `La foto del documento no tiene calidad suficiente. ${consejoDeCalidad(warnings)}`,
      'VALIDATION',
    ),
  /**
   * El único rechazo por TAMAÑO que queda, y es un suelo medido.
   *
   * Tiene código propio porque «borrosa» y «diminuta» no se arreglan igual y
   * durante meses se contestaron con el mismo: una miniatura de 445×282 salía
   * como `IDENTITY_DOCUMENT_BLURRY` —«no tiene calidad suficiente»— cuando esa
   * misma imagen, medida, se lee entera. Un código que miente sobre la causa
   * manda a quien lo recibe a arreglar lo que no estaba roto.
   */
  documentTooSmall: (width: number, height: number, longEdge: number, shortEdge: number) =>
    new IdentityDomainError(
      'IDENTITY_DOCUMENT_TOO_SMALL',
      `La foto del documento mide ${width}x${height} px y por debajo de ${longEdge}x${shortEdge} no queda texto que leer. ${consejoDeCalidad(['LOW_RESOLUTION'])}`,
      'VALIDATION',
    ),
  unsupportedDocument: (message = 'Ese tipo de documento no está soportado.') =>
    new IdentityDomainError('IDENTITY_DOCUMENT_UNSUPPORTED', message, 'VALIDATION'),
  faceNotFound: () =>
    new IdentityDomainError(
      'IDENTITY_FACE_NOT_FOUND',
      'No se detectó ningún rostro utilizable.',
      'VALIDATION',
    ),
  documentFaceTooSmall: (width: number, height: number, minimum: number) =>
    new IdentityDomainError(
      'IDENTITY_DOCUMENT_FACE_TOO_SMALL',
      `El retrato del documento queda en ${width}x${height} px, por debajo del mínimo de ${minimum} px que exige una comparación fiable. Repite la foto más cerca del documento.`,
      'VALIDATION',
    ),
  multipleFaces: () =>
    new IdentityDomainError(
      'IDENTITY_MULTIPLE_FACES',
      'Se detectó más de un rostro.',
      'VALIDATION',
    ),
  invalidSelfie: (message = 'La selfie no es válida.') =>
    new IdentityDomainError('IDENTITY_SELFIE_INVALID', message, 'VALIDATION'),
  livenessFailed: () =>
    new IdentityDomainError(
      'IDENTITY_LIVENESS_FAILED',
      'La prueba de vida no se superó.',
      'PERMANENT',
    ),
  providerUnavailable: (provider: string) =>
    new IdentityDomainError(
      'IDENTITY_PROVIDER_UNAVAILABLE',
      `${provider} no está disponible temporalmente.`,
      'PROVIDER_UNAVAILABLE',
      true,
    ),
  providerBackpressure: (provider: string) =>
    new IdentityDomainError(
      'IDENTITY_PROVIDER_BACKPRESSURE',
      `${provider} está saturado.`,
      'PROVIDER_RATE_LIMIT',
      true,
    ),
  disabled: () =>
    new IdentityDomainError(
      'IDENTITY_FEATURE_DISABLED',
      'La verificación de identidad está deshabilitada.',
      'PERMANENT',
    ),
};
