/**
 * Revisión estática de las plantillas de documento, al cargarlas.
 *
 * Lo que persigue es una sola cosa, y es la más peligrosa: `{{{ }}}` y `{{& }}` insertan el
 * valor SIN escapar. En una plantilla de documento eso significa que un payload con
 * `<script>` o con un `<img src=x onerror=...>` deja de ser texto y pasa a ser marcado dentro
 * del navegador que imprime (§24). El escapado por defecto de Handlebars es la barrera; estas
 * dos formas son la manera de saltársela sin querer.
 *
 * La comprobación es de CARGA, no de ejecución: una plantilla que la incumple impide arrancar
 * el worker. Descubrirlo en el primer render sería descubrirlo en producción.
 *
 * El layout compartido está exento y llama a `assertNoRawInterpolation` con `allowRaw`: es
 * quien inserta el cuerpo ya renderizado y el bloque de estilos, y ambos los fabrica este
 * código, no el payload.
 */
import { TemplateSourceError } from '../../domain/errors/pdf-worker.errors';

const RAW_INTERPOLATION = /\{\{\{|\{\{\s*&/;

/**
 * Comentarios de Handlebars, que NO son código.
 *
 * Se eliminan antes de comprobar nada. Sin esto, la propia nota que explica «esta plantilla no
 * puede usar `{{{ }}}`» hace que la comprobación rechace la plantilla — un caso perfectamente
 * real: fue el primer fallo de estas reglas contra las plantillas de ejemplo. Una comprobación
 * que castiga documentar la regla se acaba desactivando.
 */
const COMMENT = /\{\{!--[\s\S]*?--\}\}|\{\{![^}]*\}\}/g;

function withoutComments(source: string): string {
  return source.replace(COMMENT, '');
}
/** Cubre `{{> x}}` y también `{{#> x}}` (parcial con bloque), que es la vía por la que un
 *  nombre dinámico se colaría sin que la comprobación se enterase. */
const PARTIAL_CALL = /\{\{#?>\s*([^\s}]+)/g;

/** Nombres de parcial admitidos: `atlas/...` (compartidos) o el ámbito del propio documento. */
const PARTIAL_NAME = /^(atlas\/[a-z0-9-]+|[a-z0-9-]+@\d+\.\d+\.\d+\/[a-z0-9-]+)$/;

export function assertNoRawInterpolation(source: string, origin: string): void {
  if (RAW_INTERPOLATION.test(withoutComments(source))) {
    throw new TemplateSourceError(
      origin,
      'usa interpolación sin escapar ({{{ }}} o {{& }}). El contenido de un payload nunca ' +
        'puede insertarse como marcado; use {{ }}.',
    );
  }
}

/**
 * Un parcial dinámico (`{{> (lookup . "name")}}`) permitiría que el payload eligiera qué
 * plantilla se ejecuta. Se exige que el nombre sea literal y del catálogo.
 */
export function assertStaticPartials(source: string, origin: string): void {
  for (const match of withoutComments(source).matchAll(PARTIAL_CALL)) {
    const name = match[1];
    if (name.startsWith('(')) {
      throw new TemplateSourceError(
        origin,
        'invoca un parcial dinámico; el nombre debe ser literal para que el payload no pueda ' +
          'elegir qué plantilla se ejecuta.',
      );
    }
    if (!PARTIAL_NAME.test(name)) {
      throw new TemplateSourceError(
        origin,
        `invoca el parcial «${name}», que no pertenece al catálogo compartido (atlas/…) ni al ` +
          'ámbito del propio documento.',
      );
    }
  }
}

export function lintDocumentTemplate(source: string, origin: string): void {
  assertNoRawInterpolation(source, origin);
  assertStaticPartials(source, origin);
}
