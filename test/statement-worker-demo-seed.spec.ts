import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { GraphValidatorService } from '../src/modules/graph/graph-validator.service';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import {
  buildStatementWorkerDemoCompiled,
  STATEMENT_WORKER_DEMO_VARIABLES as V,
} from '../src/modules/seeding/data/statement-worker-demo.graph';
import type {
  ArtifactGraphSnapshot,
  WorkerServiceInvoker,
  WorkerServiceOutcome,
} from '../src/modules/graph/graph.types';
import { DomainException } from '../src/common/errors/domain-exception';

/**
 * El demo sembrado, ejecutado con el motor REAL.
 *
 * El servicio de extractos se sustituye por un doble que devuelve el contrato normalizado
 * del extracto sintético de QA Bank. No es un atajo: convertir el PDF de verdad depende de
 * `pdfjs` y de la cascada de analizadores, que ya tienen sus propias pruebas, y meterlas
 * aquí haría que un cambio en la lectura de PDF rompiera la prueba del ALGORITMO. Lo que
 * se comprueba aquí es que, dada una respuesta del servicio, el grafo decide lo que dice
 * que decide.
 */
const config = new ConfigService({
  MAX_EXECUTION_STEPS: 64,
  SCRIPT_NODES_ENABLED: false,
  AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
});
const engine = new ExecutionEngineService(
  new ExpressionEvaluator(),
  config,
  new ScriptNodeRunnerService(config),
  new MetricsService(),
);
const resolver = new VariableResolutionService(
  config,
  new HashService(config),
  new MetricsService(),
);
const compiled = buildStatementWorkerDemoCompiled({ id: '1', tenantId: '1' }, { id: '1' }, {});

/**
 * Totales reales del extracto sintético QA Bank del periodo 01/07/2026–31/07/2026.
 *
 * **Los impresos van a `null` a propósito.** Este doble copiaba la forma que el motor
 * PODÍA devolver, no la que devuelve: publicaba `totals.credit` con importe, como sólo
 * hace el analizador generalista. Contra los siete formatos bolivianos especializados
 * —los únicos que se usan de verdad— el impreso llega `null` siempre, y el demo, que leía
 * ese campo, derivaba ingreso cero y rechazaba por COBERTURA_INSUFICIENTE extractos leídos
 * al céntimo. El doble pasaba en verde porque describía otro documento. Dejarlo en `null`
 * es lo que hace que esta prueba pueda volver a atrapar el defecto.
 */
const QA_BANK_STATEMENT = {
  account: { currency: 'BOB', accountNumberMasked: '****4821' },
  balances: { opening: 8_425.7, closing: 29_452.01 },
  totals: {
    credit: null,
    debit: null,
    creditExtracted: 25_665.64,
    debitExtracted: 4_639.33,
  },
  quality: { overallConfidence: 0.78, warnings: [] as string[] },
  transactions: Array.from({ length: 42 }, (_, index) => ({ id: `t-${index}` })),
};

function invoker(outcome: WorkerServiceOutcome | (() => Promise<never>)): WorkerServiceInvoker {
  return { invoke: () => (typeof outcome === 'function' ? outcome() : Promise.resolve(outcome)) };
}

const service = (overrides: Partial<typeof QA_BANK_STATEMENT> = {}): WorkerServiceOutcome => ({
  status: 'SUCCEEDED',
  result: { ...QA_BANK_STATEMENT, ...overrides },
  warnings: [],
  durationMs: 850,
});

