import { ConfigService } from '@nestjs/config';
import { DomainException } from '../src/common/errors/domain-exception';
import { TraceabilityService } from '../src/modules/traceability/traceability.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type {
  LinkPolicyArtifactDto,
  LinkPolicyTestSuiteDto,
} from '../src/modules/traceability/traceability.dto';

/**
 * La matriz de cobertura es lo que un auditor mira para responder «¿esta política está
 * implementada Y probada?». Su valor depende de que distinga tres estados y no dos: una
 * política con artefacto pero sin prueba **no** está cubierta, y presentarla como si lo
 * estuviera es peor que no tener matriz.
 *
 * Lo otro que se fija aquí es el aislamiento: enlazar una política con un artefacto o una
 * suite cruza dos agregados, y las dos puntas tienen que ser del mismo tenant.
 */
describe('TraceabilityService — matriz de cobertura y enlaces', () => {
  const TENANT = 6n;
  const principal = { id: 'auditor', requestId: 'req-1' } as AuthenticatedPrincipal;
  const audit = { append: () => Promise.resolve({}) } as unknown as AuditService;

  function policy(code: string, artifactLinks: unknown[], testLinks: unknown[]) {
    return { id: BigInt(code.length), policyCode: code, artifactLinks, testLinks };
  }

  function make(objectives: unknown[], extra: Record<string, unknown> = {}) {
    const calls: Record<string, unknown> = {};
    const prisma = {
      businessObjective: {
        findMany: (args: { where: unknown; take?: number }) => {
          calls.objectivesArgs = args;
          return Promise.resolve(objectives);
        },
      },
      ...extra,
    } as unknown as PrismaService;
    return {
      service: new TraceabilityService(prisma, audit, new ConfigService({})),
      calls,
    };
  }

  describe('coverageMatrix()', () => {
    it('COMPLETE solo cuando hay artefacto Y prueba', async () => {
      const { service } = make([
        {
          id: 1n,
          objectiveCode: 'OBJ-1',
          name: 'Reducir mora',
          policyRequirements: [policy('POL-A', [{ id: 1 }], [{ id: 2 }])],
        },
      ]);
      const matriz = await service.coverageMatrix(TENANT);
      expect(matriz.objectives[0].coverage['POL-A']).toBe('COMPLETE');
      expect(matriz.covered).toBe(1);
    });

    it('PARTIAL cuando falta una de las dos patas', async () => {
      const { service } = make([
        {
          id: 1n,
          objectiveCode: 'OBJ-1',
          name: 'x',
          policyRequirements: [
            policy('SOLO-ARTEFACTO', [{ id: 1 }], []),
            policy('SOLO-PRUEBA', [], [{ id: 2 }]),
          ],
        },
      ]);
      const matriz = await service.coverageMatrix(TENANT);
      // Implementada sin probar, o probada sin implementar: ninguna de las dos cuenta como
      // cobertura, y confundirlas es exactamente el error que la matriz existe para evitar.
      expect(matriz.objectives[0].coverage['SOLO-ARTEFACTO']).toBe('PARTIAL');
      expect(matriz.objectives[0].coverage['SOLO-PRUEBA']).toBe('PARTIAL');
      expect(matriz.covered).toBe(0);
    });

    it('GAP cuando la política no está en ese objetivo', async () => {
      const { service } = make([
        {
          id: 1n,
          objectiveCode: 'OBJ-1',
          name: 'x',
          policyRequirements: [policy('POL-A', [{ id: 1 }], [{ id: 2 }])],
        },
        { id: 2n, objectiveCode: 'OBJ-2', name: 'y', policyRequirements: [] },
      ]);
      const matriz = await service.coverageMatrix(TENANT);
      // La matriz es rectangular: toda política aparece en todo objetivo, y donde no aplica
      // se dice GAP en vez de omitir la celda.
      expect(matriz.objectives[1].coverage['POL-A']).toBe('GAP');
      expect(matriz.total).toBe(2); // 1 política × 2 objetivos
    });

    it('las políticas se deduplican entre objetivos', async () => {
      const { service } = make([
        {
          id: 1n,
          objectiveCode: 'OBJ-1',
          name: 'x',
          policyRequirements: [policy('POL-A', [], [])],
        },
        {
          id: 2n,
          objectiveCode: 'OBJ-2',
          name: 'y',
          policyRequirements: [policy('POL-A', [], [])],
        },
      ]);
      const matriz = await service.coverageMatrix(TENANT);
      expect(matriz.policies).toHaveLength(1);
      expect(matriz.total).toBe(2);
    });

    it('solo mira objetivos activos de este tenant, y con tope de filas', async () => {
      const { service, calls } = make([]);
      await service.coverageMatrix(TENANT);
      const args = calls.objectivesArgs as { where: unknown; take: number };
      expect(args.where).toEqual({ tenantId: TENANT, isActive: true });
      expect(args.take).toBe(500);
    });

    it('un catálogo vacío devuelve una matriz vacía, no un error', async () => {
      const { service } = make([]);
      await expect(service.coverageMatrix(TENANT)).resolves.toMatchObject({
        policies: [],
        objectives: [],
        covered: 0,
        total: 0,
      });
    });
  });

  describe('enlaces', () => {
    const linkPrisma = (policyFound: boolean, versionFound: boolean) => {
      const created: unknown[] = [];
      return {
        created,
        prisma: {
          policyRequirement: {
            findFirst: () => Promise.resolve(policyFound ? { id: 1n } : null),
          },
          decisionArtifactVersion: {
            findFirst: () => Promise.resolve(versionFound ? { id: 5n } : null),
          },
          decisionTestSuite: {
            findFirst: () => Promise.resolve(versionFound ? { id: 7n } : null),
          },
          $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              policyArtifactLink: {
                create: (args: unknown) => {
                  created.push(args);
                  return Promise.resolve({ id: 1n });
                },
              },
              policyTestLink: {
                create: (args: unknown) => {
                  created.push(args);
                  return Promise.resolve({ id: 1n });
                },
              },
            }),
        } as unknown as PrismaService,
      };
    };

    const service = (policyFound: boolean, versionFound: boolean) => {
      const { prisma, created } = linkPrisma(policyFound, versionFound);
      return {
        sut: new TraceabilityService(prisma, audit, new ConfigService({})),
        created,
      };
    };

    it('no se enlaza una política de otro tenant', async () => {
      const { sut } = service(false, true);
      const error = await sut
        .linkArtifact(TENANT, 1n, { artifactVersionId: '5' } as LinkPolicyArtifactDto, principal)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('POLICY_NOT_FOUND');
      expect((error as DomainException).status).toBe(404);
    });

    it('no se enlaza una versión de otro tenant, aunque la política sí sea nuestra', async () => {
      const { sut } = service(true, false);
      const error = await sut
        .linkArtifact(TENANT, 1n, { artifactVersionId: '5' } as LinkPolicyArtifactDto, principal)
        .catch((caught: unknown) => caught);
      // Las DOS puntas del enlace se comprueban: con una sola bastaría un identificador
      // ajeno para cruzar el enlace entre clientes.
      expect((error as DomainException).code).toBe('VERSION_NOT_FOUND');
    });

    it('enlaza artefacto y política cuando ambos son del tenant', async () => {
      const { sut, created } = service(true, true);
      await sut.linkArtifact(
        TENANT,
        1n,
        { artifactVersionId: '5' } as LinkPolicyArtifactDto,
        principal,
      );
      expect(created[0]).toMatchObject({
        data: { policyRequirementId: 1n, artifactVersionId: 5n },
      });
    });

    it('la suite de pruebas se comprueba igual que el artefacto', async () => {
      const { sut } = service(true, false);
      const error = await sut
        .linkTestSuite(TENANT, 1n, { testSuiteId: '7' } as LinkPolicyTestSuiteDto, principal)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DomainException);
    });
  });
});
