import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, ProcessingLegalBasis, VersionStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { EnablingBasisPolicyError, parseDeclaredPolicy } from '../risk-governance/enabling-basis';

/** Lo que se declara sobre una versión editable: sus notas de autoría y la base de tratamiento. */
@Injectable()
export class VersionAuthoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async updateVersionNotes(
    tenantId: bigint,
    versionId: bigint,
    notes: string | null,
    principal: AuthenticatedPrincipal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.decisionArtifactVersion.findFirst({
        where: { id: versionId, artifact: { tenantId } },
        select: { id: true },
      });
      if (!version)
        throw new DomainException(
          'VERSION_NOT_FOUND',
          'Artifact version not found',
          HttpStatus.NOT_FOUND,
        );
      const updated = await tx.decisionArtifactVersion.update({
        where: { id: versionId },
        data: { authoringNotes: notes },
        select: { id: true, authoringNotes: true },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'ARTIFACT_VERSION_NOTES_UPDATED',
          aggregateType: 'ArtifactVersion',
          aggregateId: versionId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { length: notes?.length ?? 0 },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Declara finalidad y base legal del tratamiento que hace esta versión.
   *
   * Van aquí y no en cada ejecución porque describen la OPERACIÓN de tratamiento, que es lo
   * que registra el art. 37 de la LGPD; repetirlas por decisión duplicaría el mismo dato
   * millones de veces y lo alejaría del punto donde alguien lo aprueba.
   *
   * Se audita el valor completo —no su longitud, como en las notas— porque la base legal es
   * justamente la afirmación cuya trazabilidad se le pide al controlador: quién dijo, cuándo,
   * bajo qué amparo se trata este dato.
   */
  async updateProcessingBasis(
    tenantId: bigint,
    versionId: bigint,
    input: {
      processingPurpose?: string | null;
      legalBasis?: string | null;
      enablingBasisPolicy?: unknown;
    },
    principal: AuthenticatedPrincipal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.decisionArtifactVersion.findFirst({
        where: { id: versionId, artifact: { tenantId } },
        select: { id: true, status: true },
      });
      if (!version)
        throw new DomainException(
          'VERSION_NOT_FOUND',
          'Artifact version not found',
          HttpStatus.NOT_FOUND,
        );
      if (
        (input.legalBasis !== undefined || input.processingPurpose !== undefined) &&
        version.status !== VersionStatus.DRAFT &&
        version.status !== VersionStatus.VALIDATION_FAILED
      ) {
        // `legalBasis` DERIVA la política de base habilitante que el runtime exige en cada
        // decisión: cambiarla en una versión aprobada o desplegada relajaría el consentimiento
        // de PROD sin pasar por gobierno. Mismos estados editables que el grafo; para corregir
        // una versión aprobada se clona y se vuelve a aprobar.
        throw new DomainException(
          'PROCESSING_BASIS_LOCKED',
          'La finalidad y la base legal sólo se pueden cambiar en una versión en borrador. ' +
            'Clona la versión para corregirlas y vuelve a aprobarla.',
          HttpStatus.CONFLICT,
        );
      }
      if (input.enablingBasisPolicy !== undefined) {
        // La política de base habilitante es un CONTROL de la versión: cambiarla después de
        // aprobada sería saltarse el doble control con un PATCH.
        if (version.status !== VersionStatus.DRAFT) {
          throw new DomainException(
            'ENABLING_BASIS_POLICY_LOCKED',
            'La política de base habilitante sólo se puede cambiar en una versión en borrador.',
            HttpStatus.CONFLICT,
          );
        }
        try {
          parseDeclaredPolicy(input.enablingBasisPolicy);
        } catch (error) {
          if (error instanceof EnablingBasisPolicyError) {
            throw new DomainException(
              'ENABLING_BASIS_POLICY_INVALID',
              error.message,
              HttpStatus.BAD_REQUEST,
            );
          }
          throw error;
        }
      }
      const updated = await tx.decisionArtifactVersion.update({
        where: { id: versionId },
        data: {
          // `undefined` deja el valor intacto; `null` lo borra. Distinguirlos permite
          // corregir solo la finalidad sin tener que reafirmar la base legal.
          ...(input.processingPurpose !== undefined
            ? { processingPurpose: input.processingPurpose }
            : {}),
          ...(input.legalBasis !== undefined
            ? { legalBasis: (input.legalBasis as ProcessingLegalBasis | null) ?? null }
            : {}),
          ...(input.enablingBasisPolicy !== undefined
            ? {
                enablingBasisPolicy: JSON.parse(
                  JSON.stringify(input.enablingBasisPolicy),
                ) as Prisma.InputJsonValue,
              }
            : {}),
        },
        select: {
          id: true,
          processingPurpose: true,
          legalBasis: true,
          enablingBasisPolicy: true,
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'ARTIFACT_VERSION_PROCESSING_BASIS_UPDATED',
          aggregateType: 'ArtifactVersion',
          aggregateId: versionId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            processingPurpose: updated.processingPurpose,
            legalBasis: updated.legalBasis,
            enablingBasisPolicy: updated.enablingBasisPolicy ?? null,
          },
        },
        tx,
      );
      return updated;
    });
  }
}
