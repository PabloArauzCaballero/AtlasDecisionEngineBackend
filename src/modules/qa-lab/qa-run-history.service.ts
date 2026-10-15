import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, QaRunStatus } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import { outputContractOf } from './qa-contract';
import type { FakerReport } from './qa-fakers.service';
import { GenerateQaRunDto, QaRunQueryDto } from './qa-lab.dto';
import { ABANDONED_RUN_MS, QA_LAB_ENVIRONMENT, fakersOf, loadOf } from './qa-run-config';
import type { QaRunPlan } from './qa-run-planner.service';
import { presentRun } from './qa-run-presenter';
import { readRunSummary } from './qa-run-summary';
import { GENERATOR_VERSION } from './seeded-random';

/**
 * Versiones exactas de lo que produjo el lote, para poder reproducir la corrida (§10.5).
 *
 * Registraba `@faker-js/faker` y `fast-check`, que NO intervienen en el lote —son
 * dependencias de desarrollo de las pruebas del repositorio—: una versión archivada de
 * algo que no se usó sólo confunde a quien intenta reproducir. Ahora se archiva lo que sí
 * interviene: el generador del contrato y, si respondieron, los fakers del mock.
 */
function toolingVersions(fakers: FakerReport): Prisma.InputJsonValue {
  return {
    generator: GENERATOR_VERSION,
    node: process.version,
    fakers:
      fakers.source === 'mock'
        ? `atlas-external-providers-mock/fakers@${fakers.schemaVersion ?? 'desconocida'}`
        : null,
  };
}

