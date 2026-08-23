import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
// A plain constant array, not a Nest provider, so importing it keeps the seed's
// no-framework boundary intact while pinning the roles to the same source of truth the
// guard and mapper use.
import {
  PlatformRole,
  PLATFORM_ROLES,
  RUNTIME_DECISION_ROLE,
} from '../../../common/security/platform-roles';
import { TENANT_ID } from './helpers';

/**
 * Identidades aprobadoras separadas, una por paso del flujo de gobierno.
 *
 * ## El problema que resuelven
 *
 * Los pasos de aprobación llevan `separationOfDuties`: quien envía una versión a revisión no puede
 * aprobarla. Es el control correcto —y el que impide que una sola persona publique una política de
 * crédito sin que nadie más la mire—. Pero con una única credencial de gestión
 * (`bootstrap-management`, que además lleva TODOS los roles) el flujo queda sin salida: el mismo
 * principal que envía es el único que existe para aprobar.
 *
 * ## Por qué esto y no relajar el control
 *
 * Relajar `separationOfDuties` en desarrollo haría que el entorno donde se prueba el gobierno sea
 * justamente el que no lo tiene: los flujos se validarían contra un comportamiento que producción no
 * comparte, y el primer despliegue real fallaría por un control que aquí nunca se ejercitó.
 *
 * Con credenciales distintas el control sigue INTACTO —sigue exigiendo principales diferentes— y
 * además cada una lleva SOLO el rol de su paso: la de QA no puede firmar por riesgo. Un entorno
 * local operable no tiene por qué ser un entorno sin controles.
 *
 * Cada cliente existe solo si su variable está definida. Sin ellas, la instalación queda exactamente
 * como estaba.
 */
const APPROVER_CLIENTS: ReadonlyArray<{
  clientKey: string;
  displayName: string;
  envVar: string;
  role: PlatformRole;
}> = [
  {
    clientKey: 'approver-qa',
    displayName: 'Aprobador de calidad',
    envVar: 'APPROVER_QA_API_KEY',
    role: PlatformRole.QA_ANALYST,
  },
  {
    clientKey: 'approver-risk',
    displayName: 'Aprobador de riesgo',
    envVar: 'APPROVER_RISK_API_KEY',
    role: PlatformRole.RISK_APPROVER,
  },
  {
    clientKey: 'approver-compliance',
    displayName: 'Aprobador de cumplimiento',
    envVar: 'APPROVER_COMPLIANCE_API_KEY',
    role: PlatformRole.COMPLIANCE,
  },
  /*
   * Quien PUBLICA no es quien escribe ni quien aprueba.
   *
   * El despliegue aplica su propia separación de funciones —«el autor de la versión no puede
   * desplegarla él solo»— y además exige `PLATFORM_ADMIN`. Sin esta credencial, una versión ya
   * aprobada por los tres pasos se queda sin poder publicarse en una instalación de un solo
   * operador: el único principal con el rol es justamente el que la escribió.
   *
   * Es el mismo reparto que en cualquier equipo de crédito: quien redacta la política, quienes la
   * revisan y quien la pone en producción son cuatro personas distintas.
   */
  {
    clientKey: 'release-manager',
    displayName: 'Responsable de publicación',
    envVar: 'RELEASE_MANAGER_API_KEY',
    role: PlatformRole.PLATFORM_ADMIN,
  },
];

export interface BootstrapClientSummary {
  clientKey: string;
  audience: string;
  roles: string[];
  tenantIds: string[];
}

/** Mirrors HashService.sha256 for plain strings; the seed must not import Nest providers. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  const parsed = (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}

/**
 * Registers the bootstrap API clients declared through environment variables.
 *
 * Identity for API key callers lives in the database, so without this step a fresh
 * API-key installation has no registered callers. Roles come from explicit operator
 * configuration rather than request headers.
 *
 * Idempotent by client key, so running the seed twice converges on the same state.
 */
export async function seedIntegrationClients(
  prisma: PrismaClient,
): Promise<BootstrapClientSummary[]> {
  // El MISMO tenant que el resto del catálogo (`helpers.ts`). Esta función leía
  // `BOOTSTRAP_TENANT_ID` por su cuenta mientras todo lo demás iba fijo al 1, así que la
  // variable movía al llamante y dejaba atrás el catálogo que ese llamante necesita.
  const tenantId = TENANT_ID;
  const definitions = [
    {
      clientKey: 'bootstrap-management',
      displayName: 'Bootstrap management client',
      audience: 'management',
      secret: process.env.MANAGEMENT_API_KEY,
      // PLATFORM_ADMIN as a wildcard is only honoured on signed tokens, so the
      // bootstrap API key is granted every enforced management role explicitly instead —
      // otherwise a fresh install could not administer anything before the IdP is wired up.
      roles: parseList(process.env.BOOTSTRAP_MANAGEMENT_ROLES, [...PLATFORM_ROLES]),
    },
    {
      clientKey: 'bootstrap-runtime',
      displayName: 'Bootstrap runtime client',
      audience: 'runtime',
      secret: process.env.RUNTIME_API_KEY,
      roles: parseList(process.env.BOOTSTRAP_RUNTIME_ROLES, [RUNTIME_DECISION_ROLE]),
    },
    // Una credencial por paso de aprobación, con SOLO el rol de ese paso.
    ...APPROVER_CLIENTS.map((approver) => ({
      clientKey: approver.clientKey,
      displayName: approver.displayName,
      audience: 'management',
      secret: process.env[approver.envVar],
      roles: [approver.role as string],
    })),
  ];

  const summaries: BootstrapClientSummary[] = [];
  for (const definition of definitions) {
    if (!definition.secret) continue;

    const client = await prisma.integrationClient.upsert({
      where: { clientKey: definition.clientKey },
      create: {
        clientKey: definition.clientKey,
        displayName: definition.displayName,
        audience: definition.audience,
        status: 'ACTIVE',
      },
      update: {
        displayName: definition.displayName,
        audience: definition.audience,
        status: 'ACTIVE',
      },
    });

    // Scopes and tenant access are replaced wholesale so that removing a role from
    // configuration actually withdraws it instead of leaving a stale grant behind.
    await prisma.integrationScope.deleteMany({
      where: { clientId: client.id, scope: { notIn: definition.roles } },
    });
    for (const scope of definition.roles) {
      await prisma.integrationScope.upsert({
        where: { clientId_scope: { clientId: client.id, scope } },
        create: { clientId: client.id, scope },
        update: {},
      });
    }

    await prisma.integrationTenantAccess.deleteMany({
      where: { clientId: client.id, tenantId: { not: tenantId } },
    });
    await prisma.integrationTenantAccess.upsert({
      where: { clientId_tenantId: { clientId: client.id, tenantId } },
      create: { clientId: client.id, tenantId },
      update: {},
    });

    const secretHash = sha256(definition.secret);
    const existing = await prisma.integrationCredential.findUnique({ where: { secretHash } });
    if (!existing) {
      // Rotating the configured secret must not leave the previous one usable.
      await prisma.integrationCredential.deleteMany({ where: { clientId: client.id } });
      await prisma.integrationCredential.create({
        data: { clientId: client.id, secretHash, label: 'bootstrap', status: 'ACTIVE' },
      });
    } else if (existing.status !== 'ACTIVE') {
      await prisma.integrationCredential.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', revokedAt: null },
      });
    }

    summaries.push({
      clientKey: definition.clientKey,
      audience: definition.audience,
      roles: definition.roles,
      tenantIds: [tenantId.toString()],
    });
  }

  return summaries;
}
