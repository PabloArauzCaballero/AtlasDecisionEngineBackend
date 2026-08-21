/**
 * Las tres salidas por las que un movimiento se quedaba sin categoría.
 *
 * El clasificador podía abstenerse por tres motivos que no tienen nada que ver
 * entre sí, y los tres acababan igual —una fila vacía en el informe—:
 *
 * 1. El modelo respondió y ninguna candidata alcanzó su umbral.
 * 2. El presupuesto del tenant se agotó y no llegó a preguntarse nada.
 * 3. El análisis tardó más que su reloj y murió a medias.
 *
 * Los tres se cierran aquí, y con la misma pieza: las reglas deterministas, que
 * no consultan a nadie. Lo que este fichero comprueba no es que las reglas
 * acierten —eso es `semantic-cobertura-categorias.spec.ts`— sino que el pipeline
 * las USE en las tres salidas, y que al hacerlo diga de dónde salió la decisión
 * en vez de disfrazarla de acierto del modelo.
 */
import { DecisionEngine } from '../src/modules/workers/semantic-analysis/core/application/decision-engine';
import { GlosaFallbackClassifier } from '../src/modules/workers/semantic-analysis/core/application/glosa-fallback';
import { SemanticAnalysisPipeline } from '../src/modules/workers/semantic-analysis/core/application/semantic-analysis.pipeline';
import { SemanticAnalysisResultBuilder } from '../src/modules/workers/semantic-analysis/core/application/semantic-analysis.result-builder';
import { SemanticTimeoutError } from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.errors';
import type {
  ModelClassification,
  SemanticAnalysisRequest,
  SemanticCategory,
} from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.types';
import type { SemanticWorkerConfig } from '../src/modules/workers/semantic-analysis/core/config/semantic-worker.config';
import type { TracingService } from '../src/common/observability/tracing.service';

/** Un catálogo mínimo con lo que las reglas de este fichero necesitan. */
function categoria(code: string, parentCode: string | null): SemanticCategory {
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
    acceptanceThreshold: 0.6,
    version: 1,
  };
}

const CATEGORIAS: readonly SemanticCategory[] = [
  categoria('GASTOS', null),
  categoria('GASTOS.VIVIENDA.SERVICIOS', 'GASTOS'),
  categoria('GASTOS.TRANSFERENCIAS', 'GASTOS'),
  categoria('GASTOS.OTROS', 'GASTOS'),
  categoria('INGRESOS', null),
  categoria('INGRESOS.OTROS', 'INGRESOS'),
];

/** Traza que no traza: ejecuta la operación y olvida los atributos. */
const TRAZA = {
  runInSpan: <T>(_nombre: string, _atributos: unknown, operacion: (span: unknown) => T): T =>
    operacion({ setAttribute: () => undefined, setAttributes: () => undefined }),
  setAttributes: () => undefined,
} as unknown as TracingService;

interface Montaje {
  pipeline: SemanticAnalysisPipeline;
  classify: jest.Mock;
}

function montar(
  opciones: {
    classify?: jest.Mock;
    presupuestoAgotado?: boolean;
    atajoActivo?: boolean;
    rescateActivo?: boolean;
  } = {},
): Montaje {
  const classify =
    opciones.classify ??
    jest.fn().mockResolvedValue({
      assessments: [],
      model: 'modelo-de-prueba',
      modelVersion: '1',
    } satisfies ModelClassification);

  const config = {
    analysisTimeoutSeconds: 30,
    ambiguityMargin: 0.08,
    candidateLimit: 8,
    ruleFastPathEnabled: opciones.atajoActivo ?? true,
    timeoutRescueEnabled: opciones.rescateActivo ?? true,
  } as unknown as SemanticWorkerConfig;

  const metricas = {
    recordAnalysis: jest.fn(),
    recordProviderCall: jest.fn(),
  };

  const pipeline = new SemanticAnalysisPipeline(
    { classify, modelFor: () => 'modelo-de-prueba' } as never,
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
      reserve: () =>
        Promise.resolve(
          opciones.presupuestoAgotado === true
            ? { allowed: false, reason: 'cuota agotada' }
            : { allowed: true },
        ),
      recordProviderCalls: () => Promise.resolve(),
    } as never,
    { normalize: (texto: string) => texto, forClassification: (texto: string) => texto } as never,
    { resolve: () => [] } as never,
    new DecisionEngine(),
    TRAZA,
    new SemanticAnalysisResultBuilder(metricas as never, TRAZA),
    new GlosaFallbackClassifier(),
  );

  return { pipeline, classify };
}

