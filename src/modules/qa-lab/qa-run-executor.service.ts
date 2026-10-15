import { Injectable, Logger } from '@nestjs/common';
import { Prisma, QaRunStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import type { GeneratedCase } from './contract-generator';
import { QaCaseObserverService } from './qa-case-observer.service';
import { QaCounterexampleStoreService } from './qa-counterexample-store.service';
import { GenerateQaRunDto } from './qa-lab.dto';
import { checkProperties } from './qa-properties';
import type { StoppedReason } from './qa-run-summary';

/** Ejecuta el lote de una corrida fuera de la petición y la cierra con su resumen. */
@Injectable()
export class QaRunExecutorService {
  private readonly logger = new Logger(QaRunExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    private readonly observer: QaCaseObserverService,
    private readonly counterexamples: QaCounterexampleStoreService,
  ) {}

  /**
   * Ejecuta el lote fuera de la petición y cierra la corrida.
   *
   * Nadie espera esta promesa, así que un error aquí no puede propagarse a ningún sitio
   * donde se vea: se archiva en la propia corrida como FAILED. Un fallo que sólo aparece
   * en el registro del servidor deja la pantalla sondeando una corrida que ya no avanza.
   */
  async execute(
    tenantId: bigint,
    compiled: CompiledDecisionArtifact,
    batch: GeneratedCase[],
    dto: GenerateQaRunDto,
    runId: bigint,
    seed: string,
    principal: AuthenticatedPrincipal,
  ): Promise<void> {
    const started = Date.now();
    try {
      const summary = await this.executeBatch(tenantId, compiled, batch, dto, runId, seed);
      const durationMs = Date.now() - started;

      // El cierre de la corrida y su evento de auditoría van en LA MISMA transacción
      // (`.claude/rules/80-database.md`). Antes commiteaban por separado: si el `append`
      // fallaba, quedaba una corrida COMPLETED sin ninguna entrada en la cadena de
      // auditoría, que es justo la combinación que no se puede explicar después.
      await this.prisma.$transaction(async (tx) => {
        await tx.qaGenerationRun.update({
          where: { id: runId },
          data: {
            status: QaRunStatus.COMPLETED,
            totalCases: summary.total,
            passedCases: summary.passed,
            failedCases: summary.failed,
            erroredCases: summary.errored,
            durationMs,
            finishedAt: new Date(),
            // El conteo por propiedad y, junto a él, si la corrida se cortó antes de
            // tiempo. Una corrida parada en el primer contraejemplo o por el tope de tiempo
            // también es COMPLETED, y sin `stoppedReason` se leía como «recorrió todo».
            summaryJson: {
              byProperty: summary.byProperty,
              stoppedReason: summary.stoppedReason,
              executedCases: summary.executed,
              plannedCases: batch.length,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        await this.audit.append(
          {
            tenantId,
            eventType: 'QA_GENERATION_RUN_COMPLETED',
            aggregateType: 'QaGenerationRun',
            aggregateId: runId.toString(),
            actorId: principal.id,
            requestId: principal.requestId,
            payload: {
              seed,
              total: summary.total,
              failed: summary.failed,
              stoppedReason: summary.stoppedReason,
            },
          },
          tx,
        );
      });

      this.metrics.recordQaCase('PASSED', summary.passed);
      this.metrics.recordQaCase('FAILED', summary.failed);
      this.metrics.recordQaCase('ERRORED', summary.errored);
    } catch (error) {
      await this.abortRun(runId, error, Date.now() - started);
    }
  }

  /** Cierra como FALLIDA una corrida que reventó, sin volver a lanzar: nadie la espera. */
  private async abortRun(runId: bigint, error: unknown, durationMs: number): Promise<void> {
    const failureCode = error instanceof DomainException ? error.code : 'QA_RUN_UNEXPECTED_ERROR';
    const failureMessage = error instanceof Error ? error.message : String(error);
    this.logger.error({ event: 'QA_RUN_FAILED', runId: runId.toString(), failureCode });
    try {
      await this.prisma.qaGenerationRun.update({
        where: { id: runId },
        data: {
          status: QaRunStatus.FAILED,
          durationMs,
          finishedAt: new Date(),
          // Sólo las corridas FALLIDAS traen esta forma; las que terminan bien siguen
          // guardando el conteo por propiedad. Así el portal puede decir POR QUÉ falló en
          // vez de enseñar una corrida vacía sin explicación.
          summaryJson: { failureCode, failureMessage } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (secondary) {
      // Si ni siquiera se puede archivar el fallo, queda el barrido de abandonadas.
      this.logger.error({
        event: 'QA_RUN_FAILURE_NOT_RECORDED',
        runId: runId.toString(),
        detail: String(secondary),
      });
    }
  }

  private async executeBatch(
    tenantId: bigint,
    compiled: CompiledDecisionArtifact,
    cases: GeneratedCase[],
    dto: GenerateQaRunDto,
    runId: bigint,
    seed: string,
  ) {
    const concurrency = dto.concurrency ?? 8;
    const deadline = Date.now() + (dto.timeoutMs ?? 120_000);
    const byProperty: Record<string, number> = {};
    const counterexamples: Array<Record<string, unknown>> = [];
    let passed = 0;
    let failed = 0;
    let errored = 0;
    let stop = false;
    let executed = 0;
    let stoppedReason: StoppedReason | null = null;

    for (let offset = 0; offset < cases.length && !stop; offset += concurrency) {
      if (Date.now() > deadline) {
        stoppedReason = 'TIMEOUT';
        // Detenerse por tiempo y decirlo: una corrida truncada en silencio se lee como
        // "todo cubierto" cuando no lo está.
        this.logger.warn({
          event: 'QA_RUN_TIMEOUT',
          runId: runId.toString(),
          executed: offset,
          requested: cases.length,
        });
        break;
      }
      const slice = cases.slice(offset, offset + concurrency);
      const results = await Promise.all(
        slice.map((testCase) => this.evaluateCase(tenantId, compiled, testCase, dto)),
      );
      for (const result of results) {
        executed += 1;
        if (result.errored) errored += 1;
        if (!result.violations.length) {
          passed += 1;
          continue;
        }
        failed += 1;
        for (const violation of result.violations) {
          byProperty[violation.property] = (byProperty[violation.property] ?? 0) + 1;
        }
        const stored = await this.counterexamples.store(
          tenantId,
          runId,
          seed,
          compiled,
          result.testCase,
          result.violations[0],
        );
        counterexamples.push(stored);
        if (dto.stopOnFirstFailure) {
          stop = true;
          stoppedReason = 'FIRST_FAILURE';
          break;
        }
      }
      // El avance se publica al cerrar cada tanda, no al final. Sin esto la corrida está
      // en RUNNING con todos los contadores a cero hasta que termina, y una tanda larga es
      // indistinguible de una colgada: quien mira la pantalla no puede saber si esperar.
      await this.publishProgress(runId, { passed, failed, errored });
    }

    return {
      total: passed + failed,
      passed,
      failed,
      errored,
      byProperty,
      counterexamples,
      executed,
      stoppedReason,
    };
  }

  /**
   * Publica los contadores de una corrida en marcha.
   *
   * No propaga el error: un fallo escribiendo el avance no es motivo para abortar una tanda
   * que va bien, y `executeRun` archiva el resultado definitivo al terminar.
   */
  private async publishProgress(
    runId: bigint,
    counts: { passed: number; failed: number; errored: number },
  ): Promise<void> {
    try {
      await this.prisma.qaGenerationRun.update({
        where: { id: runId },
        data: {
          totalCases: counts.passed + counts.failed,
          passedCases: counts.passed,
          failedCases: counts.failed,
          erroredCases: counts.errored,
        },
      });
    } catch (error) {
      this.logger.warn({
        event: 'QA_RUN_PROGRESS_NOT_PUBLISHED',
        runId: runId.toString(),
        detail: String(error),
      });
    }
  }

  private async evaluateCase(
    tenantId: bigint,
    compiled: CompiledDecisionArtifact,
    testCase: GeneratedCase,
    dto: GenerateQaRunDto,
  ) {
    try {
      const observation = await this.observer.observe(tenantId, compiled, testCase.input);
      const repeat = dto.checkDeterminism
        ? (await this.observer.observe(tenantId, compiled, testCase.input)).signature
        : undefined;
      const violations = checkProperties(
        { compiled, kind: testCase.kind, input: testCase.input },
        observation,
        repeat,
      );
      return {
        testCase,
        violations,
        errored: Boolean(observation.errorCode) && testCase.kind !== 'INVALID',
      };
    } catch (error) {
      // Una excepción no controlada ES un hallazgo: el motor debería fallar con un
      // DomainException tipado, nunca reventar.
      return {
        testCase,
        errored: true,
        violations: [
          {
            property: 'OUTPUT_CONTRACT_RESPECTED' as const,
            failureCode: 'UNEXPECTED_ENGINE_ERROR',
            failureMessage: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }
}
