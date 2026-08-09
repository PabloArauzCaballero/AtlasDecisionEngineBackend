/** Pure seed helpers keep canonical values/checksums independent from Nest providers and I/O. */
import { createHash } from 'node:crypto';
import type { PrismaClient, SensitivityClass, VariableLifecycleState } from '@prisma/client';
import type { ReasonSeed, VariableSeed } from './types';

/**
 * Tenant al que pertenece TODO lo que siembra este módulo.
 *
 * Era `1n` fijo, y `BOOTSTRAP_TENANT_ID` sólo lo honraba el sembrador de clientes de
 * integración. Con `BOOTSTRAP_TENANT_ID=7`, una instalación nueva terminaba con la API key
 * habilitada para el tenant 7 y el catálogo entero —variables, motivos, librerías, campos
 * calculados, categorías semánticas— en el 1: el único llamante registrado no veía nada, y
 * el motor rechazaba cualquier decisión por variable inexistente. Es el conjunto que sí
 * corre en producción, así que el desacuerdo se pagaba en la instalación real.
 *
 * `SEED_TENANT_ID` se acepta como sinónimo porque es el nombre que ya usaban los scripts
 * de desarrollo de `prisma/`. Dos nombres para el mismo tenant es como se llega a que
 * apunten a tenants distintos.
 */
export function resolveBootstrapTenantId(env: NodeJS.ProcessEnv = process.env): bigint {
  const raw = (env.BOOTSTRAP_TENANT_ID ?? env.SEED_TENANT_ID ?? '').trim();
  if (!raw) return 1n;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`El tenant de siembra ha de ser un entero positivo; se recibió '${raw}'`);
  }
  const tenantId = BigInt(raw);
  // El 0 pasa la expresión regular y no es un tenant: sembrar contra él deja el catálogo
  // en una fila que ninguna sesión reclama nunca.
  if (tenantId < 1n) {
    throw new Error(`El tenant de siembra ha de ser >= 1; se recibió '${raw}'`);
  }
  return tenantId;
}

// Se resuelve UNA vez al cargar el módulo: la siembra es un proceso de un disparo y el
// tenant no puede cambiar a mitad de corrida sin partir en dos lo que se está escribiendo.
const TENANT_ID = resolveBootstrapTenantId();

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function sha256(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export async function ensureEnvironment(
  prisma: PrismaClient,
  code: string,
  name: string,
  isProduction: boolean,
) {
  return prisma.decisionEnvironment.upsert({
    where: { code },
    update: { name, environmentType: code, isProduction, status: 'ACTIVE' },
    create: { code, name, environmentType: code, isProduction, status: 'ACTIVE' },
  });
}

export async function ensureVariable(prisma: PrismaClient, seed: VariableSeed) {
  const isOutput = seed.kind === 'OUTPUT';
  const ownerTeam = seed.owner ?? 'RISK_DECISIONING';
  // Taxonomía formal §1.1. `isSensitive` y `dataClassification` se mantienen como
  // proyecciones derivadas para no romper a los consumidores que ya las leen.
  const governance = {
    dataClassification: seed.sensitive ? 'CONFIDENTIAL' : 'INTERNAL',
    ownerTeam,
    isSensitive: seed.sensitive ?? false,
    isActive: true,
    sensitivityClass: (seed.sensitive ? 'PII' : 'INTERNAL') as SensitivityClass,
    lifecycleState: 'ACTIVE' as VariableLifecycleState,
    contractVersion: '1',
  };
  const definition = await prisma.decisionVariableDefinition.upsert({
    where: { tenantId_variableCode: { tenantId: TENANT_ID, variableCode: seed.code } },
    update: { canonicalName: seed.name, businessDescription: seed.description, ...governance },
    create: {
      tenantId: TENANT_ID,
      variableCode: seed.code,
      canonicalName: seed.name,
      businessDescription: seed.description,
      ...governance,
    },
  });

  // El catálogo del repositorio es la fuente de verdad de la versión 1: es la que crea y
  // posee el seeder (la API siempre crea versiones NUEVAS, nunca edita la 1). Antes esta
  // función salía antes de tocar nada si la fila ya existía, así que cualquier corrección
  // del catálogo no llegaba jamás a una base ya sembrada. Ese desfase es real y costó una
  // ejecución rota: `fraud_score` se declaró anulable en el catálogo —un rechazo temprano
  // en KYC nunca lo calcula— pero la fila seguía con `nullable = false` y toda decisión
  // declinada en KYC moría con REQUIRED_OUTPUT_MISSING.
  const contractMetadata = {
    displayName: seed.name,
    description: seed.description,
    dataType: seed.type,
    unitCode: seed.unit ?? null,
    nullable: seed.nullable ?? false,
    validationSchemaJson: seed.validation,
    constraintsJson: seed.validation ?? undefined,
    expectedOrigin: isOutput ? 'DERIVED' : (seed.source ?? 'REQUEST'),
    contractVersion: '1',
  };

  const current = await prisma.decisionVariableVersion.findUnique({
    where: {
      variableDefinitionId_versionNumber: {
        variableDefinitionId: definition.id,
        versionNumber: 1,
      },
    },
  });
  if (current) {
    const version = await prisma.decisionVariableVersion.update({
      where: { id: current.id },
      data: contractMetadata,
    });
    return { definition, version };
  }

  // OUTPUT (target/scoring) variables are produced by the engine, so their authoritative
  // "source" is the decision output envelope, not an inbound request field. INPUT variables
  // keep their inbound source-system descriptor (REQUEST_PAYLOAD unless overridden).
  const source = isOutput
    ? {
        sourceSystemCode: 'DECISION_ENGINE',
        sourcePath: '$.output',
        sourceField: seed.code,
        freshnessSlaSeconds: 0,
        precedence: 1,
        isAuthoritative: true,
      }
    : {
        sourceSystemCode: seed.source ?? 'REQUEST_PAYLOAD',
        sourcePath: seed.source ? `$.${seed.source.toLowerCase()}` : '$.variables',
        sourceField: seed.code,
        freshnessSlaSeconds: 60,
        precedence: 1,
        isAuthoritative: true,
      };

  const version = await prisma.decisionVariableVersion.create({
    data: {
      variableDefinitionId: definition.id,
      versionNumber: 1,
      ...contractMetadata,
      sources: { create: source },
    },
  });
  return { definition, version };
}

export async function ensureReason(prisma: PrismaClient, seed: ReasonSeed) {
  return prisma.decisionReasonCode.upsert({
    where: { tenantId_reasonCode: { tenantId: TENANT_ID, reasonCode: seed.code } },
    update: {
      category: seed.category,
      publicMessage: seed.publicMessage,
      internalMessage: seed.internalMessage,
      severity: seed.adverseAction ? 'HIGH' : 'INFO',
      isAdverseAction: seed.adverseAction,
      isActive: true,
    },
    create: {
      tenantId: TENANT_ID,
      reasonCode: seed.code,
      category: seed.category,
      publicMessage: seed.publicMessage,
      internalMessage: seed.internalMessage,
      severity: seed.adverseAction ? 'HIGH' : 'INFO',
      isAdverseAction: seed.adverseAction,
      isActive: true,
    },
  });
}

export { TENANT_ID };
