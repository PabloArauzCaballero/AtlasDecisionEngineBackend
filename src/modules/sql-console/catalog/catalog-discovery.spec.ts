/**
 * Lo que esta batería fija es la promesa que hizo que el catálogo dejara de escribirse a mano:
 * una vista que la base publique aparece SOLA, y una que no acote por inquilino no aparece
 * nunca — pero se dice que existe y por qué no se sirve.
 *
 * Se inyecta un Prisma falso en vez de una base real porque lo que hay que fijar es la
 * DECISIÓN sobre cada fila del catálogo de Postgres, no que Postgres sepa responder.
 *
 * Y conviene saber lo que esto NO cubre, porque ya mordió: con Prisma simulado la consulta no
 * se ejecuta nunca, así que estas pruebas pasaron enteras mientras la de verdad reventaba con
 * `UnsupportedNativeDataType` —`nspname`, `relname` y `attname` son del tipo `name`, que el
 * adaptador rechaza, y hubo que castearlos a `text`—. Lo encontró una corrida contra la base
 * viva, no esta batería. Si tocas la consulta, córrela contra una base de verdad.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { CatalogDiscoveryService } from './catalog-discovery.service';

type Fila = {
  schema: string;
  schema_description: string | null;
  relation: string;
  relation_description: string | null;
  filters_tenant: boolean;
  column_name: string;
  data_type: string;
  column_description: string | null;
};

function fila(parcial: Partial<Fila> & Pick<Fila, 'schema' | 'relation' | 'column_name'>): Fila {
  return {
    schema_description: null,
    relation_description: null,
    filters_tenant: true,
    data_type: 'text',
    column_description: null,
    ...parcial,
  };
}

function servicio(filas: Fila[]) {
  const prisma = { $queryRaw: () => Promise.resolve(filas) } as unknown as PrismaService;
  return new CatalogDiscoveryService(prisma);
}

describe('CatalogDiscoveryService — una vista nueva no necesita un despliegue', () => {
  it('sirve una vista que nadie declaró en la ficha, con la descripción de su COMMENT', async () => {
    const { datasets, relations } = await servicio([
      fila({
        schema: 'riesgo',
        relation: 'exposicion_por_producto',
        relation_description: 'Exposición viva por producto.',
        column_name: 'producto',
      }),
    ]).catalog();

    const tabla = datasets[0]?.tables[0];
    expect(tabla?.name).toBe('exposicion_por_producto');
    expect(tabla?.description).toBe('Exposición viva por producto.');
    expect(relations.has('riesgo.exposicion_por_producto')).toBe(true);
    // El nombre suelto también: el `search_path` cubre los datasets, así que `FROM
    // exposicion_por_producto` es válido y la guardia tiene que admitirlo.
    expect(relations.has('exposicion_por_producto')).toBe(true);
  });

  it('deja el grano en null antes que inventarlo', async () => {
    const { datasets } = await servicio([
      fila({ schema: 'riesgo', relation: 'exposicion_por_producto', column_name: 'producto' }),
    ]).catalog();

    // Un grano derivado del nombre se leería igual que uno comprobado, y es la afirmación que
    // hace que alguien cuente mal sin enterarse.
    expect(datasets[0]?.tables[0]?.grain).toBeNull();
  });

  it('dice que la vista no está descrita en vez de inventarle una frase', async () => {
    const { datasets } = await servicio([
      fila({ schema: 'riesgo', relation: 'sin_ficha', column_name: 'x' }),
    ]).catalog();

    expect(datasets[0]?.tables[0]?.description).toContain('COMMENT ON VIEW riesgo.sin_ficha');
  });

  it('deduce la clase de la columna del tipo de Postgres', async () => {
    const { datasets } = await servicio([
      fila({
        schema: 'riesgo',
        relation: 'nueva',
        column_name: 'creada_en',
        data_type: 'timestamp with time zone',
      }),
      fila({ schema: 'riesgo', relation: 'nueva', column_name: 'activa', data_type: 'boolean' }),
      fila({
        schema: 'riesgo',
        relation: 'nueva',
        column_name: 'monto',
        data_type: 'numeric(18,2)',
      }),
      fila({ schema: 'riesgo', relation: 'nueva', column_name: 'cuantos', data_type: 'integer' }),
    ]).catalog();

    expect(datasets[0]?.tables[0]?.columns.map((c) => c.kind)).toEqual([
      'fecha',
      'booleano',
      'numero',
      'entero',
    ]);
  });
});

describe('CatalogDiscoveryService — lo que no acota por inquilino no se sirve', () => {
  const sinFiltro = [
    fila({
      schema: 'riesgo',
      relation: 'exposicion_global',
      filters_tenant: false,
      column_name: 'monto',
    }),
  ];

  it('la descarta del catálogo y de la lista blanca de la guardia', async () => {
    const { datasets, relations } = await servicio(sinFiltro).catalog();

    expect(datasets).toHaveLength(0);
    // Lo que importa: si la guardia la admitiera, la consulta llegaría a una vista sin
    // `WHERE tenant_id = atlas_current_tenant()` y devolvería filas de otras organizaciones.
    expect(relations.has('riesgo.exposicion_global')).toBe(false);
  });

  it('informa de que existe y por qué no se sirve', async () => {
    const { omitted } = await servicio(sinFiltro).catalog();

    expect(omitted).toHaveLength(1);
    expect(omitted[0]?.name).toBe('riesgo.exposicion_global');
    expect(omitted[0]?.reason).toContain('atlas_current_tenant');
  });
});

describe('CatalogDiscoveryService — la ficha escrita a mano manda sobre la prosa', () => {
  it('usa la descripción y el grano declarados para una relación conocida', async () => {
    const { datasets } = await servicio([
      fila({
        schema: 'decisiones',
        relation: 'ejecuciones',
        relation_description: 'Lo que diga el COMMENT.',
        column_name: 'ejecucion_id',
      }),
    ]).catalog();

    const tabla = datasets[0]?.tables[0];
    expect(tabla?.grain).toBe('Una fila = una decisión ejecutada por el motor.');
    expect(tabla?.description).toContain('Una fila por decisión tomada');
    expect(tabla?.columns[0]?.description).toContain('Identificador de la ejecución');
  });

  it('no publica una columna que la ficha describe y la base ya no tiene', async () => {
    const { datasets } = await servicio([
      fila({ schema: 'decisiones', relation: 'ejecuciones', column_name: 'ejecucion_id' }),
    ]).catalog();

    // La ficha describe decenas de columnas de esta vista. Sale UNA: la que la base publica.
    expect(datasets[0]?.tables[0]?.columns.map((c) => c.name)).toEqual(['ejecucion_id']);
  });
});

describe('CatalogDiscoveryService — cuando la base no contesta lo que debe', () => {
  it('falla en vez de servir un catálogo vacío', async () => {
    /*
     * Un catálogo vacío no es un catálogo pequeño: deja el explorador en blanco y la guardia
     * rechazándolo TODO, y lo que llega a quien consulta es «esa tabla no existe» sobre la
     * base entera. Casi siempre son migraciones sin correr, y eso es lo que hay que decir.
     */
    await expect(servicio([]).catalog()).rejects.toThrow(ServiceUnavailableException);
  });

  it('no cachea el fallo: el siguiente intento vuelve a preguntar', async () => {
    let respuesta: Fila[] = [];
    const prisma = { $queryRaw: () => Promise.resolve(respuesta) } as unknown as PrismaService;
    const service = new CatalogDiscoveryService(prisma);

    await expect(service.catalog()).rejects.toThrow(ServiceUnavailableException);
    respuesta = [fila({ schema: 'riesgo', relation: 'nueva', column_name: 'x' })];

    // Cachear el fallo dejaría la consola muerta hasta el siguiente despliegue, por una
    // migración que se corrió treinta segundos después de arrancar el proceso.
    await expect(service.catalog()).resolves.toBeDefined();
  });

  it('cachea el acierto: el catálogo cambia con una migración, no entre peticiones', async () => {
    let llamadas = 0;
    const prisma = {
      $queryRaw: () => {
        llamadas += 1;
        return Promise.resolve([fila({ schema: 'riesgo', relation: 'nueva', column_name: 'x' })]);
      },
    } as unknown as PrismaService;
    const service = new CatalogDiscoveryService(prisma);

    await service.catalog();
    await service.catalog();
    expect(llamadas).toBe(1);

    service.invalidate();
    await service.catalog();
    expect(llamadas).toBe(2);
  });
});
