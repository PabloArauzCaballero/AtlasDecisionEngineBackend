import { DeploymentStatus } from '@prisma/client';
import { DeployVersionService } from '../src/modules/deployments/deploy-version.service';
import { DeploymentCacheInvalidator } from '../src/modules/deployments/deployment-cache-invalidator.service';
import { DeploymentRollbackService } from '../src/modules/deployments/deployment-rollback.service';
import { EconomicContractGate } from '../src/modules/deployments/economic-contract.gate';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

/**
 * Guardas de `DeployVersionService` y `DeploymentRollbackService` que protegen la continuidad de la decisión:
 * - sólo DIRECT sin reglas de tráfico (el runtime no enruta por porcentaje);
 * - una vigencia que no cubre «ahora» deja el artefacto sin despliegue activo;
 * - la caché se invalida DESPUÉS del commit y su fallo no tumba la respuesta;
 * - un rollback no reactiva un despliegue SUSPENDIDO.
 */

const PRINCIPAL = { id: 'admin', requestId: 'req-1' } as unknown as AuthenticatedPrincipal;
const VERSION = {
  id: 10n,
  artifactId: 3n,
  createdBy: 'otro',
  versionNumber: 2,
  artifact: { artifactCode: 'RIESGO', decisionKind: 'DECISION' },
  compiledArtifacts: [{ id: 99n, compiledChecksum: 'abc' }],
};
const ENTORNO = { id: 5n, code: 'DEV', status: 'ACTIVE', isProduction: false };

function armar(opciones: { invalidate?: jest.Mock; previous?: Record<string, unknown> } = {}) {
  const invalidate = opciones.invalidate ?? jest.fn().mockResolvedValue(undefined);
  const creados: unknown[] = [];
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    decisionDeployment: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn(({ where }: { where: { id: bigint } }) =>
        Promise.resolve(
          where.id === 1n
            ? { id: 1n, isActive: true }
            : { id: 2n, deploymentStatus: DeploymentStatus.SUPERSEDED, ...opciones.previous },
        ),
      ),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn((args: unknown) => {
        creados.push(args);
        return Promise.resolve({ id: 7n, previousDeploymentId: null });
      }),
    },
    decisionRuntimeBinding: { upsert: jest.fn(), update: jest.fn() },
    decisionArtifactVersion: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'DEPLOYED_TO_DEV' }),
    },
  };
  const prisma = {
    decisionArtifactVersion: { findFirst: jest.fn().mockResolvedValue(VERSION) },
    decisionChangeLog: { findFirst: jest.fn().mockResolvedValue(null) },
    decisionEnvironment: { findUnique: jest.fn().mockResolvedValue(ENTORNO) },
    decisionDeployment: {
      findFirst: jest.fn().mockResolvedValue({
        id: 1n,
        environmentId: 5n,
        artifactVersionId: 10n,
        artifactVersion: { artifactId: 3n, artifact: { artifactCode: 'RIESGO' } },
        environment: { code: 'DEV' },
        previousDeploymentId: 2n,
        previousDeployment: { id: 2n },
      }),
    },
    $transaction: (fn: (t: unknown) => unknown) => fn(tx),
  };
  const states = { transition: jest.fn() } as never;
  const audit = { append: jest.fn() } as never;
  const cache = new DeploymentCacheInvalidator({ invalidate } as never);
  const service = new DeployVersionService(
    prisma as never,
    { assertApproved: jest.fn() } as never,
    states,
    audit,
    { publish: jest.fn() } as never,
    { capture: jest.fn().mockResolvedValue(undefined) } as never,
    cache,
    new EconomicContractGate(prisma as never),
  );
  const rollbacks = new DeploymentRollbackService(prisma as never, states, audit, cache);
  return { service, rollbacks, invalidate, creados, tx };
}

const dto = (extra: Record<string, unknown> = {}) =>
  ({ environmentCode: 'DEV', deploymentMode: 'DIRECT', traffic: [], ...extra }) as never;

describe('deploy: lo que el runtime no soporta se rechaza', () => {
  it.each(['CANARY', 'CHAMPION_CHALLENGER'])('rechaza el modo %s', async (modo) => {
    const { service, creados } = armar();
    await expect(
      service.deploy(1n, 10n, dto({ deploymentMode: modo }), PRINCIPAL),
    ).rejects.toMatchObject({ code: 'DEPLOYMENT_MODE_NOT_SUPPORTED' });
    expect(creados).toHaveLength(0);
  });

  it('rechaza reglas de tráfico aunque el modo sea DIRECT', async () => {
    const { service } = armar();
    await expect(
      service.deploy(
        1n,
        10n,
        dto({ traffic: [{ segmentKey: 'a', trafficPercentage: 100, priority: 1 }] }),
        PRINCIPAL,
      ),
    ).rejects.toMatchObject({ code: 'DEPLOYMENT_MODE_NOT_SUPPORTED' });
  });

  it('rechaza un effectiveFrom futuro: dejaría el artefacto sin despliegue activo', async () => {
    const { service, creados } = armar();
    const manana = new Date(Date.now() + 86_400_000).toISOString();
    await expect(
      service.deploy(1n, 10n, dto({ effectiveFrom: manana }), PRINCIPAL),
    ).rejects.toMatchObject({ code: 'DEPLOYMENT_EFFECTIVE_FROM_IN_FUTURE' });
    expect(creados).toHaveLength(0);
  });

  it('rechaza un effectiveTo ya vencido', async () => {
    const { service } = armar();
    const ayer = new Date(Date.now() - 86_400_000).toISOString();
    await expect(
      service.deploy(1n, 10n, dto({ effectiveTo: ayer }), PRINCIPAL),
    ).rejects.toMatchObject({ code: 'DEPLOYMENT_EFFECTIVE_WINDOW_INVALID' });
  });

  it('un DIRECT normal pasa', async () => {
    const { service, creados } = armar();
    await service.deploy(1n, 10n, dto(), PRINCIPAL);
    expect(creados).toHaveLength(1);
  });
});

describe('invalidación de caché tras el commit', () => {
  it('deploy: si la caché falla, el despliegue (ya confirmado) se devuelve igual', async () => {
    const { service, invalidate } = armar({
      invalidate: jest.fn().mockRejectedValue(new Error('Redis caído')),
    });
    const resultado = await service.deploy(1n, 10n, dto(), PRINCIPAL);
    expect(invalidate).toHaveBeenCalled();
    expect(resultado).toMatchObject({ id: 7n });
  });
});

describe('rollback', () => {
  it('no reactiva un despliegue SUSPENDED', async () => {
    const { rollbacks, tx } = armar({ previous: { deploymentStatus: DeploymentStatus.SUSPENDED } });
    await expect(
      rollbacks.rollback(1n, 1n, { reason: 'x' } as never, PRINCIPAL),
    ).rejects.toMatchObject({ code: 'ROLLBACK_TARGET_NOT_AVAILABLE' });
    expect(tx.decisionDeployment.update).not.toHaveBeenCalled();
  });

  it('reactiva uno SUPERSEDED', async () => {
    const { rollbacks, tx } = armar();
    const salida = await rollbacks.rollback(1n, 1n, { reason: 'x' } as never, PRINCIPAL);
    expect(salida).toMatchObject({ activeDeploymentId: 2n });
    expect(tx.decisionRuntimeBinding.update).toHaveBeenCalled();
  });
});
