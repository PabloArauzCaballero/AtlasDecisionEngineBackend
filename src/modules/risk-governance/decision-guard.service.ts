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
 * `enforced`, ni permisos registrados, ni salidas con rol declarado, no consulta nada. Un motor
 * sin gobierno configurado no paga por tenerlo disponible.
 */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { OutputSemanticRole, Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { checkConsent, checkLimit, type LimitVerdict } from './exposure-rules';
import { validateSemanticOutput, type RoleViolation } from './semantic-outputs';

/** Límite de la exposición acumulada de UN solicitante. */
const SUBJECT_TOTAL = 'SUBJECT_TOTAL';

interface ExposureRow {
  total: Prisma.Decimal | null;
}

@Injectable()
export class DecisionGuardService {
  private readonly logger = new Logger(DecisionGuardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Comprueba lo que tiene que estar bien ANTES de ejecutar.
   *
   * Sin sujeto no se comprueba nada y no es un descuido: los dos controles son sobre una persona
   * concreta —cuánto debe ya, qué permisos tiene— y sin identificarla no hay nada que mirar. Que
   * eso sea así es un motivo más para exigir sujeto, no una excusa para no exigirlo.
   */
  async assertCanDecide(
    tenantId: bigint,
    subjectId: bigint | null,
    requestedAmount: number,
  ): Promise<void> {
    if (!subjectId) return;
    await this.assertWithinLimits(tenantId, subjectId, requestedAmount);
    await this.assertConsentsValid(tenantId, subjectId);
  }

  /**
   * La exposición del solicitante más lo que esta decisión añadiría.
   *
   * Se compara el valor PROYECTADO. Comparar el actual deja pasar siempre la operación que rompe
   * el límite —el saldo estaba por debajo justo antes de concederla—, que es lo que convierte un
   * límite de concentración en decorativo.
   *
   * Sólo bloquean los límites `enforced`. Los demás se miden y se registran, que es como se
   * estrena un límite sin parar la originación el primer día.
   */
  private async assertWithinLimits(
    tenantId: bigint,
    subjectId: bigint,
    requestedAmount: number,
  ): Promise<void> {
    const limits = await this.prisma.exposureLimit.findMany({
      where: { tenantId, isActive: true, enforced: true, limitCode: SUBJECT_TOTAL },
      select: { limitCode: true, segment: true, maxValue: true, enforced: true },
    });
    if (!limits.length) return;

    const [row] = await this.prisma.$queryRaw<ExposureRow[]>`
      SELECT SUM(f."principal_amount") AS total
      FROM "credit_facility" f
      WHERE f."tenant_id" = ${tenantId}
        AND f."subject_id" = ${subjectId}
        AND f."closed_at" IS NULL
    `;
    const currentValue = row?.total ? Number(row.total) : 0;

    for (const limit of limits) {
      const verdict = checkLimit({
        limitCode: limit.limitCode,
        segment: limit.segment,
        maxValue: Number(limit.maxValue),
        enforced: limit.enforced,
        currentValue,
        requestedValue: requestedAmount,
      });
      if (verdict.blocking) throw this.limitExceeded(verdict);
    }
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
   * Ningún permiso registrado puede estar vencido o revocado.
   *
   * Ojo a lo que NO se comprueba: la AUSENCIA de permiso no bloquea. Es deliberado y es la única
   * forma de estrenar esto sin parar el motor —hoy casi ningún titular tiene consentimiento
   * cargado—. Lo que sí bloquea es un permiso que EXISTE y ya no vale: eso no es una laguna de
   * migración, es tratar datos contra una voluntad expresada, y sigue siendo una infracción
   * aunque el dato ya esté en la caché.
   */
  private async assertConsentsValid(tenantId: bigint, subjectId: bigint): Promise<void> {
    const consents = await this.prisma.subjectConsent.findMany({
      where: { tenantId, subjectId },
      select: { purpose: true, grantedAt: true, expiresAt: true, revokedAt: true },
    });
    if (!consents.length) return;

    const invalid = consents
      .map((consent) => checkConsent(consent, consent.purpose))
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
   * Comprueba el rango de las salidas económicas DESPUÉS de ejecutar.
   *
   * No lanza: registra y devuelve las violaciones. Una PD fuera de rango es un defecto del
   * artefacto, y tirar la decisión ya calculada por él castigaría al solicitante por un error
   * ajeno. Lo que sí hace es dejar constancia — y el gate del contrato económico impide que un
   * artefacto así llegue a producción, que es donde corresponde atajarlo.
   */
  async reviewOutputs(
    tenantId: bigint,
    artifactVersionId: bigint,
    output: Record<string, unknown> | undefined,
  ): Promise<RoleViolation[]> {
    if (!output) return [];
    const fields = await this.prisma.decisionOutputContractField.findMany({
      where: {
        tenantId,
        artifactVersionId,
        semanticRole: { not: OutputSemanticRole.NONE },
      },
      select: { fieldCode: true, semanticRole: true },
    });
    if (!fields.length) return [];

    const violations = fields
      .map((field) =>
        validateSemanticOutput(field.fieldCode, field.semanticRole, output[field.fieldCode]),
      )
      .filter((violation): violation is RoleViolation => violation !== null);

    for (const violation of violations) {
      this.logger.error(
        `Versión ${artifactVersionId}: ${violation.code} en «${violation.fieldCode}» — ${violation.message}`,
      );
    }
    return violations;
  }
}
