import type { PrismaService } from '../src/common/prisma/prisma.service';
import { FinancialInstitutionService } from '../src/modules/workers/bank-statement/institutions/financial-institution.service';
import type { InstitutionCatalogService } from '../src/modules/workers/bank-statement/institutions/institution-catalog.service';
import { institutionLogoSeed } from '../src/modules/workers/bank-statement/institutions/institution-logo-seed';

/**
 * La sincronización de logotipos, y en concreto QUÉ filas toca.
 *
 * ## Por qué existe esta batería
 *
 * Porque la regla original —«escribe sólo donde no hay bytes»— hacía que
 * conseguir la marca real de una cooperativa no sirviera para nada: la
 * sincronización encontraba el monograma que ella misma había puesto, lo daba
 * por logotipo y se saltaba la fila para siempre. El padrón se quedaba con
 * cuadrados de tres letras y la única salida era borrarlos a mano, uno por uno.
 * Es un fallo que no se ve: la pantalla sigue enseñando una imagen en cada fila.
 *
 * Las tres reglas que se prueban aquí son las que no pueden cambiar sin que
 * alguien lo decida:
 *
 * 1. Un **monograma** se reemplaza cuando la semilla ya trae el logotipo oficial.
 * 2. Un logotipo **cargado a mano** no se toca nunca: es trabajo de una persona.
 * 3. Una entidad cuya semilla **sigue siendo un monograma** no se reescribe: no
 *    hay nada mejor que ponerle y sólo movería la fecha.
 */

interface Fila {
  id: bigint;
  code: string;
  logoData: Uint8Array | null;
  logoSource: string | null;
  website: string | null;
}

interface Escenario {
  service: FinancialInstitutionService;
  escritas: () => string[];
}

function montar(filas: Fila[]): Escenario {
  const escritas: string[] = [];
  const prisma = {
    financialInstitution: {
      findMany: () => Promise.resolve(filas),
      update: ({ where }: { where: { id: bigint } }) => {
        const fila = filas.find((f) => f.id === where.id);
        escritas.push(fila?.code ?? '¿?');
        return Promise.resolve({});
      },
    },
  } as unknown as PrismaService;
  const catalog = { invalidate: () => undefined } as unknown as InstitutionCatalogService;
  return { service: new FinancialInstitutionService(prisma, catalog), escritas: () => escritas };
}

/*
 * Los códigos salen de la semilla REAL y no de constantes escritas aquí: lo que
 * se prueba es la regla, y una sigla fijada a mano convertiría cada logotipo
 * nuevo del repositorio en una prueba roja sin que nada se hubiera roto.
 */
const seed = institutionLogoSeed();
const oficial = seed.find((s) => s.source === 'DOWNLOADED');
const monograma = seed.find((s) => s.source === 'GENERATED');

describe('sincronización de logotipos del padrón', () => {
  it('reemplaza el monograma cuando la semilla ya trae el logotipo oficial', async () => {
    if (!oficial) throw new Error('La semilla no trae ningún logotipo oficial.');
    const { service, escritas } = montar([
      {
        id: 1n,
        code: oficial.code,
        logoData: new Uint8Array([1, 2, 3]),
        logoSource: 'GENERATED',
        website: null,
      },
    ]);

    const resultado = await service.syncLogos(1n, false, 'analista');

    expect(escritas()).toEqual([oficial.code]);
    expect(resultado.applied).toContain(oficial.code);
    // `upgraded` va aparte: es lo único que distingue «cargué doce» de «cambié
    // doce» en un padrón donde todas las filas ya enseñaban una imagen.
    expect(resultado.upgraded).toContain(oficial.code);
  });

  it('NO pisa un logotipo cargado a mano, aunque la semilla traiga el oficial', async () => {
    if (!oficial) throw new Error('La semilla no trae ningún logotipo oficial.');
    const { service, escritas } = montar([
      {
        id: 1n,
        code: oficial.code,
        logoData: new Uint8Array([1, 2, 3]),
        logoSource: 'UPLOADED',
        website: null,
      },
    ]);

    const resultado = await service.syncLogos(1n, false, 'analista');

    expect(escritas()).toEqual([]);
    expect(resultado.applied).not.toContain(oficial.code);
  });

  it('no reescribe la entidad cuya semilla sigue siendo un monograma', async () => {
    if (!monograma) return; // Cuando ya no quede ninguna, esta regla deja de aplicar.
    const { service, escritas } = montar([
      {
        id: 1n,
        code: monograma.code,
        logoData: new Uint8Array([1, 2, 3]),
        logoSource: 'GENERATED',
        website: null,
      },
    ]);

    const resultado = await service.syncLogos(1n, false, 'analista');

    expect(escritas()).toEqual([]);
    expect(resultado.upgraded).toEqual([]);
  });

  it('con un ensayo no escribe nada y responde qué haría', async () => {
    if (!oficial) throw new Error('La semilla no trae ningún logotipo oficial.');
    const { service, escritas } = montar([
      { id: 1n, code: oficial.code, logoData: null, logoSource: null, website: null },
    ]);

    const resultado = await service.syncLogos(1n, true, 'analista');

    expect(escritas()).toEqual([]);
    expect(resultado.dryRun).toBe(true);
    expect(resultado.applied).toEqual([oficial.code]);
  });
});
