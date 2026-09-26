import { Injectable } from '@nestjs/common';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuditClaim, SemanticAuditRepository } from '../core/application/ports';
import type {
  SemanticAnalysisRequest,
  SemanticAnalysisResult,
} from '../core/domain/semantic-analysis.types';

/**
 * Auditoría del worker semántico, sobre la propia tabla de ejecuciones.
 *
 * El paquete original tenía una tabla de auditoría separada de su cola de
 * pg-boss, porque eran dos sistemas distintos: la cola sabía qué faltaba por
 * hacer y la auditoría qué se había hecho. Aquí la cola **es** una tabla del
 * motor, así que mantener una segunda tabla habría significado escribir dos
 * veces lo mismo y tener dos versiones de la verdad sobre el mismo análisis.
 *
 * `decision_semantic_analysis_run` cumple los dos papeles: su estado es el de
 * la cola y sus columnas de resultado y error son la auditoría.
 */
@Injectable()
export class PrismaSemanticAuditRepository implements SemanticAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reclama la solicitud para este intento, o devuelve el resultado que ya tiene.
   *
   * En el diseño original esto protegía contra una entrega repetida de la cola.
   * Aquí el reclamo por `FOR UPDATE SKIP LOCKED` más el lease ya garantizan que
   * sólo un worker toma cada fila; lo que queda con sentido es reconocer una
   * ejecución ya terminada y devolver su resultado, que es lo que la
   * idempotencia promete.
   *
   * **`RUNNING` no significa «otro la está haciendo», significa «la estoy
   * haciendo yo».** `identity()` busca por `requestId`, es decir, por la fila
   * exacta que este intento acaba de reclamar, y el worker la pone en `RUNNING`
   * al tomarla —`claimNextRun()` en `semantic-run-worker.service.ts`— antes de
   * llamar aquí. Tratar ese estado como ajeno hacía que el procesador se saltara
   * su propio trabajo: la fila volvía a `RUNNING` con progreso 20, el lease
   * vencía, se recuperaba y el ciclo se repetía. Ninguna solicitud llegaba nunca
   * a analizarse.
   */
  async claim(request: SemanticAnalysisRequest): Promise<AuditClaim> {
    const row = await this.findRow(request);
    if (!row) return { state: 'ACQUIRED' };

    if (
      row.status === WorkerRunStatus.SUCCEEDED ||
      row.status === WorkerRunStatus.SUCCEEDED_WITH_WARNINGS
    ) {
      const result = toResult(row.resultJson);
      // Estado terminal pero sin resultado legible: la fila está corrupta o se
      // escribió a medias. Se trata como no resuelta en vez de devolver algo
      // inventado.
      if (result) return { state: 'COMPLETED', result };
    }
    return { state: 'ACQUIRED' };
  }

  async complete(request: SemanticAnalysisRequest, result: SemanticAnalysisResult): Promise<void> {
    await this.prisma.semanticAnalysisRun.updateMany({
      where: this.identity(request),
      data: {
        // El pipeline degrada a UNKNOWN cuando el tenant agota su presupuesto:
        // hay resultado, pero no es el que se habría producido con cuota. Que
        // lo diga el estado, y no sólo un campo dentro del JSON, es lo que hace
        // que la lista de ejecuciones sea legible de un vistazo.
        status:
          result.status === 'UNKNOWN'
            ? WorkerRunStatus.SUCCEEDED_WITH_WARNINGS
            : WorkerRunStatus.SUCCEEDED,
        progress: 100,
        resultJson: result as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        leaseExpiresAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
  }

  /** Fallo de este intento. La decisión de reintentar la toma el worker. */
  async fail(request: SemanticAnalysisRequest, errorCode: string): Promise<void> {
    await this.prisma.semanticAnalysisRun.updateMany({
      where: this.identity(request),
      data: { errorCode, errorMessage: `El análisis falló: ${errorCode}` },
    });
  }

  /** Reintentos agotados: estado terminal. */
  async exhaust(request: SemanticAnalysisRequest, errorCode: string): Promise<void> {
    await this.prisma.semanticAnalysisRun.updateMany({
      where: this.identity(request),
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode,
        errorMessage: 'El análisis falló tras agotar los reintentos.',
        finishedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
  }

  async findResult(
    requestId: string,
    tenantId?: string,
  ): Promise<SemanticAnalysisResult | undefined> {
    const row = await this.prisma.semanticAnalysisRun.findFirst({
      where: { requestId, ...(tenantId ? { tenantId: BigInt(tenantId) } : {}) },
      select: { resultJson: true },
    });
    return toResult(row?.resultJson) ?? undefined;
  }

  private async findRow(request: SemanticAnalysisRequest) {
    return this.prisma.semanticAnalysisRun.findFirst({
      where: this.identity(request),
      select: { status: true, resultJson: true },
    });
  }

  /**
   * Identidad de una solicitud. Va acotada por tenant siempre que se conozca:
   * dos tenants pueden usar la misma clave de idempotencia sin relación alguna,
   * y cruzarlas devolvería el análisis de otro.
   */
  private identity(request: SemanticAnalysisRequest): Prisma.SemanticAnalysisRunWhereInput {
    return {
      requestId: request.requestId,
      ...(request.tenantId ? { tenantId: BigInt(request.tenantId) } : {}),
    };
  }
}

function toResult(value: unknown): SemanticAnalysisResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SemanticAnalysisResult>;
  // Se comprueba la forma en vez de confiar en la columna: el JSON lo escribió
  // una versión anterior del worker y puede no tener los campos de hoy.
  if (typeof candidate.requestId !== 'string' || typeof candidate.status !== 'string') return null;
  return value as SemanticAnalysisResult;
}
