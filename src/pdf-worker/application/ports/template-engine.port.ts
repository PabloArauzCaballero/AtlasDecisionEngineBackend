/**
 * Frontera con el motor de plantillas (§5).
 *
 * El contrato es deliberadamente pobre: compilar una fuente y registrar parciales. No expone
 * «helpers», ni contexto global, ni acceso al sistema de archivos, porque cada una de esas
 * puertas es también la puerta por la que un motor de plantillas se convierte en ejecución
 * arbitraria. El adaptador de Handlebars registra su propio juego cerrado de ayudantes.
 *
 * `cacheKey` lo aporta quien llama —es `id@version:archivo`— en vez de derivarlo del texto:
 * compilar es caro y el texto de un template puede pesar decenas de KiB; hashearlo en cada
 * render para descubrir que no ha cambiado es trabajo por nada.
 */
export interface CompiledTemplate {
  render(context: Readonly<Record<string, unknown>>): string;
}

export interface TemplateEnginePort {
  readonly name: string;
  compile(cacheKey: string, source: string): CompiledTemplate;
  /** Los parciales son GLOBALES al motor; el nombre debe llevar prefijo de espacio. */
  registerPartial(name: string, source: string): void;
  hasPartial(name: string): boolean;
  /** Invalida la caché de compilación. Sólo lo usa el modo de desarrollo con recarga. */
  clearCache(): void;
}

export const TEMPLATE_ENGINE_PORT = Symbol('TemplateEnginePort');
