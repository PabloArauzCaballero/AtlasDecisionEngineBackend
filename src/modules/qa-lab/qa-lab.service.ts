/**
 * QA Lab: generación y ejecución masiva reproducible (§10).
 *
 * Todo lo que hace falta para volver a ejecutar exactamente la misma corrida —semilla,
 * configuración, versión del generador, versión de las herramientas y una copia
 * congelada del contrato— se persiste con la corrida. Sin esa foto, un contraejemplo
 * archivado deja de reproducirse en cuanto alguien edita el contrato.
 */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, QaRunStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ExecutionEngineService } from '../graph/execution-engine.service';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import { VariableResolutionService } from '../variables/variable-resolution.service';
import {
  generateCases,
  type DistributionMap,
  type GeneratedCase,
  type GeneratorContractVariable,
  type VariableDistribution,
} from './contract-generator';
import {
  checkProperties,
  shrinkCounterexample,
  type ExecutionObservation,
  type PropertyViolation,
} from './qa-properties';
import { GENERATOR_VERSION, SeededRandom, generateSeed } from './seeded-random';
import { GenerateQaRunDto, GenerateSampleCasesDto, QaRunQueryDto } from './qa-lab.dto';
import { buildSampleBatch, seedSequence, type SampleBatch } from './sample-inputs';

const DEFAULT_MIX = { validPercent: 60, invalidPercent: 25, boundaryPercent: 15 };

