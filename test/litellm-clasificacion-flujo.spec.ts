/**
 * El flujo completo con el gateway detrás del puerto.
 *
 * Aquí NO se sustituye el proveedor por un doble: se monta el adaptador real de
 * LiteLLM y se le pone delante un `fetch` que responde como respondería el
 * proxy. Lo único simulado es el cable. Así lo que se comprueba es el sistema
 * que se despliega —adaptador, esquema, decisión, red de seguridad por reglas y
 * bandeja— y no una maqueta que se parece a él.
 *
 * Lo que estas pruebas fijan, en una frase: **la IA no puede empeorar el
 * resultado**. Si el motor determinista ya sabía la respuesta, no se la pide a
 * nadie; y si el gateway falla de cualquiera de las maneras en que un servicio
 * externo falla, el caso termina delante de una persona con el motivo escrito.
 */
import { DecisionEngine } from '../src/modules/workers/semantic-analysis/core/application/decision-engine';
import { GlosaFallbackClassifier } from '../src/modules/workers/semantic-analysis/core/application/glosa-fallback';
import { SemanticAnalysisPipeline } from '../src/modules/workers/semantic-analysis/core/application/semantic-analysis.pipeline';
import { SemanticAnalysisProcessor } from '../src/modules/workers/semantic-analysis/core/application/semantic-analysis.processor';
import { SemanticAnalysisResultBuilder } from '../src/modules/workers/semantic-analysis/core/application/semantic-analysis.result-builder';
import { LiteLlmSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/litellm/litellm-semantic.provider';
import type {
  SemanticAnalysisRequest,
  SemanticAnalysisResult,
  SemanticCategory,
} from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.types';
import type { SemanticWorkerConfig } from '../src/modules/workers/semantic-analysis/core/config/semantic-worker.config';
import type { TracingService } from '../src/common/observability/tracing.service';

function categoria(code: string, parentCode: string | null, umbral = 0.85): SemanticCategory {
  return {
    id: code,
    code,
    name: code,
    description: code,
    parentCode,
    positiveExamples: [],
    counterExamples: [],
    restrictions: [],
    relatedCategoryCodes: [],
    acceptanceThreshold: umbral,
    version: 1,
  };
}

const CATEGORIAS: readonly SemanticCategory[] = [
  categoria('GASTOS', null),
  categoria('GASTOS.SUPERMERCADO', 'GASTOS'),
  categoria('GASTOS.VIVIENDA.SERVICIOS', 'GASTOS'),
  categoria('GASTOS.TRANSFERENCIAS', 'GASTOS'),
  categoria('GASTOS.OTROS', 'GASTOS'),
  categoria('INGRESOS', null),
  categoria('INGRESOS.OTROS', 'INGRESOS'),
];

const TRAZA = {
  runInSpan: <T>(_nombre: string, _atributos: unknown, operacion: (span: unknown) => T): T =>
    operacion({ setAttribute: () => undefined, setAttributes: () => undefined }),
  setAttributes: () => undefined,
  recordException: () => undefined,
} as unknown as TracingService;

function respuestaModelo(categoryCode: string, confidence: number): Response {
  return new Response(
    JSON.stringify({
      model: 'gemini-2.0-flash',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              assessments: [
                {
                  categoryCode,
                  confidence,
                  supported: confidence >= 0.5,
                  contradicted: false,
                  evidence: ['HIPERMAXI'],
                  rationale: 'Cadena de supermercados.',
                },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 300, completion_tokens: 20, total_tokens: 320 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

interface Montaje {
  procesar: (texto: string) => Promise<SemanticAnalysisResult | Error>;
  peticionesHttp: () => number;
  pendientes: { rawValue: string; context: Record<string, unknown> }[];
}

/**
 * Monta el worker entero contra un gateway simulado.
 *
 * `gateway` decide qué contesta el proxy en cada intento; devolver una función
 * que lanza simula una caída de red.
 */
function montar(gateway: () => Response | Promise<Response>): Montaje {
  let peticiones = 0;
  const fetchImplementation = (async () => {
    peticiones += 1;
    return gateway();
  }) as unknown as typeof fetch;

  const provider = new LiteLlmSemanticProvider({
    apiKey: 'sk-gateway',
    baseUrl: 'http://litellm:4000/v1',
    fastModel: 'semantic-classifier-fast',
    deepModel: 'semantic-classifier-deep',
    maxAttempts: 1,
    initialBackoffMs: 1,
    maxBackoffMs: 2,
    randomSource: () => 0,
    fetchImplementation,
  });

  const config = {
    analysisTimeoutSeconds: 30,
    ambiguityMargin: 0.08,
    candidateLimit: 8,
    ruleFastPathEnabled: true,
    timeoutRescueEnabled: true,
  } as unknown as SemanticWorkerConfig;

  const metricas = {
    recordAnalysis: jest.fn(),
    recordProviderCall: jest.fn(),
    recordFailure: jest.fn(),
    recordReviewEscalation: jest.fn(),
  };

  const pipeline = new SemanticAnalysisPipeline(
    provider,
    config,
    metricas as never,
    {
      retrieve: (_texto: string, categorias: readonly SemanticCategory[]) =>
        Promise.resolve(categorias.map((category) => ({ category, retrievalScore: 0.5 }))),
    } as never,
    {
      load: () => Promise.resolve({ categories: CATEGORIAS, aliases: [], signature: 'v1' }),
    } as never,
    { read: () => undefined, write: () => undefined } as never,
    {
      reserve: () => Promise.resolve({ allowed: true }),
      recordProviderCalls: () => Promise.resolve(),
    } as never,
    { normalize: (texto: string) => texto, forClassification: (texto: string) => texto } as never,
    { resolve: () => [] } as never,
    new DecisionEngine(),
    TRAZA,
    new SemanticAnalysisResultBuilder(metricas as never, TRAZA),
    new GlosaFallbackClassifier(),
  );

  const pendientes: { rawValue: string; context: Record<string, unknown> }[] = [];
  const processor = new SemanticAnalysisProcessor(
    {
      claim: () => Promise.resolve({ state: 'ACQUIRED' as const }),
      complete: () => Promise.resolve(),
      fail: () => Promise.resolve(),
    } as never,
    metricas as never,
    pipeline,
    TRAZA,
    {
      record: (input: { rawValue: string; context?: Record<string, unknown> }) => {
        pendientes.push({ rawValue: input.rawValue, context: input.context ?? {} });
        return Promise.resolve(undefined);
      },
    },
  );

  let ultimo: SemanticAnalysisResult | undefined;

  return {
    pendientes,
    peticionesHttp: () => peticiones,
    procesar: async (texto: string) => {
      const request: SemanticAnalysisRequest = {
        requestId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: 'idem-de-prueba-litellm',
        text: texto,
        tenantId: '1',
      };
      ultimo = undefined;
      try {
        ultimo = await pipeline.analyze(request);
      } catch {
        /* el processor vuelve a ejecutarlo y clasifica el fallo */
      }
      const error = await processor.execute(request).then(
        () => undefined,
        (e: unknown) => e as Error,
      );
      return ultimo ?? error ?? new Error('sin resultado');
    },
  };
}

/** Sólo los pendientes son visibles desde fuera; el motivo va en su contexto. */
function motivos(montaje: Montaje): string[] {
  return montaje.pendientes.map((p) => String(p.context.reason));
}

describe('1. El motor determinista sigue mandando', () => {
  it('un rubro literal se resuelve SIN llamar al gateway ni una vez', async () => {
    const montaje = montar(() => respuestaModelo('GASTOS.SUPERMERCADO', 0.99));

    const resultado = (await montaje.procesar(
      'PAGO SERVICIO ELFEC COD 4471',
    )) as SemanticAnalysisResult;

    // Cero peticiones HTTP: cero tokens y cero latencia de red.
    expect(montaje.peticionesHttp()).toBe(0);
    expect(resultado.matches[0]?.categoryCode).toBe('GASTOS.VIVIENDA.SERVICIOS');
    expect(resultado.decidedBy).toBe('RULE');
    expect(resultado.requiresReview).toBe(false);
    expect(montaje.pendientes).toHaveLength(0);
  });

  it('la IA NUNCA reemplaza un resultado determinista ya resuelto', async () => {
    // El gateway propondría otra cosa con toda la confianza del mundo; nadie
    // se lo pregunta.
    const montaje = montar(() => respuestaModelo('GASTOS.SUPERMERCADO', 1));

    const resultado = (await montaje.procesar(
      'PAGO SERVICIO ELFEC COD 4471',
    )) as SemanticAnalysisResult;

    expect(resultado.matches[0]?.categoryCode).not.toBe('GASTOS.SUPERMERCADO');
  });
});

describe('2. Caso desconocido con una respuesta fiable del gateway', () => {
  it('acepta la categoría propuesta y la publica como decidida por el MODELO', async () => {
    const montaje = montar(() => respuestaModelo('GASTOS.SUPERMERCADO', 0.97));

    const resultado = (await montaje.procesar(
      'COMPRA HIPERMAXI EQUIPETROL',
    )) as SemanticAnalysisResult;

    expect(montaje.peticionesHttp()).toBeGreaterThan(0);
    expect(resultado.matches[0]?.categoryCode).toBe('GASTOS.SUPERMERCADO');
    expect(resultado.decidedBy).toBe('MODEL');
    expect(resultado.requiresReview).toBe(false);
    // El alias lógico es lo que se publica y lo que agrupa los tableros.
    expect(resultado.model).toBe('semantic-classifier-fast');
    expect(montaje.pendientes).toHaveLength(0);
  });
});

describe('3-8. Todo lo demás termina delante de una persona', () => {
  it('baja confianza → revisión, y con una categoría honesta puesta', async () => {
    const montaje = montar(() => respuestaModelo('GASTOS.SUPERMERCADO', 0.42));

    const resultado = (await montaje.procesar(
      'COMPRA HIPERMAXI EQUIPETROL',
    )) as SemanticAnalysisResult;

    expect(resultado.requiresReview).toBe(true);
    // No se inventa nada: el cajón por sentido, declarado como tal.
    expect(resultado.decidedBy).toBe('BIN');
    expect(motivos(montaje)).toEqual(['LOW_CONFIDENCE']);
  });

  it('categoría inexistente → revisión: la respuesta se descarta entera', async () => {
    const montaje = montar(() => respuestaModelo('GASTOS.CRIPTOMONEDAS', 0.99));

    await montaje.procesar('COMPRA HIPERMAXI EQUIPETROL');

    expect(motivos(montaje)).toEqual(['PROCESSING_ERROR']);
    expect(montaje.pendientes[0].rawValue).toBe('COMPRA HIPERMAXI EQUIPETROL');
  });

  it('JSON inválido → revisión', async () => {
    const montaje = montar(
      () =>
        new Response(
          JSON.stringify({
            model: 'gemini-2.0-flash',
            choices: [{ finish_reason: 'stop', message: { content: '<html>502</html>' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    await montaje.procesar('COMPRA HIPERMAXI EQUIPETROL');

    expect(motivos(montaje)).toEqual(['PROCESSING_ERROR']);
  });

  it('429 del gateway → revisión', async () => {
    const montaje = montar(
      () =>
        new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429 }),
    );

    await montaje.procesar('COMPRA HIPERMAXI EQUIPETROL');

    expect(motivos(montaje)).toEqual(['PROCESSING_ERROR']);
  });

  it('500 del gateway → revisión', async () => {
    const montaje = montar(() => new Response('', { status: 500 }));

    await montaje.procesar('COMPRA HIPERMAXI EQUIPETROL');

    expect(motivos(montaje)).toEqual(['PROCESSING_ERROR']);
  });

  it('gateway CAÍDO (conexión rechazada) → revisión, no una categoría inventada', async () => {
    const montaje = montar(() => {
      throw new Error('fetch failed: ECONNREFUSED');
    });

    await montaje.procesar('COMPRA HIPERMAXI EQUIPETROL');

    expect(motivos(montaje)).toEqual(['PROCESSING_ERROR']);
  });

  it('el pendiente guarda el texto original y su correlación, nunca la credencial', async () => {
    const montaje = montar(() => new Response('', { status: 503 }));

    await montaje.procesar('COMPRA HIPERMAXI EQUIPETROL');

    const pendiente = montaje.pendientes[0];
    expect(pendiente.context.requestId).toBe('11111111-1111-4111-8111-111111111111');
    expect(JSON.stringify(pendiente)).not.toContain('sk-gateway');
  });
});
