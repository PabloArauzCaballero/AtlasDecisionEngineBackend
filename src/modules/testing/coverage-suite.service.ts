import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import type { GeneratorContractVariable } from '../qa-lab/contract-value-factory';
import { SeededRandom } from '../qa-lab/seeded-random';
import {
  searchCoverage,
  type CoverageCandidate,
  type CoverageCase,
  type CoverageObservation,
} from './coverage-search';
import { TestCaseExecutorService } from './test-case-executor.service';
import { TestExecutionService } from './test-execution.service';

/** La suite que escribe el generador. Una por versión: regenerar la reemplaza, no la duplica. */
export const AUTO_SUITE_CODE = 'AUTO-COBERTURA';

const RESERVED_ACTUAL_KEYS = new Set(['trace', 'reasons', 'primaryResult', 'variableErrors']);

/**
 * Lo que el caso generado va a comprobar: a qué terminal llega, con qué desenlace y motivos, y
 * cada salida simple. Es lo que el grafo hace HOY; por eso la suite es de regresión.
 */
export function expectedResultOf(observation: CoverageObservation): Record<string, unknown> {
  const expected: Record<string, unknown> = {};
  if (observation.terminalNodeKey) expected.trace = { terminal: observation.terminalNodeKey };
  for (const [key, value] of Object.entries(observation.actual)) {
    if (RESERVED_ACTUAL_KEYS.has(key) || value === undefined) continue;
    const simple = value === null || typeof value !== 'object';
    if (
      simple ||
      (Array.isArray(value) && value.every((item) => item === null || typeof item !== 'object'))
    ) {
      expected[key] = value;
    }
  }
  return expected;
}

function caseCodeOf(generation: number, index: number, terminal: string | undefined): string {
  const suffix = (terminal ?? 'SIN_TERMINAL')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .slice(0, 60);
  return `AUTO-G${String(generation)}-${String(index + 1).padStart(3, '0')}-${suffix}`;
}

