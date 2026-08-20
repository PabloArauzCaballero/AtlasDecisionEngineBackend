/**
 * Los tres tipos de usuario del smoke y cómo obtienen su credencial.
 *
 * Los roles NUNCA los declara el llamante: `AuthenticationGuard` los resuelve del registro
 * de clientes o del proveedor de identidad. Por eso probar "este rol no puede hacer aquello"
 * exige una credencial que de verdad tenga sólo ese rol, no una cabecera más débil.
 *
 * Dos mecanismos, el mismo guardián detrás:
 *
 *  - JWT (preferido): `POST /v1/session/login` contra el proveedor de identidad configurado.
 *    Se activa cuando existen `SMOKE_<TIPO>_EMAIL` y `SMOKE_<TIPO>_PASSWORD`. Los roles son
 *    los que el proveedor otorgue; el smoke comprueba que coincidan con los que espera y
 *    avisa si no, en vez de dar por buena una identidad distinta de la que se quería probar.
 *  - Clave de API (respaldo autónomo): se registran clientes acotados por rol en la base,
 *    como ya hace la suite e2e. No depende de un proveedor externo, así que el smoke corre
 *    en cualquier entorno con base de datos.
 *
 * En ambos casos la autorización la sigue decidiendo `RolesGuard` con los `@Roles(...)` de
 * cada ruta: el mecanismo cambia cómo se prueba la identidad, no quién puede hacer qué.
 */
import { createHash } from 'node:crypto';
import { config } from './config.mjs';
import { request } from './http.mjs';

/**
 * Tres roles de negocio, elegidos para que entre los tres se alcance toda la superficie y
 * el ciclo de vida completo sea ejecutable sin violar la segregación de funciones: quien
 * escribe no aprueba, y quien aprueba no despliega.
 */
export const USER_TYPES = {
  author: {
    key: 'author',
    label: 'Analista de riesgo (autor)',
    clientKey: 'smoke-author',
    roles: ['RISK_ANALYST', 'FRAUD_ANALYST'],
    audience: 'management',
    description:
      'Escribe algoritmos: artefactos, grafo, variables, campos calculados, importación de código, simulación y workers.',
  },
  approver: {
    key: 'approver',
    label: 'Aprobador (QA, riesgo y cumplimiento)',
    clientKey: 'smoke-approver',
    roles: ['QA_ANALYST', 'RISK_APPROVER', 'COMPLIANCE'],
    audience: 'management',
    description: 'Prueba y aprueba: suites de regresión, cola de aprobación y decisiones ordenadas.',
  },
  operator: {
    key: 'operator',
    label: 'Operador de plataforma',
    clientKey: 'smoke-operator',
    roles: ['PLATFORM_ADMIN', 'OPERATIONS', 'AUDITOR'],
    audience: 'management',
    description:
      'Explota la plataforma: despliegues, librerías, auditoría, revisión manual y operación de workers.',
  },
};

/** El cliente de tiempo de ejecución es de otra audiencia: ejecuta decisiones, no administra. */
export const RUNTIME_CLIENT = {
  clientKey: 'smoke-runtime',
  roles: ['DECISION_RUNTIME'],
  audience: 'runtime',
};

export const USER_ORDER = ['author', 'approver', 'operator'];

