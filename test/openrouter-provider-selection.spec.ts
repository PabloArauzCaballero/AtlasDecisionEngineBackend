import {
  DEFAULT_OPENROUTER_DEEP_MODEL,
  DEFAULT_OPENROUTER_FAST_MODEL,
  loadOpenRouterProviderOptions,
} from '../src/modules/workers/semantic-analysis/core/config/openrouter-provider.config';
import {
  buildRemoteGatewayProvider,
  loadModelProviders,
} from '../src/modules/workers/semantic-analysis/core/config/model-provider.factory';
import { OpenRouterSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/openrouter/openrouter-semantic.provider';
import { LiteLlmSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/litellm/litellm-semantic.provider';
import { CascadingSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/cascade/cascading-semantic.provider';
import { SemanticConfigurationError } from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.errors';
import type { SemanticWorkerConfig } from '../src/modules/workers/semantic-analysis/core/config/semantic-worker.config';

/**
 * La selección de OpenRouter y su configuración.
 *
 * Es la imagen especular de `litellm-provider-selection`: allí se protege que
 * el motor pida un ALIAS; aquí, que pida un MODELO FÍSICO con la forma que
 * OpenRouter resuelve. Y lo que no cambia: que nadie transfiera datos fuera
 * del país sin declararlo.
 */

const CONFIG = { retrievalMode: 'lexical', analysisTimeoutSeconds: 300 } as SemanticWorkerConfig;

const ENTORNO_BASE = {
  SEMANTIC_MODEL_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: 'sk-or-v1-prueba',
} satisfies NodeJS.ProcessEnv;

describe('loadOpenRouterProviderOptions', () => {
  it('usa los modelos por omisión y la URL pública de OpenRouter', () => {
    const options = loadOpenRouterProviderOptions(ENTORNO_BASE);

    expect(options.fastModel).toBe(DEFAULT_OPENROUTER_FAST_MODEL);
    expect(options.deepModel).toBe(DEFAULT_OPENROUTER_DEEP_MODEL);
    expect(options.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('exige la credencial', () => {
    expect(() => loadOpenRouterProviderOptions({})).toThrow();
  });

  it.each([
    ['openai/gpt-4.1-mini'],
    ['anthropic/claude-sonnet-4.5'],
    ['google/gemini-2.5-flash'],
    ['meta-llama/llama-3.3-70b-instruct'],
    ['openai/gpt-4o-mini:free'],
    ['openrouter/auto'],
  ])('acepta %s: tiene la forma proveedor/modelo', (modelo) => {
    expect(() =>
      loadOpenRouterProviderOptions({ ...ENTORNO_BASE, OPENROUTER_FAST_MODEL: modelo }),
    ).not.toThrow();
  });

  it.each([['gpt-4.1-mini'], ['semantic-classifier-fast'], ['openai/'], ['/gpt-4'], ['a/b/c']])(
    'rechaza %s: OpenRouter no resuelve alias ni nombres sin proveedor',
    (modelo) => {
      expect(() =>
        loadOpenRouterProviderOptions({ ...ENTORNO_BASE, OPENROUTER_DEEP_MODEL: modelo }),
      ).toThrow(SemanticConfigurationError);
    },
  );

  it('sólo lleva atribución cuando se configura', () => {
    expect(loadOpenRouterProviderOptions(ENTORNO_BASE).appUrl).toBeUndefined();
    const con = loadOpenRouterProviderOptions({
      ...ENTORNO_BASE,
      OPENROUTER_APP_URL: 'https://atlas.example',
      OPENROUTER_APP_TITLE: 'Atlas',
    });
    expect(con.appUrl).toBe('https://atlas.example');
    expect(con.appTitle).toBe('Atlas');
  });
});

describe('loadModelProviders con SEMANTIC_MODEL_PROVIDER=openrouter', () => {
  it('construye el adaptador de OpenRouter', () => {
    const { modelProvider } = loadModelProviders(ENTORNO_BASE, CONFIG);

    expect(modelProvider).toBeInstanceOf(OpenRouterSemanticProvider);
    expect(modelProvider.modelFor?.('FAST')).toBe(DEFAULT_OPENROUTER_FAST_MODEL);
  });

  it('rechaza una configuración cuyo peor caso no cabe en el presupuesto del análisis', () => {
    expect(() =>
      loadModelProviders(
        { ...ENTORNO_BASE, OPENROUTER_TIMEOUT_MS: '60000', OPENROUTER_MAX_ATTEMPTS: '4' },
        { ...CONFIG, analysisTimeoutSeconds: 90 },
      ),
    ).toThrow(/excede analysisTimeoutSeconds/u);
  });

  it('en producción exige declarar la transferencia internacional', () => {
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

  it('con el recuperador híbrido exige declarar de dónde salen los embeddings', () => {
    // OpenRouter no da embeddings. Heredar el proveedor construiría un cliente
    // que falla en la primera recuperación, y mejor fallar al construir.
    expect(() => loadModelProviders(ENTORNO_BASE, { ...CONFIG, retrievalMode: 'hybrid' })).toThrow(
      /no ofrece embeddings/u,
    );
  });
});

describe('la cascada elige su escalón remoto', () => {
  const CASCADA = {
    SEMANTIC_MODEL_PROVIDER: 'cascade',
    LITELLM_API_KEY: 'sk-gateway',
    OPENROUTER_API_KEY: 'sk-or-v1-prueba',
  } satisfies NodeJS.ProcessEnv;

  it('por omisión sigue escalando al gateway propio, como antes', () => {
    const { modelProvider } = loadModelProviders(CASCADA, CONFIG);

    expect(modelProvider).toBeInstanceOf(CascadingSemanticProvider);
    expect(modelProvider.modelFor?.('DEEP')).toBe('semantic-classifier-deep');
  });

  it('con SEMANTIC_CASCADE_REMOTE_PROVIDER=openrouter escala a OpenRouter', () => {
    const { modelProvider } = loadModelProviders(
      { ...CASCADA, SEMANTIC_CASCADE_REMOTE_PROVIDER: 'openrouter' },
      CONFIG,
    );

    expect(modelProvider).toBeInstanceOf(CascadingSemanticProvider);
    expect(modelProvider.modelFor?.('DEEP')).toBe(DEFAULT_OPENROUTER_DEEP_MODEL);
  });

  it('no exige la credencial del gateway que NO va a usar', () => {
    expect(() =>
      loadModelProviders(
        {
          SEMANTIC_MODEL_PROVIDER: 'cascade',
          SEMANTIC_CASCADE_REMOTE_PROVIDER: 'openrouter',
          OPENROUTER_API_KEY: 'sk-or-v1-prueba',
        },
        CONFIG,
      ),
    ).not.toThrow();
  });

  it('buildRemoteGatewayProvider construye el mismo adaptador que el entorno', () => {
    expect(buildRemoteGatewayProvider('litellm', CASCADA, CONFIG)).toBeInstanceOf(
      LiteLlmSemanticProvider,
    );
    expect(buildRemoteGatewayProvider('openrouter', CASCADA, CONFIG)).toBeInstanceOf(
      OpenRouterSemanticProvider,
    );
  });
});
