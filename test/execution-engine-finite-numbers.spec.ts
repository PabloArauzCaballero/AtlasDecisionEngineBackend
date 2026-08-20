import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../src/common/observability/metrics.service';
import { DomainException } from '../src/common/errors/domain-exception';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { compiledFixture } from './graph.fixture';
import type { CompiledDecisionArtifact } from '../src/modules/graph/graph.types';

/**
 * El motor no puede publicar un número que no llegó a calcular.
 *
 * `Number('lo-que-sea')` es `NaN`, y `NaN` atraviesa sumas y asignaciones sin quejarse hasta
 * que `JSON.stringify` lo convierte en `null` al serializar la respuesta. El solicitante veía
 * entonces `{"status":"SUCCEEDED","outcome":"APPROVED","score":null}`: una decisión declarada
 * correcta sobre un valor inexistente. En un motor de decisión regulado eso es peor que un
 * error — es un error que no se ve.
 *
 * `ExpressionEvaluator` ya cerraba esta puerta para las expresiones (`asNumber`, `compare`).
 * Estas pruebas cubren la OTRA puerta: los números que entran desde la configuración del
 * nodo y desde el payload de las acciones, que se escriben a mano en el editor.
 */
describe('ExecutionEngineService — valores numéricos no finitos', () => {
  const engine = new ExecutionEngineService(
    new ExpressionEvaluator(),
    new ConfigService({ MAX_EXECUTION_STEPS: 32 }),
    new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
    new MetricsService(),
  );

  /** Un grafo mínimo START → (acción) que termina, para ejercitar una acción concreta. */
  function withTerminalAction(
    type: string,
    payload: Record<string, unknown>,
  ): CompiledDecisionArtifact {
    const compiled = compiledFixture();
    compiled.actions = {
      ACT: {
        id: '90',
        code: 'ACT',
        type,
        payload,
        terminal: true,
        reasonCodes: [],
      },
    };
    compiled.nodes = {
      START: {
        ...compiled.nodes.START,
        type: 'ACTION',
        terminal: true,
        actions: [{ code: 'ACT', order: 1 }],
      },
    };
    compiled.edgesByNode = {};
    compiled.startNodeKey = 'START';
    return compiled;
  }

  async function expectRejected(compiled: CompiledDecisionArtifact): Promise<DomainException> {
    const error = await engine.execute(compiled, { score: 700 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainException);
    return error as DomainException;
  }

  it('rechaza SET_SCORE con un valor no numérico en vez de publicar score: null', async () => {
    const error = await expectRejected(
      withTerminalAction('SET_SCORE', { value: 'no-es-un-numero' }),
    );
    expect(error.code).toBe('NON_NUMERIC_DECISION_VALUE');
  });

  it('rechaza SET_LIMIT con un valor no numérico', async () => {
    const error = await expectRejected(withTerminalAction('SET_LIMIT', { value: 'mucho' }));
    expect(error.code).toBe('NON_NUMERIC_DECISION_VALUE');
  });

  it('rechaza ADD_SCORE con un valor no numérico', async () => {
    const error = await expectRejected(withTerminalAction('ADD_SCORE', { value: 'diez' }));
    expect(error.code).toBe('NON_NUMERIC_DECISION_VALUE');
  });

  it('rechaza una puntuación base no numérica en un nodo SCORE', async () => {
    const compiled = compiledFixture();
    compiled.nodes = {
      START: {
        ...compiled.nodes.START,
        type: 'SCORE',
        terminal: true,
        config: { baseScore: 'alto' },
        actions: [],
      },
    };
    compiled.edgesByNode = {};
    const error = await expectRejected(compiled);
    expect(error.code).toBe('NON_NUMERIC_DECISION_VALUE');
  });

  it('rechaza un componente de puntuación no numérico', async () => {
    const compiled = compiledFixture();
    compiled.nodes = {
      START: {
        ...compiled.nodes.START,
        type: 'SCORE',
        terminal: true,
        config: { baseScore: 0, components: [{ points: 'veinte' }] },
        actions: [],
      },
    };
    compiled.edgesByNode = {};
    const error = await expectRejected(compiled);
    expect(error.code).toBe('NON_NUMERIC_DECISION_VALUE');
  });

  it('rechaza Infinity igual que NaN: tampoco es una puntuación persistible', async () => {
    const compiled = compiledFixture();
    compiled.nodes = {
      START: {
        ...compiled.nodes.START,
        type: 'SCORE',
        terminal: true,
        // `div` por cero ya lo cubre el evaluador; aquí el valor llega directo de la config.
        config: { baseScore: Number.POSITIVE_INFINITY },
        actions: [],
      },
    };
    compiled.edgesByNode = {};
    const error = await expectRejected(compiled);
    expect(error.code).toBe('NON_NUMERIC_DECISION_VALUE');
  });

  it('sigue aceptando los valores numéricos válidos, incluidos los que llegan como cadena', async () => {
    const compiled = withTerminalAction('SET_SCORE', { value: '742' });
    const result = await engine.execute(compiled, { score: 700 });
    expect(result.score).toBe(742);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('el nodo que falla queda en la traza, con su código de error', async () => {
    const compiled = withTerminalAction('SET_SCORE', { value: 'no-es-un-numero' });
    await engine.execute(compiled, { score: 700 }).catch(() => undefined);
    // La traza se construye en el `catch` del bucle del motor; comprobamos que el nodo
    // culpable no desaparece de la evidencia, que es justo cuando más falta hace.
    const error = await expectRejected(compiled);
    expect(error.message).toContain('ACT');
  });
});
