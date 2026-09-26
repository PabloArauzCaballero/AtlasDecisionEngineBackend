/**
 * Comprobación contra OpenRouter REAL. Opt-in, nunca en CI.
 *
 *   RUN_OPENROUTER_E2E=true OPENROUTER_API_KEY=sk-or-v1-... yarn jest test/openrouter-smoke.spec.ts
 *
 * Sin `RUN_OPENROUTER_E2E=true` el archivo se salta entero: gasta créditos de
 * verdad. Lo que aquí se verifica no lo puede ver ninguna simulación: que los
 * identificadores por omisión EXISTEN en el catálogo de OpenRouter, que algún
 * proveedor físico detrás de ellos honra la salida estructurada estricta (si
 * ninguno lo hiciera, `require_parameters` devuelve un 400 y esta prueba lo
 * enseña), y que el coste viene en la respuesta.
 *
 * Se prueban los DOS niveles, no sólo el rápido: el profundo es de otro
 * proveedor físico y lo que falla en uno no falla en el otro.
 */
import { loadOpenRouterProviderOptions } from '../src/modules/workers/semantic-analysis/core/config/openrouter-provider.config';
import { OpenRouterSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/openrouter/openrouter-semantic.provider';
import type {
  AnalysisTier,
  ModelClassificationInput,
  SemanticCategory,
} from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.types';

const HABILITADO = process.env['RUN_OPENROUTER_E2E'] === 'true';
const describeSiHabilitado = HABILITADO ? describe : describe.skip;

function categoria(code: string, name: string, description: string): SemanticCategory {
  return {
    id: code,
    code,
    name,
    description,
    parentCode: null,
    positiveExamples: [],
    counterExamples: [],
    restrictions: [],
    relatedCategoryCodes: [],
    acceptanceThreshold: 0.8,
    version: 1,
  };
}

const ENTRADA: ModelClassificationInput = {
  originalText: 'PAGO POS 000834 HIPERMAXI EQUIPETROL SCZ 23992',
  normalizedText: 'HIPERMAXI EQUIPETROL',
  entities: [],
  candidates: [
    {
      category: categoria('GASTOS.SUPERMERCADO', 'Supermercado', 'Compras en supermercados.'),
      retrievalScore: 0.9,
    },
    {
      category: categoria('GASTOS.COMBUSTIBLE', 'Combustible', 'Carga de combustible.'),
      retrievalScore: 0.3,
    },
  ],
};

describeSiHabilitado('humo contra OpenRouter real', () => {
  it.each<AnalysisTier>(['FAST', 'DEEP'])(
    'el modelo del nivel %s existe y devuelve una clasificación válida',
    async (tier) => {
      const provider = new OpenRouterSemanticProvider(loadOpenRouterProviderOptions(process.env));

      const resultado = await provider.classify(ENTRADA, tier);

      expect(resultado.assessments.length).toBeGreaterThan(0);
      for (const assessment of resultado.assessments) {
        expect(['GASTOS.SUPERMERCADO', 'GASTOS.COMBUSTIBLE']).toContain(assessment.categoryCode);
      }
      // El coste es la razón de pedir `usage.include`: si no llega, el panel se queda plano.
      expect(resultado.usage?.estimatedCost).toBeDefined();
      // eslint-disable-next-line no-console
      console.log(
        `${tier}: pedido=${resultado.model} respondió=${resultado.modelVersion} ` +
          `tokens=${String(resultado.usage?.totalTokens ?? 'n/d')} ` +
          `coste=${String(resultado.usage?.estimatedCost ?? 'n/d')} USD ` +
          `top=${resultado.assessments[0].categoryCode}@${String(resultado.assessments[0].confidence)}`,
      );
    },
    60_000,
  );
});
