import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { UnresolvedClassificationService } from '../src/modules/workers/semantic-analysis/unresolved-classification.service';
import { UnresolvedResolutionService } from '../src/modules/workers/semantic-analysis/unresolved-resolution.service';

/**
 * La bandeja de valores sin clasificar, sin base de datos.
 *
 * Se prueba contra dobles porque lo que hay que fijar aquí es el CRITERIO —qué
 * se deduplica, qué se notifica, qué se aprende— y no el SQL. Que la
 * deduplicación la garantice una clave única en Postgres es justamente lo que
 * permite comprobar aquí que el servicio la usa en vez de improvisar un
 * «buscar y si no existe crear», que es donde nacen los duplicados.
 */

interface FilaFalsa {
  id: bigint;
  tenantId: bigint;
  rawValue: string;
  normalizedValue: string;
  source: string;
  suggestedCategoryCode: string | null;
  confidence: Prisma.Decimal | null;
  occurrenceCount: number;
  status: string;
}

/** Doble de Prisma que respeta la unicidad `(tenant, source, normalizedValue)`. */
function prismaFalso(inicial: FilaFalsa[] = []) {
  const filas = [...inicial];
  const alias: { tenantId: bigint; entityType: string; alias: string; canonicalName: string }[] =
    [];
  let siguienteId = BigInt(filas.length + 1);

  const client: Record<string, any> = {
    unresolvedClassification: {
      upsert: jest.fn(({ where, create, update }: any) => {
        const clave = where.tenantId_source_normalizedValue;
        const existente = filas.find(
          (f) =>
            f.tenantId === clave.tenantId &&
            f.source === clave.source &&
            f.normalizedValue === clave.normalizedValue,
        );
        if (existente) {
          if (update.occurrenceCount?.increment) existente.occurrenceCount += 1;
          if (update.suggestedCategoryCode !== undefined) {
            existente.suggestedCategoryCode = update.suggestedCategoryCode;
          }
          return Promise.resolve({ ...existente });
        }
        const nueva: FilaFalsa = {
          id: siguienteId++,
          tenantId: create.tenantId,
          rawValue: create.rawValue,
          normalizedValue: create.normalizedValue,
          source: create.source,
          suggestedCategoryCode: create.suggestedCategoryCode ?? null,
          confidence: create.confidence ?? null,
          occurrenceCount: 1,
          status: 'PENDING',
        };
        filas.push(nueva);
        return Promise.resolve({ ...nueva });
      }),
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(filas.find((f) => f.id === where.id) ?? null),
      ),
      findMany: jest.fn(() => Promise.resolve(filas)),
      count: jest.fn(() => Promise.resolve(filas.filter((f) => f.status === 'PENDING').length)),
      update: jest.fn(({ where, data }: any) => {
        const fila = filas.find((f) => f.id === where.id);
        if (fila) Object.assign(fila, { status: data.status });
        return Promise.resolve(fila);
      }),
    },
    semanticEntityAlias: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          alias.find(
            (a) =>
              a.tenantId === where.tenantId &&
              a.entityType === where.entityType &&
              a.alias === where.alias,
          ) ?? null,
        ),
      ),
      upsert: jest.fn(({ where, create, update }: any) => {
        const clave = where.tenantId_entityType_alias;
        const existente = alias.find(
          (a) =>
            a.tenantId === clave.tenantId &&
            a.entityType === clave.entityType &&
            a.alias === clave.alias,
        );
        if (existente) existente.canonicalName = update.canonicalName;
        else alias.push({ ...create });
        return Promise.resolve({});
      }),
    },
    semanticCategory: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.tenantId_code.code === 'GASTOS.PROFESIONALES'
            ? { code: 'GASTOS.PROFESIONALES' }
            : null,
        ),
      ),
    },
    $transaction: jest.fn((arg: unknown): Promise<unknown> =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(client)
        : Promise.resolve([]),
    ),
  };
  return { client, filas, alias };
}

const config = { get: (clave: string) => (clave.includes('AUTO') ? false : 0.9) } as ConfigService;

