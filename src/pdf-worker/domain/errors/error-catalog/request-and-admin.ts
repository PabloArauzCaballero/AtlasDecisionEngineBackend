import type { ErrorCatalogEntry } from './types';
import type { PdfErrorCode } from '../pdf-worker.errors';

export const REQUEST_AND_ADMIN_ERRORS = {
  PDF_RENDER_TIMEOUT: {
    code: 'PDF_RENDER_TIMEOUT',
    httpStatus: 504,
    title: 'El renderizado agotó su plazo',
    meaning: 'La impresión no terminó dentro de PDF_RENDER_TIMEOUT_MS y se abortó.',
    cause: 'Documento desproporcionado —miles de filas—, o la réplica está saturada.',
    remedy:
      'Acote el payload; si es legítimo, suba PDF_RENDER_TIMEOUT_MS y revise la memoria del ' +
      'contenedor.',
    retryable: true,
    audience: 'ambos',
  },
  PDF_RENDER_CAPACITY_EXCEEDED: {
    code: 'PDF_RENDER_CAPACITY_EXCEEDED',
    httpStatus: 429,
    title: 'Sin carriles de renderizado disponibles',
    meaning: 'Todos los renders concurrentes están ocupados y la espera agotó su plazo.',
    cause:
      'Ráfaga por encima de PDF_RENDER_CONCURRENCY. El servicio está sano: lo que falta es ' +
      'capacidad instantánea, y por eso es 429 y no 503.',
    remedy:
      'Reintente con retroceso exponencial. Si es sostenido, suba PDF_RENDER_CONCURRENCY Y la ' +
      'memoria del contenedor a la vez, o añada réplicas.',
    retryable: true,
    audience: 'ambos',
  },
  ASSET_RESOLUTION_FAILED: {
    code: 'ASSET_RESOLUTION_FAILED',
    httpStatus: 500,
    title: 'No se pudo resolver un recurso',
    meaning: 'Un logotipo, imagen o fuente referenciado no existe o no está permitido.',
    cause:
      'El archivo no está en el directorio de recursos, o se referenció con una URL o una ruta ' +
      'en lugar de «asset:<nombre>».',
    remedy:
      'Los recursos se referencian SIEMPRE como «asset:<nombre>»; el error lista los ' +
      'disponibles. Nunca se admite http(s).',
    retryable: false,
    audience: 'operador',
  },
  DOCUMENT_STORAGE_FAILED: {
    code: 'DOCUMENT_STORAGE_FAILED',
    httpStatus: 500,
    title: 'No se pudo guardar el documento',
    meaning: 'El documento se generó pero el almacenamiento lo rechazó.',
    cause: 'Directorio sin permiso de escritura, disco lleno, o una clave que ya existía.',
    remedy: 'Consulte GET /pdf/health («storage»). El documento NO se devolvió: reintente.',
    retryable: true,
    audience: 'operador',
  },
  INVALID_BRAND: {
    code: 'INVALID_BRAND',
    httpStatus: 400,
    title: 'La identidad visual no es utilizable',
    meaning: 'La marca pedida no está registrada, o su configuración es inválida.',
    cause:
      'Un «brandId» inexistente, o una marca con un color mal escrito, una longitud imposible ' +
      'o un logotipo declarado como URL.',
    remedy: 'Use una marca registrada; el error nombra el campo exacto que falla.',
    retryable: false,
    audience: 'ambos',
  },
  PROTECTED_OPTION_OVERRIDE: {
    code: 'PROTECTED_OPTION_OVERRIDE',
    httpStatus: 403,
    title: 'Se intentó fijar una opción protegida',
    meaning: 'La petición trae opciones que sólo pueden decidir la marca o el template.',
    cause:
      'Tipografía, colores, márgenes, membrete, pie o escala. Se rechaza en vez de ignorarse: ' +
      'ignorarlo produciría un documento distinto al pedido sin que nadie se entere.',
    remedy:
      'Sólo son sobrescribibles persist, filename, classification, returnContent, page.format y ' +
      'page.orientation.',
    retryable: false,
    audience: 'consumidor',
  },
  IDEMPOTENT_REQUEST_IN_FLIGHT: {
    code: 'IDEMPOTENT_REQUEST_IN_FLIGHT',
    httpStatus: 409,
    title: 'Ya hay una generación en curso con esa clave',
    meaning: 'Otra petición con la misma idempotencyKey se está atendiendo ahora mismo.',
    cause: 'Reenvío por impaciencia o por reintento automático antes de que terminara la primera.',
    remedy:
      'Espere unos segundos y reintente con la MISMA clave: obtendrá el documento original, ' +
      'marcado «REPLAYED».',
    retryable: true,
    audience: 'consumidor',
  },
  TEMPLATE_BUNDLE_INVALID: {
    code: 'TEMPLATE_BUNDLE_INVALID',
    httpStatus: 422,
    title: 'El paquete de template no cumple el formato',
    meaning: 'El JSON subido no encaja con el formato que el backend acepta.',
    cause:
      'Falta el manifiesto, el contrato usa un tipo fuera del vocabulario, la plantilla usa ' +
      'interpolación sin escapar, o los datos de ejemplo no cumplen su propio contrato.',
    remedy:
      'Descargue el formato de ejemplo en GET /pdf/templates/format/example y el esquema del ' +
      'paquete en GET /pdf/templates/format/schema. El error trae los problemas uno a uno.',
    retryable: false,
    audience: 'operador',
  },
} satisfies Partial<Record<PdfErrorCode, ErrorCatalogEntry>>;
