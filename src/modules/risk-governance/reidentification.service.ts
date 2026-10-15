import { HttpStatus, Injectable } from '@nestjs/common';
import { ReidentificationStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { canApproveReidentification } from './exposure-rules';
import type { DecideReidentificationDto, RequestReidentificationDto } from './risk-governance.dto';
import { SubjectDirectory } from './subject-directory.service';

/** Reidentificación como acto registrado: pide una persona, aprueba otra y queda escrito. */
@Injectable()
export class ReidentificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly subjects: SubjectDirectory,
  ) {}

  async requestReidentification(
    tenantId: bigint,
    dto: RequestReidentificationDto,
    principal: AuthenticatedPrincipal,
  ) {
    const subjectId = await this.subjects.requireSubject(tenantId, dto.subjectReference);
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
}
