import { collapseWhitespace } from '../text-normalization';
import { NOMBRES_DE_DEPARTAMENTO } from '../../catalog/bolivia-ci.catalog';
import { BIRTH_ANCHOR, PLACE_ANCHOR } from './ci-anchors';
import { sinColaDeRuido } from './ci-noise-cleaning';
import type { Extraction, SourceLine } from './ci-source-lines';

export function lugarAnclado(lines: SourceLine[]): Extraction | null {
  for (const [index, line] of lines.entries()) {
    const match = PLACE_ANCHOR.exec(line.normalized);
    const captured = match?.[1];
    if (!captured) continue;
    // La línea del lugar va junto a la del nacimiento y viene separada por
    // guiones (`departamento - provincia - localidad`); esto deja fuera
    // cualquier otro texto que empiece por `EN …`.
    const neighbouring = lines
      .slice(Math.max(0, index - 2), index + 3)
      .some((near) => BIRTH_ANCHOR.test(near.normalized));
    if (!captured.includes('-') && !neighbouring) continue;
    const original = lines[index]?.text ?? '';
    const value = collapseWhitespace(original.replace(/^\s*[Ee][Nn]\s+/, ''));
    return { value: sinColaDeRuido(value), confidence: line.confidence };
  }
  return null;
}

/**
 * El lugar de nacimiento por su VALOR, cuando su rótulo no se dejó leer.
 *
 * `LUGAR DE NACIMIENTO` es el rótulo más pequeño del reverso y el que peor
 * sobrevive: medido sobre una cédula real, a ninguna de las cuatro
 * resoluciones apareció ni entero ni mutilado. Lo que sí aparece limpio, y a
 * buen cuerpo, es el valor —`SANTA CRUZ - ANDRES IBAÑEZ - SANTA CRUZ DE LA
 * SIERRA`—, porque nombra un departamento de Bolivia y viene con la estructura
 * `departamento - provincia - localidad` que no tiene ningún otro renglón de
 * la tarjeta.
 *
 * Se exige el guion además del departamento. Sin él, `SANTA CRUZ` suelto lo
 * lleva también el domicilio, y el lugar de nacimiento acabaría siendo una
 * dirección — un dato equivocado en el sitio de uno correcto, que es peor que
 * dejarlo vacío.
 *
 * Y se recorta por delante hasta el departamento: el reconocedor deja restos
 * del código QR y del sello a la izquierda del renglón (`OF AO!`, `[RO]`), y
 * arrastrarlos al expediente sería guardar ruido con forma de dato.
 */
export function lugarPorDepartamento(lines: SourceLine[]): Extraction | null {
  for (const line of lines) {
    if (!line.normalized.includes('-')) continue;
    const departamento = NOMBRES_DE_DEPARTAMENTO.map((nombre) => ({
      nombre,
      posicion: line.normalized.indexOf(nombre),
    })).find(({ posicion }) => posicion >= 0);
    if (!departamento) continue;
    // Y por detrás se quitan los signos que el reconocedor cuelga del final
    // del renglón (`SANTA”`, `SANTA pr`): son del borde de la tarjeta, no del
    // lugar de nacimiento.
    const valor = collapseWhitespace(line.text.slice(departamento.posicion)).replace(
      /[^\p{L}\p{N}]+$/u,
      '',
    );
    if (valor.length < 6) continue;
    return { value: sinColaDeRuido(valor), confidence: line.confidence };
  }
  return null;
}
