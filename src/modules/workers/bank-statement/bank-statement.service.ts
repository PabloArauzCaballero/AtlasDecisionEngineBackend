import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { JobName } from '../../../common/jobs/job-names';
import { JobSignalService } from '../../../common/jobs/job-signal.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import { newRequestId, type ValidatedStatementInput } from './bank-statement-input';

/** Estados desde los que ya no puede pasar nada más. */
const TERMINAL_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.SUCCEEDED,
  WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
  WorkerRunStatus.FAILED,
  WorkerRunStatus.CANCELLED,
];

/** Columnas que se devuelven al cliente. `fileBytes` NUNCA está entre ellas. */
const RUN_SELECTION = {
  requestId: true,
  status: true,
  progress: true,
  inputSource: true,
  fixtureCode: true,
  fileName: true,
  fileHash: true,
  fileSizeBytes: true,
  resultJson: true,
  warningsJson: true,
  confidence: true,
  institutionId: true,
  transactionCount: true,
  errorCode: true,
  errorMessage: true,
  attemptCount: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: true,
  correlationId: true,
} satisfies Prisma.BankStatementRunSelect;

export type BankStatementRunView = Prisma.BankStatementRunGetPayload<{
  select: typeof RUN_SELECTION;
}>;

/**
 * Alta y consulta de ejecuciones del worker de extractos.
 *
 * No procesa nada: crea la fila, anuncia el trabajo y responde. El procesado
 * ocurre en `BankStatementRunWorkerService`, en otro proceso si el despliegue
 * lo separa. Esa frontera es el motivo de que el controlador no llame nunca al
 * motor de extractos directamente.
 */
@Injectable()
export class BankStatementService {
  private readonly logger = new Logger(BankStatementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSignal: JobSignalService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Encola una conversión.
   *
   * Reenviar el mismo documento devuelve la ejecución que ya existe en vez de
   * crear una segunda. La deduplicación se apoya en el índice único
   * `(tenant_id, file_hash)` y **no** en una consulta previa: dos peticiones
   * simultáneas con el mismo archivo pasan las dos por un `SELECT` que no ve
   * nada y crean dos filas. Aquí la segunda choca contra la base, y ese choque
   * se traduce en la ejecución existente.
   */
  async createRun(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    input: ValidatedStatementInput,
    source: WorkerInputSource,
    fixtureCode?: string,
  ): Promise<{ run: BankStatementRunView; deduplicated: boolean }> {
    try {
      const run = await this.prisma.$transaction(async (tx) => {
        const created = await tx.bankStatementRun.create({
          data: {
            tenantId,
            requestId: newRequestId(),
            status: WorkerRunStatus.QUEUED,
            inputSource: source,
            fixtureCode: fixtureCode ?? null,
            fileName: input.fileName,
            fileHash: input.fileHash,
            fileSizeBytes: input.bytes.byteLength,
            // Prisma tipa `Bytes` como `Uint8Array<ArrayBuffer>`, y un `Buffer`
            // de Node declara `ArrayBufferLike`, que en el sistema de tipos
            // admite también `SharedArrayBuffer`. Esto copia —una vez por
            // subida, con 10 MiB de techo— en lugar de resolverlo con un cast:
            // un cast escondería que los dos tipos no son intercambiables.
            fileBytes: new Uint8Array(input.bytes),
            requestedBy: principal.id,
            correlationId: principal.requestId,
          },
          select: RUN_SELECTION,
        });
        // Dentro de la transacción a propósito: Postgres sólo entrega el aviso
        // si esto confirma, así que el worker nunca busca una ejecución que se
        // deshizo ni la busca antes de que sea visible.
        await this.jobSignal.notify(tx, JobName.BankStatement);
        return created;
      });
      return { run, deduplicated: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.bankStatementRun.findFirst({
        where: { tenantId, fileHash: input.fileHash },
        select: RUN_SELECTION,
      });
      // El índice saltó pero la fila no aparece: sólo puede pasar si se borró
      // entre las dos consultas. Propagar el error original es más honesto que
      // fingir un resultado.
      if (!existing) throw error;
      this.logger.debug(`Extracto ya encolado para esta huella; se devuelve ${existing.requestId}`);
      return { run: existing, deduplicated: true };
    }
  }

  /** Una ejecución del tenant. Ajena o inexistente responden igual: 404. */
  async getRun(tenantId: bigint, requestId: string): Promise<BankStatementRunView> {
    const run = await this.prisma.bankStatementRun.findFirst({
      where: { tenantId, requestId },
      select: RUN_SELECTION,
    });
    if (!run) {
      // 404 y no 403: un 403 confirmaría que la ejecución existe y que es de
      // otro, que es justo lo que no debe poder averiguarse desde fuera.
      throw new DomainException(
        'BANK_STATEMENT_RUN_NOT_FOUND',
        'No existe esa ejecución.',
        HttpStatus.NOT_FOUND,
      );
    }
    return run;
  }

  async listRuns(
    tenantId: bigint,
    params: { page: number; pageSize: number; status?: WorkerRunStatus },
  ): Promise<{ items: BankStatementRunView[]; total: number }> {
    const where: Prisma.BankStatementRunWhereInput = {
      tenantId,
      ...(params.status ? { status: params.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.bankStatementRun.findMany({
        where,
        select: RUN_SELECTION,
        orderBy: { queuedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.bankStatementRun.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Cancela una ejecución que todavía nadie reclamó.
   *
   * Sólo desde `QUEUED`. Cancelar algo ya en curso exigiría que el processor
   * cooperase y una señal entre procesos que el motor no tiene; ofrecerlo en la
   * interfaz sería prometer algo que no se cumple.
   */
  async cancelRun(tenantId: bigint, requestId: string): Promise<BankStatementRunView> {
    const updated = await this.prisma.bankStatementRun.updateMany({
      where: { tenantId, requestId, status: WorkerRunStatus.QUEUED },
      data: {
        status: WorkerRunStatus.CANCELLED,
        finishedAt: new Date(),
        // El documento deja de hacer falta en cuanto se cancela.
        fileBytes: null,
      },
    });
    if (updated.count === 0) {
      const current = await this.getRun(tenantId, requestId);
      throw new DomainException(
        'BANK_STATEMENT_RUN_NOT_CANCELLABLE',
        TERMINAL_STATUSES.includes(current.status)
          ? 'La ejecución ya terminó.'
          : 'La ejecución ya está siendo procesada y no puede cancelarse.',
        HttpStatus.CONFLICT,
        { status: current.status },
      );
    }
    return this.getRun(tenantId, requestId);
  }

  /** Máximo aceptado para un archivo, en bytes. Lo publica el catálogo. */
  maxUploadBytes(): number {
    return this.config.get<number>('BANK_STATEMENT_MAX_UPLOAD_BYTES') ?? 10_485_760;
  }
}

/** ¿Es la violación del índice único (P2002) y no otro fallo de la base? */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
