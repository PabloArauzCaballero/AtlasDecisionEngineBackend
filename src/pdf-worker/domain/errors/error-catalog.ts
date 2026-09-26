/**
 * Catálogo de TODOS los errores que este worker puede devolver.
 *
 * No es documentación: es un dato del programa, se publica en `GET /pdf/errors` y una prueba
 * (`test/pdf-error-catalog.spec.ts`) comprueba tres cosas que juntas impiden que envejezca —
 * que todo código tenga entrada, que toda entrada corresponda a un código, y que el
 * `httpStatus` de cada clase de error coincida con el que aquí se publica.
 *
 * Sin esa prueba, un error nuevo llega al cliente sin explicación y una entrada vieja sigue
 * prometiendo un comportamiento que ya no existe. Las dos cosas se descubren tarde y desde
 * fuera.
 *
 * `audience` es el campo que más ahorra en una incidencia: distingue lo que arregla quien
 * llama —su payload, su versión de template— de lo que sólo puede arreglar quien opera el
 * despliegue. `retryable` dice si insistir sirve de algo; reintentar un 422 es tiempo perdido
 * y reintentar un 429 es exactamente lo que hay que hacer.
 */
import { PDF_ERROR_CODES, type PdfErrorCode } from './pdf-worker.errors';

export type ErrorAudience = 'consumidor' | 'operador' | 'ambos';

export interface ErrorCatalogEntry {
  readonly code: PdfErrorCode;
  readonly httpStatus: number;
  readonly title: string;
  /** Qué significa, en una frase. */
  readonly meaning: string;
  /** Por qué suele ocurrir. */
  readonly cause: string;
  /** Qué hacer para resolverlo. */
  readonly remedy: string;
  /** ¿Reintentar la MISMA petición puede tener éxito? */
  readonly retryable: boolean;
  readonly audience: ErrorAudience;
}

export const PDF_ERROR_CATALOG: Readonly<Record<PdfErrorCode, ErrorCatalogEntry>> = {
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
  TEMPLATE_IMMUTABLE: {
    code: 'TEMPLATE_IMMUTABLE',
    httpStatus: 409,
    title: 'Esa versión ya está publicada y no se puede modificar',
    meaning: 'Se intentó editar una versión existente.',
    cause:
      'Las versiones son inmutables: si pudieran editarse, «este informe se emitió con la ' +
      '1.0.0» dejaría de significar algo.',
    remedy: 'Publique una versión nueva; el error sugiere la siguiente disponible.',
    retryable: false,
    audience: 'operador',
  },
  TEMPLATE_STORE_FAILED: {
    code: 'TEMPLATE_STORE_FAILED',
    httpStatus: 500,
    title: 'No se pudo persistir el template',
    meaning: 'El paquete es válido pero no se pudo escribir o leer del almacén.',
    cause: 'Directorio de templates personalizados sin permisos, o disco lleno.',
    remedy: 'Revise PDF_CUSTOM_TEMPLATE_PATH y los permisos del volumen.',
    retryable: true,
    audience: 'operador',
  },
  TEMPLATE_ADMIN_DISABLED: {
    code: 'TEMPLATE_ADMIN_DISABLED',
    httpStatus: 404,
    title: 'Recurso no encontrado',
    meaning: 'La administración de templates está desactivada en este despliegue.',
    cause: 'PDF_TEMPLATE_ADMIN_ENABLED no está activo. Es el valor por omisión.',
    remedy:
      'Actívela sólo donde haga falta y siempre detrás de autenticación. Responde 404 y no 403 ' +
      'a propósito: anunciar una ruta administrativa apagada es decir dónde volver a mirar.',
    retryable: false,
    audience: 'operador',
  },
  TEMPLATE_ADMIN_UNAUTHORIZED: {
    code: 'TEMPLATE_ADMIN_UNAUTHORIZED',
    httpStatus: 401,
    title: 'Credencial de administración ausente o inválida',
    meaning: 'La petición no acreditó permiso para administrar templates.',
    cause: 'Falta la cabecera de administración, o la clave no coincide.',
    remedy:
      'Envíe la clave configurada en PDF_TEMPLATE_ADMIN_KEY. El mensaje no distingue «falta» ' +
      'de «no vale» para no servir de oráculo a quien la adivina.',
    retryable: false,
    audience: 'operador',
  },
  SERVICE_UNAUTHORIZED: {
    code: 'SERVICE_UNAUTHORIZED',
    httpStatus: 401,
    title: 'Credencial de servicio ausente o inválida',
    meaning: 'La petición no acreditó permiso para hablar con el generador documental.',
    cause:
      'El worker corre como proceso suelto y exige clave de servicio. Falta la cabecera ' +
      'configurada en PDF_SERVICE_HEADER, o su valor no coincide con PDF_SERVICE_API_KEY.',
    remedy:
      'Envíe la clave de servicio. Montado DENTRO del motor no aplica: allí autentica el ' +
      'guardia global del anfitrión y esta puerta se desactiva sola.',
    retryable: false,
    audience: 'operador',
  },
  TEMPLATE_BUILTIN_PROTECTED: {
    code: 'TEMPLATE_BUILTIN_PROTECTED',
    httpStatus: 403,
    title: 'Los templates incorporados no se tocan por la API',
    meaning: 'Se intentó modificar o retirar un template que viaja con el código.',
    cause:
      'Los incorporados se versionan en el repositorio y se despliegan con la imagen; ' +
      'cambiarlos en caliente rompería la correspondencia entre código y comportamiento.',
    remedy: 'Publique un template personalizado con otro identificador, o cambie el código.',
    retryable: false,
    audience: 'operador',
  },
  ARTIFACT_CONTRACT_UNAVAILABLE: {
    code: 'ARTIFACT_CONTRACT_UNAVAILABLE',
    httpStatus: 503,
    title: 'No se puede consultar el contrato del artefacto',
    meaning: 'No hay forma de saber qué campos publica el artefacto pedido.',
    cause:
      'O el generador corre suelto —casar documentos con artefactos sólo existe montado dentro ' +
      'del motor, que es quien tiene los contratos de salida— o el artefacto no existe.',
    remedy:
      'Si el mensaje no nombra ningún artefacto, la función no está disponible en este ' +
      'despliegue. Si lo nombra, revise el identificador y la versión.',
    retryable: false,
    audience: 'operador',
  },
  ARTIFACT_NOT_FOUND: {
    code: 'ARTIFACT_NOT_FOUND',
    httpStatus: 404,
    title: 'El artefacto no existe o no tiene contrato de salida',
    meaning: 'No hay ninguna versión estable de ese artefacto que declare qué campos publica.',
    cause:
      'Identificador mal escrito, o el artefacto sólo tiene versiones en borrador. Un borrador ' +
      'no se ofrece: su contrato puede cambiar bajo los pies de quien lo imprime.',
    remedy: 'Consulte GET /pdf/artifacts, que lista los que sí se pueden casar.',
    retryable: false,
    audience: 'consumidor',
  },
};

/** Lista ordenada, para publicarla y para documentarla. */
export function errorCatalogEntries(): readonly ErrorCatalogEntry[] {
  return PDF_ERROR_CODES.map((code) => PDF_ERROR_CATALOG[code]);
}
