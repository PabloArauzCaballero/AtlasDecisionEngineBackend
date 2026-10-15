import { HttpStatus, Injectable } from '@nestjs/common';
import { ProcessingLegalBasis } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { checkConsent } from './exposure-rules';
import type { RecordConsentDto, RevokeConsentDto } from './risk-governance.dto';
import { SubjectDirectory } from './subject-directory.service';

/** Licitud vigente: la base habilitante de cada titular por finalidad, con su alta, renovación y revocación. */
@Injectable()
export class SubjectConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly subjects: SubjectDirectory,
  ) {}

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
      const subjectId = await this.subjects.lockSubject(tx, tenantId, dto.subjectReference);
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
      const subjectId = await this.subjects.lockSubject(tx, tenantId, dto.subjectReference);
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

  /** Los permisos de un titular, cada uno con su veredicto de hoy. */
  async consentsOf(tenantId: bigint, subjectReference: string) {
    const subjectId = await this.subjects.requireSubject(tenantId, subjectReference);
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
}
