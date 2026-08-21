import {
  loadLiteLlmEmbeddingOptions,
  loadLiteLlmProviderOptions,
} from '../src/modules/workers/semantic-analysis/core/config/litellm-provider.config';
import { loadModelProviders } from '../src/modules/workers/semantic-analysis/core/config/model-provider.factory';
import { LiteLlmSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/litellm/litellm-semantic.provider';
import { CascadingSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/cascade/cascading-semantic.provider';
import { SemanticConfigurationError } from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.errors';
import type { SemanticWorkerConfig } from '../src/modules/workers/semantic-analysis/core/config/semantic-worker.config';

/**
 * La selección del gateway y su configuración.
 *
 * Lo que se protege aquí no es que el objeto se construya, sino las dos
 * propiedades que hacen que la integración valga la pena: que el motor pida un
 * alias LÓGICO y que nadie transfiera datos fuera del país sin declararlo.
 */

const CONFIG = { retrievalMode: 'lexical', analysisTimeoutSeconds: 300 } as SemanticWorkerConfig;

const ENTORNO_BASE = {
  SEMANTIC_MODEL_PROVIDER: 'litellm',
  LITELLM_API_KEY: 'sk-gateway',
  LITELLM_BASE_URL: 'http://litellm:4000/v1',
} satisfies NodeJS.ProcessEnv;

describe('loadLiteLlmProviderOptions', () => {
  it('usa los alias lógicos por omisión, que son los de infra/litellm/config.yaml', () => {
    const options = loadLiteLlmProviderOptions(ENTORNO_BASE);

    expect(options.fastModel).toBe('semantic-classifier-fast');
    expect(options.deepModel).toBe('semantic-classifier-deep');
  });

  it('exige la credencial del gateway', () => {
    expect(() =>
      loadLiteLlmProviderOptions({ LITELLM_BASE_URL: 'http://litellm:4000/v1' }),
    ).toThrow();
  });

  it.each([
    ['gpt-4.1-mini'],
    ['claude-sonnet-4'],
    ['gemini-2.0-flash'],
    ['openai/gpt-4.1'],
    ['vertex_ai/gemini-2.0-flash'],
  ])('rechaza %s: es un modelo FÍSICO donde va un alias', (modelo) => {
    expect(() =>
      loadLiteLlmProviderOptions({ ...ENTORNO_BASE, LITELLM_FAST_MODEL: modelo }),
    ).toThrow(SemanticConfigurationError);
  });

  it('acepta un alias propio que no parezca un modelo físico', () => {
    const options = loadLiteLlmProviderOptions({
      ...ENTORNO_BASE,
      LITELLM_FAST_MODEL: 'clasificador-glosas-barato',
      LITELLM_DEEP_MODEL: 'clasificador-glosas-profundo',
    });

    expect(options.fastModel).toBe('clasificador-glosas-barato');
  });

  it('aplica el mismo criterio al alias de embeddings', () => {
    expect(() =>
      loadLiteLlmEmbeddingOptions({
        ...ENTORNO_BASE,
        LITELLM_EMBEDDING_MODEL: 'text-embedding-3-small',
      }),
    ).not.toThrow();
    expect(() =>
      loadLiteLlmEmbeddingOptions({
        ...ENTORNO_BASE,
        LITELLM_EMBEDDING_MODEL: 'openai/text-embedding-3-small',
      }),
    ).toThrow(SemanticConfigurationError);
  });
});

describe('loadModelProviders con SEMANTIC_MODEL_PROVIDER=litellm', () => {
  it('construye el adaptador del gateway', () => {
    const { modelProvider } = loadModelProviders(ENTORNO_BASE, CONFIG);

    expect(modelProvider).toBeInstanceOf(LiteLlmSemanticProvider);
    expect(modelProvider.modelFor?.('FAST')).toBe('semantic-classifier-fast');
  });

  it('rechaza una configuración cuyo peor caso no cabe en el presupuesto del análisis', () => {
    expect(() =>
      loadModelProviders(
        { ...ENTORNO_BASE, LITELLM_TIMEOUT_MS: '60000', LITELLM_MAX_ATTEMPTS: '4' },
        { ...CONFIG, analysisTimeoutSeconds: 90 },
      ),
    ).toThrow(/excede analysisTimeoutSeconds/u);
  });

  it('en producción exige declarar la transferencia internacional', () => {
    // El proxy corre dentro del perímetro, pero sus alias apuntan a proveedores
    // de fuera y el motor ya no puede verlo: tratarlo como local dejaría la
    // decisión en un YAML que nadie audita como tal.
    expect(() => loadModelProviders({ ...ENTORNO_BASE, NODE_ENV: 'production' }, CONFIG)).toThrow(
      /transferencia internacional/u,
    );

    expect(() =>
      loadModelProviders(
        { ...ENTORNO_BASE, NODE_ENV: 'production', SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER: 'true' },
        CONFIG,
      ),
    ).not.toThrow();
  });

  it('`cascade` construye el compuesto local-primero, no el gateway a secas', () => {
    const { modelProvider } = loadModelProviders(
      { ...ENTORNO_BASE, SEMANTIC_MODEL_PROVIDER: 'cascade' },
      CONFIG,
    );

    expect(modelProvider).toBeInstanceOf(CascadingSemanticProvider);
    // El nivel rápido lo atiende el codificador local; el profundo, el alias del gateway.
    expect(modelProvider.modelFor?.('DEEP')).toBe('semantic-classifier-deep');
  });

  it('`cascade` tampoco se exime de declarar la transferencia internacional', () => {
    // Empieza en local, pero escala fuera: basta con que una glosa sea difícil para
    // que su texto salga del país.
    expect(() =>
      loadModelProviders(
        { ...ENTORNO_BASE, SEMANTIC_MODEL_PROVIDER: 'cascade', NODE_ENV: 'production' },
        CONFIG,
      ),
    ).toThrow(/transferencia internacional/u);
  });

  it('sigue construyendo `transformer` y `openai` como antes', () => {
    expect(() =>
      loadModelProviders({ SEMANTIC_MODEL_PROVIDER: 'transformer' }, CONFIG),
    ).not.toThrow();
    expect(() =>
      loadModelProviders({ SEMANTIC_MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }, CONFIG),
    ).not.toThrow();
  });
});