function peticion(text: string): SemanticAnalysisRequest {
  return {
    requestId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'idem-de-prueba',
    text,
    tenantId: '1',
  };
}

describe('el modelo no resolvió: deciden las reglas y se marca para revisión', () => {
  it('publica lo que el instrumento afirma en vez de abstenerse', async () => {
    const { pipeline } = montar();

    const resultado = await pipeline.analyze(peticion('TRASPASO CA/CC A TERCEROS'));

    expect(resultado.status).toBe('MATCH');
    expect(resultado.matches[0]?.categoryCode).toBe('GASTOS.TRANSFERENCIAS');
    expect(resultado.decidedBy).toBe('RULE');
    // Categoría Y revisión: no abstenerse sólo vale si se dice que se dedujo.
    expect(resultado.requiresReview).toBe(true);
    expect(resultado.reviewReason).toBe('LOW_CONFIDENCE');
  });

  it('sin rubro ni instrumento cae al cajón, y el cajón se declara', async () => {
    const { pipeline } = montar();

    const resultado = await pipeline.analyze(peticion('DEBITO VARIOS 0093'));

    expect(resultado.matches[0]?.categoryCode).toBe('GASTOS.OTROS');
    expect(resultado.decidedBy).toBe('BIN');
    expect(resultado.requiresReview).toBe(true);
  });
});

describe('el atajo por rubro literal', () => {
  it('resuelve sin llamar al modelo ni una vez', async () => {
    const { pipeline, classify } = montar();

    const resultado = await pipeline.analyze(peticion('PAGO SERVICIO ELFEC COD 4471'));

    expect(classify).not.toHaveBeenCalled();
    expect(resultado.matches[0]?.categoryCode).toBe('GASTOS.VIVIENDA.SERVICIOS');
    expect(resultado.decidedBy).toBe('RULE');
    // Un nombre propio leído literalmente no necesita que nadie lo confirme.
    expect(resultado.requiresReview).toBe(false);
  });

  it('apagado, la misma glosa vuelve a pasar por el modelo', async () => {
    const { pipeline, classify } = montar({ atajoActivo: false });

    await pipeline.analyze(peticion('PAGO SERVICIO ELFEC COD 4471'));

    expect(classify).toHaveBeenCalled();
  });
});

describe('el presupuesto agotado ya no vacía la fila', () => {
  it('clasifica por reglas sin gastar la cuota que el límite protege', async () => {
    const { pipeline, classify } = montar({ presupuestoAgotado: true });

    const resultado = await pipeline.analyze(peticion('TRASPASO A CUENTA DE TERCEROS'));

    expect(classify).not.toHaveBeenCalled();
    expect(resultado.matches[0]?.categoryCode).toBe('GASTOS.TRANSFERENCIAS');
    expect(resultado.requiresReview).toBe(true);
    expect(resultado.reviewReason).toBe('PROCESSING_ERROR');
  });
});

describe('tardar demasiado deja de ser un fallo terminal', () => {
  const lento = () =>
    jest.fn().mockRejectedValue(new SemanticTimeoutError('el análisis superó 30 s'));

  it('rescata la glosa por reglas y la marca con motivo TIMEOUT', async () => {
    const { pipeline } = montar({ classify: lento() });

    const resultado = await pipeline.analyze(peticion('TRASPASO CA/CC A TERCEROS'));

    expect(resultado.matches[0]?.categoryCode).toBe('GASTOS.TRANSFERENCIAS');
    expect(resultado.reviewReason).toBe('TIMEOUT');
    expect(resultado.requiresReview).toBe(true);
  });

  it('apagado el rescate, vuelve a fallar como antes', async () => {
    const { pipeline } = montar({ classify: lento(), rescateActivo: false });

    await expect(pipeline.analyze(peticion('TRASPASO CA/CC A TERCEROS'))).rejects.toBeInstanceOf(
      SemanticTimeoutError,
    );
  });

  it('un error del proveedor NO se rescata: sigue fallando y reintentándose', async () => {
    // Ahí no se sabe qué habría dicho el modelo, y fingir una respuesta
    // escondería una caída detrás de miles de «otros gastos».
    const roto = jest.fn().mockRejectedValue(new Error('el proveedor devolvió 500'));
    const { pipeline } = montar({ classify: roto });

    await expect(pipeline.analyze(peticion('TRASPASO CA/CC A TERCEROS'))).rejects.toThrow(
      'el proveedor devolvió 500',
    );
  });
});
