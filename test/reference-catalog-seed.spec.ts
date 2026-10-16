import { ConfigService } from '@nestjs/config';
import type { ModuleRef } from '@nestjs/core';
import { ReferenceCatalogService } from '../src/modules/reference-catalog/reference-catalog.service';
import { expenseCategoryTree } from '../src/modules/reference-catalog/seeds/expense-category-tree.data';
import {
  levelsOf,
  seedSemanticCatalog,
  semanticEntityAliasCatalog,
} from '../src/modules/reference-catalog/seeds/semantic-catalog.seed';
import { BOLIVIA_INSTITUTIONS } from '../src/modules/workers/bank-statement/core/institutions/bolivia-institutions';
import { institutionLogoSeed } from '../src/modules/workers/bank-statement/institutions/institution-logo-seed';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { InstitutionLogoService } from '../src/modules/workers/bank-statement/institutions/institution-logo.service';
import type { InstitutionRegistryService } from '../src/modules/workers/bank-statement/institutions/institution-registry.service';

/**
 * El catálogo de referencia se siembra solo, en todo entorno.
 *
 * 2026-10-15: TEST tenía el padrón de entidades y el árbol de categorías a cero —«Faltan 71 entidades de la
 * nómina de ASFI», «Categorías» en blanco— porque el catálogo sólo llegaba por la rama de semillas y TEST no la
 * usa. Cada extracto acababa en revisión como banco desconocido.
 */

/** Una tabla en memoria con la semántica de `createMany({ skipDuplicates })` y una FK al padre. */
function tablaDeCategorias() {
  const filas = new Map<string, { parentCode: string | null; name: string }>();
  return {
    filas,
    createMany: jest.fn(
      async ({ data }: { data: { code: string; parentCode: string | null; name: string }[] }) => {
        let count = 0;
        for (const fila of data) {
          if (fila.parentCode !== null && !filas.has(fila.parentCode)) {
            throw new Error(`FK: falta el padre ${fila.parentCode} de ${fila.code}`);
          }
          if (filas.has(fila.code)) continue;
          filas.set(fila.code, { parentCode: fila.parentCode, name: fila.name });
          count += 1;
        }
        return { count };
      },
    ),
  };
}

function tablaDeAlias() {
  const filas = new Set<string>();
  return {
    filas,
    createMany: jest.fn(async ({ data }: { data: { entityType: string; alias: string }[] }) => {
      let count = 0;
      for (const fila of data) {
        const clave = `${fila.entityType}|${fila.alias}`;
        if (filas.has(clave)) continue;
        filas.add(clave);
        count += 1;
      }
      return { count };
    }),
  };
}

describe('catálogo de referencia · calidad de los datos', () => {
  it('el padrón trae las 71 entidades de ASFI, sin códigos repetidos y todas con señales de detección', () => {
    const codigos = BOLIVIA_INSTITUTIONS.map((i) => i.code);
    expect(codigos).toHaveLength(71);
    expect(new Set(codigos).size).toBe(71);
    expect(BOLIVIA_INSTITUTIONS.filter((i) => i.markers.length === 0)).toEqual([]);
    expect(BOLIVIA_INSTITUTIONS.filter((i) => !i.name.trim())).toEqual([]);
  });

  it('toda entidad con licencia vigente tiene logotipo (oficial o monograma)', () => {
    const conLogo = new Set(institutionLogoSeed().map((l) => l.code));
    const sinLogo = BOLIVIA_INSTITUTIONS.filter(
      (i) => i.licenseStatus === 'LICENSED' && !conLogo.has(i.code),
    );
    expect(sinLogo.map((i) => i.code)).toEqual([]);
  });

  it('el árbol de categorías tiene códigos únicos, padres existentes y umbrales válidos', () => {
    const codigos = expenseCategoryTree.map((c) => c.code);
    expect(codigos.length).toBeGreaterThanOrEqual(150);
    expect(new Set(codigos).size).toBe(codigos.length);
    const presentes = new Set(codigos);
    expect(
      expenseCategoryTree.filter((c) => c.parentCode !== null && !presentes.has(c.parentCode)),
    ).toEqual([]);
    for (const c of expenseCategoryTree) {
      expect(c.acceptanceThreshold).toBeGreaterThan(0);
      expect(c.acceptanceThreshold).toBeLessThanOrEqual(1);
      expect(c.name.trim()).not.toBe('');
      expect(c.description.trim()).not.toBe('');
    }
    // Las dos raíces que el clasificador y los informes de capacidad esperan.
    expect(presentes.has('GASTOS')).toBe(true);
    expect(presentes.has('INGRESOS')).toBe(true);
  });

  it('los niveles respetan la clave foránea al padre y detectan un ciclo', () => {
    const niveles = levelsOf(expenseCategoryTree);
    const vistos = new Set<string>();
    for (const nivel of niveles) {
      for (const c of nivel) expect(c.parentCode === null || vistos.has(c.parentCode)).toBe(true);
      for (const c of nivel) vistos.add(c.code);
    }
    expect(vistos.size).toBe(expenseCategoryTree.length);
    const ciclo = [
      { ...expenseCategoryTree[0], code: 'A', parentCode: 'B' },
      { ...expenseCategoryTree[0], code: 'B', parentCode: 'A' },
    ];
    expect(() => levelsOf(ciclo)).toThrow(/no se sostiene/);
  });
});

