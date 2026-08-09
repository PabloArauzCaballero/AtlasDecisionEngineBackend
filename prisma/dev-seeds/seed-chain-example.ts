/**
 * Siembra un EJEMPLO DE ENCADENAMIENTO válido y compilable: un algoritmo "padre"
 * (CREDITO_CON_SUBCHEQUEO) cuyo nodo Resultado está en modo REFERENCE y ejecuta un
 * algoritmo "hijo" (SUBCHECK_FRAUD), tomando su salida como propia. Así, en el Editor
 * de Grafo, al abrir el padre y hacer clic en ese nodo aparece "Abrir algoritmo".
 *
 * A diferencia de la versión anterior, ahora ambos algoritmos DECLARAN sus variables
 * (entrada y salida) reutilizando el catálogo real, y el nodo de referencia trae su
 * `outputAssignments`, de modo que las variables cargan en el editor y la versión
 * pasa validación/compilación (ya no falla con REFERENCE_ASSIGNMENTS_EMPTY).
 *
 * Re-ejecutable: si el ejemplo ya existe lo borra y lo vuelve a crear.
 * Uso: npx ts-node --transpile-only prisma/dev-seeds/seed-chain-example.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { resolveBootstrapTenantId } from '../../src/modules/seeding/data/helpers';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});
// Misma resolución que la siembra de verdad (`BOOTSTRAP_TENANT_ID`, con `SEED_TENANT_ID`
// como sinónimo). Este script se apoya en el catálogo sembrado: si lo lee de otra variable,
// escribe en un tenant cuyas variables están en otro y el ejemplo no compila.
const TENANT = resolveBootstrapTenantId();
const PARENT = 'CREDITO_CON_SUBCHEQUEO';
const CHILD = 'SUBCHECK_FRAUD';

// Variables del catálogo real que reutiliza el ejemplo (se resuelven por código).
const AMOUNT = 'atlas_transaction_amount'; // NUMBER — entrada compartida padre/hijo
const FRAUD_SCORE = 'atlas_fraud_score'; // NUMBER — entrada del hijo
const FRAUD_SIGNAL = 'fraud_signal'; // BOOLEAN — salida (única) de ambos

/** Resuelve el id de la última versión de una variable de catálogo por su código. */
async function latestVar(code: string): Promise<bigint> {
  const definition = await prisma.decisionVariableDefinition.findUnique({
    where: { tenantId_variableCode: { tenantId: TENANT, variableCode: code } },
    include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  });
  const version = definition?.versions[0];
  if (!version) throw new Error(`Variable de catálogo no encontrada: ${code}`);
  return version.id;
}

async function makeArtifact(code: string, name: string, purpose: string) {
  return prisma.decisionArtifact.create({
    data: {
      tenantId: TENANT,
      artifactCode: code,
      artifactType: 'CREDIT_POLICY',
      name,
      description: purpose,
      ownerTeam: 'RISK_DECISIONING',
      businessPurpose: purpose,
      riskDomain: 'CREDIT_ORIGINATION',
    },
  });
}

async function makeVersion(artifactId: bigint, summary: string) {
  return prisma.decisionArtifactVersion.create({
    data: {
      artifactId,
      versionNumber: 1,
      semanticVersion: '1.0.0',
      changeSummary: summary,
      createdBy: 'seed.example',
    },
  });
}

/** Declara una dependencia de variable (entrada u salida) para una versión de artefacto. */
async function dep(versionId: bigint, variableVersionId: bigint, usageType: string, code: string) {
  const isOutput = usageType.startsWith('OUTPUT');
  return prisma.decisionArtifactVariableDependency.create({
    data: {
      artifactVersionId: versionId,
      variableVersionId,
      usageType,
      isRequired: true,
      fallbackPolicy: 'FAIL_CLOSED',
      dependencyPath: `${isOutput ? 'output' : 'input'}.${code}`,
    },
  });
}

async function node(
  versionId: bigint,
  nodeKey: string,
  nodeType: string,
  label: string,
  x: number,
  config: Record<string, unknown>,
  isTerminal = false,
) {
  return prisma.decisionRuleNode.create({
    data: {
      artifactVersionId: versionId,
      nodeKey,
      nodeType,
      label,
      configJson: config as Prisma.InputJsonValue,
      xPos: x,
      yPos: 42,
      orderIndex: x,
      isTerminal,
    },
  });
}

async function edge(versionId: bigint, fromId: bigint, toId: bigint, key: string) {
  return prisma.decisionRuleEdge.create({
    data: {
      artifactVersionId: versionId,
      fromNodeId: fromId,
      toNodeId: toId,
      edgeKey: key,
      edgeType: 'DEFAULT',
      priority: 1,
      isDefault: true,
    },
  });
}

