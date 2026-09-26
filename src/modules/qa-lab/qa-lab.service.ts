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
  distribute,
  generateCasesOfKinds,
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
import {
  allocateOutcomeCounts,
  describeOutcomes,
  planOutcomeAllocation,
  planOutcomeCases,
  reachableOutcomeKeys,
  type OutcomeCase,
} from './outcome-coverage';
import { buildSampleBatch, seedSequence, type SampleBatch } from './sample-inputs';

const DEFAULT_MIX = { validPercent: 60, invalidPercent: 25, boundaryPercent: 15 };

/**
 * Tope de casos por desenlace que se añaden a una corrida. Se suman a `caseCount`, así
 * que sin cota un grafo muy ramificado podría multiplicar la duración de la tanda.
 */
const MAX_OUTCOME_CASES_PER_RUN = 25;

/** Techo del listado de desenlaces: el enumerador de caminos ya no devuelve más. */
const MAX_OUTCOMES_LISTED = 200;

/**
 * A partir de aquí una corrida `RUNNING` está muerta, no ocupada.
 *
 * Es el techo que admite `timeoutMs` (600 s) más un margen. La ejecución sobrevive a la
 * petición que la lanzó, así que un reinicio del proceso a mitad de tanda deja la fila en
 * `RUNNING` para siempre: el portal la sondearía sin fin y el historial mentiría diciendo
 * que sigue trabajando.
 */
