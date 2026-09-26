/**
 * Las reglas de gobierno del riesgo: rango de las salidas económicas, límites de cartera y
 * vigencia del consentimiento.
 *
 * Cada bloque fija una forma concreta de que un número correcto signifique algo falso.
 */
import { OutputSemanticRole, ProcessingLegalBasis } from '@prisma/client';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { DecisionGuardService } from '../src/modules/risk-governance/decision-guard.service';
import {
  evaluateEnablingBasis,
  parseDeclaredPolicy,
  parseUndeclaredBasisMode,
  resolveEnablingBasisPolicy,
  type EnablingBasisPolicy,
} from '../src/modules/risk-governance/enabling-basis';
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

describe('resolveEnablingBasisPolicy · qué base exige cada decisión (P-09)', () => {
  const base = {
    declared: null,
    legalBasis: null,
    riskDomain: 'CREDIT_ORIGINATION',
    isProductionEnvironment: true,
    undeclaredMode: 'REVIEW' as const,
  };

  it('originación en producción sin declarar nada: exige credit_underwriting y va a revisión', () => {
    // Antes: nada que comprobar, y la ausencia de base pasaba por permiso.
    expect(resolveEnablingBasisPolicy(base)).toEqual({
      source: 'ORIGINATION_DEFAULT',
      onMissing: 'REVIEW',
      requirements: [
        {
          purpose: 'credit_underwriting',
          acceptedBases: ['CREDIT_PROTECTION', 'CONTRACT', 'CONSENT'],
          acceptedVersions: [],
        },
      ],
    });
  });

  it('consentimiento como ÚNICA base cuando el artefacto declara CONSENT', () => {
    const policy = resolveEnablingBasisPolicy({ ...base, legalBasis: 'CONSENT' });
    expect(policy.source).toBe('DERIVED_FROM_LEGAL_BASIS');
    expect(policy.requirements[0].acceptedBases).toEqual([ProcessingLegalBasis.CONSENT]);
  });

  it('no impone consentimiento cuando el artefacto declara otra base', () => {
    const policy = resolveEnablingBasisPolicy({ ...base, legalBasis: 'CREDIT_PROTECTION' });
    expect(policy.requirements[0].acceptedBases).toEqual(['CREDIT_PROTECTION', 'CONSENT']);
  });

  it('lo declarado en la versión manda sobre lo derivado', () => {
    const policy = resolveEnablingBasisPolicy({
      ...base,
      legalBasis: 'CONSENT',
      declared: {
        onMissing: 'BLOCK',
        requirements: [
          { purpose: 'BUREAU_QUERY', acceptedBases: ['CONSENT'], acceptedVersions: ['v3'] },
        ],
      },
    });
    expect(policy).toMatchObject({
      source: 'DECLARED',
      onMissing: 'BLOCK',
      requirements: [{ purpose: 'BUREAU_QUERY', acceptedVersions: ['v3'] }],
    });
  });

  it('un sandbox sin declaración no exige nada; ALLOW_LEGACY vuelve atrás de forma explícita', () => {
    expect(resolveEnablingBasisPolicy({ ...base, isProductionEnvironment: false }).source).toBe(
      'NONE',
    );
    expect(resolveEnablingBasisPolicy({ ...base, undeclaredMode: 'ALLOW_LEGACY' }).source).toBe(
      'NONE',
    );
  });

  it('un valor de configuración desconocido cae en REVIEW: falla cerrado', () => {
    expect(parseUndeclaredBasisMode('lo-que-sea')).toBe('REVIEW');
    expect(parseUndeclaredBasisMode(undefined)).toBe('REVIEW');
    expect(parseUndeclaredBasisMode('block')).toBe('BLOCK');
  });

  it('una política declarada ilegible o una exención sin motivo se rechazan', () => {
    expect(() => parseDeclaredPolicy({ requirements: [] })).toThrow(/justification/);
    expect(() =>
      parseDeclaredPolicy({ requirements: [{ purpose: 'x', acceptedBases: ['INVENTADA'] }] }),
    ).toThrow(/base jurídica/);
    expect(() => parseDeclaredPolicy('REVIEW')).toThrow();
    expect(
      parseDeclaredPolicy({ requirements: [], justification: 'Regla interna de enrutado' })
        .requirements,
    ).toEqual([]);
  });
});

