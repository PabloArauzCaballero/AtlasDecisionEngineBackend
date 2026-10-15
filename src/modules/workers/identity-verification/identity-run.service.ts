import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ObjectStorageService } from '../../../common/storage/object-storage.service';
import {
  RUN_SELECTION,
  TERMINAL_STATUSES,
  type IdentityVerificationRunView,
} from './identity-run.view';

/** Consulta, lectura de evidencia y cancelación de las verificaciones de un tenant. */
@Injectable()
export class IdentityRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  /**
   * Una de las tres imágenes de un caso, recuperada del almacén.
   *
   * Es la contrapartida de conservarlas: sin esto, persistir la cara y el carnet sólo llenaría un
   * bucket que nadie puede consultar. Los bytes se sirven POR LA API y no por una URL firmada del
   * almacén, y eso es deliberado — la autorización por tenant y por rol la impone este proceso, y
   * una URL prefirmada se puede reenviar por un chat y sigue funcionando hasta que vence.
   *
   * `null` cuando la ejecución no tiene esa imagen: puede ser un caso sin reverso, o —para las
   * ejecuciones anteriores al 2026-09-03— uno cuyas imágenes ya se perdieron. Quien llama lo
   * traduce a 404; distinguir los dos casos no aportaría nada a quien mira la pantalla.
   */
  async getRunImage(
    tenantId: bigint,
    requestId: string,
    kind: 'document' | 'documentBack' | 'selfie',
  ): Promise<{ content: Buffer; contentType: string } | null> {
    const run = await this.prisma.identityVerificationRun.findFirst({
      where: { tenantId, requestId },
      select: { documentObjectKey: true, documentBackObjectKey: true, selfieObjectKey: true },
    });
    if (!run) {
      // 404 y no 403, igual que en `getRun`: un 403 confirmaría que la ejecución existe y es de
      // otro tenant.
      throw new DomainException(
        'IDENTITY_RUN_NOT_FOUND',
        'No existe esa verificación.',
        HttpStatus.NOT_FOUND,
      );
    }

    const objectKey =
      kind === 'document'
        ? run.documentObjectKey
        : kind === 'documentBack'
          ? run.documentBackObjectKey
          : run.selfieObjectKey;
    if (!objectKey) return null;

    const stored = await this.objectStorage.get(objectKey);
    if (!stored) return null;
    return {
      content: stored.content,
      contentType: stored.contentType ?? 'application/octet-stream',
    };
  }

  /** Una ejecución del tenant. Ajena o inexistente responden igual: 404. */
  async getRun(tenantId: bigint, requestId: string): Promise<IdentityVerificationRunView> {
    const run = await this.prisma.identityVerificationRun.findFirst({
      where: { tenantId, requestId },
      select: RUN_SELECTION,
    });
    if (!run) {
      // 404 y no 403: un 403 confirmaría que la ejecución existe y que es de
      // otro, que es justo lo que no debe poder averiguarse desde fuera.
      throw new DomainException(
        'IDENTITY_RUN_NOT_FOUND',
        'No existe esa verificación.',
        HttpStatus.NOT_FOUND,
      );
    }
    return run;
  }

  async listRuns(
    tenantId: bigint,
    params: { page: number; pageSize: number; status?: WorkerRunStatus },
  ): Promise<{ items: IdentityVerificationRunView[]; total: number }> {
    const where: Prisma.IdentityVerificationRunWhereInput = {
      tenantId,
      ...(params.status ? { status: params.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.identityVerificationRun.findMany({
        where,
        select: RUN_SELECTION,
        orderBy: { queuedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.identityVerificationRun.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Cancela una verificación que todavía nadie reclamó.
   *
   * Sólo desde `QUEUED`, igual que en el worker de extractos: cancelar algo ya
   * en curso exigiría que el pipeline cooperase y una señal entre procesos que
   * el motor no tiene, y ofrecerlo en la interfaz sería prometer algo que no se
   * cumple. Las imágenes se borran al cancelar: dejaron de hacer falta.
   */
  async cancelRun(tenantId: bigint, requestId: string): Promise<IdentityVerificationRunView> {
    const updated = await this.prisma.identityVerificationRun.updateMany({
      where: { tenantId, requestId, status: WorkerRunStatus.QUEUED },
      data: {
        status: WorkerRunStatus.CANCELLED,
        finishedAt: new Date(),
        documentBytes: null,
        documentBackBytes: null,
        selfieBytes: null,
      },
    });
    if (updated.count === 0) {
      const current = await this.getRun(tenantId, requestId);
      throw new DomainException(
        'IDENTITY_RUN_NOT_CANCELLABLE',
        TERMINAL_STATUSES.includes(current.status)
          ? 'La verificación ya terminó.'
          : 'La verificación ya está en proceso y no puede cancelarse.',
        HttpStatus.CONFLICT,
        { status: current.status },
      );
    }
    return this.getRun(tenantId, requestId);
  }
}
