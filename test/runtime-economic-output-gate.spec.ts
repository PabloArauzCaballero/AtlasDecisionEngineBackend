/**
 * La compuerta de salidas económicas en el camino de la decisión (P-10, brecha B13).
 *
 * `reviewOutputs` ya detectaba una PD de 4,2 o un límite negativo, lo registraba en el log y
 * devolvía la lista… que el runtime IGNORABA: la ejecución salía SUCCEEDED con el desenlace del
 * grafo y el llamante podía leerla como una autorización. Estas pruebas fijan lo contrario:
 *
 *  - una salida fuera de rango NO es una autorización: `NO_DECISION`, HTTP 422, sin `output`;
 *  - el expediente se CONSERVA: la ejecución se escribe con el resultado del grafo, estado
 *    `NO_DECISION` y un error por salida;
 *  - un error del modelo NO es un rechazo crediticio: el motivo es técnico y sin acción adversa;
 *  - una salida válida sigue saliendo como siempre, ahora con su vencimiento.
 *
 * El guardia es el REAL, con un Prisma de pega: lo que se prueba es que su veredicto llega al
 * runtime, no la consulta.
 */
import { ConfigService } from '@nestjs/config';
import { OutputSemanticRole } from '@prisma/client';
import type { AuditService } from '../src/common/audit/audit.service';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import { TracingService } from '../src/common/observability/tracing.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type {
  DeploymentResolverService,
  ResolvedDeployment,
} from '../src/modules/deployments/deployment-resolver.service';
import type { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import type {
  CompiledDecisionArtifact,
  EngineExecutionResult,
} from '../src/modules/graph/graph.types';
import type { NestedTreeExecutionService } from '../src/modules/nested-trees/nested-tree-execution.service';
import { DecisionGuardService } from '../src/modules/risk-governance/decision-guard.service';
import type {
  ExecutionWriterService,
  WriteExecutionInput,
} from '../src/modules/runtime/execution-writer.service';
import type { IdempotencyService } from '../src/modules/runtime/idempotency.service';
import type { ExecuteDecisionDto } from '../src/modules/runtime/runtime.dto';
import { RuntimeService } from '../src/modules/runtime/runtime.service';
import type { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import type { WorkerServiceInvokerService } from '../src/modules/workers/worker-service-invoker.service';

const AHORA = new Date('2026-09-24T12:00:00.000Z');

const principal: AuthenticatedPrincipal = {
  id: 'core-runtime',
  tenantId: 1n,
  roles: [],
  audience: 'runtime',
  requestId: 'req-1',
  authMethod: 'api_key',
};

const deployment: ResolvedDeployment = {
  deploymentId: 11n,
  artifactVersionId: 22n,
  environmentId: 3n,
  environmentCode: 'SANDBOX',
  compiledArtifactId: 33n,
  compiledChecksum: 'sha256:abc',
  compiled: { variables: [] } as unknown as CompiledDecisionArtifact,
  subjectPolicy: 'WARN',
  riskDomain: 'CREDIT_ORIGINATION',
  // Sandbox y sin base declarada: la política de base habilitante no exige nada aquí, así que
  // esta suite mide sólo la compuerta de salidas.
  isProductionEnvironment: false,
  legalBasis: null,
  enablingBasisPolicy: null,
};

type Field = {
  fieldCode: string;
  semanticRole: OutputSemanticRole;
  policyMinValue: number | null;
  policyMaxValue: number | null;
};

function harness(result: Partial<EngineExecutionResult>, fields: Field[] = []) {
  const config = new ConfigService({
    AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
    DEFAULT_ENVIRONMENT: 'SANDBOX',
  });
  const writes: WriteExecutionInput[] = [];
  const completed: unknown[] = [];
  const failed: unknown[] = [];
  const audited: string[] = [];

  const prisma = {
    $transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({}),
    exposureLimit: { findMany: () => Promise.resolve([]) },
    subjectConsent: { findMany: () => Promise.resolve([]) },
    decisionSubject: { findFirst: () => Promise.resolve(null) },
    decisionOutputContractField: { findMany: () => Promise.resolve(fields) },
  } as unknown as PrismaService;

  const engineResult: EngineExecutionResult = {
    status: 'SUCCEEDED',
    outcome: 'APPROVED',
    output: {},
    reasons: [],
    trace: [],
    visitedNodeKeys: [],
    traversedEdgeKeys: [],
    nestedExecutions: [],
    calculatedFieldCalls: [],
    workerCalls: [],
    ...result,
  };

  const service = new RuntimeService(
    config,
    prisma,
    new HashService(config),
    {
      reserve: () => Promise.resolve({ kind: 'reserved' as const, id: 42n, lease: AHORA }),
      complete: (_id: bigint, _lease: Date, response: unknown) => {
        completed.push(response);
        return Promise.resolve();
      },
      fail: (_id: bigint, _lease: Date, response: unknown) => {
        failed.push(response);
        return Promise.resolve();
      },
      release: () => Promise.resolve(),
    } as unknown as IdempotencyService,
    { resolve: () => Promise.resolve(deployment) } as unknown as DeploymentResolverService,
    {
      resolve: () =>
        Promise.resolve({
          valid: true,
          values: { requested_amount: 80 },
          snapshots: [],
          errors: [],
        }),
    } as unknown as VariableResolutionService,
    { execute: () => Promise.resolve(engineResult) } as unknown as ExecutionEngineService,
    {
      write: (input: WriteExecutionInput) => {
        writes.push(input);
        return Promise.resolve({ id: 99n });
      },
    } as unknown as ExecutionWriterService,
    {
      append: (input: { eventType: string }) => {
        audited.push(input.eventType);
        return Promise.resolve({} as never);
      },
    } as unknown as AuditService,
    new MetricsService(),
    { bind: () => undefined } as unknown as NestedTreeExecutionService,
    { bind: () => undefined } as unknown as WorkerServiceInvokerService,
    new TracingService(),
    new DecisionGuardService(prisma),
    () => AHORA,
  );
  const dto = {
    requestId: 'r-1',
    idempotencyKey: 'k-1',
    subjectReference: 'solicitante-1',
    variables: { requested_amount: 80 },
  } as ExecuteDecisionDto;
  return {
    run: () => service.execute(1n, 'CREDITO', dto, principal),
    writes,
    completed,
    failed,
    audited,
  };
}

const pd = (fieldCode = 'pd'): Field => ({
  fieldCode,
  semanticRole: OutputSemanticRole.PROBABILITY_OF_DEFAULT,
  policyMinValue: null,
  policyMaxValue: null,
});

describe('RuntimeService · compuerta de salidas económicas (P-10)', () => {
  it('una PD fuera de [0,1] no sale como autorización: NO_DECISION 422 con motivo técnico', async () => {
    const h = harness({ output: { pd: 4.2, approved_credit_limit: 800 } }, [pd()]);
    const response = await h.run();

    expect(response.httpStatus).toBe(422);
    expect(response.body).toMatchObject({
      status: 'NO_DECISION',
      outcome: 'NO_DECISION',
      executionId: '99',
      decisionValidUntil: null,
      errors: [expect.objectContaining({ code: 'SEMANTIC_OUTPUT_ABOVE_RANGE', field: 'pd' })],
    });
    // El desenlace del grafo (APPROVED) y la salida inválida NO viajan en la respuesta.
    expect(response.body.output).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('APPROVED');
    expect(h.completed).toEqual([]);
    expect(h.failed).toHaveLength(1);
  });

  it('un error del modelo no es un rechazo crediticio: sin acción adversa y de categoría técnica', async () => {
    const h = harness({ output: { pd: 4.2 } }, [pd()]);
    const response = await h.run();
    expect(response.body.reasonCodes).toEqual([
      expect.objectContaining({
        code: 'ECONOMIC_OUTPUT_INVALID',
        category: 'TECHNICAL',
        adverseAction: false,
      }),
    ]);
  });

  it('conserva el expediente: la ejecución se escribe con el resultado del grafo y estado NO_DECISION', async () => {
    const h = harness({ output: { pd: 4.2 }, trace: [] }, [pd()]);
    await h.run();
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toMatchObject({
      statusOverride: 'NO_DECISION',
      result: expect.objectContaining({ outcome: 'APPROVED', output: { pd: 4.2 } }),
      errors: [
        expect.objectContaining({ code: 'SEMANTIC_OUTPUT_ABOVE_RANGE', type: 'ECONOMIC_OUTPUT' }),
      ],
      decidedAt: AHORA,
    });
    expect(h.audited).toEqual(['DECISION_NO_DECISION_ECONOMIC_OUTPUT']);
  });

  it('un límite negativo en el resultado es inválido aunque el artefacto no le declare rol', async () => {
    const h = harness({ output: {}, limit: -500 });
    const response = await h.run();
    expect(response.httpStatus).toBe(422);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ code: 'SEMANTIC_OUTPUT_BELOW_RANGE', field: 'limit' }),
    ]);
  });

  it('un importe no finito es inválido', async () => {
    const h = harness({ output: { approved_credit_limit: 'Infinity' } }, [
      {
        fieldCode: 'approved_credit_limit',
        semanticRole: OutputSemanticRole.APPROVED_LIMIT,
        policyMinValue: null,
        policyMaxValue: null,
      },
    ]);
    const response = await h.run();
    expect(response.httpStatus).toBe(422);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ code: 'SEMANTIC_OUTPUT_NOT_NUMERIC' }),
    ]);
  });

  it('un precio fuera del rango de la POLÍTICA no autoriza aunque sea una tasa plausible', async () => {
    const h = harness({ output: { rate: 0.9 } }, [
      {
        fieldCode: 'rate',
        semanticRole: OutputSemanticRole.PRICED_RATE,
        policyMinValue: 0.18,
        policyMaxValue: 0.45,
      },
    ]);
    const response = await h.run();
    expect(response.httpStatus).toBe(422);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ code: 'OUTPUT_ABOVE_POLICY_RANGE', field: 'rate' }),
    ]);
  });

  it('una salida válida sale como siempre, con vencimiento y la exposición que vio', async () => {
    const h = harness({ output: { pd: 0.04, rate: 0.3 }, limit: 800 }, [
      pd(),
      {
        fieldCode: 'rate',
        semanticRole: OutputSemanticRole.PRICED_RATE,
        policyMinValue: 0.18,
        policyMaxValue: 0.45,
      },
    ]);
    const response = await h.run();
    expect(response.httpStatus).toBe(200);
    expect(response.body).toMatchObject({
      status: 'SUCCEEDED',
      outcome: 'APPROVED',
      output: { pd: 0.04, rate: 0.3 },
      // Una hora por omisión, contada desde el reloj de la decisión.
      decisionValidUntil: '2026-09-24T13:00:00.000Z',
      exposure: null,
      degradedInputs: false,
      freshnessUnknown: [],
    });
    expect(h.writes[0].statusOverride).toBeUndefined();
    expect(h.completed).toHaveLength(1);
  });
});