describe('evaluateEnablingBasis · motivos distinguibles (P-09)', () => {
  const AHORA = new Date('2026-09-24T00:00:00.000Z');
  const policy: EnablingBasisPolicy = {
    source: 'DECLARED',
    onMissing: 'REVIEW',
    requirements: [
      {
        purpose: 'credit_underwriting',
        acceptedBases: [ProcessingLegalBasis.CREDIT_PROTECTION, ProcessingLegalBasis.CONSENT],
        acceptedVersions: [],
      },
    ],
  };
  const record = {
    purpose: 'credit_underwriting',
    basis: ProcessingLegalBasis.CREDIT_PROTECTION,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
    revokedAt: null,
  };
  const reasonOf = (records: Parameters<typeof evaluateEnablingBasis>[2], p = policy) =>
    evaluateEnablingBasis(p, true, records, AHORA).failures.map((failure) => failure.reason);

  it('vigente: satisfecha', () => {
    expect(evaluateEnablingBasis(policy, true, [record], AHORA)).toEqual({
      satisfied: true,
      failures: [],
    });
  });

  it('sin referencia de sujeto no se puede satisfacer', () => {
    expect(evaluateEnablingBasis(policy, false, [], AHORA).failures).toEqual([
      { purpose: 'credit_underwriting', reason: 'SUBJECT_REFERENCE_MISSING' },
    ]);
  });

  it('ausente, finalidad no cubierta, expirada, revocada y base no aceptada se distinguen', () => {
    expect(reasonOf([])).toEqual(['NO_BASIS_RECORDED']);
    expect(reasonOf([{ ...record, purpose: 'BUREAU_QUERY' }])).toEqual(['PURPOSE_NOT_COVERED']);
    expect(reasonOf([{ ...record, expiresAt: new Date('2026-09-01T00:00:00.000Z') }])).toEqual([
      'EXPIRED',
    ]);
    expect(reasonOf([{ ...record, revokedAt: new Date('2026-09-01T00:00:00.000Z') }])).toEqual([
      'REVOKED',
    ]);
    expect(reasonOf([{ ...record, basis: ProcessingLegalBasis.LEGITIMATE_INTEREST }])).toEqual([
      'BASIS_NOT_ACCEPTED',
    ]);
    expect(reasonOf([{ ...record, grantedAt: new Date('2026-10-01T00:00:00.000Z') }])).toEqual([
      'NOT_YET_GRANTED',
    ]);
  });

  it('la versión del texto se exige cuando la política la declara', () => {
    const versioned: EnablingBasisPolicy = {
      ...policy,
      requirements: [{ ...policy.requirements[0], acceptedVersions: ['v3'] }],
    };
    expect(reasonOf([{ ...record, consentVersion: 'v2' }], versioned)).toEqual([
      'VERSION_NOT_ACCEPTED',
    ]);
    expect(reasonOf([{ ...record, consentVersion: 'v3' }], versioned)).toEqual([]);
  });

  it('sin requisitos no hay nada que comprobar', () => {
    expect(evaluateEnablingBasis({ ...policy, requirements: [] }, false, [], AHORA).satisfied).toBe(
      true,
    );
  });
});

describe('DecisionGuardService · el primer solicitante ya no elude los controles (P-09/P-11)', () => {
  const AHORA = new Date('2026-09-24T00:00:00.000Z');
  const NONE: EnablingBasisPolicy = { source: 'NONE', onMissing: 'REVIEW', requirements: [] };

  function guard(limits: Array<{ maxValue: number; enforced: boolean }>, exposure = 0) {
    const prisma = {
      exposureLimit: {
        findMany: () =>
          Promise.resolve(
            limits.map((limit) => ({
              limitCode: 'SUBJECT_TOTAL',
              segment: '',
              currencyCode: 'BOB',
              ...limit,
            })),
          ),
      },
      subjectConsent: { findMany: () => Promise.resolve([]) },
      $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ $queryRaw: () => Promise.resolve([{ total: exposure }]) }),
    } as unknown as PrismaService;
    return new DecisionGuardService(prisma);
  }

  it('sin sujeto materializado lo pedido se compara igual con el límite', async () => {
    // Antes `assertCanDecide(tenant, null, …)` volvía sin mirar el límite.
    await expect(
      guard([{ maxValue: 1_000, enforced: true }]).checkBeforeDecision({
        tenantId: 1n,
        subjectId: null,
        subjectReferencePresent: true,
        requestedAmount: 2_000,
        basisPolicy: NONE,
        now: AHORA,
      }),
    ).rejects.toMatchObject({ code: 'EXPOSURE_LIMIT_EXCEEDED' });
  });

  it('publica el límite restante antes y después de la decisión', async () => {
    const verdict = await guard([{ maxValue: 1_000, enforced: true }], 900).checkBeforeDecision({
      tenantId: 1n,
      subjectId: 7n,
      subjectReferencePresent: true,
      requestedAmount: 80,
      basisPolicy: NONE,
      now: AHORA,
    });
    expect(verdict.exposure).toEqual({
      limitCode: 'SUBJECT_TOTAL',
      currencyCode: 'BOB',
      maxValue: 1_000,
      enforced: true,
      currentExposure: 900,
      requestedAmount: 80,
      remainingBeforeDecision: 100,
      remainingAfterDecision: 20,
    });
  });

  it('con política BLOCK una base ausente rechaza con motivo por finalidad', async () => {
    await expect(
      guard([]).checkBeforeDecision({
        tenantId: 1n,
        subjectId: null,
        subjectReferencePresent: true,
        requestedAmount: 0,
        basisPolicy: {
          source: 'DECLARED',
          onMissing: 'BLOCK',
          requirements: [
            {
              purpose: 'credit_underwriting',
              acceptedBases: [ProcessingLegalBasis.CONSENT],
              acceptedVersions: [],
            },
          ],
        },
        now: AHORA,
      }),
    ).rejects.toMatchObject({
      code: 'ENABLING_BASIS_INVALID',
      details: {
        failures: [{ purpose: 'credit_underwriting', reason: 'NO_BASIS_RECORDED' }],
      },
    });
  });
});
