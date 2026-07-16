import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { ReasonSeed, VariableSeed } from './types';

const TENANT_ID = 1n;

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
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export async function ensureEnvironment(prisma: PrismaClient, code: string, name: string, isProduction: boolean) {
  return prisma.decisionEnvironment.upsert({
    where: { code },
    update: { name, environmentType: code, isProduction, status: 'ACTIVE' },
    create: { code, name, environmentType: code, isProduction, status: 'ACTIVE' },
  });
}

export async function ensureVariable(prisma: PrismaClient, seed: VariableSeed) {
  const definition = await prisma.decisionVariableDefinition.upsert({
    where: { tenantId_variableCode: { tenantId: TENANT_ID, variableCode: seed.code } },
    update: {
      canonicalName: seed.name,
      businessDescription: seed.description,
      dataClassification: seed.sensitive ? 'CONFIDENTIAL' : 'INTERNAL',
      ownerTeam: 'RISK_DECISIONING',
      isSensitive: seed.sensitive ?? false,
      isActive: true,
    },
    create: {
      tenantId: TENANT_ID,
      variableCode: seed.code,
      canonicalName: seed.name,
      businessDescription: seed.description,
      dataClassification: seed.sensitive ? 'CONFIDENTIAL' : 'INTERNAL',
      ownerTeam: 'RISK_DECISIONING',
      isSensitive: seed.sensitive ?? false,
      isActive: true,
    },
  });

  const current = await prisma.decisionVariableVersion.findUnique({
    where: {
      variableDefinitionId_versionNumber: {
        variableDefinitionId: definition.id,
        versionNumber: 1,
      },
    },
  });
  if (current) return { definition, version: current };

  const version = await prisma.decisionVariableVersion.create({
    data: {
      variableDefinitionId: definition.id,
      versionNumber: 1,
      dataType: seed.type,
      nullable: false,
      validationSchemaJson: seed.validation,
      sources: {
        create: {
          sourceSystemCode: 'REQUEST_PAYLOAD',
          sourcePath: '$.variables',
          sourceField: seed.code,
          freshnessSlaSeconds: 60,
          precedence: 1,
          isAuthoritative: true,
        },
      },
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