/** Borra el ejemplo previo (padre e hijo) para que la siembra sea re-ejecutable. */
async function removeExisting() {
  for (const code of [PARENT, CHILD]) {
    const artifact = await prisma.decisionArtifact.findUnique({
      where: { tenantId_artifactCode: { tenantId: TENANT, artifactCode: code } },
      include: { versions: true },
    });
    if (!artifact) continue;
    for (const version of artifact.versions) {
      await prisma.decisionArtifactReference.deleteMany({
        where: { parentArtifactVersionId: version.id },
      });
    }
    await prisma.decisionArtifact.delete({ where: { id: artifact.id } });
    console.log(`= Ejemplo previo borrado: ${code}.`);
  }
}

async function main() {
  await removeExisting();

  const amountVar = await latestVar(AMOUNT);
  const fraudScoreVar = await latestVar(FRAUD_SCORE);
  const fraudSignalVar = await latestVar(FRAUD_SIGNAL);

  // Hijo: START -> RESULT(MAPPING) — evalúa señales y devuelve fraud_signal.
  const childArt = await makeArtifact(
    CHILD,
    'Sub-chequeo de fraude',
    'Sub-algoritmo que evalúa señales de fraude y devuelve una única bandera fraud_signal.',
  );
  const childVer = await makeVersion(childArt.id, 'Sub-algoritmo de ejemplo.');
  await dep(childVer.id, amountVar, 'INPUT', AMOUNT);
  await dep(childVer.id, fraudScoreVar, 'INPUT', FRAUD_SCORE);
  await dep(childVer.id, fraudSignalVar, 'OUTPUT_PRIMARY', FRAUD_SIGNAL);
  const cStart = await node(childVer.id, 'START_C', 'START', 'Inicio', 12, {
    description: 'Recibe el monto de la transacción y el score de fraude.',
  });
  const cResult = await node(
    childVer.id,
    'RESULT_C',
    'RESULT',
    'Devolver bandera de fraude',
    55,
    {
      mode: 'MAPPING',
      assignments: [{ outputCode: FRAUD_SIGNAL, source: 'LITERAL', value: false }],
      description:
        'Devuelve fraud_signal = true/false según las señales evaluadas. Es la única salida del sub-árbol.',
    },
    true,
  );
  await edge(childVer.id, cStart.id, cResult.id, 'E_C');

  // Padre: START -> RESULT(REFERENCE -> hijo). Su única salida es fraud_signal, tomada del hijo.
  const parentArt = await makeArtifact(
    PARENT,
    'Crédito con sub-chequeo (ejemplo encadenado)',
    'Ejemplo: un algoritmo que ejecuta otro (sub-chequeo de fraude) dentro de su flujo y usa su resultado.',
  );
  const parentVer = await makeVersion(parentArt.id, 'Ejemplo de encadenamiento.');
  await dep(parentVer.id, amountVar, 'INPUT', AMOUNT);
  await dep(parentVer.id, fraudSignalVar, 'OUTPUT_PRIMARY', FRAUD_SIGNAL);
  const pStart = await node(parentVer.id, 'START_P', 'START', 'Inicio', 12, {
    description: 'Recibe el monto de la solicitud de crédito.',
  });
  const pRef = await node(
    parentVer.id,
    'REF_1',
    'RESULT',
    'Ejecutar sub-chequeo de fraude',
    55,
    {
      mode: 'REFERENCE',
      outputAssignments: [{ outputCode: FRAUD_SIGNAL, childOutputCode: FRAUD_SIGNAL }],
      description:
        'Ejecuta el algoritmo "Sub-chequeo de fraude" (otro algoritmo) y adopta su fraud_signal como salida propia. Haz clic en "Abrir algoritmo" para verlo.',
    },
    true,
  );
  await edge(parentVer.id, pStart.id, pRef.id, 'E_P');

  await prisma.decisionArtifactReference.create({
    data: {
      tenantId: TENANT,
      parentArtifactVersionId: parentVer.id,
      nodeKey: 'REF_1',
      childArtifactId: childArt.id,
      childArtifactVersionId: childVer.id,
      inputMappingJson: [{ childVariableCode: AMOUNT, source: 'VARIABLE', path: AMOUNT }],
      outputMappingJson: [{ outputCode: FRAUD_SIGNAL, childOutputCode: FRAUD_SIGNAL }],
      onErrorPolicy: 'FAIL',
      createdBy: 'seed.example',
    },
  });

  console.log(
    `✓ Ejemplo encadenado creado: ${PARENT} (v${parentVer.id}) → ${CHILD} (v${childVer.id}).`,
  );
  console.log(
    `  Abre "${PARENT}" en el Editor de Grafo, clic en el nodo "Ejecutar sub-chequeo de fraude" → "Abrir algoritmo".`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
