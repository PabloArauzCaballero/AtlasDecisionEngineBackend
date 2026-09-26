/**
 * CÓMO se tomó la imagen del documento: con la cámara de la app, o con el
 * escáner de documentos DEL SISTEMA (VisionKit en iPhone, ML Kit en Android).
 *
 * ## Por qué el worker necesita saberlo
 *
 * Todo lo que el worker mide del documento —el recorte por densidad, la
 * cobertura del catálogo, el forense de pantallas y muaré— se calibró con
 * FOTOGRAFÍAS de cédulas. Un escáner del sistema no entrega una fotografía:
 * entrega un recorte con la perspectiva ya corregida, recodificado y, en iOS,
 * con el filtro que haya elegido el usuario (color, escala de grises, blanco y
 * negro). Es otra población de imágenes, y hasta que se mida contra ella
 * (fase 5 del plan del escáner) el caso tiene que DECIRLO.
 *
 * ## Por dónde llega
 *
 * Por el `context` de la ejecución (`context.documentCaptureSource`), no por una
 * variable del artefacto. Una variable nueva en `IDENTIDAD_CARNET_MOVIL` exige
 * una versión nueva firmada por dos personas desde el portal; el contexto ya
 * viaja en cada ejecución y el invocador de workers lo recibe al atarse a ella.
 *
 * ## Lo que NO hace
 *
 * No cambia el veredicto de nadie. Con el origen ausente, o `camera`, el
 * pipeline hace exactamente lo de siempre. Con `system_scanner` se salta un
 * recorte que el escáner ya hizo y se añaden marcas INFORMATIVAS. Un valor
 * desconocido se ignora —se trata como la cámara, que es la población
 * calibrada— en vez de rechazar la ejecución: quien lo manda mal no es la
 * persona que está delante del móvil.
 */
export const DOCUMENT_CAPTURE_SOURCES = ['camera', 'system_scanner'] as const;

export type DocumentCaptureSource = (typeof DOCUMENT_CAPTURE_SOURCES)[number];

/** La clave del `context` de la ejecución en la que AtlasBackend manda el origen. */
export const DOCUMENT_CAPTURE_SOURCE_CONTEXT_KEY = 'documentCaptureSource';

/**
 * Orígenes cuya población YA se midió contra el worker.
 *
 * Sólo la cámara. `system_scanner` entra aquí cuando el corpus de la fase 5
 * (las cinco cédulas escaneadas con VisionKit y ML Kit, pasadas por
 * `scripts/diagnosticar-carnets.ts`) cumpla el criterio del plan; mientras no,
 * sus casos llevan `THRESHOLD_PROFILE_UNMEASURED`. Es un cambio de código y no
 * una bandera de entorno a propósito: declararla medida es una afirmación sobre
 * un corpus, y tiene que quedar en el historial junto a la medición.
 */
export const DOCUMENT_CAPTURE_SOURCES_MEASURED: ReadonlySet<DocumentCaptureSource> = new Set([
  'camera',
]);

/** Lee el origen de un valor cualquiera; `null` si no es uno de los conocidos. */
export function parseDocumentCaptureSource(value: unknown): DocumentCaptureSource | null {
  return typeof value === 'string' &&
    (DOCUMENT_CAPTURE_SOURCES as readonly string[]).includes(value)
    ? (value as DocumentCaptureSource)
    : null;
}

/** El origen que trae el `context` de una ejecución, si trae uno válido. */
export function documentCaptureSourceFromContext(
  context: Readonly<Record<string, unknown>> | null | undefined,
): DocumentCaptureSource | null {
  if (!context || typeof context !== 'object') return null;
  return parseDocumentCaptureSource(context[DOCUMENT_CAPTURE_SOURCE_CONTEXT_KEY]);
}
