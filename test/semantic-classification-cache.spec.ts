import { ClassificationCache } from '../src/modules/workers/semantic-analysis/core/application/classification-cache';
import type { CachedClassification } from '../src/modules/workers/semantic-analysis/core/application/classification-cache';
import type { SemanticWorkerConfig } from '../src/modules/workers/semantic-analysis/core/config/semantic-worker.config';

/**
 * La memoria de glosas ya clasificadas.
 *
 * Lo que se prueba aquí no es que recuerde —eso es un `Map`— sino las tres
 * condiciones que hacen que recordar sea SEGURO: que un catálogo distinto no
 * comparta memoria, que un tenant no lea la de otro, y que apagarla devuelva el
 * comportamiento anterior. Sin las dos primeras, la caché sería un fallo de
 * corrección disfrazado de mejora de latencia.
 */

const VEREDICTO: CachedClassification = {
  decision: {
    status: 'MATCH',
    requiresDeepAnalysis: false,
    matches: [
      {
        categoryCode: 'GASTOS.ALIMENTACION.SUPERMERCADO',
        confidence: 0.91,
        supported: true,
        contradicted: false,
        evidence: ['COMPRA EN SUPERMERCADO'],
        rationale: 'Se parece al enunciado de la categoría.',
      },
    ],
  },
  candidates: [],
  tier: 'FAST',
  model: 'modelo-de-prueba',
  modelVersion: 'modelo-de-prueba@fast',
  escalated: false,
};

function cache(
  overrides: Partial<
    Pick<SemanticWorkerConfig, 'classificationCacheTtlSeconds' | 'classificationCacheSize'>
  > = {},
): ClassificationCache {
  return new ClassificationCache({
    classificationCacheTtlSeconds: 3_600,
    classificationCacheSize: 100,
    ...overrides,
  } as SemanticWorkerConfig);
}

describe('ClassificationCache', () => {
  it('devuelve el veredicto guardado para la misma glosa', () => {
    const memoria = cache();
    memoria.write('7', 'firma-1', 'COMPRA EN SUPERMERCADO', VEREDICTO);

    expect(memoria.read('7', 'firma-1', 'COMPRA EN SUPERMERCADO')).toEqual(VEREDICTO);
  });

  /**
   * La razón de ser de la firma en la clave.
   *
   * Es lo que separa esta caché de la deduplicación permanente que ya hacía la
   * cola, y que obligaba a la pantalla del extracto a esquivarla: un veredicto
   * calculado contra un catálogo viejo se seguía sirviendo después de sembrar la
   * categoría que faltaba, y la tabla insistía en «Sin determinar» sobre
   * movimientos que el motor ya sabía clasificar.
   */
  it('no reutiliza el veredicto cuando el catálogo cambió', () => {
    const memoria = cache();
    memoria.write('7', 'firma-1', 'COMPRA EN SUPERMERCADO', VEREDICTO);

    expect(memoria.read('7', 'firma-2', 'COMPRA EN SUPERMERCADO')).toBeUndefined();
  });

  /** Dos tenants con la misma glosa tienen catálogos distintos y no se cruzan. */
  it('no sirve a un tenant lo que clasificó otro', () => {
    const memoria = cache();
    memoria.write('7', 'firma-1', 'COMPRA EN SUPERMERCADO', VEREDICTO);

    expect(memoria.read('8', 'firma-1', 'COMPRA EN SUPERMERCADO')).toBeUndefined();
  });

  it('olvida lo caducado', () => {
    const memoria = cache({ classificationCacheTtlSeconds: 1 });
    const ahora = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    memoria.write('7', 'firma-1', 'COMPRA EN SUPERMERCADO', VEREDICTO);

    ahora.mockReturnValue(2_500);
    expect(memoria.read('7', 'firma-1', 'COMPRA EN SUPERMERCADO')).toBeUndefined();
    ahora.mockRestore();
  });

  /**
   * El desalojo se lleva la entrada menos usada, no la más antigua de escritura:
   * una glosa que aparece en todos los extractos debe sobrevivir a la ráfaga de
   * glosas únicas que la rodea.
   */
  it('conserva lo que se sigue leyendo y desaloja lo demás', () => {
    const memoria = cache({ classificationCacheSize: 2 });
    memoria.write('7', 'f', 'FRECUENTE', VEREDICTO);
    memoria.write('7', 'f', 'RARA', VEREDICTO);

    memoria.read('7', 'f', 'FRECUENTE');
    memoria.write('7', 'f', 'NUEVA', VEREDICTO);

    expect(memoria.read('7', 'f', 'FRECUENTE')).toEqual(VEREDICTO);
    expect(memoria.read('7', 'f', 'NUEVA')).toEqual(VEREDICTO);
    expect(memoria.read('7', 'f', 'RARA')).toBeUndefined();
    expect(memoria.size).toBe(2);
  });

  it('no guarda nada con la caché desactivada', () => {
    for (const apagada of [{ classificationCacheTtlSeconds: 0 }, { classificationCacheSize: 0 }]) {
      const memoria = cache(apagada);
      memoria.write('7', 'firma-1', 'COMPRA EN SUPERMERCADO', VEREDICTO);

      expect(memoria.isEnabled).toBe(false);
      expect(memoria.read('7', 'firma-1', 'COMPRA EN SUPERMERCADO')).toBeUndefined();
    }
  });
});
