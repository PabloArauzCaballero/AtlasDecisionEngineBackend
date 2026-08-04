import type { TextToken } from '../../domain/models';

/** Página que el motor necesita reconocer porque no trae texto utilizable. */
export interface OcrPageRequest {
  readonly pageNumber: number;
  /** Ancho en puntos, para que el reconocedor devuelva coordenadas comparables. */
  readonly pageWidth: number;
}

export interface OcrRequest {
  readonly pdf: Buffer;
  readonly pages: readonly OcrPageRequest[];
}

export interface OcrLine {
  readonly page: number;
  readonly pageWidth: number;
  /** Mayor valor, más arriba en la página: la misma convención que el lector. */
  readonly y: number;
  readonly tokens: readonly TextToken[];
}

export interface OcrResult {
  readonly lines: readonly OcrLine[];
  /** Nombre del motor usado. Viaja a la traza, nunca a una decisión. */
  readonly engine: string;
}

/**
 * Puerto de reconocimiento óptico.
 *
 * El módulo **declara** esta interfaz pero no empaqueta ninguna
 * implementación, y esa ausencia es una decisión, no una carencia: todos los
 * motores de OCR disponibles en Node son dependencias nativas que exigen
 * compilación o binarios del sistema, y este módulo se instala sin compilar
 * nada ([ADR-0002](../../../docs/adr/ADR-0002-procesamiento-en-memoria.md)).
 *
 * La aplicación anfitriona inyecta el suyo con el token
 * `STATEMENT_OCR_PORT` si necesita procesar extractos escaneados. Sin él, un
 * PDF sin capa de texto se rechaza con un error que lo dice, en lugar de
 * devolver un extracto vacío.
 *
 * El motor solo pide las páginas que hacen falta: ejecutar OCR sobre un
 * documento que ya trae texto multiplicaría el coste y la latencia sin ganar
 * nada.
 */
export interface StatementOcrPort {
  recognize(request: OcrRequest): Promise<OcrResult>;
}

export const STATEMENT_OCR_PORT = Symbol('STATEMENT_OCR_PORT');