function secretFor(clientKey) {
  // Determinista por tenant e instalación: el smoke debe poder reprovisionar la misma
  // credencial en corridas sucesivas sin arrastrar un secreto en el repositorio.
  const material = `${clientKey}:${config.tenantId}:${process.env.MANAGEMENT_API_KEY ?? 'atlas-smoke'}`;
  return createHash('sha256').update(material).digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Registra en la base los clientes acotados por rol.
 *
 * Es idempotente y reemplaza los alcances por completo: quitar un rol de esta lista debe
 * retirarlo de verdad, no dejar una concesión vieja detrás.
 */
export async function provisionApiKeyClients() {
  if (!config.databaseUrl) {
    throw new Error(
      'Falta DATABASE_URL. El smoke registra sus propios clientes acotados por rol y sin base de datos no puede hacerlo.',
    );
  }
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });

  const definitions = [
    ...Object.values(USER_TYPES).map((type) => ({
      clientKey: type.clientKey,
      displayName: `Smoke ${type.key}`,
      audience: type.audience,
      roles: type.roles,
    })),
    {
      clientKey: RUNTIME_CLIENT.clientKey,
      displayName: 'Smoke runtime',
      audience: RUNTIME_CLIENT.audience,
      roles: RUNTIME_CLIENT.roles,
    },
  ];

  try {
    for (const definition of definitions) {
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

      const tenantId = BigInt(config.tenantId);
      await prisma.integrationTenantAccess.deleteMany({
        where: { clientId: client.id, tenantId: { not: tenantId } },
      });
      await prisma.integrationTenantAccess.upsert({
        where: { clientId_tenantId: { clientId: client.id, tenantId } },
        create: { clientId: client.id, tenantId },
        update: {},
      });

      const secretHash = sha256(secretFor(definition.clientKey));
      const existing = await prisma.integrationCredential.findUnique({ where: { secretHash } });
      if (!existing) {
        await prisma.integrationCredential.deleteMany({ where: { clientId: client.id } });
        await prisma.integrationCredential.create({
          data: { clientId: client.id, secretHash, label: 'smoke', status: 'ACTIVE' },
        });
      } else if (existing.status !== 'ACTIVE') {
        await prisma.integrationCredential.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', revokedAt: null },
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

function apiKeyAuth(clientKey, roles, principalId) {
  return {
    authMethod: 'api_key',
    principalId: principalId ?? clientKey,
    roles,
    headers: { 'x-api-key': secretFor(clientKey), 'x-tenant-id': config.tenantId },
  };
}

/**
 * Inicia sesión contra el proveedor de identidad y devuelve la credencial portadora.
 *
 * Devuelve `null` —no lanza— cuando no hay credenciales configuradas: el smoke debe poder
 * correr sin proveedor de identidad y decirlo, no detenerse.
 */
async function jwtAuth(userType) {
  const upper = userType.key.toUpperCase();
  const email = process.env[`SMOKE_${upper}_EMAIL`]?.trim();
  const password = process.env[`SMOKE_${upper}_PASSWORD`]?.trim();
  if (!email || !password) return null;

  const response = await request({
    method: 'POST',
    path: '/v1/session/login',
    headers: config.sessionOrigin ? { origin: config.sessionOrigin } : {},
    body: { tenantId: config.tenantId, email, password },
  });
  if (!response.ok) {
    throw new Error(
      `El inicio de sesión de "${userType.key}" (${email}) falló con ${response.status} ` +
        `${response.body?.error?.code ?? ''}. Revisa SMOKE_${upper}_EMAIL/PASSWORD y que el proveedor de identidad esté activo.`,
    );
  }
  const accessToken = response.body?.accessToken;
  if (!accessToken) {
    throw new Error(`El proveedor de identidad no devolvió accessToken para "${userType.key}".`);
  }
  return {
    authMethod: 'identity_provider',
    principalId: response.body?.user?.id ?? email,
    // Los roles reales los otorga el proveedor; se conservan tal cual para poder contrastarlos.
    roles: response.body?.user?.roles ?? [],
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-tenant-id': config.tenantId,
    },
  };
}

/**
 * Resuelve la credencial de un tipo de usuario, prefiriendo JWT cuando está configurado.
 *
 * Cuando llega por JWT se comprueba que los roles del proveedor cubran los que este tipo
 * de usuario debe tener: si no, las denegaciones que el smoke observe serían de otra
 * identidad y el informe estaría midiendo otra cosa.
 */
export async function resolvePrincipal(userTypeKey) {
  const userType = USER_TYPES[userTypeKey];
  if (!userType) throw new Error(`Tipo de usuario desconocido: ${userTypeKey}`);

  const viaJwt = await jwtAuth(userType);
  if (viaJwt) {
    const missing = userType.roles.filter((role) => !viaJwt.roles.includes(role));
    return {
      ...viaJwt,
      userType,
      expectedRoles: userType.roles,
      roleMismatch: missing.length ? missing : undefined,
    };
  }

  return {
    ...apiKeyAuth(userType.clientKey, userType.roles),
    userType,
    expectedRoles: userType.roles,
  };
}

export function runtimePrincipal() {
  return {
    ...apiKeyAuth(RUNTIME_CLIENT.clientKey, RUNTIME_CLIENT.roles),
    userType: { key: 'runtime', label: 'Cliente de tiempo de ejecución', roles: RUNTIME_CLIENT.roles },
    expectedRoles: RUNTIME_CLIENT.roles,
  };
}

/** Credencial deliberadamente inválida, para el camino de rechazo de autenticación. */
export function anonymousPrincipal() {
  return {
    authMethod: 'none',
    principalId: 'anonymous',
    roles: [],
    headers: { 'x-tenant-id': config.tenantId },
  };
}

export function invalidKeyPrincipal() {
  return {
    authMethod: 'invalid_api_key',
    principalId: 'invalid',
    roles: [],
    headers: { 'x-api-key': 'smoke-not-a-real-key-0000000000', 'x-tenant-id': config.tenantId },
  };
}