describe('UnresolvedClassification', () => {
  const TENANT = BigInt(1);

  function armar(inicial: FilaFalsa[] = []) {
    const { client, filas, alias } = prismaFalso(inicial);
    const notificaciones = { createMany: jest.fn(() => Promise.resolve(1)) };
    const servicio = new UnresolvedClassificationService(
      client as never,
      config,
      notificaciones as never,
    );
    return { servicio, client, filas, alias, notificaciones };
  }

  it('registra un valor desconocido conservando el original tal como llegó', async () => {
    const { servicio, filas } = armar();

    await servicio.record({
      tenantId: TENANT,
      rawValue: '  Servicios   Profesionales Independientes  ',
      source: 'semantic-analysis',
      candidates: [{ categoryCode: 'GASTOS.PROFESIONALES', confidence: 0.91 }],
    });

    expect(filas).toHaveLength(1);
    // El valor original NO se toca: es lo que se audita.
    expect(filas[0].rawValue).toBe('  Servicios   Profesionales Independientes  ');
    // Y la forma normalizada existe SÓLO para comparar.
    expect(filas[0].normalizedValue).toBe('SERVICIOS PROFESIONALES INDEPENDIENTES');
    expect(filas[0].suggestedCategoryCode).toBe('GASTOS.PROFESIONALES');
  });

  it('notifica al administrador la primera vez y NO en las repeticiones', async () => {
    const { servicio, notificaciones, filas } = armar();
    const entrada = {
      tenantId: TENANT,
      rawValue: 'SERVICIOS PROFESIONALES INDEPENDIENTES',
      source: 'semantic-analysis',
    };

    await servicio.record(entrada);
    await servicio.record(entrada);
    await servicio.record(entrada);

    expect(filas).toHaveLength(1);
    expect(filas[0].occurrenceCount).toBe(3);
    /*
     * Una notificación por aparición convertiría la bandeja en ruido y
     * escondería justo lo que hay que ver: por eso sólo la primera.
     */
    expect(notificaciones.createMany).toHaveBeenCalledTimes(1);
  });

  it('deduplica aunque el valor llegue con otras mayúsculas, espacios o acentos', async () => {
    const { servicio, filas } = armar();

    await servicio.record({
      tenantId: TENANT,
      rawValue: 'Depósito  de Cheque',
      source: 'semantic-analysis',
    });
    await servicio.record({
      tenantId: TENANT,
      rawValue: 'DEPOSITO DE CHEQUE',
      source: 'semantic-analysis',
    });

    expect(filas).toHaveLength(1);
    expect(filas[0].occurrenceCount).toBe(2);
  });

  it('separa el mismo valor cuando viene de orígenes distintos', async () => {
    const { servicio, filas } = armar();
    await servicio.record({ tenantId: TENANT, rawValue: 'X', source: 'semantic-analysis' });
    await servicio.record({ tenantId: TENANT, rawValue: 'X', source: 'code-import' });

    // Mismo texto, distinto proceso: son dos casos que se resuelven distinto.
    expect(filas).toHaveLength(2);
  });

  it('usa el upsert de la base y no un «buscar y crear», que es donde nacen los duplicados', async () => {
    const { servicio, client } = armar();
    await servicio.record({ tenantId: TENANT, rawValue: 'X', source: 'semantic-analysis' });

    expect(client.unresolvedClassification.upsert).toHaveBeenCalledTimes(1);
    expect(client.unresolvedClassification.findMany).not.toHaveBeenCalled();
  });
});