/** El historial de corridas: las abre, las lista, las muestra y cierra las abandonadas. */
@Injectable()
export class QaRunHistoryService {
  private readonly logger = new Logger(QaRunHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Archiva una corrida nueva en `RUNNING`, con todo lo necesario para reproducirla. */
  async open(
    tenantId: bigint,
    versionId: bigint,
    compiled: CompiledDecisionArtifact,
    plan: QaRunPlan,
    dto: GenerateQaRunDto,
    principal: AuthenticatedPrincipal,
  ) {
    const { seed, mix, inputContract, distributions, outcomeAllocation, batch, fakers } = plan;
    await this.closeAbandoned(tenantId);
    const run = await this.prisma.qaGenerationRun.create({
      data: {
        tenantId,
        artifactVersionId: versionId,
        environmentCode: QA_LAB_ENVIRONMENT,
        status: QaRunStatus.RUNNING,
        seed,
        // `distributions` viaja en la configuración archivada junto a la semilla: sin ella
        // la corrida no sería reproducible, porque el sesgo cambia qué valores salen.
        configJson: {
          ...dto,
          environmentCode: QA_LAB_ENVIRONMENT,
          mix,
          distributions,
          // El reparto YA RESUELTO, no los pesos: los pesos son relativos y cuántos casos
          // caen en cada rama depende además de `caseCount` y de `validPercent`. Guardar
          // sólo los pesos obligaría a rehacer esa cuenta —y acertarla— para saber qué se
          // ejecutó de verdad.
          outcomeAllocation: outcomeAllocation ? Object.fromEntries(outcomeAllocation) : undefined,
          // Cuántos casos se van a ejecutar. Es lo único que permite dibujar un avance
          // honesto mientras corre: `totalCases` sólo cuenta los ya ejecutados, así que sin
          // este dato el portal no puede decir 40 DE CUÁNTOS.
          plannedCases: batch.length,
          // De dónde salieron los valores con significado. Es lo único que puede cambiar
          // entre dos corridas con la misma semilla y la misma configuración.
          fakers,
        } as unknown as Prisma.InputJsonValue,
        generatorVersion: GENERATOR_VERSION,
        toolingJson: toolingVersions(fakers),
        contractSnapshotJson: {
          inputs: inputContract,
          outputs: outputContractOf(compiled),
          intermediates: compiled.intermediates ?? [],
        } as unknown as Prisma.InputJsonValue,
        createdBy: principal.id,
      },
    });
    return run;
  }

  async listRuns(tenantId: bigint, query: QaRunQueryDto) {
    // Una corrida vive en la petición que la lanzó: si el proceso se reinicia a mitad, su
    // fila se queda en RUNNING para siempre y el historial dice que sigue trabajando algo
    // que ya no existe. Se cierran al leer, que es cuando alguien va a creerse el dato.
    await this.closeAbandoned(tenantId);
    const { skip, take, page, pageSize } = paginationArgs(query);
    const where: Prisma.QaGenerationRunWhereInput = {
      tenantId,
      ...(query.artifactVersionId ? { artifactVersionId: BigInt(query.artifactVersionId) } : {}),
      ...(query.status ? { status: query.status as QaRunStatus } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.qaGenerationRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take,
        include: { _count: { select: { counterexamples: true } } },
      }),
      this.prisma.qaGenerationRun.count({ where }),
    ]);
    return pageResult(
      rows.map((row) => ({
        id: row.id.toString(),
        artifactVersionId: row.artifactVersionId.toString(),
        environmentCode: row.environmentCode,
        status: row.status,
        seed: row.seed,
        generatorVersion: row.generatorVersion,
        totalCases: row.totalCases,
        passedCases: row.passedCases,
        failedCases: row.failedCases,
        erroredCases: row.erroredCases,
        durationMs: row.durationMs,
        counterexamples: row._count.counterexamples,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        // La CARGA con la que se corrió, sacada de la configuración archivada.
        //
        // Sin ella el listado publica duración y número de casos, con lo que cualquiera
        // puede dividir y obtener un «milisegundos por caso» que NO es comparable entre
        // corridas: con concurrencia 1 el motor despacha de uno en uno y con la de serie
        // ocho a la vez, y con `checkDeterminism` cada caso se ejecuta DOS veces. Dos
        // corridas de la misma versión pueden diferir en un orden de magnitud sin que el
        // motor se haya degradado nada. Publicarla es lo que convierte una serie de
        // corridas en una medición legible.
        ...loadOf(row.configJson),
        stoppedReason: readRunSummary(row.summaryJson).stoppedReason,
        fakerSource: fakersOf(row.configJson)?.source ?? null,
      })),
      total,
      page,
      pageSize,
    );
  }

  /**
   * Cierra como FALLIDAS las corridas que llevan demasiado tiempo en RUNNING.
   *
   * El techo es el tiempo máximo de una corrida más margen: por encima de eso no está
   * tardando, está abandonada. Se marca FAILED y no COMPLETED porque no hay resumen que
   * enseñar, y un COMPLETED sin casos se leería como «pasó todo».
   */
  async closeAbandoned(tenantId: bigint): Promise<void> {
    const limite = new Date(Date.now() - ABANDONED_RUN_MS);
    const cerradas = await this.prisma.qaGenerationRun.updateMany({
      where: { tenantId, status: QaRunStatus.RUNNING, startedAt: { lt: limite } },
      data: { status: QaRunStatus.FAILED, finishedAt: new Date() },
    });
    if (cerradas.count > 0) {
      this.logger.warn({
        event: 'QA_RUN_ABANDONED',
        tenantId: tenantId.toString(),
        closed: cerradas.count,
      });
    }
  }

  async getRun(tenantId: bigint, runId: bigint) {
    const run = await this.prisma.qaGenerationRun.findFirst({
      where: { id: runId, tenantId },
      include: { counterexamples: { orderBy: { id: 'asc' } } },
    });
    if (!run) {
      throw new DomainException(
        'QA_RUN_NOT_FOUND',
        'Corrida de QA no encontrada',
        HttpStatus.NOT_FOUND,
      );
    }
    return presentRun(
      run,
      run.counterexamples.map((entry) => ({
        id: entry.id.toString(),
        property: entry.property,
        failureCode: entry.failureCode,
        failureMessage: entry.failureMessage,
        shrunkInput: entry.shrunkInputJson,
        originalInput: entry.originalInputJson,
        observed: entry.observedJson,
        replaySeed: entry.replaySeed,
        replayPath: entry.replayPath,
        resolvedAt: entry.resolvedAt,
      })),
    );
  }
}
