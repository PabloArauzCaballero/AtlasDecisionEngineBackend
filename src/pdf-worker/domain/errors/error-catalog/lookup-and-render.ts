import type { ErrorCatalogEntry } from './types';
import type { PdfErrorCode } from '../pdf-worker.errors';

export const TEMPLATE_AND_RENDER_ERRORS = {
  TEMPLATE_NOT_FOUND: {
    code: 'TEMPLATE_NOT_FOUND',
    httpStatus: 404,
    title: 'El template no existe',
    meaning: 'Ningún template publicado responde a ese identificador.',
    cause: 'Identificador mal escrito, o el template aún no se ha publicado en este despliegue.',
    remedy:
      'Consulte GET /pdf/templates. El error incluye en «errors.available» la lista completa.',
    retryable: false,
    audience: 'consumidor',
  },
  TEMPLATE_VERSION_NOT_FOUND: {
    code: 'TEMPLATE_VERSION_NOT_FOUND',
    httpStatus: 404,
    title: 'La versión del template no existe',
    meaning: 'El template existe, pero no en la versión pedida.',
    cause:
      'Se fijó una versión que no llegó a este despliegue, o se retiró del catálogo por error.',
    remedy: 'Consulte GET /pdf/templates/:id/versions. El error lista las versiones registradas.',
    retryable: false,
    audience: 'consumidor',
  },
  TEMPLATE_ALREADY_REGISTERED: {
    code: 'TEMPLATE_ALREADY_REGISTERED',
    httpStatus: 409,
    title: 'Esa versión del template ya está registrada',
    meaning: 'Se intentó publicar una pareja id@versión que ya existe.',
    cause:
      'Reenvío de la publicación, o un cambio que no subió el número de versión. Las versiones ' +
      'son inmutables: un informe archivado declara con cuál salió.',
    remedy: 'Publique una versión nueva en lugar de reutilizar una existente.',
    retryable: false,
    audience: 'operador',
  },
  TEMPLATE_PAYLOAD_INVALID: {
    code: 'TEMPLATE_PAYLOAD_INVALID',
    httpStatus: 422,
    title: 'El payload no cumple el contrato del template',
    meaning: 'Los datos enviados no encajan con lo que el template exige.',
    cause:
      'Campo obligatorio ausente, tipo incorrecto, valor fuera del conjunto admitido o clave ' +
      'que el contrato no declara.',
    remedy:
      'Lea «errors.issues»: cada entrada trae campo, problema y regla esperada. El contrato ' +
      'completo está en GET /pdf/templates/:id/schema.',
    retryable: false,
    audience: 'consumidor',
  },
  TEMPLATE_SOURCE_INVALID: {
    code: 'TEMPLATE_SOURCE_INVALID',
    httpStatus: 500,
    title: 'La plantilla no se puede cargar o compilar',
    meaning: 'El archivo de la plantilla falta, no compila o incumple las reglas de seguridad.',
    cause:
      'Las plantillas no viajaron junto al código compilado, o una plantilla usa interpolación ' +
      'sin escapar, un parcial dinámico o un ayudante fuera del catálogo.',
    remedy:
      'Es un defecto del despliegue, no de la petición. Revise que «dist/pdf-worker/templates» ' +
      'exista en la imagen y el mensaje del error, que nombra el archivo.',
    retryable: false,
    audience: 'operador',
  },
  TEMPLATE_RENDER_FAILED: {
    code: 'TEMPLATE_RENDER_FAILED',
    httpStatus: 500,
    title: 'Fallo al componer el HTML',
    meaning: 'La plantilla compiló pero falló al ejecutarse con estos datos.',
    cause: 'Un ayudante recibió algo que no esperaba, o un parcial referencia un dato ausente.',
    remedy: 'Reproduzca con POST /pdf/preview y el mismo payload; el error nombra el template.',
    retryable: false,
    audience: 'operador',
  },
  PDF_RENDER_FAILED: {
    code: 'PDF_RENDER_FAILED',
    httpStatus: 502,
    title: 'El motor de impresión no produjo un PDF',
    meaning: 'El navegador falló, o devolvió algo que no empieza por la firma %PDF-.',
    cause:
      'Chromium no está instalado o se cayó; también salta si el documento supera el tamaño ' +
      'máximo configurado.',
    remedy: 'Consulte GET /pdf/health: la comprobación «renderer» dice si el navegador responde.',
    retryable: true,
    audience: 'operador',
  },
} satisfies Partial<Record<PdfErrorCode, ErrorCatalogEntry>>;
