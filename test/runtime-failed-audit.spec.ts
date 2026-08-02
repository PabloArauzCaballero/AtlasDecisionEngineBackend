import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import type { AuditService } from '../src/common/audit/audit.service';
import { DomainException } from '../src/common/errors/domain-exception';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { DeploymentResolverService } from '../src/modules/deployments/deployment-resolver.service';
import type { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import type { NestedTreeExecutionService } from '../src/modules/nested-trees/nested-tree-execution.service';
import type { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import type { ExecutionWriterService } from '../src/modules/runtime/execution-writer.service';
import type { IdempotencyService } from '../src/modules/runtime/idempotency.service';
import { RuntimeService } from '../src/modules/runtime/runtime.service';
import type { ExecuteDecisionDto } from '../src/modules/runtime/runtime.dto';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

/**
 * A deterministic failure is a decision the platform actually took: the caller is told "no",
 * and every retry with the same idempotency key replays that same "no". The success and
 * NO_DECISION paths each append to the tenant hash chain; the refusal path did not, so the
 * one outcome a regulator asks about was the only one with no evidence — and its idempotency
 * row committed on its own, outside any transaction.
 */
describe('RuntimeService: evidencia de una decisión fallida', () => {
  const config = new ConfigService({
    AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
    DEFAULT_ENVIRONMENT: 'PROD',
  });

  const principal: AuthenticatedPrincipal = {
    id: 'client-1',
    tenantId: 1n,
    roles: [],
    audience: 'runtime',
    requestId: 'req-1',
    authMethod: 'api_key',
  };

  const dto = {
    requestId: 'r-1',
    idempotencyKey: 'key-1',
    subjectReference: 'subject-1',
    variables: {},
  } as ExecuteDecisionDto;

  function makeService(failure: unknown) {
    const audited: Array<{ eventType: string; tx: unknown }> = [];
    const failed: Array<{ id: bigint; tx: unknown }> = [];
    let released = 0;

    // Un token opaco identifica la transacción: sirve para comprobar que la escritura de
    // idempotencia y el evento de auditoría entran en la MISMA unidad de trabajo.
    const transactionToken = Symbol('tx');
    const prisma = {
      $transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transactionToken),
    } as unknown as PrismaService;

    const service = new RuntimeService(
      config,
      prisma,
      new HashService(config),
      {
        reserve: () => Promise.resolve({ kind: 'reserved' as const, id: 42n }),
        complete: () => Promise.resolve(),
        fail: (id: bigint, _response: unknown, tx?: unknown) => {
          failed.push({ id, tx });
          return Promise.resolve();
        },
        release: () => {
          released += 1;
          return Promise.resolve();
        },
      } as unknown as IdempotencyService,
      {
        resolve: () => Promise.reject(failure),
      } as unknown as DeploymentResolverService,
      {} as VariableResolutionService,
      {} as ExecutionEngineService,
      {} as ExecutionWriterService,
      {
        append: (input: { eventType: string }, tx?: unknown) => {
          audited.push({ eventType: input.eventType, tx });
          return Promise.resolve({} as never);
        },
      } as unknown as AuditService,
      new MetricsService(),
      { bind: () => undefined } as unknown as NestedTreeExecutionService,
    );

    return { service, audited, failed, released, transactionToken, releasedCount: () => released };
  }

  it('deja un DECISION_FAILED en la cadena, en la misma transacción que la idempotencia', async () => {
    const harness = makeService(
      new DomainException('DEPLOYMENT_NOT_FOUND', 'No active deployment', HttpStatus.NOT_FOUND),
    );

    await expect(harness.service.execute(1n, 'ART-1', dto, principal)).rejects.toThrow(
      'No active deployment',
    );

    expect(harness.audited).toEqual([
      { eventType: 'DECISION_FAILED', tx: harness.transactionToken },
    ]);
    expect(harness.failed).toEqual([{ id: 42n, tx: harness.transactionToken }]);
  });

  /**
   * `ScriptNodeRunnerService` lanzaba todos sus errores con el estado por defecto de
   * `DomainException` (400), incluidos los de infraestructura: `SCRIPT_RUNNER_UNAVAILABLE`,
   * el sidecar al límite de capacidad, los nodos de script deshabilitados. `isRetryable`
   * solo considera transitorio un 5xx, así que un sidecar caído se cacheaba como la decisión
   * terminal FAILED de esa petición y el llamante no podía reintentar con la misma clave
   * durante todo el TTL — justo lo que el comentario de `execute()` dice querer evitar,
   * nombrando "script runner unavailable" como el ejemplo.
   */
  it('un sidecar caído libera la clave en vez de atraparla', async () => {
    const harness = makeService(
      new DomainException(
        'SCRIPT_RUNNER_UNAVAILABLE',
        'Could not reach the isolated script runner: ECONNREFUSED',
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
    );

    await expect(harness.service.execute(1n, 'ART-1', dto, principal)).rejects.toThrow(
      /isolated script runner/,
    );

    expect(harness.releasedCount()).toBe(1);
    expect(harness.failed).toEqual([]);
  });

  it('un fallo transitorio libera la reserva y no se audita como decisión', async () => {
    const harness = makeService(
      new DomainException('DEPENDENCY_UNAVAILABLE', 'down', HttpStatus.SERVICE_UNAVAILABLE),
    );

    await expect(harness.service.execute(1n, 'ART-1', dto, principal)).rejects.toThrow('down');

    expect(harness.releasedCount()).toBe(1);
    expect(harness.audited).toEqual([]);
    expect(harness.failed).toEqual([]);
  });

  it('si la base de datos es lo que falla, el llamante recibe el error original', async () => {
    const harness = makeService(
      new DomainException('ARTIFACT_NOT_FOUND', 'Unknown artifact', HttpStatus.NOT_FOUND),
    );
    // La persistencia de la evidencia es best-effort: no puede enmascarar la causa real.
    (harness.service as unknown as { prisma: { $transaction: () => Promise<never> } }).prisma = {
      $transaction: () => Promise.reject(new Error('database unavailable')),
    };

    await expect(harness.service.execute(1n, 'ART-1', dto, principal)).rejects.toThrow(
      'Unknown artifact',
    );
  });
});
