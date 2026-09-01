import { Prisma } from '@prisma/client';
import { SemanticCategoryService } from '../src/modules/workers/semantic-analysis/semantic-category.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Que editar una categoría cambie la FIRMA del catálogo.
 *
 * ## Por qué esto tiene prueba propia
 *
 * La firma es `code@version` por categoría (`CatalogCache.signatureOf`), y de
 * ella cuelgan la caché de clasificación y los vectores de sonda del
 * recuperador. Si la versión no sube al editar, la firma no cambia y las dos
 * siguen sirviendo lo que calcularon con los ejemplos ANTERIORES.
 *
 * El defecto no se parece a un defecto, y ésa es la razón de la prueba: el
 * import responde `updated: [...]`, la fila queda escrita con sus ejemplos
 * nuevos y todo indica que funcionó. Lo único que no pasa es que el motor los
 * use.
 *
 * Medido el 2026-09-01 sobre diez extractos bolivianos: añadir quince comercios
 * a dos hojas y reclasificar dio CERO cambios. Reiniciando el worker —lo único
 * que vacía esas cachés— los mismos quince ejemplos corrigieron trece
 * movimientos. La configuración promete justo lo contrario: «su clave incluye la
 * firma del catálogo, así que publicar una categoría invalida lo afectado sola».
 */

const TENANT = 42n;

function categoria(overrides: Record<string, unknown> = {}) {
  return {
    code: 'GASTOS.ALIMENTACION.CAFETERIA',
    name: 'Cafetería',
    description: 'Consumo en cafeterías y panaderías.',
    positiveExamples: ['CONSUMO EN CAFETERIA', 'COMPRA AGRICAFE'],
    ...overrides,
  };
}

/** Prisma reducido a lo que estas dos rutas tocan. */
function montar() {
  const upsert = jest.fn().mockResolvedValue({
    ...categoria(),
    parentCode: 'GASTOS.ALIMENTACION',
    counterExamples: [],
    restrictions: [],
    relatedCategoryCodes: [],
    acceptanceThreshold: new Prisma.Decimal(0.62),
    version: 2,
    isActive: true,
  });
  const prisma = {
    semanticCategory: {
      upsert,
      findMany: jest.fn().mockResolvedValue([{ code: 'GASTOS.ALIMENTACION.CAFETERIA' }]),
      findFirst: jest.fn().mockResolvedValue({ code: 'GASTOS.ALIMENTACION' }),
      findUnique: jest.fn().mockResolvedValue({ code: 'GASTOS.ALIMENTACION' }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ semanticCategory: { upsert } }),
    ),
  } as unknown as PrismaService;
  return { service: new SemanticCategoryService(prisma), upsert };
}

describe('el catálogo sube de versión al editarse, para que la firma cambie', () => {
  it('sube la versión al ACTUALIZAR desde el import', async () => {
    const { service, upsert } = montar();

    await service.importTree(TENANT, { categories: [categoria()] as never });

    expect(upsert).toHaveBeenCalledTimes(1);
    const { update } = upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> };
    expect(update.version).toEqual({ increment: 1 });
  });

  it('sube la versión al ACTUALIZAR una categoría suelta', async () => {
    const { service, upsert } = montar();

    await service.upsert(TENANT, categoria({ parentCode: 'GASTOS.ALIMENTACION' }) as never);

    const { update } = upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> };
    expect(update.version).toEqual({ increment: 1 });
  });

  /*
   * Al CREAR no se incrementa nada: la fila nace en 1, y la firma cambia igual
   * porque cambia el número de categorías y aparece un código nuevo.
   */
  it('no toca la versión al crear', async () => {
    const { service, upsert } = montar();

    await service.upsert(TENANT, categoria({ parentCode: 'GASTOS.ALIMENTACION' }) as never);

    // `create` y `update` son las dos ramas del MISMO upsert: sólo la segunda
    // incrementa. La fila nueva nace en 1 y la firma cambia igual, porque
    // aparece un código que antes no estaba.
    const { create } = upsert.mock.calls[0]?.[0] as { create: Record<string, unknown> };
    expect(create).not.toHaveProperty('version');
  });

  /*
   * Una versión explícita sigue mandando. Es la vía para reimportar un conjunto
   * con sus versiones tal cual —una instantánea de la rama de semillas— sin
   * inflarlas una unidad en cada pasada.
   */
  it('respeta la versión que venga escrita en el lote', async () => {
    const { service, upsert } = montar();

    await service.importTree(TENANT, { categories: [categoria({ version: 7 })] as never });

    const { update } = upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> };
    expect(update.version).toBe(7);
  });
});