const ABANDONED_RUN_MS = 660_000;

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
    // El reparto de clases se decide aquí porque el de desenlaces se calcula SOBRE él:
    // los pesos reparten la porción válida, no el lote entero.
    const kinds = distribute(dto.caseCount, mix);
    // Se valida ANTES de crear la corrida: un peso sobre un desenlace que este grafo no
    // alcanza no se puede aplicar, y descubrirlo a mitad de la ejecución dejaría una
    // corrida archivada cuyo reparto no es el que pidió quien la lanzó.
    const outcomeAllocation = this.resolveOutcomeAllocation(
      dto,
      compiled,
      kinds.filter((kind) => kind === 'VALID').length,
    );

    const random = new SeededRandom(seed);
    // Con reparto por desenlace, la porción VÁLIDA la construye el planificador del grafo
    // y aquí sólo quedan frontera e inválidos. `validPercent` sigue decidiendo CUÁNTOS son
    // válidos; el reparto decide DÓNDE acaban. Sin `outcomeWeights` no cambia nada.
    const mixKinds = outcomeAllocation ? kinds.filter((kind) => kind !== 'VALID') : kinds;
    const allocated = outcomeAllocation
      ? this.asGeneratedCases(
          planOutcomeAllocation(compiled, inputContract, random, outcomeAllocation),
        )
      : [];
    const cases = [
      ...allocated,
      ...generateCasesOfKinds(inputContract, random, mixKinds, distributions),
    ];
    // Los casos por desenlace van DELANTE y con su propio flujo aleatorio —derivado de la
    // misma semilla, así que la corrida sigue siendo reproducible—. Delante porque son los
    // que responden la pregunta que importa: si algo se rompe, que se rompa aquí antes de
    // que un tope de tiempo trunque la tanda.
    const outcomeCases =
      dto.coverOutcomes === false ? [] : this.outcomeCases(compiled, inputContract, seed);
    // Se renumera al unir: cada generador cuenta desde 0 por su cuenta, y dos casos con el
    // mismo índice hacen que un contraejemplo apunte a un caso que no es el suyo.
    const batch = [...outcomeCases, ...cases].map((testCase, index) => ({ ...testCase, index }));

    await this.failAbandonedRuns(tenantId);
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
          // El reparto YA RESUELTO, no los pesos: los pesos son relativos y cuántos casos
          // caen en cada rama depende además de `caseCount` y de `validPercent`. Guardar
          // sólo los pesos obligaría a rehacer esa cuenta —y acertarla— para saber qué se
          // ejecutó de verdad.
          outcomeAllocation: outcomeAllocation ? Object.fromEntries(outcomeAllocation) : undefined,
          // Cuántos casos se van a ejecutar. Es lo único que permite dibujar un avance
          // honesto mientras corre: `totalCases` sólo cuenta los ya ejecutados, así que sin
          // este dato el portal no puede decir 40 DE CUÁNTOS.
          plannedCases: batch.length,
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

    /*
     * La ejecución NO se espera: la respuesta sale ya, con la corrida en RUNNING, y quien
     * la lanzó consulta `getRun` hasta verla cerrada.
     *
     * Es la única forma de que `timeoutMs` signifique algo. Un interceptor global corta
     * TODA petición a los `REQUEST_TIMEOUT_MS` del despliegue (15 s de serie), así que
     * ejecutar el lote dentro de la petición hacía que doscientos casos murieran siempre
     * con `REQUEST_TIMEOUT` —y encima dejaban la fila en RUNNING y las ejecuciones
     * corriendo, porque cortar la respuesta no cancela el trabajo—. El formulario ofrecía
     * hasta 600 000 ms de una espera que nunca podía pasar de 15 000.
     */
    void this.executeRun(tenantId, compiled, batch, dto, run.id, seed, principal);

    return this.presentRun(run, []);
  }

  /**
   * Ejecuta el lote fuera de la petición y cierra la corrida.
   *
   * Nadie espera esta promesa, así que un error aquí no puede propagarse a ningún sitio
   * donde se vea: se archiva en la propia corrida como FAILED. Un fallo que sólo aparece
   * en el registro del servidor deja la pantalla sondeando una corrida que ya no avanza.
   */
  private async executeRun(
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
            summaryJson: summary.byProperty as unknown as Prisma.InputJsonValue,
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
              environmentCode: dto.environmentCode.toUpperCase(),
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

  /**
   * Un caso por desenlace, con la forma que espera el ejecutor.
   *
   * Se etiquetan `VALID` porque eso es lo que son: entradas legítimas que el motor debe
   * ACEPTAR —las propiedades sólo tratan distinto a `INVALID`, del que esperan rechazo—.
   * El desenlace perseguido viaja en `mutation`, el campo que el informe ya enseña junto a
   * cada contraejemplo: sin él un fallo diría «caso 3» y no «el camino a Rechazar».
   */
  private outcomeCases(
    compiled: CompiledDecisionArtifact,
    inputContract: GeneratorContractVariable[],
    seed: string,
  ): GeneratedCase[] {
    const plan = planOutcomeCases(
      compiled,
      inputContract,
      new SeededRandom(`${seed}:outcomes`),
      MAX_OUTCOME_CASES_PER_RUN,
    );
    return this.asGeneratedCases(plan.cases);
  }

  /** Traduce los casos del planificador de desenlaces a la forma que ejecuta el lote. */
  private asGeneratedCases(plan: OutcomeCase[]): GeneratedCase[] {
    return plan.map((item, index) => ({
      index,
      kind: 'VALID' as const,
      mutation: `desenlace: ${item.outcome}${item.unresolved.length ? ' (no garantizado desde la entrada)' : ''}`,
      input: item.input,
      ...(item.unsatisfiable?.length ? { unsatisfiable: item.unsatisfiable } : {}),
    }));
  }

  /**
   * Convierte los pesos por desenlace en un número exacto de casos, o `null` si no se pidió
   * reparto.
   *
   * Dos decisiones que no son de estilo:
   *
   * - Una clave que este grafo NO alcanza es un error, no un peso que se ignora. Quien
   *   escribe `{"RECHAZADO": 70}` sobre un artefacto cuyo nodo se llama `DECLINED_RESULT`
   *   se llevaría una corrida verde con un reparto que nunca ocurrió, y el informe diría
   *   que el 70 % acabó en una rama que no existe.
   * - El reparto usa el resto MAYOR, así que los casos asignados suman exactamente los
   *   válidos pedidos. Redondear cada peso por su cuenta perdía casos por el camino y la
   *   corrida ejecutaba menos de los que decía.
   */
  private resolveOutcomeAllocation(
    dto: GenerateQaRunDto,
    compiled: CompiledDecisionArtifact,
    validCount: number,
  ): Map<string, number> | null {
    const weights = dto.outcomeWeights;
    if (!weights || !Object.keys(weights).length) return null;

    const reachable = reachableOutcomeKeys(compiled);
    const unknown = Object.keys(weights).filter((key) => !reachable.includes(key));
    if (unknown.length) {
      throw new DomainException(
        'QA_RUN_OUTCOME_UNKNOWN',
        `Estos desenlaces no existen en la versión: ${unknown.join(', ')}. Los alcanzables son: ${reachable.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const entries = reachable
      .filter((key) => key in weights)
      .map((key) => [key, Number(weights[key])] as const);
    if (entries.some(([, weight]) => !Number.isFinite(weight) || weight < 0)) {
      throw new DomainException(
        'QA_RUN_OUTCOME_WEIGHT_INVALID',
        'Los pesos por desenlace tienen que ser números no negativos',
        HttpStatus.BAD_REQUEST,
      );
    }
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    if (total <= 0) {
      throw new DomainException(
        'QA_RUN_OUTCOME_WEIGHT_INVALID',
        'Al menos un desenlace tiene que llevar peso mayor que cero',
        HttpStatus.BAD_REQUEST,
      );
    }

    return allocateOutcomeCounts(entries, validCount);
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
      // Igual que el simulador: con `kind: 'OUTCOMES'` el lote se construye recorriendo
      // el grafo, así que la versión compilada viaja entera y no sólo su contrato.
      ...buildSampleBatch(inputs, dto, this.nextSampleSeed, compiled),
      versionId: versionId.toString(),
    };
  }

  /**
   * Desenlaces que el grafo de la versión alcanza de verdad, para poder repartir pesos
   * sobre ellos sin adivinar cómo se llaman.
   *
   * El portal los necesita para ofrecer el reparto: sin esta lista, escribir
   * `outcomeWeights` sería teclear claves a ciegas y descubrir el error al lanzar.
   */
  async listOutcomes(tenantId: bigint, versionId: bigint) {
    const compiled = await this.loadCompiled(tenantId, versionId);
    const items = describeOutcomes(compiled).slice(0, MAX_OUTCOMES_LISTED);
    return { versionId: versionId.toString(), items };
  }

  async listRuns(tenantId: bigint, query: QaRunQueryDto) {
    // Una corrida vive en la petición que la lanzó: si el proceso se reinicia a mitad, su
    // fila se queda en RUNNING para siempre y el historial dice que sigue trabajando algo
    // que ya no existe. Se cierran al leer, que es cuando alguien va a creerse el dato.
    await this.failAbandonedRuns(tenantId);
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
  private async failAbandonedRuns(tenantId: bigint): Promise<void> {
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
      configJson: Prisma.JsonValue;
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
      // Cuántos casos se van a ejecutar en total. Sale de la configuración archivada y se
      // publica aparte porque es lo único con lo que se puede dibujar un avance: mientras
      // la corrida vive, `totalCases` sólo cuenta los ya ejecutados, y un número que sube
      // sin un techo al lado no dice si falta un segundo o cinco minutos.
      plannedCases: plannedCasesOf(run.configJson),
      summary: run.summaryJson,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      counterexamples,
    };
  }
}

/** `plannedCases` de una configuración archivada; 0 en las corridas anteriores al campo. */
function plannedCasesOf(config: Prisma.JsonValue): number {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 0;
  const planned = (config as Record<string, unknown>).plannedCases;
  return typeof planned === 'number' && Number.isFinite(planned) ? planned : 0;
}

/**
 * La carga con la que se lanzó una corrida, leída de su configuración archivada.
 *
 * `null` y no un valor por omisión cuando el dato no está: las corridas anteriores a este
 * campo no llevan concurrencia guardada, y rellenarla con el 8 de serie inventaría una
 * medición —diría que aquella corrida iba a ocho en paralelo sin que nadie lo sepa—.
 */
function loadOf(config: Prisma.JsonValue): {
  plannedCases: number;
  concurrency: number | null;
  checkDeterminism: boolean | null;
} {
  const planned = plannedCasesOf(config);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { plannedCases: planned, concurrency: null, checkDeterminism: null };
  }
  const record = config as Record<string, unknown>;
  const concurrency = record.concurrency;
  const determinism = record.checkDeterminism;
  return {
    plannedCases: planned,
    concurrency:
      typeof concurrency === 'number' && Number.isFinite(concurrency) ? concurrency : null,
    checkDeterminism: typeof determinism === 'boolean' ? determinism : null,
  };
}

function sortedKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

/** Lee la versión instalada de un paquete sin fallar si no está presente. */
function readPackageVersion(packageName: string): string {
  try {
    // `require` dinámico a propósito: el paquete puede no estar instalado, y un `import`
    // estático lo convertiría en dependencia obligatoria del arranque.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const manifest = require(`${packageName}/package.json`) as { version?: unknown };
    return String(manifest.version ?? 'unknown');
  } catch {
    return 'not-installed';
  }
}