describe('UnresolvedResolution', () => {
  const TENANT = BigInt(1);

  function armar() {
    const pendiente: FilaFalsa = {
      id: BigInt(1),
      tenantId: TENANT,
      rawValue: 'Servicios Profesionales Independientes',
      normalizedValue: 'SERVICIOS PROFESIONALES INDEPENDIENTES',
      source: 'semantic-analysis',
      suggestedCategoryCode: 'GASTOS.PROFESIONALES',
      confidence: new Prisma.Decimal(0.91),
      occurrenceCount: 7,
      status: 'PENDING',
    };
    const { client, filas, alias } = prismaFalso([pendiente]);
    const notificaciones = { createMany: jest.fn(() => Promise.resolve(1)) };
    const deteccion = new UnresolvedClassificationService(
      client as never,
      config,
      notificaciones as never,
    );
    const categorias = { upsert: jest.fn(() => Promise.resolve({ code: 'GASTOS.NUEVA' })) };
    const resolucion = new UnresolvedResolutionService(
      client as never,
      categorias as never,
      deteccion,
    );
    return { resolucion, deteccion, client, filas, alias, categorias };
  }

  it('al asignar una categoría existente aprende el alias', async () => {
    const { resolucion, alias } = armar();

    await resolucion.resolve({
      tenantId: TENANT,
      id: '1',
      resolutionType: 'ASSIGN_EXISTING',
      categoryCode: 'GASTOS.PROFESIONALES',
      resolvedBy: 'pablo@atlas.internal',
    });

    expect(alias).toEqual([
      {
        tenantId: TENANT,
        entityType: 'CATEGORIA',
        alias: 'SERVICIOS PROFESIONALES INDEPENDIENTES',
        canonicalName: 'GASTOS.PROFESIONALES',
        isActive: true,
      },
    ]);
  });

  /*
   * El cierre del ciclo: lo que costó una decisión humana no vuelve a
   * preguntarse. Sin esto el administrador resolvería el mismo caso cada mes.
   */
  it('tras aprender el alias, el mismo valor se resuelve solo y no abre pendiente', async () => {
    const { resolucion, deteccion, filas, notificaciones: _notificaciones } = armar() as never as {
      resolucion: UnresolvedResolutionService;
      deteccion: UnresolvedClassificationService;
      filas: FilaFalsa[];
      notificaciones: { createMany: jest.Mock };
    };
    await resolucion.resolve({
      tenantId: TENANT,
      id: '1',
      resolutionType: 'ASSIGN_EXISTING',
      categoryCode: 'GASTOS.PROFESIONALES',
      resolvedBy: 'pablo@atlas.internal',
    });

    const resultado = await deteccion.record({
      tenantId: TENANT,
      rawValue: 'servicios profesionales independientes',
      source: 'semantic-analysis',
    });

    expect(resultado.status).toBe('AUTO_RESOLVED');
    expect(resultado.resolvedCategoryCode).toBe('GASTOS.PROFESIONALES');
    expect(filas).toHaveLength(1);
  });

  it('resolver dos veces el mismo pendiente no repite el efecto', async () => {
    const { resolucion, alias } = armar();
    const peticion = {
      tenantId: TENANT,
      id: '1',
      resolutionType: 'ASSIGN_EXISTING' as const,
      categoryCode: 'GASTOS.PROFESIONALES',
      resolvedBy: 'pablo@atlas.internal',
    };

    await resolucion.resolve(peticion);
    const segunda = await resolucion.resolve(peticion);

    expect(segunda.alreadyResolved).toBe(true);
    expect(alias).toHaveLength(1);
  });

  it('descartar cierra el caso sin enseñar ningún alias', async () => {
    const { resolucion, alias } = armar();

    const resultado = await resolucion.resolve({
      tenantId: TENANT,
      id: '1',
      resolutionType: 'DISCARD',
      resolvedBy: 'pablo@atlas.internal',
    });

    expect(resultado.status).toBe('IGNORED');
    // Descartar no es enseñar: no debe dejar alias que resuelva nada mañana.
    expect(alias).toHaveLength(0);
  });

  it('rechaza asignar una categoría que no existe', async () => {
    const { resolucion } = armar();

    await expect(
      resolucion.resolve({
        tenantId: TENANT,
        id: '1',
        resolutionType: 'ASSIGN_EXISTING',
        categoryCode: 'GASTOS.INVENTADA',
        resolvedBy: 'pablo@atlas.internal',
      }),
    ).rejects.toMatchObject({ code: 'SEMANTIC_CATEGORY_NOT_FOUND' });
  });

  it('crear una categoría la escribe y la deja como resolución', async () => {
    const { resolucion, categorias, alias } = armar();

    const resultado = await resolucion.resolve({
      tenantId: TENANT,
      id: '1',
      resolutionType: 'CREATE_CATEGORY',
      newCategory: {
        code: 'GASTOS.NUEVA',
        name: 'Nueva',
        description: 'Creada al resolver un pendiente.',
      } as never,
      resolvedBy: 'pablo@atlas.internal',
    });

    expect(categorias.upsert).toHaveBeenCalled();
    expect(resultado.categoryCode).toBe('GASTOS.NUEVA');
    expect(alias[0].canonicalName).toBe('GASTOS.NUEVA');
  });
});
