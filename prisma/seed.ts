import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seedDemoArtifact } from './seed/demo-artifact';
import { ensureEnvironment, ensureReason, ensureVariable, TENANT_ID } from './seed/helpers';
import { reasonCodeCatalog } from './seed/reason-code-catalog.data';
import { variableCatalog } from './seed/variable-catalog.data';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to seed the database');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Variables referenced by the BNPL_CREDIT_DECISION demonstration graph. They are a
// small subset of the full production catalog seeded below, not a separate list.
const DEMO_VARIABLE_CODES = ['kyc_status', 'consent_active', 'age', 'fraud_signal', 'bureau_score', 'monthly_income', 'requested_amount'];

async function main(): Promise<void> {
  const [sandbox, test, prod] = await Promise.all([
    ensureEnvironment(prisma, 'SANDBOX', 'Sandbox', false),
    ensureEnvironment(prisma, 'TEST', 'Testing', false),
    ensureEnvironment(prisma, 'PROD', 'Production', true),
  ]);

  const seededVariables = await Promise.all(variableCatalog.map((seed) => ensureVariable(prisma, seed)));
  const variableByCode = Object.fromEntries(seededVariables.map((item) => [item.definition.variableCode, item]));

  const seededReasons = await Promise.all(reasonCodeCatalog.map((seed) => ensureReason(prisma, seed)));
  const reasonByCode = Object.fromEntries(seededReasons.map((item) => [item.reasonCode, item]));

  console.log(JSON.stringify({
    catalog: { variables: seededVariables.length, reasonCodes: seededReasons.length },
    environments: { sandboxId: sandbox.id.toString(), testId: test.id.toString(), prodId: prod.id.toString() },
  }, null, 2));

  const demoVariables = DEMO_VARIABLE_CODES.map((code) => variableByCode[code]);
  const demoSummary = await seedDemoArtifact(prisma, TENANT_ID, prod, demoVariables, reasonByCode);
  if (demoSummary) console.log(JSON.stringify(demoSummary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
