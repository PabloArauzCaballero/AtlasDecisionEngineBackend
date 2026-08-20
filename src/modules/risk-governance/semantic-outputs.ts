/**
 * Qué puede valer una salida según lo que dice significar.
 *
 * `approved_credit_limit = ingreso * 0,35` es una regla, no una decisión. La decisión de
 * microcrédito es cuánto, a qué plazo y a qué precio, y esas tres se derivan de una probabilidad.
 * Para poder derivarlas hay que saber cuál de las salidas ES la probabilidad — y eso, hasta esta
 * ola, sólo lo sabía quien había escrito el artefacto.
 *
 * Declararlo tiene tres efectos que una convención de nombre no da:
 *
 *  1. el motor valida el RANGO, y una PD de 4,2 deja de compilar en vez de multiplicarse por un
 *     importe y salir como pérdida esperada;
 *  2. la calibración sabe qué columna mirar sin que nadie se la señale;
 *  3. la pantalla puede pintarla como probabilidad, como importe o como grado.
 */
import { OutputSemanticRole } from '@prisma/client';

interface RoleSpec {
  /** Cota inferior admisible, inclusive. */
  min?: number;
  /** Cota superior admisible, inclusive. */
  max?: number;
  /** Si el valor tiene que ser numérico. `RISK_GRADE` es el único que no. */
  numeric: boolean;
  label: string;
}

export const ROLE_SPECS: Readonly<Record<OutputSemanticRole, RoleSpec>> = {
  NONE: { numeric: false, label: 'Sin rol declarado' },
  PROBABILITY_OF_DEFAULT: {
    numeric: true,
    min: 0,
    max: 1,
    label: 'Probabilidad de incumplimiento',
  },
  LOSS_GIVEN_DEFAULT: { numeric: true, min: 0, max: 1, label: 'Pérdida dado el incumplimiento' },
  EXPOSURE_AT_DEFAULT: { numeric: true, min: 0, label: 'Exposición al incumplir' },
  EXPECTED_LOSS: { numeric: true, min: 0, label: 'Pérdida esperada' },
  RISK_GRADE: { numeric: false, label: 'Grado de riesgo' },
  // Una tasa se expresa en tanto por uno, no en porcentaje. El techo de 10 (1000 % anual) no es
  // una opinión sobre usura: es la cota que distingue «0,28» de «28» mal escrito, que es el error
  // real y el que multiplicaría por cien el precio de una cartera.
  PRICED_RATE: { numeric: true, min: 0, max: 10, label: 'Tasa ofrecida' },
  APPROVED_LIMIT: { numeric: true, min: 0, label: 'Límite aprobado' },
  APPROVED_TERM: { numeric: true, min: 1, max: 600, label: 'Plazo aprobado (meses)' },
};

export interface RoleViolation {
  fieldCode: string;
  role: OutputSemanticRole;
  code: string;
  message: string;
}

/**
 * Comprueba un valor producido contra el rango de su rol.
 *
 * Se comprueba en EJECUCIÓN y no sólo al compilar porque el valor lo produce un script en tiempo
 * de ejecución: al compilar sólo existe la promesa. Una PD de 4,2 que llega a la salida es un
 * defecto del artefacto, y publicarla como si fuera una probabilidad hace que todo lo que se
 * calcule encima —pérdida esperada, precio— sea basura con aspecto de número.
 */
export function validateSemanticOutput(
  fieldCode: string,
  role: OutputSemanticRole,
  value: unknown,
): RoleViolation | null {
  const spec = ROLE_SPECS[role];
  if (!spec || role === OutputSemanticRole.NONE) return null;
  // Una salida ausente es asunto del contrato de salida (`absenceReasons`), no de este control:
  // aquí sólo se juzga lo que SÍ se produjo.
  if (value === null || value === undefined) return null;

  if (!spec.numeric) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return {
      fieldCode,
      role,
      code: 'SEMANTIC_OUTPUT_NOT_NUMERIC',
      message: `«${spec.label}» tiene que ser un número y llegó «${String(value)}».`,
    };
  }
  if (spec.min !== undefined && numeric < spec.min) {
    return {
      fieldCode,
      role,
      code: 'SEMANTIC_OUTPUT_BELOW_RANGE',
      message: `«${spec.label}» no puede ser menor que ${spec.min}; llegó ${numeric}.`,
    };
  }
  if (spec.max !== undefined && numeric > spec.max) {
    return {
      fieldCode,
      role,
      code: 'SEMANTIC_OUTPUT_ABOVE_RANGE',
      message: `«${spec.label}» no puede ser mayor que ${spec.max}; llegó ${numeric}.`,
    };
  }
  return null;
}

/**
 * Reglas de coherencia del contrato ECONÓMICO de un artefacto de originación.
 *
 * Es el gate del plan: un artefacto que origina crédito y no dice cuál es su probabilidad de
 * incumplimiento no se puede vigilar ni calibrar, y su pérdida esperada —si la publica— no se
 * puede comprobar contra nada.
 *
 * Devuelve avisos y no excepciones a propósito: quien decide si esto bloquea la publicación es el
 * circuito de gobierno, no una función pura. Y `EXPECTED_LOSS` sin PD ni LGD se señala aparte
 * porque es el caso peligroso de verdad: un número con nombre de dinero que nadie puede auditar.
 */
export function reviewEconomicContract(
  fields: Array<{ fieldCode: string; semanticRole: OutputSemanticRole }>,
  isOrigination: boolean,
): string[] {
  const roles = new Set(fields.map((field) => field.semanticRole));
  const problems: string[] = [];

  if (isOrigination && !roles.has(OutputSemanticRole.PROBABILITY_OF_DEFAULT)) {
    problems.push(
      'ECONOMIC_CONTRACT_NO_PD: un artefacto de originación que no declara probabilidad de ' +
        'incumplimiento no se puede calibrar, así que nadie podrá saber nunca si acierta.',
    );
  }
  if (
    roles.has(OutputSemanticRole.EXPECTED_LOSS) &&
    !(
      roles.has(OutputSemanticRole.PROBABILITY_OF_DEFAULT) &&
      roles.has(OutputSemanticRole.LOSS_GIVEN_DEFAULT)
    )
  ) {
    problems.push(
      'ECONOMIC_CONTRACT_EL_WITHOUT_COMPONENTS: publica pérdida esperada sin declarar PD y LGD. ' +
        'Es un número con nombre de dinero que nadie puede comprobar ni descomponer.',
    );
  }
  if (
    roles.has(OutputSemanticRole.PRICED_RATE) &&
    !roles.has(OutputSemanticRole.PROBABILITY_OF_DEFAULT)
  ) {
    problems.push(
      'ECONOMIC_CONTRACT_PRICE_WITHOUT_PD: pone precio sin declarar el riesgo con el que lo ' +
        'calcula. El precio deja de ser auditable y la calibración no puede alcanzarlo.',
    );
  }
  return problems;
}
