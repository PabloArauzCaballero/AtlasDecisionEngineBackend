import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import {
  distribute,
  generateCasesOfKinds,
  type DistributionMap,
  type GeneratedCase,
  type GeneratorContractVariable,
  type VariableDistribution,
} from './contract-generator';
import {
  allocateOutcomeCounts,
  planOutcomeAllocation,
  planOutcomeCases,
  reachableOutcomeKeys,
  type OutcomeCase,
} from './outcome-coverage';
import { GenerateQaRunDto } from './qa-lab.dto';
import { QaFakersService, type FakerReport } from './qa-fakers.service';
import { inputContractOf } from './qa-contract';
import { SeededRandom, generateSeed } from './seeded-random';

const DEFAULT_MIX = { validPercent: 60, invalidPercent: 25, boundaryPercent: 15 };

/**
 * Tope de casos por desenlace que se añaden a una corrida. Se suman a `caseCount`, así
 * que sin cota un grafo muy ramificado podría multiplicar la duración de la tanda.
 */
const MAX_OUTCOME_CASES_PER_RUN = 25;

/** Todo lo que hace falta para archivar y ejecutar una corrida: la semilla, el reparto y el lote. */
export interface QaRunPlan {
  seed: string;
  mix: { validPercent: number; invalidPercent: number; boundaryPercent: number };
  inputContract: GeneratorContractVariable[];
  distributions: DistributionMap;
  /** El reparto por desenlace ya resuelto a casos exactos, o `null` si no se pidió. */
  outcomeAllocation: Map<string, number> | null;
  batch: GeneratedCase[];
  fakers: FakerReport;
}

/** Decide qué casos ejecutará una corrida: reparto de clases, de desenlaces y datos realistas. */
@Injectable()
export class QaRunPlannerService {
  constructor(
    // Opcional para las pruebas que construyen el servicio a mano: sin él, los lotes salen
    // del generador local y la corrida lo dice (`fakers.source = local-fallback`).
    @Optional() private readonly fakers?: QaFakersService,
  ) {}

  async plan(
    compiled: CompiledDecisionArtifact,
    dto: GenerateQaRunDto,
    versionId: bigint,
    requestId: string | undefined,
  ): Promise<QaRunPlan> {
    const seed = dto.seed ?? generateSeed(`${versionId}:${requestId}`);
    const mix = {
      validPercent: dto.validPercent ?? DEFAULT_MIX.validPercent,
      invalidPercent: dto.invalidPercent ?? DEFAULT_MIX.invalidPercent,
      boundaryPercent: dto.boundaryPercent ?? DEFAULT_MIX.boundaryPercent,
    };
    const inputContract = inputContractOf(compiled);
    const distributions = this.resolveDistributions(dto, inputContract);
    // El reparto de clases se decide aquí porque el de desenlaces se calcula SOBRE él:
    // los pesos reparten la porción válida, no el lote entero.
    const kinds = distribute(dto.caseCount, mix);
    // Se valida ANTES de crear la corrida: un peso sobre un desenlace que este grafo no
    // alcanza no se puede aplicar, y descubrirlo a mitad de la ejecución dejaría una
    // corrida archivada cuyo reparto no es el que pidió quien la lanzó.
    const outcomeAllocation = this.resolveOutcomeAllocation(
      dto,
      compiled,
      kinds.filter((kind) => kind === 'VALID').length,
    );

    const random = new SeededRandom(seed);
    // Con reparto por desenlace, la porción VÁLIDA la construye el planificador del grafo
    // y aquí sólo quedan frontera e inválidos. `validPercent` sigue decidiendo CUÁNTOS son
    // válidos; el reparto decide DÓNDE acaban. Sin `outcomeWeights` no cambia nada.
    const mixKinds = outcomeAllocation ? kinds.filter((kind) => kind !== 'VALID') : kinds;
    const allocated = outcomeAllocation
      ? this.asGeneratedCases(
          planOutcomeAllocation(compiled, inputContract, random, outcomeAllocation),
        )
      : [];
    const cases = [
      ...allocated,
      ...generateCasesOfKinds(inputContract, random, mixKinds, distributions),
    ];
    // Los casos por desenlace van DELANTE y con su propio flujo aleatorio —derivado de la
    // misma semilla, así que la corrida sigue siendo reproducible—. Delante porque son los
    // que responden la pregunta que importa: si algo se rompe, que se rompa aquí antes de
    // que un tope de tiempo trunque la tanda.
    const outcomeCases =
      dto.coverOutcomes === false ? [] : this.outcomeCases(compiled, inputContract, seed);
    // Se renumera al unir: cada generador cuenta desde 0 por su cuenta, y dos casos con el
    // mismo índice hacen que un contraejemplo apunte a un caso que no es el suyo.
    const generated = [...outcomeCases, ...cases].map((testCase, index) => ({
      ...testCase,
      index,
    }));
    // Datos realistas (nombre, carnet, celular, ingreso…) de los fakers del servidor mock,
    // con la MISMA semilla. Si el mock no responde, el lote sigue siendo el local y la
    // corrida lo archiva con su motivo: nunca falla en silencio ni inventa.
    const { cases: batch, fakers } = await this.enrichBatch(
      generated,
      inputContract,
      seed,
      compiled,
    );
    return { seed, mix, inputContract, distributions, outcomeAllocation, batch, fakers };
  }

