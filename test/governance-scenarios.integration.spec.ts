import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/common/audit/audit.service';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { NestedTreeService } from '../src/modules/nested-trees/nested-tree.service';
import { VariableContractService } from '../src/modules/variables/variable-contract.service';
import {
  CYCLE_CHILD_CODE,
  CYCLE_PARENT_CODE,
  UNCOMPILED_CODE,
  seedGovernanceScenarios,
} from '../src/modules/seeding/data/governance-scenarios.seed';

/**
 * §11 exige sembrar escenarios de «ciclo detectado», «versión no disponible»,
 * «incompatibilidad de contrato» y «casos de QA».
 *
 * Los tres primeros son RECHAZOS, así que un seeder no puede persistirlos: lo que siembra
 * es el escenario que los provoca. Esta prueba es la que demuestra que el escenario
 * sembrado provoca de verdad el rechazo esperado — sin ella, serían tres artefactos
 * sueltos sin ningún valor demostrativo.
 *
 * Se ejecuta contra la base real porque es donde viven las restricciones (unicidad,
 * claves foráneas, RLS) que participan en el rechazo.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('escenarios negativos de gobierno sembrados', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
  const config = new ConfigService({
    NESTED_TREE_MAX_DEPTH: 5,
    AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
  });
  const principal = {
    id: 'test.analyst',
    requestId: 'scenario-check',
    roles: ['RISK_ANALYST'],
  } as never;

  let nestedTrees: NestedTreeService;
  let contracts: VariableContractService;
  let scenario: Awaited<ReturnType<typeof seedGovernanceScenarios>>;

  beforeAll(async () => {
    await prisma.$connect();
    scenario = await seedGovernanceScenarios(prisma);
    const audit = new AuditService(prisma as unknown as PrismaService, new HashService(config));
    nestedTrees = new NestedTreeService(
      prisma as unknown as PrismaService,
      audit,
      config,
      new MetricsService(),
    );
    contracts = new VariableContractService(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sembró los tres artefactos del escenario', async () => {
    const codes = await prisma.decisionArtifact.findMany({
      where: { artifactCode: { in: [CYCLE_PARENT_CODE, CYCLE_CHILD_CODE, UNCOMPILED_CODE] } },
      select: { artifactCode: true },
    });
    expect(codes.map((row) => row.artifactCode).sort()).toEqual(
      [CYCLE_CHILD_CODE, CYCLE_PARENT_CODE, UNCOMPILED_CODE].sort(),
    );
  });

  it('ciclo detectado: el hijo no puede referenciar de vuelta al padre', async () => {
    const parent = await artifactOf(CYCLE_PARENT_CODE);
    await expect(
      nestedTrees.create(
        1n,
        BigInt(scenario!.cycleChildDraftVersionId),
        {
          nodeKey: 'VUELTA_AL_PADRE',
          childArtifactId: parent.id.toString(),
          childArtifactVersionId: scenario!.cycleParentVersionId,
          inputMapping: [],
          outputMapping: [{ childOutputCode: 'outcome' }],
        } as never,
        principal,
      ),
    ).rejects.toMatchObject({ code: 'CIRCULAR_ARTIFACT_REFERENCE' });
  });

  it('versión no disponible: no se puede referenciar una versión sin compilar', async () => {
    const uncompiled = await artifactOf(UNCOMPILED_CODE);
    await expect(
      nestedTrees.create(
        1n,
        BigInt(scenario!.cycleChildDraftVersionId),
        {
          nodeKey: 'LLAMAR_SIN_COMPILAR',
          childArtifactId: uncompiled.id.toString(),
          childArtifactVersionId: scenario!.uncompiledVersionId,
          inputMapping: [],
          outputMapping: [{ childOutputCode: 'outcome' }],
        } as never,
        principal,
      ),
    ).rejects.toMatchObject({ code: 'CHILD_VERSION_NOT_COMPILED' });
  });

  it('incompatibilidad de contrato: estrechar el rango de una variable desplegada se rechaza', async () => {
    const definition = await prisma.decisionVariableDefinition.findFirstOrThrow({
      where: { tenantId: 1n, variableCode: 'scenario_locked_score' },
    });
    await expect(
      contracts.assertSafeToVersion(1n, definition.id, {
        dataType: 'INTEGER',
        nullable: false,
        // El rango pasa de 0-1000 a 500-1000: un 300 que hoy es válido dejaría de serlo.
        constraints: { min: 500, max: 1000 },
        sources: [],
        validationRules: [],
      } as never),
    ).rejects.toMatchObject({ code: 'VARIABLE_CONTRACT_INCOMPATIBLE' });
  });

  it('ampliar el mismo contrato sí se acepta, y se marca como WIDENING', async () => {
    const definition = await prisma.decisionVariableDefinition.findFirstOrThrow({
      where: { tenantId: 1n, variableCode: 'scenario_locked_score' },
    });
    const report = await contracts.assertSafeToVersion(1n, definition.id, {
      dataType: 'INTEGER',
      nullable: false,
      constraints: { min: 0, max: 2000 },
      sources: [],
      validationRules: [],
    } as never);
    expect(report.level).toBe('WIDENING');
    expect(report.changes.map((change) => change.code)).toContain('MAX_RELAXED');
  });

  it('caso de QA: hay una corrida archivada con su contraejemplo mínimo reproducible', async () => {
    const run = await prisma.qaGenerationRun.findFirstOrThrow({
      where: { tenantId: 1n, id: BigInt(scenario!.qaRunId!) },
      include: { counterexamples: true },
    });
    expect(run.seed).toBeTruthy();
    expect(run.failedCases).toBe(1);
    const [counterexample] = run.counterexamples;
    expect(counterexample.property).toBe('INPUT_CONTRACT_ENFORCED');
    // El contraejemplo archivado es el REDUCIDO: sin el ruido de la entrada original.
    expect(counterexample.shrunkInputJson).toEqual({ scenario_locked_score: 1001 });
    expect(Object.keys(counterexample.originalInputJson as object).length).toBeGreaterThan(1);
    expect(counterexample.replaySeed).toBe(run.seed);
  });

  it('la siembra es idempotente: repetirla no duplica nada', async () => {
    const before = await prisma.decisionArtifact.count({
      where: { artifactCode: { in: [CYCLE_PARENT_CODE, CYCLE_CHILD_CODE, UNCOMPILED_CODE] } },
    });
    await seedGovernanceScenarios(prisma);
    const after = await prisma.decisionArtifact.count({
      where: { artifactCode: { in: [CYCLE_PARENT_CODE, CYCLE_CHILD_CODE, UNCOMPILED_CODE] } },
    });
    expect(after).toBe(before);
  });

  async function artifactOf(code: string) {
    return prisma.decisionArtifact.findFirstOrThrow({
      where: { tenantId: 1n, artifactCode: code },
    });
  }
});
