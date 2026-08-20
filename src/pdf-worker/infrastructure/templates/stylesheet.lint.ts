/**
 * Revisión de la hoja de estilos de un template subido.
 *
 * Persigue una sola cosa: que el CSS no vuelva a atar el documento a la red. El adaptador de
 * renderizado ya aborta toda petición que no sea `data:`, así que un `@import` remoto no
 * llegaría a cargarse — pero fallaría en SILENCIO, y el documento saldría con otra tipografía
 * o sin un fondo sin que nadie se entere hasta abrirlo. Rechazarlo al publicar convierte ese
 * defecto invisible en un mensaje.
 *
 * `expression()` es un vestigio de Internet Explorer que ejecutaba JavaScript desde CSS.
 * Chromium no lo interpreta, así que hoy es inofensivo; se rechaza igual porque su presencia
 * en un archivo que alguien subió no es un descuido de estilo, es una señal.
 *
 * NO se comprueba que el CSS sea sintácticamente válido. Un navegador descarta la declaración
 * que no entiende y sigue, que es el comportamiento correcto: exigir un analizador completo
 * aquí añadiría una dependencia y rechazaría CSS perfectamente utilizable por una propiedad
 * nueva que el analizador aún no conozca.
 */
import { TemplateSourceError } from '../../domain/errors/pdf-worker.errors';

const REGLAS: ReadonlyArray<{ patron: RegExp; motivo: string }> = [
  {
    patron: /@import\b/i,
    motivo:
      'usa «@import». Traería una hoja de estilos externa y el render no tiene red: el estilo ' +
      'no se aplicaría y el documento saldría distinto sin ningún aviso.',
  },
  {
    patron: /url\(\s*['"]?\s*(https?:|\/\/)/i,
    motivo:
      'referencia una URL remota en «url()». Los recursos se declaran como «asset:<nombre>» y ' +
      'se embeben; una URL se aborta al renderizar y deja el hueco vacío.',
  },
  {
    patron: /expression\s*\(/i,
    motivo: 'contiene «expression()», que fue un mecanismo para ejecutar código desde CSS.',
  },
  {
    patron: /<\s*\/?\s*(script|style|iframe|object|embed)\b/i,
    motivo: 'contiene marcado HTML; una hoja de estilos sólo debe llevar CSS.',
  },
  {
    patron: /javascript\s*:/i,
    motivo:
      'contiene un «javascript:», que no tiene ningún uso legítimo en la hoja de un documento.',
  },
];

export function lintStylesheet(source: string, origin: string): void {
  // Los comentarios se retiran primero, por el mismo motivo que en las plantillas: una nota que
  // explique «aquí no se puede usar @import» no puede hacer que la comprobación rechace el
  // archivo. Una regla que castiga documentarla se acaba desactivando.
  const limpio = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const { patron, motivo } of REGLAS) {
    if (patron.test(limpio)) {
      throw new TemplateSourceError(origin, `la hoja de estilos ${motivo}`);
    }
  }
}
