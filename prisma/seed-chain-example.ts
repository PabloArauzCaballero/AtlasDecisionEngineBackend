/**
 * Siembra un EJEMPLO DE ENCADENAMIENTO visible: un algoritmo "padre"
 * (CREDITO_CON_SUBCHEQUEO) cuyo nodo Resultado está en modo REFERENCE y apunta a un
 * algoritmo "hijo" (SUBCHECK_FRAUD). Así, en el Editor de Grafo, al abrir el padre y
 * hacer clic en ese nodo, aparece "Abrir algoritmo" que navega al hijo.
 *
 * Idempotente: si el padre ya existe, no hace nada. No toca el demo ni el catálogo.
 * Uso: npx ts-node --transpile-only prisma/seed-chain-example.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });
const TENANT = BigInt(process.env.SEED_TENANT_ID ?? '1');
const PARENT = 'CREDITO_CON_SUBCHEQUEO';
const CHILD = 'SUBCHECK_FRAUD';

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
    data: { artifactId, versionNumber: 1, semanticVersion: '1.0.0', changeSummary: summary, createdBy: 'seed.example' },
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
    data: { artifactVersionId: versionId, nodeKey, nodeType, label, configJson: config as Prisma.InputJsonValue, xPos: x, yPos: 42, orderIndex: x, isTerminal },
  });
}

async function edge(versionId: bigint, fromId: bigint, toId: bigint, key: string) {
  return prisma.decisionRuleEdge.create({
    data: { artifactVersionId: versionId, fromNodeId: fromId, toNodeId: toId, edgeKey: key, edgeType: 'DEFAULT', priority: 1, isDefault: true },
  });
}

async function main() {
  const exists = await prisma.decisionArtifact.findUnique({
    where: { tenantId_artifactCode: { tenantId: TENANT, artifactCode: PARENT } },
  });
  if (exists) {
    console.log('= El ejemplo encadenado ya existe, nada que hacer.');
    return;
  }

  // Hijo: START -> RESULT
  const childArt = await makeArtifact(CHILD, 'Sub-chequeo de fraude', 'Sub-algoritmo que evalúa señales de fraude y devuelve una bandera.');
  const childVer = await makeVersion(childArt.id, 'Sub-algoritmo de ejemplo.');
  const cStart = await node(childVer.id, 'START_C', 'START', 'Inicio', 12, { description: 'Recibe los datos de la transacción para el sub-chequeo.' });
  const cResult = await node(childVer.id, 'RESULT_C', 'RESULT', 'Devolver bandera de fraude', 55, {
    mode: 'MAPPING',
    assignments: [{ outputCode: 'fraud_flag', source: 'LITERAL', value: false }],
    description: 'Devuelve fraud_flag = true/false según las señales evaluadas.',
  }, true);
  await edge(childVer.id, cStart.id, cResult.id, 'E_C');

  // Padre: START -> RESULT(REFERENCE -> hijo)
  const parentArt = await makeArtifact(PARENT, 'Crédito con sub-chequeo (ejemplo encadenado)', 'Ejemplo: un algoritmo que ejecuta otro (sub-chequeo de fraude) dentro de su flujo.');
  const parentVer = await makeVersion(parentArt.id, 'Ejemplo de encadenamiento.');
  const pStart = await node(parentVer.id, 'START_P', 'START', 'Inicio', 12, { description: 'Recibe la solicitud de crédito.' });
  const pRef = await node(parentVer.id, 'REF_1', 'RESULT', 'Ejecutar sub-chequeo de fraude', 55, {
    mode: 'REFERENCE',
    description: 'Ejecuta el algoritmo "Sub-chequeo de fraude" (otro algoritmo) y usa su resultado. Haz clic en "Abrir algoritmo" para verlo.',
  }, true);
  await edge(parentVer.id, pStart.id, pRef.id, 'E_P');

  await prisma.decisionArtifactReference.create({
    data: {
      tenantId: TENANT,
      parentArtifactVersionId: parentVer.id,
      nodeKey: 'REF_1',
      childArtifactId: childArt.id,
      childArtifactVersionId: childVer.id,
      inputMappingJson: [{ childVariableCode: 'monto', source: 'VARIABLE', path: 'monto' }],
      outputMappingJson: [{ outputCode: 'fraude', childOutputCode: 'fraud_flag' }],
      onErrorPolicy: 'FAIL',
      createdBy: 'seed.example',
    },
  });

  console.log(`✓ Ejemplo encadenado creado: ${PARENT} (v${parentVer.id}) → ${CHILD} (v${childVer.id}).`);
  console.log(`  Abre "${PARENT}" en el Editor de Grafo, clic en el nodo "Ejecutar sub-chequeo de fraude" → "Abrir algoritmo".`);
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(() => prisma.$disconnect());