@Injectable()
export class QaLabService {
  private readonly logger = new Logger(QaLabService.name);
  // Uno por servicio, no por petición: el contador separa dos pulsaciones caídas en el
  // mismo milisegundo, y reiniciarlo en cada llamada lo dejaría siempre en 1.
  private readonly nextSampleSeed = seedSequence('qa-lab-sample');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    private readonly variables: VariableResolutionService,
    private readonly engine: ExecutionEngineService,
  ) {}

  async run(
    tenantId: bigint,
    versionId: bigint,
    dto: GenerateQaRunDto,
    principal: AuthenticatedPrincipal,
  ) {
    const environmentCode = dto.environmentCode.toUpperCase();
    if (environmentCode === 'PROD') {
      // Aislamiento DEV/PROD (§10.4, §13): una corrida generativa mete miles de
      // ejecuciones sintéticas; contra producción contaminaría métricas y datos reales.
      throw new DomainException(
        'QA_RUN_PROD_FORBIDDEN',
        'El QA Lab no puede ejecutarse contra PROD',
        HttpStatus.FORBIDDEN,
      );
    }

    const compiled = await this.loadCompiled(tenantId, versionId);
    const seed = dto.seed ?? generateSeed(`${versionId}:${principal.requestId}`);
    const mix = {
      validPercent: dto.validPercent ?? DEFAULT_MIX.validPercent,
      invalidPercent: dto.invalidPercent ?? DEFAULT_MIX.invalidPercent,
      boundaryPercent: dto.boundaryPercent ?? DEFAULT_MIX.boundaryPercent,
    };
    const inputContract = this.inputContract(compiled);
    const distributions = this.resolveDistributions(dto, inputContract);

    const run = await this.prisma.qaGenerationRun.create({
      data: {
        tenantId,
        artifactVersionId: versionId,
        environmentCode,
        status: QaRunStatus.RUNNING,
        seed,
        // `distributions` viaja en la configuración archivada junto a la semilla: sin ella
        // la corrida no sería reproducible, porque el sesgo cambia qué valores salen.
        configJson: {
          ...dto,
          environmentCode,
          mix,
          distributions,
        } as unknown as Prisma.InputJsonValue,
        generatorVersion: GENERATOR_VERSION,
        toolingJson: this.toolingVersions(),
        contractSnapshotJson: {
          inputs: inputContract,
          outputs: compiled.variables.filter((variable) =>
            String(variable.usageType ?? '').startsWith('OUTPUT'),
          ),
          intermediates: compiled.intermediates ?? [],
        } as unknown as Prisma.InputJsonValue,
        createdBy: principal.id,
      },
    });

    const started = Date.now();
    const cases = generateCases(
      inputContract,
      new SeededRandom(seed),
      dto.caseCount,
      mix,
      distributions,
    );
    const summary = await this.executeBatch(tenantId, compiled, cases, dto, run.id, seed);
    const durationMs = Date.now() - started;

    const finished = await this.prisma.qaGenerationRun.update({
      where: { id: run.id },
      data: {
        status: QaRunStatus.COMPLETED,
        totalCases: summary.total,
        passedCases: summary.passed,
        failedCases: summary.failed,
        erroredCases: summary.errored,
        durationMs,
        finishedAt: new Date(),
        summaryJson: summary.byProperty as unknown as Prisma.InputJsonValue,
      },
    });

    this.metrics.recordQaCase('PASSED', summary.passed);
    this.metrics.recordQaCase('FAILED', summary.failed);
    this.metrics.recordQaCase('ERRORED', summary.errored);
    await this.audit.append({
      tenantId,
      eventType: 'QA_GENERATION_RUN_COMPLETED',
      aggregateType: 'QaGenerationRun',
      aggregateId: run.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: { seed, total: summary.total, failed: summary.failed, environmentCode },
    });

    return this.presentRun(finished, summary.counterexamples);
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

    for (let offset = 0; offset < cases.length && !stop; offset += concurrency) {
      if (Date.now() > deadline) {
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
        if (result.errored) errored += 1;
        if (!result.violations.length) {
          passed += 1;
          continue;
        }
        failed += 1;
        for (const violation of result.violations) {
          byProperty[violation.property] = (byProperty[violation.property] ?? 0) + 1;
        }
        const stored = await this.storeCounterexample(
          tenantId,
          runId,
          seed,
          compiled,
          result.testCase,
          result.violations[0],
          dto,
        );
        counterexamples.push(stored);
        if (dto.stopOnFirstFailure) {
          stop = true;
          break;
        }
      }
    }

    return {
      total: passed + failed,
      passed,
      failed,
      errored,
      byProperty,
      counterexamples,
    };
  }

  private async evaluateCase(
    tenantId: bigint,
    compiled: CompiledDecisionArtifact,
    testCase: GeneratedCase,
    dto: GenerateQaRunDto,
  ) {
    try {
      const observation = await this.observe(tenantId, compiled, testCase.input);
      const repeat = dto.checkDeterminism
        ? (await this.observe(tenantId, compiled, testCase.input)).signature
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

  /** Ejecuta un caso sin persistir nada y resume el resultado observable. */
  private async observe(
    tenantId: bigint,
    compiled: CompiledDecisionArtifact,
    input: Record<string, unknown>,
  ): Promise<ExecutionObservation> {
    const resolution = await this.variables.resolve(this.inputContractSnapshots(compiled), input, {
      tenantId,
      artifactCode: compiled.artifact.code,
      requestId: 'qa-lab',
      allowExternal: false,
    });
    if (!resolution.valid) {
      return {
        inputAccepted: false,
        output: {},
        status: 'NO_DECISION',
        signature: `REJECTED:${resolution.errors
          .map((error) => error.variable)
          .sort()
          .join(',')}`,
        errorCode: resolution.errors[0]?.code,
      };
    }
    try {
      const result = await this.engine.execute(compiled, resolution.values);
      return {
        inputAccepted: true,
        output: result.output,
        status: result.status,
        signature: JSON.stringify({ status: result.status, output: sortedKeys(result.output) }),
      };
    } catch (error) {
      const code = error instanceof DomainException ? error.code : 'UNEXPECTED_ENGINE_ERROR';
      return {
        inputAccepted: true,
        output: {},
        status: 'FAILED',
        signature: `FAILED:${code}`,
        errorCode: code,
      };
    }
  }

  private async storeCounterexample(
    tenantId: bigint,
    runId: bigint,
    seed: string,
    compiled: CompiledDecisionArtifact,
    testCase: GeneratedCase,
    violation: PropertyViolation,
    dto: GenerateQaRunDto,
  ) {
    const stillFails = async (candidate: Record<string, unknown>): Promise<boolean> => {
      try {
        const observation = await this.observe(tenantId, compiled, candidate);
        return checkProperties(
          { compiled, kind: testCase.kind, input: candidate },
          observation,
        ).some((entry) => entry.failureCode === violation.failureCode);
      } catch {
        return false;
      }
    };
    const shrunk = await shrinkCounterexample(testCase.input, stillFails);

    const created = await this.prisma.qaCounterexample.create({
      data: {
        tenantId,
        qaRunId: runId,
        property: violation.property,
        shrunkInputJson: shrunk as Prisma.InputJsonValue,
        originalInputJson: testCase.input as Prisma.InputJsonValue,
        observedJson: (violation.observed ?? null) as Prisma.InputJsonValue,
        failureCode: violation.failureCode,
        failureMessage: violation.failureMessage,
        replaySeed: seed,
        replayPath: `${testCase.index}/${testCase.kind}${testCase.mutation ? `/${testCase.mutation}` : ''}`,
      },
    });
    this.metrics.recordQaCounterexample(violation.property);
    void dto;
    return {
      id: created.id.toString(),
      property: created.property,
      failureCode: created.failureCode,
      failureMessage: created.failureMessage,
      shrunkInput: shrunk,
      replaySeed: seed,
      replayPath: created.replayPath,
    };
  }

  /**
   * Valores de prueba de una versión, SIN ejecutarlos ni archivar corrida.
   *
   * Es el mismo lote que usa el simulador, pero con el contrato tomado de la versión
   * compilada en vez del despliegue: un caso de suite se guarda contra la versión que la
   * suite prueba, y generarlo contra otra dejaría casos que fallan por contrato el día que
   * alguien los ejecute.
   */
  async sampleInputs(
    tenantId: bigint,
    versionId: bigint,
    dto: GenerateSampleCasesDto,
  ): Promise<SampleBatch & { versionId: string }> {
    const compiled = await this.loadCompiled(tenantId, versionId);
    const inputs = this.inputContract(compiled);
    if (!inputs.length) {
      throw new DomainException(
        'ARTIFACT_HAS_NO_INPUTS',
        'La versión no declara variables de entrada, así que no hay valores que generar',
        HttpStatus.CONFLICT,
      );
    }
    return {
      ...buildSampleBatch(inputs, dto, this.nextSampleSeed),
      versionId: versionId.toString(),
    };
  }

  async listRuns(tenantId: bigint, query: QaRunQueryDto) {
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
      })),
      total,
      page,
      pageSize,
    );
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
    return this.presentRun(
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

  /** Vuelve a ejecutar un contraejemplo archivado contra la versión que lo produjo. */
  async replay(tenantId: bigint, counterexampleId: bigint) {
    const counterexample = await this.prisma.qaCounterexample.findFirst({
      where: { id: counterexampleId, tenantId },
      include: { qaRun: true },
    });
    if (!counterexample) {
      throw new DomainException(
        'QA_COUNTEREXAMPLE_NOT_FOUND',
        'Contraejemplo no encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    const compiled = await this.loadCompiled(tenantId, counterexample.qaRun.artifactVersionId);
    const input = counterexample.shrunkInputJson as Record<string, unknown>;
    const observation = await this.observe(tenantId, compiled, input);
    const violations = checkProperties({ compiled, kind: 'VALID', input }, observation).filter(
      (entry) => entry.failureCode === counterexample.failureCode,
    );
    return {
      id: counterexample.id.toString(),
      reproduced: violations.length > 0,
      input,
      observation,
      violations,
    };
  }

  private async loadCompiled(
    tenantId: bigint,
    versionId: bigint,
  ): Promise<CompiledDecisionArtifact> {
    const compiled = await this.prisma.decisionCompiledArtifact.findFirst({
      where: {
        artifactVersionId: versionId,
        compileStatus: 'SUCCESS',
        artifactVersion: { artifact: { tenantId } },
      },
      orderBy: { compiledAt: 'desc' },
    });
    if (!compiled) {
      throw new DomainException(
        'QA_VERSION_NOT_COMPILED',
        'La versión no tiene un artefacto compilado con éxito: compílala antes de generar casos',
        HttpStatus.CONFLICT,
      );
    }
    return compiled.compiledPayloadJson as unknown as CompiledDecisionArtifact;
  }

  private inputContract(compiled: CompiledDecisionArtifact): GeneratorContractVariable[] {
    return this.inputContractSnapshots(compiled).map((variable) => ({
      code: variable.code,
      dataType: variable.dataType,
      required: variable.required,
      nullable: variable.nullable,
      defaultValue: variable.defaultValue,
      constraints: variable.constraints ?? variable.validationSchema,
    }));
  }

  /**
   * Normaliza las distribuciones pedidas y las contrasta con el contrato (§10.4).
   *
   * Falla cerrado ante un código que no existe entre las entradas. Una distribución que no
   * se aplica no da error visible en ninguna parte: la corrida saldría verde, uniforme y
   * con el nombre de un sesgo que nunca ocurrió, que es la peor forma de fallar en QA.
   */
  private resolveDistributions(
    dto: GenerateQaRunDto,
    inputContract: GeneratorContractVariable[],
  ): DistributionMap {
    if (!dto.distributions?.length) return {};
    const declared = new Set(inputContract.map((variable) => variable.code));
    const resolved: Record<string, VariableDistribution> = {};

    for (const entry of dto.distributions) {
      if (!declared.has(entry.variableCode)) {
        throw new DomainException(
          'QA_DISTRIBUTION_VARIABLE_UNKNOWN',
          `La variable ${entry.variableCode} no es una entrada del contrato de esta versión`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          { variableCode: entry.variableCode, declared: [...declared] },
        );
      }
      if (resolved[entry.variableCode]) {
        throw new DomainException(
          'QA_DISTRIBUTION_DUPLICATED',
          `La variable ${entry.variableCode} tiene más de una distribución declarada`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      for (const [value, weight] of Object.entries(entry.valueWeights ?? {})) {
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
          throw new DomainException(
            'QA_DISTRIBUTION_WEIGHT_INVALID',
            `El peso de ${entry.variableCode}.${value} debe ser un número finito no negativo`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
      }
      resolved[entry.variableCode] = { shape: entry.shape, valueWeights: entry.valueWeights };
    }
    return resolved;
  }

  private inputContractSnapshots(compiled: CompiledDecisionArtifact) {
    return compiled.variables.filter(
      (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
    );
  }

  /** Versiones exactas de las herramientas, para poder reproducir la corrida (§10.5). */
  private toolingVersions(): Prisma.InputJsonValue {
    return {
      generator: GENERATOR_VERSION,
      node: process.version,
      // Faker y fast-check son dependencias de desarrollo: alimentan las pruebas de
      // propiedades del repositorio, no el generador en línea. Se registran igualmente
      // porque forman parte del conjunto de herramientas de QA declarado.
      faker: readPackageVersion('@faker-js/faker'),
      fastCheck: readPackageVersion('fast-check'),
    };
  }

  private presentRun(
    run: {
      id: bigint;
      artifactVersionId: bigint;
      environmentCode: string;
      status: QaRunStatus;
      seed: string;
      generatorVersion: string;
      toolingJson: Prisma.JsonValue;
      totalCases: number;
      passedCases: number;
      failedCases: number;
      erroredCases: number;
      durationMs: number;
      summaryJson: Prisma.JsonValue;
      startedAt: Date;
      finishedAt: Date | null;
    },
    counterexamples: Array<Record<string, unknown>>,
  ) {
    return {
      id: run.id.toString(),
      artifactVersionId: run.artifactVersionId.toString(),
      environmentCode: run.environmentCode,
      status: run.status,
      seed: run.seed,
      generatorVersion: run.generatorVersion,
      tooling: run.toolingJson,
      totalCases: run.totalCases,
      passedCases: run.passedCases,
      failedCases: run.failedCases,
      erroredCases: run.erroredCases,
      durationMs: run.durationMs,
      summary: run.summaryJson,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      counterexamples,
    };
  }
}

function sortedKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

/** Lee la versión instalada de un paquete sin fallar si no está presente. */
function readPackageVersion(packageName: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return String(require(`${packageName}/package.json`).version);
  } catch {
    return 'not-installed';
  }
}
