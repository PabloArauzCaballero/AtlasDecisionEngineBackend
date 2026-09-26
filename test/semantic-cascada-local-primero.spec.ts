/**
 * El LLM sólo entra cuando el clasificador local no puede o tarda demasiado.
 *
 * Es la regla de coste del worker y, dicha de otra forma, la razón por la que la
 * factura no crece con el número de movimientos sino con los que resultan
 * difíciles. Por eso se fija aquí y no se deja a la configuración: un despliegue
 * que preguntara al modelo grande por cada glosa funcionaría igual de bien y
 * costaría un orden de magnitud más, y nada lo delataría salvo la factura.
 *
 * Se monta el compuesto REAL con dos dobles a los lados, de modo que lo que se
 * comprueba es su criterio y no la calidad de ningún modelo concreto.
 */
import { CascadingSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/cascade/cascading-semantic.provider';
import { DecisionEngine } from '../src/modules/workers/semantic-analysis/core/application/decision-engine';
import type {
  CategoryAssessment,
  ModelClassification,
  ModelClassificationInput,
  SemanticCategory,
} from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.types';
import type { SemanticModelProvider } from '../src/modules/workers/semantic-analysis/core/application/ports';

function categoria(code: string, umbral = 0.8): SemanticCategory {
  return {
    id: code,
    code,
    name: code,
    description: code,
    parentCode: null,
    positiveExamples: [],
    counterExamples: [],
    restrictions: [],
    relatedCategoryCodes: [],
    acceptanceThreshold: umbral,
    version: 1,
  };
}

const CATEGORIAS = [categoria('GASTOS.SUPERMERCADO'), categoria('GASTOS.RESTAURANTE')];

const ENTRADA: ModelClassificationInput = {
  originalText: 'PAGO POS 000834 HIPERMAXI EQUIPETROL SCZ 23992',
  normalizedText: 'HIPERMAXI EQUIPETROL',
  entities: [],
  candidates: CATEGORIAS.map((category) => ({ category, retrievalScore: 0.5 })),
};

function juicio(code: string, confidence: number): CategoryAssessment {
  return {
    categoryCode: code,
    confidence,
    supported: true,
    contradicted: false,
    evidence: ['HIPERMAXI'],
    rationale: 'r',
  };
}

function respuesta(model: string, assessments: CategoryAssessment[]): ModelClassification {
  return { assessments, model, modelVersion: model };
}

/** Doble de proveedor que cuenta sus llamadas y puede tardar o fallar a voluntad. */
function doble(
  nombre: string,
  comportamiento: { assessments?: CategoryAssessment[]; demoraMs?: number; falla?: Error } = {},
): SemanticModelProvider & { llamadas: number } {
  const provider = {
    llamadas: 0,
    modelFor: () => nombre,
    async classify(
      _input: ModelClassificationInput,
      _tier: 'FAST' | 'DEEP',
      signal?: AbortSignal,
    ): Promise<ModelClassification> {
      provider.llamadas += 1;
      if (comportamiento.falla) throw comportamiento.falla;
      if (comportamiento.demoraMs !== undefined) {
        // Respeta el AbortSignal: es lo que permite comprobar que el compuesto
        // ABANDONA de verdad al local y no sólo deja de esperarlo.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, comportamiento.demoraMs);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            const abortError = new Error('abortado');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        });
      }
      return respuesta(nombre, comportamiento.assessments ?? []);
    },
  };
  return provider;
}

function montar(local: SemanticModelProvider, remote: SemanticModelProvider, localTimeoutMs = 50) {
  return new CascadingSemanticProvider({ local, remote, localTimeoutMs });
}

const motor = new DecisionEngine();

/** Lo que hace el pipeline: decidir, y escalar sólo si la decisión lo pide. */
function resuelveEnRapido(classification: ModelClassification): boolean {
  return !motor.decide(classification.assessments, CATEGORIAS, 0.08, 'FAST').requiresDeepAnalysis;
}

describe('el clasificador local manda', () => {
  it('si el local resuelve, al LLM no se le pregunta NUNCA', async () => {
    const local = doble('e5-small', { assessments: [juicio('GASTOS.SUPERMERCADO', 0.96)] });
    const remoto = doble('semantic-classifier-fast');
    const cascada = montar(local, remoto);

    const fast = await cascada.classify(ENTRADA, 'FAST');

    expect(local.llamadas).toBe(1);
    expect(remoto.llamadas).toBe(0);
    // Y el motor de decisión confirma que aquí se acaba: no hay escalada.
    expect(resuelveEnRapido(fast)).toBe(true);
  });

  it('el nivel rápido lo atiende el local, no el gateway', async () => {
    const local = doble('e5-small', { assessments: [juicio('GASTOS.SUPERMERCADO', 0.96)] });
    const remoto = doble('semantic-classifier-fast');
    const cascada = montar(local, remoto);

    const fast = await cascada.classify(ENTRADA, 'FAST');

    expect(fast.model).toBe('e5-small');
    expect(cascada.modelFor('FAST')).toBe('e5-small');
  });
});

describe('el LLM entra sólo cuando el local no puede', () => {
  it('respuesta débil del local: sus juicios viajan intactos y el motor escala', async () => {
    // Confianza por debajo del umbral: el local SÍ respondió, así que su evidencia
    // no se toca. Quien decide que no basta es el motor de decisión.
    const local = doble('e5-small', { assessments: [juicio('GASTOS.SUPERMERCADO', 0.41)] });
    const remoto = doble('semantic-classifier-fast');
    const cascada = montar(local, remoto);

    const fast = await cascada.classify(ENTRADA, 'FAST');

    expect(fast.assessments).toHaveLength(1);
    expect(fast.assessments[0].confidence).toBe(0.41);
    expect(remoto.llamadas).toBe(0); // todavía no: escalar es cosa del pipeline
    expect(resuelveEnRapido(fast)).toBe(false); // ...y el motor pide el escalón
  });

  it('el nivel profundo lo atiende el gateway, y el local no se repite', async () => {
    const local = doble('e5-small', { assessments: [juicio('GASTOS.SUPERMERCADO', 0.41)] });
    const remoto = doble('semantic-classifier-deep', {
      assessments: [juicio('GASTOS.SUPERMERCADO', 0.97)],
    });
    const cascada = montar(local, remoto);

    const deep = await cascada.classify(ENTRADA, 'DEEP');

    expect(remoto.llamadas).toBe(1);
    expect(local.llamadas).toBe(0); // repetirlo daría la misma respuesta que no bastó
    expect(deep.model).toBe('semantic-classifier-deep');
  });

  it('local CAÍDO: se abstiene y deja escalar, en vez de mandar el caso a revisión', async () => {
    const local = doble('e5-small', { falla: new Error('ECONNREFUSED tei:80') });
    const remoto = doble('semantic-classifier-fast');
    const cascada = montar(local, remoto);

    const fast = await cascada.classify(ENTRADA, 'FAST');

    expect(fast.assessments).toEqual([]);
    expect(fast.model).toBe('cascade:local-unavailable');
    expect(resuelveEnRapido(fast)).toBe(false);
  });

  it('local LENTO: se le abandona pasado su plazo y se escala', async () => {
    const local = doble('e5-small', {
      demoraMs: 5_000,
      assessments: [juicio('GASTOS.SUPERMERCADO', 0.99)],
    });
    const remoto = doble('semantic-classifier-fast');
    const cascada = montar(local, remoto, 40);

    const inicio = Date.now();
    const fast = await cascada.classify(ENTRADA, 'FAST');

    // No se esperaron los 5 s: se cortó en el plazo del local.
    expect(Date.now() - inicio).toBeLessThan(1_000);
    expect(fast.model).toBe('cascade:local-unavailable');
    expect(resuelveEnRapido(fast)).toBe(false);
  });

  it('la abstención NO afirma que las candidatas no encajen', async () => {
    // Diferencia sutil y deliberada: `supported: false` sería una AFIRMACIÓN sobre
    // categorías que el local nunca llegó a evaluar, y esa evidencia se audita.
    const local = doble('e5-small', { falla: new Error('caído') });
    const cascada = montar(local, doble('remoto'));

    const fast = await cascada.classify(ENTRADA, 'FAST');

    expect(fast.assessments).toHaveLength(0);
  });
});

describe('el presupuesto del análisis sigue mandando', () => {
  it('un presupuesto ya agotado no se convierte en una llamada al LLM', async () => {
    const local = doble('e5-small', { demoraMs: 5_000 });
    const remoto = doble('semantic-classifier-fast');
    const cascada = montar(local, remoto, 10_000);

    const budget = AbortSignal.timeout(30);
    const fast = await cascada.classify(ENTRADA, 'FAST', budget);

    // El local se abandona por el presupuesto global, no por su plazo propio.
    expect(fast.model).toBe('cascade:local-unavailable');
    expect(remoto.llamadas).toBe(0);
  });
});
