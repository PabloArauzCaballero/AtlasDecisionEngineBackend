import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { IDENTITY_DEFAULTS, type IdentityOptions } from './core/identity-options';

const logger = new Logger('IdentityWorkerConfig');

/**
 * Puente entre el `ConfigService` del motor y los ajustes del núcleo absorbido.
 *
 * Mismo papel que `semantic-config.bridge.ts`: el paquete original validaba su
 * propio esquema de entorno al arrancar, lo que impedía levantar cualquier
 * proceso —incluida una réplica de API con el worker apagado— sin la
 * configuración completa. Aquí los valores se resuelven una vez, con los mismos
 * valores por omisión, y el esquema del motor ya los ha validado.
 *
 * **Los dos umbrales biométricos van juntos o no van.** Si sólo llega uno se
 * descartan los dos y se registra el motivo: con un umbral suelto el motor de
 * decisión no puede decidir, y aceptarlo a medias produciría una calibración
 * inventada sobre la identidad de una persona. Sin ellos toda ejecución termina
 * en `REVIEW_REQUIRED` con `THRESHOLD_PROFILE_MISSING`, que es visible y
 * corregible; una cifra a ojo no lo sería.
 */
export function buildIdentityOptions(config: ConfigService): IdentityOptions {
  const match = config.get<number>('IDENTITY_MATCH_THRESHOLD');
  const review = config.get<number>('IDENTITY_REVIEW_THRESHOLD');
  const profile =
    config.get<string>('IDENTITY_THRESHOLD_PROFILE_VERSION') ??
    IDENTITY_DEFAULTS.thresholdProfileVersion;

  const paired = typeof match === 'number' && typeof review === 'number';
  if (!paired && (typeof match === 'number' || typeof review === 'number')) {
    logger.warn(
      'IDENTITY_MATCH_THRESHOLD e IDENTITY_REVIEW_THRESHOLD deben configurarse juntos; ' +
        'se ignoran los dos y cada verificación terminará en revisión manual.',
    );
  }
  if (paired && review >= match) {
    logger.warn(
      `IDENTITY_REVIEW_THRESHOLD (${review}) debe ser menor que IDENTITY_MATCH_THRESHOLD (${match}); ` +
        'se ignoran los dos.',
    );
  }
  if (paired && profile === IDENTITY_DEFAULTS.thresholdProfileVersion) {
    logger.warn(
      'Hay umbrales configurados pero IDENTITY_THRESHOLD_PROFILE_VERSION sigue en «unconfigured»: ' +
        'el resultado no dirá contra qué calibración se decidió.',
    );
  }
  const usable = paired && review < match;

  const number = (key: string, fallback: number): number => config.get<number>(key) ?? fallback;
  const flag = (key: string, fallback: boolean): boolean => config.get<boolean>(key) ?? fallback;
  const text = (key: string, fallback: string): string => config.get<string>(key) ?? fallback;

  return {
    ...(usable ? { matchThreshold: match, reviewThreshold: review } : {}),
    thresholdProfileVersion: profile,
    minDocumentQuality: number(
      'IDENTITY_MIN_DOCUMENT_QUALITY',
      IDENTITY_DEFAULTS.minDocumentQuality,
    ),
    minSelfieQuality: number('IDENTITY_MIN_SELFIE_QUALITY', IDENTITY_DEFAULTS.minSelfieQuality),
    minFaceAreaRatio: number('IDENTITY_MIN_FACE_AREA_RATIO', IDENTITY_DEFAULTS.minFaceAreaRatio),
    documentExpiryGraceDays: number(
      'IDENTITY_DOCUMENT_EXPIRY_GRACE_DAYS',
      IDENTITY_DEFAULTS.documentExpiryGraceDays,
    ),
    maxImagePixels: number('IDENTITY_MAX_IMAGE_PIXELS', IDENTITY_DEFAULTS.maxImagePixels),
    minImageWidth: number('IDENTITY_MIN_IMAGE_WIDTH', IDENTITY_DEFAULTS.minImageWidth),
    minImageHeight: number('IDENTITY_MIN_IMAGE_HEIGHT', IDENTITY_DEFAULTS.minImageHeight),
    minImagePixels: number('IDENTITY_MIN_IMAGE_PIXELS', IDENTITY_DEFAULTS.minImagePixels),
    minReadableLongEdge: number(
      'IDENTITY_MIN_READABLE_LONG_EDGE',
      IDENTITY_DEFAULTS.minReadableLongEdge,
    ),
    minReadableShortEdge: number(
      'IDENTITY_MIN_READABLE_SHORT_EDGE',
      IDENTITY_DEFAULTS.minReadableShortEdge,
    ),
    faceCropPaddingRatio: number(
      'IDENTITY_FACE_CROP_PADDING_RATIO',
      IDENTITY_DEFAULTS.faceCropPaddingRatio,
    ),
    minDocumentFacePx: number('IDENTITY_MIN_DOCUMENT_FACE_PX', IDENTITY_DEFAULTS.minDocumentFacePx),
    livenessEnabled: flag('IDENTITY_LIVENESS_ENABLED', IDENTITY_DEFAULTS.livenessEnabled),
    livenessPassScore: number('IDENTITY_LIVENESS_PASS_SCORE', IDENTITY_DEFAULTS.livenessPassScore),
    livenessFailScore: number('IDENTITY_LIVENESS_FAIL_SCORE', IDENTITY_DEFAULTS.livenessFailScore),
    documentClassificationEnabled: flag(
      'IDENTITY_DOCUMENT_CLASSIFICATION_ENABLED',
      IDENTITY_DEFAULTS.documentClassificationEnabled,
    ),
    ocrProvider: text('IDENTITY_OCR_PROVIDER', IDENTITY_DEFAULTS.ocrProvider),
    faceProvider: text('IDENTITY_FACE_PROVIDER', IDENTITY_DEFAULTS.faceProvider),
    livenessProvider: flag('IDENTITY_LIVENESS_ENABLED', IDENTITY_DEFAULTS.livenessEnabled)
      ? text('IDENTITY_LIVENESS_PROVIDER', IDENTITY_DEFAULTS.livenessProvider)
      : 'disabled',
    maxUploadBytes: number('IDENTITY_MAX_UPLOAD_BYTES', IDENTITY_DEFAULTS.maxUploadBytes),
    defaultDocumentCountry: text(
      'IDENTITY_DEFAULT_DOCUMENT_COUNTRY',
      IDENTITY_DEFAULTS.defaultDocumentCountry,
    ),
  };
}
