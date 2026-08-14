/**
 * Lectura del texto de las plantillas y sus estilos.
 *
 * Está separado de `TemplateEnginePort` porque son dos responsabilidades que cambian por
 * motivos distintos: de dónde sale el texto (disco, un paquete, una base) y qué sintaxis
 * tiene. Juntarlas obliga a reescribir el motor para servir plantillas desde otro sitio.
 *
 * La aplicación NUNCA construye una ruta: pasa el contrato, y el adaptador resuelve dentro de
 * `contract.sourceDir` por convención (`template.hbs`, `styles.css`, `partials/*.hbs`).
 */
import type { TemplateContract } from '../../domain/contracts/template-contract';

export interface DocumentSources {
  readonly body: string;
  readonly css: string;
  /** Parciales propios del documento, ya con su nombre corto. */
  readonly partials: Readonly<Record<string, string>>;
}

export interface SharedSources {
  /** Envoltorio con `<html>`, `<head>` y los huecos del §10. */
  readonly layout: string;
  readonly header: string;
  readonly footer: string;
  /** Restablecimiento, tokens y reglas de impresión, en ese orden. */
  readonly css: string;
  /** Parciales reutilizables del §29, con prefijo `atlas/`. */
  readonly partials: Readonly<Record<string, string>>;
}

export interface TemplateSourceLoaderPort {
  loadShared(): Promise<SharedSources>;
  loadDocument(contract: TemplateContract): Promise<DocumentSources>;
  /** Vacía la caché de lectura. Sólo lo usa el modo de desarrollo. */
  invalidate(): void;
}

export const TEMPLATE_SOURCE_LOADER_PORT = Symbol('TemplateSourceLoaderPort');