  /**
   * Un caso por desenlace, con la forma que espera el ejecutor.
   *
   * Se etiquetan `VALID` porque eso es lo que son: entradas legítimas que el motor debe
   * ACEPTAR —las propiedades sólo tratan distinto a `INVALID`, del que esperan rechazo—.
   * El desenlace perseguido viaja en `mutation`, el campo que el informe ya enseña junto a
   * cada contraejemplo: sin él un fallo diría «caso 3» y no «el camino a Rechazar».
   */
  private outcomeCases(
    compiled: CompiledDecisionArtifact,
    inputContract: GeneratorContractVariable[],
    seed: string,
  ): GeneratedCase[] {
    const plan = planOutcomeCases(
      compiled,
      inputContract,
      new SeededRandom(`${seed}:outcomes`),
      MAX_OUTCOME_CASES_PER_RUN,
    );
    return this.asGeneratedCases(plan.cases);
  }

  /** Traduce los casos del planificador de desenlaces a la forma que ejecuta el lote. */
  private asGeneratedCases(plan: OutcomeCase[]): GeneratedCase[] {
    return plan.map((item, index) => ({
      index,
      kind: 'VALID' as const,
      mutation: `desenlace: ${item.outcome}${item.unresolved.length ? ' (no garantizado desde la entrada)' : ''}`,
      input: item.input,
      ...(item.unsatisfiable?.length ? { unsatisfiable: item.unsatisfiable } : {}),
    }));
  }

  /**
   * Convierte los pesos por desenlace en un número exacto de casos, o `null` si no se pidió
   * reparto.
   *
   * Dos decisiones que no son de estilo:
   *
   * - Una clave que este grafo NO alcanza es un error, no un peso que se ignora. Quien
   *   escribe `{"RECHAZADO": 70}` sobre un artefacto cuyo nodo se llama `DECLINED_RESULT`
   *   se llevaría una corrida verde con un reparto que nunca ocurrió, y el informe diría
   *   que el 70 % acabó en una rama que no existe.
   * - El reparto usa el resto MAYOR, así que los casos asignados suman exactamente los
   *   válidos pedidos. Redondear cada peso por su cuenta perdía casos por el camino y la
   *   corrida ejecutaba menos de los que decía.
   */
  private resolveOutcomeAllocation(
    dto: GenerateQaRunDto,
    compiled: CompiledDecisionArtifact,
    validCount: number,
  ): Map<string, number> | null {
    const weights = dto.outcomeWeights;
    if (!weights || !Object.keys(weights).length) return null;

    const reachable = reachableOutcomeKeys(compiled);
    const unknown = Object.keys(weights).filter((key) => !reachable.includes(key));
    if (unknown.length) {
      throw new DomainException(
        'QA_RUN_OUTCOME_UNKNOWN',
        `Estos desenlaces no existen en la versión: ${unknown.join(', ')}. Los alcanzables son: ${reachable.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const entries = reachable
      .filter((key) => key in weights)
      .map((key) => [key, Number(weights[key])] as const);
    if (entries.some(([, weight]) => !Number.isFinite(weight) || weight < 0)) {
      throw new DomainException(
        'QA_RUN_OUTCOME_WEIGHT_INVALID',
        'Los pesos por desenlace tienen que ser números no negativos',
        HttpStatus.BAD_REQUEST,
      );
    }
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    if (total <= 0) {
      throw new DomainException(
        'QA_RUN_OUTCOME_WEIGHT_INVALID',
        'Al menos un desenlace tiene que llevar peso mayor que cero',
        HttpStatus.BAD_REQUEST,
      );
    }

    return allocateOutcomeCounts(entries, validCount);
  }

  /**
   * Normaliza las distribuciones pedidas y las contrasta con el contrato (§10.4).
   *
   * Falla cerrado ante un código que no existe entre las entradas. Una distribución que no
   * se aplica no da error visible en ninguna parte: la corrida saldría verde, uniforme y
   * con el nombre de un sesgo que nunca ocurrió, que es la peor forma de fallar en QA.
   */
  private resolveDistributions(
    dto: GenerateQaRunDto,
    inputContract: GeneratorContractVariable[],
  ): DistributionMap {
    if (!dto.distributions?.length) return {};
    const declared = new Set(inputContract.map((variable) => variable.code));
    const resolved: Record<string, VariableDistribution> = {};

    for (const entry of dto.distributions) {
      if (!declared.has(entry.variableCode)) {
        throw new DomainException(
          'QA_DISTRIBUTION_VARIABLE_UNKNOWN',
          `La variable ${entry.variableCode} no es una entrada del contrato de esta versión`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          { variableCode: entry.variableCode, declared: [...declared] },
        );
      }
      if (resolved[entry.variableCode]) {
        throw new DomainException(
          'QA_DISTRIBUTION_DUPLICATED',
          `La variable ${entry.variableCode} tiene más de una distribución declarada`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      for (const [value, weight] of Object.entries(entry.valueWeights ?? {})) {
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
          throw new DomainException(
            'QA_DISTRIBUTION_WEIGHT_INVALID',
            `El peso de ${entry.variableCode}.${value} debe ser un número finito no negativo`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
      }
      resolved[entry.variableCode] = { shape: entry.shape, valueWeights: entry.valueWeights };
    }
    return resolved;
  }

  /** Superpone los fakers al lote, o lo deja como está si no hay servicio configurado. */
  private async enrichBatch(
    batch: GeneratedCase[],
    inputs: GeneratorContractVariable[],
    seed: string,
    compiled: CompiledDecisionArtifact,
  ): Promise<{ cases: GeneratedCase[]; fakers: FakerReport }> {
    if (!this.fakers) {
      return {
        cases: batch,
        fakers: {
          source: 'local-fallback',
          reason: 'Este proceso no tiene configurado el servicio de fakers.',
          mappedVariables: {},
          replacedValues: 0,
          types: [],
        },
      };
    }
    return this.fakers.enrich(batch, inputs, { seed, compiled });
  }
}
