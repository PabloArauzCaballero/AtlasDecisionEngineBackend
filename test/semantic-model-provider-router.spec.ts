import { ConfigService } from '@nestjs/config';
import type { SemanticWorkerConfig } from '../src/modules/workers/semantic-analysis/core/config/semantic-worker.config';
import { CascadingSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/cascade/cascading-semantic.provider';
import { LiteLlmSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/litellm/litellm-semantic.provider';
import { OpenRouterSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/openrouter/openrouter-semantic.provider';
import type { EffectiveModelSettings } from '../src/modules/workers/semantic-analysis/model-settings/semantic-model-settings.service';
import {
  buildSemanticModelProvider,
  type ModelSettingsSource,
} from '../src/modules/workers/semantic-analysis/semantic-model-provider.bridge';

/**
 * El puente enruta por la configuración del portal.
 *
 * Lo que se protege: que la elección del portal MANDE sobre el entorno cuando
 * aplica, que un cambio de versión reconstruya el adaptador y vacíe la caché de
 * veredictos, y que en los modos sin gateway remoto el portal no toque nada.
 */

const workerConfig = {
  analysisTimeoutSeconds: 300,
  retrievalMode: 'lexical',
} as SemanticWorkerConfig;

const AMBIENTALES = [
  'LITELLM_API_KEY',
  'LITELLM_BASE_URL',
  'LITELLM_FAST_MODEL',
  'LITELLM_DEEP_MODEL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_FAST_MODEL',
  'OPENROUTER_DEEP_MODEL',
  'SEMANTIC_CASCADE_REMOTE_PROVIDER',
  'TRANSFORMER_BASE_URL',
] as const;
const original = new Map(AMBIENTALES.map((clave) => [clave, process.env[clave]]));

beforeEach(() => {
  for (const clave of AMBIENTALES) delete process.env[clave];
  process.env['LITELLM_API_KEY'] = 'sk-gateway';
  process.env['OPENROUTER_API_KEY'] = 'sk-or-v1-prueba';
});

afterEach(() => {
  for (const [clave, valor] of original) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
});

function ajustes(
  inicial: EffectiveModelSettings,
  applies = true,
): ModelSettingsSource & { cambiar(a: EffectiveModelSettings): void } {
  let actual = inicial;
  const oyentes = new Set<(s: EffectiveModelSettings) => void>();
  return {
    applies: () => applies,
    current: () => Promise.resolve(actual),
    peek: () => actual,
    onChange: (l) => {
      oyentes.add(l);
      return () => oyentes.delete(l);
    },
    cambiar(a) {
      actual = a;
      for (const l of oyentes) l(a);
    },
  };
}

function efectiva(
  gateway: 'litellm' | 'openrouter',
  version: number,
  fastModel = gateway === 'openrouter' ? 'openai/gpt-4.1-mini' : 'semantic-classifier-fast',
  deepModel = gateway === 'openrouter' ? 'anthropic/claude-sonnet-4.5' : 'semantic-classifier-deep',
): EffectiveModelSettings {
  return {
    gateway,
    fastModel,
    deepModel,
    source: version === 0 ? 'environment' : 'portal',
    version,
    updatedBy: null,
    updatedAt: null,
  };
}

/** Lo que devuelve el puente al construir, sin llamar a ningún proveedor. */
async function construido(
  provider: ReturnType<typeof buildSemanticModelProvider>,
): Promise<unknown> {
  // `provider()` es privado; `modelFor` fuerza la construcción y la cachea.
  provider.modelFor('FAST');
  return (provider as unknown as { resolved?: { provider: unknown } }).resolved?.provider;
}

describe('el puente con la configuración del portal', () => {
  it('en directo, el gateway elegido en el portal manda sobre el del entorno', async () => {
    const provider = buildSemanticModelProvider(
      new ConfigService({ SEMANTIC_ANALYSIS_PROVIDER: 'litellm' }),
      workerConfig,
      ajustes(efectiva('openrouter', 1, 'google/gemini-2.5-flash')),
    );

    expect(await construido(provider)).toBeInstanceOf(OpenRouterSemanticProvider);
    expect(provider.modelFor('FAST')).toBe('google/gemini-2.5-flash');
  });

  it('en cascada, el portal cambia el escalón remoto y deja el local', async () => {
    process.env['TRANSFORMER_BASE_URL'] = 'http://transformer:80';
    const provider = buildSemanticModelProvider(
      new ConfigService({ SEMANTIC_ANALYSIS_PROVIDER: 'cascade' }),
      workerConfig,
      ajustes(efectiva('openrouter', 3)),
    );

    expect(await construido(provider)).toBeInstanceOf(CascadingSemanticProvider);
    expect(provider.modelFor('DEEP')).toBe('anthropic/claude-sonnet-4.5');
  });

  it('un cambio de versión reconstruye el adaptador y vacía la caché de veredictos', async () => {
    const fuente = ajustes(efectiva('litellm', 1));
    let vaciada = 0;
    const provider = buildSemanticModelProvider(
      new ConfigService({ SEMANTIC_ANALYSIS_PROVIDER: 'litellm' }),
      workerConfig,
      fuente,
      { clear: () => (vaciada += 1) },
    );
    expect(await construido(provider)).toBeInstanceOf(LiteLlmSemanticProvider);

    fuente.cambiar(efectiva('openrouter', 2));

    expect(vaciada).toBe(1);
    expect(await construido(provider)).toBeInstanceOf(OpenRouterSemanticProvider);
  });

  it('con la misma versión no reconstruye: el adaptador se reutiliza', async () => {
    const provider = buildSemanticModelProvider(
      new ConfigService({ SEMANTIC_ANALYSIS_PROVIDER: 'openrouter' }),
      workerConfig,
      ajustes(efectiva('openrouter', 5)),
    );

    const primero = await construido(provider);
    const segundo = await construido(provider);

    expect(segundo).toBe(primero);
  });

  it('en un modo sin gateway remoto, el portal no toca nada', async () => {
    process.env['TRANSFORMER_BASE_URL'] = 'http://transformer:80';
    process.env['SEMANTIC_TRANSFORMER_MODEL'] = 'intfloat/multilingual-e5-small';
    const provider = buildSemanticModelProvider(
      new ConfigService({ SEMANTIC_ANALYSIS_PROVIDER: 'transformer' }),
      workerConfig,
      ajustes(efectiva('openrouter', 9), false),
    );

    expect(provider.modelFor('FAST')).toBe('intfloat/multilingual-e5-small');
    delete process.env['SEMANTIC_TRANSFORMER_MODEL'];
  });

  it('sin fuente de configuración se comporta como antes: sólo entorno', async () => {
    const provider = buildSemanticModelProvider(
      new ConfigService({ SEMANTIC_ANALYSIS_PROVIDER: 'litellm' }),
      workerConfig,
    );

    expect(await construido(provider)).toBeInstanceOf(LiteLlmSemanticProvider);
  });
});
