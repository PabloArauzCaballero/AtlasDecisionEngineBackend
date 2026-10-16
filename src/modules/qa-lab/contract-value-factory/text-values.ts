import type { VariableConstraints } from '../../../common/contracts/constraints.types';
import { type DataType } from '../../../common/contracts/data-types';
import { sampleForPattern } from '../pattern-samples';
import type { SeededRandom } from '../seeded-random';
import { DEFAULT_MAX_LENGTH, DEFAULT_MIN_LENGTH } from './valid-value';

/** Dominio reservado para pruebas (RFC 2606): ningún correo generado sale a internet. */
const TEST_EMAIL_DOMAIN = 'qa.atlas.test';

const FORMAT_ALPHABETS: Readonly<Record<string, readonly string[]>> = {
  ISO_COUNTRY: ['BO', 'PE', 'CL', 'AR', 'MX', 'CO', 'EC', 'UY'],
  ISO_CURRENCY: ['BOB', 'USD', 'PEN', 'CLP', 'ARS', 'MXN', 'COP'],
};

export function textValue(
  type: DataType,
  constraints: VariableConstraints,
  random: SeededRandom,
): string {
  const [lower, upper] = lengthBounds(type, constraints);
  const fits = (candidate: string) => candidate.length >= lower && candidate.length <= upper;

  if (constraints.format) {
    const formatted = formatSample(constraints.format, random, upper);
    // El formato manda sobre la longitud: un correo recortado deja de ser un correo, y el
    // contrato contradictorio se denuncia con `satisfied: false` en vez de disimularse.
    if (formatted !== null) return formatted;
  }
  if (constraints.pattern) {
    const fromPattern = sampleForPattern(constraints.pattern, random, fits);
    if (fromPattern !== null) return fromPattern;
  }
  return random.string(random.int(lower, upper), alphabetFor(type));
}

/**
 * Longitudes admitidas, ya reconciliadas.
 *
 * El cálculo anterior partía de un mínimo por defecto de 3 y lo dejaba ganar sobre
 * `maxLength`: un contrato con `maxLength: 2` recibía tres caracteres. Aquí el máximo
 * declarado acota siempre al mínimo por defecto, y solo un `minLength` explícito puede
 * superarlo (contrato contradictorio, que sale por `satisfied: false`).
 */
function lengthBounds(type: DataType, constraints: VariableConstraints): [number, number] {
  const preferred = type === 'IDENTIFIER' ? 8 : DEFAULT_MIN_LENGTH;
  const ceiling = constraints.maxLength ?? DEFAULT_MAX_LENGTH;
  const lower =
    constraints.minLength !== undefined
      ? Math.max(0, constraints.minLength)
      : Math.max(0, Math.min(preferred, ceiling));
  const upper = Math.max(
    lower,
    Math.min(constraints.maxLength ?? Math.max(lower + 5, 12), DEFAULT_MAX_LENGTH),
  );
  return [lower, upper];
}

export function alphabetFor(type: DataType): string {
  if (type === 'IDENTIFIER') return 'ABCDEF0123456789';
  if (type === 'CODE' || type === 'ENUM') return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_';
  return 'abcdefghijklmnopqrstuvwxyz0123456789';
}

/**
 * Valor que satisface un formato semántico. `null` para un formato desconocido, de modo
 * que el patrón o el texto genérico tomen el relevo en vez de inventar una forma.
 */
function formatSample(format: string, random: SeededRandom, maxLength: number): string | null {
  const enumerated = FORMAT_ALPHABETS[format];
  if (enumerated) return random.pick(enumerated);

  switch (format) {
    case 'EMAIL': {
      // Dominio `.test`: no existe en internet, así que ningún correo de prueba llega a una
      // persona real. Es el mismo que usan por defecto los fakers del servidor mock.
      // Se encoge la parte local para caber en `maxLength` siempre que quepa un correo.
      const local = Math.max(1, Math.min(8, maxLength - `@${TEST_EMAIL_DOMAIN}`.length));
      return `${random.string(local, 'abcdefghijklmnopqrstuvwxyz')}@${TEST_EMAIL_DOMAIN}`;
    }
    case 'UUID': {
      const hex = (length: number) => random.string(length, '0123456789abcdef');
      return `${hex(8)}-${hex(4)}-4${hex(3)}-${random.pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`;
    }
    case 'URL':
      return `https://ejemplo.test/${random.string(Math.max(1, Math.min(8, maxLength - 21)))}`;
    case 'PHONE':
      // Un celular boliviano: 8 dígitos que empiezan por 6 o 7. Antes eran 8 dígitos
      // cualesquiera, y un «+59103…» no lo reconoce ninguna validación de operador.
      return `+591${random.pick(['6', '7'])}${random.string(7, '0123456789')}`;
    case 'IBAN':
      return `${random.pick(['BO', 'ES', 'DE'])}${random.string(2, '0123456789')}${random.string(
        16,
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      )}`;
    default:
      return null;
  }
}

/* --------------------------------------------------------------------- listas */
