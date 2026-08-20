/**
 * Las reglas de gobierno del riesgo: rango de las salidas económicas, límites de cartera y
 * vigencia del consentimiento.
 *
 * Cada bloque fija una forma concreta de que un número correcto signifique algo falso.
 */
import { OutputSemanticRole } from '@prisma/client';
import {
  canApproveReidentification,
  checkConsent,
  checkLimit,
} from '../src/modules/risk-governance/exposure-rules';
import {
  reviewEconomicContract,
  validateSemanticOutput,
} from '../src/modules/risk-governance/semantic-outputs';

describe('validateSemanticOutput', () => {
  it('acepta una probabilidad dentro de [0,1]', () => {
    expect(
      validateSemanticOutput('pd', OutputSemanticRole.PROBABILITY_OF_DEFAULT, 0.042),
    ).toBeNull();
  });

  it('rechaza una probabilidad fuera de rango', () => {
    // Es el caso que motiva todo el rol semántico: una PD de 4,2 multiplicada por un importe
    // sale como «pérdida esperada» sin que nada chirríe.
    const violation = validateSemanticOutput('pd', OutputSemanticRole.PROBABILITY_OF_DEFAULT, 4.2);
    expect(violation).toMatchObject({ code: 'SEMANTIC_OUTPUT_ABOVE_RANGE', fieldCode: 'pd' });
  });

  it('caza la tasa escrita en porcentaje en vez de en tanto por uno', () => {
    // `28` en vez de `0,28` multiplica por cien el precio de una cartera. El techo de 10 no es
    // una opinión sobre usura: es lo que distingue el error de tecleo.
    expect(validateSemanticOutput('rate', OutputSemanticRole.PRICED_RATE, 28)).toMatchObject({
      code: 'SEMANTIC_OUTPUT_ABOVE_RANGE',
    });
    expect(validateSemanticOutput('rate', OutputSemanticRole.PRICED_RATE, 0.28)).toBeNull();
  });

  it('una salida ausente no es un problema de este control', () => {
    // De la ausencia se ocupa el contrato de salida (`absenceReasons`); aquí sólo se juzga lo
    // que sí se produjo.
    expect(
      validateSemanticOutput('pd', OutputSemanticRole.PROBABILITY_OF_DEFAULT, null),
    ).toBeNull();
  });

  it('un grado de riesgo no se valida como número', () => {
    expect(validateSemanticOutput('grade', OutputSemanticRole.RISK_GRADE, 'B2')).toBeNull();
  });
});

describe('reviewEconomicContract', () => {
  it('exige PD a un artefacto de originación', () => {
    expect(
      reviewEconomicContract(
        [{ fieldCode: 'limit', semanticRole: OutputSemanticRole.APPROVED_LIMIT }],
        true,
      ),
    ).toEqual([expect.stringContaining('ECONOMIC_CONTRACT_NO_PD')]);
  });

  it('no se la exige a una decisión que no origina', () => {
    expect(
      reviewEconomicContract([{ fieldCode: 'x', semanticRole: OutputSemanticRole.NONE }], false),
    ).toEqual([]);
  });

  it('señala una pérdida esperada sin sus componentes', () => {
    const problems = reviewEconomicContract(
      [
        { fieldCode: 'pd', semanticRole: OutputSemanticRole.PROBABILITY_OF_DEFAULT },
        { fieldCode: 'el', semanticRole: OutputSemanticRole.EXPECTED_LOSS },
      ],
      true,
    );
    expect(problems).toEqual([expect.stringContaining('ECONOMIC_CONTRACT_EL_WITHOUT_COMPONENTS')]);
  });

  it('señala un precio puesto sin declarar el riesgo con el que se calcula', () => {
    const problems = reviewEconomicContract(
      [{ fieldCode: 'rate', semanticRole: OutputSemanticRole.PRICED_RATE }],
      false,
    );
    expect(problems).toEqual([expect.stringContaining('ECONOMIC_CONTRACT_PRICE_WITHOUT_PD')]);
  });
});

describe('checkLimit', () => {
  // Cadena vacía = toda la cartera. Centinela explícito: `segment = NULL` no casa nunca en SQL.
  const base = { limitCode: 'SUBJECT_TOTAL', segment: '', maxValue: 10_000, enforced: true };

  it('compara el valor PROYECTADO, no el actual', () => {
    /*
     * Comparar el actual deja pasar siempre la operación que rompe el límite —el saldo estaba
     * por debajo justo antes de concederla—, que es lo que convierte un límite de concentración
     * en decorativo.
     */
    const verdict = checkLimit({ ...base, currentValue: 9_500, requestedValue: 1_000 });
    expect(verdict).toMatchObject({ projectedValue: 10_500, exceeded: true, blocking: true });
  });

  it('sin `enforced` mide y avisa pero no bloquea', () => {
    // Es la forma de estrenar un límite sin parar la originación el primer día.
    const verdict = checkLimit({
      ...base,
      enforced: false,
      currentValue: 9_500,
      requestedValue: 1_000,
    });
    expect(verdict).toMatchObject({ exceeded: true, blocking: false });
  });

  it('publica la utilización para poder avisar antes de topar', () => {
    expect(checkLimit({ ...base, currentValue: 7_000, requestedValue: 1_000 }).utilization).toBe(
      0.8,
    );
  });
});

describe('checkConsent', () => {
  const AHORA = new Date('2026-08-12T00:00:00.000Z');
  const consent = {
    purpose: 'BANK_STATEMENT_ANALYSIS',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    revokedAt: null,
  };

  it('vigente', () => {
    expect(checkConsent(consent, consent.purpose, AHORA)).toMatchObject({
      valid: true,
      reason: 'VALID',
    });
  });

  it('la ausencia de constancia no es una autorización', () => {
    expect(checkConsent(null, 'BUREAU_QUERY', AHORA)).toMatchObject({
      valid: false,
      reason: 'MISSING',
    });
  });

  it('distingue caducado de revocado', () => {
    /*
     * No es un matiz: quien atiende el caso necesita saber si lo renueva (caducó) o si no puede
     * volver a pedirlo igual (lo revocaron). Un `false` los vuelve el mismo problema.
     */
    const caducado = { ...consent, expiresAt: new Date('2026-06-01T00:00:00.000Z') };
    expect(checkConsent(caducado, consent.purpose, AHORA).reason).toBe('EXPIRED');

    const revocado = { ...consent, revokedAt: new Date('2026-07-01T00:00:00.000Z') };
    expect(checkConsent(revocado, consent.purpose, AHORA).reason).toBe('REVOKED');
  });

  it('sin caducidad declarada es válido y lo dice con daysRemaining nulo', () => {
    expect(checkConsent({ ...consent, expiresAt: null }, consent.purpose, AHORA)).toMatchObject({
      valid: true,
      daysRemaining: null,
    });
  });

  it('cuenta los días que quedan, para poder avisar antes', () => {
    const verdict = checkConsent(
      { ...consent, expiresAt: new Date('2026-08-22T00:00:00.000Z') },
      consent.purpose,
      AHORA,
    );
    expect(verdict.daysRemaining).toBe(10);
  });
});

describe('canApproveReidentification', () => {
  it('quien pide no puede aprobar', () => {
    // Sin esto, «dos autorizaciones» es la misma persona pulsando otro botón.
    expect(canApproveReidentification('ana@atlas', 'ana@atlas')).toBe(false);
    expect(canApproveReidentification(' Ana@Atlas ', 'ana@atlas')).toBe(false);
    expect(canApproveReidentification('ana@atlas', 'luis@atlas')).toBe(true);
  });
});
