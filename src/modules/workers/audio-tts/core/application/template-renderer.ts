import { AudioDomainError } from '../domain/errors';
import { normalizeText } from './audio-asset-key';

/**
 * Las llaves van escapadas de forma explícita: con el flag `u` de Unicode,
 * `{` y `}` sin escapar son un SyntaxError de expresión regular.
 */
const TOKEN_SOURCE = '\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}';
const SAFE_DYNAMIC_VALUE = /^[\p{L}\p{M}0-9 .,'’_-]{1,80}$/u;
const MAX_VARIABLES = 16;

/** Instancia sin estado global: `lastIndex` de un regex `g` haría que `.test()` alterne. */
function tokenMatcher(): RegExp {
  return new RegExp(TOKEN_SOURCE, 'gu');
}

export function hasTemplateTokens(template: string): boolean {
  return new RegExp(TOKEN_SOURCE, 'u').test(template);
}

export function templateTokens(template: string): string[] {
  return [...template.matchAll(tokenMatcher())].map((match) => match[1] ?? '');
}

/** Un tramo de la plantilla: texto fijo de ella, o el valor de una variable. */
export interface TemplateSegment {
  kind: 'FIXED' | 'VARIABLE';
  text: string;
}

/**
 * Parte la plantilla en tramos fijos y variables, en orden de locución.
 *
 * Es la base de la caché por segmentos: el proveedor cobra por carácter, y en
 * una plantilla dinámica casi todos los caracteres son FIJOS — se pagan una vez
 * y se vuelven a pagar entera cada vez que cambia un nombre. Partida, cada
 * tramo se cachea por su cuenta y una frase nueva sólo paga sus variables.
 *
 * La puntuación suelta se pliega sobre el tramo vecino en vez de sintetizarse
 * sola: pedirle a una voz que diga «,» gasta una llamada en nada, y «Pablo,»
 * entona mejor que «Pablo» + «,» pegados después.
 */
export function splitTemplate(
  template: string,
  variables: Record<string, string> = {},
): TemplateSegment[] {
  const crudos: TemplateSegment[] = [];
  let cursor = 0;
  for (const match of template.matchAll(tokenMatcher())) {
    const fijo = normalizeText(template.slice(cursor, match.index));
    if (fijo) crudos.push({ kind: 'FIXED', text: fijo });
    const clave = match[1] ?? '';
    const valor = normalizeText(variables[clave] ?? '');
    if (!SAFE_DYNAMIC_VALUE.test(valor)) {
      throw new AudioDomainError(`Variable inválida: ${clave}`, 'AUDIO_TEMPLATE_VARIABLE_INVALID');
    }
    crudos.push({ kind: 'VARIABLE', text: valor });
    cursor = (match.index ?? 0) + match[0].length;
  }
  const cola = normalizeText(template.slice(cursor));
  if (cola) crudos.push({ kind: 'FIXED', text: cola });

  const hablable = (texto: string): boolean => /[\p{L}\p{N}]/u.test(texto);
  const plegados: TemplateSegment[] = [];
  for (const tramo of crudos) {
    const previo = plegados[plegados.length - 1];
    if (previo && !hablable(tramo.text)) {
      previo.text = normalizeText(`${previo.text}${tramo.text}`);
      continue;
    }
    if (previo && !hablable(previo.text)) {
      plegados[plegados.length - 1] = {
        kind: tramo.kind,
        text: normalizeText(`${previo.text}${tramo.text}`),
      };
      continue;
    }
    plegados.push({ ...tramo });
  }
  return plegados;
}

export function renderTemplate(
  template: string,
  variables: Record<string, string> = {},
  maxLength = 5000,
): string {
  const required = templateTokens(template);
  if (required.length > MAX_VARIABLES) {
    throw new AudioDomainError(
      `La plantilla declara más de ${MAX_VARIABLES} variables`,
      'AUDIO_TEMPLATE_TOO_MANY_VARIABLES',
    );
  }

  // `Object.hasOwn` evita que claves heredadas del prototipo (toString, constructor)
  // pasen la comprobación y produzcan un TypeError al renderizar.
  const missing = required.filter((key) => !key || !Object.hasOwn(variables, key));
  if (missing.length > 0) {
    throw new AudioDomainError(
      `Faltan variables requeridas: ${[...new Set(missing)].join(', ')}`,
      'AUDIO_TEMPLATE_VARIABLE_MISSING',
    );
  }

  const rendered = template.replace(tokenMatcher(), (_match, rawKey: string) => {
    const value = normalizeText(variables[rawKey] ?? '');
    if (!SAFE_DYNAMIC_VALUE.test(value)) {
      throw new AudioDomainError(`Variable inválida: ${rawKey}`, 'AUDIO_TEMPLATE_VARIABLE_INVALID');
    }
    return value;
  });

  const normalized = normalizeText(rendered);
  if (normalized.length > maxLength) {
    throw new AudioDomainError('Texto TTS demasiado largo', 'AUDIO_TEXT_TOO_LONG');
  }
  return normalized;
}
