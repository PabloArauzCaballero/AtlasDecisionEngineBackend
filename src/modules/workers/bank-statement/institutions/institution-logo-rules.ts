import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../../common/errors/domain-exception';

/** Lo que un navegador pinta sin plugins. El resto no entra. */
const ALLOWED_LOGO_TYPES = new Set(['image/svg+xml', 'image/png', 'image/jpeg']);

/**
 * Tope del logotipo. 256 KiB sobra para cualquier marca vectorial o un PNG de
 * 512 px; lo que pasa de aquí es una foto que alguien arrastró por error, y
 * guardarla en una columna que se lee en cada listado del padrón cuesta en cada
 * consulta.
 */
const MAX_LOGO_BYTES = 256 * 1024;

/**
 * Si un SVG trae guiones o contenido incrustado.
 *
 * Se comprueba sobre los bytes en crudo y de forma deliberadamente amplia: un
 * SVG es XML, se sirve desde el mismo origen que el portal, y un `<script>` o un
 * `onload=` dentro se ejecuta con la sesión de quien administra el padrón. Ante
 * la duda se rechaza — un logotipo con un guion dentro no tiene ningún uso
 * legítimo aquí.
 */
function hasActiveMarkup(data: Buffer): boolean {
  const text = data.toString('utf8', 0, Math.min(data.byteLength, 64 * 1024)).toLowerCase();
  return (
    text.includes('<script') ||
    text.includes('javascript:') ||
    text.includes('<foreignobject') ||
    text.includes('<iframe') ||
    text.includes('<embed') ||
    text.includes('<use xlink:href="http') ||
    /\son\w+\s*=/.test(text)
  );
}

/**
 * Comprueba y decodifica un logotipo cargado: tipo admitido, peso razonable y, si es SVG, sin
 * contenido activo. Devuelve los bytes y el tipo normalizado.
 */
export function validateLogoUpload(
  code: string,
  input: { base64: string; contentType: string },
): { data: Buffer; contentType: string } {
  const contentType = input.contentType.trim().toLowerCase();
  if (!ALLOWED_LOGO_TYPES.has(contentType)) {
    throw new DomainException(
      'INSTITUTION_LOGO_UNSUPPORTED_TYPE',
      `El logotipo debe ser ${[...ALLOWED_LOGO_TYPES].join(', ')}; llegó ${contentType}.`,
      HttpStatus.BAD_REQUEST,
      { code, contentType },
    );
  }

  const data = Buffer.from(input.base64.replace(/^data:[^,]+,/, ''), 'base64');
  if (data.byteLength === 0 || data.byteLength > MAX_LOGO_BYTES) {
    throw new DomainException(
      'INSTITUTION_LOGO_TOO_LARGE',
      `El logotipo debe pesar entre 1 byte y ${String(MAX_LOGO_BYTES / 1024)} KiB.`,
      HttpStatus.BAD_REQUEST,
      { code, bytes: data.byteLength },
    );
  }
  if (contentType === 'image/svg+xml' && hasActiveMarkup(data)) {
    throw new DomainException(
      'INSTITUTION_LOGO_ACTIVE_SVG',
      'El SVG contiene guiones o contenido incrustado y no se puede servir. Expórtalo otra vez sin scripts.',
      HttpStatus.BAD_REQUEST,
      { code },
    );
  }
  return { data, contentType };
}
