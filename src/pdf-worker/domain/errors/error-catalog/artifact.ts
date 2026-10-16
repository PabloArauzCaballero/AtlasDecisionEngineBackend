import type { ErrorCatalogEntry } from './types';
import type { PdfErrorCode } from '../pdf-worker.errors';

export const ARTIFACT_ERRORS = {
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
} satisfies Partial<Record<PdfErrorCode, ErrorCatalogEntry>>;
