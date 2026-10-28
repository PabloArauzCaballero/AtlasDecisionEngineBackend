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

    const status = dto.approve ? ReidentificationStatus.APPROVED : ReidentificationStatus.REJECTED;
    /*
     * La precondición va EN la escritura. Leer el estado arriba y escribir aquí sin condición dejaba
     * que dos decisiones simultáneas pasaran las dos la comprobación: la segunda pisaba a quien
     * decidió primero (`decidedBy`, `decidedAt` y hasta el sentido de la decisión), y el control de
     * dos personas dejaba de tener un único firmante. Con `status: REQUESTED` en el `WHERE` sólo una
     * escritura encuentra la fila; la otra ve `count = 0` y recibe el mismo 409 que si hubiera
     * llegado después.
     */
    const { count } = await this.prisma.reidentificationRequest.updateMany({
      where: { id, tenantId, status: ReidentificationStatus.REQUESTED },
      data: { status, decidedBy: principal.id, decidedAt: new Date() },
    });
    if (count === 0) {
      throw new DomainException(
        'REIDENTIFICATION_ALREADY_DECIDED',
        'Esta solicitud ya se resolvió. Una autorización gastada no vale para la siguiente consulta.',
        HttpStatus.CONFLICT,
      );
    }
    await this.audit.append({
      tenantId,
      eventType: dto.approve ? 'REIDENTIFICATION_APPROVED' : 'REIDENTIFICATION_REJECTED',
      aggregateType: 'ReidentificationRequest',
      aggregateId: request.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: { requestedBy: request.requestedBy, subjectId: request.subjectId.toString() },
    });
    return { id: request.id.toString(), status };
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
