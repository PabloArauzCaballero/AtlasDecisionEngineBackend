import { ConfigService } from '@nestjs/config';
import type { SemanticWorkerConfig } from '../src/modules/workers/semantic-analysis/core/config/semantic-worker.config';
import { SemanticConfigurationError } from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.errors';
import { buildSemanticModelProvider } from '../src/modules/workers/semantic-analysis/semantic-model-provider.bridge';

/**
 * Regresión del arranque.
 *
 * La fábrica del núcleo valida `OPENAI_API_KEY` al CONSTRUIR el proveedor.
 * Construirlo al cablear el módulo hacía que ningún proceso arrancara sin esa
 * clave —ni una réplica de API con el worker apagado, ni la generación del
 * contrato OpenAPI, que por eso publicaba un contrato sin `/v1/workers`—.
 */
describe('buildSemanticModelProvider', () => {
  // Holgado a propósito: el presupuesto por defecto NO da (ver la prueba del
  // final), y aquí se quiere ejercitar la construcción, no ese desajuste.
  const workerConfig = { analysisTimeoutSeconds: 200 } as SemanticWorkerConfig;

  /**
   * Variables que la fábrica del núcleo lee de `process.env` directamente.
   *
   * `test/setup-env.ts` carga el `.env` del repositorio en TODAS las pruebas, así
   * que un puesto de trabajo configurado de verdad —por ejemplo con un modelo
   * generativo local y un presupuesto de 600 s— hacía fallar esta prueba: la
   * construcción rechazaba el presupuesto holgado de 200 s que se fija aquí. El
   * fallo no decía nada del código, decía qué había en el `.env` de quien la
   * corría.
   */
  const AMBIENTALES = [
    'OPENAI_API_KEY',
    'SEMANTIC_PROVIDER_TIMEOUT_MS',
    'SEMANTIC_PROVIDER_MAX_ATTEMPTS',
    'SEMANTIC_FAST_MODEL',
    'SEMANTIC_DEEP_MODEL',
    'TRANSFORMER_BASE_URL',
    'SEMANTIC_TRANSFORMER_SIMILARITY_FLOOR',
    'SEMANTIC_TRANSFORMER_SIMILARITY_CEILING',
  ] as const;
  const original = new Map(AMBIENTALES.map((clave) => [clave, process.env[clave]]));

  beforeEach(() => {
    for (const clave of AMBIENTALES) delete process.env[clave];
  });

  afterEach(() => {
    for (const [clave, valor] of original) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
  });

  it('se construye sin credenciales mientras nadie clasifique', () => {
    delete process.env['OPENAI_API_KEY'];

    expect(() =>
      buildSemanticModelProvider(
        new ConfigService({ SEMANTIC_ANALYSIS_PROVIDER: 'openai' }),
        workerConfig,
      ),
    ).not.toThrow();
  });

  it('falla de forma permanente, y no reintentable, si se clasifica sin proveedor configurado', async () => {
    const provider = buildSemanticModelProvider(
      new ConfigService({ SEMANTIC_ANALYSIS_PROVIDER: '' }),
      workerConfig,
    );

    await expect(
      provider.classify({ text: 'hola', categories: [] } as never, 'fast' as never),
    ).rejects.toBeInstanceOf(SemanticConfigurationError);
  });

  // El mensaje no puede llevar el valor de ninguna variable: acaba en la
  // auditoría de la ejecución y en los registros del worker.
  it('no revela el valor de ninguna credencial al fallar', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-secreto-que-no-debe-salir';
    const provider = buildSemanticModelProvider(
      new ConfigService({ SEMANTIC_ANALYSIS_PROVIDER: '' }),
      workerConfig,
    );

    await expect(
      provider.classify({ text: 'hola', categories: [] } as never, 'fast' as never),
    ).rejects.toThrow(/^(?!.*sk-secreto).*$/s);
  });

  /**
   * El worker se registra según `SEMANTIC_ANALYSIS_PROVIDER`, pero el núcleo
   * absorbido lee `SEMANTIC_MODEL_PROVIDER` y asume `openai` por defecto. Sin
   * traducción, un despliegue con el clasificador de transformers arrancaba el
   * worker y luego intentaba clasificar contra OpenAI.
   */
  it('manda la variable del motor sobre la del núcleo', async () => {
    delete process.env['OPENAI_API_KEY'];
    const provider = buildSemanticModelProvider(
      new ConfigService({ SEMANTIC_ANALYSIS_PROVIDER: 'transformer' }),
      workerConfig,
    );

    // Con `transformer` no se exige credencial de OpenAI: si la traducción no
    // ocurriera, la fábrica caería en la rama OpenAI y fallaría por la clave.
    expect(() => provider.modelFor('fast' as never)).not.toThrow();
  });

  /**
   * El clasificador de transformers nombra su modelo antes de llamar, que es lo
   * que la métrica del camino de fallo necesita: sin `modelFor` un fallo de red
   * se atribuiría a `unknown` y la tasa de error dejaría de ser comparable entre
   * modelos.
   */
  it('el clasificador de transformers dice qué modelo atiende cada nivel', () => {
    process.env['SEMANTIC_TRANSFORMER_MODEL'] = 'intfloat/multilingual-e5-small';
    const provider = buildSemanticModelProvider(
      new ConfigService({ SEMANTIC_ANALYSIS_PROVIDER: 'transformer' }),
      workerConfig,
    );

    expect(provider.modelFor('FAST' as never)).toBe('intfloat/multilingual-e5-small');
    delete process.env['SEMANTIC_TRANSFORMER_MODEL'];
  });

  /**
   * Deuda registrada, no corregida aquí.
   *
   * `assertProviderTimeoutFitsAnalysis` exige que
   * `timeout × intentos × 2 tiers ≤ analysisTimeoutSeconds`. Con los valores por
   * defecto de OpenAI (30 s × 3 intentos × 2 = 180 s) y el presupuesto que sale
   * del lease por defecto (120 s − 10 = 110 s), la desigualdad no se cumple y la
   * primera clasificación falla con `SemanticConfigurationError`.
   *
   * Esta prueba fija la aritmética real para que el desajuste sea visible y
   * medible. Elegir el lado que se mueve —subir `SEMANTIC_ANALYSIS_LEASE_SECONDS`
   * o bajar `SEMANTIC_PROVIDER_*`— es una decisión del dueño del worker: un lease
   * más largo retrasa la recuperación de una ejecución muerta.
   */
  it('deja constancia de que el presupuesto por defecto no cuadra', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-para-esta-prueba';
    const defaultBudget = { analysisTimeoutSeconds: 110 } as SemanticWorkerConfig;
    const provider = buildSemanticModelProvider(
      new ConfigService({ SEMANTIC_ANALYSIS_PROVIDER: 'openai' }),
      defaultBudget,
    );

    await expect(
      provider.classify({ text: 'hola', categories: [] } as never, 'fast' as never),
    ).rejects.toBeInstanceOf(SemanticConfigurationError);
  });
});
