import { DomainException } from '../src/common/errors/domain-exception';
import { LibraryService } from '../src/modules/libraries/library.service';
import type { UpsertLibraryDto } from '../src/modules/libraries/library.dto';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

/**
 * El invariante de seguridad del registro de librerías (§7): **una fila solo puede HABILITAR
 * un prelude que ya existe revisado en el repositorio**, nunca aportar código.
 *
 * Si esa comprobación cae, dar de alta una fila deja de ser un control y pasa a ser un vector:
 * cualquiera con permiso de administración estaría inyectando código en el sandbox donde
 * corren los scripts de decisión. Por eso se prueba lo que se RECHAZA, no lo que se acepta.
 */
describe('LibraryService — el registro solo habilita preludes existentes', () => {
  const TENANT = 4n;
  const principal = { id: 'admin', requestId: 'req-1' } as AuthenticatedPrincipal;

  const audit = { append: () => Promise.resolve({}) } as unknown as AuditService;

  function makePrisma() {
    const calls: { upsertData?: Record<string, unknown>; findManyWhere?: unknown } = {};
    const prisma = {
      $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          approvedLibrary: {
            upsert: (args: { create: Record<string, unknown> }) => {
              calls.upsertData = args.create;
              return Promise.resolve({
                id: 1n,
                tenantId: TENANT,
                reviewedAt: new Date(),
                ...args.create,
              });
            },
          },
        }),
      approvedLibrary: {
        findMany: (args: { where: unknown }) => {
          calls.findManyWhere = args.where;
          return Promise.resolve(rowsForResolve);
        },
      },
    } as unknown as PrismaService;
    return { prisma, calls };
  }

  let rowsForResolve: unknown[] = [];

  const dto = (overrides: Partial<UpsertLibraryDto> = {}) =>
    ({
      logicalName: 'matematicas',
      packageName: 'math',
      version: '1.0.0',
      language: 'JAVASCRIPT',
      category: 'NUMERIC',
      description: 'Funciones numéricas',
      allowedFunctions: ['math.abs'],
      allowedEnvironments: ['DEV', 'PROD'],
      ...overrides,
    }) as UpsertLibraryDto;

  const service = () => {
    const { prisma, calls } = makePrisma();
    return { service: new LibraryService(prisma, audit), calls };
  };

  describe('alta de una librería', () => {
    it('rechaza un paquete sin prelude implementado', async () => {
      const { service: sut } = service();
      const error = await sut
        .upsert(TENANT, dto({ packageName: 'numpy' }), principal)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).code).toBe('LIBRARY_PRELUDE_NOT_IMPLEMENTED');
      // El error enumera lo que SÍ se puede habilitar: sin eso, el operador prueba a ciegas.
      expect((error as DomainException).details).toMatchObject({
        available: expect.arrayContaining(['math', 'statistics', 'finance', 'dates']),
      });
    });

    it('rechaza declarar una función que el prelude no expone', async () => {
      const { service: sut } = service();
      const error = await sut
        .upsert(TENANT, dto({ allowedFunctions: ['math.abs', 'math.rootkit'] }), principal)
        .catch((caught: unknown) => caught);

      // Sin esto el panel prometería una función que el sandbox no tiene, y el fallo
      // aparecería en mitad de una decisión en vez de al aprobar la librería.
      expect((error as DomainException).code).toBe('LIBRARY_FUNCTION_NOT_EXPOSED');
      expect((error as DomainException).message).toContain('math.rootkit');
    });

    it('acepta un prelude existente y deja constancia de quién lo revisó', async () => {
      const { service: sut, calls } = service();
      const saved = await sut.upsert(TENANT, dto(), principal);

      expect(calls.upsertData).toMatchObject({
        tenantId: TENANT,
        packageName: 'math',
        reviewedBy: 'admin',
        // Por defecto queda APROBADA y anclada a la versión: una librería que se actualiza
        // sola dejaría de ser la que se revisó.
        status: 'APPROVED',
        updatePolicy: 'PINNED',
      });
      expect(saved).not.toHaveProperty('tenantId');
    });

    it('OPERATION no pasa por el catálogo de preludes: no ejecuta código de librería', async () => {
      const { service: sut } = service();
      await expect(
        sut.upsert(
          TENANT,
          dto({ language: 'OPERATION', packageName: 'lo-que-sea', allowedFunctions: ['x'] }),
          principal,
        ),
      ).resolves.toBeDefined();
    });

    it('el catálogo publicado es exactamente el de los preludes implementados', () => {
      const { service: sut } = service();
      const names = sut.availablePreludes().map((entry) => entry.packageName);
      expect(names.sort()).toEqual(['dates', 'finance', 'math', 'statistics']);
    });
  });

  describe('resolución para ejecutar', () => {
    const base = {
      id: 1n,
      logicalName: 'matematicas',
      version: '1.0.0',
      language: 'JAVASCRIPT',
      status: 'APPROVED',
      allowedEnvironments: ['DEV', 'PROD'],
    };

    it('sin librerías seleccionadas no consulta nada', async () => {
      const { service: sut, calls } = service();
      await expect(sut.resolveForExecution(TENANT, [], 'JAVASCRIPT', 'PROD')).resolves.toEqual([]);
      expect(calls.findManyWhere).toBeUndefined();
    });

    it('acota la búsqueda al tenant', async () => {
      rowsForResolve = [base];
      const { service: sut, calls } = service();
      await sut.resolveForExecution(TENANT, [1n], 'JAVASCRIPT', 'PROD');
      expect(calls.findManyWhere).toMatchObject({ tenantId: TENANT });
    });

    it('falla si alguna librería seleccionada no existe en el tenant', async () => {
      rowsForResolve = [];
      const { service: sut } = service();
      const error = await sut
        .resolveForExecution(TENANT, [1n, 2n], 'JAVASCRIPT', 'PROD')
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('LIBRARY_NOT_FOUND');
      expect((error as DomainException).status).toBe(404);
    });

    it('una librería retirada no se puede ejecutar aunque siga seleccionada', async () => {
      rowsForResolve = [{ ...base, status: 'DEPRECATED' }];
      const { service: sut } = service();
      const error = await sut
        .resolveForExecution(TENANT, [1n], 'JAVASCRIPT', 'PROD')
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('LIBRARY_NOT_APPROVED');
      expect((error as DomainException).status).toBe(409);
    });

    it('no se puede usar una librería de otro lenguaje', async () => {
      rowsForResolve = [{ ...base, language: 'PYTHON' }];
      const { service: sut } = service();
      const error = await sut
        .resolveForExecution(TENANT, [1n], 'JAVASCRIPT', 'PROD')
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('LIBRARY_LANGUAGE_MISMATCH');
    });

    it('una librería habilitada solo en DEV no se cuela en PROD', async () => {
      rowsForResolve = [{ ...base, allowedEnvironments: ['DEV'] }];
      const { service: sut } = service();
      const error = await sut
        .resolveForExecution(TENANT, [1n], 'JAVASCRIPT', 'PROD')
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('LIBRARY_ENVIRONMENT_FORBIDDEN');
      expect((error as DomainException).status).toBe(409);
    });

    it('sin ambiente declarado no se aplica el aislamiento por ambiente', async () => {
      // El caso de una validación de autoría, que todavía no apunta a ningún despliegue.
      rowsForResolve = [{ ...base, allowedEnvironments: ['DEV'] }];
      const { service: sut } = service();
      await expect(sut.resolveForExecution(TENANT, [1n], 'JAVASCRIPT', null)).resolves.toHaveLength(
        1,
      );
    });
  });
});