@Injectable()
export class CoverageSuiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly executor: TestCaseExecutorService,
    private readonly execution: TestExecutionService,
  ) {}

  /**
   * Genera la suite de cobertura de una versión compilada, la guarda como bloqueante y encola su
   * corrida.
   *
   * La búsqueda corre dentro de la petición y por eso tiene un presupuesto corto; los seis grafos
   * de Atlas se recorren enteros en menos de tres segundos (`test/coverage-search.spec.ts`). Si un
   * grafo no se deja recorrer del todo, la respuesta dice qué nodos faltaron: no se guarda una
   * cobertura que no se consiguió.
   */
  async generate(tenantId: bigint, versionId: bigint, principal: AuthenticatedPrincipal) {
    const compiledRow = await this.prisma.decisionCompiledArtifact.findFirst({
      where: {
        artifactVersionId: versionId,
        compileStatus: 'SUCCESS',
        artifactVersion: { artifact: { tenantId } },
      },
      orderBy: { compiledAt: 'desc' },
      include: { artifactVersion: { include: { artifact: true } } },
    });
    if (!compiledRow) {
      throw new DomainException(
        'COVERAGE_VERSION_NOT_COMPILED',
        'La versión no tiene un artefacto compilado con éxito: compílala antes de generar sus pruebas',
        HttpStatus.CONFLICT,
      );
    }
    const compiled = compiledRow.compiledPayloadJson as unknown as CompiledDecisionArtifact;
    const artifactCode = compiledRow.artifactVersion.artifact.artifactCode;

    const observe = async (candidate: CoverageCandidate): Promise<CoverageObservation> => {
      const evaluated = await this.executor.execute({
        tenantId,
        artifactCode,
        runId: 0n,
        payload: compiled,
        testCase: {
          id: 0n,
          caseCode: 'AUTO-BUSQUEDA',
          inputJson: { variables: candidate.variables, workerDoubles: candidate.workerDoubles },
          expectedResultJson: {},
        },
      });
      return {
        // Sin nodos recorridos el contrato rechazó la entrada o el motor falló: no sirve de caso.
        usable: !evaluated.error && evaluated.visitedNodeKeys.length > 0,
        visitedNodeKeys: evaluated.visitedNodeKeys,
        traversedEdgeKeys: evaluated.traversedEdgeKeys,
        terminalNodeKey: evaluated.terminalNodeKey,
        actual: evaluated.actual ?? {},
      };
    };

    const result = await searchCoverage(
      compiled,
      this.inputContract(compiled),
      // Semilla fija por versión: generar dos veces la misma versión da los mismos casos.
      new SeededRandom(`cobertura-${versionId.toString()}`),
      observe,
      {
        maxExecutions: this.config.get<number>('COVERAGE_SUITE_MAX_EXECUTIONS') ?? 400,
        maxMillis: this.config.get<number>('COVERAGE_SUITE_MAX_MILLIS') ?? 9_000,
      },
    );
    if (!result.cases.length) {
      throw new DomainException(
        'COVERAGE_NO_USABLE_CASE',
        'No se pudo construir ningún caso ejecutable para esta versión: revisa su contrato de entrada',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const suite = await this.persist(tenantId, versionId, compiled, result.cases, principal, {
      nodeCoverage: result.nodes.percentage,
      missingNodes: result.nodes.missing,
    });
    const run = await this.execution.enqueueSuite(
      tenantId,
      suite.id,
      { triggerType: 'AUTO_COVERAGE' },
      principal,
    );

    return {
      suiteId: suite.id.toString(),
      suiteCode: AUTO_SUITE_CODE,
      runId: run.id.toString(),
      generation: suite.generation,
      cases: result.cases.length,
      complete: result.nodes.missing.length === 0,
      exhaustedBudget: result.exhaustedBudget,
      executions: result.executions,
      nodes: {
        percentage: result.nodes.percentage,
        missing: result.nodes.missing.map((key) => ({
          key,
          label: compiled.nodes[key]?.label ?? key,
        })),
      },
      edges: { percentage: result.edges.percentage, missing: result.edges.missing },
    };
  }

  private inputContract(compiled: CompiledDecisionArtifact): GeneratorContractVariable[] {
    return compiled.variables
      .filter((variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'))
      .map((variable) => ({
        code: variable.code,
        dataType: variable.dataType,
        required: variable.required,
        nullable: variable.nullable,
        defaultValue: variable.defaultValue,
        constraints: variable.constraints ?? variable.validationSchema,
      }));
  }

  /**
   * Guarda los casos en la suite `AUTO-COBERTURA` de la versión. Si ya existía, los casos de la
   * generación anterior se DESACTIVAN —no se borran: sus corridas son evidencia— y entran los
   * nuevos con otro número de generación.
   */
  private async persist(
    tenantId: bigint,
    versionId: bigint,
    compiled: CompiledDecisionArtifact,
    cases: CoverageCase[],
    principal: AuthenticatedPrincipal,
    summary: { nodeCoverage: number; missingNodes: string[] },
  ): Promise<{ id: bigint; generation: number }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.decisionTestSuite.findFirst({
        where: { artifactVersionId: versionId, suiteCode: AUTO_SUITE_CODE },
        include: { cases: { select: { caseCode: true } } },
      });
      const previous = (existing?.cases ?? [])
        .map((item) => Number(/^AUTO-G(\d+)-/.exec(item.caseCode)?.[1] ?? 0))
        .reduce((highest, value) => Math.max(highest, value), 0);
      const generation = previous + 1;
      const name = `Cobertura generada automáticamente (${String(cases.length)} casos · ${String(summary.nodeCoverage)} % de nodos)`;
      const data = cases.map((item, index) => {
        const terminal = item.observation.terminalNodeKey;
        const label = terminal ? (compiled.nodes[terminal]?.label ?? terminal) : 'sin desenlace';
        const doubles = item.candidate.workerDoubles;
        return {
          caseCode: caseCodeOf(generation, index, terminal),
          testName: `Generado: llega a «${label}»`.slice(0, 200),
          inputJson: (Object.keys(doubles).length
            ? { variables: item.candidate.variables, workerDoubles: doubles }
            : { variables: item.candidate.variables }) as Prisma.InputJsonValue,
          expectedResultJson: expectedResultOf(item.observation) as Prisma.InputJsonValue,
          tagsJson: ['AUTO', 'COBERTURA'] as Prisma.InputJsonValue,
          isActive: true,
        };
      });

      let suiteId: bigint;
      if (existing) {
        await tx.decisionTestCase.updateMany({
          where: { testSuiteId: existing.id },
          data: { isActive: false },
        });
        await tx.decisionTestSuite.update({
          where: { id: existing.id },
          data: { name, isBlocking: true },
        });
        await tx.decisionTestCase.createMany({
          data: data.map((item) => ({ ...item, testSuiteId: existing.id })),
        });
        suiteId = existing.id;
      } else {
        const created = await tx.decisionTestSuite.create({
          data: {
            artifactVersionId: versionId,
            suiteCode: AUTO_SUITE_CODE,
            name,
            suiteType: 'REGRESSION',
            isBlocking: true,
            cases: { create: data },
          },
        });
        suiteId = created.id;
      }
      await this.audit.append(
        {
          tenantId,
          eventType: 'TEST_SUITE_CREATED',
          aggregateType: 'TestSuite',
          aggregateId: suiteId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            suiteCode: AUTO_SUITE_CODE,
            cases: cases.length,
            blocking: true,
            generated: true,
            generation,
            nodeCoverage: summary.nodeCoverage,
            missingNodes: summary.missingNodes,
          },
        },
        tx,
      );
      return { id: suiteId, generation };
    });
  }
}
