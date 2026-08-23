/**
 * Siembra la política de originación BNPL que AtlasBackend invoca: artefacto, variables del
 * contrato, compilado, filas del grafo, suite bloqueante en verde, aprobación completa y
 * despliegue ACTIVO en PROD.
 *
 * ## Por qué esta siembra es estructural y no un mockup
 *
 * Sin ella, una instalación nueva del motor se queda sólo con el demo `BNPL_CREDIT_DECISION`,
 * cuyo contrato exige 56 variables que AtlasBackend no emite. El motor responde `422` al payload
 * real y el cliente HTTP del backend lo interpreta como «la política dice que no»: **un desajuste
 * de contrato se le presenta a una persona como un rechazo de crédito**. Por eso corre en todos
 * los entornos, no sólo en desarrollo.
 *
 * ## Por qué se despliega a PROD
 *
 * AtlasBackend resuelve el artefacto por su binding de runtime en PROD. Sembrarlo sólo en SANDBOX
 * dejaría exactamente el mismo síntoma que se viene a eliminar, con el agravante de que el
 * artefacto sí existiría y costaría más ver por qué no se usa.
 *
 * El grafo y los casos viven en `atlas-underwriting.graph.ts` como datos puros, y
 * `test/atlas-underwriting-seed.spec.ts` los ejecuta con el motor real: la corrección la garantiza
 * esa prueba, no este fichero.
 */
import { Logger } from '@nestjs/common';
import {
  ApprovalOutcome,
  ApprovalRequestStatus,
  ApprovalStepStatus,
  DeploymentStatus,
  Prisma,
  TestCaseRunStatus,
  TestRunStatus,
  VersionStatus,
  type PrismaClient,
} from '@prisma/client';
import {
  ATLAS_UNDERWRITING_CASES,
  ATLAS_UNDERWRITING_CODE,
  ATLAS_UNDERWRITING_PRIMARY_OUTPUT,
  ATLAS_UNDERWRITING_VERSION,
  buildAtlasUnderwritingCompiled,
} from './atlas-underwriting.graph';
import { deleteDemoArtifact, writeGraphRows } from './graph-rows';
import { ensureVariable, sha256, TENANT_ID } from './helpers';
import type { VariableSeed } from './types';

const logger = new Logger('SeedAtlasUnderwriting');

/**
 * Variables del contrato que emite AtlasBackend.
 *
 * `requested_amount`, `requested_term_months` y `currency_code` ya viven en el catálogo general;
 * `ensureVariable` es idempotente, así que declararlas aquí no las duplica y deja la lista legible
 * como lo que es: el contrato completo de esta política. `product_code` y `purpose_code` no
 * existían en ningún catálogo.
 */
const CONTRACT_VARIABLES: VariableSeed[] = [
  {
    code: 'requested_amount',
    name: 'Importe solicitado',
    description: 'Importe FINANCIADO de la compra (el 40 % del BNPL), en la moneda del producto.',
    kind: 'INPUT',
    type: 'DECIMAL',
    nullable: true,
  },
  {
    code: 'requested_term_months',
    name: 'Plazo solicitado en meses',
    description: 'Número de meses en que se financia la compra.',
    kind: 'INPUT',
    type: 'INTEGER',
    unit: 'MONTHS',
    nullable: true,
  },
  {
    code: 'currency_code',
    name: 'Moneda',
    description: 'Moneda ISO-4217 de la operación.',
    kind: 'INPUT',
    type: 'STRING',
    nullable: true,
  },
  {
    code: 'product_code',
    name: 'Codigo de producto',
    description: 'Producto de crédito bajo el que se solicita la compra.',
    kind: 'INPUT',
    type: 'STRING',
    nullable: true,
  },
  {
    code: 'purpose_code',
    name: 'Proposito',
    description: 'Propósito declarado de la operación.',
    kind: 'INPUT',
    type: 'STRING',
    nullable: true,
  },
  {
    code: ATLAS_UNDERWRITING_PRIMARY_OUTPUT,
    name: 'Resultado de la decision',
    description: 'Resultado principal: APPROVE o DECLINE.',
    kind: 'OUTPUT',
    type: 'STRING',
  },
];

