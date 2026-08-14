/**
 * El catálogo de categorías semánticas: quién puede tocarlo y qué pasa después de tocarlo.
 *
 * Sin prueba hasta ahora. Tiene dos invariantes que se rompen sin hacer ruido:
 *
 * 1. **El código de la ruta manda sobre el del cuerpo.** Si no, mandando un `code` distinto en
 *    el JSON se reescribe una categoría AJENA a la que se está editando — con la URL diciendo
 *    una cosa y el efecto siendo otra, que además es lo que quedaría en el registro de acceso.
 *
 * 2. **Toda escritura dispara la revisión de la bandeja de pendientes.** Es lo que evita el
 *    estado en el que la bandeja sigue pidiendo a mano términos que el motor ya sabe clasificar.
 *    Es un efecto secundario en segundo plano: si alguien añade un método de escritura y olvida
 *    envolverlo, nada falla y la bandeja simplemente deja de limpiarse sola.
 */
import 'reflect-metadata';
import { REQUIRED_ROLES } from '../src/common/security/security.decorators';
import { SemanticCategoryController } from '../src/modules/workers/semantic-analysis/semantic-category.controller';
import type { SemanticCategoryService } from '../src/modules/workers/semantic-analysis/semantic-category.service';
import type { UnresolvedReevaluationService } from '../src/modules/workers/semantic-analysis/unresolved-reevaluation.service';

const TENANT = 42n;

function rolesDe(metodo: keyof SemanticCategoryController): readonly string[] {
  return (
    (Reflect.getMetadata(REQUIRED_ROLES, SemanticCategoryController.prototype[metodo] as object) as
      string[] | undefined) ?? []
  );
}

describe('SemanticCategoryController · autorización', () => {
  it('leer el árbol es más amplio que escribirlo', () => {
    // QA y operaciones necesitan VER el catálogo para interpretar una clasificación; cambiarlo
    // es decidir cómo clasifica el motor, y eso es de riesgo y fraude.
    expect(rolesDe('list')).toEqual(
      expect.arrayContaining(['QA_ANALYST', 'OPERATIONS', 'RISK_ANALYST', 'FRAUD_ANALYST']),
    );
    for (const escritura of ['create', 'update', 'deactivate', 'import'] as const) {
      expect([...rolesDe(escritura)].sort()).toEqual(['FRAUD_ANALYST', 'RISK_ANALYST']);
    }
  });

  it('ninguna operación queda sin roles declarados', () => {
    for (const metodo of ['list', 'create', 'update', 'deactivate', 'import'] as const) {
      expect(rolesDe(metodo).length).toBeGreaterThan(0);
    }
  });
});

describe('SemanticCategoryController · efectos', () => {
  const categories = {
    list: jest.fn(),
    upsert: jest.fn(),
    deactivate: jest.fn(),
    importTree: jest.fn(),
  } as unknown as jest.Mocked<SemanticCategoryService>;
  const reevaluation = {
    scheduleAfterCatalogChange: jest.fn(),
  } as unknown as jest.Mocked<UnresolvedReevaluationService>;
  const controller = new SemanticCategoryController(categories, reevaluation);

  beforeEach(() => jest.clearAllMocks());

  it('el código de la RUTA gana al del cuerpo', async () => {
    // La invariante que impide reescribir una categoría distinta de la que dice la URL.
    (categories.upsert as jest.Mock).mockResolvedValue({ code: 'GASTO.SERVICIOS' });

    await controller.update(TENANT, 'GASTO.SERVICIOS', {
      code: 'GASTO.OTRO',
      label: 'Servicios',
    } as never);

    expect(categories.upsert).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ code: 'GASTO.SERVICIOS' }),
    );
  });

  it('crear, actualizar, desactivar e importar revisan la bandeja de pendientes', async () => {
    (categories.upsert as jest.Mock).mockResolvedValue({});
    (categories.deactivate as jest.Mock).mockResolvedValue({});
    (categories.importTree as jest.Mock).mockResolvedValue({ created: 0, updated: 0 });

    await controller.create(TENANT, { code: 'A', label: 'A' } as never);
    await controller.update(TENANT, 'A', { code: 'A', label: 'A' } as never);
    await controller.deactivate(TENANT, 'A');
    await controller.import(TENANT, { categories: [] } as never);

    // Cuatro escrituras, cuatro revisiones. Añadir una quinta y olvidar envolverla no rompe
    // nada visible: la bandeja simplemente deja de limpiarse sola, que es el defecto silencioso
    // que esta prueba existe para convertir en ruidoso.
    expect(reevaluation.scheduleAfterCatalogChange).toHaveBeenCalledTimes(4);
    expect(reevaluation.scheduleAfterCatalogChange).toHaveBeenCalledWith(TENANT);
  });

  it('LEER no dispara ninguna revisión', async () => {
    (categories.list as jest.Mock).mockResolvedValue([]);

    await controller.list(TENANT);

    // Consultar el catálogo no es cambiarlo. Si leerlo relanzara la revisión, abrir la pantalla
    // pondría al motor a reclasificar la bandeja entera una vez por visita.
    expect(reevaluation.scheduleAfterCatalogChange).not.toHaveBeenCalled();
  });

  it('la revisión ocurre DESPUÉS de escribir, y no bloquea la respuesta', async () => {
    const orden: string[] = [];
    (categories.upsert as jest.Mock).mockImplementation(async () => {
      orden.push('escritura');
      return {};
    });
    (reevaluation.scheduleAfterCatalogChange as jest.Mock).mockImplementation(() => {
      orden.push('revisión');
    });

    const salida = await controller.create(TENANT, { code: 'A', label: 'A' } as never);

    // El orden importa: revisar ANTES de escribir mediría el catálogo viejo, y la bandeja
    // seguiría pidiendo a mano lo que la categoría recién creada ya resuelve.
    expect(orden).toEqual(['escritura', 'revisión']);
    expect(salida).toEqual({});
  });
});