describe('seedSemanticCatalog · idempotente y sin pisar lo editado', () => {
  it('siembra todo en una base vacía y no crea nada la segunda vez', async () => {
    const semanticCategory = tablaDeCategorias();
    const semanticEntityAlias = tablaDeAlias();
    const prisma = { semanticCategory, semanticEntityAlias } as never;

    const primera = await seedSemanticCatalog(prisma, 1n);
    expect(primera.categories).toBe(expenseCategoryTree.length);
    expect(primera.aliases).toBe(semanticEntityAliasCatalog.length);

    const segunda = await seedSemanticCatalog(prisma, 1n);
    expect(segunda).toEqual({ categories: 0, aliases: 0 });
  });

  it('una categoría que ya existe (editada en el portal) se respeta', async () => {
    const semanticCategory = tablaDeCategorias();
    semanticCategory.filas.set('GASTOS', { parentCode: null, name: 'Gastos (renombrada a mano)' });
    const prisma = { semanticCategory, semanticEntityAlias: tablaDeAlias() } as never;

    const { categories } = await seedSemanticCatalog(prisma, 1n);
    expect(categories).toBe(expenseCategoryTree.length - 1);
    expect(semanticCategory.filas.get('GASTOS')?.name).toBe('Gastos (renombrada a mano)');
  });
});

describe('ReferenceCatalogService · corre siempre, por tenant, y no tumba el arranque', () => {
  function montar(over: { env?: Record<string, unknown>; syncSeed?: jest.Mock } = {}) {
    const prisma = {
      integrationTenantAccess: {
        findMany: jest.fn(async () => [{ tenantId: 1n }, { tenantId: 7n }]),
      },
      semanticCategory: tablaDeCategorias(),
      semanticEntityAlias: tablaDeAlias(),
    } as unknown as PrismaService;
    const institutions = {
      syncSeed:
        over.syncSeed ?? jest.fn(async () => ({ total: 71, created: ['BNB'], dryRun: false })),
      syncLogos: jest.fn(async () => ({
        applied: ['BNB'],
        upgraded: [],
        available: 68,
        downloaded: 61,
        generated: 7,
        dryRun: false,
      })),
    } as unknown as Pick<InstitutionRegistryService, 'syncSeed'> &
      Pick<InstitutionLogoService, 'syncLogos'>;
    const env: Record<string, unknown> = {
      NODE_ENV: 'production',
      WORKER_ROLE: 'WORKER',
      ...over.env,
    };
    const config = { get: (k: string) => env[k] } as unknown as ConfigService;
    const moduleRef = { get: () => institutions } as unknown as ModuleRef;
    return { servicio: new ReferenceCatalogService(prisma, moduleRef, config), institutions };
  }

  it('siembra el tenant de arranque y los de los clientes de integración, aunque STARTUP_SEED_ENABLED sea false', async () => {
    const { servicio, institutions } = montar({ env: { STARTUP_SEED_ENABLED: false } });
    await servicio.onApplicationBootstrap();
    expect((institutions.syncSeed as jest.Mock).mock.calls.map((c) => c[0])).toEqual([1n, 7n]);
    expect((institutions.syncLogos as jest.Mock).mock.calls).toHaveLength(2);
  });

  it('una réplica de API no siembra, y tampoco con la variable apagada o en pruebas', async () => {
    for (const env of [
      { WORKER_ROLE: 'API' },
      { REFERENCE_CATALOG_SEED_ENABLED: false },
      { NODE_ENV: 'test' },
    ]) {
      const { servicio, institutions } = montar({ env });
      await servicio.onApplicationBootstrap();
      expect(institutions.syncSeed).not.toHaveBeenCalled();
    }
  });

  it('si un tenant falla, el arranque sigue y el siguiente tenant se siembra', async () => {
    const syncSeed = jest
      .fn()
      .mockRejectedValueOnce(new Error('base caída'))
      .mockResolvedValueOnce({ total: 71, created: [], dryRun: false });
    const { servicio } = montar({ syncSeed });
    await expect(servicio.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(syncSeed).toHaveBeenCalledTimes(2);
  });
});