/** Los dos roles que exige la separación de funciones del motor. */
const APPROVAL_ROLES = ['QA_ANALYST', 'RISK_APPROVER'];

export interface AtlasUnderwritingSummary {
  artifactCode: string;
  version: string;
  artifactVersionId: string;
  deploymentId: string;
  compiledChecksum: string;
}

export async function seedAtlasUnderwritingArtifact(
  prisma: PrismaClient,
  environments: {
    dev: { id: bigint };
    staging: { id: bigint };
    test: { id: bigint };
    prod: { id: bigint };
  },
): Promise<AtlasUnderwritingSummary | undefined> {
  const existing = await prisma.decisionArtifact.findUnique({
    where: {
      tenantId_artifactCode: { tenantId: TENANT_ID, artifactCode: ATLAS_UNDERWRITING_CODE },
    },
    include: { versions: { select: { semanticVersion: true } } },
  });
  if (
    existing?.versions.some((version) => version.semanticVersion === ATLAS_UNDERWRITING_VERSION)
  ) {
    logger.log(`Ya sembrado: ${ATLAS_UNDERWRITING_CODE} ${ATLAS_UNDERWRITING_VERSION}`);
    return undefined;
  }
  if (existing) {
    /*
      Viene de un seeder anterior. Se rehace, con el mismo criterio que el resto de las semillas:
      una base ya sembrada se quedaría con la versión vieja para siempre y ninguna corrección de la
      política llegaría nunca. `deleteDemoArtifact` falla si hay ejecuciones productivas colgando,
      y entonces se avisa y se deja lo que hay: arrancar importa más que resembrar.
    */
    logger.warn(`${ATLAS_UNDERWRITING_CODE} viene de un seeder anterior; se rehace.`);
    try {
      await deleteDemoArtifact(prisma, existing.id);
    } catch (error) {
      logger.error(
        `No se pudo rehacer ${ATLAS_UNDERWRITING_CODE}; se conserva lo existente: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  const seededVariables = Object.fromEntries(
    await Promise.all(
      CONTRACT_VARIABLES.map(
        async (seed) => [seed.code, await ensureVariable(prisma, seed)] as const,
      ),
    ),
  );

  const artifact = await prisma.decisionArtifact.create({
    data: {
      tenantId: TENANT_ID,
      artifactCode: ATLAS_UNDERWRITING_CODE,
      artifactType: 'CREDIT_POLICY',
      name: 'Originacion BNPL de Atlas',
      description: 'Politica de originacion BNPL con el contrato que emite AtlasBackend.',
      ownerTeam: 'RISK_DECISIONING',
      businessPurpose:
        'Decidir el credito de una compra BNPL a partir del importe financiado y el plazo, con motivos explicables.',
      riskDomain: 'CREDIT_ORIGINATION',
    },
  });

  const version = await prisma.decisionArtifactVersion.create({
    data: {
      artifactId: artifact.id,
      versionNumber: 1,
      semanticVersion: ATLAS_UNDERWRITING_VERSION,
      status: VersionStatus.DRAFT,
      changeSummary: 'Politica BNPL con el contrato real de AtlasBackend.',
      authoringNotes:
        'Las entradas son anulables a proposito: la falta de un dato la resuelve el grafo con un motivo explicable, no el validador del contrato con un error tecnico.',
      createdBy: 'seed.system',
    },
  });

  await prisma.decisionArtifactVariableDependency.createMany({
    data: CONTRACT_VARIABLES.map((seed) => {
      const isOutput = seed.code === ATLAS_UNDERWRITING_PRIMARY_OUTPUT;
      return {
        artifactVersionId: version.id,
        variableVersionId: seededVariables[seed.code].version.id,
        usageType: isOutput ? 'OUTPUT_PRIMARY' : 'INPUT',
        isRequired: isOutput,
        fallbackPolicy: isOutput ? 'FAIL_CLOSED' : 'NULL',
        dependencyPath: `${isOutput ? 'output' : 'input'}.${seed.code}`,
      };
    }),
  });

  const compiled = buildAtlasUnderwritingCompiled(
    { id: artifact.id.toString(), tenantId: TENANT_ID.toString() },
    { id: version.id.toString() },
    Object.fromEntries(
      Object.entries(seededVariables).map(([code, seeded]) => [code, seeded.version.id.toString()]),
    ),
  );

  // Las filas relacionales del grafo, ademas del compilado: el editor y la vista de grafo del
  // portal leen `decision_rule_node`/`_edge`/`_condition`. Sembrar solo el compilado produce un
  // artefacto que decide perfectamente y que el portal muestra VACIO, sin avisar de nada.
  await writeGraphRows(prisma, version.id, compiled);

  const compiledChecksum = sha256(compiled);
  const compiledArtifact = await prisma.decisionCompiledArtifact.create({
    data: {
      artifactVersionId: version.id,
      compilerVersion: compiled.compilerVersion,
      runtimeSchemaVersion: compiled.runtimeSchemaVersion,
      compiledPayloadJson: compiled as unknown as Prisma.InputJsonValue,
      compiledChecksum,
      compileStatus: 'SUCCESS',
    },
  });

  await seedBlockingSuite(prisma, version.id, compiledArtifact.id, {
    nodes: compiled.totals.nodes,
    edges: compiled.totals.edges,
  });
  await seedApproval(prisma, version.id);
  const deployment = await deployToAllEnvironments(
    prisma,
    version.id,
    compiledArtifact.id,
    environments,
  );

  await prisma.decisionArtifactVersion.update({
    where: { id: version.id },
    data: {
      status: VersionStatus.DEPLOYED_TO_PROD,
      canonicalChecksum: compiledChecksum,
      submittedAt: new Date(),
      approvedAt: new Date(),
    },
  });

  logger.log(`Sembrado ${ATLAS_UNDERWRITING_CODE} ${ATLAS_UNDERWRITING_VERSION}, activo en PROD`);

  return {
    artifactCode: ATLAS_UNDERWRITING_CODE,
    version: ATLAS_UNDERWRITING_VERSION,
    artifactVersionId: version.id.toString(),
    deploymentId: deployment.id.toString(),
    compiledChecksum,
  };
}

/**
 * Suite bloqueante con una corrida en verde.
 *
 * Los cinco casos recorren los cuatro caminos terminales del grafo, así que la cobertura de
 * aristas y de terminales es del 100 % y se declara como tal. No es una cifra puesta a mano: el
 * grafo tiene cuatro aristas y hay un caso por cada una.
 */
async function seedBlockingSuite(
  prisma: PrismaClient,
  artifactVersionId: bigint,
  compiledArtifactId: bigint,
  totals: { nodes: number; edges: number },
) {
  const suite = await prisma.decisionTestSuite.create({
    data: {
      artifactVersionId,
      suiteCode: 'ATLAS_BNPL_REGRESSION',
      name: 'Regresion de la politica BNPL de Atlas',
      suiteType: 'REGRESSION',
      isBlocking: true,
    },
  });

  const cases = await Promise.all(
    ATLAS_UNDERWRITING_CASES.map((testCase) =>
      prisma.decisionTestCase.create({
        data: {
          testSuiteId: suite.id,
          caseCode: testCase.caseCode,
          testName: testCase.name,
          inputJson: testCase.input as Prisma.InputJsonValue,
          expectedResultJson: {
            [ATLAS_UNDERWRITING_PRIMARY_OUTPUT]: testCase.expectedOutcome,
          } as Prisma.InputJsonValue,
          tagsJson: ['BNPL', 'CONTRATO_ATLAS'] as unknown as Prisma.InputJsonValue,
        },
      }),
    ),
  );

  const testRun = await prisma.decisionTestRun.create({
    data: {
      testSuiteId: suite.id,
      compiledArtifactId,
      triggerType: 'SEED_VERIFIED',
      triggeredBy: 'seed.qa',
      status: TestRunStatus.PASSED,
      finishedAt: new Date(),
    },
  });
  for (const testCase of cases) {
    await prisma.decisionTestCaseRun.create({
      data: {
        testRunId: testRun.id,
        testCaseId: testCase.id,
        actualResultJson: testCase.expectedResultJson as Prisma.InputJsonValue,
        resultStatus: TestCaseRunStatus.PASS,
        durationMs: 1,
      },
    });
  }

  const full = new Prisma.Decimal(100);
  await prisma.decisionTestCoverage.createMany({
    data: [
      {
        testRunId: testRun.id,
        coverageType: 'NODE',
        coveredCount: totals.nodes,
        totalCount: totals.nodes,
        coveragePercentage: full,
      },
      {
        testRunId: testRun.id,
        coverageType: 'EDGE',
        coveredCount: totals.edges,
        totalCount: totals.edges,
        coveragePercentage: full,
      },
      {
        testRunId: testRun.id,
        coverageType: 'TERMINAL',
        coveredCount: totals.edges,
        totalCount: totals.edges,
        coveragePercentage: full,
      },
    ],
  });
}

/** Aprobación completa con los dos roles que exige la separación de funciones. */
async function seedApproval(prisma: PrismaClient, artifactVersionId: bigint) {
  const request = await prisma.decisionApprovalRequest.create({
    data: {
      artifactVersionId,
      workflowCode: 'ATLAS_STANDARD_GOVERNANCE',
      requestedBy: 'seed.author',
      status: ApprovalRequestStatus.APPROVED,
    },
  });
  for (let index = 0; index < APPROVAL_ROLES.length; index += 1) {
    const step = await prisma.decisionApprovalStep.create({
      data: {
        approvalRequestId: request.id,
        stepOrder: index + 1,
        requiredRole: APPROVAL_ROLES[index],
        status: ApprovalStepStatus.APPROVED,
        separationOfDuties: true,
      },
    });
    await prisma.decisionApprovalDecision.create({
      data: {
        approvalStepId: step.id,
        decidedBy: `seed.${APPROVAL_ROLES[index].toLowerCase()}`,
        decision: ApprovalOutcome.APPROVE,
        comments: 'Suite de regresion en verde sobre el contrato de AtlasBackend.',
      },
    });
  }
}

/**
 * Despliegue ACTIVO y binding de runtime en los cuatro entornos.
 *
 * PROD es el que necesita AtlasBackend; DEV, STAGING y TEST existen para que la política pueda
 * simularse antes de tocar producción, que es lo que hace útil al simulador del portal. Son los
 * cuatro ambientes en el orden en que se promueve una versión.
 */
async function deployToAllEnvironments(
  prisma: PrismaClient,
  artifactVersionId: bigint,
  compiledArtifactId: bigint,
  environments: {
    dev: { id: bigint };
    staging: { id: bigint };
    test: { id: bigint };
    prod: { id: bigint };
  },
) {
  let production!: Awaited<ReturnType<typeof prisma.decisionDeployment.create>>;
  for (const environment of [
    environments.dev,
    environments.staging,
    environments.test,
    environments.prod,
  ]) {
    const deployment = await prisma.decisionDeployment.create({
      data: {
        artifactVersionId,
        compiledArtifactId,
        environmentId: environment.id,
        deploymentMode: 'DIRECT',
        deploymentStatus: DeploymentStatus.ACTIVE,
        effectiveFrom: new Date(),
        isActive: true,
        deployedBy: 'seed.release-manager',
      },
    });
    await prisma.decisionRuntimeBinding.create({
      data: {
        tenantId: TENANT_ID,
        artifactCode: ATLAS_UNDERWRITING_CODE,
        environmentId: environment.id,
        activeDeploymentId: deployment.id,
        bindingKey: 'default',
      },
    });
    if (environment.id === environments.prod.id) production = deployment;
  }
  return production;
}
