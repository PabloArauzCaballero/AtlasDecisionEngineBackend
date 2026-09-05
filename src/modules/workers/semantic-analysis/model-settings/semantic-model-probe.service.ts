import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../../../../common/errors/domain-exception';
import { SEMANTIC_WORKER_CONFIG, type SemanticModelProvider } from '../core/application/ports';
import { buildRemoteGatewayProvider } from '../core/config/model-provider.factory';
import type { SemanticWorkerConfig } from '../core/config/semantic-worker.config';
import { SemanticAnalysisError } from '../core/domain/semantic-analysis.errors';
import type {
  AnalysisTier,
  ModelClassificationInput,
  SemanticCategory,
} from '../core/domain/semantic-analysis.types';
import { environmentOverridesFor } from './environment-overrides';
import type {
  ModelProbeTierDto,
  SemanticModelProbeDto,
  UpdateSemanticModelSettingsDto,
} from './semantic-model-settings.dto';
import { SemanticModelSettingsService } from './semantic-model-settings.service';

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

/**
 * La glosa de prueba. Sintética y sin datos personales: es un comercio real de
 * Santa Cruz escrito como lo escribe un banco, pero no la fila de nadie. Dos
 * candidatas para que el modelo tenga algo que decidir y la respuesta se pueda
 * juzgar a ojo.
 */
const PROBE_INPUT: ModelClassificationInput = {
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

const TIERS: readonly AnalysisTier[] = ['FAST', 'DEEP'];

/**
 * «Probar antes de guardar».
 *
 * Construye el adaptador exactamente como lo construiría el worker con esa
 * configuración —misma fábrica, mismas validaciones— y le pide una
 * clasificación real por nivel. Cuesta lo que cuestan dos glosas, y a cambio
 * quien va a guardar ve latencia, coste, qué despliegue físico respondió y si
 * el modelo respeta el esquema, ANTES de que la elección alcance a la cola.
 *
 * No guarda nada, no toca la caché y no pasa por el proveedor en uso.
 */
@Injectable()
export class SemanticModelProbeService {
  constructor(
    private readonly settings: SemanticModelSettingsService,
    @Inject(SEMANTIC_WORKER_CONFIG) private readonly workerConfig: SemanticWorkerConfig,
  ) {}

  async probe(dto: UpdateSemanticModelSettingsDto): Promise<SemanticModelProbeDto> {
    this.settings.assertAvailable(dto.gateway);
    const fastModel = dto.fastModel.trim();
    const deepModel = dto.deepModel.trim();
    this.settings.assertModelShape(dto.gateway, 'fastModel', fastModel);
    this.settings.assertModelShape(dto.gateway, 'deepModel', deepModel);

    const provider = this.buildCandidate(dto.gateway, fastModel, deepModel);
    const tiers: ModelProbeTierDto[] = [];
    for (const tier of TIERS) {
      tiers.push(await this.probeTier(provider, tier));
    }
    return { gateway: dto.gateway, tiers };
  }

  private buildCandidate(
    gateway: UpdateSemanticModelSettingsDto['gateway'],
    fastModel: string,
    deepModel: string,
  ): SemanticModelProvider {
    const environment = {
      ...process.env,
      ...environmentOverridesFor(this.settings.mode(), gateway, fastModel, deepModel),
    };
    try {
      return buildRemoteGatewayProvider(gateway, environment, this.workerConfig);
    } catch (error) {
      // El mensaje de la fábrica nombra variables, nunca sus valores.
      throw new DomainException(
        'SEMANTIC_MODEL_PROBE_CONFIGURATION',
        `No se pudo construir el adaptador de ${gateway}: ${String(
          error instanceof Error ? error.message : error,
        )}`,
        HttpStatus.CONFLICT,
        { gateway },
      );
    }
  }

  private async probeTier(
    provider: SemanticModelProvider,
    tier: AnalysisTier,
  ): Promise<ModelProbeTierDto> {
    const model = provider.modelFor?.(tier) ?? 'unknown';
    const startedAt = performance.now();
    try {
      const result = await provider.classify(
        PROBE_INPUT,
        tier,
        AbortSignal.timeout(this.workerConfig.analysisTimeoutSeconds * 1_000),
      );
      const top = [...result.assessments].sort((a, b) => b.confidence - a.confidence)[0];
      return {
        tier,
        model,
        ok: true,
        respondedBy: result.modelVersion,
        latencyMs: Math.round(performance.now() - startedAt),
        ...(result.usage === undefined ? {} : { usage: result.usage }),
        ...(top === undefined ? {} : { topCategory: top.categoryCode, confidence: top.confidence }),
      };
    } catch (error) {
      return {
        tier,
        model,
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        // Los errores del núcleo están escritos para no filtrar ni texto ni
        // credenciales; cualquier otro se resume sin su mensaje.
        error:
          error instanceof SemanticAnalysisError
            ? error.message
            : 'Fallo inesperado al llamar al proveedor.',
      };
    }
  }
}
