import { Injectable } from '@nestjs/common';
import { DataSubjectRequestStatus, DataSubjectRequestType, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { CreateDataSubjectRequestDto } from './data-subject.dto';

/** Techo de decisiones devueltas por solicitud; ver la nota en `resolveAccess`. */
const MAX_DECISIONS = 500;

/**
 * Atiende las solicitudes de un titular de datos sobre las decisiones tomadas acerca de él.
 *
 * El sistema ya guardaba `subject_reference_hash` en cada ejecución y **no lo leía nadie**:
 * el dato para responder existía y la capacidad no. Eso convertía una solicitud de acceso
 * (LGPD art. 18 I-II, CCPA §1798.110) o de eliminación (art. 18 VI) en un recorrido manual de
 * la tabla que más crece del esquema.
 *
 * Tres decisiones de diseño que conviene no deshacer:
 *
 * 1. **La referencia en claro no se persiste.** Se convierte al mismo HMAC que escribió la
 *    ejecución y se busca por él. Localizar al titular no exige guardar quién es.
 * 2. **La eliminación no borra la cadena de auditoría.** `decision_audit_event` es
 *    append-only por obligación legal y por diseño (LGPD art. 16 I permite conservar lo que
 *    exige una obligación regulatoria). Lo que se responde a una solicitud de eliminación es
 *    el alcance real, no un «hecho» que sería falso.
 * 3. **Toda solicitud deja constancia**, se cumpla o se rechace. El art. 18 §1 obliga a
 *    responder, y la prueba de que se respondió es parte de la respuesta.
 */
@Injectable()
export class DataSubjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
    private readonly audit: AuditService,
  ) {}

  async submit(
    tenantId: bigint,
    dto: CreateDataSubjectRequestDto,
    principal: AuthenticatedPrincipal,
  ) {
    // El MISMO HMAC que `ExecutionWriterService`, o la búsqueda no encontraría nada.
    const subjectReferenceHash = this.hashes.hmac(dto.subjectReference);
    const requestType = dto.requestType as DataSubjectRequestType;
    const decisions = await this.findDecisions(tenantId, subjectReferenceHash);
    const resolution = this.resolutionFor(requestType, decisions.length);

    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.decisionDataSubjectRequest.create({
        data: {
          tenantId,
          subjectReferenceHash,
          requestType,
          status: resolution.status,
          receivedBy: principal.id,
          reference: dto.reference,
          resolutionJson: resolution.detail as Prisma.InputJsonValue,
          resolvedAt: new Date(),
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'DATA_SUBJECT_REQUEST_RECEIVED',
          aggregateType: 'DataSubjectRequest',
          aggregateId: created.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          // El hash y no la referencia: el registro de auditoría es el sitio donde MENOS
          // conviene depositar el identificador en claro, porque no se puede borrar.
          payload: {
            requestType,
            subjectReferenceHash,
            matchedDecisions: decisions.length,
            status: resolution.status,
          },
        },
        tx,
      );
      return created;
    });

    return {
      id: record.id.toString(),
      requestType,
      status: record.status,
      createdAt: record.createdAt,
      matchedDecisions: decisions.length,
      // El detalle solo acompaña a las solicitudes que devuelven datos; una eliminación
      // responde con su alcance, no con el contenido que no va a borrar.
      decisions: requestType === 'ACCESS' || requestType === 'PORTABILITY' ? decisions : undefined,
      resolution: resolution.detail,
    };
  }

  /** Historial de solicitudes de un titular, para demostrar que se atendieron. */
  async history(tenantId: bigint, subjectReference: string) {
    const subjectReferenceHash = this.hashes.hmac(subjectReference);
    const items = await this.prisma.decisionDataSubjectRequest.findMany({
      where: { tenantId, subjectReferenceHash },
      orderBy: { createdAt: 'desc' },
      take: MAX_DECISIONS,
    });
    return {
      total: items.length,
      items: items.map((item) => ({
        id: item.id.toString(),
        requestType: item.requestType,
        status: item.status,
        receivedBy: item.receivedBy,
        reference: item.reference,
        createdAt: item.createdAt,
        resolvedAt: item.resolvedAt,
      })),
    };
  }

  /**
   * Decisiones tomadas sobre el titular.
   *
   * Acotado: una solicitud de acceso no puede convertirse en una descarga sin límite de la
   * tabla de ejecuciones. Si un titular supera el techo, el conteo lo dice y la entrega se
   * completa por el canal de exportación, no por una respuesta HTTP.
   */
  private async findDecisions(tenantId: bigint, subjectReferenceHash: string) {
    const rows = await this.prisma.decisionExecution.findMany({
      where: { tenantId, subjectReferenceHash },
      orderBy: { executedAt: 'desc' },
      take: MAX_DECISIONS,
      select: {
        id: true,
        requestId: true,
        decisionStatus: true,
        businessOutcome: true,
        executedAt: true,
        artifactVersion: {
          select: { versionNumber: true, artifact: { select: { artifactCode: true, name: true } } },
        },
        reasons: {
          select: {
            reasonCode: {
              select: { reasonCode: true, publicMessage: true, isAdverseAction: true },
            },
          },
        },
      },
    });
    return rows.map((row) => ({
      executionId: row.id.toString(),
      requestId: row.requestId,
      status: row.decisionStatus,
      outcome: row.businessOutcome,
      executedAt: row.executedAt,
      artifactCode: row.artifactVersion.artifact.artifactCode,
      artifactName: row.artifactVersion.artifact.name,
      versionNumber: row.artifactVersion.versionNumber,
      // El mensaje PÚBLICO, nunca el interno: esto se entrega al titular, y el interno existe
      // precisamente para lo que no se le cuenta.
      reasons: row.reasons.map((entry) => ({
        code: entry.reasonCode.reasonCode,
        message: entry.reasonCode.publicMessage,
        adverseAction: entry.reasonCode.isAdverseAction,
      })),
    }));
  }

  /**
   * Qué se puede responder a cada tipo de solicitud.
   *
   * La eliminación se marca `REJECTED` cuando hay decisiones, y no es un tecnicismo: negarla
   * con su motivo es lo que exige el art. 18 §4, y afirmar un borrado que la cadena de
   * auditoría impide sería una respuesta falsa. La revisión humana (art. 20) queda `RECEIVED`
   * porque la atiende una persona por la cola de revisión manual, no este endpoint.
   */
  private resolutionFor(
    requestType: DataSubjectRequestType,
    matchedDecisions: number,
  ): { status: DataSubjectRequestStatus; detail: Record<string, unknown> } {
    switch (requestType) {
      case 'ACCESS':
      case 'PORTABILITY':
        return {
          status: DataSubjectRequestStatus.FULFILLED,
          detail: {
            matchedDecisions,
            truncated: matchedDecisions >= MAX_DECISIONS,
            scope: 'Decisiones automatizadas y sus motivos públicos',
          },
        };
      case 'ERASURE':
        return matchedDecisions === 0
          ? {
              status: DataSubjectRequestStatus.FULFILLED,
              detail: { matchedDecisions: 0, scope: 'No hay decisiones sobre este titular' },
            }
          : {
              status: DataSubjectRequestStatus.REJECTED,
              detail: {
                matchedDecisions,
                reason: 'LEGAL_RETENTION_OBLIGATION',
                explanation:
                  'La evidencia de una decisión crediticia se conserva por obligación legal ' +
                  '(LGPD art. 16 I; Reg B §1002.12 y regímenes AML). La cadena de auditoría es ' +
                  'append-only y no admite borrado.',
              },
            };
      case 'REVIEW':
        return {
          status: DataSubjectRequestStatus.RECEIVED,
          detail: {
            matchedDecisions,
            scope:
              'Revisión humana de decisión automatizada (LGPD art. 20). Se atiende por la cola ' +
              'de revisión manual.',
          },
        };
    }
  }
}
