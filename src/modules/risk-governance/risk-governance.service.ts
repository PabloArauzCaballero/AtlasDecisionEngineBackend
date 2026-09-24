/**
 * Gobierno del riesgo: apetito de cartera, licitud vigente y expediente del modelo.
 *
 * Tres cosas que el motor no tenía y que un negocio de microcrédito sostenido necesita antes que
 * cualquier mejora del modelo:
 *
 *  - **el estado del negocio como entrada** — aprobar depende de en qué punto del mes y con qué
 *    liquidez se está, no sólo de quién pide. Sin esto, una solicitud buena rechazada un 28 de mes
 *    no se podía explicar;
 *  - **la vigencia del permiso, por persona y finalidad** — la base legal por versión dice con qué
 *    amparo se diseñó la decisión; ésta dice si HOY se pueden leer los datos de ESTA persona;
 *  - **la reidentificación como acto registrado** — el HMAC protege bien y estorba para operar; la
 *    salida no es aflojarlo sino que el camino exista, pida dos personas y quede escrito.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, ProcessingLegalBasis, ReidentificationStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { canApproveReidentification, checkConsent, checkLimit } from './exposure-rules';
import type {
  DecideReidentificationDto,
  RecordConsentDto,
  RecordModelDossierDto,
  RecordPortfolioStateDto,
  RequestReidentificationDto,
  RevokeConsentDto,
  UpsertExposureLimitDto,
} from './risk-governance.dto';

@Injectable()
export class RiskGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
    private readonly audit: AuditService,
  ) {}

  // --- Apetito de cartera -------------------------------------------------

  async upsertLimit(
    tenantId: bigint,
    dto: UpsertExposureLimitDto,
    principal: AuthenticatedPrincipal,
  ) {
    const segment = dto.segment?.trim() ?? '';
    const limit = await this.prisma.exposureLimit.upsert({
      where: { tenantId_limitCode_segment: { tenantId, limitCode: dto.limitCode, segment } },
      create: {
        tenantId,
        limitCode: dto.limitCode,
        segment,
        maxValue: new Prisma.Decimal(dto.maxValue),
        currencyCode: dto.currencyCode.toUpperCase(),
        enforced: dto.enforced ?? false,
        createdBy: principal.id,
      },
      update: {
        maxValue: new Prisma.Decimal(dto.maxValue),
        currencyCode: dto.currencyCode.toUpperCase(),
        enforced: dto.enforced ?? false,
      },
    });
    await this.audit.append({
      tenantId,
      eventType: 'EXPOSURE_LIMIT_UPSERTED',
      aggregateType: 'ExposureLimit',
      aggregateId: limit.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: {
        limitCode: dto.limitCode,
        segment,
        maxValue: dto.maxValue,
        enforced: limit.enforced,
      },
    });
    return this.serializeLimit(limit);
  }

  async listLimits(tenantId: bigint) {
    const limits = await this.prisma.exposureLimit.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ limitCode: 'asc' }, { segment: 'asc' }],
    });
    const states = await this.latestPortfolioState(tenantId);

    return {
      items: limits.map((limit) => {
        const currentValue = states.get(this.stateKey(limit.limitCode, limit.segment)) ?? 0;
        // `requestedValue: 0` porque aquí no se está decidiendo nada: se enseña el consumo de
        // hoy. La proyección con la operación encima la hace el camino de decisión.
        const verdict = checkLimit({
          limitCode: limit.limitCode,
          segment: limit.segment,
          maxValue: Number(limit.maxValue),
          enforced: limit.enforced,
          currentValue,
          requestedValue: 0,
        });
        return { ...this.serializeLimit(limit), currentValue, ...verdict };
      }),
    };
  }

  async recordPortfolioState(
    tenantId: bigint,
    dto: RecordPortfolioStateDto,
    principal: AuthenticatedPrincipal,
  ) {
    const segment = dto.segment?.trim() ?? '';
    const asOf = new Date(dto.asOf);
    const state = await this.prisma.portfolioState.upsert({
      where: {
        tenantId_asOf_metricCode_segment: { tenantId, asOf, metricCode: dto.metricCode, segment },
      },
      create: {
        tenantId,
        asOf,
        metricCode: dto.metricCode,
        segment,
        value: new Prisma.Decimal(dto.value),
        recordedBy: principal.id,
      },
      update: { value: new Prisma.Decimal(dto.value), recordedBy: principal.id },
    });
    return { id: state.id.toString(), asOf: state.asOf.toISOString(), value: Number(state.value) };
  }

  /** El valor más reciente de cada métrica y segmento. Es contra lo que se mide el apetito. */
  private async latestPortfolioState(tenantId: bigint): Promise<Map<string, number>> {
    // Dentro de `$transaction` para que se fije el GUC `app.tenant_id`: una consulta cruda
    // suelta contra una tabla con RLS forzada aborta con 22P02 (`''::bigint`) en cuanto le
    // toca una conexión del pool que ya sirvió a un tenant. Explicado en `tenant-rls.ts`.
    const rows = await this.prisma.$transaction(
      (tx) =>
        tx.$queryRaw<Array<{ metric_code: string; segment: string; value: Prisma.Decimal }>>`
          SELECT DISTINCT ON ("metric_code", "segment")
            "metric_code", "segment", "value"
          FROM "portfolio_state"
          WHERE "tenant_id" = ${tenantId}
          ORDER BY "metric_code", "segment", "as_of" DESC
        `,
    );
    return new Map(
      rows.map((row) => [this.stateKey(row.metric_code, row.segment), Number(row.value)]),
    );
  }

  private stateKey(code: string, segment: string): string {
    return `${code}::${segment}`;
  }

  private serializeLimit(limit: {
    id: bigint;
    limitCode: string;
    segment: string;
    maxValue: Prisma.Decimal;
    currencyCode: string;
    enforced: boolean;
  }) {
    return {
      id: limit.id.toString(),
      limitCode: limit.limitCode,
      segment: limit.segment,
      maxValue: Number(limit.maxValue),
      currencyCode: limit.currencyCode,
      enforced: limit.enforced,
    };
  }

  // --- Licitud vigente ----------------------------------------------------

  /**
   * Registra (o renueva) la base habilitante de un titular para una finalidad.
   *
   * El titular se MATERIALIZA si el motor aún no lo conoce. Antes se exigía que tuviera una
   * decisión previa (`SUBJECT_NOT_FOUND`), lo que obligaba al core a registrar la base DESPUÉS de
   * la primera decisión: el primer solicitante se decidía siempre sin base que comprobar.
   *
   * Réplicas fuera de orden: un alta con `grantedAt` anterior o igual a una revocación vigente, o
   * anterior al alta vigente, es una réplica vieja y se rechaza con `CONSENT_GRANT_REPLAYED`.
   * Renovar de verdad (alta posterior a la revocación) sí limpia la revocación. Las escrituras
   * sobre el mismo titular se serializan con un bloqueo de su fila.
   */
  async recordConsent(tenantId: bigint, dto: RecordConsentDto, principal: AuthenticatedPrincipal) {
    const grantedAt = new Date(dto.grantedAt);
    const { consent, subjectId } = await this.prisma.$transaction(async (tx) => {
      const subjectId = await this.lockSubject(tx, tenantId, dto.subjectReference);
      const existing = await tx.subjectConsent.findUnique({
        where: { tenantId_subjectId_purpose: { tenantId, subjectId, purpose: dto.purpose } },
      });
      if (existing) {
        const replayed = existing.revokedAt
          ? grantedAt <= existing.revokedAt
          : grantedAt < existing.grantedAt;
        if (replayed) {
          throw new DomainException(
            'CONSENT_GRANT_REPLAYED',
            'El alta es anterior a la situación vigente de esta finalidad (una revocación o un alta ' +
              'más reciente). Es una réplica vieja y no puede resucitar el permiso.',
            HttpStatus.CONFLICT,
            { purpose: dto.purpose },
          );
        }
      }
      const data = {
        basis: dto.basis as ProcessingLegalBasis,
        grantedAt,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        evidenceRef: dto.evidenceRef,
        consentVersion: dto.consentVersion ?? null,
        recordedBy: principal.id,
      };
      const consent = existing
        ? await tx.subjectConsent.update({
            where: { id: existing.id },
            // Renovar limpia la revocación: es un permiso NUEVO, posterior a ella.
            data: { ...data, revokedAt: null },
          })
        : await tx.subjectConsent.create({
            data: { ...data, tenantId, subjectId, purpose: dto.purpose },
          });
      return { consent, subjectId };
    });
    await this.audit.append({
      tenantId,
      eventType: 'SUBJECT_CONSENT_RECORDED',
      aggregateType: 'SubjectConsent',
      aggregateId: consent.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      // La finalidad y el hash, nunca la referencia en claro: la auditoría no se puede borrar.
      payload: { purpose: dto.purpose, basis: dto.basis, subjectId: subjectId.toString() },
    });
    return this.serializeConsent(consent);
  }

  /**
   * Revoca la base de una finalidad, también si la réplica llega tarde o antes que el alta.
   *
   * `revokedAt` permite fechar la revocación cuando el titular la hizo (el motor pudo estar caído).
   * Si no existe registro se deja una LÁPIDA revocada, para que un alta vieja que llegue después
   * no pueda crear un permiso que el titular ya retiró. Una revocación anterior a un alta posterior
   * es obsoleta (`CONSENT_REVOCATION_STALE`); entre dos revocaciones vale la más temprana.
   */
  async revokeConsent(tenantId: bigint, dto: RevokeConsentDto, principal: AuthenticatedPrincipal) {
    const now = new Date();
    const revokedAt = dto.revokedAt ? new Date(dto.revokedAt) : now;
    if (revokedAt.getTime() > now.getTime() + 60_000) {
      throw new DomainException(
        'CONSENT_REVOCATION_IN_FUTURE',
        'Una revocación no puede fecharse en el futuro.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const { consent, subjectId } = await this.prisma.$transaction(async (tx) => {
      const subjectId = await this.lockSubject(tx, tenantId, dto.subjectReference);
      const existing = await tx.subjectConsent.findUnique({
        where: { tenantId_subjectId_purpose: { tenantId, subjectId, purpose: dto.purpose } },
      });
      if (!existing) {
        const consent = await tx.subjectConsent.create({
          data: {
            tenantId,
            subjectId,
            purpose: dto.purpose,
            basis: ProcessingLegalBasis.CONSENT,
            grantedAt: revokedAt,
            revokedAt,
            recordedBy: principal.id,
          },
        });
        return { consent, subjectId };
      }
      if (existing.grantedAt > revokedAt) {
        throw new DomainException(
          'CONSENT_REVOCATION_STALE',
          'La revocación es anterior al alta vigente de esta finalidad: ya fue superada.',
          HttpStatus.CONFLICT,
          { purpose: dto.purpose },
        );
      }
      const effective =
        existing.revokedAt && existing.revokedAt <= revokedAt ? existing.revokedAt : revokedAt;
      const consent = await tx.subjectConsent.update({
        where: { id: existing.id },
        data: { revokedAt: effective, recordedBy: principal.id },
      });
      return { consent, subjectId };
    });
    await this.audit.append({
      tenantId,
      eventType: 'SUBJECT_CONSENT_REVOKED',
      aggregateType: 'SubjectConsent',
      aggregateId: consent.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: { purpose: dto.purpose, subjectId: subjectId.toString() },
    });
    return this.serializeConsent(consent);
  }

  /**
   * El titular, creado si hace falta y BLOQUEADO hasta el final de la transacción.
   *
   * `INSERT … ON CONFLICT` y no `upsert`, por lo mismo que en el escritor de ejecuciones: dos
   * réplicas simultáneas del mismo titular no deben abortar una a la otra con P2002. El bloqueo
   * de la fila serializa alta y revocación del mismo titular, que es donde el orden importa.
   */
  private async lockSubject(
    tx: Prisma.TransactionClient,
    tenantId: bigint,
    subjectReference: string,
  ): Promise<bigint> {
    const subjectReferenceHash = this.hashes.hmac(subjectReference);
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      INSERT INTO "decision_subject" ("tenant_id", "subject_reference_hash", "decision_count")
      VALUES (${tenantId}, ${subjectReferenceHash}, 0)
      ON CONFLICT ("tenant_id", "subject_reference_hash") DO UPDATE
        SET "subject_reference_hash" = EXCLUDED."subject_reference_hash"
      RETURNING "id"
    `;
    const subjectId = rows[0].id;
    await tx.$queryRaw`SELECT "id" FROM "decision_subject" WHERE "id" = ${subjectId} FOR UPDATE`;
    return subjectId;
  }

  /** Los permisos de un titular, cada uno con su veredicto de hoy. */
  async consentsOf(tenantId: bigint, subjectReference: string) {
    const subjectId = await this.requireSubject(tenantId, subjectReference);
    const consents = await this.prisma.subjectConsent.findMany({
      where: { tenantId, subjectId },
      orderBy: { purpose: 'asc' },
    });
    return {
      items: consents.map((consent) => ({
        ...this.serializeConsent(consent),
        ...checkConsent(consent, consent.purpose),
      })),
    };
  }

  private serializeConsent(consent: {
    id: bigint;
    purpose: string;
    basis: ProcessingLegalBasis;
    grantedAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
    evidenceRef: string | null;
    consentVersion?: string | null;
  }) {
    return {
      id: consent.id.toString(),
      purpose: consent.purpose,
      basis: consent.basis,
      grantedAt: consent.grantedAt.toISOString(),
      expiresAt: consent.expiresAt?.toISOString() ?? null,
      revokedAt: consent.revokedAt?.toISOString() ?? null,
      evidenceRef: consent.evidenceRef,
      consentVersion: consent.consentVersion ?? null,
    };
  }

  // --- Reidentificación controlada ---------------------------------------

  async requestReidentification(
    tenantId: bigint,
    dto: RequestReidentificationDto,
    principal: AuthenticatedPrincipal,
  ) {
    const subjectId = await this.requireSubject(tenantId, dto.subjectReference);
    const request = await this.prisma.reidentificationRequest.create({
      data: { tenantId, subjectId, purpose: dto.purpose, requestedBy: principal.id },
    });
    await this.audit.append({
      tenantId,
      eventType: 'REIDENTIFICATION_REQUESTED',
      aggregateType: 'ReidentificationRequest',
      aggregateId: request.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: { subjectId: subjectId.toString(), purpose: dto.purpose },
    });
    return { id: request.id.toString(), status: request.status };
  }

  /**
   * Aprueba o niega, con la única regla que hace de esto un control: quien pide no aprueba.
   *
   * Sin ella, «dos autorizaciones» es la misma persona pulsando otro botón, y el registro
   * entero se vuelve teatro.
   */
  async decideReidentification(
    tenantId: bigint,
    dto: DecideReidentificationDto,
    principal: AuthenticatedPrincipal,
  ) {
    const id = parseBigIntId(dto.requestId, 'requestId');
    const request = await this.prisma.reidentificationRequest.findFirst({
      where: { tenantId, id },
    });
    if (!request) {
      throw new DomainException(
        'REIDENTIFICATION_NOT_FOUND',
        'La solicitud no existe',
        HttpStatus.NOT_FOUND,
      );
    }
    if (request.status !== ReidentificationStatus.REQUESTED) {
      throw new DomainException(
        'REIDENTIFICATION_ALREADY_DECIDED',
        'Esta solicitud ya se resolvió. Una autorización gastada no vale para la siguiente consulta.',
        HttpStatus.CONFLICT,
      );
    }
    if (dto.approve && !canApproveReidentification(request.requestedBy, principal.id)) {
      throw new DomainException(
        'REIDENTIFICATION_SELF_APPROVAL',
        'Quien pide una reidentificación no puede aprobarla.',
        HttpStatus.FORBIDDEN,
      );
    }

    const updated = await this.prisma.reidentificationRequest.update({
      where: { id },
      data: {
        status: dto.approve ? ReidentificationStatus.APPROVED : ReidentificationStatus.REJECTED,
        decidedBy: principal.id,
        decidedAt: new Date(),
      },
    });
    await this.audit.append({
      tenantId,
      eventType: dto.approve ? 'REIDENTIFICATION_APPROVED' : 'REIDENTIFICATION_REJECTED',
      aggregateType: 'ReidentificationRequest',
      aggregateId: updated.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: { requestedBy: request.requestedBy, subjectId: request.subjectId.toString() },
    });
    return { id: updated.id.toString(), status: updated.status };
  }

  async listReidentifications(tenantId: bigint) {
    const items = await this.prisma.reidentificationRequest.findMany({
      where: { tenantId },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
    return {
      items: items.map((item) => ({
        id: item.id.toString(),
        subjectId: item.subjectId.toString(),
        purpose: item.purpose,
        status: item.status,
        requestedBy: item.requestedBy,
        requestedAt: item.requestedAt.toISOString(),
        decidedBy: item.decidedBy,
        decidedAt: item.decidedAt?.toISOString() ?? null,
      })),
    };
  }

  // --- Expediente del modelo ---------------------------------------------

  async recordDossier(
    tenantId: bigint,
    dto: RecordModelDossierDto,
    principal: AuthenticatedPrincipal,
  ) {
    const artifactVersionId = parseBigIntId(dto.artifactVersionId, 'artifactVersionId');
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: artifactVersionId, artifact: { tenantId } },
      select: { id: true, createdBy: true },
    });
    if (!version) {
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (version.createdBy.trim().toLowerCase() === dto.validatedBy.trim().toLowerCase()) {
      // La validación INDEPENDIENTE es lo que pide SR 11-7 §IV; que la firme quien escribió el
      // modelo la convierte en un trámite.
      throw new DomainException(
        'MODEL_VALIDATION_NOT_INDEPENDENT',
        'Quien creó la versión no puede firmar su validación independiente.',
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.decisionArtifactVersion.update({
      where: { id: artifactVersionId },
      data: {
        validatedBy: dto.validatedBy,
        validatedAt: new Date(dto.validatedAt),
        revalidationDueAt: new Date(dto.revalidationDueAt),
        limitationsNotes: dto.limitationsNotes,
      },
      select: { id: true, validatedBy: true, validatedAt: true, revalidationDueAt: true },
    });
    await this.audit.append({
      tenantId,
      eventType: 'MODEL_DOSSIER_RECORDED',
      aggregateType: 'DecisionArtifactVersion',
      aggregateId: updated.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: { validatedBy: dto.validatedBy, revalidationDueAt: dto.revalidationDueAt },
    });
    return {
      artifactVersionId: updated.id.toString(),
      validatedBy: updated.validatedBy,
      validatedAt: updated.validatedAt?.toISOString() ?? null,
      revalidationDueAt: updated.revalidationDueAt?.toISOString() ?? null,
    };
  }

  private async requireSubject(tenantId: bigint, subjectReference: string): Promise<bigint> {
    const subjectReferenceHash = this.hashes.hmac(subjectReference);
    const subject = await this.prisma.decisionSubject.findFirst({
      where: { tenantId, subjectReferenceHash },
      select: { id: true },
    });
    if (!subject) {
      throw new DomainException(
        'SUBJECT_NOT_FOUND',
        'No hay ninguna decisión registrada sobre ese titular en este tenant.',
        HttpStatus.NOT_FOUND,
      );
    }
    return subject.id;
  }
}
