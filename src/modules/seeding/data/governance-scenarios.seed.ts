/**
 * Escenarios negativos de gobierno (§11).
 *
 * §11 pide sembrar casos de «ciclo detectado», «versión no disponible»,
 * «incompatibilidad de contrato» y «casos de QA». Los tres primeros son RECHAZOS: no se
 * pueden persistir como datos, porque el sistema precisamente impide crearlos. Lo que sí
 * se puede —y es lo útil— es dejar sembrado el ESCENARIO que los provoca, de modo que
 * cualquiera pueda comprobar el rechazo en dos clics y una prueba pueda ejercitarlo
 * contra los servicios reales.
 *
 * El cuarto, la corrida de QA, sí son datos: se archiva una con su contraejemplo mínimo
 * para que la pantalla del QA Lab no arranque vacía y el botón de «volver a ejecutar»
 * tenga algo que reproducir.
 */
import { Logger } from '@nestjs/common';
import { DeploymentStatus, VersionStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { GENERATOR_VERSION } from '../../qa-lab/seeded-random';
import { TENANT_ID, sha256 } from './helpers';

const logger = new Logger('SeedGovernanceScenarios');

/** Sube al cambiar el contenido sembrado, igual que los otros demos. */
const SCENARIOS_VERSION = '1.0.0';

export const CYCLE_PARENT_CODE = 'SCENARIO_CYCLE_PARENT';
export const CYCLE_CHILD_CODE = 'SCENARIO_CYCLE_CHILD';
export const UNCOMPILED_CODE = 'SCENARIO_UNCOMPILED_CHILD';

export interface GovernanceScenarioSummary {
  cycleParentVersionId: string;
  cycleChildVersionId: string;
  /**
   * Segunda versión del hijo, en DRAFT. Es desde AQUÍ desde donde se intentan las
   * referencias que deben rechazarse: solo un borrador es editable, así que un escenario
   * montado sobre una versión compilada fallaría por VERSION_IMMUTABLE y nunca llegaría a
   * ejercitar el ciclo ni la versión no disponible.
   */
  cycleChildDraftVersionId: string;
  uncompiledVersionId: string;
  qaRunId: string | null;
}

export async function seedGovernanceScenarios(
  prisma: PrismaClient,
): Promise<GovernanceScenarioSummary | undefined> {
  const already = await prisma.decisionArtifact.findUnique({
    where: { tenantId_artifactCode: { tenantId: TENANT_ID, artifactCode: CYCLE_PARENT_CODE } },
    select: { id: true },
  });
  if (already) {
    logger.log(`Escenarios de gobierno ya sembrados (${SCENARIOS_VERSION})`);
    const existing = await loadExisting(prisma);
    // Reconciliación, no sólo comprobación: una base sembrada por una versión
    // anterior tenía la versión del padre marcada como desplegada SIN despliegue
    // que la respaldara. Volver a ejecutar la siembra debe converger al estado
    // correcto en vez de dejar la incoherencia para siempre.
    if (existing) {
      await markDeployedToTest(prisma, BigInt(existing.cycleParentVersionId));
    }
    return existing;
  }

  // (a) Ciclo detectado: padre → hijo ya existe, así que crear hijo → padre se rechaza
  //     con CIRCULAR_ARTIFACT_REFERENCE. Ambos quedan compilados para que el rechazo sea
  //     por el ciclo y no por «hijo sin compilar».
  const parent = await createTrivialArtifact(prisma, {
    code: CYCLE_PARENT_CODE,
    name: 'Escenario · padre de un ciclo',
    description:
      'Referencia a SCENARIO_CYCLE_CHILD. Intentar que el hijo lo referencie de vuelta debe rechazarse con CIRCULAR_ARTIFACT_REFERENCE.',
    compiled: true,
  });
  const child = await createTrivialArtifact(prisma, {
    code: CYCLE_CHILD_CODE,
    name: 'Escenario · hijo de un ciclo',
    description:
      'Referenciado por SCENARIO_CYCLE_PARENT. Añadirle una referencia al padre cierra el ciclo.',
    compiled: true,
  });
  // Borrador del hijo: el banco de pruebas editable desde el que se intentan los rechazos.
  const childDraft = await prisma.decisionArtifactVersion.create({
    data: {
      artifactId: child.artifactId,
      versionNumber: 2,
      semanticVersion: '1.1.0',
      status: VersionStatus.DRAFT,
      changeSummary:
        'Borrador editable. Añadirle una referencia al padre debe rechazarse por ciclo; referenciar SCENARIO_UNCOMPILED_CHILD, por versión no compilada.',
      createdBy: 'seed.system',
    },
  });

  await prisma.decisionArtifactReference.create({
    data: {
      tenantId: TENANT_ID,
      parentArtifactVersionId: parent.versionId,
      nodeKey: 'LLAMAR_HIJO',
      childArtifactId: child.artifactId,
      childArtifactVersionId: child.versionId,
      inputMappingJson: [] as unknown as Prisma.InputJsonValue,
      outputMappingJson: [{ childOutputCode: 'outcome' }] as unknown as Prisma.InputJsonValue,
      createdBy: 'seed.system',
    },
  });

  // (b) Versión no disponible: un artefacto en DRAFT sin compilado con éxito.
  //     Referenciarlo se rechaza con CHILD_VERSION_NOT_COMPILED.
  const uncompiled = await createTrivialArtifact(prisma, {
    code: UNCOMPILED_CODE,
    name: 'Escenario · versión no disponible',
    description:
      'Permanece en DRAFT y sin compilado. Referenciarlo debe rechazarse con CHILD_VERSION_NOT_COMPILED.',
    compiled: false,
  });

  // (c) Incompatibilidad de contrato: una variable con un contrato estrecho y en uso por
  //     una versión desplegada. Estrecharlo más se rechaza con
  //     VARIABLE_CONTRACT_INCOMPATIBLE; ampliarlo se acepta como WIDENING.
  await seedIncompatibleContractScenario(prisma, parent.versionId);

  // (d) Corrida de QA archivada, con un contraejemplo mínimo reproducible.
  const qaRunId = await seedQaRun(prisma, parent.versionId);

  logger.log(`Escenarios de gobierno sembrados (${SCENARIOS_VERSION})`);
  return {
    cycleParentVersionId: parent.versionId.toString(),
    cycleChildVersionId: child.versionId.toString(),
    cycleChildDraftVersionId: childDraft.id.toString(),
    uncompiledVersionId: uncompiled.versionId.toString(),
    qaRunId,
  };
}

async function loadExisting(prisma: PrismaClient): Promise<GovernanceScenarioSummary | undefined> {
  const versionsOf = async (code: string) => {
    const artifact = await prisma.decisionArtifact.findUnique({
      where: { tenantId_artifactCode: { tenantId: TENANT_ID, artifactCode: code } },
      include: { versions: { orderBy: { versionNumber: 'asc' } } },
    });
    return artifact?.versions ?? [];
  };
  const [parentVersions, childVersions, uncompiledVersions] = await Promise.all([
    versionsOf(CYCLE_PARENT_CODE),
    versionsOf(CYCLE_CHILD_CODE),
    versionsOf(UNCOMPILED_CODE),
  ]);
  const parent = parentVersions[0]?.id;
  const child = childVersions[0]?.id;
  const childDraft = childVersions.find((version) => version.status === 'DRAFT')?.id;
  const uncompiled = uncompiledVersions[0]?.id;
  if (!parent || !child || !childDraft || !uncompiled) return undefined;
  const run = await prisma.qaGenerationRun.findFirst({
    where: { tenantId: TENANT_ID, artifactVersionId: parent },
    select: { id: true },
  });
  return {
    cycleParentVersionId: parent.toString(),
    cycleChildVersionId: child.toString(),
    cycleChildDraftVersionId: childDraft.toString(),
    uncompiledVersionId: uncompiled.toString(),
    qaRunId: run?.id.toString() ?? null,
  };
}

/** Artefacto mínimo START → END, suficiente para ser referenciado o rechazado. */
async function createTrivialArtifact(
  prisma: PrismaClient,
  options: { code: string; name: string; description: string; compiled: boolean },
) {
  const artifact = await prisma.decisionArtifact.create({
    data: {
      tenantId: TENANT_ID,
      artifactCode: options.code,
      artifactType: 'CREDIT_POLICY',
      name: options.name,
      description: options.description,
      ownerTeam: 'RISK_DECISIONING',
      businessPurpose: 'Escenario de gobierno sembrado para demostrar un rechazo del motor (§11).',
      riskDomain: 'CREDIT_ORIGINATION',
    },
  });
  const version = await prisma.decisionArtifactVersion.create({
    data: {
      artifactId: artifact.id,
      versionNumber: 1,
      semanticVersion: '1.0.0',
      status: options.compiled ? VersionStatus.COMPILED : VersionStatus.DRAFT,
      changeSummary: options.description,
      createdBy: 'seed.system',
    },
  });

  const nodes = [
    { key: 'START', type: 'START', label: 'Inicio', terminal: false, order: 1 },
    { key: 'FIN', type: 'END', label: 'Fin', terminal: true, order: 2 },
  ];
  const created = await prisma.decisionRuleNode.createManyAndReturn({
    data: nodes.map((node) => ({
      artifactVersionId: version.id,
      nodeKey: node.key,
      nodeType: node.type,
      label: node.label,
      configJson: node.type === 'END' ? { outcome: 'APROBADO' } : {},
      xPos: 0,
      yPos: 0,
      orderIndex: node.order,
      isTerminal: node.terminal,
    })),
    select: { id: true, nodeKey: true },
  });
  const byKey = new Map(created.map((row) => [row.nodeKey, row.id]));
  await prisma.decisionRuleEdge.create({
    data: {
      artifactVersionId: version.id,
      fromNodeId: byKey.get('START')!,
      toNodeId: byKey.get('FIN')!,
      edgeKey: 'E1',
      edgeType: 'SEQUENCE',
      priority: 1,
      isDefault: true,
    },
  });

  if (options.compiled) {
    const compiled = {
      runtimeSchemaVersion: '1.0',
      compilerVersion: 'atlas-seed-scenario-1.0.0',
      artifact: {
        id: artifact.id.toString(),
        tenantId: TENANT_ID.toString(),
        code: options.code,
        type: 'CREDIT_POLICY',
        name: options.name,
        riskDomain: 'CREDIT_ORIGINATION',
      },
      version: {
        id: version.id.toString(),
        number: 1,
        semanticVersion: '1.0.0',
        status: 'COMPILED',
      },
      variables: [],
      intermediates: [],
      outputContract: [],
      startNodeKey: 'START',
      nodes: Object.fromEntries(
        nodes.map((node) => [
          node.key,
          {
            key: node.key,
            type: node.type,
            label: node.label,
            config: node.type === 'END' ? { outcome: 'APROBADO' } : {},
            x: 0,
            y: 0,
            order: node.order,
            terminal: node.terminal,
            conditions: [],
            actions: [],
          },
        ]),
      ),
      edgesByNode: {
        START: [
          {
            key: 'E1',
            from: 'START',
            to: 'FIN',
            type: 'SEQUENCE',
            priority: 1,
            default: true,
            conditions: [],
          },
        ],
        FIN: [],
      },
      conditions: {},
      actions: {},
      totals: { nodes: 2, edges: 1, terminalPaths: 1 },
    };
    await prisma.decisionCompiledArtifact.create({
      data: {
        artifactVersionId: version.id,
        compilerVersion: compiled.compilerVersion,
        runtimeSchemaVersion: '1.0',
        compiledPayloadJson: compiled as unknown as Prisma.InputJsonValue,
        compiledChecksum: sha256(compiled),
        compileStatus: 'SUCCESS',
      },
    });
  }

  return { artifactId: artifact.id, versionId: version.id };
}

/**
 * Variable con contrato estrecho y en uso por una versión desplegada: estrecharlo más
 * debe rechazarse. Se marca la versión como DEPLOYED_TO_TEST para que el escenario sea
 * el real —el que bloquea el cambio—, no uno de laboratorio.
 */
async function seedIncompatibleContractScenario(
  prisma: PrismaClient,
  artifactVersionId: bigint,
): Promise<void> {
  const definition = await prisma.decisionVariableDefinition.create({
    data: {
      tenantId: TENANT_ID,
      variableCode: 'scenario_locked_score',
      canonicalName: 'Score bloqueado por contrato',
      businessDescription:
        'Variable en uso por una versión desplegada. Estrechar su contrato debe rechazarse con VARIABLE_CONTRACT_INCOMPATIBLE.',
      dataClassification: 'INTERNAL',
      ownerTeam: 'RISK_DECISIONING',
      sensitivityClass: 'INTERNAL',
      versions: {
        create: {
          versionNumber: 1,
          dataType: 'INTEGER',
          nullable: false,
          constraintsJson: { min: 0, max: 1000 },
          validationSchemaJson: { minimum: 0, maximum: 1000 },
          displayName: 'Score bloqueado por contrato',
          description: 'Rango 0-1000. Subir el mínimo o bajar el máximo rompe a quien ya lo envía.',
          expectedOrigin: 'REQUEST',
          exampleValidJson: 700,
          exampleInvalidJson: 1200,
        },
      },
    },
    include: { versions: true },
  });

  await prisma.decisionArtifactVariableDependency.create({
    data: {
      artifactVersionId,
      variableVersionId: definition.versions[0].id,
      usageType: 'INPUT',
      isRequired: true,
      fallbackPolicy: 'FAIL_CLOSED',
      dependencyPath: 'input.scenario_locked_score',
    },
  });
  await markDeployedToTest(prisma, artifactVersionId);
}

/**
 * Marca la versión como desplegada en TEST **y crea el despliegue que lo respalda**.
 *
 * Antes sólo se escribía el estado. Eso dejaba una versión que se anunciaba como
 * `DEPLOYED_TO_TEST` sin ninguna fila en `decision_deployment`: el listado la
 * mostraba desplegada y, al ejecutarla, el motor respondía «no active deployment»
 * —un estado que se contradecía a sí mismo y que costaba entender desde la UI—.
 * El escenario necesita que la versión esté REALMENTE en uso para que estrechar el
 * contrato de su variable se rechace; fingirlo con un estado suelto no lo lograba.
 *
 * Idempotente: si ya existe el despliegue activo, no crea otro.
 */
async function markDeployedToTest(prisma: PrismaClient, artifactVersionId: bigint): Promise<void> {
  await prisma.decisionArtifactVersion.update({
    where: { id: artifactVersionId },
    data: { status: VersionStatus.DEPLOYED_TO_TEST },
  });

  const environment = await prisma.decisionEnvironment.findFirst({
    where: { environmentType: 'TEST' },
  });
  const compiled = await prisma.decisionCompiledArtifact.findFirst({
    where: { artifactVersionId },
    orderBy: { id: 'desc' },
  });
  // Sin entorno o sin compilado no se puede desplegar de verdad. Se deja el estado
  // como estaba en vez de inventar una fila que mentiría de otra forma.
  if (!environment || !compiled) return;

  const existing = await prisma.decisionDeployment.findFirst({
    where: { artifactVersionId, environmentId: environment.id, isActive: true },
  });
  if (existing) return;

  await prisma.decisionDeployment.create({
    data: {
      artifactVersionId,
      compiledArtifactId: compiled.id,
      environmentId: environment.id,
      deploymentMode: 'FULL',
      deploymentStatus: DeploymentStatus.ACTIVE,
      effectiveFrom: new Date(),
      isActive: true,
      deployedBy: 'seed.governance-scenarios',
    },
  });
}

/** Corrida de QA archivada con un contraejemplo mínimo, reproducible por semilla. */
async function seedQaRun(prisma: PrismaClient, artifactVersionId: bigint): Promise<string> {
  const seed = 'seed-demo-qa';
  const run = await prisma.qaGenerationRun.create({
    data: {
      tenantId: TENANT_ID,
      artifactVersionId,
      environmentCode: 'SANDBOX',
      status: 'COMPLETED',
      seed,
      configJson: {
        caseCount: 200,
        validPercent: 60,
        boundaryPercent: 15,
        invalidPercent: 25,
        concurrency: 8,
      } as Prisma.InputJsonValue,
      generatorVersion: GENERATOR_VERSION,
      toolingJson: { generator: GENERATOR_VERSION, node: 'sembrado' } as Prisma.InputJsonValue,
      contractSnapshotJson: {
        inputs: [
          {
            code: 'scenario_locked_score',
            dataType: 'INTEGER',
            constraints: { min: 0, max: 1000 },
          },
        ],
        outputs: [],
        intermediates: [],
      } as Prisma.InputJsonValue,
      totalCases: 200,
      passedCases: 199,
      failedCases: 1,
      erroredCases: 0,
      durationMs: 1_450,
      summaryJson: { INPUT_CONTRACT_ENFORCED: 1 } as Prisma.InputJsonValue,
      finishedAt: new Date('2026-07-30T00:00:00Z'),
      createdBy: 'seed.system',
      counterexamples: {
        create: {
          tenantId: TENANT_ID,
          property: 'INPUT_CONTRACT_ENFORCED',
          shrunkInputJson: { scenario_locked_score: 1001 } as Prisma.InputJsonValue,
          originalInputJson: {
            scenario_locked_score: 1001,
            ruido_a: 'texto',
            ruido_b: 42,
          } as Prisma.InputJsonValue,
          observedJson: { accepted: true } as Prisma.InputJsonValue,
          failureCode: 'INVALID_INPUT_ACCEPTED',
          failureMessage:
            'Una entrada que incumple el contrato (1001 > max 1000) fue aceptada por el motor',
          replaySeed: seed,
          replayPath: '137/INVALID/scenario_locked_score: justo por encima del máximo',
        },
      },
    },
  });
  return run.id.toString();
}
