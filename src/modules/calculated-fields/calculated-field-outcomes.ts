/**
 * Los desenlaces que un campo calculado puede tener, y cuáles DECLARA su contrato (§5.3).
 *
 * Puro y sin Nest, como el resto de las reglas del contrato: lo usan el ensayo de un
 * borrador y el de una versión ya guardada, y si cada uno los enumerara por su cuenta,
 * «tipos de salida» acabaría significando dos cosas distintas en dos pantallas.
 *
 * Un campo calculado no tiene ramas como un grafo: su final no es una decisión, sino
 * CÓMO termina el cálculo. Por eso la lista no se descubre recorriendo nada —como hace
 * `qa-lab/outcome-coverage.ts` con el árbol— sino leyendo el contrato de retorno.
 */
import { DomainException } from '../../common/errors/domain-exception';
import type { ExecutableCalculatedField } from './calculated-field-runtime';
import type { CalculatedFieldExecutionResult } from './calculated-field.types';

/** `ERROR:` lleva dentro el código concreto: no es lo mismo fallar por dato ausente que por rango. */
export type OutcomeCode = 'VALID' | 'NULL_BY_POLICY' | 'DEFAULTED' | `ERROR:${string}`;

export interface DeclaredOutcome {
  code: OutcomeCode;
  label: string;
  /** Qué parte del contrato lo declara. Sin esto la lista es un enigma. */
  reason: string;
  /**
   * El contrato lo declara pero el motor no puede producirlo nunca.
   *
   * Pasa de verdad: `RETURN_DEFAULT` sin valor por defecto sobre un retorno nulable
   * pasa la validación y en ejecución propaga el error, así que el desenlace que el
   * autor cree haber configurado no existe. Decirlo aquí es más barato que descubrirlo
   * en producción.
   */
  unreachable?: string;
}

const POLICY_FIELDS = ['divisionByZero', 'missingData', 'outOfRange'] as const;

const POLICY_LABELS: Readonly<Record<(typeof POLICY_FIELDS)[number], string>> = {
  divisionByZero: 'división entre cero',
  missingData: 'datos que faltan',
  outOfRange: 'resultado fuera de rango',
};

/** Los desenlaces que el contrato de esta versión declara, alcanzables o no. */
export function declaredOutcomes(field: ExecutableCalculatedField): DeclaredOutcome[] {
  const returns = field.contract.returns;
  const outcomes: DeclaredOutcome[] = [
    {
      code: 'VALID',
      label: 'Valor válido',
      reason: `el cálculo termina dentro del contrato y devuelve ${returns.dataType}`,
    },
  ];

  const nullReasons = POLICY_FIELDS.filter((name) => returns[name] === 'RETURN_NULL').map(
    (name) => POLICY_LABELS[name],
  );
  if (returns.nullable || nullReasons.length) {
    outcomes.push({
      code: 'NULL_BY_POLICY',
      label: 'Sin valor',
      reason: returns.nullable
        ? `el retorno admite null${returns.nullConditions.length ? `: ${returns.nullConditions.join('; ')}` : ''}`
        : `la política ante ${nullReasons.join(' y ')} devuelve null`,
      // `applyPolicy` sólo devuelve null si el retorno es nulable: una política
      // RETURN_NULL sobre un retorno no nulable no produce nada, propaga el error.
      unreachable: returns.nullable
        ? undefined
        : 'el retorno no admite null, así que esa política no puede aplicarse y el error se propaga',
    });
  }

  const defaultReasons = POLICY_FIELDS.filter((name) => returns[name] === 'RETURN_DEFAULT').map(
    (name) => POLICY_LABELS[name],
  );
  if (defaultReasons.length) {
    outcomes.push({
      code: 'DEFAULTED',
      label: 'Valor por defecto',
      reason: `la política ante ${defaultReasons.join(' y ')} devuelve el valor por defecto`,
      unreachable:
        field.defaultValue === undefined
          ? 'no hay ningún valor por defecto declarado, así que el error se propaga'
          : undefined,
    });
  }

  const failReasons = POLICY_FIELDS.filter((name) => returns[name] === 'FAIL').map(
    (name) => POLICY_LABELS[name],
  );
  if (failReasons.length) {
    const code = returns.errorCode || 'CALCULATED_FIELD_RETURN_INVALID';
    outcomes.push({
      code: `ERROR:${code}`,
      label: `Falla con ${code}`,
      reason: `la política ante ${failReasons.join(', ')} es fallar`,
    });
  }

  return outcomes;
}

/** El desenlace de una ejecución que terminó. */
export function classifyExecution(result: CalculatedFieldExecutionResult): OutcomeCode {
  return result.outcome;
}

/**
 * El desenlace de una ejecución que reventó.
 *
 * Un fallo de infraestructura NO es un desenlace del contrato, y se etiqueta con su
 * propio código para que no pase por «el campo rechazó el dato»: una cobertura que
 * cuente el sandbox caído como rama probada miente.
 */
export function classifyFailure(error: unknown): OutcomeCode {
  if (error instanceof DomainException) return `ERROR:${error.code}`;
  return 'ERROR:UNEXPECTED_ERROR';
}

/** Mensaje legible del fallo, sin filtrar trazas al portal. */
export function failureMessage(error: unknown): string {
  if (error instanceof DomainException) return error.message;
  return 'Error inesperado durante la ejecución de prueba';
}
