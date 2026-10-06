import { persistedStepEvaluation } from '../src/modules/runtime/execution-writer.service';
import type { EngineExecutionResult } from '../src/modules/graph/graph.types';

type Step = EngineExecutionResult['trace'][number];

const variableState: NonNullable<Step['variableState']> = {
  nodeKey: 'RIESGO',
  status: 'COMPLETED',
  durationUs: 40,
  inputs: [],
  intermediatesBefore: [],
  intermediatesAfter: [],
  intermediatesCreated: [],
  intermediatesUpdated: [],
  outputs: [],
  errors: [],
  warnings: [],
};

describe('persistedStepEvaluation: el paso guarda el estado de sus variables', () => {
  it('añade variableState junto a lo evaluado por el nodo', () => {
    const step: Step = {
      nodeId: '55',
      nodeKey: 'RIESGO',
      nodeType: 'SCORE',
      evaluation: { score: 640 },
      durationUs: 40,
      variableState,
    };

    expect(persistedStepEvaluation(step)).toEqual({ score: 640, variableState });
  });

  it('un artefacto compilado antes de §3 guarda la evaluación tal cual', () => {
    const step: Step = { nodeKey: 'X', nodeType: 'SCORE', evaluation: { score: 1 }, durationUs: 1 };

    expect(persistedStepEvaluation(step)).toEqual({ score: 1 });
  });

  it('no altera la evaluación que el motor sigue usando', () => {
    const evaluation = { score: 640 };
    persistedStepEvaluation({
      nodeKey: 'RIESGO',
      nodeType: 'SCORE',
      evaluation,
      durationUs: 40,
      variableState,
    });

    expect(evaluation).toEqual({ score: 640 });
  });
});
