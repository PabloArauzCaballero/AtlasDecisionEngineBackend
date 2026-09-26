/**
 * Frontera con el motor de impresión.
 *
 * Es el puerto que hace verdad el §4: la aplicación entrega HTML ya compuesto y una geometría
 * de página, y recibe bytes. No sabe que existe un navegador. Sustituir Playwright por
 * Gotenberg, WeasyPrint o un servicio remoto es escribir otra clase que implemente esto y
 * cambiar `PDF_RENDERER` en la configuración; ningún caso de uso se entera.
 *
 * `header`/`footer` viajan como HTML aparte a propósito. El membrete y el pie corridos NO son
 * parte del flujo del documento: se pintan en los márgenes de cada hoja, y la numeración
 * «Página X de Y» sólo la puede resolver quien ya sabe cuántas hojas hay — el motor. Meterlos
 * en el cuerpo produce el defecto clásico: la cabecera aparece una vez y el resto del informe
 * queda sin identificar.
 */
import type { PageSetup } from '../../domain/value-objects/page-setup';

export interface PdfRenderInput {
  /** Documento completo y AUTOCONTENIDO: sin `<link>`, sin `<script>`, sin URL remotas. */
  readonly html: string;
  readonly page: PageSetup;
  /** HTML del membrete corrido. Vacío o ausente = sin cabecera. */
  readonly headerHtml?: string;
  /** HTML del pie corrido; es quien resuelve `pageNumber` y `totalPages`. */
  readonly footerHtml?: string;
  readonly timeoutMs: number;
  /** Sólo para trazas y para nombrar el contexto en los registros del motor. */
  readonly documentId: string;
}

export interface PdfRenderResult {
  readonly content: Buffer;
  readonly durationMs: number;
  /** Identificador del motor que lo produjo; se archiva en la ficha del documento (§33). */
  readonly renderer: string;
  readonly pageCount?: number;
}

export interface RendererHealth {
  readonly available: boolean;
  readonly renderer: string;
  readonly detail?: string;
  /** Versión del navegador/servicio. Cambiarla puede cambiar el pixel: se registra. */
  readonly engineVersion?: string;
  readonly activeRenders?: number;
  readonly maxConcurrency?: number;
}

export interface PdfRendererPort {
  readonly name: string;
  render(input: PdfRenderInput): Promise<PdfRenderResult>;
  /** Sonda para `/health` (§35). No debe lanzar: un motor caído es un informe, no una excepción. */
  health(): Promise<RendererHealth>;
  /** Libera navegador y contextos. Lo llama el cierre ordenado de Nest. */
  shutdown(): Promise<void>;
}

export const PDF_RENDERER_PORT = Symbol('PdfRendererPort');