const inputContracts = compiled.variables.filter(
  (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
);

async function decide(
  cuota: number,
  serviceInvoker: WorkerServiceInvoker,
): Promise<Record<string, unknown>> {
  const resolution = await resolver.resolve(
    inputContracts,
    {
      // Base64 de `%PDF-1.4` — el contenido da igual aquí: quien lo interpreta es el
      // servicio, y el servicio es un doble.
      [V.documento]: 'JVBERi0xLjQ=',
      [V.nombreArchivo]: 'extracto-qa-bank.pdf',
      [V.cuota]: cuota,
    },
    {
      tenantId: 1n,
      artifactCode: compiled.artifact.code,
      requestId: 'seed-check',
      allowExternal: false,
    },
  );
  expect(resolution.valid).toBe(true);
  const result = await engine.execute(
    compiled,
    resolution.values,
    undefined,
    undefined,
    undefined,
    serviceInvoker,
  );
  return result.output;
}

describe('demo de llamada a servicio de worker, sembrado', () => {
  it('el grafo sembrado pasa la validación completa', () => {
    const snapshot: ArtifactGraphSnapshot = {
      artifact: compiled.artifact,
      version: compiled.version,
      variables: compiled.variables,
      intermediates: compiled.intermediates,
      outputContract: compiled.outputContract,
      conditions: Object.values(compiled.conditions),
      actions: Object.values(compiled.actions),
      nodes: Object.values(compiled.nodes),
      edges: Object.values(compiled.edgesByNode).flat(),
    };
    const report = new GraphValidatorService(
      new ExpressionEvaluator(),
      new HashService(config),
    ).validate(snapshot);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('aprueba cuando los abonos del extracto cubren la cuota con holgura', async () => {
    // 25.665,64 / 3.500 = 7,33 veces.
    const output = await decide(3_500, invoker(service()));
    expect(output[V.decision]).toBe('APROBADO');
    expect(output[V.motivo]).toBe('COBERTURA_HOLGADA');
    expect(output[V.ingreso]).toBeCloseTo(25_665.64, 2);
    expect(output[V.confianza]).toBeCloseTo(0.78, 4);
  });

  it('aprueba con condiciones en la franja ajustada', async () => {
    // 25.665,64 / 12.000 = 2,14 veces: por encima de 1,5 y por debajo de 3.
    const output = await decide(12_000, invoker(service()));
    expect(output[V.decision]).toBe('APROBADO_CON_CONDICIONES');
    expect(output[V.motivo]).toBe('COBERTURA_AJUSTADA');
  });

  it('rechaza cuando los abonos no llegan a cubrir la cuota vez y media', async () => {
    const output = await decide(20_000, invoker(service()));
    expect(output[V.decision]).toBe('RECHAZADO');
    expect(output[V.motivo]).toBe('COBERTURA_INSUFICIENTE');
  });

  it('manda a revisión manual un extracto leído con poca confianza', async () => {
    const output = await decide(
      3_500,
      invoker(service({ quality: { overallConfidence: 0.42, warnings: [] } })),
    );
    expect(output[V.decision]).toBe('REVISION_MANUAL');
    expect(output[V.motivo]).toBe('EXTRACTO_NO_CONFIABLE');
  });

  it('manda a revisión manual un extracto con muy pocos movimientos', async () => {
    const output = await decide(
      3_500,
      invoker(service({ transactions: [{ id: 'a' }, { id: 'b' }] })),
    );
    expect(output[V.decision]).toBe('REVISION_MANUAL');
    expect(output[V.motivo]).toBe('EXTRACTO_NO_CONFIABLE');
  });

  it('un PDF ilegible no rompe la decisión: la desvía a revisión manual', async () => {
    // Es la razón de que el nodo declare `onError: CONTINUE`. Con `FAIL` esto sería un
    // error HTTP y el analista se quedaría sin decisión y sin motivo.
    const output = await decide(
      3_500,
      invoker(() =>
        Promise.reject(
          new DomainException('NOT_A_FINANCIAL_STATEMENT', 'El documento no es un extracto'),
        ),
      ),
    );
    expect(output[V.decision]).toBe('REVISION_MANUAL');
    expect(output[V.motivo]).toBe('EXTRACTO_NO_CONFIABLE');
    expect(output[V.ingreso]).toBe(0);
    expect(output[V.confianza]).toBe(0);
  });

  it('las variables que produce el servicio no salen en la respuesta pública', async () => {
    const output = await decide(3_500, invoker(service()));
    for (const code of Object.keys(output)) {
      expect(code.startsWith('ext_')).toBe(false);
    }
  });
});
