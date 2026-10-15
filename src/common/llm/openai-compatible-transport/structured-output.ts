import { DEFAULT_TRANSPORT_ERRORS, type TransportErrors } from './provider-errors';

/**
 * Convierte el cuerpo de una respuesta en el objeto JSON que se espera de la
 * salida estructurada, con errores que distinguen «no es JSON» de «no es un
 * objeto».
 */
export function parseStructuredOutput(
  outputText: string,
  errors: TransportErrors = DEFAULT_TRANSPORT_ERRORS,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error: unknown) {
    throw errors.provider('La salida estructurada no es JSON válido.', false, { cause: error });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw errors.provider('La salida estructurada no es un objeto JSON.', false);
  }
  return parsed as Record<string, unknown>;
}

/** Normaliza una base de API quitando las barras finales. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, '');
}

/**
 * El texto de `message.content`, admitiendo las dos formas que atraviesan un
 * gateway.
 *
 * Los proxies normalizan a cadena para casi todos sus proveedores, pero los que
 * devuelven bloques de contenido (Anthropic, Vertex) pueden atravesarlos como
 * lista. Rechazar la lista dejaría el mismo modelo funcionando con un proveedor
 * y roto con su suplente, que es exactamente el fallo que un gateway existe
 * para evitar y el que sólo se manifiesta durante una caída. Vive aquí y no en
 * cada adaptador porque LiteLLM y OpenRouter comparten el problema letra por
 * letra.
 */
export function extractMessageContent(
  content: unknown,
  errors: TransportErrors = DEFAULT_TRANSPORT_ERRORS,
): string {
  if (typeof content === 'string' && content.trim().length > 0) {
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { text: string } => isTextPart(part))
      .map((part) => part.text)
      .join('');
    if (text.trim().length > 0) return text;
  }
  throw errors.provider('La respuesta del modelo no contiene salida estructurada.', false);
}

function isTextPart(part: unknown): part is { text: string } {
  return (
    typeof part === 'object' &&
    part !== null &&
    typeof (part as { text?: unknown }).text === 'string'
  );
}
