import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import type { CompiledDecisionArtifact } from '../src/modules/graph/graph.types';
import { SeededRandom } from '../src/modules/qa-lab/seeded-random';
import {
  comparedLiterals,
  searchCoverage,
  type CoverageCandidate,
  type CoverageObservation,
} from '../src/modules/testing/coverage-search';
import { withWorkerDoubles } from '../src/modules/testing/worker-doubles';
import credito from '../scripts/lib/atlas-underwriting-v2.definicion.json';
import extracto from '../scripts/lib/extracto-capacidad-pago.definicion.json';
import identidad from '../scripts/lib/identidad-carnet-movil.definicion.json';
import kyb from '../scripts/lib/partner-kyb-review.definicion.json';
import privacidad from '../scripts/lib/privacidad-solicitud-titular.definicion.json';
import riesgo from '../scripts/lib/riesgo-onboarding-cliente.definicion.json';
import { compilarDefinicion, contratoDeEntrada } from './definicion-compilada';

/**
 * El buscador de cobertura contra los SEIS grafos reales de Atlas, con el motor de ejecución de
 * verdad. Es la prueba de que «generar una suite que recorra todo» funciona donde importa: el
 * puntaje de crédito (intermedias calculadas), identidad y extractos (nodos WORKER).
 */
const engine = new ExecutionEngineService(
  new ExpressionEvaluator(),
  new ConfigService({ MAX_EXECUTION_STEPS: 128 }),
  new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
  new MetricsService(),
);

function observador(compilado: CompiledDecisionArtifact) {
  return async (candidato: CoverageCandidate): Promise<CoverageObservation> => {
    try {
      const resultado = await engine.execute(
        compilado,
        candidato.variables,
        undefined,
        undefined,
        undefined,
        withWorkerDoubles(candidato.workerDoubles, undefined),
      );
      return {
        usable: true,
        visitedNodeKeys: resultado.visitedNodeKeys,
        traversedEdgeKeys: resultado.traversedEdgeKeys,
        terminalNodeKey: resultado.terminalNodeKey,
        actual: {
          ...resultado.output,
          outcome: resultado.outcome,
          reasonCodes: resultado.reasons.map((r) => r.code),
        },
      };
    } catch {
      return { usable: false, visitedNodeKeys: [], traversedEdgeKeys: [], actual: {} };
    }
  };
}

const GRAFOS: Array<[string, unknown]> = [
  ['ATLAS_BNPL_UNDERWRITING', credito],
  ['IDENTIDAD_CARNET_MOVIL', identidad],
  ['EXTRACTO_CAPACIDAD_PAGO', extracto],
  ['PARTNER_KYB_REVIEW', kyb],
  ['RIESGO_ONBOARDING_CLIENTE', riesgo],
  ['PRIVACIDAD_SOLICITUD_TITULAR', privacidad],
];

describe('buscador de cobertura · los grafos reales de Atlas', () => {
  jest.setTimeout(120_000);

  it.each(GRAFOS)('%s: recorre el 100 %% de los nodos', async (codigo, definicion) => {
    const compilado = compilarDefinicion(definicion);
    const inicio = Date.now();
    const resultado = await searchCoverage(
      compilado,
      contratoDeEntrada(definicion),
      new SeededRandom(`cobertura-${codigo}`),
      observador(compilado),
      { maxExecutions: 20_000, maxMillis: 60_000 },
    );
    // Se imprime a propósito: es la medición que justifica el presupuesto por defecto del servicio.
    // eslint-disable-next-line no-console
    console.log(
      `${codigo}: nodos ${resultado.nodes.percentage} % · aristas ${resultado.edges.percentage} % · ` +
        `${resultado.cases.length} casos · ${resultado.executions} ejecuciones · ${Date.now() - inicio} ms` +
        (resultado.nodes.missing.length ? ` · faltan ${resultado.nodes.missing.join(', ')}` : ''),
    );
    expect(resultado.nodes.missing).toEqual([]);
    expect(resultado.nodes.percentage).toBe(100);
  });

  it('los candidatos salen de lo que el grafo compara: umbrales, enumerados e intermedias', () => {
    const literales = comparedLiterals(compilarDefinicion(credito));

    expect(literales.get('affordability_ratio')).toEqual(expect.arrayContaining([0.4]));
    expect(literales.get('worst_delinquency_status')).toEqual(
      expect.arrayContaining(['DPD_30', 'CHARGE_OFF']),
    );
    expect(literales.get('intermediate.risk_score_band')).toEqual(
      expect.arrayContaining(['D', 'E']),
    );
  });

  it('con el presupuesto agotado lo dice, y no inventa cobertura', async () => {
    const compilado = compilarDefinicion(credito);
    const resultado = await searchCoverage(
      compilado,
      contratoDeEntrada(credito),
      new SeededRandom('corto'),
      observador(compilado),
      { maxExecutions: 3, maxMillis: 60_000 },
    );

    expect(resultado.exhaustedBudget).toBe(true);
    expect(resultado.executions).toBeLessThanOrEqual(3);
    expect(resultado.nodes.percentage).toBeLessThan(100);
    expect(resultado.nodes.missing.length).toBeGreaterThan(0);
  });
});
