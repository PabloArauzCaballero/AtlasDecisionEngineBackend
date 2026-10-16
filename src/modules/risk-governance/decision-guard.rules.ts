import { HttpStatus } from '@nestjs/common';
import { OutputSemanticRole } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { checkConsent, type LimitVerdict } from './exposure-rules';
import { validateSemanticOutput, type RoleViolation } from './semantic-outputs';
import { type BasisRecord } from './enabling-basis';

export function limitExceeded(verdict: LimitVerdict): DomainException {
  return new DomainException(
    'EXPOSURE_LIMIT_EXCEEDED',
    `La exposición proyectada (${verdict.projectedValue}) supera el límite ` +
      `${verdict.limitCode} de ${verdict.maxValue}. No es una negativa de riesgo sobre el ` +
      `solicitante: es apetito de cartera agotado, y así hay que explicárselo.`,
    HttpStatus.CONFLICT,
    {
      limitCode: verdict.limitCode,
      projectedValue: verdict.projectedValue,
      maxValue: verdict.maxValue,
    },
  );
}

/**
 * Ningún permiso REGISTRADO puede estar vencido o revocado, lo exija o no esta decisión.
 *
 * Es anterior a la política de base habilitante y se conserva tal cual: tratar datos de alguien
 * que revocó un permiso sigue siendo una infracción aunque esta decisión no lo necesite, y no
 * se relaja un control para introducir otro. La AUSENCIA ya no se trata aquí sino en
 * `evaluateEnablingBasis`, que sí sabe qué finalidades exige cada decisión.
 */
export function assertRegisteredBasesValid(records: BasisRecord[], now: Date): void {
  const invalid = records
    .map((record) =>
      checkConsent(
        {
          purpose: record.purpose,
          grantedAt: record.grantedAt,
          expiresAt: record.expiresAt,
          revokedAt: record.revokedAt,
        },
        record.purpose,
        now,
      ),
    )
    .filter((verdict) => !verdict.valid && verdict.reason !== 'MISSING');
  if (!invalid.length) return;

  throw new DomainException(
    'SUBJECT_CONSENT_INVALID',
    `El titular tiene permisos que ya no amparan el tratamiento: ` +
      invalid.map((verdict) => `${verdict.purpose} (${verdict.reason})`).join(', '),
    HttpStatus.FORBIDDEN,
    {
      purposes: invalid.map((verdict) => ({ purpose: verdict.purpose, reason: verdict.reason })),
    },
  );
}

/** `limit` de primer nivel: si viene, tiene que ser un importe finito y no negativo. */
export function validateTopLevelLimit(limit: unknown): RoleViolation | null {
  if (limit === null || limit === undefined) return null;
  return validateSemanticOutput('limit', OutputSemanticRole.APPROVED_LIMIT, limit);
}
