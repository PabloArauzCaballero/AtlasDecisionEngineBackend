/**
 * Comprobación contra una instalación REAL de LiteLLM. Opt-in, nunca en CI.
 *
 *   RUN_LITELLM_E2E=true LITELLM_BASE_URL=http://localhost:4000/v1 \
 *   LITELLM_API_KEY=... yarn jest test/litellm-smoke.spec.ts
 *
 * Sin `RUN_LITELLM_E2E=true` el archivo se salta entero: gasta tokens de verdad
 * contra el proveedor que haya detrás del alias, y una suite que cuesta dinero
 * en cada commit acaba desactivada por alguien con prisa —y entonces no cubre
 * nada—. Lo que aquí se verifica no lo puede ver ninguna simulación: que el
 * alias EXISTE en el `model_list` del gateway y que el proveedor detrás de él
 * respeta la salida estructurada que se le pide.
 */
import { loadLiteLlmProviderOptions } from '../src/modules/workers/semantic-analysis/core/config/litellm-provider.config';
import { LiteLlmSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/litellm/litellm-semantic.provider';
import type {
  ModelClassificationInput,
  SemanticCategory,
} from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.types';

const HABILITADO = process.env['RUN_LITELLM_E2E'] === 'true';
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

describeSiHabilitado('humo contra un LiteLLM real', () => {
  it('el alias lógico existe y devuelve una clasificación válida', async () => {
    const provider = new LiteLlmSemanticProvider(loadLiteLlmProviderOptions(process.env));

    const resultado = await provider.classify(ENTRADA, 'FAST');

    expect(resultado.assessments.length).toBeGreaterThan(0);
    // La garantía que importa: el veredicto SÓLO puede caer sobre lo propuesto.
    for (const assessment of resultado.assessments) {
      expect(['GASTOS.SUPERMERCADO', 'GASTOS.COMBUSTIBLE']).toContain(assessment.categoryCode);
    }
    // Con un gateway delante, `modelVersion` delata qué despliegue respondió.
    // eslint-disable-next-line no-console
    console.log(
      `alias=${resultado.model} respondió=${resultado.modelVersion} ` +
        `tokens=${String(resultado.usage?.totalTokens ?? 'n/d')} ` +
        `coste=${String(resultado.usage?.estimatedCost ?? 'n/d')}`,
    );
  }, 60_000);
});
