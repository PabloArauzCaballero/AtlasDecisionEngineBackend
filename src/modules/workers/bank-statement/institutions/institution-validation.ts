import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException } from '../../../../common/errors/domain-exception';
import { isPotentiallyCatastrophic } from '../../../../common/validation/safe-regex';
import { parseSignalDescriptor } from '../core/engine/similarity/institution-signals';

/**
 * Tope de un patrón. No hay ninguna marca de banco que necesite más: los
 * marcadores medidos sobre extractos reales van de 8 a 60 caracteres, y lo que
 * pasa de aquí es casi siempre un párrafo pegado por error.
 */
const MAX_PATTERN_LENGTH = 200;

/**
 * Comprueba que cada patrón compile y que ninguno pueda colgar al motor.
 *
 * La comprobación anti-ReDoS no es una formalidad aquí: estos patrones se
 * ejecutan contra la carátula de **cada documento que entra**, así que uno
 * catastrófico no degrada una pantalla —para el worker entero.
 */
export function validatePatterns(patterns: readonly string[], field: string): string[] {
  const cleaned: string[] = [];
  for (const raw of patterns) {
    const source = raw.trim();
    if (!source) continue;
    if (source.length > MAX_PATTERN_LENGTH) {
      throw badPattern(field, source, `supera los ${MAX_PATTERN_LENGTH} caracteres`);
    }
    if (isPotentiallyCatastrophic(source)) {
      throw badPattern(
        field,
        source,
        'puede degenerar en retroceso catastrófico y se evalúa contra cada documento que entra',
      );
    }
    try {
      new RegExp(source, 'i');
    } catch (error) {
      throw badPattern(field, source, error instanceof Error ? error.message : 'no compila');
    }
    cleaned.push(source);
  }
  if (field === 'markers' && cleaned.length === 0) {
    throw new DomainException(
      'INSTITUTION_WITHOUT_MARKERS',
      'Una entidad sin marcadores no puede atribuir ningún documento.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return cleaned;
}

function badPattern(field: string, source: string, reason: string): DomainException {
  return new DomainException(
    'INSTITUTION_INVALID_PATTERN',
    `El patrón de ${field} «${source}» ${reason}.`,
    HttpStatus.BAD_REQUEST,
    { field, pattern: source },
  );
}

/**
 * Comprueba el descriptor antes de escribirlo, y explica el fallo.
 *
 * Se rechaza la fila entera y no se guarda «lo que se pueda»: un descriptor a
 * medias mide un parecido que nadie declaró, y el resultado —un porcentaje—
 * no delata que le faltaban señales.
 */
export function validateDescriptor(
  raw: Record<string, unknown> | undefined,
  code: string,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (raw === undefined) return Prisma.DbNull;
  try {
    parseSignalDescriptor(raw);
  } catch (error) {
    throw new DomainException(
      'INVALID_SIGNAL_DESCRIPTOR',
      error instanceof Error ? error.message : 'El descriptor de señales no es válido.',
      HttpStatus.BAD_REQUEST,
      { code },
    );
  }
  return raw as Prisma.InputJsonValue;
}
