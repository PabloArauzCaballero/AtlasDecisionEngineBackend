/**
 * Adaptador de Handlebars (§5).
 *
 * Tres decisiones de seguridad, todas con su motivo:
 *
 *  1. `knownHelpersOnly` — sólo se pueden invocar los ayudantes del catálogo. Una llamada a
 *     algo desconocido deja de resolverse en tiempo de ejecución (donde no falla, sólo pinta
 *     vacío) y pasa a ser un error al compilar la plantilla.
 *  2. `allowProtoPropertiesByDefault: false` — los datos vienen de la red. Sin esto,
 *     `{{data.constructor.name}}` es una expresión válida y el prototipo queda alcanzable.
 *  3. `strict: false` con `assertNoRawInterpolation` en el cargador — un campo ausente pinta
 *     vacío en vez de tumbar el render, pero NINGUNA plantilla de documento puede escribir
 *     `{{{ }}}`, que es por donde un payload se convertiría en HTML.
 *
 * La instancia es PROPIA (`Handlebars.create()`), no la global: registrar parciales en la
 * global los haría visibles a cualquier otro consumidor de Handlebars en el mismo proceso —y
 * este worker vive dentro de un backend grande.
 */
import { Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';
import type {
  CompiledTemplate,
  TemplateEnginePort,
} from '../../../application/ports/template-engine.port';
import { TemplateSourceError } from '../../../domain/errors/pdf-worker.errors';
import { HELPER_NAMES, registerHelpers } from './handlebars-helpers';

const KNOWN_HELPERS = Object.fromEntries(HELPER_NAMES.map((name) => [name, true]));

const RUNTIME_OPTIONS: Handlebars.RuntimeOptions = {
  allowProtoPropertiesByDefault: false,
  allowProtoMethodsByDefault: false,
};

@Injectable()
export class HandlebarsTemplateEngineAdapter implements TemplateEnginePort {
  readonly name = 'handlebars';

  private readonly env = Handlebars.create();
  private readonly compiled = new Map<string, Handlebars.TemplateDelegate>();

  constructor() {
    registerHelpers(this.env);
  }

  compile(cacheKey: string, source: string): CompiledTemplate {
    let delegate = this.compiled.get(cacheKey);
    if (!delegate) {
      try {
        // `compile()` de Handlebars es PEREZOSO: devuelve una función que se compila en la
        // primera llamada. Un ayudante desconocido o un bloque sin cerrar no fallarían aquí
        // sino en mitad del primer render, ya con una petición en curso. `precompile` obliga a
        // hacer el trabajo ahora, que es donde el error se puede explicar.
        this.env.precompile(source, {
          knownHelpers: KNOWN_HELPERS,
          knownHelpersOnly: true,
          strict: false,
          preventIndent: true,
        });
        delegate = this.env.compile(source, {
          knownHelpers: KNOWN_HELPERS,
          knownHelpersOnly: true,
          // Un `{{data.subtitulo}}` ausente no debe tumbar un informe de treinta páginas por
          // un campo opcional; los obligatorios ya los garantizó el contrato del template.
          strict: false,
          preventIndent: true,
        });
      } catch (error) {
        throw new TemplateSourceError(
          cacheKey,
          error instanceof Error ? error.message : String(error),
          error,
        );
      }
      this.compiled.set(cacheKey, delegate);
    }
    const render = delegate;
    return {
      render: (context) => render(context, RUNTIME_OPTIONS),
    };
  }

  registerPartial(name: string, source: string): void {
    this.env.registerPartial(name, source);
  }

  hasPartial(name: string): boolean {
    return Object.hasOwn(this.env.partials as Record<string, unknown>, name);
  }

  clearCache(): void {
    this.compiled.clear();
  }
}
