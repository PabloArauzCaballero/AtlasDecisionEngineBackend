/**
 * Las condiciones que se comprueban EN LA DECISIÓN, no en una pantalla.
 *
 * Los tres controles de gobierno existían como reglas puras verificadas por pruebas y no los
 * llamaba nadie desde el camino caliente. Eso es la misma enfermedad que originó todo este
 * trabajo, sólo que una capa más adentro: una capacidad construida, correcta y sin efecto.
 *
 * Qué se comprueba y cuándo:
 *
 *  - **Antes de ejecutar** — la exposición del solicitante contra los límites de cartera, y la
 *    licitud vigente de tratar sus datos. Las dos pueden decir «no», y ese «no» es una decisión
 *    legítima que hay que poder explicar: una solicitud buena rechazada un 28 de mes no es un
 *    fallo del modelo, es el presupuesto agotado.
 *  - **Después de ejecutar** — el rango de las salidas económicas. No se puede antes porque el
 *    valor lo produce un script en tiempo de ejecución: al compilar sólo existe la promesa.
 *
 * Todo lo que hace este guardia está acotado por una condición de entrada: si no hay límites
 * activos, ni sujeto, ni salidas con rol o rango declarado, no consulta nada. Un motor sin
 * gobierno configurado no paga por tenerlo disponible. Lo que SÍ se evalúa siempre es la política
 * de base habilitante (`enabling-basis.ts`), porque su ausencia es justo lo que no puede pasar
 * por permiso.
 */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { OutputSemanticRole, Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { checkConsent, checkLimit, type LimitVerdict } from './exposure-rules';
import { validateSemanticOutput, type RoleViolation } from './semantic-outputs';
import { consultaCrudaConTenant } from '../../common/prisma/tenant-scoped-raw';
import {
  evaluateEnablingBasis,
  type BasisEvaluation,
  type BasisRecord,
  type EnablingBasisPolicy,
} from './enabling-basis';

/** Límite de la exposición acumulada de UN solicitante. */
const SUBJECT_TOTAL = 'SUBJECT_TOTAL';

interface ExposureRow {
  total: Prisma.Decimal | null;
}

/**
 * La exposición que vio la decisión, para que quien CONCEDE pueda revalidarla.
 *
 * El motor lee los créditos ya registrados; no reserva. Dos decisiones simultáneas del mismo
 * solicitante ven la misma exposición y las dos pueden pasar. Por eso la respuesta publica cuánto
 * quedaba y la decisión vence (`decisionValidUntil`): el dueño de la concesión (el core) reserva
 * contra su propio libro con un bloqueo o una condición atómica, y no concede con una decisión
 * vencida ni por encima de `remainingAfterDecision`.
 */
export interface ExposureSnapshot {
  limitCode: string;
  currencyCode: string;
  maxValue: number;
  enforced: boolean;
  currentExposure: number;
  requestedAmount: number;
  /** Lo que quedaba ANTES de esta decisión. Nunca negativo. */
  remainingBeforeDecision: number;
  /** Lo que queda si se concede lo pedido. Negativo = esta decisión lo supera. */
  remainingAfterDecision: number;
}

export interface GuardVerdict {
  basis: BasisEvaluation & { policy: EnablingBasisPolicy };
  exposure: ExposureSnapshot | null;
}

@Injectable()
export class DecisionGuardService {
  private readonly logger = new Logger(DecisionGuardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Comprueba lo que tiene que estar bien ANTES de ejecutar, y devuelve lo que vio.
   *
   * Un `subjectReference` válido que todavía no tiene fila en el motor (`subjectId` nulo: el
   * primer solicitante) YA NO elude nada: su exposición es cero —y aun así lo pedido se compara
   * con el límite— y no tiene bases registradas, así que una política que las exige falla. Antes,
   * sin sujeto resuelto se volvía sin comprobar ninguna de las dos cosas.
   *
   * Lanza cuando la respuesta es «no» por apetito de cartera (409), por un permiso registrado que
   * ya no vale (403) o por una base ausente con política `BLOCK` (403). Con política `REVIEW`
   * NO lanza: devuelve el veredicto y el runtime deja la decisión en revisión con evidencia.
   */
  async checkBeforeDecision(input: {
    tenantId: bigint;
    subjectId: bigint | null;
    subjectReferencePresent: boolean;
    requestedAmount: number;
    basisPolicy: EnablingBasisPolicy;
    now: Date;
  }): Promise<GuardVerdict> {
    const exposure = await this.checkLimits(input.tenantId, input.subjectId, input.requestedAmount);
    const records = input.subjectId
      ? await this.prisma.subjectConsent.findMany({
          where: { tenantId: input.tenantId, subjectId: input.subjectId },
          select: {
            purpose: true,
            basis: true,
            grantedAt: true,
            expiresAt: true,
            revokedAt: true,
            consentVersion: true,
          },
        })
      : [];
    this.assertRegisteredBasesValid(records, input.now);

    const basis = evaluateEnablingBasis(
      input.basisPolicy,
      input.subjectReferencePresent,
      records,
      input.now,
    );
    if (!basis.satisfied && input.basisPolicy.onMissing === 'BLOCK') {
      throw new DomainException(
        'ENABLING_BASIS_INVALID',
        'La decisión exige una base habilitante que el titular no tiene vigente: ' +
          basis.failures.map((failure) => `${failure.purpose} (${failure.reason})`).join(', '),
        HttpStatus.FORBIDDEN,
        { policySource: input.basisPolicy.source, failures: basis.failures },
      );
    }
    return { basis: { ...basis, policy: input.basisPolicy }, exposure };
  }

  /**
   * La exposición del solicitante más lo que esta decisión añadiría.
   *
   * Se compara el valor PROYECTADO. Comparar el actual deja pasar siempre la operación que rompe
   * el límite —el saldo estaba por debajo justo antes de concederla—, que es lo que convierte un
   * límite de concentración en decorativo.
   *
   * Sólo bloquean los límites `enforced`; los demás se miden y se publican en la respuesta. Sin
   * sujeto resuelto la exposición actual es cero, pero lo pedido se compara igual.
   */
  private async checkLimits(
    tenantId: bigint,
    subjectId: bigint | null,
    requestedAmount: number,
  ): Promise<ExposureSnapshot | null> {
    const limits = await this.prisma.exposureLimit.findMany({
      where: { tenantId, isActive: true, limitCode: SUBJECT_TOTAL },
      select: {
        limitCode: true,
        segment: true,
        maxValue: true,
        enforced: true,
        currencyCode: true,
      },
    });
    if (!limits.length) return null;

    const currentValue = subjectId ? await this.currentExposure(tenantId, subjectId) : 0;
    let snapshot: ExposureSnapshot | null = null;
    for (const limit of limits) {
      const maxValue = Number(limit.maxValue);
      const verdict = checkLimit({
        limitCode: limit.limitCode,
        segment: limit.segment,
        maxValue,
        enforced: limit.enforced,
        currentValue,
        requestedValue: requestedAmount,
      });
      if (verdict.blocking) throw this.limitExceeded(verdict);
      // Se publica el límite más estrecho: es el que manda al conceder.
      if (!snapshot || maxValue < snapshot.maxValue) {
        snapshot = {
          limitCode: limit.limitCode,
          currencyCode: limit.currencyCode,
          maxValue,
          enforced: limit.enforced,
          currentExposure: currentValue,
          requestedAmount,
          remainingBeforeDecision: round4(Math.max(0, maxValue - currentValue)),
          remainingAfterDecision: round4(maxValue - verdict.projectedValue),
        };
      }
    }
    return snapshot;
  }

  private async currentExposure(tenantId: bigint, subjectId: bigint): Promise<number> {
    const [row] = await consultaCrudaConTenant(
      this.prisma,
      (tx) => tx.$queryRaw<ExposureRow[]>`
      SELECT SUM(f."principal_amount") AS total
      FROM "credit_facility" f
      WHERE f."tenant_id" = ${tenantId}
        AND f."subject_id" = ${subjectId}
        AND f."closed_at" IS NULL
    `,
    );
    return row?.total ? Number(row.total) : 0;
  }

  private limitExceeded(verdict: LimitVerdict): DomainException {
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
  private assertRegisteredBasesValid(records: BasisRecord[], now: Date): void {
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

  /**
   * Comprueba las salidas económicas DESPUÉS de ejecutar y devuelve lo que no vale.
   *
   * No lanza, y el runtime SÍ usa la lista: una salida fuera de rango no puede salir como una
   * autorización. La ejecución se conserva completa como evidencia y la respuesta es
   * `NO_DECISION` con motivo técnico —un error del modelo no es un rechazo crediticio del
   * solicitante—.
   *
   * Se comprueba el rango del ROL (PD en [0,1], importes no negativos…), el rango de la POLÍTICA
   * declarado en el contrato de salida (`policyMinValue`/`policyMaxValue`, p. ej. la tasa del
   * producto), y el `limit` de primer nivel del resultado, que el core lee como importe aprobado
   * aunque el artefacto no le haya declarado rol.
   */
  async reviewOutputs(
    tenantId: bigint,
    artifactVersionId: bigint,
    output: Record<string, unknown> | undefined,
    topLevel: { limit?: unknown } = {},
  ): Promise<RoleViolation[]> {
    const violations: RoleViolation[] = [];
    const limitViolation = validateTopLevelLimit(topLevel.limit);
    if (limitViolation) violations.push(limitViolation);

    if (output) {
      const fields = await this.prisma.decisionOutputContractField.findMany({
        where: {
          tenantId,
          artifactVersionId,
          OR: [
            { semanticRole: { not: OutputSemanticRole.NONE } },
            { policyMinValue: { not: null } },
            { policyMaxValue: { not: null } },
          ],
        },
        select: {
          fieldCode: true,
          semanticRole: true,
          policyMinValue: true,
          policyMaxValue: true,
        },
      });
      for (const field of fields) {
        const violation = validateSemanticOutput(
          field.fieldCode,
          field.semanticRole,
          output[field.fieldCode],
          {
            min: field.policyMinValue === null ? undefined : Number(field.policyMinValue),
            max: field.policyMaxValue === null ? undefined : Number(field.policyMaxValue),
          },
        );
        if (violation) violations.push(violation);
      }
    }

    for (const violation of violations) {
      this.logger.error(
        `Versión ${artifactVersionId}: ${violation.code} en «${violation.fieldCode}» — ${violation.message}`,
      );
    }
    return violations;
  }
}

/** `limit` de primer nivel: si viene, tiene que ser un importe finito y no negativo. */
function validateTopLevelLimit(limit: unknown): RoleViolation | null {
  if (limit === null || limit === undefined) return null;
  return validateSemanticOutput('limit', OutputSemanticRole.APPROVED_LIMIT, limit);
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}
